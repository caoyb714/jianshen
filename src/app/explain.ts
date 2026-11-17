import type { ExplainPayload } from '../domain/ai'

export type ExplainResponse = { ok: true; text: string } | { ok: false; reason: string }

/** 15 秒比服务端的 12 秒多留余量：先让服务端超时，前端拿到的是可判定的失败。 */
const TIMEOUT_MS = 15000

/**
 * 请求同源的 /api/explain。
 *
 * 说明只是锦上添花：任何异常都收敛成 { ok: false }，由界面静默降级。
 * 请求体不打印到 console——里面是用户档案摘要。
 */
export async function requestExplain(payload: ExplainPayload): Promise<ExplainResponse> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    // 405/500/网关错误都属于"暂时不可用"，不把状态码暴露到界面
    if (!response.ok) return { ok: false, reason: 'network' }

    const body: unknown = await response.json()
    if (!body || typeof body !== 'object') return { ok: false, reason: 'invalid' }
    const result = body as { ok?: unknown; text?: unknown; reason?: unknown }
    if (result.ok === true && typeof result.text === 'string')
      return { ok: true, text: result.text }
    return { ok: false, reason: typeof result.reason === 'string' ? result.reason : 'invalid' }
  } catch {
    // 网络失败、超时中断、JSON 损坏走同一条降级路径
    return { ok: false, reason: 'network' }
  } finally {
    window.clearTimeout(timer)
  }
}
