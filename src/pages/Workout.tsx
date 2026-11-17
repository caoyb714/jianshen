import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Play,
  Repeat,
  ShieldAlert,
  Timer,
  X,
} from 'lucide-react'
import { useProfile } from '../app/Store'
import { readJson, removeKey, writeJson } from '../app/storage'
import { Field, Modal } from '../components/UI'
import { getExercise, isAvailable, loadHint, exercises } from '../domain/exercises'
import { suggest } from '../domain/engine'
import { historyFor } from '../domain/stats'
import { workoutSchema, type Performance, type SetRecord } from '../domain/model'
import { displayDate, weekdayIndex } from '../domain/dates'

type Draft = Performance

const DRAFT_KEY = 'herfit.workoutDraft.v1'

type StoredDraft = {
  profileId: string
  date: string
  planId: string
  planVersion: number
  logId: string
  startedAt: number
  difficulty: number
  feeling: string
  discomfort: boolean
  exercises: Draft[]
}

function readStoredDraft(): StoredDraft | null {
  const value = readJson<StoredDraft>(DRAFT_KEY)
  if (!value || !Array.isArray(value.exercises) || value.exercises.length === 0) return null
  const usable = value.exercises.every(
    (row) => row && typeof row.exerciseId === 'string' && Array.isArray(row.sets),
  )
  return usable ? value : null
}

function clearStoredDraft() {
  // 存储不可用时也静默跳过，不影响本次训练
  removeKey(DRAFT_KEY)
}

export default function Workout() {
  const { date = '' } = useParams()
  const { active, profile, commit, busy, cloud, notify } = useProfile()
  const navigate = useNavigate()
  const plan = active.plan
  const day = plan?.days[weekdayIndex(date)] ?? null

  // 只在首次渲染时读一次；档案、日期或计划版本不一致就丢弃旧草稿
  const [restored] = useState(() => {
    const stored = readStoredDraft()
    if (!stored || !plan || stored.profileId !== active.id || stored.date !== date) return null
    if (stored.planId !== plan.id || stored.planVersion !== plan.version) return null
    return stored
  })

  const [started, setStarted] = useState(Boolean(restored))
  const [startedAt, setStartedAt] = useState(restored?.startedAt ?? 0)
  const [seconds, setSeconds] = useState(
    restored ? Math.max(0, Math.floor((Date.now() - restored.startedAt) / 1000)) : 0,
  )
  const [logId, setLogId] = useState(restored?.logId ?? '')
  const [draft, setDraft] = useState<Draft[]>(restored?.exercises ?? [])
  const [difficulty, setDifficulty] = useState(restored?.difficulty ?? 5)
  const [feeling, setFeeling] = useState(restored?.feeling ?? '')
  const [discomfort, setDiscomfort] = useState(restored?.discomfort ?? false)
  const [discarding, setDiscarding] = useState(false)
  const [feedback, setFeedback] = useState(false)
  const [error, setError] = useState('')
  const [restUntil, setRestUntil] = useState(0)
  const [restTotal, setRestTotal] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [swapping, setSwapping] = useState<string | null>(null)

  useEffect(() => {
    if (!started || feedback) return
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
      setNow(Date.now())
    }, 1000)
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('beforeunload', warn)
    }
  }, [started, feedback, startedAt])

  // 训练中的每一步都落盘，切到别的 App 或锁屏后回来不会丢
  useEffect(() => {
    if (!started || !plan || !logId) return
    const value: StoredDraft = {
      profileId: active.id,
      date,
      planId: plan.id,
      planVersion: plan.version,
      logId,
      startedAt,
      difficulty,
      feeling,
      discomfort,
      exercises: draft,
    }
    // 隐私模式或存储已满时写入失败，界面照常工作
    writeJson(DRAFT_KEY, value)
  }, [
    started,
    plan,
    day,
    active.id,
    date,
    logId,
    startedAt,
    difficulty,
    feeling,
    discomfort,
    draft,
  ])

  const suggestions = useMemo(() => {
    const result: Record<string, ReturnType<typeof suggest>> = {}
    for (const row of draft) {
      const exercise = getExercise(row.exerciseId)
      if (!exercise || row.role === '放松') continue
      result[row.exerciseId] = suggest({
        exerciseId: row.exerciseId,
        targetRepsMax: row.targetReps ?? 10,
        equipment: exercise.equipment,
        currentLoad: row.sets[0]?.load ?? 0,
        history: historyFor(active.workouts, row.exerciseId),
      })
    }
    return result
  }, [draft, active.workouts])

  // 不复用 EmptyState：这里是整页占位，需要 <h1> 作为页面标题，
  // 而 EmptyState 固定渲染 <h3> 并要求 description，改用它会让标题层级和留白都变化
  if (!plan || !day)
    return (
      <div className="empty-state">
        <h1>今天没有安排训练</h1>
        <p>先生成一份计划，或在训练页查看本周安排。</p>
        <Link className="button primary" to="/training">
          返回训练
        </Link>
      </div>
    )

  function begin() {
    if (!day) return
    const items: Draft[] = day.slots.map((slot) => {
      const exercise = getExercise(slot.exerciseId)!
      const history = historyFor(active.workouts, slot.exerciseId, 1)
      const lastLoad = history[0]?.sets.at(-1)?.load ?? slot.startLoad
      const reps =
        slot.target.type === 'reps'
          ? slot.target.min
          : slot.target.type === 'hold'
            ? slot.target.seconds
            : 0
      return {
        exerciseId: slot.exerciseId,
        name: exercise.name,
        role: slot.role,
        plannedSets: slot.sets,
        targetReps: slot.target.type === 'reps' ? slot.target.min : null,
        targetSeconds: slot.target.type === 'hold' ? slot.target.seconds : null,
        replacedFrom: null,
        sets: Array.from({ length: slot.sets }, () => ({
          reps,
          load: exercise.equipment === '徒手' ? 0 : lastLoad,
          done: false,
        })),
      }
    })
    setDraft(items)
    setStartedAt(Date.now())
    setLogId(crypto.randomUUID())
    setStarted(true)
  }

  function toggleSet(exerciseId: string, index: number) {
    const row = draft.find((item) => item.exerciseId === exerciseId)
    if (!row) return
    const turningOn = !row.sets[index].done
    setDraft((rows) =>
      rows.map((item) =>
        item.exerciseId === exerciseId
          ? {
              ...item,
              sets: item.sets.map((set, i) => (i === index ? { ...set, done: !set.done } : set)),
            }
          : item,
      ),
    )
    if (turningOn) {
      const slot = day!.slots.find((item) => item.exerciseId === exerciseId)
      const rest = slot?.restSeconds ?? 60
      if (rest > 0) {
        setRestUntil(Date.now() + rest * 1000)
        setRestTotal(rest)
        setNow(Date.now())
      }
    }
  }

  function updateSet(exerciseId: string, index: number, patch: Partial<SetRecord>) {
    setDraft((rows) =>
      rows.map((row) =>
        row.exerciseId === exerciseId
          ? { ...row, sets: row.sets.map((set, i) => (i === index ? { ...set, ...patch } : set)) }
          : row,
      ),
    )
  }

  function swap(exerciseId: string, replacementId: string) {
    const replacement = getExercise(replacementId)
    if (!replacement) return
    setDraft((rows) =>
      rows.map((row) =>
        row.exerciseId === exerciseId
          ? {
              ...row,
              exerciseId: replacement.id,
              name: replacement.name,
              replacedFrom: row.replacedFrom ?? exerciseId,
              targetReps: replacement.dose.type === 'reps' ? replacement.dose.min : null,
              targetSeconds: replacement.dose.type === 'hold' ? replacement.dose.seconds : null,
              sets: row.sets.map((set) => ({ ...set, done: false })),
            }
          : row,
      ),
    )
    setSwapping(null)
    notify(`已替换为「${replacement.name}」，组次按新动作重置`)
  }

  const completed = draft.reduce(
    (sum, row) => sum + row.sets.filter((set) => set.done && set.reps > 0).length,
    0,
  )
  const planned = draft.reduce((sum, row) => sum + row.sets.length, 0)

  async function save() {
    if (!plan || !day) return
    const payload = {
      profileId: active.id,
      id: logId,
      date,
      planId: plan.id,
      planVersion: plan.version,
      title: day.focus,
      minutes: Math.round((seconds / 60) * 10) / 10,
      difficulty,
      discomfort,
      feeling,
      createdAt: new Date(startedAt).toISOString(),
      exercises: draft,
    }
    const parsed = workoutSchema.safeParse(payload)
    if (!parsed.success) {
      setError('请检查填写内容：次数需要是 0–100 的整数，负荷不超过 200。')
      return
    }
    if (!discomfort && completed === 0) {
      setError('请至少完成一组，或选择「身体不适，停止训练」。')
      return
    }
    if (await commit({ kind: 'workout', value: parsed.data })) {
      clearStoredDraft()
      navigate('/records')
    } else setError('训练记录未获保存确认，反馈与进度已保留。')
  }

  function discard() {
    clearStoredDraft()
    setStarted(false)
    setDraft([])
    setStartedAt(0)
    setSeconds(0)
    setLogId('')
    setDifficulty(5)
    setFeeling('')
    setDiscomfort(false)
    setFeedback(false)
    setError('')
    setDiscarding(false)
    notify('已放弃本次训练，未保存任何记录')
  }

  const restLeft = Math.max(0, Math.ceil((restUntil - now) / 1000))
  const swappingRow = swapping ? draft.find((row) => row.exerciseId === swapping) : undefined
  const swapPattern = swappingRow
    ? getExercise(swappingRow.replacedFrom ?? swappingRow.exerciseId)?.pattern
    : null
  const swapPool = swappingRow
    ? exercises
        .filter((item) => item.pattern === swapPattern)
        .filter((item) => isAvailable(item, profile.equipment))
        .filter((item) => !draft.some((row) => row.exerciseId === item.id))
        .slice(0, 8)
    : []

  return (
    <>
      <Link to="/training" className="back-link">
        <ArrowLeft size={17} />
        返回训练
      </Link>
      <header className="workout-heading">
        <h1>{day.focus}</h1>
        <p>
          {displayDate(date)} · {profile.name}
        </p>
        <div className="inline-meta">
          <span>
            <Clock3 size={16} />
            预计 {day.estimatedMinutes} 分钟 · 计划 v{plan.version}
          </span>
          <span>{draft.filter((row) => row.role === '主要').length} 个主要动作</span>
        </div>
      </header>

      {!started ? (
        <>
          <div className="notice-panel">
            <ShieldAlert size={21} />
            <p>{day.warmup || '先做几分钟轻活动，让身体热起来。'}</p>
          </div>
          {profile.restrictions.trim() ? (
            <div className="error-banner">
              档案中的身体限制：{profile.restrictions}。开始前请确认今天的动作是否适合。
            </div>
          ) : null}
          <button className="button primary" onClick={begin}>
            <Play size={17} />
            开始今天的训练
          </button>
          <p className="demo-caption">训练进度会自动保存在本机，中途离开或锁屏都不会丢。</p>
        </>
      ) : (
        <div className="session-bar">
          <div>
            <span>本次训练</span>
            <strong>
              {String(Math.floor(seconds / 60)).padStart(2, '0')}:
              {String(seconds % 60).padStart(2, '0')}
            </strong>
          </div>
          <span>
            {completed} / {planned} 组
          </span>
          {!feedback ? (
            <>
              <button
                className="text-button danger"
                onClick={() => {
                  setDiscomfort(true)
                  setFeedback(true)
                }}
              >
                身体不适，停止训练
              </button>
              <button className="text-button" onClick={() => setDiscarding(true)}>
                放弃本次
              </button>
            </>
          ) : null}
        </div>
      )}

      {restored && started && !feedback ? (
        <div className="notice-panel" role="status">
          <Clock3 size={18} />
          <p>
            已恢复上次未保存的训练（开始于{' '}
            {new Date(restored.startedAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            ）。
          </p>
        </div>
      ) : null}

      {restLeft > 0 && !feedback ? (
        <div className="rest-timer" role="status">
          <Timer size={18} />
          <span>
            组间休息 {restLeft} 秒 / 共 {restTotal} 秒
          </span>
          <button className="text-button" onClick={() => setRestUntil(0)}>
            <X size={15} /> 跳过
          </button>
        </div>
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
              onChange={(event) => setDifficulty(Number(event.target.value))}
            />
          </Field>
          <label className="check-line">
            <input
              type="checkbox"
              checked={discomfort}
              onChange={(event) => setDiscomfort(event.target.checked)}
            />
            训练中有疼痛、头晕或其他不适
          </label>
          <Field label="训练后的感受">
            <textarea
              maxLength={500}
              rows={3}
              placeholder="记录精力、感受，或者今天的小发现……"
              value={feeling}
              onChange={(event) => setFeeling(event.target.value)}
            />
          </Field>
          <p>
            实际计时 {Math.round((seconds / 60) * 10) / 10} 分钟 · 已完成 {completed} / {planned} 组
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="actions">
            <button className="button primary" disabled={busy} onClick={() => void save()}>
              {busy ? '正在保存…' : cloud ? '保存共享训练记录' : '保存本机训练记录'}
            </button>
            <button className="button secondary" onClick={() => setFeedback(false)}>
              继续记录
            </button>
          </div>
        </section>
      ) : started ? (
        <section className="exercise-list" aria-label="动作列表">
          {draft.map((row, index) => {
            const exercise = getExercise(row.exerciseId)
            if (!exercise) return null
            const hint = suggestions[row.exerciseId]
            return (
              <article key={`${row.exerciseId}-${index}`} className="exercise-row">
                <div className="exercise-main">
                  <span className="exercise-number">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h2>
                      {row.name}
                      {exercise.unilateral ? <em className="soft-label">单侧</em> : null}
                    </h2>
                    <p>
                      {exercise.pattern} · {row.plannedSets} 组
                      {row.targetReps ? ` × ${row.targetReps} 次` : ''}
                      {row.targetSeconds ? ` × ${row.targetSeconds} 秒` : ''}
                      {row.replacedFrom ? ' · 已替换' : ''}
                    </p>
                  </div>
                </div>
                <div className="set-grid">
                  {row.sets.map((set, i) => (
                    <div key={i} className={set.done ? 'set-cell done' : 'set-cell'}>
                      <button
                        className="completion-check"
                        aria-label={`${row.name} 第 ${i + 1} 组完成`}
                        aria-pressed={set.done}
                        onClick={() => toggleSet(row.exerciseId, i)}
                      >
                        <Check size={15} />
                      </button>
                      <label>
                        <span>{row.targetSeconds ? '秒' : '次'}</span>
                        <input
                          type="number"
                          min="0"
                          max={row.targetSeconds ? 600 : 100}
                          value={Number.isNaN(set.reps) ? '' : set.reps}
                          onChange={(event) =>
                            updateSet(row.exerciseId, i, {
                              reps: event.target.value === '' ? 0 : Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>{loadHint(exercise)}</span>
                        <input
                          type="number"
                          min="0"
                          max="200"
                          step="0.5"
                          value={Number.isNaN(set.load) ? '' : set.load}
                          onChange={(event) =>
                            updateSet(row.exerciseId, i, {
                              load: event.target.value === '' ? 0 : Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
                {hint && hint.kind !== 'collect' ? (
                  <p className="suggestion">
                    <Repeat size={14} /> {hint.reason}
                  </p>
                ) : null}
                <details>
                  <summary>
                    动作说明与注意事项
                    <ChevronDown size={15} />
                  </summary>
                  <ol>
                    {exercise.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <p>{exercise.cues.join('；')}</p>
                  <p>常见误差：{exercise.errors.join('；')}</p>
                  <p>{exercise.cautions.join('；')}</p>
                </details>
                {row.role === '主要' ? (
                  <button className="text-button" onClick={() => setSwapping(row.exerciseId)}>
                    <Repeat size={14} /> 换个动作
                  </button>
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      {started && !feedback ? (
        <button className="button primary full-button" onClick={() => setFeedback(true)}>
          结束并填写反馈
          <ArrowLeft className="rotate-arrow" size={17} />
        </button>
      ) : null}

      {discarding ? (
        <Modal title="放弃本次训练" onClose={() => setDiscarding(false)}>
          <p>已完成的组次会全部丢弃，不会保存任何记录。此操作无法撤销。</p>
          <div className="actions">
            <button className="button danger" onClick={discard}>
              确认放弃
            </button>
            <button className="button secondary" onClick={() => setDiscarding(false)}>
              继续训练
            </button>
          </div>
        </Modal>
      ) : null}

      {swapping && swappingRow ? (
        <Modal title={`替换「${swappingRow.name}」`} onClose={() => setSwapping(null)}>
          <p>同一动作模式、由你的器械可完成的替代动作。替换后组次按新动作重置。</p>
          {swapPool.length ? (
            <div className="check-group">
              {swapPool.map((item) => (
                <button
                  key={item.id}
                  className="button secondary"
                  onClick={() => swap(swappingRow.exerciseId, item.id)}
                >
                  {item.name} · {item.equipment} · {item.level}
                </button>
              ))}
            </div>
          ) : (
            <p>没有其他可用动作。</p>
          )}
        </Modal>
      ) : null}
    </>
  )
}
