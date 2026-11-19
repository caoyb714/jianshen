import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test'
import { makeSeed } from '../src/domain/seed'

const origin = 'https://herfit-stage2-test.supabase.co'
const users = {
  'a@example.invalid': '00000000-0000-4000-8000-000000000001',
  'b@example.invalid': '00000000-0000-4000-8000-000000000002',
  'outside@example.invalid': '00000000-0000-4000-8000-000000000003',
}
const space = '10000000-0000-4000-8000-000000000001'
const profile = '20000000-0000-4000-8000-000000000001'
const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url)
const migrations = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(new URL(name, MIGRATIONS), 'utf8'))

async function emulateSupabase(contexts: BrowserContext[]) {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    insert into auth.users values ${Object.values(users)
      .map((id) => `('${id}')`)
      .join(',')};
  `)
  for (const sql of migrations) await db.exec(sql)
  await db.exec(`
    insert into public.workspaces(id,name) values ('${space}','测试共享空间');
    insert into public.workspace_members(workspace_id,user_id,seat) values
      ('${space}','${users['a@example.invalid']}',1),('${space}','${users['b@example.invalid']}',2);
    insert into public.health_profiles(id,workspace_id) values ('${profile}','${space}');
  `)
  const tokens = new Map<string, string>()
  let queue = Promise.resolve()
  let failNextWrite = false
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST,GET,OPTIONS',
  }
  async function routeApi(route: Route) {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const reply = (json: unknown, status = 200) => route.fulfill({ status, headers, json })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/auth/v1/token') {
      const { email, password } = request.postDataJSON()
      if (!(email in users) || password !== 'test-only-pass')
        return reply({ error_code: 'invalid_credentials', msg: 'Invalid credentials' }, 400)
      const id = users[email as keyof typeof users]
      const expires_at = Math.floor(Date.now() / 1000) + 3600
      const token =
        'test.' +
        Buffer.from(JSON.stringify({ sub: id, exp: expires_at, role: 'authenticated' })).toString(
          'base64url',
        ) +
        '.signature'
      tokens.set(token, id)
      return reply({
        access_token: token,
        refresh_token: 'test-refresh-' + id,
        expires_at,
        expires_in: 3600,
        token_type: 'bearer',
        user: { id, email, aud: 'authenticated', role: 'authenticated' },
      })
    }
    const token = request.headers().authorization?.replace(/^Bearer /i, '') ?? ''
    if (path === '/auth/v1/logout') {
      tokens.delete(token)
      return route.fulfill({ status: 204, headers })
    }
    const uid = tokens.get(token)
    if (!uid) return reply({ code: '42501', message: 'not signed in' }, 401)
    const write = path.endsWith('/herfit_write')
    const planWrite = path.endsWith('/herfit_write_plan')
    const remove = path.endsWith('/herfit_delete_workout')
    if (!write && !planWrite && !remove && !path.endsWith('/herfit_snapshot'))
      return reply({ message: 'unexpected API route' }, 404)
    if ((write || planWrite || remove) && failNextWrite) {
      failNextWrite = false
      return reply({ code: '22000', message: 'test write rejection' }, 400)
    }
    const job = queue.then(async () => {
      await db.exec(
        `begin; set local role authenticated; set local "request.jwt.claim.sub" = '${uid}';`,
      )
      try {
        const args = write || planWrite || remove ? request.postDataJSON() : null
        const result = write
          ? await db.query<{ value: unknown }>(
              'select public.herfit_write($1,$2,$3,$4,$5) as value',
              [
                args.p_workspace,
                args.p_profile,
                args.p_kind,
                JSON.stringify(args.p_payload),
                args.p_expected,
              ],
            )
          : planWrite
            ? await db.query<{ value: unknown }>(
                'select public.herfit_write_plan($1,$2,$3,$4) as value',
                [args.p_workspace, args.p_profile, JSON.stringify(args.p_payload), args.p_expected],
              )
            : remove
              ? await db.query<{ value: unknown }>(
                  'select public.herfit_delete_workout($1,$2,$3) as value',
                  [args.p_workspace, args.p_profile, args.p_record],
                )
              : await db.query<{ value: unknown }>('select public.herfit_snapshot() as value')
        await db.exec('commit')
        await reply(result.rows[0].value)
      } catch (error) {
        await db.exec('rollback')
        const failure = error as { code: string; message: string }
        await reply(
          { code: failure.code, message: failure.message },
          failure.code === '42501' ? 403 : 400,
        )
      }
    })
    queue = job.catch(() => undefined)
    await job
  }
  for (const context of contexts) await context.route(origin + '/**', routeApi)
  return {
    close: async () => {
      await queue
      await db.close()
    },
    rejectNextWrite: () => {
      failNextWrite = true
    },
    /** 直接以某个成员身份写入一条训练记录，省去走完整训练流程 */
    seedWorkout: async (userId: string, id: string) => {
      const log = { ...makeSeed().workouts[0], profileId: profile, id }
      await db.exec(
        `begin; set local role authenticated; set local "request.jwt.claim.sub" = '${userId}';`,
      )
      try {
        await db.query('select public.herfit_write($1,$2,$3,$4,$5)', [
          space,
          profile,
          'workout',
          JSON.stringify(log),
          null,
        ])
        await db.exec('commit')
      } catch (error) {
        await db.exec('rollback')
        throw error
      }
    },
  }
}

async function login(page: Page, email: keyof typeof users) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '登录共享空间' })).toBeVisible()
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel('密码').fill('test-only-pass')
  await page.getByRole('button', { name: '登录', exact: true }).click()
}

test('two members share records, preserve failed forms and exclude outsiders', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.setTimeout(90000)
  const options = { viewport: testInfo.project.use.viewport }
  const partner = await browser.newContext(options)
  const stranger = await browser.newContext(options)
  const fixture = await emulateSupabase([context, partner, stranger])
  try {
    const b = await partner.newPage()
    const c = await stranger.newPage()
    await login(page, 'a@example.invalid')
    await expect(page.getByRole('heading', { name: '建立档案位 1' })).toBeVisible()
    await page.getByLabel('昵称').fill('测试档案')
    await page.getByLabel('年龄').fill('26')
    await page.getByLabel('身高（cm）').fill('165')
    await page.getByLabel('每周可安排天数').fill('3')
    await page.getByLabel('每次可安排分钟').fill('25')
    await page.getByLabel('我已检查并确认上述身体限制').check()
    await page.getByRole('button', { name: '保存共享档案' }).click()
    await expect(page.getByRole('heading', { name: '慢慢来，也在变好。' })).toBeVisible()
    await expect(page.getByTestId('water-total')).toHaveText('0 ml')
    await page.getByRole('button', { name: '记录 250 ml 饮水' }).click()
    await expect(page.getByRole('status')).toContainText('已保存到共享空间')
    await login(b, 'b@example.invalid')
    await expect(b.getByTestId('water-total')).toHaveText('250 ml')
    await b.goto('/records')
    await b.getByLabel('昨晚睡眠（小时）').fill('7.5')
    fixture.rejectNextWrite()
    await b.getByRole('button', { name: '保存睡眠' }).click()
    await expect(b.getByText('睡眠记录未获保存确认，输入已保留。')).toBeVisible()
    await expect(b.getByLabel('昨晚睡眠（小时）')).toHaveValue('7.5')
    await b.getByRole('button', { name: '保存睡眠' }).click()
    await expect(b.getByText('已保存：7.5 小时')).toBeVisible()
    await page.reload()
    await expect(page.getByText('7.5 小时')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('herfit.demo.v2'))).toBeNull()
    await login(c, 'outside@example.invalid')
    await expect(c.getByRole('alert')).toContainText('无法访问此共享空间')
    await expect(c.getByTestId('water-total')).toHaveCount(0)
    await b.goto('/me')
    await expect(b.getByRole('button', { name: '重新加载示例' })).toHaveCount(0)
    await b.getByRole('button', { name: '退出登录' }).click()
    await expect(b.getByRole('heading', { name: '登录共享空间' })).toBeVisible()
    await b.reload()
    await expect(b.getByRole('heading', { name: '登录共享空间' })).toBeVisible()
    await expect(b.getByText('测试档案')).toHaveCount(0)
  } finally {
    await partner.close()
    await stranger.close()
    await fixture.close()
  }
})

test('shares one record but lets only its author delete it', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.setTimeout(90000)
  const options = { viewport: testInfo.project.use.viewport }
  const partner = await browser.newContext(options)
  const fixture = await emulateSupabase([context, partner])
  try {
    const b = await partner.newPage()
    await login(page, 'a@example.invalid')
    await page.getByLabel('昵称').fill('测试档案')
    await page.getByLabel('年龄').fill('26')
    await page.getByLabel('身高（cm）').fill('165')
    await page.getByLabel('每周可安排天数').fill('3')
    await page.getByLabel('每次可安排分钟').fill('25')
    await page.getByLabel('我已检查并确认上述身体限制').check()
    await page.getByRole('button', { name: '保存共享档案' }).click()
    await expect(page.getByRole('heading', { name: '慢慢来，也在变好。' })).toBeVisible()

    await fixture.seedWorkout(users['a@example.invalid'], '30000000-0000-4000-8000-000000000001')
    await page.reload()
    await page.goto('/records')
    const mine = page.locator('.history-row').first()
    await mine.locator('summary').click()
    await expect(mine.getByRole('button', { name: '删除这条记录' })).toBeVisible()

    // 另一位成员能读到同一条记录，但没有删除入口
    await login(b, 'b@example.invalid')
    await b.goto('/records')
    const shared = b.locator('.history-row').first()
    await shared.locator('summary').click()
    await expect(shared.getByText('只有作者可以删除')).toBeVisible()
    await expect(shared.getByRole('button', { name: '删除这条记录' })).toHaveCount(0)

    await mine.getByRole('button', { name: '删除这条记录' }).click()
    await mine.getByRole('button', { name: '确认删除' }).click()
    await expect(page.getByText('已从共享空间删除这条记录')).toBeVisible()
    await expect(page.locator('.history-row')).toHaveCount(0)
    // 另一位成员刷新后看到同一条记录已消失
    await b.reload()
    await expect(b.locator('.history-row')).toHaveCount(0)
  } finally {
    await partner.close()
    await fixture.close()
  }
})

test('a stale plan write is rejected instead of overwriting the newer version', async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.setTimeout(90000)
  const second = await browser.newContext({ viewport: testInfo.project.use.viewport })
  const fixture = await emulateSupabase([context, second])
  try {
    const b = await second.newPage()
    await login(page, 'a@example.invalid')
    await page.getByLabel('昵称').fill('测试档案')
    await page.getByLabel('年龄').fill('26')
    await page.getByLabel('身高（cm）').fill('165')
    await page.getByLabel('每周可安排天数').fill('3')
    await page.getByLabel('每次可安排分钟').fill('25')
    await page.getByLabel('我已检查并确认上述身体限制').check()
    await page.getByRole('button', { name: '保存共享档案' }).click()

    await page.goto('/training')
    await page.getByRole('button', { name: '生成我的计划' }).click()
    await page.getByRole('button', { name: '确认使用此计划' }).click()
    await expect(page.getByText(/v1 · 生成于/)).toBeVisible()

    // 第二台设备用同一账号登录，看到同一份 v1
    await login(b, 'a@example.invalid')
    await b.goto('/training')
    await expect(b.getByText(/v1 · 生成于/)).toBeVisible()

    const editDay = async (target: Page) => {
      await target.locator('.week-plan > button').filter({ hasText: '分' }).first().click()
      await target
        .getByRole('dialog')
        .getByRole('button', { name: /保存为 v2/ })
        .click()
    }

    await editDay(page)
    await expect(page.getByText(/v2 · 生成于/)).toBeVisible()

    // 第二台仍停留在 v1：提交必须被拒，而不是把 A 的 v2 覆盖掉
    await editDay(b)
    await expect(b.locator('.toast')).toContainText('计划已在另一处更新')
    await expect(b.getByText(/v2 · 生成于/)).toBeVisible()
    // A 的版本没有被改写
    await page.reload()
    await expect(page.getByText(/v2 · 生成于/)).toBeVisible()
  } finally {
    await second.close()
    await fixture.close()
  }
})
