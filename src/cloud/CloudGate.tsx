import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { Field } from '../components/UI'
import type { CloudConfig } from './config'
import { CloudWorkspace } from './CloudWorkspace'
import { setSupabaseClient } from './session'
import { CloudCard } from './CloudCard'

let browserClient: SupabaseClient | undefined
function getClient(config: Extract<CloudConfig, { mode: 'cloud' }>) {
  browserClient ??= createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // 用 localStorage：手机从主屏幕打开 PWA 时 sessionStorage 会被清空，
      // 等于每次都要重输密码。这是两台私人手机，不是共享设备。
      storage: window.localStorage,
    },
    global: {
      fetch: async (input, init) => {
        const controller = new AbortController()
        const signal = init?.signal
        const abort = () => controller.abort()
        if (signal?.aborted) abort()
        else signal?.addEventListener('abort', abort, { once: true })
        const timeout = window.setTimeout(abort, 12000)
        try {
          return await fetch(input, { ...init, signal: controller.signal })
        } finally {
          window.clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
        }
      },
    },
  })
  return browserClient
}

export default function CloudGate({
  config,
  children,
}: {
  config: Extract<CloudConfig, { mode: 'cloud' }>
  children: ReactNode
}) {
  const client = getClient(config)
  // 交给独立的会话模块：训练页请求 AI 时要取 access token
  setSupabaseClient(client)
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setLeaving(false)
        setPassword('')
      }
    })
    return () => subscription.unsubscribe()
  }, [client])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setMessage('')
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (error)
        setMessage(
          error.status === 429
            ? '尝试次数较多，请稍后再试。'
            : '无法登录，请检查网络、邮箱和密码，或联系空间管理员。',
        )
      else setPassword('')
    } catch {
      setMessage('无法连接认证服务，请检查网络后重试。')
    } finally {
      setPending(false)
    }
  }
  const signOut = useCallback(async () => {
    setLeaving(true)
    setMessage('')
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw error
      setSession(null)
    } catch {
      setMessage('退出未获确认，请检查网络并重试。')
    } finally {
      setPending(false)
    }
  }, [client])

  if (leaving)
    return (
      <CloudCard title="正在退出">
        <p role="status">{message || '正在清理当前会话…'}</p>
        {message ? (
          <button className="button secondary" onClick={() => void signOut()}>
            重试退出
          </button>
        ) : null}
      </CloudCard>
    )
  if (session === undefined)
    return (
      <CloudCard title="正在确认登录状态">
        <p role="status">请稍候…</p>
      </CloudCard>
    )
  if (session)
    return (
      <CloudWorkspace
        key={session.user.id}
        client={client}
        account={session.user.email ?? ''}
        viewerId={session.user.id}
        signOut={signOut}
      >
        {children}
      </CloudWorkspace>
    )
  return (
    <CloudCard title="登录共享空间">
      <p>使用空间管理员为你开通的账号。</p>
      <form onSubmit={signIn}>
        <Field label="邮箱">
          <input
            type="email"
            autoComplete="username"
            value={email}
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="密码">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {message ? (
          <p className="form-error" role="alert">
            {message}
          </p>
        ) : null}
        <button className="button primary full-button" disabled={pending}>
          {pending ? '正在登录…' : '登录'}
        </button>
      </form>
    </CloudCard>
  )
}
