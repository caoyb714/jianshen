#!/usr/bin/env node
/**
 * 把 dist 部署到 Cloudflare Pages。
 *
 * 前置：`.env.local` 已配置云端模式；`npx wrangler login` 已完成。
 * 用法：npm run deploy
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = process.env.HERFIT_PAGES_PROJECT || 'herfit'
const BRANCH = 'main'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })
  return result.status ?? 1
}

const envPath = join(root, '.env.local')
if (!existsSync(envPath)) {
  console.error('✗ 缺少 .env.local。部署前需要先接通云端，见 docs/GO-LIVE.md。')
  process.exit(1)
}
const env = readFileSync(envPath, 'utf8')
if (!/VITE_HERFIT_MODE\s*=\s*cloud/.test(env)) {
  console.error('✗ .env.local 不是云端模式，部署会得到一个空壳页面。')
  process.exit(1)
}
if (!/VITE_SUPABASE_URL\s*=\s*https:\/\//.test(env)) {
  console.error('✗ .env.local 缺少 VITE_SUPABASE_URL。')
  process.exit(1)
}

console.log('— 构建 —')
if (run('npm', ['run', 'build']) !== 0) process.exit(1)

console.log('\n— 确认登录状态 —')
const whoami = spawnSync('npx', ['wrangler', 'whoami'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
if (!/You are logged in/i.test(whoami.stdout ?? '')) {
  console.error('✗ 尚未登录 Cloudflare。先运行 npx wrangler login。')
  process.exit(1)
}
console.log('✓ 已登录')

console.log(`\n— 创建/确认 Pages 项目 ${PROJECT} —`)
const create = spawnSync(
  'npx',
  ['wrangler', 'pages', 'project', 'create', PROJECT, '--production-branch', BRANCH],
  { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' },
)
const createOut = `${create.stdout ?? ''}${create.stderr ?? ''}`
if (/already exists/i.test(createOut)) console.log(`✓ 项目已存在，直接复用`)
else if (create.status === 0) console.log(`✓ 已创建项目`)
else if (!/already exists/i.test(createOut)) {
  console.error(createOut.trim().slice(0, 400))
  process.exit(1)
}

console.log('\n— 上传 dist —')
if (
  run('npx', [
    'wrangler',
    'pages',
    'deploy',
    'dist',
    '--project-name',
    PROJECT,
    '--branch',
    BRANCH,
    '--commit-dirty=true',
  ]) !== 0
)
  process.exit(1)

console.log(`\n完成。地址形如 https://${PROJECT}.pages.dev`)
console.log(
  '手机上打开该地址，用 herfit.a@ 或 herfit.b@ 登录；建议 Safari/Chrome 里「添加到主屏幕」。',
)
