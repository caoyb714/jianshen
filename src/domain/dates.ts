export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function shiftDate(date: Date, days: number): Date {
  const value = new Date(date)
  value.setDate(value.getDate() + days)
  return value
}
/** 周一为 0、周日为 6；计划按这个顺序存 days[]，所以各处必须共用同一套换算。 */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T12:00:00`).getDay() + 6) % 7
}
export function weekDates(date = new Date()): string[] {
  const monday = shiftDate(date, -((date.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => localDate(shiftDate(monday, i)))
}
export function displayDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}
