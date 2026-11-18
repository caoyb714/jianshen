import { describe, expect, it } from 'vitest'
import { buildBasisPayload, formatTarget } from '../src/domain/ai'
import type { PlanDay, Profile, Workout } from '../src/domain/model'
import { PROFILE_A } from '../src/domain/seed'

/** 敏感的原始字段全部塞进夹具：昵称、邮箱、id、创建时间都不允许出现在 payload 里。 */
const profile: Profile = {
  name: '小美',
  age: 28,
  height: 165,
  experience: '偶尔运动',
  activity: '大多坐着',
  goal: '养成运动习惯',
  weeklyDays: 3,
  sessionMinutes: 30,
  equipment: ['徒手', '哑铃'],
  dumbbell: '4 kg',
  band: '轻档',
  // 刻意混入 CRLF 与制表符：这些控制字符必须先被压成空格，不能原样发给模型
  restrictions: `膝部\r\n\r\n曾有不适\t需要避免深蹲到底。${'保持动作稳定。'.repeat(12)}`,
  restrictionsConfirmed: true,
}

const day: PlanDay = {
  index: 0,
  kind: '训练',
  focus: '推与核心',
  warmup: '肩部绕环 3 分钟',
  slots: [
    {
      exerciseId: 'goblet-squat',
      role: '主要',
      sets: 3,
      target: { type: 'reps', min: 8, max: 12 },
      restSeconds: 75,
      startLoad: 6,
    },
    {
      exerciseId: 'side-plank',
      role: '主要',
      sets: 2,
      target: { type: 'hold', seconds: 20 },
      restSeconds: 60,
      startLoad: 0,
    },
  ],
  estimatedMinutes: 30,
  note: '感觉吃力时减少一组。',
}

const items = [
  {
    sig: 'goblet-squat:increase:2.5',
    name: '哑铃高脚杯深蹲',
    label: '+2.5 kg',
    evidence: { reps: 12, load: 6, difficulty: 6 },
  },
]

function workout(date: string, minutes: number, difficulty: number): Workout {
  return {
    profileId: PROFILE_A,
    id: '6f8f0c1e-0000-4000-8000-000000000001',
    date,
    planId: 'plan-1',
    planVersion: 1,
    title: '推与核心',
    minutes,
    difficulty,
    discomfort: false,
    feeling: '',
    createdAt: `${date}T10:00:00.000Z`,
    exercises: [],
  }
}

describe('formatTarget', () => {
  it('次数、保持秒数、时长各用对应单位', () => {
    expect(formatTarget({ type: 'reps', min: 8, max: 12 })).toBe('8-12 次')
    expect(formatTarget({ type: 'hold', seconds: 20 })).toBe('20 秒')
    expect(formatTarget({ type: 'time', minMinutes: 8, maxMinutes: 8 })).toBe('8 分钟')
    expect(formatTarget({ type: 'time', minMinutes: 10, maxMinutes: 30 })).toBe('10-30 分钟')
  })
})

/** 递归收集所有键路径与字符串值，避免只看顶层键而漏掉嵌套 id。 */
function walk(value: unknown, path: string, keys: string[], strings: string[]): void {
  if (typeof value === 'string') {
    strings.push(`${path}=${value}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, keys, strings))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.push(`${path}.${key}`)
      walk(child, `${path}.${key}`, keys, strings)
    }
  }
}

function build(overrides: Partial<Parameters<typeof buildBasisPayload>[0]> = {}) {
  return buildBasisPayload({
    profile,
    day,
    planVersion: 3,
    items,
    workouts: [workout('2026-11-17', 30, 5)],
    today: '2026-11-17',
    ...overrides,
  })
}

describe('buildBasisPayload 白名单', () => {
  it('递归扫描所有键与字符串值，不含身份标识与体重', () => {
    const leaky = {
      ...workout('2026-11-17', 30, 5),
      email: 'me@example.com',
      workspaceId: 'ws-7c1e9a',
      nickname: '小美',
    } as Workout
    const payload = build({ workouts: [leaky] })

    const keys: string[] = []
    const strings: string[] = []
    walk(payload, 'payload', keys, strings)

    // 键名层面：不允许出现任何身份、主键或时间字段（动作名 name 属于白名单字段）
    for (const forbidden of [
      'profileId',
      'planId',
      'workspaceId',
      'createdAt',
      'email',
      'nickname',
      'generatedAt',
      'weight',
    ])
      expect(keys.filter((key) => key.endsWith(forbidden) || key.includes(forbidden))).toEqual([])

    // 值层面：昵称、邮箱、档案 id、训练记录 id、计划 id、ISO 时间戳都不许出现在任何字符串里
    const joined = strings.join('\n')
    for (const forbidden of [
      '小美',
      'me@example.com',
      PROFILE_A,
      '6f8f0c1e-0000-4000-8000-000000000001',
      'plan-1',
      'ws-7c1e9a',
      '2026-11-17T10:00:00.000Z',
    ])
      expect(joined).not.toContain(forbidden)

    // 白名单是封闭集合：新增字段必须显式通过这里，而不是悄悄随对象一起发出去
    expect(keys).toEqual([
      'payload.planVersion',
      'payload.profile',
      'payload.profile.age',
      'payload.profile.experience',
      'payload.profile.equipment',
      'payload.profile.restrictionsConfirmed',
      'payload.profile.restrictions',
      'payload.day',
      'payload.day.focus',
      'payload.day.slots',
      'payload.day.slots[0].name',
      'payload.day.slots[0].sets',
      'payload.day.slots[0].target',
      'payload.day.slots[0].role',
      'payload.day.slots[1].name',
      'payload.day.slots[1].sets',
      'payload.day.slots[1].target',
      'payload.day.slots[1].role',
      'payload.items',
      'payload.items[0].sig',
      'payload.items[0].name',
      'payload.items[0].label',
      'payload.items[0].evidence',
      'payload.items[0].evidence.reps',
      'payload.items[0].evidence.load',
      'payload.items[0].evidence.difficulty',
      'payload.recent',
      'payload.recent.workouts',
      'payload.recent.minutes',
      'payload.recent.avgDifficulty',
    ])
  })

  it('身体限制先压平控制字符再截到 80 字', () => {
    const { restrictions } = build().profile
    expect(restrictions).not.toMatch(/[\r\n\t]/)
    expect(restrictions.length).toBeLessThanOrEqual(80)
    expect(restrictions.startsWith('膝部 曾有不适 需要避免深蹲到底。')).toBe(true)
  })

  it('条目最多 6 条，超出的不会发出', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ ...items[0], sig: `sig-${index}` }))
    expect(build({ items: many }).items).toHaveLength(6)
  })

  it('近 7 天只统计区间内的记录', () => {
    const payload = build({
      workouts: [
        workout('2026-11-17', 30, 5),
        workout('2026-11-12', 20, 7),
        workout('2026-11-01', 40, 9),
      ],
    })
    expect(payload.recent).toEqual({ workouts: 2, minutes: 50, avgDifficulty: 6 })
  })
})
