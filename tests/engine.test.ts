import { describe, expect, it } from 'vitest'
import {
  coverageGaps,
  generatePlan,
  isDeloadWeek,
  setsFor,
  suggest,
  targetFor,
  type EngineInput,
  type ExerciseSession,
} from '../src/domain/engine'
import { exercises, getExercise, isAvailable } from '../src/domain/exercises'

const base: EngineInput = {
  age: 28,
  experience: '刚刚开始',
  weeklyDays: 3,
  sessionMinutes: 30,
  equipment: ['徒手', '哑铃', '弹力带'],
  restrictions: '',
  restrictionsConfirmed: true,
}

function plan(overrides: Partial<EngineInput> = {}) {
  const result = generatePlan({ ...base, ...overrides })
  if (!result.ok) throw new Error(result.message)
  return result
}

describe('动作库完整性', () => {
  it('id 唯一', () => {
    const ids = exercises.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('替代动作都指向存在的动作', () => {
    for (const item of exercises) {
      for (const alternative of item.alternatives) {
        expect(getExercise(alternative), `${item.id} → ${alternative}`).toBeTruthy()
      }
    }
  })
  it('覆盖蹲、髋铰链、推、拉、核心五类基本模式', () => {
    const patterns = new Set(exercises.map((item) => item.pattern))
    for (const pattern of ['蹲', '髋铰链', '推', '拉', '核心'] as const) {
      expect(patterns.has(pattern), pattern).toBe(true)
    }
  })
  it('器械只使用徒手、哑铃、弹力带', () => {
    for (const item of exercises) {
      expect(['徒手', '哑铃', '弹力带']).toContain(item.equipment)
    }
  })
  it('每项动作都有步骤、要点与注意事项', () => {
    for (const item of exercises) {
      expect(item.steps.length, item.id).toBeGreaterThanOrEqual(3)
      expect(item.cues.length, item.id).toBeGreaterThanOrEqual(2)
      expect(item.cautions.length, item.id).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('计划生成的安全边界', () => {
  it('未确认身体限制时拒绝生成', () => {
    const result = generatePlan({ ...base, restrictionsConfirmed: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('restrictions-unconfirmed')
  })
  it('没有器械时拒绝生成', () => {
    const result = generatePlan({ ...base, equipment: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no-equipment')
  })
  it('有身体限制时只安排入门且低冲击动作', () => {
    const result = plan({ restrictions: '腰椎间盘突出，避免弯腰负重' })
    for (const day of result.days) {
      for (const slot of day.slots) {
        const exercise = getExercise(slot.exerciseId)!
        expect(exercise.level, exercise.id).toBe('入门')
        expect(exercise.impact, exercise.id).toBe('低')
      }
    }
    expect(result.notes.join('')).toContain('不能替代专业评估')
  })
  it('只勾选徒手时不会出现器械动作', () => {
    const result = plan({ equipment: ['徒手'] })
    for (const day of result.days) {
      for (const slot of day.slots) {
        expect(getExercise(slot.exerciseId)!.equipment).toBe('徒手')
      }
    }
  })
  it('只勾选哑铃时不会出现弹力带动作', () => {
    const result = plan({ equipment: ['哑铃'] })
    for (const day of result.days) {
      for (const slot of day.slots) {
        expect(isAvailable(getExercise(slot.exerciseId)!, ['哑铃'])).toBe(true)
      }
    }
  })
})

describe('计划结构', () => {
  it('同一份档案生成完全相同的计划', () => {
    expect(plan().days).toEqual(plan().days)
  })
  it('按每周天数安排训练日', () => {
    expect(plan({ weeklyDays: 2 }).days.filter((d) => d.kind === '训练')).toHaveLength(2)
    expect(plan({ weeklyDays: 3 }).days.filter((d) => d.kind === '训练')).toHaveLength(3)
    expect(plan({ weeklyDays: 4 }).days.filter((d) => d.kind === '训练')).toHaveLength(4)
    expect(plan({ weeklyDays: 5 }).days.filter((d) => d.kind === '训练')).toHaveLength(5)
  })
  it('每周七天全部可训练', () => {
    expect(plan({ weeklyDays: 7 }).days.filter((d) => d.kind === '训练')).toHaveLength(7)
  })
  it('全身训练日覆盖五个基本动作模式', () => {
    const day = plan({ weeklyDays: 3 }).days.find((d) => d.kind === '训练')!
    expect(coverageGaps(day)).toEqual([])
  })
  it('每个训练日都以放松动作收尾', () => {
    for (const day of plan({ weeklyDays: 3 }).days.filter((d) => d.kind === '训练')) {
      expect(day.slots.at(-1)?.role).toBe('放松')
    }
  })
  it('估算时长不超过所在档案的单次时间', () => {
    for (const minutes of [15, 20, 30, 45, 60]) {
      const result = plan({ sessionMinutes: minutes })
      for (const day of result.days) {
        expect(day.estimatedMinutes, `${minutes} 分钟档案`).toBeLessThanOrEqual(minutes + 8)
      }
    }
  })
  it('时间较短时动作数量相应减少', () => {
    const short = plan({ sessionMinutes: 15 }).days.find((d) => d.kind === '训练')!
    const long = plan({ sessionMinutes: 60 }).days.find((d) => d.kind === '训练')!
    expect(short.slots.length).toBeLessThan(long.slots.length)
  })
  it('六十岁以上自动降为入门动作', () => {
    for (const day of plan({ age: 65 }).days) {
      for (const slot of day.slots) {
        expect(getExercise(slot.exerciseId)!.level).toBe('入门')
      }
    }
  })
  it('零基础只安排入门动作', () => {
    for (const day of plan({ experience: '刚刚开始' }).days) {
      for (const slot of day.slots) {
        expect(getExercise(slot.exerciseId)!.level, slot.exerciseId).toBe('入门')
      }
    }
  })
  it('一周内同一动作尽量不重复', () => {
    const ids: string[] = []
    for (const day of plan({ weeklyDays: 3 }).days) {
      for (const slot of day.slots) ids.push(slot.exerciseId)
    }
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    expect(duplicates).toEqual([])
  })
  it('核心动作在不同训练日轮换', () => {
    const cores = plan({ weeklyDays: 3 })
      .days.filter((day) => day.kind === '训练')
      .map((day) => day.slots.find((slot) => getExercise(slot.exerciseId)!.pattern === '核心'))
      .map((slot) => slot!.exerciseId)
    expect(new Set(cores).size).toBe(cores.length)
  })
})

describe('组次与目标', () => {
  it('初学者组数更少', () => {
    expect(setsFor('刚刚开始', '入门')).toBe(2)
    expect(setsFor('规律运动', '入门')).toBe(3)
  })
  it('初学者的次数目标低于规律运动者', () => {
    const squat = getExercise('bodyweight-squat')!
    const beginner = targetFor(squat, '刚刚开始')
    const regular = targetFor(squat, '规律运动')
    expect(beginner.type).toBe('reps')
    expect(regular.type).toBe('reps')
    if (beginner.type === 'reps' && regular.type === 'reps') {
      expect(beginner.max).toBeLessThan(regular.max)
    }
  })
  it('计时动作按下限缩放', () => {
    const plank = getExercise('plank')!
    const beginner = targetFor(plank, '刚刚开始')
    expect(beginner.type === 'hold' && beginner.seconds).toBeLessThan(30)
  })
})

describe('渐进负荷建议', () => {
  const input = {
    exerciseId: 'db-curl',
    targetRepsMax: 12,
    equipment: '哑铃' as const,
    currentLoad: 6,
  }
  it('记录不足时只收集数据', () => {
    expect(suggest({ ...input, history: [] }).kind).toBe('collect')
  })
  it('连续两次达标且难度不超过 7 时建议加重量', () => {
    const history: ExerciseSession[] = [
      {
        date: '2026-11-15',
        sets: [
          { reps: 12, load: 6 },
          { reps: 12, load: 6 },
        ],
        difficulty: 6,
        discomfort: false,
      },
      {
        date: '2026-11-12',
        sets: [
          { reps: 12, load: 6 },
          { reps: 12, load: 6 },
        ],
        difficulty: 7,
        discomfort: false,
      },
    ]
    const result = suggest({ ...input, history })
    expect(result.kind).toBe('increase')
    if (result.kind === 'increase') expect(result.nextLoad).toBe(7)
  })
  it('徒手动作改为加次数而不是加重量', () => {
    const history: ExerciseSession[] = [
      { date: '2026-11-15', sets: [{ reps: 12, load: 0 }], difficulty: 6, discomfort: false },
      { date: '2026-11-12', sets: [{ reps: 12, load: 0 }], difficulty: 7, discomfort: false },
    ]
    const result = suggest({ ...input, equipment: '徒手', currentLoad: 0, history })
    expect(result.kind).toBe('increase')
    if (result.kind === 'increase') {
      expect(result.nextLoad).toBe(0)
      expect(result.nextReps).toBe(14)
    }
  })
  it('有组次未达标时保持当前负荷', () => {
    const history: ExerciseSession[] = [
      {
        date: '2026-11-15',
        sets: [
          { reps: 12, load: 6 },
          { reps: 9, load: 6 },
        ],
        difficulty: 8,
        discomfort: false,
      },
      { date: '2026-11-12', sets: [{ reps: 12, load: 6 }], difficulty: 7, discomfort: false },
    ]
    expect(suggest({ ...input, history }).kind).toBe('hold')
  })
  it('难度达到 9 时建议降载', () => {
    const history: ExerciseSession[] = [
      { date: '2026-11-15', sets: [{ reps: 10, load: 6 }], difficulty: 9, discomfort: false },
      { date: '2026-11-12', sets: [{ reps: 10, load: 6 }], difficulty: 8, discomfort: false },
    ]
    const result = suggest({ ...input, history })
    expect(result.kind).toBe('reduce')
  })
  it('出现过不适时建议停止并给出替代动作', () => {
    const history: ExerciseSession[] = [
      { date: '2026-11-15', sets: [{ reps: 10, load: 6 }], difficulty: 6, discomfort: true },
    ]
    const result = suggest({ ...input, history })
    expect(result.kind).toBe('stop')
    if (result.kind === 'stop') expect(result.alternative).toBeTruthy()
  })
  it('每四周安排一次降载', () => {
    expect(isDeloadWeek(4)).toBe(true)
    expect(isDeloadWeek(8)).toBe(true)
    expect(isDeloadWeek(3)).toBe(false)
  })
})
