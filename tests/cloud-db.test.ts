import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { makeSeed } from '../src/domain/seed'
import { generatePlan } from '../src/domain/engine'
import type { TrainingPlan } from '../src/domain/model'

const a = '00000000-0000-0000-0000-000000000001'
const b = '00000000-0000-0000-0000-000000000002'
const stranger = '00000000-0000-0000-0000-000000000003'
const newcomer = '00000000-0000-0000-0000-000000000004'
const space = '10000000-0000-0000-0000-000000000001'
const other = '10000000-0000-0000-0000-000000000002'
const fresh = '10000000-0000-0000-0000-000000000003'
const profile = '20000000-0000-0000-0000-000000000001'
const otherProfile = '20000000-0000-0000-0000-000000000002'
const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url)
let db: PGlite

const seed = makeSeed()
const profileValue = seed.profiles[0].profile!

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    insert into auth.users values ('${a}'),('${b}'),('${stranger}'),('${newcomer}');
  `)
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    await db.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'))
  }
  await db.exec(`
    insert into public.workspaces(id,name) values
      ('${space}','HerFit'),('${other}','Other'),('${fresh}','Fresh');
    insert into public.workspace_members(workspace_id,user_id,seat) values
      ('${space}','${a}',1),('${space}','${b}',2),
      ('${other}','${stranger}',1),('${fresh}','${newcomer}',1);
    insert into public.health_profiles(id,workspace_id) values
      ('${profile}','${space}'),('${otherProfile}','${other}');
  `)
}, 60000)

afterAll(async () => {
  if (db) await db.close()
})

async function asUser(id: string | null, action: () => Promise<unknown>) {
  await db.exec(`begin; set local role ${id ? 'authenticated' : 'anon'};
    set local "request.jwt.claim.sub" = '${id ?? ''}';`)
  try {
    const result = await action()
    await db.exec('commit')
    return result
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}
type Snapshot = {
  workspaceId: string
  profiles: Array<{ id: string; slot: number; profile: { value: unknown; revision: number } }>
  habits: Array<{ value: Record<string, unknown> }>
  metrics: unknown[]
  workouts: Array<{ value: Record<string, unknown>; createdBy: string | null }>
  plans: Array<{ value: Record<string, unknown> }>
  settings: { value: { showWeight: boolean } } | null
}
function read() {
  return db
    .query<{ snapshot: Snapshot }>('select public.herfit_snapshot() as snapshot')
    .then((result) => result.rows[0].snapshot)
}
function write(
  kind: string,
  data: unknown,
  expected: number | null,
  target = space,
  targetProfile = profile,
) {
  return db
    .query<{ snapshot: Snapshot }>('select public.herfit_write($1,$2,$3,$4,$5) as snapshot', [
      target,
      targetProfile,
      kind,
      JSON.stringify(data),
      expected,
    ])
    .then((result) => result.rows[0].snapshot)
}

function planPayload(id: string, status: 'active' | 'archived' = 'active'): TrainingPlan {
  const result = generatePlan({
    age: 26,
    experience: '刚刚开始',
    weeklyDays: 3,
    sessionMinutes: 25,
    equipment: ['徒手', '哑铃', '弹力带'],
    restrictions: '',
    restrictionsConfirmed: true,
  })
  if (!result.ok) throw new Error(result.message)
  return {
    profileId: profile,
    id,
    version: 1,
    generatedAt: '2026-11-16T10:00:00.000Z',
    confirmedAt: status === 'active' ? '2026-11-16T10:01:00.000Z' : null,
    status,
    input: {
      age: 26,
      experience: '刚刚开始',
      weeklyDays: 3,
      sessionMinutes: 25,
      equipment: ['徒手', '哑铃', '弹力带'],
      restrictions: '',
    },
    days: result.days,
    notes: result.notes,
  }
}

it('shares two profile slots and rejects a stale edit', async () => {
  const empty = await asUser(a, read)
  expect(empty).toMatchObject({
    workspaceId: space,
    habits: [],
    metrics: [],
    workouts: [],
    plans: [],
  })
  expect(empty.profiles).toHaveLength(1)
  expect(empty.profiles[0]).toMatchObject({ slot: 1, profile: { value: null, revision: 1 } })

  await asUser(a, () => write('profile', { ...profileValue, name: '测试档案' }, 1))
  const filled = await asUser(b, read)
  expect(filled.profiles[0]).toMatchObject({
    profile: { value: { name: '测试档案' }, revision: 2, createdBy: a, updatedBy: a },
  })

  await expect(asUser(b, () => write('profile', profileValue, 1))).rejects.toMatchObject({
    code: '40001',
  })
  await asUser(b, () => write('profile', { ...profileValue, name: '成员 B 修改' }, 2))
  expect((await asUser(a, read)).profiles[0]).toMatchObject({
    profile: { value: { name: '成员 B 修改' }, revision: 3, createdBy: a, updatedBy: b },
  })
})

it('creates at most two profile slots per workspace', async () => {
  const first = '20000000-0000-0000-0000-000000000003'
  const second = '20000000-0000-0000-0000-000000000004'
  const third = '20000000-0000-0000-0000-000000000005'
  const one = await asUser(newcomer, () => write('profile', profileValue, null, fresh, first))
  expect(one.profiles.map((row) => row.slot)).toEqual([1])
  const two = await asUser(newcomer, () => write('profile', profileValue, null, fresh, second))
  expect(two.profiles.map((row) => row.slot)).toEqual([1, 2])
  await expect(
    asUser(newcomer, () => write('profile', profileValue, null, fresh, third)),
  ).rejects.toMatchObject({ code: '42501' })
})

it('rejects anonymous, cross-space access, self-enrollment, and forged audit writes', async () => {
  await expect(asUser(null, read)).rejects.toMatchObject({ code: '42501' })
  const foreign = await asUser(stranger, read)
  expect(foreign).toMatchObject({ workspaceId: other })
  expect(foreign.profiles[0]).toMatchObject({ profile: { value: null } })
  await expect(asUser(stranger, () => write('profile', profileValue, 3))).rejects.toMatchObject({
    code: '42501',
  })
  await expect(
    asUser(stranger, () =>
      db.query('insert into public.workspace_members(workspace_id,user_id,seat) values ($1,$2,2)', [
        space,
        stranger,
      ]),
    ),
  ).rejects.toMatchObject({ code: '42501' })
  await expect(
    asUser(a, () =>
      db.query('update public.health_profiles set updated_by=$1 where id=$2', [stranger, profile]),
    ),
  ).rejects.toMatchObject({ code: '42501' })
  await expect(
    asUser(a, () =>
      write(
        'habit',
        {
          date: '2026-11-16',
          water: 250,
          sleep: null,
          energy: null,
          meals: false,
          protein: false,
          plants: false,
        },
        null,
        space,
        otherProfile,
      ),
    ),
  ).rejects.toMatchObject({ code: '42501' })
})

it('serializes same-day updates, rejects invalid values, and isolates preferences', async () => {
  const habit = {
    date: '2026-11-16',
    water: 250,
    sleep: null,
    energy: null,
    meals: false,
    protein: false,
    plants: false,
  }
  await asUser(a, () => write('habit', habit, null))
  await expect(
    asUser(b, () => write('habit', { ...habit, water: 500 }, null)),
  ).rejects.toMatchObject({ code: '40001' })
  await asUser(b, () => write('habit', { ...habit, water: 500 }, 1))
  await expect(
    asUser(a, () => write('habit', { ...habit, water: 10001 }, 2)),
  ).rejects.toMatchObject({ code: '23514' })
  await asUser(a, () => write('settings', { showWeight: true }, null))
  const snapshot = await asUser(a, read)
  expect(snapshot).toMatchObject({
    settings: { value: { showWeight: true } },
    habits: [{ value: { water: 500 } }],
  })
  expect(snapshot.habits[0].value.profileId).toBe(profile)
  expect(await asUser(b, read)).toMatchObject({ settings: null })
})

it('stores per-set workout records, deduplicates retries, and blocks browser deletion', async () => {
  const log = { ...seed.workouts[0], id: '30000000-0000-0000-0000-000000000001' }
  await asUser(a, () => write('workout', log, null))
  const retried = await asUser(a, () => write('workout', log, null))
  expect(retried).toMatchObject({ workouts: [{ value: { id: log.id }, createdBy: a }] })
  const stored = retried.workouts[0].value as {
    exercises: Array<{ sets: Array<{ reps: number; done: boolean }> }>
  }
  expect(stored.exercises[0].sets).toHaveLength(2)
  expect(stored.exercises[0].sets[0]).toMatchObject({ reps: 10, done: true })

  await expect(
    asUser(b, () => write('workout', { ...log, minutes: 99 }, null)),
  ).rejects.toMatchObject({ code: '40001' })
  await expect(
    asUser(b, () =>
      write(
        'workout',
        {
          ...log,
          id: '30000000-0000-0000-0000-000000000002',
          exercises: [{ ...log.exercises[0], sets: [{ reps: 10, load: 0 }] }],
        },
        null,
      ),
    ),
  ).rejects.toMatchObject({ code: '23514' })
  await expect(
    asUser(b, () => db.query('delete from public.workout_logs where id=$1', [log.id])),
  ).rejects.toMatchObject({ code: '42501' })
})

it('keeps exactly one active plan per profile', async () => {
  const first = planPayload('40000000-0000-0000-0000-000000000001')
  await asUser(a, () => write('plan', first, null))
  let snapshot = await asUser(a, read)
  expect(snapshot.plans).toHaveLength(1)
  expect(snapshot.plans[0].value).toMatchObject({ status: 'active', profileId: profile })
  expect((snapshot.plans[0].value as { days: unknown[] }).days).toHaveLength(7)

  const second = planPayload('40000000-0000-0000-0000-000000000002')
  await asUser(b, () => write('plan', second, null))
  snapshot = await asUser(a, read)
  const active = snapshot.plans.filter((row) => row.value.status === 'active')
  expect(active).toHaveLength(1)
  expect(active[0].value.id).toBe(second.id)
  expect(snapshot.plans.some((row) => row.value.status === 'archived')).toBe(true)
})

it('rejects a malformed plan payload', async () => {
  const broken = { ...planPayload('40000000-0000-0000-0000-000000000003'), days: [] }
  await expect(asUser(a, () => write('plan', broken, null))).rejects.toMatchObject({
    code: '23514',
  })
})

it('lets only the author delete a record, and treats a retry as success', async () => {
  const log = { ...seed.workouts[0], id: '30000000-0000-0000-0000-000000000010' }
  await asUser(a, () => write('workout', log, null))
  const remove = () =>
    db.query<{ value: Snapshot }>('select public.herfit_delete_workout($1,$2,$3) as value', [
      space,
      profile,
      log.id,
    ])

  // 同空间的另一位成员不能删：不是作者，必须报错而不是静默成功
  await expect(asUser(b, remove)).rejects.toMatchObject({
    code: '42501',
    message: expect.stringContaining('not the record author'),
  })
  // 空间外的成员连成员资格都过不了
  await expect(asUser(stranger, remove)).rejects.toMatchObject({ code: '42501' })
  // 未登录一律拒绝
  await expect(asUser(null, remove)).rejects.toMatchObject({ code: '42501' })

  const after = await asUser(a, remove)
  expect(after.rows[0].value.workouts.some((row) => row.value.id === log.id)).toBe(false)
  // 记录已不在，重试按幂等成功处理
  const retried = await asUser(a, remove)
  expect(retried.rows[0].value.workouts.some((row) => row.value.id === log.id)).toBe(false)
})

it('removes data access when a workspace seat is revoked', async () => {
  await db.query('delete from public.workspace_members where workspace_id=$1 and user_id=$2', [
    space,
    b,
  ])
  try {
    expect(await asUser(b, read)).toBeNull()
    expect(
      await asUser(b, () =>
        db.query('select id from public.health_profiles where workspace_id=$1', [space]),
      ),
    ).toMatchObject({ rows: [] })
    await expect(asUser(b, () => write('profile', profileValue, 3))).rejects.toMatchObject({
      code: '42501',
    })
  } finally {
    await db.query(
      'insert into public.workspace_members(workspace_id,user_id,seat) values ($1,$2,2)',
      [space, b],
    )
  }
})
