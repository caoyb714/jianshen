import type { AppData, Habit } from './model'
import { localDate, shiftDate } from './dates'
export function emptyHabit(date: string): Habit {
  return { date, water: 0, sleep: null, energy: null, meals: false, protein: false, plants: false }
}
export function makeSeed(now = new Date()): AppData {
  return {
    version: 1,
    profile: {
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
    },
    settings: { showWeight: false },
    habits: Array.from({ length: 28 }, (_, i) => ({
      date: localDate(shiftDate(now, -i)),
      water: i === 0 ? 750 : [1250, 1500, 1000, 1750][i % 4],
      sleep: i === 0 ? 7.5 : [7, 8, 7.5, 6.5, 8.5][i % 5],
      energy: (i % 3) + 3,
      meals: i % 3 !== 0,
      protein: i % 2 === 0,
      plants: i % 4 !== 0,
    })),
    metrics: [0, 7, 14, 21].map((i, index) => ({
      id: `sample-metric-${i}`,
      date: localDate(shiftDate(now, -i)),
      weight: 54 + index * 0.2,
      waist: 68 + index * 0.3,
      hip: 90,
    })),
    workouts: [2, 4, 6, 9, 11, 13, 16, 18, 21, 24, 27].map((i, index) => ({
      id: `sample-workout-${i}`,
      date: localDate(shiftDate(now, -i)),
      planId: 'full',
      title: '轻盈全身力量',
      minutes: 20 + (index % 3) * 5,
      difficulty: 5 + (index % 2),
      discomfort: false,
      feeling: '今天的练习很舒服。（示例记录）',
      createdAt: shiftDate(now, -i).toISOString(),
      exercises: [
        { id: 'squat', name: '椅子坐站', sets: 2, reps: 8, load: 0 },
        { id: 'press', name: '墙面俯卧撑', sets: 2, reps: 8, load: 0 },
      ],
    })),
  }
}
export function makeEmpty(now = new Date()): AppData {
  const data = makeSeed(now)
  data.workouts = []
  data.habits = []
  data.metrics = []
  return data
}
