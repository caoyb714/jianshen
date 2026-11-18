#!/usr/bin/env node
/**
 * 云端接通自检。
 *
 * 用法：npm run verify:cloud
 *
 * 只读取 .env.local 里的 URL 与 publishable key，不读取、不打印任何密钥。
 * 检查项：配置格式 → 认证服务 → 数据接口 → 迁移是否已应用。
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env.local')

const REQUIRED_TABLES = [
  'workspaces',
  'workspace_members',
  'health_profiles',
  'habit_logs',
  'body_metrics',
  'workout_logs',
  'training_plans',
  'app_settings',
]
// PostgREST 按参数名匹配函数；探测 herfit_write 必须给出完整形参名，否则会误判为缺失
const REQUIRED_RPCS = {
  herfit_snapshot: '{}',
  herfit_write: JSON.stringify({
    p_workspace: null,
    p_profile: null,
    p_kind: null,
    p_payload: null,
    p_expected: null,
  }),
  herfit_delete_workout: JSON.stringify({
    p_workspace: null,
    p_profile: null,
    p_record: null,
  }),
  herfit_write_plan: JSON.stringify({
    p_workspace: null,
    p_profile: null,
    p_payload: null,
    p_expected: null,
  }),
}

function fail(message, hint) {
  console.error(`\n✗ ${message}`)
  if (hint) console.error(`  ${hint}`)
  process.exitCode = 1
}

function readEnv() {
  if (!existsSync(envPath)) {
    fail('找不到 .env.local', '复制 .env.example 为 .env.local，填入三项后重试。')
    return null
  }
  const env = {}
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

async function get(url, key, path) {
  const response = await fetch(`${url}${path}`, {
    headers: key ? { apikey: key, Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  return { status: response.status, text }
}

const env = readEnv()
if (env) {
  const mode = env.VITE_HERFIT_MODE
  const url = (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''

  console.log('— 配置检查 —')
  if (mode !== 'cloud')
    fail('VITE_HERFIT_MODE 不是 cloud', '改成 VITE_HERFIT_MODE=cloud 才会进入共享模式。')
  else console.log('✓ VITE_HERFIT_MODE=cloud')

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))
    fail(
      `VITE_SUPABASE_URL 不像项目地址：${url || '(空)'}`,
      '形如 https://abcdefghijklmnop.supabase.co',
    )
  else console.log(`✓ 项目地址 ${url}`)

  if (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ'))
    fail(
      'VITE_SUPABASE_PUBLISHABLE_KEY 格式不对',
      '应为 sb_publishable_… 开头的公开密钥；不要填 service_role。',
    )
  else if (key.includes('service_role'))
    fail('检测到 service_role', '前端只能使用 publishable key，请立即在控制台轮换该密钥。')
  else console.log(`✓ 公开密钥 ${key.slice(0, 18)}…（长度 ${key.length}）`)

  if (url && key && !process.exitCode) {
    console.log('\n— 连通性 —')
    try {
      const health = await get(url, key, '/auth/v1/health')
      if (health.status === 200) console.log('✓ 认证服务可访问')
      else fail(`认证服务返回 ${health.status}`, health.text.slice(0, 160))
    } catch (error) {
      fail('无法连接认证服务', `${error.name}: ${error.message}`)
    }

    console.log('\n— 迁移检查 —')
    // PostgREST 对「存在但未授权」返回 401，对「不存在」返回 404（PGRST202/205）。
    // 因此只用公开密钥即可判断迁移是否落地，不需要 secret key。
    const missingTables = []
    for (const table of REQUIRED_TABLES) {
      const result = await get(url, key, `/rest/v1/${table}?select=*&limit=0`)
      if (result.status === 404) missingTables.push(table)
      else if (result.status >= 500)
        fail(`${table} 探测异常 ${result.status}`, result.text.slice(0, 160))
    }
    if (missingTables.length)
      fail(`缺少表：${missingTables.join('、')}`, '迁移尚未应用，见 docs/GO-LIVE.md 第 3 步。')
    else console.log(`✓ ${REQUIRED_TABLES.length} 张表齐全`)

    const missingRpcs = []
    for (const [rpc, body] of Object.entries(REQUIRED_RPCS)) {
      const result = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15000),
      })
      if (result.status === 404) missingRpcs.push(rpc)
    }
    if (missingRpcs.length)
      fail(`缺少函数：${missingRpcs.join('、')}`, '迁移尚未应用，见 docs/GO-LIVE.md 第 3 步。')
    else
      console.log(
        '✓ herfit_snapshot / herfit_write / herfit_write_plan / herfit_delete_workout 已就绪',
      )

    if (!process.exitCode) {
      console.log('\n全部通过。运行 npm run dev，用预先创建的账号登录即可。')
      console.log('注意：本脚本只验证结构与连通性，不验证登录、RLS 越权与真实读写。')
    }
  }
}
