import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Clock3, Dumbbell, Footprints, Leaf, Info } from 'lucide-react'
import { PageHeading, EmptyState } from '../components/UI'
import { plans } from '../domain/catalog'
export default function Training() {
  const [filter, setFilter] = useState('全部')
  const shown = plans.filter((p) => filter === '全部' || p.type === filter)
  return (
    <>
      <PageHeading title="把时间留给身体。" description="不必练得很满，找到舒服的节奏就好。" />
      <div className="training-lead">
        <div>
          <h2>从一场小小的练习开始</h2>
          <p>
            哑铃、弹力带，或只是你自己。
            <br />
            每一次愿意开始，都值得被看见。
          </p>
        </div>
        <img src="/images/wellbeing.png" alt="家中的温柔运动角落" />
      </div>
      <div className="section-heading">
        <h2>训练灵感</h2>
        <div className="segmented" aria-label="训练类别">
          {['全部', '力量', '有氧'].map((item) => (
            <button key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="plan-grid">
        {shown.map((plan, index) => {
          const Icon = plan.type === '有氧' ? Footprints : index === 2 ? Leaf : Dumbbell
          return (
            <Link to={`/training/${plan.id}`} className={`plan-card ${plan.color}`} key={plan.id}>
              <div className="plan-top">
                <Icon size={32} strokeWidth={1.3} />
                <span className="plan-type">{plan.type}</span>
                <ArrowUpRight size={21} />
              </div>
              <h2>{plan.title}</h2>
              <p>{plan.description}</p>
              <div className="plan-meta">
                <span>
                  <Clock3 size={15} />
                  {plan.minutes} 分钟 · 示例时长
                </span>
                <span>{plan.equipment}</span>
              </div>
            </Link>
          )
        })}
      </div>
      {!shown.length ? <EmptyState title="这里还没有训练" description="试试其他分类。" /> : null}
      <div className="notice-panel">
        <Info size={20} />
        <p>
          这些是用于体验操作的示例模板，尚未经过专业审核，也未根据你的身体限制生成。正式个性化计划会在后续版本加入。
        </p>
      </div>
    </>
  )
}
