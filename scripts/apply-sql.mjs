#!/usr/bin/env node
/**
 * 逐条执行一个 SQL 迁移文件。
 *
 * Management API 的查询接口对多语句脚本的切分不可靠：函数体（$$...$$）里的分号
 * 会被切开，导致整份迁移静默不生效。这里自己做词法扫描，按语句边界提交。
 *
 * 用法：node scripts/apply-sql.mjs <文件路径> [--stop-on-error]
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 按分号切分语句，忽略字符串、标识符与 $$ 美元引用块内部的分号 */
export function splitStatements(sql) {
  const out = []
  let buffer = ''
  let i = 0
  let dollarTag = null

  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (dollarTag !== null) {
      if (ch === '$') {
        // 空标签（$$）与具名标签（$body$）都按同一规则闭合
        const close = `$${dollarTag}$`
        if (sql.startsWith(close, i)) {
          buffer += close
          i += close.length
          dollarTag = null
          continue
        }
      }
      buffer += ch
      i += 1
      continue
    }

    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      buffer += sql.slice(i, stop)
      i = stop
      continue
    }

    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      buffer += sql.slice(i, stop)
      i = stop
      continue
    }

    if (ch === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2
          continue
        }
        if (sql[j] === "'") break
        j += 1
      }
      buffer += sql.slice(i, j + 1)
      i = j + 1
      continue
    }

    if (ch === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          j += 2
          continue
        }
        if (sql[j] === '"') break
        j += 1
      }
      buffer += sql.slice(i, j + 1)
      i = j + 1
      continue
    }

    if (ch === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (match) {
        dollarTag = match[1] ?? ''
        buffer += match[0]
        i += match[0].length
        continue
      }
    }

    if (ch === ';') {
      const statement = buffer.trim()
      if (statement) out.push(statement)
      buffer = ''
      i += 1
      continue
    }

    buffer += ch
    i += 1
  }

  const tail = buffer.trim()
  if (tail) out.push(tail)
  return out
}

const DUPLICATE_CODES = ['42710', '42P07', '42701', '42P16']

function isTolerable(message) {
  return DUPLICATE_CODES.some((code) => message.includes(code)) || /already exists/i.test(message)
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('用法：node scripts/apply-sql.mjs <sql 文件>')
    process.exit(1)
  }
  const stopOnError = process.argv.includes('--stop-on-error')
  const path = file.startsWith('supabase') ? join(root, file) : file
  if (!existsSync(path)) {
    console.error(`找不到 ${path}`)
    process.exit(1)
  }

  const setupPath = join(root, '.env.setup.local')
  const env = Object.fromEntries(
    readFileSync(setupPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      }),
  )
  const token = env.SUPABASE_ACCESS_TOKEN
  const ref = process.env.HERFIT_PROJECT_REF || env.SUPABASE_PROJECT_REF
  if (!token) throw new Error('缺少 SUPABASE_ACCESS_TOKEN')
  if (!ref) throw new Error('缺少 SUPABASE_PROJECT_REF（写进 .env.setup.local 或设为环境变量）')

  const statements = splitStatements(readFileSync(path, 'utf8')).filter(
    (sql) => !/^(begin|commit)$/i.test(sql.trim()),
  )
  console.log(`共 ${statements.length} 条语句`)

  let skip = 0
  for (const [index, sql] of statements.entries()) {
    const label = sql.replace(/\s+/g, ' ').slice(0, 68)
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(60000),
    })
    if (response.ok) {
      console.log(`  ${String(index + 1).padStart(2, '0')} ✓ ${label}`)
      continue
    }
    const text = await response.text()
    if (isTolerable(text)) {
      skip += 1
      console.log(`  ${String(index + 1).padStart(2, '0')} · ${label}（已存在，跳过）`)
      continue
    }
    console.error(`  ${String(index + 1).padStart(2, '0')} ✗ ${label}`)
    console.error(`     ${text.slice(0, 400)}`)
    if (stopOnError) process.exit(1)
  }
  console.log(`完成：${statements.length - skip} 条执行，${skip} 条跳过`)
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('apply-sql.mjs')
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
