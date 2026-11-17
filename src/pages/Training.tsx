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
import { requestExplain } from '../app/explain'
import { readJson, writeJson } from '../app/storage'
import { PageHeading, EmptyState, Modal } from '../components/UI'
import {
  applyAdjustments,
  generatePlan,
  type EngineResult,
  type Suggestion,
} from '../domain/engine'
import { reviewPlan } from '../domain/stats'
import { getExercise, LIBRARY_REVIEWED } from '../domain/exercises'
import { weekdayIndex } from '../domain/dates'
import { AI_CONSENT_KEY, buildExplainPayload } from '../domain/ai'
import type { PlanDay, TrainingPlan } from '../domain/model'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/** 说明有四种可见状态：未生成、生成中、成功、失败（失败只显示一行 muted 文案）。 */
type ExplainState = { state: 'idle' | 'loading' | 'ok' | 'failed'; text: string }

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
  const [explain, setExplain] = useState<ExplainState>({ state: 'idle', text: '' })
  const [consentOpen, setConsentOpen] = useState(false)
  const todayIndex = weekdayIndex(today)
  const todayPlan = plan?.days[todayIndex]

  // 计划版本或日期变化后，旧说明描述的已经不是今天这份安排，直接清空
  const planStamp = plan ? `${plan.id}:${plan.version}` : ''
  useEffect(() => {
    setExplain({ state: 'idle', text: '' })
  }, [planStamp, today])

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

  function applyReview() {
    if (!plan) return
    const days = applyAdjustments(
      plan.days,
      review.map(({ exerciseId, name, suggestion }) => ({ exerciseId, name, suggestion })),
    )
    setDraft({
      ok: true,
      days,
      notes: [
        '已按最近记录调整：' +
          review.map((item) => `${item.name}（${adjustLabel(item.suggestion)}）`).join('、'),
        '确认后才会替换当前计划，旧版本归档保留。',
      ],
    })
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

  // 说明只解释已生效的计划，因此失败也不回写任何状态，训练流程完全不受影响
  async function runExplain() {
    if (!todayPlan || todayPlan.slots.length === 0) return
    setExplain({ state: 'loading', text: '' })
    const result = await requestExplain(
      buildExplainPayload({ profile, day: todayPlan, workouts: active.workouts, today }),
    )
    setExplain(result.ok ? { state: 'ok', text: result.text } : { state: 'failed', text: '' })
  }

  function startExplain() {
    // 同意标记写在本机；没标记过就先解释清楚要发什么，再让用户决定
    if (readJson<boolean>(AI_CONSENT_KEY) === true) {
      void runExplain()
      return
    }
    setConsentOpen(true)
  }

  function approveExplain() {
    // 存储不可用（隐私模式）时也继续生成：本次同意已经明确，不必二次打断
    writeJson(AI_CONSENT_KEY, true)
    setConsentOpen(false)
    void runExplain()
  }

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

      {/* 今日说明只是对已生效计划的人话解释：休息日没有动作可解释，因此不显示 */}
      {plan && !draft && todayPlan && todayPlan.slots.length > 0 ? (
        <section className="panel">
          <div className="section-heading">
            <h2>今日说明</h2>
            <span className="soft-label">DeepSeek</span>
          </div>
          {explain.state === 'ok' ? (
            <>
              <p>{explain.text}</p>
              <p className="small-muted">由 DeepSeek 生成，仅供参考；计划本身由本地规则决定。</p>
              <button className="text-button" onClick={startExplain}>
                重新生成
              </button>
            </>
          ) : explain.state === 'loading' ? (
            <button className="button secondary" disabled>
              正在生成…
            </button>
          ) : explain.state === 'failed' ? (
            // 静默降级：不报错、不重试、不触碰计划；给一个重新入口，避免只能刷新页面
            <>
              <p className="small-muted">暂时无法生成说明，训练计划不受影响。</p>
              <button className="text-button" onClick={startExplain}>
                重新生成说明
              </button>
            </>
          ) : (
            <>
              <button className="button secondary" onClick={startExplain}>
                生成今日说明
              </button>
              <p className="small-muted">
                会把你档案里的年龄、经验、器械和今天的安排发送给 DeepSeek，不含昵称和邮箱。
              </p>
            </>
          )}
        </section>
      ) : null}

      {plan && !draft && review.length > 0 ? (
        <section className="panel">
          <div className="section-heading">
            <h2>负荷调整建议</h2>
            <span className="status-chip">待确认</span>
          </div>
          <p className="small-muted">
            依据最近两次训练记录给出。确认后会生成新版本计划，旧版本归档保留。
          </p>
          <ul className="slot-list">
            {review.map((item) => (
              <li key={item.exerciseId} className="slot-row">
                <span className="exercise-number">{adjustLabel(item.suggestion).slice(0, 1)}</span>
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.suggestion.reason}</p>
                </div>
              </li>
            ))}
          </ul>
          <button className="button primary" onClick={applyReview}>
            按建议生成新计划
          </button>
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
        <Modal title="把数据发送给 DeepSeek 生成说明" onClose={() => setConsentOpen(false)}>
          <p>只会发送下面这些内容，不含昵称、邮箱和任何账号标识：</p>
          <ul className="small-muted">
            <li>档案：年龄、训练经验、每周天数、单次时长、可用器械、身体限制（最多 80 字）</li>
            <li>今日：训练主题、预计时长，以及每个动作的名称、组数、目标和角色</li>
            <li>近 7 天：完成次数、累计分钟数、平均难度</li>
          </ul>
          <p className="small-muted">说明只用于展示，不会写回计划，也不会存入数据库。</p>
          <div className="actions">
            <button className="button primary" onClick={approveExplain}>
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
