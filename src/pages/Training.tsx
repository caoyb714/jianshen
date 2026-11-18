import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Dumbbell,
  Footprints,
  Info,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { useProfile } from '../app/Store'
import { requestBasis } from '../app/explain'
import { readJson, writeJson } from '../app/storage'
import { PageHeading, EmptyState, Modal } from '../components/UI'
import {
  applyAdjustments,
  generatePlan,
  type EngineResult,
  type Suggestion,
} from '../domain/engine'
import { historyFor, reviewPlan } from '../domain/stats'
import { getExercise, LIBRARY_REVIEWED } from '../domain/exercises'
import { weekdayIndex } from '../domain/dates'
import { AI_CONSENT_KEY, buildBasisPayload, type BasisItem } from '../domain/ai'
import type { PlanDay, TrainingPlan } from '../domain/model'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/** 建议条目的理由有四种可见状态；失败只降级理由位，不影响幅度与采纳。 */
type BasisState = { state: 'idle' | 'loading' | 'ok' | 'failed'; texts: Record<string, string> }

function targetText(day: PlanDay) {
  const main = day.slots.filter((slot) => slot.role === '主要')
  const sets = main.reduce((sum, slot) => sum + slot.sets, 0)
  return `${main.length} 个动作 · ${sets} 组`
}

export default function Training() {
  const { active, profile, commit, notify, today } = useProfile()
  const plan = active.plan
  const [draft, setDraft] = useState<Extract<EngineResult, { ok: true }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [basis, setBasis] = useState<BasisState>({ state: 'idle', texts: {} })
  const [consentOpen, setConsentOpen] = useState(false)
  // 采纳只是进草稿：不进库、不改当前计划，卡底按钮才是唯一的提交入口
  const [staged, setStaged] = useState<string[]>([])
  const [ignored, setIgnored] = useState<string[]>([])
  const [applied, setApplied] = useState<{ version: number; sigs: string[] } | null>(null)
  const [undone, setUndone] = useState<{ sig: string; version: number } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  // 提交后规则可能不再给出同一条建议，卡片要留住刚生效的那几条，否则会瞬间消失
  const [appliedItems, setAppliedItems] = useState<{
    version: number
    items: ReturnType<typeof reviewPlan>
  } | null>(null)
  // 撤销要回到「调整前」的基线重算，而不是做反向数学；基线只在本会话内保留
  const [baseline, setBaseline] = useState<PlanDay[] | null>(null)
  const todayIndex = weekdayIndex(today)
  const todayPlan = plan?.days[todayIndex]

  // 计划版本或日期变化后，旧理由与草稿都属于上一份安排，直接清空
  const planStamp = plan ? `${plan.id}:${plan.version}` : ''
  useEffect(() => {
    setBasis({ state: 'idle', texts: {} })
    setStaged([])
    setIgnored([])
    setPending(null)
    setBaseline(null)
    // 刚提交成功的那一版要保留「已生效」，否则卡片会立刻退回未采纳态
    setApplied((current) => (current && current.version === plan?.version ? current : null))
    setUndone((current) => (current && current.version === plan?.version ? current : null))
    setAppliedItems((current) => (current && current.version === plan?.version ? current : null))
  }, [planStamp, today, plan?.version])

  const preview = useMemo(() => {
    if (!draft) return null
    return draft.days[todayIndex]
  }, [draft, todayIndex])

  // 只列出会真正改变计划的建议；「保持」「数据不足」不打断用户
  const review = useMemo(() => {
    if (!active.plan) return []
    return reviewPlan(active.plan.days, active.workouts).filter((item) =>
      ['increase', 'reduce', 'stop'].includes(item.suggestion.kind),
    )
  }, [active.plan, active.workouts])

  /** 条目签名：动作 + 调整方向 + 幅度。客户端与服务端都靠它对齐，模型无权新增。 */
  function sigOf(item: (typeof review)[number]) {
    const detail =
      item.suggestion.kind === 'increase'
        ? (item.suggestion.nextLoad ?? item.suggestion.nextReps ?? '')
        : item.suggestion.kind === 'reduce'
          ? (item.suggestion.nextLoad ?? '')
          : 'stop'
    return `${item.exerciseId}:${item.suggestion.kind}:${detail}`
  }

  async function loadBasis() {
    if (!plan || !todayPlan || review.length === 0) return
    setBasis((current) => ({ state: 'loading', texts: current.texts }))
    const items: BasisItem[] = review.map((item) => {
      const last = historyFor(active.workouts, item.exerciseId, 1)[0]
      const set = last?.sets[last.sets.length - 1]
      return {
        sig: sigOf(item),
        name: item.name,
        label: adjustLabel(item.suggestion),
        evidence: {
          reps: set?.reps ?? null,
          load: set?.load ?? null,
          difficulty: last?.difficulty ?? null,
        },
      }
    })
    const result = await requestBasis(
      buildBasisPayload({
        profile,
        day: todayPlan,
        planVersion: plan.version,
        items,
        workouts: active.workouts,
        today,
      }),
    )
    setBasis(result.ok ? { state: 'ok', texts: result.texts } : { state: 'failed', texts: {} })
  }

  function askBasis() {
    if (readJson<boolean>(AI_CONSENT_KEY) === true) {
      void loadBasis()
      return
    }
    setConsentOpen(true)
  }

  function approveBasis() {
    writeJson(AI_CONSENT_KEY, true)
    setConsentOpen(false)
    void loadBasis()
  }

  /**
   * 提交一组调整，生成新版本。
   * undo 时传的是「撤销的那条」，其余采纳项从基线重算，避免反向加减累积误差。
   */
  async function submitAdjustments(sigs: string[], kind: 'commit' | 'undo', drop?: string) {
    if (!plan || pending) return
    const base = kind === 'undo' ? baseline : plan.days
    if (!base) return
    // 撤销时规则可能已经不再给出同一条，必须从提交时的快照里挑，而不是重新算
    const source = kind === 'undo' ? (appliedItems?.items ?? []) : review
    const remaining = sigs.filter((sig) => sig !== drop)
    const picked = source.filter((item) => remaining.includes(sigOf(item)))
    const days = picked.length
      ? applyAdjustments(
          base,
          picked.map(({ exerciseId, name, suggestion }) => ({ exerciseId, name, suggestion })),
        )
      : base
    setPending(kind === 'undo' ? (drop ?? 'undo') : 'commit')
    const next: TrainingPlan = {
      profileId: active.id,
      id: crypto.randomUUID(),
      version: plan.version + 1,
      generatedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      status: 'active',
      input: plan.input,
      days,
      notes: [
        '按最近记录调整：' + picked.map((item) => item.name).join('、'),
        '旧版本已归档保留。',
      ],
    }
    const saved = await commit({ kind: 'plan', value: next })
    setPending(null)
    if (!saved) return
    if (kind === 'commit') {
      setBaseline(plan.days)
      setApplied({ version: next.version, sigs })
      setAppliedItems({ version: next.version, items: picked })
      setStaged([])
      setUndone(null)
      notify(`已生成 v${next.version}，旧版本已归档`)
    } else {
      setBaseline(base)
      setApplied(remaining.length ? { version: next.version, sigs: remaining } : null)
      setAppliedItems(picked.length ? { version: next.version, items: picked } : null)
      setUndone({ sig: drop ?? '', version: next.version })
      setStaged([])
      notify(`已撤销，生成了 v${next.version}`)
    }
  }

  function generate() {
    const result = generatePlan({
      age: profile.age,
      experience: profile.experience,
      weeklyDays: profile.weeklyDays,
      sessionMinutes: profile.sessionMinutes,
      equipment: profile.equipment,
      restrictions: profile.restrictions,
      restrictionsConfirmed: profile.restrictionsConfirmed,
    })
    if (!result.ok) {
      notify(result.message)
      return
    }
    setDraft(result)
  }

  async function confirm() {
    if (!draft) return
    setBusy(true)
    const next: TrainingPlan = {
      profileId: active.id,
      id: crypto.randomUUID(),
      version: (plan?.version ?? 0) + 1,
      generatedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      status: 'active',
      input: {
        age: profile.age,
        experience: profile.experience,
        weeklyDays: profile.weeklyDays,
        sessionMinutes: profile.sessionMinutes,
        equipment: profile.equipment,
        restrictions: profile.restrictions,
      },
      days: draft.days,
      notes: draft.notes,
    }
    const saved = await commit({ kind: 'plan', value: next })
    setBusy(false)
    if (saved) {
      setDraft(null)
      notify('计划已保存，从今天开始执行')
    }
  }

  const shown = preview ?? todayPlan

  return (
    <>
      <PageHeading title="把时间留给身体。" description="不必练得很满，找到舒服的节奏就好。" />

      {draft ? (
        <section className="panel">
          <div className="section-heading">
            <h2>计划预览 · 尚未生效</h2>
            <span className="status-chip">待确认</span>
          </div>
          <p className="small-muted">规则引擎按当前档案生成，确认后才会替换正在使用的计划。</p>
          <div className="week-days week-plan">
            {draft.days.map((day) => (
              <div key={day.index} className={day.index === todayIndex ? 'today' : ''}>
                <span>周{WEEK_LABELS[day.index]}</span>
                <span className={`day-dot ${day.kind === '训练' ? 'complete' : ''}`}>
                  {day.kind === '训练' ? day.slots.filter((s) => s.role === '主要').length : '—'}
                </span>
              </div>
            ))}
          </div>
          {shown ? <DayDetail day={shown} date={today} /> : null}
          {draft.notes.map((note) => (
            <p className="small-muted" key={note}>
              · {note}
            </p>
          ))}
          <div className="actions">
            <button className="button primary" disabled={busy} onClick={() => void confirm()}>
              确认使用此计划
            </button>
            <button className="button secondary" onClick={() => setDraft(null)}>
              放弃预览
            </button>
          </div>
        </section>
      ) : plan && todayPlan ? (
        <DayDetail day={todayPlan} date={today} actionable />
      ) : (
        <EmptyState
          title="还没有训练计划"
          description="根据年龄、经验、每周天数、器械与身体限制生成一份固定规则的周计划。"
        />
      )}

      {draft ? null : (
        <div className="actions">
          <button className="button primary" onClick={generate}>
            <Sparkles size={17} />
            {plan ? '重新生成计划' : '生成我的计划'}
          </button>
          <Link className="button secondary" to="/exercises">
            <Dumbbell size={17} />
            动作库
          </Link>
        </div>
      )}

      {/* 规则给幅度、AI 写理由：两块合成一张卡，避免同屏出现两份互相打架的建议 */}
      {plan && !draft && (appliedItems?.items ?? review).length > 0 ? (
        <section className="panel adjust-panel">
          <div className="section-heading">
            <h2>今天可以这样调</h2>
            <span className="soft-label">幅度由本地规则计算</span>
          </div>
          <p className="small-muted">
            依据最近两次训练记录。采纳只是先记下来，卡底生成新版本后才真正生效。
          </p>
          <ul className="slot-list">
            {(appliedItems?.items ?? review).map((item) => {
              const sig = sigOf(item)
              const isApplied = applied?.sigs.includes(sig) ?? false
              const isStaged = staged.includes(sig)
              const isIgnored = ignored.includes(sig)
              const reason = basis.texts[sig] ?? item.suggestion.reason
              return (
                <li
                  key={sig}
                  className={[
                    'slot-row',
                    'adjust-row',
                    isApplied ? 'applied' : '',
                    isStaged ? 'staged' : '',
                    isIgnored ? 'ignored' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="adjust-head">
                    <h3>{item.name}</h3>
                    <span className="adjust-chip">{adjustLabel(item.suggestion)}</span>
                  </div>
                  {isIgnored ? null : <p className="adjust-reason">{reason}</p>}
                  <div className="adjust-actions">
                    {isApplied ? (
                      <>
                        <span className="small-muted">
                          已生效 · v{applied?.version}，撤销不会改回旧版
                        </span>
                        <button
                          className="text-button"
                          aria-disabled={pending !== null}
                          onClick={() => void submitAdjustments(applied?.sigs ?? [], 'undo', sig)}
                        >
                          {pending === sig ? `正在生成 v${plan.version + 1}…` : '撤销并生成新版本'}
                        </button>
                      </>
                    ) : isStaged ? (
                      <>
                        <span className="small-muted">已采纳 · 下次生成计划时应用</span>
                        <button
                          className="text-button"
                          onClick={() => setStaged((cur) => cur.filter((row) => row !== sig))}
                        >
                          移出本次调整
                        </button>
                      </>
                    ) : isIgnored ? (
                      <>
                        <span className="small-muted">已忽略</span>
                        <button
                          className="text-button"
                          onClick={() => setIgnored((cur) => cur.filter((row) => row !== sig))}
                        >
                          恢复
                        </button>
                      </>
                    ) : (
                      <>
                        {undone?.sig === sig ? (
                          <span className="small-muted">已撤销 · v{undone.version}</span>
                        ) : null}
                        <span className="adjust-spacer" />
                        <button
                          className="chip-button"
                          aria-disabled={pending !== null}
                          onClick={() => {
                            setIgnored((cur) => cur.filter((row) => row !== sig))
                            setStaged((cur) => (cur.includes(sig) ? cur : [...cur, sig]))
                          }}
                        >
                          采纳
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setIgnored((cur) => [...cur, sig])}
                        >
                          忽略
                        </button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {staged.length ? (
            <button
              className="button secondary adjust-submit"
              aria-disabled={pending !== null}
              onClick={() => void submitAdjustments(staged, 'commit')}
            >
              {pending === 'commit'
                ? `正在生成 v${plan.version + 1}…`
                : `按 ${staged.length} 条建议生成新版本`}
            </button>
          ) : null}
          <div className="adjust-credit">
            <span className="small-muted">
              调整幅度由本地规则按你的记录计算；理由说明由 AI 改写，仅供参考。
            </span>
            {basis.state === 'loading' ? (
              <span className="small-muted">正在整理理由…</span>
            ) : basis.state === 'failed' ? (
              <button className="text-button" onClick={askBasis}>
                理由暂不可用，再试一次
              </button>
            ) : basis.state === 'idle' ? (
              <button className="text-button" onClick={askBasis}>
                生成理由
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {plan && !draft ? (
        <section className="panel">
          <div className="section-heading">
            <h2>本周安排</h2>
            <span className="small-muted">
              v{plan.version} · 生成于 {plan.generatedAt.slice(0, 10)}
            </span>
          </div>
          <div className="week-days week-plan">
            {plan.days.map((day) => (
              <div key={day.index} className={day.index === todayIndex ? 'today' : ''}>
                <span>周{WEEK_LABELS[day.index]}</span>
                <span className={`day-dot ${day.kind === '训练' ? 'complete' : ''}`}>
                  {day.kind === '训练' ? day.slots.filter((s) => s.role === '主要').length : '—'}
                </span>
                <small>{day.kind === '训练' ? `${day.estimatedMinutes}分` : day.kind}</small>
              </div>
            ))}
          </div>
          <p className="small-muted">
            每位档案同时只有一份生效计划；重新生成会把旧版本归档，历史记录保留。
          </p>
        </section>
      ) : null}

      <div className="notice-panel">
        <Info size={20} />
        <p>
          {LIBRARY_REVIEWED
            ? '动作内容已通过专业审核。'
            : '动作库内容由本项目自行撰写，尚未经专业人员逐项审核。计划由固定规则生成，不是医疗建议；出现疼痛、头晕或异常不适请立即停止。'}
        </p>
      </div>

      {plan && !draft && active.workouts.length === 0 ? (
        <p className="demo-caption">
          <RotateCcw size={14} /> 完成第一次训练后，这里会给出负荷调整建议。
        </p>
      ) : null}

      {consentOpen ? (
        <Modal title="把数据发送给 DeepSeek 生成理由" onClose={() => setConsentOpen(false)}>
          <p>只会发送下面这些内容，不含昵称、邮箱和任何账号标识，也不含体重：</p>
          <ul className="small-muted">
            <li>档案：年龄、训练经验、可用器械、身体限制（最多 80 字）</li>
            <li>今日：训练主题，以及每个动作的名称、组数、目标和角色</li>
            <li>建议：每条调整的幅度，以及最近一次的次数、负荷和难度</li>
          </ul>
          <p className="small-muted">
            调整幅度由本地规则计算，理由是改写，只用于展示，不会写回计划。
          </p>
          <div className="actions">
            <button className="button primary" onClick={approveBasis}>
              同意并生成
            </button>
            <button className="button secondary" onClick={() => setConsentOpen(false)}>
              取消
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

function adjustLabel(suggestion: Suggestion): string {
  switch (suggestion.kind) {
    case 'increase':
      return suggestion.nextReps !== null
        ? `加次数至 ${suggestion.nextReps}`
        : `加至 ${suggestion.nextLoad}`
    case 'reduce':
      return `降至 ${suggestion.nextLoad}`
    case 'stop':
      return '换动作'
    default:
      return '保持'
  }
}

function DayDetail({
  day,
  date,
  actionable = false,
}: {
  day: PlanDay
  date: string
  actionable?: boolean
}) {
  if (day.kind !== '训练' && day.kind !== '恢复')
    return (
      <section className="panel">
        <div className="section-heading">
          <h2>{day.focus}</h2>
          <CalendarDays size={20} strokeWidth={1.4} />
        </div>
        <p>{day.note}</p>
      </section>
    )
  const main = day.slots.filter((slot) => slot.role === '主要')
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{day.focus}</h2>
        <span className="inline-meta">
          <Clock3 size={15} />
          {day.estimatedMinutes} 分钟
        </span>
      </div>
      {day.warmup ? <p className="small-muted">热身：{day.warmup}</p> : null}
      <ol className="slot-list">
        {day.slots.map((slot) => {
          const exercise = getExercise(slot.exerciseId)
          if (!exercise) return null
          const target =
            slot.target.type === 'reps'
              ? `${slot.target.min}–${slot.target.max} 次`
              : slot.target.type === 'hold'
                ? `${slot.target.seconds} 秒`
                : `${slot.target.minMinutes}–${slot.target.maxMinutes} 分钟`
          return (
            <li key={slot.exerciseId} className="slot-row">
              <span className="exercise-number">
                {slot.role === '放松' ? '松' : exercise.pattern}
              </span>
              <div>
                <h3>
                  {exercise.name}
                  {exercise.unilateral ? <em className="soft-label">单侧</em> : null}
                </h3>
                <p>
                  {slot.sets} 组 × {target} · 休息 {slot.restSeconds} 秒 · {exercise.equipment}
                </p>
              </div>
              {slot.role === '放松' ? <Check size={16} /> : null}
            </li>
          )
        })}
      </ol>
      {day.note ? <p className="small-muted">{day.note}</p> : null}
      <p className="small-muted">{targetText(day)} · 组次为起点，实际完成情况在训练页逐组记录。</p>
      {actionable && main.length > 0 ? (
        <Link className="button primary full-button" to={`/training/session/${date}`}>
          {day.kind === '恢复' ? '记录今天的恢复' : '开始今天的训练'}
          <ArrowRight size={17} />
        </Link>
      ) : null}
      {actionable ? (
        <p className="demo-caption">
          <Footprints size={14} /> 如果今天状态不佳，可以只完成一部分，或改为轻松步行。
        </p>
      ) : null}
    </section>
  )
}
