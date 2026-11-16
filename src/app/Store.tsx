import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { localDate } from '../domain/dates'
import { loadData, saveData, STORAGE_KEY } from '../domain/repository'
import { emptyHabit } from '../domain/seed'
import type { AppData, Habit, Metric, ProfileSlot, TrainingPlan, Workout } from '../domain/model'
import { applyChange, type Change } from '../domain/change'
import type { Snapshot } from '../cloud/repository'

export const ACTIVE_KEY = 'herfit.activeProfile'

/** 当前档案的派生视图：页面只读这里，不必自己按 profileId 过滤 */
export type ActiveProfile = {
  id: string
  slot: 1 | 2
  profile: ProfileSlot['profile']
  habits: Habit[]
  metrics: Metric[]
  workouts: Workout[]
  plan: TrainingPlan | null
}

type Store = {
  data: AppData
  profiles: ProfileSlot[]
  active: ActiveProfile
  switchProfile: (id: string) => Promise<boolean>
  today: string
  error: string | null
  notice: string
  commit: (change: Change, formRevision?: number) => Promise<boolean>
  replace?: (data: AppData) => boolean
  setHabit: (patch: Partial<Omit<Habit, 'profileId' | 'date'>>) => Promise<boolean>
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

export function selectActive(data: AppData, activeId: string): ActiveProfile {
  const slot = data.profiles.find((item) => item.id === activeId) ?? data.profiles[0]
  const id = slot.id
  return {
    id,
    slot: slot.slot,
    profile: slot.profile,
    habits: data.habits.filter((row) => row.profileId === id),
    metrics: data.metrics.filter((row) => row.profileId === id),
    workouts: data.workouts.filter((row) => row.profileId === id),
    plan: data.plans.find((row) => row.profileId === id && row.status === 'active') ?? null,
  }
}

function readActiveId(data: AppData): string {
  const stored = window.localStorage.getItem(ACTIVE_KEY)
  if (stored && data.profiles.some((item) => item.id === stored)) return stored
  return data.profiles[0].id
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() =>
    loadData({
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    }),
  )
  const [data, setData] = useState(initial.data)
  const [activeId, setActiveId] = useState(() => readActiveId(initial.data))
  const current = useRef(data)
  const [error, setError] = useState(initial.error)
  const [notice, notify] = useState('')
  const [today, setToday] = useState(localDate)

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
      setActiveId((id) =>
        next.data.profiles.some((item) => item.id === id) ? id : next.data.profiles[0].id,
      )
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
  async function switchProfile(id: string) {
    if (!current.current.profiles.some((item) => item.id === id)) return false
    setActiveId(id)
    window.localStorage.setItem(ACTIVE_KEY, id)
    return true
  }
  function ensureToday() {
    const day = localDate()
    if (day === today) return true
    setToday(day)
    notify('日期已变化，已切换到今天，请重新确认填写内容。')
    return false
  }
  async function setHabit(patch: Partial<Omit<Habit, 'profileId' | 'date'>>) {
    if (!ensureToday()) return false
    const habit =
      current.current.habits.find((row) => row.profileId === activeId && row.date === today) ??
      emptyHabit(activeId, today)
    return commit({ kind: 'habit', value: { ...habit, ...patch, date: today } })
  }
  function adjustWater(delta: number) {
    const day = localDate()
    setToday(day)
    const habit =
      current.current.habits.find((row) => row.profileId === activeId && row.date === day) ??
      emptyHabit(activeId, day)
    return commit({
      kind: 'habit',
      value: { ...habit, water: Math.max(0, Math.min(10000, habit.water + delta)) },
    })
  }
  const active = useMemo(() => selectActive(data, activeId), [data, activeId])

  return (
    <StoreContext.Provider
      value={{
        data,
        profiles: data.profiles,
        active,
        switchProfile,
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

/** 路由层已保证档案存在；此处集中做一次断言，避免每个页面重复判空 */
export function useProfile() {
  const store = useStore()
  if (!store.active.profile) throw new Error('当前档案尚未建立')
  return { ...store, profile: store.active.profile }
}
