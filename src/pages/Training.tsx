import { useEffect, useMemo, useRef, useState } from 'react'
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
import { accessToken } from '../cloud/session'
import { readJson, writeJson } from '../app/storage'
import {
  canAuto,
  canManual,
  exhausted,
  cooldownLeft,
  markAuto,
  markManual,
  normalize,
  type BasisState as BasisGate,
} from '../app/aiBasis'
import { PageHeading, EmptyState, Modal } from '../components/UI'
import {
  applyAdjustments,
  estimateMinutes,
  generatePlan,
  targetFor,
  trainingWeekNumber,
  type EngineResult,
  type Suggestion,
} from '../domain/engine'
import { historyFor, reviewPlan } from '../domain/stats'
import { alternativesFor, getExercise, LIBRARY_REVIEWED } from '../domain/exercises'
import { weekdayIndex } from '../domain/dates'
import { AI_CONSENT_KEY, buildBasisPayload, formatTarget, type BasisItem } from '../domain/ai'
import type { PlanDay, PlanSlot, TrainingPlan } from '../domain/model'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
/** 触发策略的落盘键：换版本或换天会自动重置，不需要手动清理 */
const BASIS_GATE_KEY = 'herfit.aiBasis.v1'

/** 建议条目的理由有四种可见状态；失败只降级理由位，不影响幅度与采纳。 */
type BasisState = { state: 'idle' | 'loading' | 'ok' | 'failed'; texts: Record<string, string> }

function targetText(day: PlanDay) {
  const main = day.slots.filter((slot) => slot.role === '主要')
  const sets = main.reduce((sum, slot) => sum + slot.sets, 0)
  return `${main.length} 个动作 · ${sets} 组`
}

export default function Training() {
  const { active, profile, data, cloud, commit, notify, today } = useProfile()
  const plan = active.plan
  const [draft, setDraft] = useState<Extract<EngineResult, { ok: true }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [basis, setBasis] = useState<BasisState>({ state: 'idle', texts: {} })
  const [consentOpen, setConsentOpen] = useState(false)
  // 采纳只是进草稿：不进库、不改当前计划，卡底按钮才是唯一的提交入口
  const [staged, setStaged] = useState<string[]>([])
  const [ignored, setIgnored] = useState<string[]>([])
  const [undone, setUndone] = useState<{ sig: string; version: number } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  // 单日编辑：只改这一天，保存时生成新版本，旧版归档
  const [editDay, setEditDay] = useState<PlanDay | null>(null)
  const [dayBusy, setDayBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // 只给读屏用的播报：采纳、理由失败这类状态变化没有视觉焦点可依赖
  const [announce, setAnnounce] = useState('')
  const autoGuard = useRef(false)
  const todayIndex = weekdayIndex(today)
  const todayPlan = plan?.days[todayIndex]

  // 「已生效」不再只存在内存里：计划自己记着基线版本与已应用的条目，刷新后照样能显示与撤销
  const appliedRows = plan?.appliedAdjustments ?? []
  const baselineVersion = plan?.baselineVersion ?? null
  const baseDays = useMemo(() => {
    if (!plan || baselineVersion === null) return null
    const row = data.plans.find(
      (item) => item.profileId === plan.profileId && item.version === baselineVersion,
    )
    return row?.days ?? null
  }, [plan, baselineVersion, data.plans])

  // 计划版本或日期变化后，旧理由与草稿都属于上一份安排，直接清空
  const planStamp = plan ? `${plan.id}:${plan.version}` : ''
  const readGate = () => normalize(readJson<BasisGate>(BASIS_GATE_KEY), today, planStamp)
  const saveGate = (next: BasisGate) => writeJson(BASIS_GATE_KEY, next)
  useEffect(() => {
    setBasis({ state: 'idle', texts: {} })
    setStaged([])
    setIgnored([])
    setPending(null)
    setUndone((current) => (current && current.version === plan?.version ? current : null))
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

  /** 打开某一天的编辑：复制一份，取消时不会污染正在使用的计划 */
  function openDay(day: PlanDay) {
    if (dayBusy) return
    setEditDay({
      ...day,
      slots: day.slots.map((slot) => ({ ...slot, target: { ...slot.target } })),
    })
  }

  function changeSets(index: number, delta: number) {
    setEditDay((current) =>
      current
        ? {
            ...current,
            slots: current.slots.map((slot, i) =>
              i === index ? { ...slot, sets: Math.min(10, Math.max(1, slot.sets + delta)) } : slot,
            ),
          }
        : current,
    )
  }

  function swapSlot(index: number, exerciseId: string) {
    const exercise = getExercise(exerciseId)
    if (!exercise) return
    setEditDay((current) =>
      current
        ? {
            ...current,
            slots: current.slots.map((slot, i) =>
              i === index
                ? {
                    ...slot,
                    exerciseId,
                    // 换动作等于换了负荷口径：目标按新动作的类型重算，负荷归零由用户自己填
                    target: targetFor(exercise, profile.experience),
                    startLoad: 0,
                  }
                : slot,
            ),
          }
        : current,
    )
  }

  async function saveDay(skip: boolean) {
    if (!plan || !editDay || dayBusy) return
    const slots: PlanSlot[] = skip ? [] : editDay.slots
    const nextDay: PlanDay = {
      ...editDay,
      kind: slots.length ? '训练' : '休息',
      focus: slots.length ? editDay.focus : '休息',
      slots,
      estimatedMinutes: slots.length ? estimateMinutes(slots) : 0,
    }
    const days = plan.days.map((day) => (day.index === nextDay.index ? nextDay : day))
    setDayBusy(true)
    const next: TrainingPlan = {
      ...plan,
      id: crypto.randomUUID(),
      version: plan.version + 1,
      generatedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      status: 'active',
      days,
      editedBy: cloud ? cloud.viewerId : 'local',
      notes: [
        skip
          ? `周${WEEK_LABELS[nextDay.index]}改为休息。`
          : `已调整周${WEEK_LABELS[nextDay.index]}的安排。`,
        '旧版本已归档保留。',
      ],
    }
    const saved = await commit({ kind: 'plan', value: next })
    setDayBusy(false)
    if (!saved) return
    setEditDay(null)
    notify(
      skip
        ? `周${WEEK_LABELS[nextDay.index]}已改为休息 · v${next.version}`
        : `已保存 · v${next.version}`,
    )
  }

  function sigOf(item: (typeof review)[number]) {
    const detail =
      item.suggestion.kind === 'increase'
        ? (item.suggestion.nextLoad ?? item.suggestion.nextReps ?? '')
        : item.suggestion.kind === 'reduce'
          ? (item.suggestion.nextLoad ?? '')
          : 'stop'
    return `${item.exerciseId}:${item.suggestion.kind}:${detail}`
  }

  /**
   * 卡片显示什么：先显示「已应用到这一版」的条目（来自计划本身，刷新后仍在），
   * 再补上当前规则新给出的建议。这样提交后规则不再给同一条时，卡片不会整块消失。
   */
  const adjustRows = useMemo(() => {
    const appliedViews = appliedRows.map((row) => ({
      sig: row.sig,
      name: row.name,
      label: row.label,
      reason: basis.texts[row.sig] ?? '已经应用到当前版本。',
    }))
    const extra = review
      .filter((item) => !appliedRows.some((row) => row.sig === sigOf(item)))
      .map((item) => {
        const sig = sigOf(item)
        return {
          sig,
          name: item.name,
          label: adjustLabel(item.suggestion),
          reason: basis.texts[sig] ?? item.suggestion.reason,
        }
      })
    return [...appliedViews, ...extra]
  }, [appliedRows, review, basis.texts])

  async function loadBasis(kind: 'auto' | 'manual') {
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
      // 演示模式没有会话，传 null；云模式必须带 token，否则服务端会拒绝
      cloud ? await accessToken() : null,
    )
    const current = readGate()
    if (!result.ok) setAnnounce('理由暂时不可用，计划与采纳不受影响。')
    if (result.ok) {
      // 只有成功才计数：一次网络抖动不该白白用掉当天的额度
      saveGate(kind === 'auto' ? markAuto(current) : markManual(current, Date.now()))
      setNow(Date.now())
    }
    setBasis(result.ok ? { state: 'ok', texts: result.texts } : { state: 'failed', texts: {} })
  }

  // 进页面自动拉一次：已同意 + 在线 + 有建议 + 本版本本天没拉过
  useEffect(() => {
    if (!plan || !todayPlan || review.length === 0) return
    if (basis.state !== 'idle') return
    if (readJson<boolean>(AI_CONSENT_KEY) !== true) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    if (autoGuard.current || !canAuto(readGate())) return
    autoGuard.current = true
    const timer = window.setTimeout(() => void loadBasis('auto'), 800)
    return () => window.clearTimeout(timer)
  }, [planStamp, today, review.length, basis.state])

  // 冷却期间每秒刷新一次，按钮上的秒数才会走
  useEffect(() => {
    if (cooldownLeft(readGate(), now) <= 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [now, basis.state, planStamp])

  function askBasis() {
    if (!canManual(readGate(), Date.now())) {
      setNow(Date.now())
      return
    }
    if (readJson<boolean>(AI_CONSENT_KEY) === true) {
      void loadBasis('manual')
      return
    }
    setConsentOpen(true)
  }

  function approveBasis() {
    writeJson(AI_CONSENT_KEY, true)
    setConsentOpen(false)
    void loadBasis('manual')
  }

  const editedBy = cloud ? cloud.viewerId : 'local'

  /** 把一组建议落到当前计划上，生成新版本，并记下基线与已应用条目 */
  async function commitAdjustments(picked: ReturnType<typeof reviewPlan>) {
    if (!plan || pending || picked.length === 0) return
    const days = applyAdjustments(
      plan.days,
      picked.map(({ exerciseId, name, suggestion }) => ({ exerciseId, name, suggestion })),
    )
    const meta = picked.map((item) => ({
      sig: sigOf(item),
      name: item.name,
      label: adjustLabel(item.suggestion),
    }))
    const next: TrainingPlan = {
      ...plan,
      id: crypto.randomUUID(),
      version: plan.version + 1,
      generatedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      status: 'active',
      days,
      // 第一次调整时定下基线；之后继续调整仍沿用最初那一版，撤销才能真正回到原点
      baselineVersion: baselineVersion ?? plan.version,
      appliedAdjustments: meta,
      editedBy,
      notes: [
        '按最近记录调整：' + picked.map((item) => item.name).join('、'),
        '旧版本已归档保留。',
      ],
    }
    setPending('commit')
    const saved = await commit({ kind: 'plan', value: next })
    setPending(null)
    if (!saved) return
    setStaged([])
    setUndone(null)
    notify(`已生成 v${next.version}，旧版本已归档`)
  }

  /**
   * 恢复到基线：拿基线那一版的 days，套用「剩下还要生效的条目」重算。
   * 全程只依赖计划里存的 baselineVersion，所以刷新之后依然可用。
   */
  async function undoAdjustment(sig: string) {
    if (!plan || pending) return
    const base = baseDays
    const kept = appliedRows.filter((row) => row.sig !== sig)
    if (!base) {
      notify('找不到这一版最初的计划，暂时无法恢复。')
      return
    }
    // 基线版本上的建议是确定的：用同样的记录重算，得到与当初一致的结果
    const baseReview = reviewPlan(base, active.workouts)
    const picked = baseReview.filter((item) => kept.some((row) => row.sig === sigOf(item)))
    const days = picked.length
      ? applyAdjustments(
          base,
          picked.map(({ exerciseId, name, suggestion }) => ({ exerciseId, name, suggestion })),
        )
      : base
    const next: TrainingPlan = {
      ...plan,
      id: crypto.randomUUID(),
      version: plan.version + 1,
      generatedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      status: 'active',
      days,
      baselineVersion,
      appliedAdjustments: kept,
      editedBy,
      notes: [`已恢复到 v${baselineVersion} 的安排。`, '这次恢复同样生成了新版本，历史仍可回溯。'],
    }
    setPending(sig)
    const saved = await commit({ kind: 'plan', value: next })
    setPending(null)
    if (!saved) return
    setStaged([])
    setUndone({ sig, version: next.version })
    notify(`已恢复，生成了 v${next.version}`)
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
      // 第几周从真实训练记录算，避免「同一天重生成四次」被误判成降载周
      weekNumber: trainingWeekNumber(active.workouts, today),
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
      {plan && !draft && adjustRows.length > 0 ? (
        <section className="panel adjust-panel">
          <div className="section-heading">
            <h2>今天可以这样调</h2>
            <span className="soft-label">幅度由本地规则计算</span>
          </div>
          <p className="small-muted">
            依据最近两次训练记录。采纳只是先记下来，卡底生成新版本后才真正生效。
          </p>
          <ul className="slot-list">
            {adjustRows.map((row) => {
              const sig = row.sig
              const isApplied = appliedRows.some((applied) => applied.sig === sig)
              const isStaged = staged.includes(sig)
              const isIgnored = ignored.includes(sig)
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
                    <h3>{row.name}</h3>
                    <span className="adjust-chip">{row.label}</span>
                  </div>
                  {isIgnored ? null : <p className="adjust-reason">{row.reason}</p>}
                  <div className="adjust-actions">
                    {isApplied ? (
                      <>
                        <span className="small-muted">
                          已生效 · v{plan.version}
                          {baselineVersion !== null ? ` · 基于 v${baselineVersion}` : ''}
                        </span>
                        <button
                          className="text-button"
                          aria-disabled={pending !== null}
                          onClick={() => void undoAdjustment(sig)}
                        >
                          {pending === sig
                            ? `正在生成 v${plan.version + 1}…`
                            : `恢复到 v${baselineVersion ?? plan.version} 的安排`}
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
                        {undone && undone.sig === sig ? (
                          <span className="small-muted">已撤销 · v{undone.version}</span>
                        ) : null}
                        <span className="adjust-spacer" />
                        <button
                          className="chip-button"
                          aria-disabled={pending !== null}
                          onClick={() => {
                            setIgnored((cur) => cur.filter((row) => row !== sig))
                            setStaged((cur) => (cur.includes(sig) ? cur : [...cur, sig]))
                            setAnnounce(`已采纳：${row.name}。卡底确认后才会生效。`)
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
              onClick={() =>
                void commitAdjustments(review.filter((item) => staged.includes(sigOf(item))))
              }
            >
              {pending === 'commit'
                ? `正在生成 v${plan.version + 1}…`
                : `按 ${staged.length} 条建议生成新版本`}
            </button>
          ) : null}
          <p className="sr-only" role="status">
            {announce}
          </p>
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
              exhausted(readGate()) ? (
                <span className="small-muted">今天的理由已用完，明天再来。</span>
              ) : cooldownLeft(readGate(), now) > 0 ? (
                <button className="text-button" aria-disabled="true">
                  稍后再试（{Math.ceil(cooldownLeft(readGate(), now) / 1000)} 秒）
                </button>
              ) : (
                <button className="text-button" onClick={askBasis}>
                  生成理由
                </button>
              )
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
              <button
                key={day.index}
                type="button"
                className={day.index === todayIndex ? 'today' : ''}
                aria-label={`编辑周${WEEK_LABELS[day.index]}的安排`}
                onClick={() => openDay(day)}
              >
                <span>周{WEEK_LABELS[day.index]}</span>
                <span className={`day-dot ${day.kind === '训练' ? 'complete' : ''}`}>
                  {day.kind === '训练' ? day.slots.filter((s) => s.role === '主要').length : '—'}
                </span>
                <small>{day.kind === '训练' ? `${day.estimatedMinutes}分` : day.kind}</small>
              </button>
            ))}
          </div>
          <p className="small-muted">
            点某一天可以单独调整那天的动作与组数，或改成休息；只会生成新版本，不影响其他几天。
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

      {editDay ? (
        <Modal
          title={`编辑周${WEEK_LABELS[editDay.index]}`}
          onClose={() => {
            if (!dayBusy) setEditDay(null)
          }}
        >
          <p className="small-muted">只改这一天，保存后生成新版本；其他几天保持原样。</p>
          <ul className="day-editor">
            {editDay.slots.map((slot, index) => {
              const exercise = getExercise(slot.exerciseId)
              return (
                <li key={`${slot.exerciseId}-${index}`} className="day-slot">
                  <div className="day-slot-head">
                    <strong>{exercise?.name ?? slot.exerciseId}</strong>
                    <span className="small-muted">
                      {formatTarget(slot.target)} · {slot.role}
                    </span>
                  </div>
                  <div className="day-slot-controls">
                    <div className="sets-stepper">
                      <button
                        type="button"
                        aria-label={`减少${exercise?.name ?? '动作'}的组数`}
                        aria-disabled={dayBusy}
                        onClick={() => changeSets(index, -1)}
                      >
                        −
                      </button>
                      <span>{slot.sets} 组</span>
                      <button
                        type="button"
                        aria-label={`增加${exercise?.name ?? '动作'}的组数`}
                        aria-disabled={dayBusy}
                        onClick={() => changeSets(index, 1)}
                      >
                        +
                      </button>
                    </div>
                    {exercise && alternativesFor(slot.exerciseId, profile.equipment).length > 0 ? (
                      <label className="day-slot-swap">
                        <span className="small-muted">换动作</span>
                        <select
                          value={slot.exerciseId}
                          aria-label={`替换${exercise.name}`}
                          onChange={(event) => swapSlot(index, event.target.value)}
                        >
                          <option value={slot.exerciseId}>{exercise.name}</option>
                          {alternativesFor(slot.exerciseId, profile.equipment).map((alternative) => (
                            <option key={alternative.id} value={alternative.id}>
                              {alternative.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
          {editDay.slots.length === 0 ? (
            <p className="small-muted">这天没有动作，保存后会变成休息日。</p>
          ) : null}
          <p className="small-muted">
            预计 {editDay.slots.length ? estimateMinutes(editDay.slots) : 0} 分钟。
          </p>
          <div className="actions">
            <button
              className="button secondary"
              aria-disabled={dayBusy}
              onClick={() => void saveDay(false)}
            >
              {dayBusy ? '保存中…' : `保存为 v${plan ? plan.version + 1 : ''}`}
            </button>
            <button
              className="text-button"
              aria-disabled={dayBusy}
              onClick={() => {
                if (!dayBusy) setEditDay(null)
              }}
            >
              取消
            </button>
            {editDay.slots.length ? (
              <button
                className="text-button"
                aria-disabled={dayBusy}
                onClick={() => void saveDay(true)}
              >
                这天改成休息
              </button>
            ) : null}
          </div>
        </Modal>
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
