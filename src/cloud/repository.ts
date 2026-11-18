import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  habitSchema,
  metricSchema,
  profileSchema,
  trainingPlanSchema,
  workoutSchema,
  type AppData,
} from '../domain/model'
import type { Change } from '../domain/change'

function entry<T extends z.ZodType>(schema: T) {
  return z.object({
    value: schema,
    revision: z.number().int().positive(),
    createdBy: z.guid().nullable(),
    updatedBy: z.guid().nullable(),
    updatedAt: z.string(),
  })
}
const snapshotSchema = z.object({
  workspaceId: z.guid(),
  workspaceName: z.string().min(1),
  profiles: z
    .array(
      z.object({
        id: z.guid(),
        slot: z.union([z.literal(1), z.literal(2)]),
        profile: entry(profileSchema.nullable()),
      }),
    )
    .min(1)
    .max(2),
  habits: z.array(entry(habitSchema)),
  metrics: z.array(entry(metricSchema)),
  workouts: z.array(entry(workoutSchema)),
  plans: z.array(entry(trainingPlanSchema)),
  settings: entry(z.object({ showWeight: z.boolean() })).nullable(),
})
export type Snapshot = z.infer<typeof snapshotSchema>
export class CloudError extends Error {
  constructor(public readonly kind: 'denied' | 'conflict' | 'invalid' | 'network' | 'notOwner') {
    super(kind)
  }
}

/**
 * 数据库可能只预置了一个档案位。传入 pendingId 时补出第二个空位，
 * 首次保存该档案会由 herfit_write 插入新行。
 */
export function toAppData(snapshot: Snapshot, pendingId?: string): AppData {
  const profiles = snapshot.profiles.map((row) => ({
    id: row.id,
    slot: row.slot,
    profile: row.profile.value,
  }))
  if (profiles.length < 2 && pendingId) {
    profiles.push({ id: pendingId, slot: 2, profile: null })
  }
  return {
    version: 2,
    profiles,
    habits: snapshot.habits.map((row) => row.value),
    metrics: snapshot.metrics.map((row) => row.value),
    workouts: snapshot.workouts.map((row) => row.value),
    plans: snapshot.plans.map((row) => row.value),
    settings: snapshot.settings?.value ?? { showWeight: false },
  }
}

function unpack(
  data: unknown,
  error: { code?: string; message?: string } | null,
  status: number,
): Snapshot {
  if (error !== null) {
    // 删除他人记录同样返回 42501，但语义是"不是作者"而不是"没有空间权限"：
    // 不区分的话界面会把整个共享空间判为不可访问并清空已加载数据
    if (error.message?.includes('not the record author')) throw new CloudError('notOwner')
    if (status === 401 || status === 403 || error.code === '42501') throw new CloudError('denied')
    if (error.code === '40001' || error.code === '23505') throw new CloudError('conflict')
    if (['23514', '22007', '22008', '22P02'].includes(error.code ?? ''))
      throw new CloudError('invalid')
    throw new CloudError('network')
  }
  if (data === null) throw new CloudError('denied')
  const parsed = snapshotSchema.safeParse(data)
  if (!parsed.success) throw new CloudError('invalid')
  return parsed.data
}
async function withTimeout<T>(action: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    return await action(controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}
export function createRepository(client: SupabaseClient) {
  return {
    load: () =>
      withTimeout(async (signal) => {
        const { data, error, status } = await client.rpc('herfit_snapshot').abortSignal(signal)
        return unpack(data, error, status)
      }),
    save: (current: Snapshot, change: Change, formRevision?: number, profileId?: string) =>
      withTimeout(async (signal) => {
        if (change.kind === 'deleteWorkout') {
          const { data, error, status } = await client
            .rpc('herfit_delete_workout', {
              p_workspace: current.workspaceId,
              p_profile: change.profileId,
              p_record: change.id,
            })
            .abortSignal(signal)
          return unpack(data, error, status)
        }
        const expected = revisionFor(current, change, formRevision)
        const { data, error, status } = await client
          .rpc('herfit_write', {
            p_workspace: current.workspaceId,
            // 个人设置按 user 存储，但服务端仍需一个合法档案 UUID 通过成员校验
            p_profile: profileId ?? profileIdOf(change),
            p_kind: change.kind,
            p_payload: change.value,
            p_expected: expected,
          })
          .abortSignal(signal)
        return unpack(data, error, status)
      }),
  }
}

function profileIdOf(change: Change): string | undefined {
  if (change.kind === 'profile') return change.profileId
  if (change.kind === 'settings') return undefined
  if (change.kind === 'deleteWorkout') return change.profileId
  return change.value.profileId
}

function revisionFor(current: Snapshot, change: Change, formRevision?: number) {
  switch (change.kind) {
    case 'profile':
      return (
        formRevision ??
        current.profiles.find((row) => row.id === change.profileId)?.profile.revision ??
        null
      )
    case 'habit':
      return (
        current.habits.find(
          (row) =>
            row.value.profileId === change.value.profileId && row.value.date === change.value.date,
        )?.revision ?? null
      )
    case 'metric':
      return (
        current.metrics.find(
          (row) =>
            row.value.profileId === change.value.profileId && row.value.date === change.value.date,
        )?.revision ?? null
      )
    case 'settings':
      return current.settings?.revision ?? null
    case 'workout':
    case 'plan':
    case 'deleteWorkout':
      return null
  }
}
