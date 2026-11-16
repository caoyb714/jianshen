import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Play, Clock3, ShieldAlert, Check, ChevronDown } from 'lucide-react'
import { useStore } from '../app/Store'
import { plans, planExercises } from '../domain/catalog'
import { Field } from '../components/UI'
import { localDate } from '../domain/dates'
import { workoutSchema } from '../domain/model'
export default function Workout() {
  const { id } = useParams(),
    plan = plans.find((p) => p.id === id),
    navigate = useNavigate(),
    { data, commit, busy, cloud } = useStore()
  const [active, setActive] = useState(false),
    [feedback, setFeedback] = useState(false),
    [discomfort, setDiscomfort] = useState(false),
    [started, setStarted] = useState(0),
    [logId, setLogId] = useState(''),
    [seconds, setSeconds] = useState(0),
    [difficulty, setDifficulty] = useState(5),
    [feeling, setFeeling] = useState(''),
    [error, setError] = useState(''),
    [actual, setActual] = useState<
      Record<string, { done: boolean; sets: number; reps: number; load: number }>
    >({})
  useEffect(() => {
    if (!active || feedback || discomfort) return
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    )
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('beforeunload', warn)
    }
  }, [active, feedback, discomfort, started])
  if (!plan)
    return (
      <div className="empty-state">
        <h1>没有找到这份训练</h1>
        <Link className="button primary" to="/training">
          返回训练
        </Link>
      </div>
    )
  const items = planExercises(plan),
    completed = Object.values(actual).filter((v) => v.done).length
  function begin() {
    if (!plan) return
    setActual(
      Object.fromEntries(
        items.map((item) => [item.id, { done: false, sets: item.sets, reps: item.reps, load: 0 }]),
      ),
    )
    setStarted(Date.now())
    setLogId(crypto.randomUUID())
    setActive(true)
  }
  async function save() {
    if (!plan) return
    const parsed = workoutSchema.safeParse({
      id: logId,
      date: localDate(new Date(started)),
      planId: plan.id,
      title: plan.title,
      minutes: Math.round((seconds / 60) * 10) / 10,
      difficulty,
      discomfort,
      feeling,
      createdAt: new Date(started).toISOString(),
      exercises: items.map((item) => ({
        id: item.id,
        name: item.name,
        sets: actual[item.id]?.done ? actual[item.id].sets : 0,
        reps: actual[item.id]?.done ? actual[item.id].reps : 0,
        load: actual[item.id]?.done ? (actual[item.id]?.load ?? 0) : 0,
      })),
    })
    if (!parsed.success) {
      setError('请检查实际组数、次数和重量：需要填写范围内的数字。')
      return
    }
    if (!discomfort && !completed) {
      setError('请至少勾选一个完成的动作，或选择因不适停止；未完成的训练不会记为完成。')
      return
    }
    if (await commit({ kind: 'workout', value: parsed.data })) navigate('/records')
    else setError('训练记录未获保存确认，反馈已保留。')
  }
  return (
    <>
      <Link to="/training" className="back-link">
        <ArrowLeft size={17} />
        返回训练
      </Link>
      <header className="workout-heading">
        <h1>{plan.title}</h1>
        <p>{plan.description}</p>
        <div className="inline-meta">
          <span>
            <Clock3 size={16} />
            {plan.minutes} 分钟 · 模板示例
          </span>
          <span>{items.length} 个动作</span>
          <span>{plan.equipment}</span>
        </div>
      </header>
      {!active ? (
        <>
          <div className="notice-panel">
            <ShieldAlert size={21} />
            <p>
              此流程用于演示，不代表适合你的训练处方。开始实际运动前，请先确认身体限制及动作适用性；不适时停止。
            </p>
          </div>
          {data.profile.restrictions.trim() ? (
            <div className="error-banner">
              档案中有身体限制：{data.profile.restrictions}。本版本不提供适配或安全性判断。
            </div>
          ) : null}
          <button className="button primary" onClick={begin}>
            <Play size={17} />
            开始体验训练
          </button>
        </>
      ) : (
        <div className="session-bar">
          <div>
            <span>本次练习</span>
            <strong>
              {String(Math.floor(seconds / 60)).padStart(2, '0')}:
              {String(seconds % 60).padStart(2, '0')}
            </strong>
          </div>
          <span>
            {completed} / {items.length} 个动作
          </span>
          {!feedback && !discomfort ? (
            <button
              className="text-button danger"
              onClick={() => {
                setDiscomfort(true)
                setFeedback(true)
              }}
            >
              身体不适，停止训练
            </button>
          ) : null}
        </div>
      )}
      {active && !feedback && discomfort ? (
        <p className="error-banner" role="alert">
          训练已停止，计时已暂停。这里只修正记录，请勿继续运动。
        </p>
      ) : null}
      {active && !feedback ? (
        <p className="demo-caption">仅勾选实际完成的动作。离开此页面会丢失尚未保存的本次训练。</p>
      ) : null}
      {feedback ? (
        <section className="panel feedback">
          <h2>听一听身体的反馈</h2>
          {discomfort ? (
            <p className="error-banner" role="alert">
              请停止训练。若不适持续、明显或严重，请及时寻求医疗帮助。此记录会标记为「因不适停止」。
            </p>
          ) : null}
          <Field label={`本次难度：${difficulty} / 10`} hint="1 很轻松 · 10 非常吃力">
            <input
              type="range"
              min="1"
              max="10"
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
            />
          </Field>
          <label className="check-line">
            <input
              type="checkbox"
              checked={discomfort}
              onChange={(e) => setDiscomfort(e.target.checked)}
            />
            训练中有疼痛、头晕或其他不适
          </label>
          <Field label="训练后的感受">
            <textarea
              maxLength={500}
              rows={3}
              placeholder="记录精力、感受，或者今天的小发现……"
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
            />
          </Field>
          <p>
            实际计时 {Math.round((seconds / 60) * 10) / 10} 分钟 ·{' '}
            {completed === items.length
              ? '全部动作已勾选'
              : `已勾选 ${completed} 个动作，将保留实际完成情况。`}
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="actions">
            <button className="button primary" disabled={busy} onClick={save}>
              {busy ? '正在保存…' : cloud ? '保存共享训练记录' : '保存本机训练记录'}
            </button>
            <button className="button secondary" onClick={() => setFeedback(false)}>
              {discomfort ? '修正动作记录' : '继续填写动作'}
            </button>
          </div>
        </section>
      ) : (
        <section className="exercise-list" aria-label="动作列表">
          {items.map((item, index) => (
            <article key={item.id} className="exercise-row">
              <div className="exercise-main">
                <span className="exercise-number">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h2>{item.name}</h2>
                  <p>
                    {item.area} · {item.sets} 组 × {item.reps} 次 · 组间休息 {item.rest} 秒
                  </p>
                </div>
                {active ? (
                  <label className="completion-check">
                    <input
                      type="checkbox"
                      aria-label={`${item.name}已完成`}
                      checked={actual[item.id]?.done ?? false}
                      onChange={(e) =>
                        setActual({
                          ...actual,
                          [item.id]: { ...actual[item.id], done: e.target.checked },
                        })
                      }
                    />
                    <Check size={18} />
                  </label>
                ) : null}
              </div>
              {active ? (
                <div className="actual-fields">
                  {(['sets', 'reps', 'load'] as const).map((key, i) => (
                    <Field key={key} label={['实际组数', '每组次数', '重量（kg）'][i]}>
                      <input
                        type="number"
                        min="0"
                        max={key === 'sets' ? 10 : key === 'reps' ? 100 : 200}
                        step={key === 'load' ? 0.5 : 1}
                        value={
                          Number.isNaN(actual[item.id]?.[key]) ? '' : (actual[item.id]?.[key] ?? 0)
                        }
                        onChange={(e) =>
                          setActual({
                            ...actual,
                            [item.id]: {
                              ...actual[item.id],
                              [key]: e.target.value === '' ? NaN : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              ) : null}
              <details>
                <summary>
                  动作说明与注意事项
                  <ChevronDown size={15} />
                </summary>
                <ol>
                  {item.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p>{item.note}</p>
                <p>
                  <strong>替代动作示例：</strong>
                  {item.alternative}（不自动替换，需先确认适用性）
                </p>
              </details>
            </article>
          ))}
        </section>
      )}
      {active && !feedback ? (
        <button className="button primary full-button" onClick={() => setFeedback(true)}>
          {discomfort ? '返回训练反馈' : '结束并填写反馈'}
          <ArrowLeft className="rotate-arrow" size={17} />
        </button>
      ) : null}
      <p className="demo-caption">
        示例动作组数与次数仅用于测试页面流程。不会自动调整计划或增加负荷。
      </p>
    </>
  )
}
