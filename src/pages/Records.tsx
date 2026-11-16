import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Droplet, Moon, Activity, ArrowUpRight, Check, Dumbbell, ChevronDown } from 'lucide-react'
import { useProfile } from '../app/Store'
import { PageHeading, Field, MoodPicker, EmptyState, SectionHeading } from '../components/UI'
import { emptyHabit } from '../domain/seed'
import { metricSchema } from '../domain/model'
import { displayDate } from '../domain/dates'
import { isComplete } from '../domain/stats'
export default function Records() {
  const { active, today, setHabit, commit, adjustWater, ensureToday, busy, data } = useProfile(),
    habit = active.habits.find((h) => h.date === today) ?? emptyHabit(active.id, today)
  const [sleep, setSleep] = useState(String(habit.sleep ?? '')),
    [water, setWater] = useState('250'),
    [weight, setWeight] = useState(''),
    [waist, setWaist] = useState(''),
    [hip, setHip] = useState(''),
    [error, setError] = useState(''),
    [sleepError, setSleepError] = useState('')
  useEffect(() => {
    const current = active.habits.find((h) => h.date === today)
    setSleep(String(current?.sleep ?? ''))
    setWeight('')
    setWaist('')
    setHip('')
  }, [today])
  async function saveSleep() {
    const value = Number(sleep)
    if (!sleep.trim() || !Number.isFinite(value) || value < 0 || value > 24) {
      setSleepError('请填写 0–24 小时的睡眠时长。')
      return
    }
    if (await setHabit({ sleep: value })) setSleepError('')
    else setSleepError('睡眠记录未获保存确认，输入已保留。')
  }
  async function saveMetrics() {
    if (!ensureToday()) return
    const existing = active.metrics.find((m) => m.date === today)
    const result = metricSchema.safeParse({
      profileId: active.id,
      id: existing?.id ?? crypto.randomUUID(),
      date: today,
      weight: data.settings.showWeight
        ? weight.trim()
          ? Number(weight)
          : (existing?.weight ?? null)
        : (existing?.weight ?? null),
      waist: waist.trim() ? Number(waist) : (existing?.waist ?? null),
      hip: hip.trim() ? Number(hip) : (existing?.hip ?? null),
    })
    if ((!weight.trim() || !data.settings.showWeight) && !waist.trim() && !hip.trim()) {
      setError('至少填写一项自愿记录的身体指标。')
      return
    }
    if (!result.success) {
      setError('请检查数值：体重 20–400 kg，腰围和臀围 30–250 cm。')
      return
    }
    if (await commit({ kind: 'metric', value: result.data })) {
      setError('')
      setWeight('')
      setWaist('')
      setHip('')
    } else setError('身体记录未获保存确认，输入已保留。')
  }
  return (
    <>
      <PageHeading
        title="留住身体的小变化。"
        description="记录是为了更了解自己，不是为了给自己打分。"
      />
      <div className="record-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>
              <Droplet size={20} />
              今天喝水了吗？
            </h2>
            <span className="soft-label">{displayDate(today)}</span>
          </div>
          <p className="large-value">
            {habit.water.toLocaleString()}
            <span> ml</span>
          </p>
          <div className="actions">
            <Field label="本次饮水量（ml）">
              <select value={water} onChange={(e) => setWater(e.target.value)}>
                {[100, 200, 250, 500].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <button
              className="button secondary align-end"
              disabled={busy || habit.water + Number(water) > 10000}
              onClick={() => adjustWater(Number(water))}
            >
              记录饮水
            </button>
            <button
              className="text-button align-end"
              disabled={busy || habit.water === 0}
              onClick={() => adjustWater(-Number(water))}
            >
              减去一次
            </button>
          </div>
          <p className="small-muted">只记录实际饮水，不设统一的饮水目标。</p>
        </section>
        <section className="panel" id="sleep">
          <h2>
            <Moon size={20} />
            留一点时间，好好休息
          </h2>
          <div className="actions sleep-form">
            <Field label="昨晚睡眠（小时）">
              <input
                type="number"
                min="0"
                max="24"
                step="0.5"
                value={sleep}
                onChange={(e) => setSleep(e.target.value)}
                placeholder="例如 7.5"
              />
            </Field>
            <button className="button secondary align-end" disabled={busy} onClick={saveSleep}>
              保存睡眠
            </button>
          </div>
          {sleepError ? (
            <p className="form-error" role="alert">
              {sleepError}
            </p>
          ) : null}
          <p className="small-muted">
            按醒来的日期记录。已保存：{habit.sleep ?? '尚未记录'}
            {habit.sleep !== null ? ' 小时' : ''}
          </p>
        </section>
      </div>
      <section className="panel lifestyle">
        <div>
          <h2>今天的生活小记</h2>
          <p className="small-muted">吃好、睡好，也允许自己休息。</p>
          <MoodPicker value={habit.energy} onChange={(energy) => setHabit({ energy })} />
        </div>
        <div className="habit-checks">
          {(
            [
              { key: 'meals', title: '三餐相对规律', text: '记住好好吃饭' },
              { key: 'protein', title: '吃了蛋白质食物', text: '例如蛋、奶、豆类、鱼肉' },
              { key: 'plants', title: '吃了蔬菜和水果', text: '给餐桌多一点颜色' },
            ] as const
          ).map((item) => (
            <label className="habit-check" key={item.key}>
              <input
                type="checkbox"
                checked={habit[item.key]}
                onChange={(e) => setHabit({ [item.key]: e.target.checked })}
              />
              <span className="check-decoration">
                <Check size={15} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
            </label>
          ))}
        </div>
      </section>
      <section className="panel body-panel">
        <div className="section-heading">
          <h2>
            <Activity size={20} />
            身体指标，随心记录
          </h2>
          <span className="soft-label">全部选填</span>
        </div>
        <p className="small-muted">
          同一天再次保存会更新已填写的指标；空白项保持原记录。
          {data.settings.showWeight ? '' : '体重记录已隐藏，可在「我的」开启。'}
        </p>
        <div className="metric-form">
          {data.settings.showWeight ? (
            <Field label="体重（kg）">
              <input
                type="number"
                min="20"
                max="400"
                step="0.1"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="选填"
              />
            </Field>
          ) : null}
          <Field label="腰围（cm）">
            <input
              type="number"
              min="30"
              max="250"
              step="0.1"
              value={waist}
              onChange={(e) => setWaist(e.target.value)}
              placeholder="选填"
            />
          </Field>
          <Field label="臀围（cm）">
            <input
              type="number"
              min="30"
              max="250"
              step="0.1"
              value={hip}
              onChange={(e) => setHip(e.target.value)}
              placeholder="选填"
            />
          </Field>
          <button className="button secondary align-end" disabled={busy} onClick={saveMetrics}>
            保存身体记录
          </button>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <Link to="/growth" className="text-link">
          查看身体变化
          <ArrowUpRight size={15} />
        </Link>
      </section>
      <SectionHeading title="最近的运动时光" />
      <div className="history-list">
        {[...active.workouts]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 30)
          .map((log) => (
            <details className="history-row" key={log.id}>
              <summary>
                <span className="history-icon">
                  <Dumbbell size={21} />
                </span>
                <span>
                  <strong>{log.title}</strong>
                  <small>
                    {displayDate(log.date)} · {log.minutes} 分钟 · 难度 {log.difficulty}/10
                  </small>
                </span>
                <span className={log.discomfort ? 'status-chip warning' : 'status-chip'}>
                  {log.discomfort ? '因不适停止' : isComplete(log) ? '已完成' : '部分完成'}
                </span>
                <ChevronDown size={16} />
              </summary>
              <div className="history-detail">
                <p>{log.feeling || '没有填写感受。'}</p>
                {log.exercises.map((row) => {
                  const done = row.sets.filter((set) => set.done && set.reps > 0)
                  return (
                    <p key={`${row.exerciseId}-${row.name}`}>
                      {row.name}：
                      {done.length
                        ? `${done.length} 组 · ${done.map((set) => set.reps).join('/')} 次${
                            done.some((set) => set.load > 0)
                              ? ` · ${done.map((set) => set.load).join('/')}`
                              : ''
                          }`
                        : '未完成'}
                    </p>
                  )
                })}
              </div>
            </details>
          ))}
      </div>
      {active.workouts.length === 0 ? (
        <EmptyState title="还没有训练记录" description="不赶时间，从第一次小小的练习开始。">
          <Link className="button secondary" to="/training">
            查看训练计划
          </Link>
        </EmptyState>
      ) : null}
    </>
  )
}
