import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ArrowUpRight, Frown, Meh, Smile, Laugh, X } from 'lucide-react'
import { Link } from 'react-router-dom'
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  )
}
export function SectionHeading({
  title,
  to,
  link = '查看全部',
}: {
  title: string
  to?: string
  link?: string
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {to ? (
        <Link to={to} className="text-link">
          {link}
          <ArrowUpRight size={16} />
        </Link>
      ) : null}
    </div>
  )
}
const moods = [
  { name: '很低', Icon: Frown },
  { name: '偏低', Icon: Frown },
  { name: '一般', Icon: Meh },
  { name: '不错', Icon: Smile },
  { name: '充沛', Icon: Laugh },
]
export function MoodPicker({
  value,
  onChange,
}: {
  value: number | null
  onChange: (v: number) => void
}) {
  return (
    <div className="mood-picker" role="group" aria-label="今日精力">
      {moods.map(({ name, Icon }, i) => (
        <button
          key={name}
          type="button"
          aria-pressed={value === i + 1}
          onClick={() => onChange(i + 1)}
        >
          <span className={value === i + 1 ? 'mood selected' : 'mood'}>
            <Icon size={27} strokeWidth={1.5} />
          </span>
          <span>{name}</span>
        </button>
      ))}
    </div>
  )
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId()
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  )
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  )
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  )
}
