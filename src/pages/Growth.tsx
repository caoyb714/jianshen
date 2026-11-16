import { useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Sprout, Clock3, Moon, Dumbbell } from 'lucide-react'
import { useProfile } from '../app/Store'
import { PageHeading, EmptyState, SectionHeading } from '../components/UI'
import { summarize, weekProgress } from '../domain/stats'
import { displayDate } from '../domain/dates'
export default function Growth() {
  const { active, profile, today, cloud, data } = useProfile(),
    [days, setDays] = useState(7),
    [view, setView] = useState<'minutes' | 'sleep' | 'energy'>('minutes'),
    summary = summarize(active, days, new Date(`${today}T12:00:00`)),
    week = weekProgress(active, new Date(`${today}T12:00:00`)),
    target = active.plan?.days.filter((day) => day.kind === '训练').length ?? profile.weeklyDays
  const labels = { minutes: '运动分钟', sleep: '睡眠小时', energy: '精力评分' },
    colors = { minutes: '#A45C75', sleep: '#83749E', energy: '#6B876D' }
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
            {(['minutes', 'sleep', 'energy'] as const).map((key) => (
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
            <AreaChart data={summary.series} margin={{ top: 12, right: 15, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#EDE5E7" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#73636D', fontSize: 12 }}
                minTickGap={28}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#73636D', fontSize: 12 }}
                domain={view === 'energy' ? [0, 5] : [0, 'auto']}
              />
              <Tooltip
                contentStyle={{ border: '1px solid #E7DADF', borderRadius: 12, color: '#494047' }}
                formatter={(value) => [value, labels[view]]}
              />
              <Area
                type="monotone"
                dataKey={view}
                stroke={colors[view]}
                fill={view === 'minutes' ? '#F4E1E7' : view === 'sleep' ? '#ECE7F4' : '#E2EDE3'}
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
