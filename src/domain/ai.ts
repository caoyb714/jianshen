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

/**
 * 「为什么这么调」的条目化输入。
 *
 * 与上面的整段说明分开：说明是整卡的一段散文，条目化依据只解释单条建议，
 * 因此必须带上这条建议自己的实测数字，模型才有东西可引用。
 * 同样遵守隐私边界：不含昵称、邮箱、档案 id、体重，也不含计划 id 以外的标识。
 */
export type BasisItem = {
  /** 稳定签名：客户端与服务端都靠它对齐条目，模型无权新增 */
  sig: string
  name: string
  /** 幅度文案，只来自 rules 的 adjustLabel，例如「+2.5 kg」「少一组」 */
  label: string
  evidence: { reps: number | null; load: number | null; difficulty: number | null }
}

export type BasisPayload = {
  planVersion: number
  profile: {
    age: number
    experience: string
    equipment: string[]
    restrictions: string
    restrictionsConfirmed: boolean
  }
  day: { focus: string; slots: Array<{ name: string; sets: number; target: string; role: string }> }
  items: BasisItem[]
  recent: { workouts: number; minutes: number; avgDifficulty: number | null }
}

export function buildBasisPayload(input: {
  profile: Profile
  day: PlanDay
  planVersion: number
  items: BasisItem[]
  workouts: Workout[]
  today: string
}): BasisPayload {
  const { profile, day, planVersion, items, workouts, today } = input
  const cutoff = localDate(shiftDate(new Date(`${today}T12:00:00`), -6))
  const recent = workouts.filter((row) => row.date >= cutoff && row.date <= today)
  return {
    planVersion,
    profile: {
      age: profile.age,
      experience: profile.experience,
      equipment: [...profile.equipment],
      restrictionsConfirmed: profile.restrictionsConfirmed,
      restrictions: profile.restrictions
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .trim()
        .slice(0, 80),
    },
    day: {
      focus: day.focus,
      slots: day.slots.map((slot) => ({
        name: getExercise(slot.exerciseId)?.name ?? slot.exerciseId,
        sets: slot.sets,
        target: formatTarget(slot.target),
        role: slot.role,
      })),
    },
    items: items.slice(0, 6),
    recent: {
      workouts: recent.length,
      minutes: Math.round(recent.reduce((sum, row) => sum + row.minutes, 0)),
      avgDifficulty: recent.length
        ? Math.round((recent.reduce((sum, row) => sum + row.difficulty, 0) / recent.length) * 10) /
          10
        : null,
    },
  }
}
