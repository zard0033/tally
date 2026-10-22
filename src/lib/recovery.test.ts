import { describe, expect, it } from 'vitest'
import { recoveryStatus, recoveryWindowHours, RECOVERY_GROUPS, warmupSetIds } from './recovery'
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
      exercises: [exercise('ex', 'back'), exercise('ex2', 'back')],
      workouts: [workout('w', 2)],
      workout_exercises: [entry('e', 'w', 'ex'), entry('e2', 'w', 'ex2')],
      workout_sets: [
        { id: 's1', workout_exercise_id: 'e', set_no: 1, weight_kg: 0, reps: 8, done: true }, // 徒手動作：整個動作都 0 kg，不判斷熱身
        { id: 's2', workout_exercise_id: 'e2', set_no: 1, weight_kg: 20, reps: 30, done: true },
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

/* ── D：RPE 與熱身判斷（spec.md「階段 4 乙」）；預期值全部手算 ── */
const wset = (id: string, entryId: string, kg: number, opts: { done?: boolean; rpe?: number | null } = {}): Row => ({
  id, workout_exercise_id: entryId, set_no: 1, weight_kg: kg, reps: 8, done: opts.done ?? true, ...(opts.rpe === undefined ? {} : { rpe: opts.rpe }),
})
const withSets = (group: string, h: number, rows: Row[]): TrainingDb =>
  db({ exercises: [exercise('ex', group)], workouts: [workout('w', h)], workout_exercises: [entry('e', 'w', 'ex')], workout_sets: rows })
/** n 組 50 kg 的正式組，第 i 組的 RPE 由 rpes[i] 給 */
const working = (n: number, rpes: Record<number, number | null> = {}): Row[] =>
  Array.from({ length: n }, (_, i) => wset(`s${i}`, 'e', 50, { rpe: rpes[i] }))

describe('recoveryWindowHours：近力竭加 24 小時', () => {
  it('下半身：n=10 近力竭 96、n=9 近力竭 72、n=9 沒近力竭 48', () => {
    expect(recoveryWindowHours('legs', 10, true)).toBe(96)
    expect(recoveryWindowHours('legs', 9, true)).toBe(72)
    expect(recoveryWindowHours('legs', 9, false)).toBe(48)
  })
  it('其餘：胸 n=6 近力竭 48、n=10 近力竭 72、n=6 沒近力竭 24；不傳旗標＝沒近力竭', () => {
    expect(recoveryWindowHours('chest', 6, true)).toBe(48)
    expect(recoveryWindowHours('chest', 10, true)).toBe(72)
    expect(recoveryWindowHours('chest', 6, false)).toBe(24)
    expect(recoveryWindowHours('chest', 6)).toBe(24)
  })
})

describe('warmupSetIds', () => {
  it('40、60、100 三組已打勾 → 只有 40 是熱身（60 剛好 60% 不算）', () => {
    const r = [wset('a', 'e', 40), wset('b', 'e', 60), wset('c', 'e', 100)]
    expect([...warmupSetIds(r)]).toEqual(['a'])
  })
  it('門檻兩側：100 kg 時 59.9 是熱身、60 不是；37.5 時 22.5 剛好 60% 不是熱身（小數不被浮點誤差吃掉）', () => {
    expect([...warmupSetIds([wset('a', 'e', 59.9), wset('b', 'e', 100)])]).toEqual(['a'])
    expect([...warmupSetIds([wset('a', 'e', 60), wset('b', 'e', 100)])]).toEqual([])
    expect([...warmupSetIds([wset('a', 'e', 22.5), wset('b', 'e', 37.5)])]).toEqual([])
  })
  it('只有一組、全部 0 kg（徒手）→ 沒有熱身', () => {
    expect(warmupSetIds([wset('a', 'e', 40)]).size).toBe(0)
    expect(warmupSetIds([wset('a', 'e', 0), wset('b', 'e', 0)]).size).toBe(0)
  })
  it('沒打勾的組不判斷、也不拉高最重：40 已打勾＋100 沒打勾 → 沒有熱身；沒打勾的 20 不是熱身', () => {
    expect(warmupSetIds([wset('a', 'e', 40), wset('b', 'e', 100, { done: false })]).size).toBe(0)
    expect(warmupSetIds([wset('a', 'e', 40), wset('b', 'e', 20, { done: false })]).size).toBe(0)
  })
})

describe('recoveryStatus：熱身與 RPE', () => {
  it('腿 12 組已打勾、其中 2 組 20 kg 熱身 → n=10（顯示 10 組）、窗口 72、距今 30 小時剩 42', () => {
    const rows = [...working(10), wset('w1', 'e', 20), wset('w2', 'e', 20)]
    expect(of(withSets('legs', 30, rows), 'legs')).toMatchObject({ sets: 10, windowHours: 72, remainingHours: 42, nearFailure: false })
  })
  it('同上，其中一組 RPE 9 → 近力竭、窗口 96、剩 66', () => {
    const rows = [...working(10, { 3: 9 }), wset('w1', 'e', 20), wset('w2', 'e', 20)]
    expect(of(withSets('legs', 30, rows), 'legs')).toMatchObject({ sets: 10, windowHours: 96, remainingHours: 66, nearFailure: true })
  })
  it('RPE 8 不算近力竭；9 與 10 算（胸 6 組、距今 30 小時：24 小時窗口已可再練，48 小時窗口剩 18）', () => {
    expect(of(withSets('chest', 30, working(6, { 0: 8 })), 'chest')).toMatchObject({ state: 'ready', nearFailure: false, windowHours: 24 })
    expect(of(withSets('chest', 30, working(6, { 0: 9 })), 'chest')).toMatchObject({ state: 'recovering', nearFailure: true, windowHours: 48, remainingHours: 18 })
    expect(of(withSets('chest', 30, working(6, { 5: 10 })), 'chest')).toMatchObject({ state: 'recovering', nearFailure: true, remainingHours: 18 })
  })
  it('沒打勾的組上的 RPE、null 都不算；沒有 rpe 欄位的舊資料與原本完全一樣', () => {
    const rows = [...working(5), wset('x', 'e', 50, { done: false, rpe: 10 }), wset('y', 'e', 50, { rpe: null })]
    expect(of(withSets('chest', 30, rows), 'chest')).toMatchObject({ nearFailure: false, windowHours: 24 })
    expect(of(one('chest', 6, 30), 'chest')).toMatchObject({ nearFailure: false, windowHours: 24 })
  })
  it('同肌群另一個動作的 RPE 9 也算；只看最近一次那場，更早一場的 RPE 10 不算', () => {
    const d = db({
      exercises: [exercise('ex', 'chest'), exercise('ex2', 'chest')],
      workouts: [workout('old', 100), workout('new', 30)],
      workout_exercises: [entry('eo', 'old', 'ex'), entry('e', 'new', 'ex'), entry('e2', 'new', 'ex2')],
      workout_sets: [
        wset('o1', 'eo', 50, { rpe: 10 }), // 更早一場
        wset('n1', 'e', 50, { rpe: 7 }),
        wset('n2', 'e2', 50, { rpe: 9 }), // 同場、同肌群的另一個動作
      ],
    })
    expect(of(d, 'chest')).toMatchObject({ nearFailure: true, windowHours: 48 })
    const onlyOld = { ...d, workouts: [workout('old', 100), workout('new', 30)], workout_sets: [d.workout_sets[0], wset('n1', 'e', 50, { rpe: 7 })] }
    expect(of(onlyOld, 'chest')).toMatchObject({ nearFailure: false, windowHours: 24 })
  })
  it('沒練過 → nearFailure false', () => {
    expect(of(db(), 'back').nearFailure).toBe(false)
  })
})

describe('recoveryStatus：資料裡混了有氧卡（spec「有氧併入動作」AC 6）', () => {
  // 有氧卡＝workout_exercises 一列、沒有任何組。肌群被使用者改成下半身的有氧動作也一樣不算：恢復只看已打勾的組
  const card = (id: string, workout_id: string, exercise_id: string): Row => ({ ...entry(id, workout_id, exercise_id), minutes: 30 })

  it('下半身 10 組 48 小時前 ＋ 同場一張有氧卡 ＋ 2 小時前只有有氧的一場 → 與沒有有氧時相同：恢復中、窗口 72、剩 24', () => {
    const d = db({
      exercises: [exercise('ex', 'legs'), { ...exercise('walk', 'other'), kind: 'incline_walk' }, { ...exercise('box', 'legs'), kind: 'boxing' }],
      workouts: [workout('w', 48), workout('wc', 2)],
      workout_exercises: [entry('e', 'w', 'ex'), card('c0', 'w', 'walk'), card('c1', 'wc', 'walk'), card('c2', 'wc', 'box')],
      workout_sets: sets('e', 10),
    })
    // w 在 49 小時前開始（本機 2026-10-19 11:00）、48 小時前結束
    expect(of(d, 'legs')).toEqual({
      group: 'legs', state: 'recovering', sets: 10, lastDate: '2026-10-19', daysAgo: 2, windowHours: 72, nearFailure: false, remainingHours: 24,
    })
    for (const g of ['chest', 'back', 'shoulder', 'arms', 'core']) expect(of(d, g).state).toBe('none')
  })
})
