import type { BasisPayload } from '../domain/ai'

export type BasisResponse =
  { ok: true; texts: Record<string, string> } | { ok: false; reason: string }

/** 18 秒：条目化要生成多条，比整段说明多留一点余量，仍短于用户的耐心。 */
const BASIS_TIMEOUT_MS = 18000

/**
 * 请求每条建议的「为什么」。
 *
 * 与整段说明不同，这里的失败不会让卡片变空：界面只用本地幅度渲染，
 * 缺的只是理由那一行，所以任何异常都收敛成 { ok: false }。
 */
export async function requestBasis(
  payload: BasisPayload,
  token?: string | null,
): Promise<BasisResponse> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), BASIS_TIMEOUT_MS)
  try {
    const response = await fetch('/api/explain', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 服务端会拿这个 token 去 Supabase 校验；没有就只能是匿名，会被拒
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, reason: 'network' }
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object') return { ok: false, reason: 'invalid' }
    const result = body as { ok?: unknown; items?: unknown; reason?: unknown }
    if (result.ok !== true) {
      return { ok: false, reason: typeof result.reason === 'string' ? result.reason : 'invalid' }
    }
    const texts: Record<string, string> = {}
    if (Array.isArray(result.items)) {
      for (const item of result.items) {
        if (!item || typeof item !== 'object') continue
        const row = item as { sig?: unknown; text?: unknown }
        if (typeof row.sig === 'string' && typeof row.text === 'string') texts[row.sig] = row.text
      }
    }
    return { ok: true, texts }
  } catch {
    return { ok: false, reason: 'network' }
  } finally {
    window.clearTimeout(timer)
  }
}
