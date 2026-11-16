import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  Droplet,
  Moon,
  NotebookPen,
  CalendarDays,
  ChevronRight,
  Leaf,
} from 'lucide-react'
import { useStore } from '../app/Store'
import { PageHeading, MoodPicker } from '../components/UI'
import { emptyHabit } from '../domain/seed'
import { weekDates } from '../domain/dates'
import { isComplete } from '../domain/stats'
export default function Home() {
  const { data, today, setHabit, adjustWater, busy, cloud } = useStore(),
    habit = data.habits.find((h) => h.date === today) ?? emptyHabit(today),
    dates = weekDates(new Date(`${today}T12:00:00`)),
    done = new Set(data.workouts.filter(isComplete).map((w) => w.date)),
    count = dates.filter((d) => done.has(d)).length
  return (
    <>
      <PageHeading title="慢慢来，也在变好。" description="照顾好身体，也照顾好自己。" />
      <section className="home-hero">
        <img
          src="/images/wellbeing.png"
          alt="淡紫瑜伽垫、粉色哑铃与一束绿枝"
          fetchPriority="high"
        />
        <div className="hero-copy">
          <h2>
            今天，给自己
            <br className="mobile-break" /> 25 分钟
          </h2>
          <p>舒展身体，让生活轻盈一点。</p>
          <Link className="button primary" to="/training/full">
            查看今日训练
            <ArrowRight size={18} />
          </Link>
          <span className="hero-footnote">全身力量 · 入门示例 · 自由调整节奏</span>
        </div>
      </section>
      <section className="week-strip" aria-label="本周训练">
        <div className="week-summary">
          <CalendarDays size={25} strokeWidth={1.5} />
          <div>
            <h2>本周运动日</h2>
            <span>
              <strong>{count}</strong> / {data.profile.weeklyDays} 天
            </span>
          </div>
          <Link to="/records" className="icon-button" aria-label="查看本周运动记录">
            <ChevronRight size={18} />
          </Link>
        </div>
        <div className="week-days">
          {dates.map((date, i) => (
            <div key={date} className={date === today ? 'today' : ''}>
              <span>周{['一', '二', '三', '四', '五', '六', '日'][i]}</span>
              <span className={done.has(date) ? 'day-dot complete' : 'day-dot'}>
                {done.has(date) ? <Check size={17} /> : Number(date.slice(8))}
              </span>
            </div>
          ))}
        </div>
      </section>
      <div className="habit-grid">
        <section className="habit-card sage">
          <Droplet size={29} strokeWidth={1.4} />
          <div>
            <h2>今日饮水</h2>
            <p className="metric" data-testid="water-total">
              {habit.water.toLocaleString()}
              <span> ml</span>
            </p>
            <small>按自己的需要，慢慢补充。</small>
          </div>
          <button
            className="outline-button"
            aria-label="记录 250 ml 饮水"
            disabled={busy || habit.water > 9750}
            onClick={() => adjustWater(250)}
          >
            +250 ml
          </button>
        </section>
        <Link to="/records#sleep" className="habit-card lavender">
          <Moon size={28} strokeWidth={1.4} />
          <div>
            <h2>昨晚睡眠</h2>
            <p className="metric">
              {habit.sleep ?? '—'}
              <span> 小时</span>
            </p>
            <small>{habit.sleep === null ? '留下一笔休息记录' : '好好休息，也是照顾自己。'}</small>
          </div>
          <ChevronRight size={19} />
        </Link>
      </div>
      <section className="journal">
        <div className="journal-intro">
          <NotebookPen size={27} strokeWidth={1.5} />
          <div>
            <h2>身心日记</h2>
            <p>
              记录今天的状态，
              <br />
              给自己一点关注。
            </p>
          </div>
        </div>
        <div className="journal-mood">
          <h3>今天的精力如何？</h3>
          <MoodPicker value={habit.energy} onChange={(energy) => setHabit({ energy })} />
        </div>
        <blockquote>
          “持续地好好照顾自己，
          <br />
          就是一种成长。”
          <Leaf size={27} strokeWidth={1.2} />
        </blockquote>
      </section>
      <p className="demo-caption">
        {cloud
          ? '健康记录保存在共享空间，训练模板仍供体验。'
          : '你正在体验虚构示例档案。修改只保存在当前浏览器，可在「我的」中清空。'}
      </p>
    </>
  )
}
