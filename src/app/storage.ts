/**
 * 本机存储的统一入口。
 *
 * 为什么需要它：隐私模式、配额满、被浏览器策略禁用时，localStorage 会直接抛错。
 * 这些场景都不该打断训练，所以读、写、删一律吞掉异常并给出布尔结果，
 * 让调用方按「没读到 / 没写成」处理，而不是各自写一遍 try/catch。
 */

/** 只依赖三个方法，方便测试注入内存实现。 */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Safari 隐私模式下连访问 localStorage 都可能抛错，因此也要兜住。 */
function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * 读 JSON。键不存在、内容损坏、存储不可用都返回 null：
 * 调用方只需要判断"有没有可用的值"，不需要区分原因。
 */
export function readJson<T>(key: string, storage: StorageLike | null = defaultStorage()): T | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 写 JSON。返回是否写入成功，便于调用方在失败时静默降级而不是报错。 */
export function writeJson(
  key: string,
  value: unknown,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeKey(key: string, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}
