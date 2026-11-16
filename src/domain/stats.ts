import type { Habit, Metric, Workout } from './model'
import type { ExerciseSession } from './engine'
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
