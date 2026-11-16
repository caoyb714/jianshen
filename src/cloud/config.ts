export type CloudConfig = { mode: 'demo' } | { mode: 'cloud'; url: string; key: string }

export function resolveConfig(
  env: Record<string, string | undefined>,
  allowLocal: boolean,
): CloudConfig {
  const mode = env.VITE_HERFIT_MODE?.trim()
  const url = env.VITE_SUPABASE_URL?.trim()
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if ((!mode || mode === 'demo') && !url && !key) return { mode: 'demo' }
  if (mode !== 'cloud' || !url || !key) {
    throw new Error('云端模式需要配置 VITE_HERFIT_MODE、Supabase URL 和公开密钥。')
  }
  const endpoint = new URL(url)
  const loopback = allowLocal && ['localhost', '127.0.0.1'].includes(endpoint.hostname)
  if (
    endpoint.href !== endpoint.origin + '/' ||
    (endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:'))
  ) {
    throw new Error('请使用 Supabase 项目的 HTTPS 根地址。')
  }
  let localAnon = false
  if (loopback && !key.startsWith('sb_')) {
    try {
      localAnon =
        JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'
    } catch {
      localAnon = false
    }
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && !localAnon) {
    throw new Error('请使用 Supabase publishable key。')
  }
  return { mode, url: endpoint.origin, key }
}
