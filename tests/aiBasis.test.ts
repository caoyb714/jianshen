import { describe, expect, it } from 'vitest'
import {
  COOLDOWN_MS,
  MANUAL_LIMIT,
  canAuto,
  canManual,
  cooldownLeft,
  emptyState,
  exhausted,
  markAuto,
  markManual,
  normalize,
} from '../src/app/aiBasis'

const day = '2026-11-18'
const stamp = 'plan:1'

describe('AI 理由的触发策略', () => {
  it('换天或换计划版本都会重置额度', () => {
    const used = markManual(markAuto(emptyState(day, stamp)), 1000)
    expect(normalize(used, day, stamp)).toBe(used)
    expect(normalize(used, '2026-11-19', stamp)).toEqual(emptyState('2026-11-19', stamp))
    expect(normalize(used, day, 'plan:2')).toEqual(emptyState(day, 'plan:2'))
    expect(normalize(null, day, stamp)).toEqual(emptyState(day, stamp))
  })

  it('自动拉取每个版本每天只允许一次', () => {
    const initial = emptyState(day, stamp)
    expect(canAuto(initial)).toBe(true)
    expect(canAuto(markAuto(initial))).toBe(false)
  })

  it('每成功一次进入 30 秒冷却，冷却结束后才能再点', () => {
    const once = markManual(emptyState(day, stamp), 1000)
    expect(cooldownLeft(once, 1000)).toBe(COOLDOWN_MS)
    expect(canManual(once, 1000 + COOLDOWN_MS - 1)).toBe(false)
    expect(canManual(once, 1000 + COOLDOWN_MS)).toBe(true)
  })

  it('手动额度是当天硬上限，用完即锁，不再假装倒计时', () => {
    let state = emptyState(day, stamp)
    for (let index = 1; index <= MANUAL_LIMIT; index += 1) {
      state = markManual(state, index * COOLDOWN_MS * 2)
    }
    expect(state.manual).toBe(MANUAL_LIMIT)
    expect(exhausted(state)).toBe(true)
    // 冷却早已过去，但额度用完仍然不允许
    expect(canManual(state, COOLDOWN_MS * 100)).toBe(false)
  })
})
