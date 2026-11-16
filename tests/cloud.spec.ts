import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test'

const origin = 'https://herfit-stage2-test.supabase.co'
const users = {
  'a@example.invalid': '00000000-0000-4000-8000-000000000001',
  'b@example.invalid': '00000000-0000-4000-8000-000000000002',
  'outside@example.invalid': '00000000-0000-4000-8000-000000000003',
}
const space = '10000000-0000-4000-8000-000000000001'
const profile = '20000000-0000-4000-8000-000000000001'
const migration = readFileSync(
  new URL('../supabase/migrations/20261116000100_shared_workspace.sql', import.meta.url),
  'utf8',
)

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
  await db.exec(migration)
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
    if (!write && !path.endsWith('/herfit_snapshot'))
      return reply({ message: 'unexpected API route' }, 404)
    if (write && failNextWrite) {
      failNextWrite = false
      return reply({ code: '22000', message: 'test write rejection' }, 400)
    }
    const job = queue.then(async () => {
      await db.exec(
        `begin; set local role authenticated; set local "request.jwt.claim.sub" = '${uid}';`,
      )
      try {
        const args = write ? request.postDataJSON() : null
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
  const options = { viewport: testInfo.project.use.viewport }
  const partner = await browser.newContext(options)
  const stranger = await browser.newContext(options)
  const fixture = await emulateSupabase([context, partner, stranger])
  try {
    const b = await partner.newPage()
    const c = await stranger.newPage()
    await login(page, 'a@example.invalid')
    await expect(page.getByRole('heading', { name: '建立共享健康档案' })).toBeVisible()
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
    expect(await page.evaluate(() => localStorage.getItem('herfit.demo.v1'))).toBeNull()
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
