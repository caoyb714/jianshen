import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 会话访问的最小接口。
 *
 * 为什么单独一个模块：AI 代理需要带上「我是谁」的凭证，但训练页不该直接
 * 依赖 CloudGate（会形成循环引用），也不该在演示模式下被迫引入 supabase 客户端。
 */
let client: SupabaseClient | undefined

export function setSupabaseClient(next: SupabaseClient | undefined): void {
  client = next
}

/** 演示模式或未登录时返回 null，调用方按「没有凭证」处理即可 */
export async function accessToken(): Promise<string | null> {
  if (!client) return null
  const { data } = await client.auth.getSession()
  return data.session?.access_token ?? null
}
