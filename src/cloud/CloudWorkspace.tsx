import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { StoreContext } from '../app/Store'
import { ProfileEditor } from '../components/ProfileForm'
import { localDate } from '../domain/dates'
import { emptyHabit } from '../domain/seed'
import type { Change } from '../domain/change'
import type { Habit } from '../domain/model'
import { CloudError, createRepository, toAppData, type Snapshot } from './repository'
import { CloudCard } from './CloudCard'

type Props = {
  client: SupabaseClient
  account: string
  signOut: () => Promise<void>
  children: ReactNode
}
export function CloudWorkspace({ client, account, signOut, children }: Props) {
  const repository = useMemo(() => createRepository(client), [client])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, notify] = useState('')
  const [busy, setBusy] = useState(false)
  const [today, setToday] = useState(localDate)
  const current = useRef<Snapshot | null>(null)
  const request = useRef(0)
  const inFlight = useRef<'read' | 'write' | null>(null)
  const keep = useCallback((next: Snapshot | null) => {
    current.current = next
    setSnapshot(next)
  }, [])

  const refresh = useCallback(async () => {
    setToday(localDate())
    if (inFlight.current) return
    inFlight.current = 'read'
    const id = ++request.current
    try {
      const fresh = await repository.load()
      if (id !== request.current) return
      keep(fresh)
      setError(null)
    } catch (failure) {
      if (id !== request.current) return
      if (failure instanceof CloudError && failure.kind === 'denied') {
        keep(null)
        setError('当前账号无法访问此共享空间，请联系空间管理员。')
      } else if (failure instanceof CloudError && failure.kind === 'invalid') {
        keep(null)
        setError('共享数据格式与当前版本不匹配，请联系空间管理员。')
      } else {
        setError('暂时无法读取最新共享记录，请检查网络后重试。')
      }
    } finally {
      if (id === request.current) inFlight.current = null
    }
  }, [repository, keep])

  useEffect(() => {
    void refresh()
    const fromForeground = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(fromForeground, 20000)
    window.addEventListener('focus', fromForeground)
    window.addEventListener('online', fromForeground)
    document.addEventListener('visibilitychange', fromForeground)
    return () => {
      ++request.current
      inFlight.current = null
      window.clearInterval(interval)
      window.removeEventListener('focus', fromForeground)
      window.removeEventListener('online', fromForeground)
      document.removeEventListener('visibilitychange', fromForeground)
    }
  }, [refresh])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => notify(''), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function commit(change: Change, formRevision?: number) {
    if (!navigator.onLine) {
      notify('当前离线，未保存。请联网后再试。')
      return false
    }
    if (inFlight.current === 'write' || !current.current) return false
    inFlight.current = 'write'
    const id = ++request.current
    setBusy(true)
    notify('')
    try {
      const fresh = await repository.save(current.current, change, formRevision)
      if (id !== request.current) return false
      keep(fresh)
      setError(null)
      notify('已保存到共享空间')
      return true
    } catch (failure) {
      if (id !== request.current) return false
      if (failure instanceof CloudError && failure.kind === 'denied') {
        keep(null)
        setError('当前账号无法访问此共享空间，请联系空间管理员。')
      } else if (failure instanceof CloudError && failure.kind === 'conflict') {
        notify('记录已在另一处修改。请查看最新记录后再保存档案或数据。')
        inFlight.current = null
        await refresh()
        setBusy(false)
      } else if (failure instanceof CloudError && failure.kind === 'invalid') {
        notify('数据未获确认，请检查输入并刷新共享记录。')
      } else {
        notify('保存结果未获确认。请先刷新共享记录，再决定是否重试。')
      }
      return false
    } finally {
      if (id === request.current) {
        inFlight.current = null
        setBusy(false)
      }
    }
  }

  function ensureToday() {
    const date = localDate()
    if (date === today) return true
    setToday(date)
    notify('日期已变化，请重新确认今天的记录。')
    return false
  }
  async function setHabit(patch: Partial<Habit>) {
    if (!ensureToday()) return false
    const habit =
      current.current?.habits.find((row) => row.value.date === today)?.value ?? emptyHabit(today)
    return commit({ kind: 'habit', value: { ...habit, ...patch, date: today } })
  }
  async function adjustWater(delta: number) {
    const date = localDate()
    setToday(date)
    const habit =
      current.current?.habits.find((row) => row.value.date === date)?.value ?? emptyHabit(date)
    return commit({
      kind: 'habit',
      value: { ...habit, water: Math.max(0, Math.min(10000, habit.water + delta)) },
    })
  }

  if (!snapshot)
    return (
      <CloudCard title="共享空间">
        <p role={error ? 'alert' : 'status'}>{error ?? '正在读取共享空间…'}</p>
        <div className="actions">
          {error ? (
            <button className="button primary" onClick={() => void refresh()}>
              重新读取
            </button>
          ) : null}
          <button className="button secondary" onClick={() => void signOut()}>
            退出登录
          </button>
        </div>
      </CloudCard>
    )
  const data = toAppData(snapshot)
  if (!data)
    return (
      <CloudCard title="建立共享健康档案">
        <p>这份档案由两位空间成员共同查看和编辑。请在档案本人同意后填写。</p>
        <ProfileEditor
          cloud
          onSubmit={(profile) =>
            commit({ kind: 'profile', value: profile }, snapshot.profile.revision)
          }
        />
        {notice ? <p role="status">{notice}</p> : null}
        <button className="button secondary" onClick={() => void signOut()}>
          退出登录
        </button>
      </CloudCard>
    )
  return (
    <StoreContext.Provider
      value={{
        data,
        today,
        error,
        notice,
        commit,
        setHabit,
        adjustWater,
        ensureToday,
        busy,
        notify,
        cloud: { snapshot, account, refresh, signOut },
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}
