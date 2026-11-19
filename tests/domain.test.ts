import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { localDate, weekDates, weekdayIndex } from '../src/domain/dates'
import {
  alternativeIds,
  alternativesFor,
  exercises,
  getExercise,
  loadHint,
} from '../src/domain/exercises'
import { readJson, removeKey, writeJson } from '../src/app/storage'
import { loadData, saveData, STORAGE_KEY } from '../src/domain/repository'
import { makeSeed, PROFILE_A } from '../src/domain/seed'
import { applyChange } from '../src/domain/change'
import { generatePlan } from '../src/domain/engine'
import { trainingPlanSchema } from '../src/domain/model'
import { summarize, weeklyReview, latestWeights } from '../src/domain/stats'

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

function memory(initial: string | null = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    removeItem: () => {
      value = null
    },
  }
}
describe('weekdayIndex 单一实现', () => {
  // 重构前 Training.tsx 与 Workout.tsx 各自内联了一份完全相同的换算：
  // (new Date(`${date}T12:00:00`).getDay() + 6) % 7
  const original = (date: string) => (new Date(`${date}T12:00:00`).getDay() + 6) % 7

  it('周一为 0、周日为 6，且与重构前的内联实现逐日等价', () => {
    expect(weekdayIndex('2026-11-16')).toBe(0) // 周一
    expect(weekdayIndex('2026-11-17')).toBe(1)
    expect(weekdayIndex('2026-11-21')).toBe(5) // 周六
    expect(weekdayIndex('2026-11-22')).toBe(6) // 周日
    for (let offset = 0; offset < 14; offset += 1) {
      const date = new Date(2026, 10, 16 + offset, 12)
      const text = localDate(date)
      expect(weekdayIndex(text)).toBe(original(text))
      expect(weekdayIndex(text)).toBeGreaterThanOrEqual(0)
      expect(weekdayIndex(text)).toBeLessThanOrEqual(6)
    }
  })

  it('跨月、跨年与闰日都与内联实现一致', () => {
    for (const date of [
      '2026-10-31', // 周六，月末
      '2026-11-01', // 周日，跨月
      '2026-12-01', // 周二，跨月
      '2026-12-31', // 周四，年末
      '2027-01-01', // 周五，跨年
      '2028-02-29', // 闰日
      '2024-03-01', // 闰年 2 月之后
    ])
      expect(weekdayIndex(date)).toBe(original(date))
  })

  it('两个页面都只引用 dates.ts 的实现，没有各留一份', () => {
    for (const page of ['pages/Training.tsx', 'pages/Workout.tsx']) {
      const text = source(page)
      expect(text).toMatch(/import \{[^}]*weekdayIndex[^}]*\} from '\.\.\/domain\/dates'/)
      expect(text).not.toContain('function weekdayIndex')
      expect(text).not.toContain('% 7')
    }
  })
})

describe('loadHint 按器械给出口径', () => {
  it('哑铃写重量 kg、弹力带写阻力档、其余写负重', () => {
    const dumbbell = getExercise('goblet-squat')
    const band = getExercise('band-squat')
    const bodyweight = getExercise('bodyweight-squat')
    if (!dumbbell || !band || !bodyweight) throw new Error('动作库夹具缺失')
    expect(loadHint(dumbbell)).toBe('重量 kg')
    expect(loadHint(band)).toBe('阻力档')
    expect(loadHint(bodyweight)).toBe('负重')
  })

  it('Workout 页面复用同一个实现，没有本地副本', () => {
    const text = source('pages/Workout.tsx')
    expect(text).toMatch(/import \{[^}]*loadHint[^}]*\} from '\.\.\/domain\/exercises'/)
    expect(text).not.toContain('function loadHint')
    expect(text).not.toContain('阻力档')
  })
})

describe('storage.ts 的降级行为', () => {
  it('隐私模式下存储抛错不崩溃，读返回 null、写与删返回 false', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(() => readJson('k', broken)).not.toThrow()
    expect(readJson('k', broken)).toBeNull()
    expect(writeJson('k', { a: 1 }, broken)).toBe(false)
    expect(removeKey('k', broken)).toBe(false)
  })

  it('存储整体不可用时同样安静降级', () => {
    expect(readJson('k', null)).toBeNull()
    expect(writeJson('k', 1, null)).toBe(false)
    expect(removeKey('k', null)).toBe(false)
  })

  it('读写往返与损坏内容', () => {
    let value: string | null = null
    const memory = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next
      },
      removeItem: () => {
        value = null
      },
    }
    expect(writeJson('k', { a: 1 }, memory)).toBe(true)
    expect(readJson('k', memory)).toEqual({ a: 1 })
    value = '{broken'
    expect(readJson('k', memory)).toBeNull()
    expect(removeKey('k', memory)).toBe(true)
    expect(value).toBeNull()
  })
})

describe('本机存储键名保持不变', () => {
  it('三个既有键名逐字未改', () => {
    expect(STORAGE_KEY).toBe('herfit.demo.v2')
    expect(source('pages/Workout.tsx')).toContain("const DRAFT_KEY = 'herfit.workoutDraft.v1'")
    expect(source('app/Store.tsx')).toContain("export const ACTIVE_KEY = 'herfit.activeProfile'")
  })
})

describe('Growth 图表配置提取后数值不变', () => {
  // 对照 git diff：抽取前三个图表各自内联，取值必须逐字一致，否则视觉会悄悄漂移
  it('margin / 网格 / 坐标轴 / Tooltip 取值与重构前完全相同', () => {
    const text = source('pages/Growth.tsx')
    const compact = text.replace(/\s+/g, ' ')
    for (const expected of [
      'const CHART_MARGIN = { top: 12, right: 15, left: -20, bottom: 0 }',
      "strokeDasharray: '3 5', vertical: false, stroke: '#EDE5E7'",
      "fill: '#73636D', fontSize: 12",
      "border: '1px solid #E7DADF', borderRadius: 12, color: '#494047'",
    ])
      expect(compact).toContain(expected)
    // 三张图都必须引用同一套常量，不允许任何一处回退成内联字面量
    expect(compact.match(/margin=\{CHART_MARGIN\}/g)).toHaveLength(3)
    expect(compact.match(/<CartesianGrid \{\.\.\.GRID_PROPS\} \/>/g)).toHaveLength(3)
    expect(compact.match(/tick=\{AXIS_TICK\}/g)).toHaveLength(6)
    expect(compact.match(/<Tooltip \{\.\.\.TOOLTIP_PROPS\}/g)).toHaveLength(3)
  })
})

describe('local date boundaries', () => {
  it('uses local calendar date rather than UTC', () => {
    expect(localDate(new Date(2026, 10, 16, 0, 5))).toBe('2026-11-16')
  })
  it('keeps Sunday in the ending week across month boundary', () => {
    expect(weekDates(new Date(2026, 10, 1, 12))).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ])
  })
})
describe('demo persistence', () => {
  it('round trips validated data', () => {
    const storage = memory(),
      data = makeSeed(new Date(2026, 10, 16, 12))
    saveData(storage, data)
    expect(loadData(storage).data).toEqual(data)
  })
  it('does not overwrite corrupt data', () => {
    const storage = memory('{broken')
    expect(loadData(storage).error).toBeTruthy()
    expect(storage.getItem()).toBe('{broken')
  })
  it('rejects unsupported versions', () => {
    expect(loadData(memory('{"version":99}')).error).toBeTruthy()
  })
  it('does not swallow storage failures', () => {
    const storage = {
      ...memory(),
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => saveData(storage, makeSeed())).toThrow()
  })
})
describe('删除训练记录', () => {
  it('只移除指定档案的那一条，重复执行不再改变数据', () => {
    const data = makeSeed(),
      target = data.workouts[0]
    // 同 id 但归属另一个档案：删除必须按 profileId 限定，不能误删
    const twin = { ...target, profileId: 'profile-b' },
      seeded = { ...data, workouts: [...data.workouts, twin] },
      change = { kind: 'deleteWorkout' as const, profileId: target.profileId, id: target.id }
    const once = applyChange(seeded, change)
    expect(once.workouts).toHaveLength(seeded.workouts.length - 1)
    expect(once.workouts.some((row) => row.profileId === 'profile-b' && row.id === target.id)).toBe(
      true,
    )
    expect(applyChange(once, change).workouts).toEqual(once.workouts)
  })
})
describe('体重派生', () => {
  const metric = (date: string, weight: number | null) => ({
    profileId: PROFILE_A,
    id: `m-${date}`,
    date,
    weight,
    waist: null,
    hip: null,
  })
  it('只取有效体重，按日期倒序，忽略 null、0 与 20 以下的旧值', () => {
    const rows = [
      metric('2026-11-01', 55),
      metric('2026-11-05', 54.5),
      metric('2026-11-08', 19.9),
      metric('2026-11-10', 0),
      metric('2026-11-20', null),
    ]
    expect(latestWeights(rows).map((row) => row.weight)).toEqual([54.5, 55])
    expect(latestWeights(rows, 1).map((row) => row.date)).toEqual(['2026-11-05'])
    expect(latestWeights([])).toEqual([])
  })
})

describe('derived progress', () => {
  it('does not invent growth for an empty history', () => {
    const data = makeSeed()
    data.workouts = []
    data.habits = []
    data.metrics = []
    expect(summarize(data, 7).sessions).toBe(0)
    expect(summarize(data, 7).sleepAverage).toBeNull()
  })
  it('counts partial and stopped sessions separately from completed ones', () => {
    const date = new Date(2026, 10, 16, 12),
      data = makeSeed(date)
    data.workouts = [
      {
        profileId: PROFILE_A,
        id: '11111111-1111-4111-8111-111111111111',
        date: '2026-11-16',
        planId: 'plan',
        planVersion: 1,
        title: 'test',
        minutes: 5,
        difficulty: 4,
        discomfort: true,
        feeling: '停止',
        exercises: [],
        createdAt: date.toISOString(),
      },
    ]
    expect(summarize(data, 7, date).sessions).toBe(0)
    expect(summarize(data, 7, date).minutes).toBe(5)
  })
})

describe('周复盘', () => {
  const base = { targetDays: 3, sessions: 2, minutes: 55, sleepAverage: 7.25, waterAverage: 1450 }

  it('达标时给出保持的语气', () => {
    const text = weeklyReview({ ...base, activeDays: 3 })
    expect(text).toContain('这周练了 3 天（目标 3 天）')
    expect(text).toContain('平均每次 28 分钟')
    expect(text).toContain('睡眠平均 7.3 小时')
    expect(text).toContain('饮水日均 1450 ml')
    expect(text).toContain('节奏保持住就行')
  })

  it('未达标时不催促补练', () => {
    expect(weeklyReview({ ...base, activeDays: 1 })).toContain('不用补练')
  })

  it('没有记录时只陈述事实', () => {
    const text = weeklyReview({
      activeDays: 0,
      targetDays: 3,
      sessions: 0,
      minutes: 0,
      sleepAverage: null,
      waterAverage: null,
    })
    expect(text).toBe('这周还没有完成训练。从下一次开始就好。')
  })
})

describe('计划的可追溯字段', () => {
  const base = {
    profileId: PROFILE_A,
    id: '55555555-5555-4555-8555-555555555555',
    version: 2,
    generatedAt: '2026-11-18T10:00:00.000Z',
    confirmedAt: '2026-11-18T10:00:00.000Z',
    status: 'active' as const,
    input: {
      age: 28,
      experience: '偶尔运动' as const,
      weeklyDays: 3,
      sessionMinutes: 30,
      equipment: ['徒手'] as const,
      restrictions: '',
    },
    notes: [],
  }
  const generated = generatePlan({
    ...base.input,
    restrictionsConfirmed: true,
    equipment: ['徒手'],
  })
  if (!generated.ok) throw new Error(generated.message)
  const plan = { ...base, days: generated.days }

  it('老计划没有新字段也能解析', () => {
    expect(trainingPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('带基线与已应用条目时能解析，字段可缺省', () => {
    const traced = {
      ...plan,
      baselineVersion: 1,
      appliedAdjustments: [{ sig: 'goblet-squat:increase:1', name: '高脚杯深蹲', label: '+1 kg' }],
      editedBy: 'local',
    }
    const parsed = trainingPlanSchema.safeParse(traced)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.baselineVersion).toBe(1)
  })
})

describe('替代动作', () => {
  it('替代关系按无向并集处理：一侧写了就够', () => {
    const oneWay = exercises
      .flatMap((item) =>
        item.alternatives
          .filter((id) => !(getExercise(id)?.alternatives ?? []).includes(item.id))
          .map((id) => [item.id, id] as const),
      )
      .at(0)
    // 数据里确实存在单向关系，否则这条规则没有存在意义
    expect(oneWay).toBeTruthy()
    const [from, to] = oneWay!
    expect(getExercise(from)!.alternatives).toContain(to)
    expect(getExercise(to)!.alternatives).not.toContain(from)
    expect(alternativeIds(to)).toContain(from)
  })

  it('只返回同模式、同剂量类型、器械可用的替代', () => {
    const bandOnly = alternativesFor('db-curl', ['弹力带']).map((item) => item.id)
    expect(bandOnly).toContain('band-curl')
    expect(bandOnly).not.toContain('db-curl')
    // 只有哑铃时不返回弹力带动作：给了也做不了
    expect(alternativesFor('db-curl', ['哑铃'])).toEqual([])
  })
})
