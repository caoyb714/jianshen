import { z } from 'zod'

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00`)
    return (
      !Number.isNaN(date.getTime()) &&
      date.getFullYear() === Number(value.slice(0, 4)) &&
      date.getMonth() + 1 === Number(value.slice(5, 7)) &&
      date.getDate() === Number(value.slice(8, 10))
    )
  }, '日期无效')
const number = (min: number, max: number) => z.number().min(min).max(max)
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '记录标识无效')

export const profileSchema = z.object({
  name: z.string().trim().min(1, '请输入昵称').max(20, '昵称最多 20 字'),
  age: number(18, 100),
  height: number(100, 230),
  experience: z.enum(['刚刚开始', '偶尔运动', '规律运动']),
  activity: z.enum(['大多坐着', '经常走动', '体力活动较多']),
  goal: z.enum(['养成运动习惯', '提升力量与体能', '改善日常状态']),
  weeklyDays: number(1, 7).int(),
  /** 自己勾选的训练日（0=周一）。为空表示沿用引擎按天数自动排 */
  trainingDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  sessionMinutes: number(10, 90).int(),
  equipment: z.array(z.enum(['徒手', '哑铃', '弹力带'])).min(1, '至少选择一种器械'),
  dumbbell: z.string().max(50),
  band: z.string().max(50),
  restrictions: z.string().max(500),
  restrictionsConfirmed: z.boolean().refine((v) => v, '请主动确认身体限制'),
})

export const habitSchema = z.object({
  profileId: z.string(),
  date: day,
  water: number(0, 10000),
  sleep: number(0, 24).nullable(),
  energy: number(1, 5).int().nullable(),
  /** 今天的精力：只影响当天安排，不参与任何评分 */
  readiness: z.enum(['high', 'ok', 'low', 'unwell']).nullable().optional(),
  meals: z.boolean(),
  protein: z.boolean(),
  plants: z.boolean(),
})

export const metricSchema = z.object({
  profileId: z.string(),
  id: z.string(),
  date: day,
  weight: number(20, 400).nullable(),
  waist: number(30, 250).nullable(),
  hip: number(30, 250).nullable(),
})

/** 单组实际完成情况。逐组记录是渐进负荷判断的唯一依据。 */
export const setSchema = z.object({
  reps: number(0, 100).int(),
  load: number(0, 200),
  done: z.boolean(),
})

export const performanceSchema = z.object({
  exerciseId: z.string().max(100),
  name: z.string().max(100),
  role: z.enum(['主要', '放松']),
  plannedSets: number(0, 10).int(),
  targetReps: z.number().int().min(0).max(200).nullable(),
  targetSeconds: z.number().int().min(0).max(600).nullable(),
  replacedFrom: z.string().max(100).nullable(),
  sets: z.array(setSchema).max(12),
})

export const workoutSchema = z.object({
  profileId: z.string(),
  id: uuid,
  date: day,
  planId: z.string().max(100),
  planVersion: z.number().int().min(0),
  title: z.string().max(100),
  minutes: number(0, 240),
  difficulty: number(1, 10).int(),
  discomfort: z.boolean(),
  feeling: z.string().max(500),
  createdAt: z.string(),
  exercises: z.array(performanceSchema).max(30),
})

export const slotTargetSchema = z.union([
  z.object({ type: z.literal('reps'), min: number(1, 100).int(), max: number(1, 100).int() }),
  z.object({ type: z.literal('hold'), seconds: number(1, 600).int() }),
  z.object({
    type: z.literal('time'),
    minMinutes: number(1, 120).int(),
    maxMinutes: number(1, 120).int(),
  }),
])

export const planSlotSchema = z.object({
  exerciseId: z.string().max(100),
  role: z.enum(['主要', '放松']),
  sets: number(1, 10).int(),
  target: slotTargetSchema,
  restSeconds: number(0, 300).int(),
  startLoad: number(0, 200),
})

export const planDaySchema = z.object({
  index: number(0, 6).int(),
  kind: z.enum(['训练', '恢复', '休息']),
  focus: z.string().max(40),
  warmup: z.string().max(200),
  slots: z.array(planSlotSchema).max(12),
  estimatedMinutes: number(0, 240).int(),
  note: z.string().max(200),
})

export const planInputSchema = z.object({
  age: number(18, 100),
  experience: z.enum(['刚刚开始', '偶尔运动', '规律运动']),
  weeklyDays: number(1, 7).int(),
  sessionMinutes: number(10, 90).int(),
  equipment: z.array(z.enum(['徒手', '哑铃', '弹力带'])).min(1),
  restrictions: z.string().max(500),
})

/** 已应用到这一版的建议，用于刷新后仍能显示「已生效」并撤销 */
export const appliedAdjustmentSchema = z.object({
  sig: z.string().max(80),
  name: z.string().max(30),
  label: z.string().max(16),
})

export const trainingPlanSchema = z.object({
  profileId: z.string(),
  id: uuid,
  version: z.number().int().min(1),
  generatedAt: z.string(),
  confirmedAt: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  input: planInputSchema,
  days: z.array(planDaySchema).length(7),
  notes: z.array(z.string().max(300)).max(10),
  // 以下三个字段是可选的：旧计划没有它们，读取时必须照常通过
  /** 这次调整基于哪一版；撤销回到它重算，刷新后仍然可用 */
  baselineVersion: z.number().int().min(0).nullable().optional(),
  appliedAdjustments: z.array(appliedAdjustmentSchema).max(12).optional(),
  /** 谁改的：云端存 viewerId，本机存 local */
  editedBy: z.string().max(40).nullable().optional(),
})

export const profileSlotSchema = z.object({
  id: z.string(),
  slot: z.union([z.literal(1), z.literal(2)]),
  profile: profileSchema.nullable(),
})

export const dataSchema = z.object({
  version: z.literal(2),
  profiles: z.array(profileSlotSchema).min(1).max(2),
  habits: z.array(habitSchema),
  metrics: z.array(metricSchema),
  workouts: z.array(workoutSchema),
  plans: z.array(trainingPlanSchema),
  settings: z.object({ showWeight: z.boolean() }),
})

export type Profile = z.infer<typeof profileSchema>
export type Habit = z.infer<typeof habitSchema>
export type Metric = z.infer<typeof metricSchema>
export type SetRecord = z.infer<typeof setSchema>
export type Performance = z.infer<typeof performanceSchema>
export type Workout = z.infer<typeof workoutSchema>
export type SlotTarget = z.infer<typeof slotTargetSchema>
export type PlanSlot = z.infer<typeof planSlotSchema>
export type PlanDay = z.infer<typeof planDaySchema>
export type PlanInput = z.infer<typeof planInputSchema>
export type TrainingPlan = z.infer<typeof trainingPlanSchema>
export type ProfileSlot = z.infer<typeof profileSlotSchema>
export type AppData = z.infer<typeof dataSchema>
