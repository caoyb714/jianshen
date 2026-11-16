import { describe, expect, it } from 'vitest'
import { localDate, weekDates } from '../src/domain/dates'
import { loadData, saveData } from '../src/domain/repository'
import { makeSeed, PROFILE_A } from '../src/domain/seed'
import { summarize } from '../src/domain/stats'

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
