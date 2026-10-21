import { describe, expect, it } from 'vitest'
import { recoveryStatus, recoveryWindowHours, RECOVERY_GROUPS } from './recovery'
import { emptyTrainingDb, type Row, type TrainingDb, type TrainingTable } from './training'

const db = (p: Partial<Record<TrainingTable, readonly Row[]>> = {}): TrainingDb => ({ ...emptyTrainingDb(), ...p })

// 現在：本機 2026-10-21 12:00（用本機時間建，避免測試環境時區影響「今天」）
const NOW = new Date(2026, 9, 21, 12, 0, 0)
const HOUR = 3600_000
const ago = (h: number): string => new Date(NOW.getTime() - h * HOUR).toISOString()
/** 距今 h 小時前結束的訓練；performed_on 取該時刻的本機日期 */
const dayOf = (h: number): string => {
  const d = new Date(NOW.getTime() - h * HOUR)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const exercise = (id: string, muscle_group: string): Row => ({ id, name: id, muscle_group, archived: false })
const workout = (id: string, endedHoursAgo: number | null, startedHoursAgo = (endedHoursAgo ?? 0) + 1): Row => ({
  id,
  performed_on: dayOf(startedHoursAgo),
  started_at: ago(startedHoursAgo),
  ended_at: endedHoursAgo === null ? null : ago(endedHoursAgo),
})
const entry = (id: string, workout_id: string, exercise_id: string): Row => ({ id, workout_id, exercise_id, position: 0 })
const sets = (entryId: string, n: number, done = true): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${entryId}-s${i}-${done}`, workout_exercise_id: entryId, set_no: i + 1, weight_kg: 50, reps: 8, done }))

/** 一場訓練、一個肌群、n 組已打勾、h 小時前結束 */
const one = (group: string, n: number, h: number): TrainingDb =>
  db({
    exercises: [exercise('ex', group)],
    workouts: [workout('w', h)],
    workout_exercises: [entry('e', 'w', 'ex')],
    workout_sets: sets('e', n),
  })
const of = (d: TrainingDb, group: string) => recoveryStatus(d, NOW).find((r) => r.group === group)!

// 預期值全部手算（窗口表見 spec.md「階段 4 甲」口徑 4），不呼叫被測函式
describe('recoveryWindowHours（部位×組數）', () => {
  it('上半身與腹肌：<10 組 24 小時，≥10 組 48 小時', () => {
    for (const g of ['chest', 'back', 'shoulder', 'arms', 'core'] as const) {
      expect(recoveryWindowHours(g, 1)).toBe(24)
      expect(recoveryWindowHours(g, 9)).toBe(24)
      expect(recoveryWindowHours(g, 10)).toBe(48)
      expect(recoveryWindowHours(g, 25)).toBe(48)
    }
  })

  it('下半身：<10 組 48 小時，≥10 組 72 小時', () => {
    expect(recoveryWindowHours('legs', 1)).toBe(48)
    expect(recoveryWindowHours('legs', 9)).toBe(48)
    expect(recoveryWindowHours('legs', 10)).toBe(72)
  })
})

describe('recoveryStatus', () => {
  it('固定六列，順序＝胸、背、下半身、肩、臂、腹；「其他」不出現', () => {
    expect(RECOVERY_GROUPS).toEqual(['chest', 'back', 'legs', 'shoulder', 'arms', 'core'])
    expect(recoveryStatus(db(), NOW).map((r) => r.group)).toEqual(['chest', 'back', 'legs', 'shoulder', 'arms', 'core'])
  })

  it('沒練過的肌群＝沒有紀錄（組數 0、沒有日期）', () => {
    const r = of(db(), 'chest')
    expect(r).toMatchObject({ state: 'none', sets: 0, lastDate: null, daysAgo: null, windowHours: null, remainingHours: null })
  })

  it('下半身 10 組、距今 48 小時 → 恢復中（窗口 72，剩 24 小時）', () => {
    expect(of(one('legs', 10, 48), 'legs')).toMatchObject({ state: 'recovering', sets: 10, windowHours: 72, remainingHours: 24 })
  })

  it('下半身邊界：9 組 47 小時恢復中、48 小時整可再練；10 組 71 小時恢復中、72 小時整可再練', () => {
    expect(of(one('legs', 9, 47), 'legs')).toMatchObject({ state: 'recovering', remainingHours: 1 })
    expect(of(one('legs', 9, 48), 'legs').state).toBe('ready')
    expect(of(one('legs', 10, 71), 'legs')).toMatchObject({ state: 'recovering', remainingHours: 1 })
    expect(of(one('legs', 10, 72), 'legs').state).toBe('ready')
  })

  it('胸 6 組、距今 49 小時 → 可再練（窗口 24）；23 小時還在恢復、24 小時整可再練', () => {
    expect(of(one('chest', 6, 49), 'chest')).toMatchObject({ state: 'ready', windowHours: 24, remainingHours: 0 })
    expect(of(one('chest', 6, 23), 'chest')).toMatchObject({ state: 'recovering', remainingHours: 1 })
    expect(of(one('chest', 6, 24), 'chest').state).toBe('ready')
  })

  it('上半身 10 組：窗口升到 48 小時（47 小時恢復中、48 小時整可再練）', () => {
    expect(of(one('back', 10, 47), 'back')).toMatchObject({ state: 'recovering', windowHours: 48, remainingHours: 1 })
    expect(of(one('back', 10, 48), 'back').state).toBe('ready')
    expect(of(one('back', 9, 47), 'back').state).toBe('ready') // 9 組窗口只有 24
  })

  it('剩餘小時無條件進位：下半身 10 組距今 47.5 小時 → 剩 24.5 → 25', () => {
    expect(of(one('legs', 10, 47.5), 'legs').remainingHours).toBe(25)
  })

  it('只算已打勾的組；沒打勾的不算也不算「練過」', () => {
    const d = db({
      exercises: [exercise('ex', 'chest')],
      workouts: [workout('w', 2)],
      workout_exercises: [entry('e', 'w', 'ex')],
      workout_sets: [...sets('e', 3, true), ...sets('e', 5, false)],
    })
    expect(of(d, 'chest').sets).toBe(3)
    const none = db({
      exercises: [exercise('ex', 'chest')],
      workouts: [workout('w', 2)],
      workout_exercises: [entry('e', 'w', 'ex')],
      workout_sets: sets('e', 4, false),
    })
    expect(of(none, 'chest').state).toBe('none')
  })

  it('沒打勾的那場不算最近一次：退回前一場有打勾的', () => {
    const d = db({
      exercises: [exercise('ex', 'chest')],
      workouts: [workout('old', 100), workout('new', 5)],
      workout_exercises: [entry('e1', 'old', 'ex'), entry('e2', 'new', 'ex')],
      workout_sets: [...sets('e1', 4, true), ...sets('e2', 6, false)],
    })
    expect(of(d, 'chest')).toMatchObject({ sets: 4, state: 'ready' })
  })

  it('取最近一次那場的組數，不是歷來總和；多個動作同肌群的組數相加', () => {
    const d = db({
      exercises: [exercise('a', 'legs'), exercise('b', 'legs')],
      workouts: [workout('old', 200), workout('new', 10)],
      workout_exercises: [entry('e1', 'old', 'a'), entry('e2', 'new', 'a'), entry('e3', 'new', 'b')],
      workout_sets: [...sets('e1', 12), ...sets('e2', 4), ...sets('e3', 3)],
    })
    expect(of(d, 'legs')).toMatchObject({ sets: 7, windowHours: 48, state: 'recovering', remainingHours: 38 })
  })

  it('一場訓練含多個肌群：各算各的', () => {
    const d = db({
      exercises: [exercise('c', 'chest'), exercise('l', 'legs')],
      workouts: [workout('w', 30)],
      workout_exercises: [entry('e1', 'w', 'c'), entry('e2', 'w', 'l')],
      workout_sets: [...sets('e1', 5), ...sets('e2', 2)],
    })
    expect(of(d, 'chest')).toMatchObject({ sets: 5, state: 'ready' })
    expect(of(d, 'legs')).toMatchObject({ sets: 2, state: 'recovering', remainingHours: 18 }) // 窗口 48 − 30
  })

  it('「其他」與不認得的肌群值都不進六列', () => {
    const d = db({
      exercises: [exercise('o', 'other'), exercise('x', 'cardio?')],
      workouts: [workout('w', 2)],
      workout_exercises: [entry('e1', 'w', 'o'), entry('e2', 'w', 'x')],
      workout_sets: [...sets('e1', 5), ...sets('e2', 5)],
    })
    expect(recoveryStatus(d, NOW).every((r) => r.state === 'none')).toBe(true)
  })

  it('徒手（0 kg）與超過 10 下的組也算：恢復看做了多少，不像 e1RM 有次數上限', () => {
    const d = db({
      exercises: [exercise('ex', 'back')],
      workouts: [workout('w', 2)],
      workout_exercises: [entry('e', 'w', 'ex')],
      workout_sets: [
        { id: 's1', workout_exercise_id: 'e', set_no: 1, weight_kg: 0, reps: 8, done: true },
        { id: 's2', workout_exercise_id: 'e', set_no: 2, weight_kg: 20, reps: 30, done: true },
      ],
    })
    expect(of(d, 'back').sets).toBe(2)
  })

  it('進行中的訓練（沒有 ended_at）用開始時間算；也計入', () => {
    const d = db({
      exercises: [exercise('ex', 'chest')],
      workouts: [workout('w', null, 3)], // 3 小時前開始、還沒結束
      workout_exercises: [entry('e', 'w', 'ex')],
      workout_sets: sets('e', 2),
    })
    expect(of(d, 'chest')).toMatchObject({ sets: 2, state: 'recovering', remainingHours: 21 }) // 窗口 24 − 3
  })

  it('結束時間在未來（時鐘偏差）→ 距今當 0 小時，不給負的剩餘時間', () => {
    const d = db({
      exercises: [exercise('ex', 'chest')],
      workouts: [{ id: 'w', performed_on: dayOf(0), started_at: ago(1), ended_at: ago(-2) }],
      workout_exercises: [entry('e', 'w', 'ex')],
      workout_sets: sets('e', 3),
    })
    expect(of(d, 'chest')).toMatchObject({ state: 'recovering', remainingHours: 24 })
  })

  it('最近一次以結束時間比，不是日期或資料列順序', () => {
    const rows = [workout('a', 60), workout('b', 5)]
    const mk = (ws: Row[]) =>
      db({
        exercises: [exercise('ex', 'arms')],
        workouts: ws,
        workout_exercises: [entry('e1', 'a', 'ex'), entry('e2', 'b', 'ex')],
        workout_sets: [...sets('e1', 3), ...sets('e2', 8)],
      })
    for (const d of [mk(rows), mk([...rows].reverse())]) expect(of(d, 'arms')).toMatchObject({ sets: 8, state: 'recovering', remainingHours: 19 })
  })

  it('X 天前按日曆日算：昨晚的訓練今天看＝1 天前；同一天＝0；lastDate 是 performed_on', () => {
    const d = db({
      exercises: [exercise('ex', 'core')],
      workouts: [{ id: 'w', performed_on: '2026-10-20', started_at: ago(14), ended_at: ago(13) }], // 昨天 22:00–23:00
      workout_exercises: [entry('e', 'w', 'ex')],
      workout_sets: sets('e', 3),
    })
    expect(of(d, 'core')).toMatchObject({ lastDate: '2026-10-20', daysAgo: 1 })
    expect(of(one('core', 3, 2), 'core').daysAgo).toBe(0)
  })

  it('performed_on 在今天之後（換時區、改系統日期）→ 天數當 0，不出現負數', () => {
    const d = db({
      exercises: [exercise('ex', 'core')],
      workouts: [{ id: 'w', performed_on: '2026-10-23', started_at: ago(2), ended_at: ago(1) }],
      workout_exercises: [entry('e', 'w', 'ex')],
      workout_sets: sets('e', 3),
    })
    expect(of(d, 'core').daysAgo).toBe(0)
  })

  it('孤兒資料（訓練被刪、動作項掛在不存在的訓練上）不算', () => {
    const d = db({
      exercises: [exercise('ex', 'chest')],
      workouts: [],
      workout_exercises: [entry('e', 'ghost', 'ex')],
      workout_sets: sets('e', 5),
    })
    expect(of(d, 'chest').state).toBe('none')
  })

  it('時間欄位壞掉的訓練略過，不讓整頁壞', () => {
    const d = db({
      exercises: [exercise('ex', 'chest')],
      workouts: [{ id: 'w', performed_on: '2026-10-21', started_at: 'not-a-date', ended_at: null }],
      workout_exercises: [entry('e', 'w', 'ex')],
      workout_sets: sets('e', 3),
    })
    expect(of(d, 'chest').state).toBe('none')
  })
})
