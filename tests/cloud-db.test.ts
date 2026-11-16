import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { makeSeed } from '../src/domain/seed'

const a = '00000000-0000-0000-0000-000000000001'
const b = '00000000-0000-0000-0000-000000000002'
const stranger = '00000000-0000-0000-0000-000000000003'
const space = '10000000-0000-0000-0000-000000000001'
const other = '10000000-0000-0000-0000-000000000002'
const profile = '20000000-0000-0000-0000-000000000001'
const otherProfile = '20000000-0000-0000-0000-000000000002'
const migration = new URL(
  '../supabase/migrations/20261116000100_shared_workspace.sql',
  import.meta.url,
)
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    insert into auth.users values ('${a}'),('${b}'),('${stranger}');
  `)
  await db.exec(readFileSync(migration, 'utf8'))
  await db.exec(`
    insert into public.workspaces(id,name) values ('${space}','HerFit'),('${other}','Other');
    insert into public.workspace_members(workspace_id,user_id,seat) values
      ('${space}','${a}',1),('${space}','${b}',2),('${other}','${stranger}',1);
    insert into public.health_profiles(id,workspace_id) values ('${profile}','${space}'),('${otherProfile}','${other}');
  `)
}, 30000)
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
function read() {
  return db
    .query<{ snapshot: Record<string, unknown> }>('select public.herfit_snapshot() as snapshot')
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
    .query<{ snapshot: Record<string, unknown> }>(
      'select public.herfit_write($1,$2,$3,$4,$5) as snapshot',
      [target, targetProfile, kind, JSON.stringify(data), expected],
    )
    .then((result) => result.rows[0].snapshot)
}

it('starts empty and shares a profile, but rejects a concurrent stale edit', async () => {
  expect(await asUser(a, read)).toMatchObject({
    workspaceId: space,
    profile: { value: null, revision: 1 },
    habits: [],
    metrics: [],
    workouts: [],
  })
  await asUser(a, () => write('profile', { ...makeSeed().profile, name: '测试档案' }, 1))
  expect(await asUser(b, read)).toMatchObject({
    profile: { value: { name: '测试档案' }, revision: 2, createdBy: a, updatedBy: a },
  })
  await expect(asUser(b, () => write('profile', makeSeed().profile, 1))).rejects.toMatchObject({
    code: '40001',
  })
  await asUser(b, () => write('profile', { ...makeSeed().profile, name: '成员 B 修改' }, 2))
  expect(await asUser(a, read)).toMatchObject({
    profile: { value: { name: '成员 B 修改' }, revision: 3, createdBy: a, updatedBy: b },
  })
})
it('rejects anonymous, cross-space access, self-enrollment, and forged audit writes', async () => {
  await expect(asUser(null, read)).rejects.toMatchObject({ code: '42501' })
  expect(await asUser(stranger, read)).toMatchObject({
    workspaceId: other,
    profile: { value: null },
  })
  await expect(
    asUser(stranger, () => write('profile', makeSeed().profile, 3)),
  ).rejects.toMatchObject({ code: '42501' })
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
  expect(await asUser(a, read)).toMatchObject({
    settings: { value: { showWeight: true } },
    habits: [{ value: { water: 500 }, updatedBy: b }],
  })
  expect(await asUser(b, read)).toMatchObject({ settings: null })
})
it('deduplicates retried workouts and blocks browser deletion', async () => {
  const log = { ...makeSeed().workouts[0], id: '30000000-0000-0000-0000-000000000001' }
  await asUser(a, () => write('workout', log, null))
  const result = await asUser(a, () => write('workout', log, null))
  expect(result).toMatchObject({ workouts: [{ value: { id: log.id }, createdBy: a }] })
  await expect(
    asUser(b, () => write('workout', { ...log, minutes: 99 }, null)),
  ).rejects.toMatchObject({ code: '40001' })
  await expect(
    asUser(b, () => db.query('delete from public.workout_logs where id=$1', [log.id])),
  ).rejects.toMatchObject({ code: '42501' })
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
    await expect(asUser(b, () => write('profile', makeSeed().profile, 3))).rejects.toMatchObject({
      code: '42501',
    })
  } finally {
    await db.query(
      'insert into public.workspace_members(workspace_id,user_id,seat) values ($1,$2,2)',
      [space, b],
    )
  }
})
