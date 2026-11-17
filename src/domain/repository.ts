import { z } from 'zod'
import { writeJson } from '../app/storage'
import { dataSchema, type AppData, type Profile, type Workout } from './model'
import { makeSeed, PROFILE_A, PROFILE_B } from './seed'

export const STORAGE_KEY = 'herfit.demo.v2'
/** v1（单档案、每动作单一组次）键名，仅用于一次性迁移 */
const LEGACY_KEY = 'herfit.demo.v1'

export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const legacyProfile = z.object({
  name: z.string(),
  age: z.number(),
  height: z.number(),
  experience: z.enum(['刚刚开始', '偶尔运动', '规律运动']),
  activity: z.enum(['大多坐着', '经常走动', '体力活动较多']),
  goal: z.enum(['养成运动习惯', '提升力量与体能', '改善日常状态']),
  weeklyDays: z.number(),
  sessionMinutes: z.number(),
  equipment: z.array(z.enum(['徒手', '哑铃', '弹力带'])),
  dumbbell: z.string(),
  band: z.string(),
  restrictions: z.string(),
  restrictionsConfirmed: z.boolean(),
})
const legacyWorkout = z.object({
  id: z.string(),
  date: z.string(),
  planId: z.string(),
  title: z.string(),
  minutes: z.number(),
  difficulty: z.number(),
  discomfort: z.boolean(),
  feeling: z.string(),
  createdAt: z.string(),
  exercises: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sets: z.number(),
      reps: z.number(),
      load: z.number(),
    }),
  ),
})
const legacyData = z.object({
  version: z.literal(1),
  profile: legacyProfile,
  habits: z.array(
    z.object({
      date: z.string(),
      water: z.number(),
      sleep: z.number().nullable(),
      energy: z.number().nullable(),
      meals: z.boolean(),
      protein: z.boolean(),
      plants: z.boolean(),
    }),
  ),
  metrics: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      weight: z.number().nullable(),
      waist: z.number().nullable(),
      hip: z.number().nullable(),
    }),
  ),
  workouts: z.array(legacyWorkout),
  settings: z.object({ showWeight: z.boolean() }),
})

/**
 * v1 → v2：单档案转为档案位 1，每个动作的单一组次展开为逐组记录。
 * 旧记录全部标记为已完成（它们本来代表"已完成 N 组 × M 次"）。
 */
export function migrateV1(input: unknown): AppData | null {
  const parsed = legacyData.safeParse(input)
  if (!parsed.success) return null
  const old = parsed.data
  const profile: Profile = { ...old.profile }
  const workouts: Workout[] = old.workouts.map((row) => ({
    profileId: PROFILE_A,
    id: z.guid().safeParse(row.id).success
      ? row.id
      : `6f8f0c1e-0000-4000-8000-${String(Math.abs(hash(row.id)) % 1e12).padStart(12, '0')}`,
    date: row.date,
    planId: row.planId,
    planVersion: 1,
    title: row.title,
    minutes: row.minutes,
    difficulty: row.difficulty,
    discomfort: row.discomfort,
    feeling: row.feeling,
    createdAt: row.createdAt,
    exercises: row.exercises.map((item) => ({
      exerciseId: item.id,
      name: item.name,
      role: '主要' as const,
      plannedSets: item.sets,
      targetReps: item.reps,
      targetSeconds: null,
      replacedFrom: null,
      sets: Array.from({ length: Math.min(12, Math.max(0, item.sets)) }, () => ({
        reps: item.reps,
        load: item.load,
        done: true,
      })),
    })),
  }))
  return {
    version: 2,
    profiles: [
      { id: PROFILE_A, slot: 1, profile },
      { id: PROFILE_B, slot: 2, profile: null },
    ],
    settings: old.settings,
    habits: old.habits.map((row) => ({ ...row, profileId: PROFILE_A })),
    metrics: old.metrics.map((row) => ({ ...row, profileId: PROFILE_A })),
    workouts,
    plans: [],
  }
}

function hash(value: string): number {
  let result = 0
  for (let i = 0; i < value.length; i += 1) result = (result * 31 + value.charCodeAt(i)) | 0
  return result
}

/**
 * 读取不走 storage.ts 的 readJson：这里必须区分"没有数据"（给种子）和
 * "数据损坏"（保留原值并提示用户先导出），readJson 把两者都收敛成 null 会丢掉这个差别。
 */
export function loadData(storage: StoragePort): { data: AppData; error: string | null } {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) {
      const legacy = storage.getItem(LEGACY_KEY)
      if (legacy !== null) {
        const migrated = migrateV1(JSON.parse(legacy))
        if (migrated) {
          saveData(storage, migrated)
          return { data: migrated, error: null }
        }
      }
      return { data: makeSeed(), error: null }
    }
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
  const value = dataSchema.parse(data)
  // 写入失败必须抛错：记录不能"看起来存上了"却丢在本机之外，
  // 上层据此保留表单并明确提示，而不是静默吞掉
  if (!writeJson(STORAGE_KEY, value, storage)) throw new Error('本机存储写入失败')
}
