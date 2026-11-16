import type { AppData, Habit, Metric, Profile, Workout } from './model'

export type Change =
  | { kind: 'profile'; value: Profile }
  | { kind: 'habit'; value: Habit }
  | { kind: 'metric'; value: Metric }
  | { kind: 'workout'; value: Workout }
  | { kind: 'settings'; value: AppData['settings'] }

export function applyChange(data: AppData, change: Change): AppData {
  switch (change.kind) {
    case 'profile':
      return { ...data, profile: change.value }
    case 'habit':
      return {
        ...data,
        habits: [change.value, ...data.habits.filter((row) => row.date !== change.value.date)],
      }
    case 'metric':
      return {
        ...data,
        metrics: [change.value, ...data.metrics.filter((row) => row.date !== change.value.date)],
      }
    case 'workout':
      return {
        ...data,
        workouts: [change.value, ...data.workouts.filter((row) => row.id !== change.value.id)],
      }
    case 'settings':
      return { ...data, settings: change.value }
  }
}
