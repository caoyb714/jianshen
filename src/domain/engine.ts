/**
 * 确定性训练规则引擎。
 *
 * 设计原则：
 * 1. 纯函数，无随机、无网络、无 AI。同一份档案永远得到同一份计划。
 * 2. 不做医学判断。有身体限制时只降级到入门、低冲击动作并标注需人工确认。
 * 3. 负荷调整只给建议，必须用户确认后才写入计划。
 */

import {
  exercises,
  getExercise,
  isAvailable,
  type Equipment,
  type Exercise,
  type Muscle,
  type Pattern,
} from './exercises'
import type { PlanDay, PlanSlot, SlotTarget } from './model'

export type { PlanDay, PlanSlot, SlotTarget }

export type Experience = '刚刚开始' | '偶尔运动' | '规律运动'

export type EngineInput = {
  age: number
  experience: Experience
  weeklyDays: number
  sessionMinutes: number
  equipment: Equipment[]
  restrictions: string
  restrictionsConfirmed: boolean
}

export type EngineResult =
  | { ok: true; days: PlanDay[]; notes: string[] }
  | {
      ok: false
      code: 'restrictions-unconfirmed' | 'no-equipment' | 'no-exercise'
      message: string
    }

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 训练日排布：按每周可训练天数选择间隔尽量均匀的组合 */
const WEEK_SCHEDULE: Record<number, number[]> = {
  1: [2],
  2: [1, 4],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
}

type DayFocus = '全身' | '上肢' | '下肢' | '恢复'

const FOCUS_PATTERNS: Record<Exclude<DayFocus, '恢复'>, Pattern[]> = {
  全身: ['蹲', '髋铰链', '推', '拉', '核心'],
  上肢: ['推', '拉', '推', '拉', '核心'],
  下肢: ['蹲', '髋铰链', '蹲', '髋铰链', '核心'],
}

const FOCUS_TITLES: Record<DayFocus, string> = {
  全身: '全身力量',
  上肢: '上肢力量',
  下肢: '下肢与臀部',
  恢复: '主动恢复',
}

function focusForDay(focus: DayFocus, dayIndex: number): string {
  const suffix = ['（基础）', '（变式）', '（稳定）']
  return `${FOCUS_TITLES[focus]}${suffix[dayIndex % suffix.length]}`
}

/** 依据每周天数决定分化方式 */
export function splitFor(weeklyDays: number): DayFocus[] {
  if (weeklyDays <= 3)
    return Array.from({ length: Math.max(1, weeklyDays) }, () => '全身' as DayFocus)
  if (weeklyDays === 4) return ['上肢', '下肢', '上肢', '下肢']
  return (['全身', '上肢', '下肢', '全身', '上肢'] as DayFocus[]).slice(0, weeklyDays)
}

/** 依经验水平决定组数 */
export function setsFor(experience: Experience, level: Exercise['level']): number {
  // 初学者统一 2 组；进阶动作不因经验增加组数，先保证动作质量
  if (experience === '刚刚开始') return 2
  if (experience === '偶尔运动') return level === '进阶' ? 3 : 2
  return 3
}

/** 依经验水平调整目标次数，起点保守 */
export function targetFor(exercise: Exercise, experience: Experience): SlotTarget {
  const dose = exercise.dose
  if (dose.type === 'reps') {
    if (experience === '刚刚开始') {
      const min = Math.max(4, dose.min - 2)
      return { type: 'reps', min, max: Math.min(dose.max, min + 4) }
    }
    if (experience === '偶尔运动') return { type: 'reps', min: dose.min, max: dose.max }
    return { type: 'reps', min: dose.min + 2, max: dose.max + 3 }
  }
  if (dose.type === 'hold') {
    const scale = experience === '刚刚开始' ? 0.7 : experience === '偶尔运动' ? 1 : 1.3
    return { type: 'hold', seconds: Math.round((dose.seconds * scale) / 5) * 5 }
  }
  return { type: 'time', minMinutes: dose.minMinutes, maxMinutes: dose.maxMinutes }
}

/** 单个动作的预计耗时（秒），含组间休息与动作切换 */
export function slotSeconds(slot: PlanSlot): number {
  const target = slot.target
  let workSeconds: number
  if (target.type === 'time') {
    workSeconds = ((target.minMinutes + target.maxMinutes) / 2) * 60
    return Math.round(workSeconds)
  }
  if (target.type === 'hold') {
    workSeconds = slot.sets * (target.seconds + slot.restSeconds)
  } else {
    const avgReps = (target.min + target.max) / 2
    const exercise = getExercise(slot.exerciseId)
    const tempo = exercise?.tempoSeconds ?? 4
    workSeconds = slot.sets * (avgReps * tempo + slot.restSeconds)
  }
  return Math.round(workSeconds + 20)
}

export function estimateMinutes(slots: PlanSlot[], warmupSeconds = 300): number {
  const total = slots.reduce((sum, slot) => sum + slotSeconds(slot), warmupSeconds)
  return Math.max(1, Math.round(total / 60))
}

/** 可用动作候选，按 id 排序以保证确定性 */
function candidatesFor(input: EngineInput, pattern: Pattern, conservative: boolean): Exercise[] {
  const beginnerOnly = input.experience === '刚刚开始'
  return exercises
    .filter((item) => item.pattern === pattern)
    .filter((item) => isAvailable(item, input.equipment))
    .filter((item) => {
      if (conservative) return item.level === '入门' && item.impact === '低'
      if (beginnerOnly) return item.level === '入门'
      return true
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function generatePlan(input: EngineInput): EngineResult {
  if (!input.restrictionsConfirmed) {
    return {
      ok: false,
      code: 'restrictions-unconfirmed',
      message: '档案中的身体限制尚未确认，无法生成计划。',
    }
  }
  if (input.equipment.length === 0) {
    return { ok: false, code: 'no-equipment', message: '至少需要选择一种可用器械。' }
  }

  const hasRestrictions = input.restrictions.trim().length > 0
  const conservative = hasRestrictions || input.age >= 60
  const notes: string[] = []

  if (hasRestrictions) {
    notes.push(
      '档案中记录了身体限制，计划已限制为入门、低冲击动作。这不能替代专业评估，开始前请确认动作是否适合。',
    )
  }
  if (input.age >= 60) {
    notes.push('年龄 60 岁以上，计划已限制为入门动作，建议从更慢的进度开始。')
  }
  if (input.sessionMinutes < 20) {
    notes.push('单次时间较短，计划只安排核心动作，热身与放松请另留时间。')
  }

  const schedule = WEEK_SCHEDULE[Math.min(7, Math.max(1, Math.round(input.weeklyDays)))] ?? [
    0, 2, 4,
  ]
  const focuses = splitFor(schedule.length)
  const warmupSeconds = input.sessionMinutes >= 25 ? 300 : 180
  const budgetSeconds = Math.max(300, input.sessionMinutes * 60 - warmupSeconds)

  // 一周内尽量不重复同一动作；池子不够时才回绕。游标让结果保持确定性。
  const usedIds = new Set<string>()
  const cursors = new Map<Pattern, number>()
  const nextFromPool = (pool: Exercise[], pattern: Pattern): Exercise | undefined => {
    if (pool.length === 0) return undefined
    const start = cursors.get(pattern) ?? 0
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[(start + i) % pool.length]
      if (!usedIds.has(candidate.id)) {
        cursors.set(pattern, (start + i + 1) % pool.length)
        return candidate
      }
    }
    cursors.set(pattern, (start + 1) % pool.length)
    return pool[start % pool.length]
  }

  const trainingDays: PlanDay[] = schedule.map((dayIndex, order) => {
    const focus = focuses[order] ?? '全身'
    const patterns = FOCUS_PATTERNS[focus as Exclude<DayFocus, '恢复'>]
    const chosen: PlanSlot[] = []
    let used = 0

    for (const pattern of patterns) {
      const pool = candidatesFor(input, pattern, conservative)
      if (pool.length === 0) continue
      const exercise = nextFromPool(pool, pattern)
      if (!exercise) continue
      const slot: PlanSlot = {
        exerciseId: exercise.id,
        role: '主要',
        sets: setsFor(input.experience, exercise.level),
        target: targetFor(exercise, input.experience),
        restSeconds: exercise.restSeconds,
        startLoad: 0,
      }
      const cost = slotSeconds(slot)
      if (used + cost > budgetSeconds && chosen.length >= 3) continue
      chosen.push(slot)
      used += cost
      usedIds.add(exercise.id)
    }

    // 放松：从灵活性动作里选一个，时间允许才加
    const relaxPool = candidatesFor(input, '灵活', conservative)
    if (relaxPool.length > 0 && used < budgetSeconds + 120) {
      const relax = nextFromPool(relaxPool, '灵活')
      if (relax && !chosen.some((slot) => slot.exerciseId === relax.id)) {
        chosen.push({
          exerciseId: relax.id,
          role: '放松',
          sets: 1,
          target: targetFor(relax, input.experience),
          restSeconds: relax.restSeconds,
          startLoad: 0,
        })
        usedIds.add(relax.id)
      }
    }

    if (chosen.filter((slot) => slot.role === '主要').length === 0) {
      return {
        index: dayIndex,
        kind: '休息' as const,
        focus: '休息',
        warmup: '',
        slots: [],
        estimatedMinutes: 0,
        note: '现有器械下没有可用动作，请在档案中增加器械。',
      }
    }

    return {
      index: dayIndex,
      kind: '训练' as const,
      focus: focusForDay(focus, dayIndex),
      warmup:
        warmupSeconds >= 300
          ? '5 分钟：原地踏步让身体发热，再做肩、髋、膝的环绕活动。'
          : '3 分钟：原地踏步与关节环绕，不必追求强度。',
      slots: chosen,
      estimatedMinutes: estimateMinutes(chosen, warmupSeconds),
      note: '',
    }
  })

  const trainingIndexes = new Set(schedule)
  const days: PlanDay[] = Array.from({ length: 7 }, (_, index) => {
    const training = trainingDays.find((day) => day.index === index)
    if (training) return training
    if (input.weeklyDays >= 5 && index === 3) {
      const recover = candidatesFor(input, '灵活', conservative).slice(0, 2)
      return {
        index,
        kind: '恢复',
        focus: '主动恢复',
        warmup: '',
        slots: recover.map((item) => ({
          exerciseId: item.id,
          role: '放松' as const,
          sets: 1,
          target: targetFor(item, input.experience),
          restSeconds: item.restSeconds,
          startLoad: 0,
        })),
        estimatedMinutes: 10,
        note: '今天不安排力量训练。可以散步或做上面的放松动作。',
      }
    }
    return {
      index,
      kind: '休息',
      focus: '休息',
      warmup: '',
      slots: [],
      estimatedMinutes: 0,
      note: `${WEEKDAY_NAMES[index]}休息。如果愿意，可以轻松步行 10–20 分钟。`,
    }
  })

  if (trainingIndexes.size < Math.round(input.weeklyDays)) {
    notes.push('部分训练日未能安排足够的动作，已按可用器械缩减。')
  }

  notes.push('计划由固定规则生成，不是医疗建议。任何动作引起疼痛、头晕或异常不适时请立即停止。')

  return { ok: true, days, notes }
}

// ── 渐进负荷建议 ────────────────────────────────────────────────────────

export type LoggedSet = { reps: number; load: number }

export type ExerciseSession = {
  date: string
  sets: LoggedSet[]
  difficulty: number
  discomfort: boolean
}

export type Suggestion =
  | { kind: 'increase'; reason: string; nextLoad: number; nextReps: number | null }
  | { kind: 'hold'; reason: string }
  | { kind: 'reduce'; reason: string; nextLoad: number }
  | { kind: 'stop'; reason: string; alternative: string | null }
  | { kind: 'collect'; reason: string }

export type SuggestInput = {
  exerciseId: string
  targetRepsMax: number
  equipment: Equipment
  currentLoad: number
  /** 最近的记录，按日期倒序 */
  history: ExerciseSession[]
}

const LOAD_STEP_KG = 1

function roundLoad(value: number): number {
  return Math.max(0, Math.round(value * 2) / 2)
}

/**
 * 只有一个动作连续两次「全部组达到目标次数上限」且整体难度不超过 7 时才建议加量。
 * 任何一次出现不适都直接建议停止并替换。
 */
export function suggest(session: SuggestInput): Suggestion {
  const { history, exerciseId, targetRepsMax, equipment, currentLoad } = session
  const exercise = getExercise(exerciseId)

  const discomfort = history.find((item) => item.discomfort)
  if (discomfort) {
    return {
      kind: 'stop',
      reason: `${discomfort.date} 记录了训练中不适，先暂停这个动作。`,
      alternative: exercise?.alternatives[0] ?? null,
    }
  }

  const usable = history.filter((item) => item.sets.length > 0)
  if (usable.length < 2) {
    return { kind: 'collect', reason: '至少完成两次记录后才会给出负荷建议。' }
  }

  const [last, previous] = usable
  const allReached = (item: ExerciseSession) => item.sets.every((set) => set.reps >= targetRepsMax)

  const hardLast = last.difficulty >= 9
  if (hardLast) {
    return {
      kind: 'reduce',
      reason: `上次整体难度 ${last.difficulty}/10，建议先降低负荷，把动作做稳。`,
      nextLoad: roundLoad(Math.max(0, last.sets[0].load * 0.95)),
    }
  }

  if (
    allReached(last) &&
    allReached(previous) &&
    last.difficulty <= 7 &&
    previous.difficulty <= 7
  ) {
    if (equipment === '徒手') {
      return {
        kind: 'increase',
        reason: '连续两次完成全部目标次数，且难度不超过 7。下次可以先增加次数。',
        nextLoad: 0,
        nextReps: targetRepsMax + 2,
      }
    }
    if (equipment === '弹力带') {
      return {
        kind: 'increase',
        reason: '连续两次完成全部目标次数，且难度不超过 7。可以换更粗一级的弹力带。',
        nextLoad: roundLoad(currentLoad + 1),
        nextReps: null,
      }
    }
    return {
      kind: 'increase',
      reason: `连续两次完成全部目标次数，且难度不超过 7。下次可以加 ${LOAD_STEP_KG} kg。`,
      nextLoad: roundLoad(currentLoad + LOAD_STEP_KG),
      nextReps: null,
    }
  }

  const missedLast = last.sets.some((set) => set.reps < targetRepsMax)
  if (missedLast) {
    return {
      kind: 'hold',
      reason: '上次有组次未达到目标次数，先保持当前负荷，把动作做完整。',
    }
  }

  return { kind: 'hold', reason: '目前进展正常，保持当前负荷，把动作质量做扎实。' }
}

/** 每 4 周安排一周降载：组数减一，负荷降 10% */
export function isDeloadWeek(weekNumber: number): boolean {
  return weekNumber > 0 && weekNumber % 4 === 0
}

export type MuscleVolume = Partial<Record<Muscle, number>>

/** 训练容量：组数 × 次数（计时动作按 1 次计） */
export function volumeByMuscle(slots: PlanSlot[]): MuscleVolume {
  const volume: MuscleVolume = {}
  for (const slot of slots) {
    const exercise = getExercise(slot.exerciseId)
    if (!exercise) continue
    const reps = slot.target.type === 'reps' ? (slot.target.min + slot.target.max) / 2 : 1
    const load = Math.max(1, slot.sets) * reps
    for (const muscle of exercise.primary) {
      volume[muscle] = (volume[muscle] ?? 0) + load
    }
  }
  return volume
}

/** 校验计划结构是否满足最低覆盖度，供测试与界面提示使用 */
export function coverageGaps(day: PlanDay): Pattern[] {
  if (day.kind !== '训练') return []
  const covered = new Set(
    day.slots
      .filter((slot) => slot.role === '主要')
      .map((slot) => getExercise(slot.exerciseId)?.pattern)
      .filter(Boolean) as Pattern[],
  )
  const required: Pattern[] = ['蹲', '髋铰链', '推', '拉', '核心']
  return required.filter((pattern) => !covered.has(pattern))
}

// ── 计划调整 ────────────────────────────────────────────────────────────

export type Adjustment = {
  exerciseId: string
  name: string
  suggestion: Suggestion
}

/**
 * 把建议落到当天的组次上。纯函数：同一份输入永远得到同一份计划。
 * - increase：提升起始负荷；徒手动作改为加次数
 * - reduce：降低起始负荷
 * - stop：换成建议的替代动作；计划槽位不带历史字段，替换痕迹只保留在动作库的替代关系里
 */
export function applyAdjustments(days: PlanDay[], adjustments: Adjustment[]): PlanDay[] {
  const byExercise = new Map(adjustments.map((item) => [item.exerciseId, item]))
  return days.map((day) => ({
    ...day,
    slots: day.slots.map((slot) => {
      const adjustment = byExercise.get(slot.exerciseId)
      if (!adjustment) return slot
      const { suggestion } = adjustment

      if (suggestion.kind === 'stop') {
        const alternative = suggestion.alternative ? getExercise(suggestion.alternative) : undefined
        if (!alternative) return slot
        return {
          ...slot,
          exerciseId: alternative.id,
          sets: Math.max(1, Math.min(10, alternative.dose.type === 'hold' ? slot.sets : slot.sets)),
          target:
            alternative.dose.type === 'reps'
              ? { type: 'reps' as const, min: alternative.dose.min, max: alternative.dose.max }
              : alternative.dose.type === 'hold'
                ? { type: 'hold' as const, seconds: alternative.dose.seconds }
                : {
                    type: 'time' as const,
                    minMinutes: alternative.dose.minMinutes,
                    maxMinutes: alternative.dose.maxMinutes,
                  },
          restSeconds: alternative.restSeconds,
          startLoad: 0,
        }
      }

      if (suggestion.kind === 'increase') {
        if (suggestion.nextReps !== null && slot.target.type === 'reps') {
          const delta = suggestion.nextReps - slot.target.max
          if (delta > 0)
            return {
              ...slot,
              target: {
                ...slot.target,
                min: slot.target.min + delta,
                max: slot.target.max + delta,
              },
            }
          return slot
        }
        return { ...slot, startLoad: suggestion.nextLoad }
      }

      if (suggestion.kind === 'reduce') return { ...slot, startLoad: suggestion.nextLoad }
      return slot
    }),
  }))
}
