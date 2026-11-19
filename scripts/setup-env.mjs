import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 配置文件查找顺序：显式指定 → 用户目录 → 仓库目录（仅兼容旧位置）。
 *
 * 为什么要有第二处：`.env.setup.local` 里是 service token、数据库密码和模型 Key，
 * 放在仓库目录里虽然被 gitignore 挡住，但整目录打包或共享时会一起带走。
 * 推荐位置是 `%USERPROFILE%\.herfit\.env.setup.local`。
 */
export function setupEnvCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || homedir()
  return [
    process.env.HERFIT_SETUP_ENV,
    home ? join(home, '.herfit', '.env.setup.local') : null,
    join(root, '.env.setup.local'),
  ].filter(Boolean)
}

export function resolveSetupEnv() {
  return setupEnvCandidates().find((path) => existsSync(path)) ?? null
}

/** 键值解析：忽略空行与注释，去掉包裹的引号 */
export function parseEnv(raw) {
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
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

/**
 * 读取 setup 环境变量。
 * 落在仓库目录时给一条警告，提醒把文件搬到用户目录。
 */
export function readSetupEnv() {
  const path = resolveSetupEnv()
  if (!path) return { path: null, env: null }
  if (path === join(root, '.env.setup.local')) {
    console.warn(
      '⚠ 仍在读取仓库目录里的 .env.setup.local。建议移到 %USERPROFILE%\\.herfit\\ 后删除旧文件。',
    )
  }
  return { path, env: parseEnv(readFileSync(path, 'utf8')) }
}
