import type { Habit, Metric, PlanDay, Workout } from './model'
import { suggest, type Adjustment, type ExerciseSession } from './engine'
import { getExercise } from './exercises'
import { localDate, shiftDate, weekDates } from './dates'

export type Scoped = { workouts: Workout[]; habits: Habit[]; metrics: Metric[] }

export function plannedSetCount(workout: Workout): number {
  return workout.exercises.reduce((sum, item) => sum + item.sets.length, 0)
}

export function doneSetCount(workout: Workout): number {
  return workout.exercises.reduce(
    (sum, item) => sum + item.sets.filter((set) => set.done && set.reps > 0).length,
    0,
  )
}

/** 完整训练：无不适，且所有计划内的组都已完成并填写次数 */
export function isComplete(workout: Workout): boolean {
  const planned = plannedSetCount(workout)
  return !workout.discomfort && planned > 0 && doneSetCount(workout) === planned
}

/** 训练容量：已完成组的 次数 × 负荷（自重动作按 1 计） */
export function totalVolume(workout: Workout): number {
  return workout.exercises.reduce(
    (sum, item) =>
      sum +
      item.sets
        .filter((set) => set.done && set.reps > 0)
        .reduce((inner, set) => inner + set.reps * Math.max(1, set.load), 0),
    0,
  )
}

/** 供渐进负荷判断使用的单动作历史，按日期倒序 */
export function historyFor(workouts: Workout[], exerciseId: string, limit = 6): ExerciseSession[] {
  return workouts
    .filter((workout) => workout.exercises.some((item) => item.exerciseId === exerciseId))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit)
    .map((workout) => {
      const item = workout.exercises.find((row) => row.exerciseId === exerciseId)!
      return {
        date: workout.date,
        difficulty: workout.difficulty,
        discomfort: workout.discomfort,
        sets: item.sets
          .filter((set) => set.done)
          .map((set) => ({ reps: set.reps, load: set.load })),
      }
    })
    .filter((session) => session.sets.length > 0)
}

export function summarize(scoped: Scoped, days: number, now = new Date()) {
  const end = localDate(now)
  const start = localDate(shiftDate(now, 1 - days))
  const workouts = scoped.workouts.filter((row) => row.date >= start && row.date <= end)
  const habits = scoped.habits.filter((row) => row.date >= start && row.date <= end)
  const sleeps = habits.flatMap((row) => (row.sleep === null ? [] : [row.sleep]))
  return {
    sessions: workouts.filter(isComplete).length,
    minutes: workouts.reduce((sum, row) => sum + row.minutes, 0),
    volume: workouts.reduce((sum, row) => sum + totalVolume(row), 0),
    sleepAverage: sleeps.length ? sleeps.reduce((a, b) => a + b, 0) / sleeps.length : null,
    activeDays: new Set(workouts.filter(isComplete).map((row) => row.date)).size,
    series: Array.from({ length: days }, (_, i) => {
      const date = localDate(shiftDate(now, i + 1 - days))
      const habit = habits.find((row) => row.date === date)
      return {
        date,
        label: `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`,
        minutes: workouts.filter((row) => row.date === date).reduce((s, row) => s + row.minutes, 0),
        sleep: habit?.sleep ?? null,
        energy: habit?.energy ?? null,
        water: habit?.water ?? 0,
      }
    }),
  }
}

/** 本周（周一起）完成情况，用于监督视角 */
export function weekProgress(scoped: Scoped, now = new Date()) {
  const dates = weekDates(now)
  const done = new Set(scoped.workouts.filter(isComplete).map((row) => row.date))
  return {
    dates,
    doneCount: dates.filter((date) => done.has(date)).length,
    perDay: dates.map((date) => ({
      date,
      done: done.has(date),
      minutes: scoped.workouts
        .filter((row) => row.date === date)
        .reduce((sum, row) => sum + row.minutes, 0),
    })),
  }
}

/** 汇总当前计划里每个主要动作的负荷建议，供训练页确认后生效 */
export function reviewPlan(days: PlanDay[], workouts: Workout[]): AugmentedAdjustment[] {
  const seen = new Map<
    string,
    { exerciseId: string; name: string; targetRepsMax: number; startLoad: number }
  >()
  for (const day of days) {
    for (const slot of day.slots) {
      if (slot.role !== '主要' || seen.has(slot.exerciseId)) continue
      const exercise = getExercise(slot.exerciseId)
      if (!exercise) continue
      seen.set(slot.exerciseId, {
        exerciseId: slot.exerciseId,
        name: exercise.name,
        targetRepsMax: slot.target.type === 'reps' ? slot.target.max : 10,
        startLoad: slot.startLoad,
      })
    }
  }
  const result: AugmentedAdjustment[] = []
  for (const item of seen.values()) {
    const exercise = getExercise(item.exerciseId)!
    const suggestion = suggest({
      exerciseId: item.exerciseId,
      targetRepsMax: item.targetRepsMax,
      equipment: exercise.equipment,
      currentLoad: item.startLoad,
      history: historyFor(workouts, item.exerciseId),
    })
    result.push({ ...item, suggestion })
  }
  return result
}

export type AugmentedAdjustment = Adjustment & { targetRepsMax: number; startLoad: number }

/** 身体指标按日期升序，用于折线图 */
export function metricSeries(metrics: Metric[]) {
  return [...metrics]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      date: row.date,
      label: `${Number(row.date.slice(5, 7))}/${Number(row.date.slice(8))}`,
      weight: row.weight,
      waist: row.waist,
      hip: row.hip,
    }))
}

/** 单个动作的进步曲线：每次训练的最大负荷与总容量 */
export function exerciseProgress(workouts: Workout[], exerciseId: string) {
  return [...workouts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((workout) => {
      const item = workout.exercises.find((row) => row.exerciseId === exerciseId)
      if (!item) return []
      const done = item.sets.filter((set) => set.done && set.reps > 0)
      if (done.length === 0) return []
      return [
        {
          date: workout.date,
          label: `${Number(workout.date.slice(5, 7))}/${Number(workout.date.slice(8))}`,
          topLoad: Math.max(...done.map((set) => set.load)),
          volume: done.reduce((sum, set) => sum + set.reps * Math.max(1, set.load), 0),
          reps: done.reduce((sum, set) => sum + set.reps, 0),
        },
      ]
    })
}

/**
 * 一周复盘的一句话。
 * 只陈述事实，不做好坏判断——这个产品不对身体下结论。
 */
export function weeklyReview(input: {
  activeDays: number
  targetDays: number
  sessions: number
  minutes: number
  sleepAverage: number | null
  waterAverage: number | null
}): string {
  const { activeDays, targetDays, sessions, minutes, sleepAverage, waterAverage } = input
  const parts: string[] = []

  if (activeDays === 0) parts.push('这周还没有完成训练')
  else if (targetDays > 0) parts.push(`这周练了 ${activeDays} 天（目标 ${targetDays} 天）`)
  else parts.push(`这周练了 ${activeDays} 天`)

  if (sessions > 0)
    parts.push(`共 ${Math.round(minutes)} 分钟，平均每次 ${Math.round(minutes / sessions)} 分钟`)
  if (sleepAverage !== null) parts.push(`睡眠平均 ${sleepAverage.toFixed(1)} 小时`)
  if (waterAverage !== null && waterAverage > 0)
    parts.push(`饮水日均 ${Math.round(waterAverage)} ml`)

  const tail =
    activeDays === 0
      ? '从下一次开始就好。'
      : targetDays > 0 && activeDays >= targetDays
        ? '节奏保持住就行。'
        : '不用补练，接着往下走。'

  return `${parts.join('；')}。${tail}`
}
