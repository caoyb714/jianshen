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
export const profileSchema = z.object({
  name: z.string().trim().min(1, '请输入昵称').max(20, '昵称最多 20 字'),
  age: number(18, 100),
  height: number(100, 230),
  experience: z.enum(['刚刚开始', '偶尔运动', '规律运动']),
  activity: z.enum(['大多坐着', '经常走动', '体力活动较多']),
  goal: z.enum(['养成运动习惯', '提升力量与体能', '改善日常状态']),
  weeklyDays: number(1, 7).int(),
  sessionMinutes: number(10, 90).int(),
  equipment: z.array(z.enum(['徒手', '哑铃', '弹力带'])).min(1, '至少选择一种器械'),
  dumbbell: z.string().max(50),
  band: z.string().max(50),
  restrictions: z.string().max(500),
  restrictionsConfirmed: z.boolean().refine((v) => v, '请主动确认身体限制'),
})
export const habitSchema = z.object({
  date: day,
  water: number(0, 10000),
  sleep: number(0, 24).nullable(),
  energy: number(1, 5).int().nullable(),
  meals: z.boolean(),
  protein: z.boolean(),
  plants: z.boolean(),
})
export const metricSchema = z.object({
  id: z.string(),
  date: day,
  weight: number(20, 400).nullable(),
  waist: number(30, 250).nullable(),
  hip: number(30, 250).nullable(),
})
export const workoutSchema = z.object({
  id: z.string(),
  date: day,
  planId: z.string(),
  title: z.string().max(100),
  minutes: number(0, 240),
  difficulty: number(1, 10).int(),
  discomfort: z.boolean(),
  feeling: z.string().max(500),
  createdAt: z.string(),
  exercises: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sets: number(0, 10).int(),
      reps: number(0, 100).int(),
      load: number(0, 200),
    }),
  ),
})
export const dataSchema = z.object({
  version: z.literal(1),
  profile: profileSchema,
  habits: z.array(habitSchema),
  metrics: z.array(metricSchema),
  workouts: z.array(workoutSchema),
  settings: z.object({ showWeight: z.boolean() }),
})
export type Profile = z.infer<typeof profileSchema>
export type Habit = z.infer<typeof habitSchema>
export type Workout = z.infer<typeof workoutSchema>
export type AppData = z.infer<typeof dataSchema>
export type Metric = z.infer<typeof metricSchema>
export type Exercise = {
  id: string
  name: string
  area: string
  equipment: string
  sets: number
  reps: number
  rest: number
  steps: string[]
  note: string
  alternative: string
}
export type Plan = {
  id: string
  title: string
  description: string
  type: string
  minutes: number
  equipment: string
  color: string
  exercises: string[]
}
