import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  habitSchema,
  metricSchema,
  profileSchema,
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
  profileId: z.guid(),
  profile: entry(profileSchema.nullable()),
  habits: z.array(entry(habitSchema)),
  metrics: z.array(entry(metricSchema)),
  workouts: z.array(entry(workoutSchema)),
  settings: entry(z.object({ showWeight: z.boolean() })).nullable(),
})
export type Snapshot = z.infer<typeof snapshotSchema>
export class CloudError extends Error {
  constructor(public readonly kind: 'denied' | 'conflict' | 'invalid' | 'network') {
    super(kind)
  }
}

export function toAppData(snapshot: Snapshot): AppData | null {
  if (!snapshot.profile.value) return null
  return {
    version: 1,
    profile: snapshot.profile.value,
    habits: snapshot.habits.map((row) => row.value),
    metrics: snapshot.metrics.map((row) => row.value),
    workouts: snapshot.workouts.map((row) => row.value),
    settings: snapshot.settings?.value ?? { showWeight: false },
  }
}

function unpack(data: unknown, error: { code?: string } | null, status: number): Snapshot {
  if (error !== null) {
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
    save: (current: Snapshot, change: Change, formRevision?: number) =>
      withTimeout(async (signal) => {
        const expected = revisionFor(current, change, formRevision)
        const { data, error, status } = await client
          .rpc('herfit_write', {
            p_workspace: current.workspaceId,
            p_profile: current.profileId,
            p_kind: change.kind,
            p_payload: change.value,
            p_expected: expected,
          })
          .abortSignal(signal)
        return unpack(data, error, status)
      }),
  }
}
function revisionFor(current: Snapshot, change: Change, formRevision?: number) {
  switch (change.kind) {
    case 'profile':
      return formRevision ?? current.profile.revision
    case 'habit':
      return current.habits.find((row) => row.value.date === change.value.date)?.revision ?? null
    case 'metric':
      return current.metrics.find((row) => row.value.date === change.value.date)?.revision ?? null
    case 'settings':
      return current.settings?.revision ?? null
    case 'workout':
      return null
  }
}
