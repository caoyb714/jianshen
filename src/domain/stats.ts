import type { AppData, Workout } from './model'
import { localDate, shiftDate } from './dates'
export function isComplete(workout: Workout) {
  return (
    !workout.discomfort &&
    workout.exercises.length > 0 &&
    workout.exercises.every((e) => e.sets > 0 && e.reps > 0)
  )
}
export function summarize(data: AppData, days: number, now = new Date()) {
  const end = localDate(now),
    start = localDate(shiftDate(now, 1 - days))
  const workouts = data.workouts.filter((w) => w.date >= start && w.date <= end)
  const habits = data.habits.filter((h) => h.date >= start && h.date <= end)
  const sleeps = habits.flatMap((h) => (h.sleep === null ? [] : [h.sleep]))
  return {
    sessions: workouts.filter(isComplete).length,
    minutes: workouts.reduce((s, w) => s + w.minutes, 0),
    sleepAverage: sleeps.length ? sleeps.reduce((a, b) => a + b, 0) / sleeps.length : null,
    activeDays: new Set(workouts.filter(isComplete).map((w) => w.date)).size,
    series: Array.from({ length: days }, (_, i) => {
      const date = localDate(shiftDate(now, i + 1 - days)),
        habit = habits.find((h) => h.date === date)
      return {
        date,
        label: `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`,
        minutes: workouts.filter((w) => w.date === date).reduce((s, w) => s + w.minutes, 0),
        sleep: habit?.sleep ?? null,
        energy: habit?.energy ?? null,
        water: habit?.water ?? 0,
      }
    }),
  }
}
