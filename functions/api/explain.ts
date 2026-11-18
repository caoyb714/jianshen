/**
 * DeepSeek「今日说明」代理（Cloudflare Pages Functions）。
 *
 * 为什么必须有这一层：DeepSeek 的 API Key 只能放在部署环境变量里，
 * 一旦进入前端产物就等于公开。前端只调用同源 /api/explain，
 * 所以 CSP 的 connect-src 'self' 已经覆盖，无需放宽任何策略。
 *
 * 这一层只负责转发与「减面」：不解析训练规则、不生成计划，
 * 最多把已校验的已知字段拼成一份清单交给模型解释。
 */

/** 只声明本函数真正读取的变量；缺失视为未配置，而不是运行错误。 */
type Env = { DEEPSEEK_API_KEY?: string }

/** 不引入 @cloudflare/workers-types，手写最小上下文，避免新增依赖。 */
type Context = { request: Request; env: Env }

/** 4 KB 上限：正常请求约 1 KB，超限基本可以判定为滥用。 */
const MAX_BODY_BYTES = 4096
/** 上游 12 秒兜底：宁可让界面静默降级，也不要让请求悬挂。 */
const UPSTREAM_TIMEOUT_MS = 12000
const MIN_TEXT_LENGTH = 20
const MAX_TEXT_LENGTH = 400
const UPSTREAM_URL = 'https://api.deepseek.com/chat/completions'

/** 滑动窗口与次数上限：只为降低误用成本，正常用户一分钟内不会重试五次以上。 */
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 5

/**
 * 尽力而为的进程内限流，**不是可靠防护**。
 *
 * Pages Functions 的 isolate 会随时回收，同一份 Map 不会在实例之间共享，
 * 冷启动后计数也会归零。它只能压住落在同一实例上的短时重复请求；
 * 真正可依赖的限流必须配置 Cloudflare 的 Rate Limiting 规则（或 WAF）。
 */
const recentHits = new Map<string, number[]>()

function isRateLimited(ip: string, now: number): boolean {
  // 每次先清理所有过期条目：Map 的键来自访问者，不清理会随人数无限增长
  for (const [key, times] of recentHits) {
    const alive = times.filter((at) => now - at < RATE_WINDOW_MS)
    if (alive.length === 0) recentHits.delete(key)
    else if (alive.length !== times.length) recentHits.set(key, alive)
  }
  const times = recentHits.get(ip) ?? []
  times.push(now)
  recentHits.set(ip, times)
  return times.length > RATE_LIMIT
}

/**
 * 这些约束是产品红线，不是提示词技巧：
 * 模型只解释已确定的计划，任何数字、动作、医疗建议都不允许由它产生。
 */
const SYSTEM_PROMPT = [
  '你只负责用平实的中文解释今天这份已经确定好的训练安排，不能修改它。',
  '不得新增、替换或删除任何动作，也不得改变组数、次数、时长、负荷等任何数字。',
  '不得给出医疗建议、诊断、用药建议，也不得给出减重目标、热量或饮食处方。',
  '如果用户信息中提到疼痛、头晕或身体不适，必须明确建议停止训练并及时就医。',
  '不得编造输入里没有的信息。',
  '输出 60–120 字中文纯文本，不使用 Markdown，不使用列表，不使用标题。',
].join('\n')

type IncomingSlot = { name: string; sets: number; target: string; role: '主要' | '放松' }

type Incoming = {
  profile: {
    age: number
    experience: string
    weeklyDays: number | null
    sessionMinutes: number | null
    equipment: string[]
    restrictions: string
    restrictionsConfirmed: boolean | null
  }
  day: { focus: string; estimatedMinutes: number | null; slots: IncomingSlot[] }
  recent: { workouts: number | null; minutes: number | null; avgDifficulty: number | null }
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * 所有字符串都先裁掉控制字符再截断：拼进 prompt 的内容可能来自公开请求，
 * 不能让换行或超长文本把系统约束挤出上下文。
 */
function clip(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max)
}

function integer(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}

function decimal(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, value))
}

/** 只读取下面列出的字段，其余一律忽略；任何不认识的字段都不会进入 prompt。 */
function validate(value: unknown): Incoming | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const profile = root.profile
  const day = root.day
  if (!profile || typeof profile !== 'object') return null
  if (!day || typeof day !== 'object') return null

  const p = profile as Record<string, unknown>
  const d = day as Record<string, unknown>
  if (typeof p.age !== 'number' || !Number.isFinite(p.age)) return null
  if (typeof p.experience !== 'string') return null
  if (typeof d.focus !== 'string') return null
  if (!Array.isArray(d.slots) || d.slots.length < 1 || d.slots.length > 12) return null

  const slots: IncomingSlot[] = []
  for (const item of d.slots) {
    if (!item || typeof item !== 'object') continue
    const slot = item as Record<string, unknown>
    slots.push({
      name: clip(typeof slot.name === 'string' ? slot.name : '未命名动作', 30),
      sets: integer(slot.sets, 1, 12) ?? 1,
      target: clip(typeof slot.target === 'string' ? slot.target : '按计划完成', 24),
      role: slot.role === '放松' ? '放松' : '主要',
    })
  }
  // 全部条目都不可用时没有可解释的内容，按坏请求处理
  if (slots.length === 0) return null

  const recentRaw = root.recent
  const r = recentRaw && typeof recentRaw === 'object' ? (recentRaw as Record<string, unknown>) : {}
  const equipment = Array.isArray(p.equipment)
    ? p.equipment
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 3)
        .map((item) => clip(item, 8))
    : []

  return {
    profile: {
      age: integer(p.age, 10, 110) ?? 0,
      experience: clip(p.experience, 12),
      weeklyDays: integer(p.weeklyDays, 1, 7),
      sessionMinutes: integer(p.sessionMinutes, 10, 120),
      equipment,
      restrictions: typeof p.restrictions === 'string' ? clip(p.restrictions, 80) : '',
      restrictionsConfirmed:
        typeof p.restrictionsConfirmed === 'boolean' ? p.restrictionsConfirmed : null,
    },
    day: {
      focus: clip(d.focus, 40),
      estimatedMinutes: integer(d.estimatedMinutes, 0, 240),
      slots,
    },
    recent: {
      workouts: integer(r.workouts, 0, 99),
      minutes: integer(r.minutes, 0, 10000),
      avgDifficulty: decimal(r.avgDifficulty, 0, 10),
    },
  }
}

function buildUserMessage(input: Incoming): string {
  const { profile, day, recent } = input
  const lines: string[] = []

  const facts = [`年龄 ${profile.age} 岁`, `经验 ${profile.experience}`]
  if (profile.weeklyDays !== null) facts.push(`每周 ${profile.weeklyDays} 天`)
  if (profile.sessionMinutes !== null) facts.push(`单次约 ${profile.sessionMinutes} 分钟`)
  if (profile.equipment.length) facts.push(`器械 ${profile.equipment.join('、')}`)
  if (profile.restrictions) {
    facts.push(
      `身体限制 ${profile.restrictions}${profile.restrictionsConfirmed ? '（已确认）' : ''}`,
    )
  } else if (profile.restrictionsConfirmed) {
    facts.push('档案中未填写身体限制（已确认）')
  }
  lines.push(`档案：${facts.join('；')}。`)

  const dayFacts = [`今日主题 ${day.focus}`]
  if (day.estimatedMinutes !== null) dayFacts.push(`预计 ${day.estimatedMinutes} 分钟`)
  lines.push(`${dayFacts.join('；')}。`)

  lines.push(
    `安排：${day.slots
      .map((slot) => `${slot.name} ${slot.sets} 组 × ${slot.target}（${slot.role}）`)
      .join('；')}。`,
  )

  if (recent.workouts !== null) {
    const parts = [`完成 ${recent.workouts} 次`]
    if (recent.minutes !== null) parts.push(`共 ${recent.minutes} 分钟`)
    if (recent.avgDifficulty !== null) parts.push(`平均难度 ${recent.avgDifficulty} / 10`)
    lines.push(`近 7 天：${parts.join('，')}。`)
  }

  return lines.join('\n')
}

function readContent(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const choices = (data as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first = choices[0]
  if (!first || typeof first !== 'object') return null
  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : null
}

async function handle(context: Context): Promise<Response> {
  const key = context.env.DEEPSEEK_API_KEY?.trim()
  // 未配置时不是故障：本机开发、试用环境都应该安静地少一块说明
  if (!key) return reply({ ok: false, reason: 'not-configured' })

  // 先看声明长度：超大请求直接拒绝，不必把 body 读进内存。
  // 声明可能缺失或不准，所以读取后仍保留一次实际字节数的兜底判断。
  const declared = context.request.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (Number.isFinite(size) && size > MAX_BODY_BYTES) {
      return reply({ ok: false, reason: 'too-large' })
    }
  }

  const ip = context.request.headers.get('cf-connecting-ip') ?? 'unknown'
  if (isRateLimited(ip, Date.now())) return reply({ ok: false, reason: 'rate-limited' })

  let raw: string
  try {
    raw = await context.request.text()
  } catch {
    return reply({ ok: false, reason: 'bad-request' })
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return reply({ ok: false, reason: 'too-large' })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return reply({ ok: false, reason: 'bad-request' })
  }

  // 带 items 的请求走条目化依据；其余仍按整段说明处理，旧客户端不受影响。
  // 注意：只要声明了 items 就必须按条目契约校验，不能退回整段说明——
  // 否则一条畸形请求会被当成散文请求发给上游，白花一次额度。
  const wantsBasis = typeof body === 'object' && body !== null && 'items' in body
  if (wantsBasis) {
    const basis = validateBasis(body)
    if (!basis) return reply({ ok: false, reason: 'bad-request' })
    return runBasis(basis, key)
  }

  const input = validate(body)
  if (!input) return reply({ ok: false, reason: 'bad-request' })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.2,
        max_tokens: 500,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(input) },
        ],
      }),
      signal: controller.signal,
    })
  } catch {
    // 只记录原因：请求体是用户档案摘要，不能出现在日志里
    console.error(controller.signal.aborted ? 'deepseek timeout' : 'deepseek network error')
    return reply({ ok: false, reason: controller.signal.aborted ? 'timeout' : 'upstream' })
  } finally {
    clearTimeout(timer)
  }

  // 上游错误原文可能包含账号、配额或内部细节，一律不透传给前端
  if (!upstream.ok) {
    console.error('deepseek status', upstream.status)
    return reply({ ok: false, reason: 'upstream' })
  }

  let data: unknown
  try {
    data = await upstream.json()
  } catch {
    console.error('deepseek invalid json')
    return reply({ ok: false, reason: 'upstream' })
  }

  const content = readContent(data)
  const text = content?.trim() ?? ''
  if (text.length < MIN_TEXT_LENGTH) return reply({ ok: false, reason: 'bad-output' })

  return reply({ ok: true, text: text.slice(0, MAX_TEXT_LENGTH) })
}

/**
 * 同时导出 onRequest 与 onRequestPost：
 * Pages Functions 在有 onRequest 时用它处理所有方法，因此这里显式返回 405，
 * 而不是依赖运行时的默认行为，保证非 POST 的行为可预期。
 */
export async function onRequest(context: Context): Promise<Response> {
  if (context.request.method !== 'POST') return reply({ ok: false, reason: 'method' }, 405)
  return handle(context)
}

export const onRequestPost = onRequest

/**
 * 条目化依据：与上面的整段说明共用防滥用与超时策略，但契约不同。
 *
 * 为什么要单独一条路径：整段说明没法标出"哪句话对应哪条建议"，用户读完仍不知道
 * 该改哪个。条目化之后，模型只填「为什么」，幅度与顺序仍由本地规则决定。
 */
type BasisItem = {
  sig: string
  name: string
  label: string
  evidence: { reps: number | null; load: number | null; difficulty: number | null }
}

type BasisInput = {
  planVersion: number
  day: { focus: string; slots: Array<{ name: string; sets: number; target: string; role: string }> }
  items: BasisItem[]
}

const BASIS_PROMPT = [
  '你只解释本地规则已经算好的训练调整，不能修改任何数字，也不能新增动作。',
  '每条理由 20–40 字，说清为什么这样调、下次注意什么。',
  '必须引用该条给出的实测数字（次数、重量或难度），不得出现这些数字之外的任何数字。',
  '不得给医疗建议、诊断、减重目标、热量或饮食处方。',
  '提到疼痛、头晕或不适时，必须建议停止训练并及时就医。',
  '只输出 JSON：{"items":[{"sig":"原样返回输入里的 sig","text":"..."}]}，不要 Markdown。',
].join('\n')

/** 只要请求里带 items 就走条目化路径；旧客户端仍按整段说明处理，互不影响。 */
function validateBasis(value: unknown): BasisInput | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const day = root.day
  const rawItems = root.items
  if (!day || typeof day !== 'object') return null
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 6) return null

  const d = day as Record<string, unknown>
  if (typeof d.focus !== 'string') return null
  if (!Array.isArray(d.slots) || d.slots.length < 1 || d.slots.length > 12) return null
  const slots: BasisInput['day']['slots'] = []
  for (const item of d.slots) {
    if (!item || typeof item !== 'object') continue
    const slot = item as Record<string, unknown>
    slots.push({
      name: clip(typeof slot.name === 'string' ? slot.name : '未命名动作', 30),
      sets: integer(slot.sets, 1, 12) ?? 1,
      target: clip(typeof slot.target === 'string' ? slot.target : '按计划完成', 24),
      role: slot.role === '放松' ? '放松' : '主要',
    })
  }
  if (slots.length === 0) return null

  const items: BasisItem[] = []
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const sig = typeof row.sig === 'string' ? clip(row.sig, 64) : ''
    if (!sig) continue
    const raw = (row.evidence && typeof row.evidence === 'object' ? row.evidence : {}) as Record<
      string,
      unknown
    >
    items.push({
      sig,
      name: clip(typeof row.name === 'string' ? row.name : '未命名动作', 30),
      label: clip(typeof row.label === 'string' ? row.label : '调整', 16),
      evidence: {
        reps: integer(raw.reps, 0, 100),
        load: decimal(raw.load, 0, 400),
        difficulty: decimal(raw.difficulty, 0, 10),
      },
    })
  }
  if (items.length === 0) return null
  // 签名必须唯一，否则条目与理由会错配
  if (new Set(items.map((item) => item.sig)).size !== items.length) return null

  return {
    planVersion: integer(root.planVersion, 0, 9999) ?? 0,
    day: { focus: clip(d.focus, 40), slots },
    items,
  }
}

function buildBasisMessage(input: BasisInput): string {
  const lines = [`今天是${input.day.focus}，计划共 ${input.day.slots.length} 个动作。`]
  for (const item of input.items) {
    const facts: string[] = []
    if (item.evidence.reps !== null) facts.push(`上次 ${item.evidence.reps} 次`)
    if (item.evidence.load !== null && item.evidence.load > 0)
      facts.push(`${item.evidence.load} kg`)
    if (item.evidence.difficulty !== null) facts.push(`难度 ${item.evidence.difficulty}/10`)
    lines.push(
      `sig=${item.sig} | ${item.name} | 调整=${item.label} | ${facts.length ? facts.join('，') : '暂无实测数据'}`,
    )
  }
  return lines.join('\n')
}

/** 文本里出现的数字必须来自该条的实测数据或幅度文案，否则这条理由就是编的。 */
function numbersMatch(text: string, item: BasisItem): boolean {
  const found = text.match(/\d+(?:\.\d+)?/g)
  if (!found) return true
  // 幅度文案本身由本地规则生成（例如「+2.5 kg」），引用它不算编造
  const fromLabel = item.label.match(/\d+(?:\.\d+)?/g) ?? []
  const allowed = new Set(
    [item.evidence.reps, item.evidence.load, item.evidence.difficulty]
      .filter((value): value is number => typeof value === 'number')
      .map((value) => String(Math.round(value * 10) / 10))
      .concat(fromLabel.map((raw) => String(Math.round(Number(raw) * 10) / 10))),
  )
  return found.every((raw) => allowed.has(String(Math.round(Number(raw) * 10) / 10)))
}

function readBasis(content: string, items: BasisItem[]): Array<{ sig: string; text: string }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    // 模型没按 JSON 输出时整批丢弃：宁可没有理由，也不能把自由发挥塞进界面
    return []
  }
  const list = (parsed as { items?: unknown })?.items
  if (!Array.isArray(list)) return []
  const byName = new Map(items.map((item) => [item.sig, item]))
  const out: Array<{ sig: string; text: string }> = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as { sig?: unknown; text?: unknown }
    if (typeof row.sig !== 'string' || typeof row.text !== 'string') continue
    const item = byName.get(row.sig)
    if (!item) continue
    const text = clip(row.text, 40)
    if (text.length < 8) continue
    if (!numbersMatch(text, item)) continue
    out.push({ sig: row.sig, text })
  }
  return out.slice(0, items.length)
}

async function runBasis(input: BasisInput, key: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.2,
        max_tokens: 600,
        stream: false,
        messages: [
          { role: 'system', content: BASIS_PROMPT },
          { role: 'user', content: buildBasisMessage(input) },
        ],
      }),
      signal: controller.signal,
    })
  } catch {
    console.error(controller.signal.aborted ? 'deepseek timeout' : 'deepseek network error')
    return reply({ ok: false, reason: controller.signal.aborted ? 'timeout' : 'upstream' })
  } finally {
    clearTimeout(timer)
  }

  if (!upstream.ok) {
    console.error('deepseek status', upstream.status)
    return reply({ ok: false, reason: 'upstream' })
  }
  let data: unknown
  try {
    data = await upstream.json()
  } catch {
    console.error('deepseek invalid json')
    return reply({ ok: false, reason: 'upstream' })
  }
  const content = readContent(data) ?? ''
  // 解析失败不是错误：界面拿到空数组就只显示本地幅度，功能不残缺
  return reply({ ok: true, items: readBasis(content, input.items) })
}
