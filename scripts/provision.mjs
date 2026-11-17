#!/usr/bin/env node
/**
 * 用 Management API 开通 Supabase 项目，绕开打不开的网页控制台。
 *
 * 前提：在 .env.setup.local 里放一个 Personal Access Token（Account → Access Tokens）。
 *
 * 用法：
 *   node scripts/provision.mjs --dry-run   只列出组织与现有项目，不做任何修改
 *   node scripts/provision.mjs             建项目 → 取密钥 → 跑迁移 → 建两个账号 → 写 .env.local
 *
 * 令牌只从本地文件读取，不打印、不写入日志、不进入 Git。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const setupPath = join(root, '.env.setup.local')
const envPath = join(root, '.env.local')
const API = 'https://api.supabase.com/v1'
const DRY = process.argv.includes('--dry-run')
const PROJECT_NAME = 'herfit'

function readEnvFile(path) {
  if (!existsSync(path)) return null
  const env = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    env[trimmed.slice(0, index).trim()] = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return env
}

function die(message, detail) {
  console.error(`\n✗ ${message}`)
  if (detail) console.error('  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))
  process.exit(1)
}

const setup = readEnvFile(setupPath)
if (!setup) {
  die(
    '找不到 .env.setup.local',
    '需要 SUPABASE_ACCESS_TOKEN、SUPABASE_DB_PASSWORD，可选 SUPABASE_REGION / SUPABASE_ORG_ID',
  )
}
const token = setup.SUPABASE_ACCESS_TOKEN
if (!token || token.length < 20) die('SUPABASE_ACCESS_TOKEN 缺失或过短')
const dbPassword = setup.SUPABASE_DB_PASSWORD
if (!dbPassword || dbPassword.length < 12) die('SUPABASE_DB_PASSWORD 至少 12 位')
const region = setup.SUPABASE_REGION || 'ap-southeast-1'

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    const error = new Error(`${init.method ?? 'GET'} ${path} → ${response.status}`)
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

const randomPassword = () =>
  'Hf-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6) + '!7'

async function main() {
  console.log('— 账号与组织 —')
  const orgs = await api('/organizations')
  if (!Array.isArray(orgs) || orgs.length === 0) die('这个令牌看不到任何组织', orgs)
  const org =
    (setup.SUPABASE_ORG_ID && orgs.find((item) => item.id === setup.SUPABASE_ORG_ID)) || orgs[0]
  console.log(`✓ 组织 ${org.name}（${org.id}）`)

  const projects = await api('/projects')
  const existing = projects.find((item) => item.name === PROJECT_NAME)
  if (existing) {
    console.log(`✓ 已存在同名项目 ${existing.name}（${existing.id}），跳过创建`)
  }

  if (DRY) {
    console.log('\n现有项目：')
    for (const item of projects)
      console.log(`  ${item.name}  ${item.id}  ${item.region}  ${item.status}`)
    console.log('\n--dry-run 结束，未做任何修改。')
    return
  }

  let project = existing
  if (!project) {
    console.log(`\n— 创建项目（${region}）—`)
    project = await api('/projects', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: org.id,
        name: PROJECT_NAME,
        region,
        db_pass: dbPassword,
      }),
    })
    console.log(`✓ 已提交创建：${project.id}`)
  }

  const ref = project.id
  const url = `https://${ref}.supabase.co`

  console.log('\n— 等待项目就绪（最多 6 分钟）—')
  const deadline = Date.now() + 6 * 60 * 1000
  let status = project.status
  while (status !== 'ACTIVE_HEALTHY') {
    if (Date.now() > deadline) die(`项目状态仍是 ${status}，请稍后在控制台确认后重跑`)
    await new Promise((resolve) => setTimeout(resolve, 10000))
    const list = await api('/projects')
    status = list.find((item) => item.id === ref)?.status
    process.stdout.write(`  ${status}\r`)
  }
  console.log(`\n✓ 项目就绪 ${url}`)

  console.log('\n— 读取密钥 —')
  const keys = await api(`/projects/${ref}/api-keys`)
  let publishable = keys.find((item) => String(item.api_key ?? '').startsWith('sb_publishable_'))
  // Auth 管理接口只接受带 service_role 角色的 JWT；新的 sb_secret_ 仅作兜底
  const jwtRole = (value) => {
    try {
      return JSON.parse(Buffer.from(String(value).split('.')[1], 'base64url')).role
    } catch {
      return null
    }
  }
  const secret =
    keys.find((item) => jwtRole(item.api_key) === 'service_role') ??
    keys.find((item) => String(item.api_key ?? '').startsWith('sb_secret_'))
  if (!publishable) {
    try {
      publishable = await api(`/projects/${ref}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ type: 'publishable', name: 'herfit' }),
      })
      console.log('✓ 已创建 publishable key')
    } catch (error) {
      die('项目没有 publishable key，也无法自动创建', error.body)
    }
  } else {
    console.log('✓ 已有 publishable key')
  }
  if (!secret)
    die(
      '找不到服务端密钥，无法创建账号',
      keys.map((item) => item.type ?? item.name),
    )

  console.log('\n— 应用迁移（幂等）—')
  const probe = await api(`/projects/${ref}/database/query`, {
    method: 'POST',
    body: JSON.stringify({
      query:
        "select (to_regclass('public.health_profiles') is not null) as v1, (to_regclass('public.training_plans') is not null) as v2",
    }),
  })
  const state = (Array.isArray(probe) ? probe[0] : probe) ?? {}
  const migrations = [
    ['supabase/migrations/20261116000100_shared_workspace.sql', state.v1 === true],
    ['supabase/migrations/20261116000200_stage3_profiles_plans.sql', state.v2 === true],
  ]
  for (const [file, applied] of migrations) {
    if (applied) {
      console.log(`· ${file.split('/').pop()} 已应用，跳过`)
      continue
    }
    const sql = readFileSync(join(root, file), 'utf8')
      .replace(/^\s*begin;\s*/i, '')
      .replace(/\s*commit;\s*$/i, '')
    await api(`/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({ query: sql }),
    })
    console.log(`✓ ${file.split('/').pop()}`)
  }

  console.log('\n— 创建两个账号 —')
  const serviceKey = secret.api_key
  const accounts = []
  for (const slot of ['A', 'B']) {
    const email = setup[`HERFIT_USER_${slot}_EMAIL`] || `herfit.${slot.toLowerCase()}@herfit.local`
    const password = setup[`HERFIT_USER_${slot}_PASSWORD`] || randomPassword()
    const response = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
      signal: AbortSignal.timeout(30000),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      if (String(body?.msg ?? '').includes('already')) {
        console.log(`! ${email} 已存在，跳过`)
        continue
      }
      die(`创建 ${email} 失败`, body)
    }
    accounts.push({ email, password, id: body.id })
    console.log(`✓ ${email}`)
  }

  // 已存在的账号拿不到创建响应里的 id，统一从用户列表补齐
  const wanted = ['A', 'B'].map(
    (slot) => setup[`HERFIT_USER_${slot}_EMAIL`] || `herfit.${slot.toLowerCase()}@herfit.local`,
  )
  const listed = await fetch(`${url}/auth/v1/admin/users?per_page=100`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(30000),
  })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
  const users = Array.isArray(listed?.users) ? listed.users : []
  const resolved = wanted.map((email) => {
    const known = accounts.find((item) => item.email === email)
    const found = users.find((item) => item.email === email)
    return { email, id: known?.id ?? found?.id, password: known?.password }
  })

  if (resolved.every((item) => item.id)) {
    console.log('\n— 绑定共享空间 —')
    const bound = await api(`/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({
        query: 'select count(*)::int as members from public.workspace_members',
      }),
    })
    const members = (Array.isArray(bound) ? bound[0] : bound)?.members ?? 0
    if (members >= 2) {
      console.log('· 空间已有两位成员，跳过绑定')
    } else {
      const bootstrap = readFileSync(join(root, 'supabase/bootstrap-example.sql'), 'utf8')
        .replace('00000000-0000-0000-0000-000000000001', resolved[0].id)
        .replace('00000000-0000-0000-0000-000000000002', resolved[1].id)
      await api(`/projects/${ref}/database/query`, {
        method: 'POST',
        body: JSON.stringify({ query: bootstrap }),
      })
      console.log('✓ 空间与两个档案位已建立')
    }
  }

  console.log('\n— 关闭公开注册 —')
  try {
    await api(`/projects/${ref}/config/auth`, {
      method: 'PATCH',
      body: JSON.stringify({ disable_signup: true, mailer_autoconfirm: false }),
    })
    console.log('✓ 已关闭 signup')
  } catch (error) {
    console.log(`! 未能自动关闭 signup（${error.status}），请在控制台手动关闭`)
  }

  writeFileSync(
    envPath,
    [
      'VITE_HERFIT_MODE=cloud',
      `VITE_SUPABASE_URL=${url}`,
      `VITE_SUPABASE_PUBLISHABLE_KEY=${publishable.api_key}`,
      '',
    ].join('\n'),
    'utf8',
  )
  console.log(`\n✓ 已写入 .env.local`)

  console.log('\n— 账号（请立即保存，密码只显示一次）—')
  for (const account of resolved)
    console.log(`  ${account.email}  /  ${account.password ?? '（本次未重置，沿用上次的密码）'}`)
  console.log(`\n下一步：npm run verify:cloud，然后 npm run dev 登录。`)
}

main().catch((error) => die(error.message, error.body))
