import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts'
import { Sprout, Clock3, Moon, Dumbbell } from 'lucide-react'
import { useProfile } from '../app/Store'
import { PageHeading, EmptyState, SectionHeading } from '../components/UI'
import {
  exerciseProgress,
  metricSeries,
  summarize,
  weekProgress,
  weeklyReview,
} from '../domain/stats'
import { displayDate } from '../domain/dates'

/**
 * 三张图共用同一套网格、坐标轴与提示样式。
 * 抽成常量只为一处维护；取值与原写法逐字一致，确保视觉零变化。
 */
const CHART_MARGIN = { top: 12, right: 15, left: -20, bottom: 0 }
const GRID_PROPS = { strokeDasharray: '3 5', vertical: false, stroke: '#EDE5E7' }
const AXIS_TICK = { fill: '#73636D', fontSize: 12 }
const TOOLTIP_PROPS = {
  contentStyle: { border: '1px solid #E7DADF', borderRadius: 12, color: '#494047' },
}

export default function Growth() {
  const { active, profile, today, cloud, data } = useProfile(),
    [days, setDays] = useState(7),
    [view, setView] = useState<'minutes' | 'sleep' | 'water' | 'energy'>('minutes'),
    [bodyKey, setBodyKey] = useState<'weight' | 'waist' | 'hip'>('waist'),
    [focus, setFocus] = useState<string | null>(null),
    summary = summarize(active, days, new Date(`${today}T12:00:00`)),
    week = weekProgress(active, new Date(`${today}T12:00:00`)),
    // 复盘固定看最近 7 天，不跟随上方的 7/28 天切换
    week7 = summarize(active, 7, new Date(`${today}T12:00:00`)),
    target = active.plan?.days.filter((day) => day.kind === '训练').length ?? profile.weeklyDays,
    metricRows = useMemo(() => metricSeries(active.metrics), [active.metrics]),
    progress = useMemo(() => {
      const names = new Map<string, string>()
      for (const workout of active.workouts)
        for (const item of workout.exercises) names.set(item.exerciseId, item.name)
      return [...names.entries()]
        .map(([id, name]) => {
          const series = exerciseProgress(active.workouts, id)
          const delta = series.length >= 2 ? series.at(-1)!.topLoad - series[0].topLoad : 0
          return { id, name, series, delta }
        })
        .filter((item) => item.series.length >= 2)
        .sort(
          (a, b) =>
            b.series.reduce((sum, point) => sum + point.volume, 0) -
            a.series.reduce((sum, point) => sum + point.volume, 0),
        )
    }, [active.workouts]),
    currentExercise = progress.find((item) => item.id === focus) ?? progress[0] ?? null,
    review = weeklyReview({
      activeDays: week7.activeDays,
      targetDays: target,
      sessions: week7.sessions,
      minutes: week7.minutes,
      sleepAverage: week7.sleepAverage,
      waterAverage: (() => {
        const rows = week7.series.filter((point) => point.water > 0)
        return rows.length ? rows.reduce((sum, point) => sum + point.water, 0) / rows.length : null
      })(),
    }),
    // 徒手动作负荷恒为 0，此时改画完成次数
    exerciseUsesLoad = Boolean(currentExercise?.series.some((point) => point.topLoad > 0)),
    // 关闭体重显示后，即使之前选过体重也不画出来
    bodyLine = data.settings.showWeight || bodyKey !== 'weight' ? bodyKey : 'waist'
  const labels = { minutes: '运动分钟', sleep: '睡眠小时', water: '饮水毫升', energy: '精力评分' },
    colors = { minutes: '#A45C75', sleep: '#83749E', water: '#6B876D', energy: '#A98452' }
  return (
    <>
      <PageHeading
        title="每一点，都算进步。"
        description="变得更有力量、休息得更好，都是值得记录的变化。"
      >
        <div className="segmented">
          {[7, 28].map((n) => (
            <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>
              近 {n} 天
            </button>
          ))}
        </div>
      </PageHeading>
      <section className="panel review-panel">
        <h2>本周复盘</h2>
        <p>{review}</p>
      </section>
      <div className="growth-summary">
        <div>
          <Sprout size={25} />
          <span>完整训练</span>
          <strong>
            {summary.sessions}
            <small> 次</small>
          </strong>
        </div>
        <div>
          <Clock3 size={25} />
          <span>累计活动</span>
          <strong>
            {Math.round(summary.minutes * 10) / 10}
            <small> 分钟</small>
          </strong>
        </div>
        <div>
          <Moon size={25} />
          <span>平均睡眠</span>
          <strong>
            {summary.sleepAverage?.toFixed(1) ?? '—'}
            <small> 小时</small>
          </strong>
        </div>
        <div>
          <Dumbbell size={25} />
          <span>训练容量</span>
          <strong>
            {Math.round(summary.volume).toLocaleString()}
            <small> 次·kg</small>
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>本周完成情况</h2>
          <span className="soft-label">{profile.name}</span>
        </div>
        <p className="small-muted">
          本周已完成 <strong>{week.doneCount}</strong> / {target} 次计划训练。计划是起点，不是考核。
        </p>
        <div className="week-days">
          {week.perDay.map((day, index) => (
            <div key={day.date} className={day.date === today ? 'today' : ''}>
              <span>周{['一', '二', '三', '四', '五', '六', '日'][index]}</span>
              <span className={day.done ? 'day-dot complete' : 'day-dot'}>
                {day.done ? '✓' : Number(day.date.slice(8))}
              </span>
              <small>{day.minutes ? `${day.minutes}分` : ''}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="panel chart-panel">
        <div className="section-heading">
          <h2>属于你的节奏</h2>
          <div className="segmented">
            {(['minutes', 'sleep', 'water', 'energy'] as const).map((key) => (
              <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
                {labels[key]}
              </button>
            ))}
          </div>
        </div>
        <p className="small-muted">按日汇总 · 缺少睡眠和精力记录的日期保留空白</p>
        <div
          className="chart"
          role="img"
          aria-label={`近${days}天${labels[view]}趋势，下方可展开每日数值`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={summary.series} margin={CHART_MARGIN}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                minTickGap={28}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                domain={view === 'energy' ? [0, 5] : [0, 'auto']}
              />
              <Tooltip {...TOOLTIP_PROPS} formatter={(value) => [value, labels[view]]} />
              <Area
                type="monotone"
                dataKey={view}
                stroke={colors[view]}
                fill={
                  view === 'minutes'
                    ? '#F4E1E7'
                    : view === 'sleep'
                      ? '#ECE7F4'
                      : view === 'water'
                        ? '#E7F0E4'
                        : '#F6EEDF'
                }
                strokeWidth={2.5}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <details className="chart-data">
          <summary>查看每日数值</summary>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>运动（分）</th>
                  <th>睡眠（时）</th>
                  <th>精力（1–5）</th>
                </tr>
              </thead>
              <tbody>
                {summary.series.map((item) => (
                  <tr key={item.date}>
                    <td>{item.label}</td>
                    <td>{item.minutes}</td>
                    <td>{item.sleep ?? '未记录'}</td>
                    <td>{item.energy ?? '未记录'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <div className="growth-note">
        <Sprout size={26} strokeWidth={1.4} />
        <p>
          身体的变化，不只有数字。
          <br />
          <strong>愿意开始，也愿意休息，就是在好好照顾自己。</strong>
        </p>
      </div>
      <SectionHeading title="动作进步" />
      {progress.length ? (
        <section className="panel chart-panel">
          <div className="segmented wrap">
            {progress.map((item) => (
              <button
                key={item.id}
                aria-pressed={currentExercise?.id === item.id}
                onClick={() => setFocus(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          {currentExercise ? (
            <>
              <div className="section-heading">
                <h2>{currentExercise.name}</h2>
                <span className="soft-label">
                  {exerciseUsesLoad
                    ? `最大负荷 ${currentExercise.series.at(-1)?.topLoad ?? 0}${
                        currentExercise.delta !== 0
                          ? `（${currentExercise.delta > 0 ? '+' : ''}${currentExercise.delta}）`
                          : ''
                      }`
                    : `最近 ${currentExercise.series.at(-1)?.reps ?? 0} 次`}
                  {` · 容量 ${currentExercise.series.at(-1)?.volume ?? 0}`}
                </span>
              </div>
              <div className="chart" role="img" aria-label={`${currentExercise.name} 的负荷变化`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={currentExercise.series} margin={CHART_MARGIN}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={AXIS_TICK}
                      domain={[0, 'auto']}
                    />
                    <Tooltip {...TOOLTIP_PROPS} />
                    <Line
                      type="monotone"
                      dataKey={exerciseUsesLoad ? 'topLoad' : 'reps'}
                      name={exerciseUsesLoad ? '最大负荷' : '完成次数'}
                      stroke="#A45C75"
                      strokeWidth={2.5}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="small-muted">
                {exerciseUsesLoad
                  ? '曲线是该动作每次训练的最大负荷；容量 = 次数 × 负荷，显示在标题里。'
                  : '这个动作不使用负重，因此显示每次完成的次数。'}
                同一动作记录两次以上才会出现曲线。
              </p>
            </>
          ) : null}
        </section>
      ) : (
        <EmptyState
          title="还没有足够的动作记录"
          description="同一动作完成两次以上，这里会出现负荷与容量的变化曲线。"
        />
      )}

      <SectionHeading title="身体变化" />
      {metricRows.length ? (
        <section className="panel chart-panel">
          <div className="segmented">
            {(data.settings.showWeight
              ? (['weight', 'waist', 'hip'] as const)
              : (['waist', 'hip'] as const)
            ).map((key) => (
              <button key={key} aria-pressed={bodyKey === key} onClick={() => setBodyKey(key)}>
                {{ weight: '体重', waist: '腰围', hip: '臀围' }[key]}
              </button>
            ))}
          </div>
          <div className="chart" role="img" aria-label="身体指标变化">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metricRows} margin={CHART_MARGIN}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={AXIS_TICK}
                  domain={['auto', 'auto']}
                />
                <Tooltip {...TOOLTIP_PROPS} />
                <Line
                  type="monotone"
                  dataKey={bodyLine}
                  name={{ weight: '体重 kg', waist: '腰围 cm', hip: '臀围 cm' }[bodyLine]}
                  stroke="#A45C75"
                  strokeWidth={2.5}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="small-muted">体重是可选记录项。变化看趋势，不设目标、不判断好坏。</p>
        </section>
      ) : (
        <EmptyState
          title="还没有身体指标"
          description="在「记录」里填写腰围或体重后，这里会出现趋势。"
        />
      )}

      <SectionHeading title="身体记录" />
      {active.metrics.length ? (
        <div className="data-table panel">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                {data.settings.showWeight ? <th>体重（kg）</th> : null}
                <th>腰围（cm）</th>
                <th>臀围（cm）</th>
              </tr>
            </thead>
            <tbody>
              {[...active.metrics]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((item) => (
                  <tr key={item.id}>
                    <td>{displayDate(item.date)}</td>
                    {data.settings.showWeight ? <td>{item.weight ?? '—'}</td> : null}
                    <td>{item.waist ?? '—'}</td>
                    <td>{item.hip ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="身体记录还是空白" description="只记录你想了解的指标，不需要每天测量。" />
      )}
      <p className="demo-caption">
        {cloud
          ? '趋势按共享空间的已保存记录汇总。'
          : '趋势仅汇总当前浏览器中的记录。初始历史为虚构示例，不表示真实健康改善。'}
      </p>
    </>
  )
}
