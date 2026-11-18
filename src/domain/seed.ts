import type { AppData, Habit, Profile, ProfileSlot, Workout } from './model'
import { localDate, shiftDate } from './dates'

export const PROFILE_A = 'profile-a'
export const PROFILE_B = 'profile-b'

export function emptyHabit(profileId: string, date: string): Habit {
  return {
    profileId,
    date,
    water: 0,
    sleep: null,
    energy: null,
    meals: false,
    protein: false,
    plants: false,
  }
}

export const emptyProfile: Profile = {
  name: '',
  age: 25,
  height: 162,
  experience: '刚刚开始',
  activity: '大多坐着',
  goal: '养成运动习惯',
  weeklyDays: 3,
  sessionMinutes: 25,
  equipment: ['徒手'],
  dumbbell: '',
  band: '',
  restrictions: '',
  restrictionsConfirmed: false,
}

/** 空间固定两个档案位：1 为被监督者，2 为另一位成员。 */
export function makeSlots(first: Profile | null = null): ProfileSlot[] {
  return [
    { id: PROFILE_A, slot: 1, profile: first },
    { id: PROFILE_B, slot: 2, profile: null },
  ]
}

function sampleWorkout(profileId: string, id: string, date: string, load: number): Workout {
  return {
    profileId,
    id,
    date,
    planId: 'sample-plan',
    planVersion: 1,
    title: '全身力量（示例）',
    minutes: 22,
    difficulty: 6,
    discomfort: false,
    feeling: '今天的练习很舒服。（示例记录）',
    createdAt: `${date}T10:00:00.000Z`,
    exercises: [
      {
        exerciseId: 'sit-to-stand',
        name: '椅子坐站',
        role: '主要',
        plannedSets: 2,
        targetReps: 10,
        targetSeconds: null,
        replacedFrom: null,
        sets: [
          { reps: 10, load: 0, done: true },
          { reps: 10, load: 0, done: true },
        ],
      },
      {
        exerciseId: 'band-row',
        name: '弹力带划船',
        role: '主要',
        plannedSets: 2,
        targetReps: 12,
        targetSeconds: null,
        replacedFrom: null,
        sets: [
          { reps: 12, load, done: true },
          { reps: 11, load, done: true },
        ],
      },
    ],
  }
}

export function makeSeed(now = new Date()): AppData {
  const first: Profile = {
    name: '小禾',
    age: 26,
    height: 163,
    experience: '刚刚开始',
    activity: '大多坐着',
    goal: '养成运动习惯',
    weeklyDays: 3,
    sessionMinutes: 25,
    equipment: ['徒手', '哑铃', '弹力带'],
    dumbbell: '2–5 kg（示例）',
    band: '轻阻力（示例）',
    restrictions: '',
    restrictionsConfirmed: true,
  }
  return {
    version: 2,
    profiles: makeSlots(first),
    settings: { showWeight: true },
    habits: Array.from({ length: 28 }, (_, i) => ({
      profileId: PROFILE_A,
      date: localDate(shiftDate(now, -i)),
      water: i === 0 ? 750 : [1250, 1500, 1000, 1750][i % 4],
      sleep: i === 0 ? 7.5 : [7, 8, 7.5, 6.5, 8.5][i % 5],
      energy: (i % 3) + 3,
      meals: i % 3 !== 0,
      protein: i % 2 === 0,
      plants: i % 4 !== 0,
    })),
    metrics: [0, 7, 14, 21].map((i, index) => ({
      profileId: PROFILE_A,
      id: `sample-metric-${i}`,
      date: localDate(shiftDate(now, -i)),
      weight: 54 + index * 0.2,
      waist: 68 + index * 0.3,
      hip: 90,
    })),
    workouts: [2, 4, 6, 9, 11, 13, 16, 18, 21, 24, 27].map((i, index) =>
      sampleWorkout(
        PROFILE_A,
        `6f8f0c1e-0000-4000-8000-${String(index).padStart(12, '0')}`,
        localDate(shiftDate(now, -i)),
        index % 3 === 0 ? 2 : 3,
      ),
    ),
    plans: [],
  }
}

/** 空档案：保留两个档案位，但不含任何演示记录 */
export function makeEmpty(now = new Date()): AppData {
  const data = makeSeed(now)
  data.workouts = []
  data.habits = []
  data.metrics = []
  return data
}
