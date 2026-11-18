/**
 * AI 理由的触发策略。
 *
 * 为什么单独成模块：它决定「什么时候允许花钱调模型」，必须能被单测覆盖，
 * 而且不能散落在组件里——组件一重渲染就容易重复触发。
 *
 * 规则（来自产品要求）：
 * - 每个计划版本、每天，自动拉取最多 1 次；
 * - 手动最多 4 次，第 5 次进入 30 秒冷却；
 * - 只有成功才计数，失败不占额度（否则一次网络抖动就白白浪费一次）。
 */
export type BasisState = {
  /** 本地日期，跨天自动重置 */
  date: string
  /** 计划标识（plan.id:version），换版本就重新允许自动拉一次 */
  planStamp: string
  auto: boolean
  manual: number
  /** 冷却截止时间戳，0 表示没有冷却 */
  cooldownUntil: number
}

export const MANUAL_LIMIT = 4
export const COOLDOWN_MS = 30_000

export function emptyState(date: string, planStamp: string): BasisState {
  return { date, planStamp, auto: false, manual: 0, cooldownUntil: 0 }
}

/** 换天或换版本都视为全新一轮 */
export function normalize(state: BasisState | null, date: string, planStamp: string): BasisState {
  if (!state || state.date !== date || state.planStamp !== planStamp) {
    return emptyState(date, planStamp)
  }
  return state
}

export function canAuto(state: BasisState): boolean {
  return !state.auto
}

export function canManual(state: BasisState, now: number): boolean {
  if (state.cooldownUntil > now) return false
  return state.manual < MANUAL_LIMIT
}

/** 当天的次数用完了：这时不该再显示倒计时，否则等于骗用户等 */
export function exhausted(state: BasisState): boolean {
  return state.manual >= MANUAL_LIMIT
}

/** 手动失败后的冷却：第 5 次点击才真正锁住 */
export function cooldownLeft(state: BasisState, now: number): number {
  return Math.max(0, state.cooldownUntil - now)
}

export function markAuto(state: BasisState): BasisState {
  return { ...state, auto: true }
}

/**
 * 记一次成功的手动拉取。
 * 每次成功都进入 30 秒冷却：连续点击既没意义，也容易撞上服务端限流。
 * 次数本身是当天硬上限，用完就明说，不用倒计时假装还能继续。
 */
export function markManual(state: BasisState, now: number): BasisState {
  return { ...state, manual: state.manual + 1, cooldownUntil: now + COOLDOWN_MS }
}
