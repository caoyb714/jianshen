import type { AppData, Habit, Metric, Profile, TrainingPlan, Workout } from './model'

export type Change =
  | { kind: 'profile'; profileId: string; value: Profile }
  | { kind: 'habit'; value: Habit }
  | { kind: 'metric'; value: Metric }
  | { kind: 'workout'; value: Workout }
  /** 删除训练记录：本机直接过滤，云端走独立 RPC（herfit_write 不支持删除） */
  | { kind: 'deleteWorkout'; profileId: string; id: string }
  | { kind: 'plan'; value: TrainingPlan }
  | { kind: 'settings'; value: AppData['settings'] }

/** 同一档案只会有一个 active 计划，确认新版本时把旧的归档 */
export function applyChange(data: AppData, change: Change): AppData {
  switch (change.kind) {
    case 'profile':
      return {
        ...data,
        profiles: data.profiles.map((item) =>
          item.id === change.profileId ? { ...item, profile: change.value } : item,
        ),
      }
    case 'habit':
      return {
        ...data,
        habits: [
          change.value,
          ...data.habits.filter(
            (row) => !(row.profileId === change.value.profileId && row.date === change.value.date),
          ),
        ],
      }
    case 'metric':
      return {
        ...data,
        metrics: [
          change.value,
          ...data.metrics.filter(
            (row) => !(row.profileId === change.value.profileId && row.date === change.value.date),
          ),
        ],
      }
    case 'workout':
      return {
        ...data,
        workouts: [change.value, ...data.workouts.filter((row) => row.id !== change.value.id)],
      }
    case 'deleteWorkout':
      return {
        ...data,
        workouts: data.workouts.filter(
          (row) => !(row.id === change.id && row.profileId === change.profileId),
        ),
      }
    case 'plan':
      return {
        ...data,
        plans: [
          change.value,
          ...data.plans
            .filter((row) => row.id !== change.value.id)
            .map((row) =>
              change.value.status === 'active' &&
              row.profileId === change.value.profileId &&
              row.status === 'active'
                ? { ...row, status: 'archived' as const }
                : row,
            ),
        ],
      }
    case 'settings':
      return { ...data, settings: change.value }
  }
}
