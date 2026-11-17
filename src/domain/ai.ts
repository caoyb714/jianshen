/**
 * 交给模型解释前的「减面」层。
 *
 * 为什么单独成模块：这里是隐私边界，必须能被单测覆盖，也必须保持纯函数
 * （无网络、无随机、无 DOM），这样规则引擎和数据层都不会被牵连。
 */
import { localDate, shiftDate } from './dates'
import { getExercise } from './exercises'
import type { PlanDay, Profile, SlotTarget, Workout } from './model'

/** 同意标记的键名固定不变：已同意过的用户不该被反复询问。 */
export const AI_CONSENT_KEY = 'herfit.aiConsent.v1'

/** 白名单形状，服务端只按这些字段拼 prompt，多余字段一律不会发出。 */
export type ExplainPayload = {
  profile: {
    age: number
    experience: string
    weeklyDays: number
    sessionMinutes: number
    equipment: string[]
    restrictionsConfirmed: boolean
    restrictions: string
  }
  day: {
    focus: string
    estimatedMinutes: number
    slots: Array<{ name: string; sets: number; target: string; role: string }>
  }
  recent: { workouts: number; minutes: number; avgDifficulty: number | null }
}

/** 把计划里的目标转成口语化文案，模型看到的是「8-12 次」而不是嵌套对象。 */
export function formatTarget(target: SlotTarget): string {
  switch (target.type) {
    case 'reps':
      return `${target.min}-${target.max} 次`
    case 'hold':
      return `${target.seconds} 秒`
    default:
      return target.minMinutes === target.maxMinutes
        ? `${target.minMinutes} 分钟`
        : `${target.minMinutes}-${target.maxMinutes} 分钟`
  }
}

export function buildExplainPayload(input: {
  profile: Profile
  day: PlanDay
  workouts: Workout[]
  today: string
}): ExplainPayload {
  const { profile, day, workouts, today } = input

  // 近 7 天 = 今天与前 6 天。按本地日历日字符串比较，避免时区把边界日期算错。
  const cutoff = localDate(shiftDate(new Date(`${today}T12:00:00`), -6))
  const recent = workouts.filter((row) => row.date >= cutoff && row.date <= today)
  const minutes = Math.round(recent.reduce((sum, row) => sum + row.minutes, 0))
  const avgDifficulty = recent.length
    ? Math.round((recent.reduce((sum, row) => sum + row.difficulty, 0) / recent.length) * 10) / 10
    : null

  return {
    profile: {
      age: profile.age,
      experience: profile.experience,
      weeklyDays: profile.weeklyDays,
      sessionMinutes: profile.sessionMinutes,
      equipment: [...profile.equipment],
      restrictionsConfirmed: profile.restrictionsConfirmed,
      // 先把换行等控制字符压成空格，再截到 80 字：
      // 服务端也会清洗，但隐私边界不该只依赖一层，客户端就不该把原始换行带出去
      restrictions: profile.restrictions
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .trim()
        .slice(0, 80),
    },
    // 只保留解释需要的字段；昵称、邮箱、档案 id、计划 id、生成时间都不在这里
    day: {
      focus: day.focus,
      estimatedMinutes: day.estimatedMinutes,
      slots: day.slots.map((slot) => ({
        name: getExercise(slot.exerciseId)?.name ?? slot.exerciseId,
        sets: slot.sets,
        target: formatTarget(slot.target),
        role: slot.role,
      })),
    },
    recent: { workouts: recent.length, minutes, avgDifficulty },
  }
}
