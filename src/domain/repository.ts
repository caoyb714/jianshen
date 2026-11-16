import { dataSchema, type AppData } from './model'
import { makeSeed } from './seed'
export const STORAGE_KEY = 'herfit.demo.v1'
export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function loadData(storage: StoragePort): { data: AppData; error: string | null } {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return { data: makeSeed(), error: null }
    const result = dataSchema.safeParse(JSON.parse(raw))
    if (!result.success) throw new Error('invalid')
    return { data: result.data, error: null }
  } catch {
    return {
      data: makeSeed(),
      error:
        '本机数据无法读取或版本不兼容，原数据尚未覆盖。请先导出原始数据，再到「我的」清空恢复。',
    }
  }
}
export function saveData(storage: StoragePort, data: AppData): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(dataSchema.parse(data)))
}
