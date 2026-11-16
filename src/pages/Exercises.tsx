import { useMemo, useState } from 'react'
import { ChevronDown, Info, Search } from 'lucide-react'
import { PageHeading, Field, EmptyState } from '../components/UI'
import { useProfile } from '../app/Store'
import {
  exercises,
  getExercise,
  isAvailable,
  LIBRARY_REVIEWED,
  patternOrder,
  type Equipment,
  type Pattern,
} from '../domain/exercises'

const EQUIPMENT: Array<Equipment | '全部'> = ['全部', '徒手', '哑铃', '弹力带']

export default function Exercises() {
  const { profile } = useProfile()
  const [pattern, setPattern] = useState<Pattern | '全部'>('全部')
  const [equipment, setEquipment] = useState<Equipment | '全部'>('全部')
  const [keyword, setKeyword] = useState('')
  const [onlyMine, setOnlyMine] = useState(true)

  const shown = useMemo(() => {
    const text = keyword.trim()
    return exercises
      .filter((item) => pattern === '全部' || item.pattern === pattern)
      .filter((item) => equipment === '全部' || item.equipment === equipment)
      .filter((item) => (onlyMine ? isAvailable(item, profile.equipment) : true))
      .filter(
        (item) =>
          text === '' ||
          item.name.includes(text) ||
          item.primary.some((muscle) => muscle.includes(text)),
      )
      .sort((a, b) => patternOrder.indexOf(a.pattern) - patternOrder.indexOf(b.pattern))
  }, [pattern, equipment, keyword, onlyMine, profile.equipment])

  return (
    <>
      <PageHeading title="动作库" description="全部为家中可完成的动作：徒手、哑铃、弹力带。" />

      <div className="panel">
        <Field label="搜索">
          <div className="search-line">
            <Search size={16} />
            <input
              type="search"
              placeholder="动作名或部位，例如「臀」「划船」"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
        </Field>
        <div className="section-heading">
          <h2>动作模式</h2>
        </div>
        <div className="segmented wrap" aria-label="动作模式">
          {(['全部', ...patternOrder] as const).map((item) => (
            <button
              key={item}
              aria-pressed={pattern === item}
              onClick={() => setPattern(item as Pattern | '全部')}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="segmented wrap" aria-label="器械">
          {EQUIPMENT.map((item) => (
            <button key={item} aria-pressed={equipment === item} onClick={() => setEquipment(item)}>
              {item}
            </button>
          ))}
        </div>
        <label className="check-line">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(event) => setOnlyMine(event.target.checked)}
          />
          只看我的器械能完成的动作
        </label>
        <p className="small-muted">共 {shown.length} 个动作。</p>
      </div>

      {shown.length ? (
        <div className="lib-grid">
          {shown.map((item) => (
            <article className="lib-card" key={item.id}>
              <header>
                <h2>{item.name}</h2>
                <span className="status-chip">{item.pattern}</span>
              </header>
              <p className="lib-tags">
                {item.equipment} · {item.level} · 主要 {item.primary.join('、')}
                {item.unilateral ? ' · 单侧' : ''}
              </p>
              <details>
                <summary>
                  动作步骤与要点
                  <ChevronDown size={15} />
                </summary>
                <ol>
                  {item.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p>
                  <strong>要点：</strong>
                  {item.cues.join('；')}
                </p>
                <p>
                  <strong>常见误差：</strong>
                  {item.errors.join('；')}
                </p>
                <p>
                  <strong>注意：</strong>
                  {item.cautions.join('；')}
                </p>
                <p>
                  <strong>替代动作：</strong>
                  {item.alternatives
                    .map((id) => getExercise(id)?.name)
                    .filter(Boolean)
                    .join('、')}
                </p>
                <p className="small-muted">
                  {item.dose.type === 'reps'
                    ? `建议 ${item.dose.min}–${item.dose.max} 次`
                    : item.dose.type === 'hold'
                      ? `建议保持 ${item.dose.seconds} 秒`
                      : `建议 ${item.dose.minMinutes}–${item.dose.maxMinutes} 分钟`}
                  {` · 组间休息 ${item.restSeconds} 秒`}
                </p>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="没有匹配的动作" description="换个关键词，或关掉器械过滤。" />
      )}

      <div className="notice-panel">
        <Info size={20} />
        <p>
          {LIBRARY_REVIEWED
            ? '动作内容已通过专业审核。'
            : '动作库内容由本项目自行撰写，参考公开基础运动资料，尚未经专业人员逐项审核，不构成训练处方。'}
        </p>
      </div>
    </>
  )
}
