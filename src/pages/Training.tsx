import { useMemo, useState } from 'react'
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
import { PageHeading, EmptyState } from '../components/UI'
import { generatePlan, type EngineResult } from '../domain/engine'
import { getExercise, LIBRARY_REVIEWED } from '../domain/exercises'
import type { PlanDay, TrainingPlan } from '../domain/model'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function weekdayIndex(date: string): number {
  return (new Date(`${date}T12:00:00`).getDay() + 6) % 7
}

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
  const todayIndex = weekdayIndex(today)
  const todayPlan = plan?.days[todayIndex]

  const preview = useMemo(() => {
    if (!draft) return null
    return draft.days[todayIndex]
  }, [draft, todayIndex])

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
    </>
  )
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
