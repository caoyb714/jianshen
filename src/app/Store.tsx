import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { localDate } from '../domain/dates'
import { loadData, saveData, STORAGE_KEY } from '../domain/repository'
import { emptyHabit } from '../domain/seed'
import type { AppData, Habit } from '../domain/model'
import { applyChange, type Change } from '../domain/change'
import type { Snapshot } from '../cloud/repository'

type Store = {
  data: AppData
  today: string
  error: string | null
  notice: string
  commit: (change: Change, formRevision?: number) => Promise<boolean>
  replace?: (data: AppData) => boolean
  setHabit: (patch: Partial<Habit>) => Promise<boolean>
  adjustWater: (delta: number) => Promise<boolean>
  ensureToday: () => boolean
  notify: (message: string) => void
  busy: boolean
  cloud?: {
    snapshot: Snapshot
    account: string
    refresh: () => Promise<void>
    signOut: () => Promise<void>
  }
}
export const StoreContext = createContext<Store | null>(null)
export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() =>
    loadData({
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    }),
  )
  const [data, setData] = useState(initial.data),
    current = useRef(data)
  const [error, setError] = useState(initial.error),
    [notice, notify] = useState(''),
    [today, setToday] = useState(localDate)
  useEffect(() => {
    const refresh = () => setToday(localDate())
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => notify(''), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return
      const next = loadData(localStorage)
      current.current = next.data
      setData(next.data)
      setError(next.error)
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])
  function replace(next: AppData) {
    try {
      saveData(localStorage, next)
      current.current = next
      setData(next)
      setError(null)
      notify('已保存到本机，未同步到云端')
      return true
    } catch {
      notify('保存失败：浏览器存储不可用或空间不足，请导出数据并检查设置。')
      return false
    }
  }
  async function commit(change: Change) {
    if (error) {
      notify('请先处理本机数据读取问题，再保存修改。')
      return false
    }
    return replace(applyChange(current.current, change))
  }
  function ensureToday() {
    const day = localDate()
    if (day === today) return true
    setToday(day)
    notify('日期已变化，已切换到今天，请重新确认填写内容。')
    return false
  }
  async function setHabit(patch: Partial<Habit>) {
    if (!ensureToday()) return false
    const habit = current.current.habits.find((h) => h.date === today) ?? emptyHabit(today)
    return commit({ kind: 'habit', value: { ...habit, ...patch, date: today } })
  }
  function adjustWater(delta: number) {
    const day = localDate()
    setToday(day)
    const habit = current.current.habits.find((h) => h.date === day) ?? emptyHabit(day)
    return commit({
      kind: 'habit',
      value: { ...habit, water: Math.max(0, Math.min(10000, habit.water + delta)) },
    })
  }
  return (
    <StoreContext.Provider
      value={{
        data,
        today,
        error,
        notice,
        commit,
        busy: false,
        replace,
        setHabit,
        adjustWater,
        ensureToday,
        notify,
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}
export function useStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('StoreProvider missing')
  return value
}
