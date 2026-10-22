import { describe, expect, it } from 'vitest'
import { bestE1rm, chartPoints, e1rm, progressList, strengthHistory, suggestWeight, type StrengthPoint } from './strength'
import { emptyTrainingDb, type Row, type TrainingDb, type TrainingTable } from './training'

const db = (p: Partial<Record<TrainingTable, readonly Row[]>> = {}): TrainingDb => ({ ...emptyTrainingDb(), ...p })

// 預期值全部手算，不呼叫被測函式
describe('e1rm（Epley，取小數一位）', () => {
  it('60×10→80.0；100×5→116.7；100×1→100.0', () => {
    expect(e1rm(60, 10)).toBe(80) // 60 × (1 + 10/30) = 80
    expect(e1rm(100, 5)).toBe(116.7) // 100 × 7/6 = 116.666…
    expect(e1rm(100, 1)).toBe(100) // 次數 1 直接等於重量，不是 103.3
  })

  it('小數重量照算：62.5×8→79.2', () => {
    expect(e1rm(62.5, 8)).toBe(79.2) // 62.5 × 38/30 = 79.1666…
  })

  it('超過 10 下、0 kg、0 次、負值、非整數次、非有限數字都不算', () => {
    expect(e1rm(50, 12)).toBeNull()
    expect(e1rm(50, 11)).toBeNull()
    expect(e1rm(0, 10)).toBeNull()
    expect(e1rm(-5, 10)).toBeNull()
    expect(e1rm(60, 0)).toBeNull()
    expect(e1rm(60, 2.5)).toBeNull()
    expect(e1rm(Number.NaN, 5)).toBeNull()
    expect(e1rm(60, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('邊界：10 下算、11 下不算', () => {
    expect(e1rm(30, 10)).toBe(40)
    expect(e1rm(30, 11)).toBeNull()
  })
})

const workout = (id: string, performed_on: string, started_at = `${performed_on}T10:00:00Z`): Row =>
  ({ id, performed_on, started_at })
const entry = (id: string, workout_id: string, exercise_id: string): Row => ({ id, workout_id, exercise_id, position: 0 })
const set = (id: string, workout_exercise_id: string, weight_kg: number, reps: number, done = true): Row =>
  ({ id, workout_exercise_id, weight_kg, reps, done, set_no: 1 })

describe('strengthHistory', () => {
  it('一次訓練取最大 e1RM：60×10（80.0）與 70×5（81.7）→ 81.7，topSet 是 70×5', () => {
    const d = db({
      workouts: [workout('w1', '2026-10-10')],
      workout_exercises: [entry('e1', 'w1', 'sq')],
      workout_sets: [set('s1', 'e1', 60, 10), set('s2', 'e1', 70, 5)],
    })
    expect(strengthHistory(d, 'sq')).toEqual([
      { workoutId: 'w1', date: '2026-10-10', e1rm: 81.7, topSet: { weight_kg: 70, reps: 5 } },
    ])
  })

  it('e1RM 相同時 topSet 取較重的一組，與資料列順序無關（60×10 與 75×2 都是 80.0）', () => {
    const mk = (a: Row, b: Row) =>
      db({ workouts: [workout('w1', '2026-10-10')], workout_exercises: [entry('e1', 'w1', 'sq')], workout_sets: [a, b] })
    const light = set('s1', 'e1', 60, 10) // 60 × 40/30 = 80
    const heavy = set('s2', 'e1', 75, 2) // 75 × 32/30 = 80
    for (const d of [mk(light, heavy), mk(heavy, light)]) {
      const p = strengthHistory(d, 'sq')[0]
      expect(p.e1rm).toBe(80)
      expect(p.topSet).toEqual({ weight_kg: 75, reps: 2 })
    }
  })

  it('只算已打勾的組；整次沒有有效組的訓練不出點', () => {
    const d = db({
      workouts: [workout('w1', '2026-10-10'), workout('w2', '2026-10-12')],
      workout_exercises: [entry('e1', 'w1', 'sq'), entry('e2', 'w2', 'sq')],
      workout_sets: [set('s1', 'e1', 100, 5, false), set('s2', 'e2', 50, 12), set('s3', 'e2', 80, 5)],
    })
    // w1 全沒打勾；w2 的 50×12 超過 10 下不算，只剩 80×5＝93.3
    expect(strengthHistory(d, 'sq')).toEqual([
      { workoutId: 'w2', date: '2026-10-12', e1rm: 93.3, topSet: { weight_kg: 80, reps: 5 } },
    ])
  })

  it('由舊到新；同一天依開始時間；只含指定動作', () => {
    const d = db({
      workouts: [
        workout('w2', '2026-10-12'),
        workout('w1', '2026-10-10'),
        workout('w3', '2026-10-12', '2026-10-12T18:00:00Z'),
      ],
      workout_exercises: [entry('e1', 'w1', 'sq'), entry('e2', 'w2', 'sq'), entry('e3', 'w3', 'sq'), entry('e4', 'w1', 'bp')],
      workout_sets: [set('s1', 'e1', 60, 5), set('s2', 'e2', 60, 5), set('s3', 'e3', 60, 5), set('s4', 'e4', 90, 5)],
    })
    expect(strengthHistory(d, 'sq').map((p) => p.workoutId)).toEqual(['w1', 'w2', 'w3'])
  })

  it('同一次訓練同動作出現兩個 entry 併成一點', () => {
    const d = db({
      workouts: [workout('w1', '2026-10-10')],
      workout_exercises: [entry('e1', 'w1', 'sq'), entry('e2', 'w1', 'sq')],
      workout_sets: [set('s1', 'e1', 60, 5), set('s2', 'e2', 80, 5)],
    })
    const pts = strengthHistory(d, 'sq')
    expect(pts).toHaveLength(1)
    expect(pts[0].e1rm).toBe(93.3)
  })

  it('訓練不存在（被刪除）的組不算；沒有紀錄回空陣列', () => {
    const d = db({
      workouts: [],
      workout_exercises: [entry('e1', 'gone', 'sq')],
      workout_sets: [set('s1', 'e1', 60, 5)],
    })
    expect(strengthHistory(d, 'sq')).toEqual([])
    expect(strengthHistory(db(), 'sq')).toEqual([])
  })
})

describe('bestE1rm', () => {
  it('取歷來最大；沒有任何點→null', () => {
    const d = db({
      workouts: [workout('w1', '2026-10-10'), workout('w2', '2026-10-12')],
      workout_exercises: [entry('e1', 'w1', 'sq'), entry('e2', 'w2', 'sq')],
      workout_sets: [set('s1', 'e1', 100, 5), set('s2', 'e2', 90, 5)],
    })
    expect(bestE1rm(strengthHistory(d, 'sq'))).toBe(116.7) // 較早那次最高
    expect(bestE1rm([])).toBeNull()
  })
})

describe('progressList', () => {
  it('只列有有效組的動作，依最近練的排前面，同日依名稱', () => {
    const d = db({
      exercises: [
        { id: 'sq', name: '深蹲' },
        { id: 'bp', name: '臥推' },
        { id: 'dl', name: '硬舉' },
        { id: 'pu', name: '引體向上' },
      ],
      workouts: [workout('w1', '2026-10-10'), workout('w2', '2026-10-12')],
      workout_exercises: [entry('e1', 'w1', 'sq'), entry('e2', 'w2', 'bp'), entry('e3', 'w2', 'dl'), entry('e4', 'w2', 'pu')],
      workout_sets: [set('s1', 'e1', 100, 5), set('s2', 'e2', 60, 10), set('s3', 'e3', 100, 1), set('s4', 'e4', 0, 8)],
    })
    const list = progressList(d)
    // 引體向上只有 0 kg，不列；10/12 的臥推、硬舉在前（兩者先後依名稱排序，不在此鎖死），深蹲 10/10 殿後
    expect(list).toHaveLength(3)
    expect(list.slice(0, 2).map((i) => i.exerciseId).sort()).toEqual(['bp', 'dl'])
    expect(list.map((i) => i.lastDate)).toEqual(['2026-10-12', '2026-10-12', '2026-10-10'])
    expect(list.find((i) => i.exerciseId === 'bp')).toEqual({
      exerciseId: 'bp', name: '臥推', sessions: 1, best: 80, lastDate: '2026-10-12',
    })
    expect(list.find((i) => i.exerciseId === 'pu')).toBeUndefined()
    expect(list[2].exerciseId).toBe('sq')
  })
})

describe('chartPoints', () => {
  const pt = (date: string): StrengthPoint => ({ workoutId: date, date, e1rm: 80, topSet: { weight_kg: 60, reps: 10 } })
  const pts = [pt('2026-09-20'), pt('2026-09-21'), pt('2026-10-20')]

  it('30 天＝今天加前 29 天：9/21 在內、9/20 在外', () => {
    expect(chartPoints(pts, '30', '2026-10-20').map((p) => p.date)).toEqual(['2026-09-21', '2026-10-20'])
  })

  it('全部不設下界；t 是自 1970-01-01 起算的天數，兩天相差 1', () => {
    const all = chartPoints(pts, 'all', '2026-10-20')
    expect(all).toHaveLength(3)
    expect(all[1].t - all[0].t).toBe(1)
    expect(all[0].t).toBe(20716) // 2026-09-20：自 1970-01-01 起 20716 天（2026-01-01 是 20454，加 262）
  })

  it('範圍內沒有點→空陣列', () => {
    expect(chartPoints([pt('2026-01-01')], '30', '2026-10-20')).toEqual([])
  })
})

describe('suggestWeight（雙重進階的簡化版）', () => {
  // 兩次歷史訓練 h1（較早）、h2（最近）＋進行中的 cur；lastSets 是 h2 的各組
  const base = (lastSets: Array<[number, number]>, routineId: string | null = null, routineExercises: readonly Row[] = []) =>
    db({
      workouts: [workout('h1', '2026-10-05'), workout('h2', '2026-10-08'), { ...workout('cur', '2026-10-12'), routine_id: routineId }],
      workout_exercises: [entry('e1', 'h1', 'sq'), entry('e2', 'h2', 'sq'), entry('e3', 'cur', 'sq')],
      workout_sets: [
        set('a1', 'e1', 55, 12),
        ...lastSets.map(([w, r], i) => ({ ...set(`b${i}`, 'e2', w, r), set_no: i + 1 })),
        set('c1', 'e3', 100, 1), // 進行中的訓練不算歷史
      ],
      routine_exercises: routineExercises,
    })

  it('最近一次 60×12 三組、T=12、加重 2.5 → 62.5，理由「上次三組都做到 12 下」', () => {
    expect(suggestWeight(base([[60, 12], [60, 12], [60, 12]]), 'sq', 2.5, 'cur')).toEqual({
      kind: 'suggest', weight_kg: 62.5, reason: '上次三組都做到 12 下',
    })
  })

  it('有一組沒做到：60×12、60×11、60×10 → 維持 60，理由「再做到 12 下」', () => {
    expect(suggestWeight(base([[60, 12], [60, 11], [60, 10]]), 'sq', 2.5, 'cur')).toEqual({
      kind: 'suggest', weight_kg: 60, reason: '再做到 12 下',
    })
  })

  it('只看最高重量的各組：熱身 40×12 不影響，60×12 兩組都做到 → 加重', () => {
    expect(suggestWeight(base([[40, 12], [60, 12], [60, 12]]), 'sq', 5, 'cur')).toEqual({
      kind: 'suggest', weight_kg: 65, reason: '上次兩組都做到 12 下',
    })
  })

  it('最高重量那組沒做到就維持，不管輕的組做到幾下：40×12、60×8', () => {
    expect(suggestWeight(base([[40, 12], [60, 8]]), 'sq', 5, 'cur')).toMatchObject({ weight_kg: 60, reason: '再做到 12 下' })
  })

  it('次數超過門檻也算做到（60×15）', () => {
    expect(suggestWeight(base([[60, 15]]), 'sq', 2.5, 'cur')).toMatchObject({ weight_kg: 62.5 })
  })

  it('門檻 T 取課表的 target_reps：T=8、最近一次 60×8 兩組 → 加重，理由寫 8 下', () => {
    const d = base([[60, 8], [60, 8]], 'r1', [{ id: 're1', routine_id: 'r1', exercise_id: 'sq', target_reps: 8 }])
    expect(suggestWeight(d, 'sq', 2.5, 'cur')).toEqual({ kind: 'suggest', weight_kg: 62.5, reason: '上次兩組都做到 8 下' })
  })

  it('課表沒設目標次數（null）、或動作不在課表裡 → 用 12', () => {
    const noTarget = base([[60, 10]], 'r1', [{ id: 're1', routine_id: 'r1', exercise_id: 'sq', target_reps: null }])
    expect(suggestWeight(noTarget, 'sq', 2.5, 'cur')).toMatchObject({ weight_kg: 60, reason: '再做到 12 下' })
    const otherExercise = base([[60, 10]], 'r1', [{ id: 're1', routine_id: 'r1', exercise_id: 'other', target_reps: 8 }])
    expect(suggestWeight(otherExercise, 'sq', 2.5, 'cur')).toMatchObject({ weight_kg: 60, reason: '再做到 12 下' })
  })

  it('只有 1 次訓練、或沒有任何歷史 → insufficient；進行中的訓練不算一次', () => {
    const one = db({
      workouts: [workout('h2', '2026-10-08'), workout('cur', '2026-10-12')],
      workout_exercises: [entry('e2', 'h2', 'sq'), entry('e3', 'cur', 'sq')],
      workout_sets: [set('b', 'e2', 60, 12), set('c', 'e3', 60, 12)],
    })
    expect(suggestWeight(one, 'sq', 2.5, 'cur')).toEqual({ kind: 'insufficient' })
    expect(suggestWeight(db({ workouts: [workout('cur', '2026-10-12')] }), 'sq', 2.5, 'cur')).toEqual({ kind: 'insufficient' })
  })

  it('沒打勾的訓練不算一次：兩次裡有一次全沒打勾 → insufficient', () => {
    const d = db({
      workouts: [workout('h1', '2026-10-05'), workout('h2', '2026-10-08'), workout('cur', '2026-10-12')],
      workout_exercises: [entry('e1', 'h1', 'sq'), entry('e2', 'h2', 'sq')],
      workout_sets: [set('a', 'e1', 60, 12, false), set('b', 'e2', 60, 12)],
    })
    expect(suggestWeight(d, 'sq', 2.5, 'cur')).toEqual({ kind: 'insufficient' })
  })

  it('同一次訓練同動作出現兩個 entry 不算兩次', () => {
    const d = db({
      workouts: [workout('h2', '2026-10-08'), workout('cur', '2026-10-12')],
      workout_exercises: [entry('e1', 'h2', 'sq'), { ...entry('e2', 'h2', 'sq'), position: 1 }],
      workout_sets: [set('a', 'e1', 60, 12), set('b', 'e2', 60, 12)],
    })
    expect(suggestWeight(d, 'sq', 2.5, 'cur')).toEqual({ kind: 'insufficient' })
  })

  it('最高重量 0（徒手記成 0 kg）→ none（沒有重量可加），不建議 +2.5、也不說資料不足', () => {
    expect(suggestWeight(base([[0, 15], [0, 15]]), 'sq', 2.5, 'cur')).toEqual({ kind: 'none' })
  })

  it('只有一組做到：理由寫「上次那組做到 12 下」，不寫「一組都」', () => {
    expect(suggestWeight(base([[60, 12]]), 'sq', 2.5, 'cur')).toEqual({
      kind: 'suggest', weight_kg: 62.5, reason: '上次那組做到 12 下',
    })
  })

  it('編輯舊訓練時，比它晚的訓練不算「上次」：10/12 那次 100×12 不能拿來建議 10/08 這次', () => {
    const d = db({
      workouts: [workout('h1', '2026-10-05'), workout('h2', '2026-10-08'), workout('late', '2026-10-12')],
      workout_exercises: [entry('e1', 'h1', 'sq'), entry('e3', 'late', 'sq')],
      workout_sets: [set('a', 'e1', 60, 12), set('c', 'e3', 100, 12)],
    })
    // 編輯 h2（10/08）：它之前只有 h1 一次 → 不足；若把 10/12 算進來會變成兩次、建議 102.5
    expect(suggestWeight(d, 'sq', 2.5, 'h2')).toEqual({ kind: 'insufficient' })
    // 編輯 10/12 那次：之前有 h1 一次，仍然不足
    expect(suggestWeight(d, 'sq', 2.5, 'late')).toEqual({ kind: 'insufficient' })
  })

  it('同一天只算開始時間更早的：補記與當天另一次訓練', () => {
    const d = db({
      workouts: [
        workout('h1', '2026-10-05'),
        workout('am', '2026-10-08', '2026-10-08T06:00:00Z'),
        workout('pm', '2026-10-08', '2026-10-08T18:00:00Z'),
      ],
      workout_exercises: [entry('e1', 'h1', 'sq'), entry('e2', 'am', 'sq'), entry('e3', 'pm', 'sq')],
      workout_sets: [set('a', 'e1', 60, 12), set('b', 'e2', 70, 12), set('c', 'e3', 90, 12)],
    })
    // 編輯 am：之前只有 h1（pm 晚於它）→ 不足
    expect(suggestWeight(d, 'sq', 2.5, 'am')).toEqual({ kind: 'insufficient' })
    // 編輯 pm：之前有 h1 與 am → 以 am 的 70×12 為準
    expect(suggestWeight(d, 'sq', 2.5, 'pm')).toMatchObject({ weight_kg: 72.5 })
  })

  it('小數相加不留浮點尾巴：57.5＋2.5＝60、12.5＋2.5＝15', () => {
    expect(suggestWeight(base([[57.5, 12]]), 'sq', 2.5, 'cur')).toMatchObject({ weight_kg: 60 })
    expect(suggestWeight(base([[12.5, 12]]), 'sq', 2.5, 'cur')).toMatchObject({ weight_kg: 15 })
  })

  it('組數超過十用阿拉伯數字（11 組都做到）', () => {
    const sets: Array<[number, number]> = Array.from({ length: 11 }, () => [20, 12])
    expect(suggestWeight(base(sets), 'sq', 2.5, 'cur')).toMatchObject({ reason: '上次11組都做到 12 下' })
  })
})

describe('資料裡混了有氧卡（spec「有氧併入動作」AC 6）', () => {
  // 有氧卡＝workout_exercises 一列、有氧欄位有值、沒有任何組；同場與只有有氧的訓練都放
  const card = (id: string, workout_id: string): Row => ({ ...entry(id, workout_id, 'walk'), minutes: 30, speed_kmh: 5.5, incline_pct: 8 })
  const d = db({
    exercises: [{ id: 'sq', name: '深蹲' }, { id: 'walk', name: '跑步機坡度健走', kind: 'incline_walk' }],
    workouts: [workout('w1', '2026-10-10'), workout('wc1', '2026-10-11'), workout('wc2', '2026-10-12')],
    workout_exercises: [entry('e1', 'w1', 'sq'), card('c0', 'w1'), card('c1', 'wc1'), card('c2', 'wc2')],
    workout_sets: [set('s1', 'e1', 100, 5)],
  })

  it('strengthHistory／progressList：有氧動作沒有點、不列；重訓動作的點不變（100×5 → 116.7）', () => {
    expect(strengthHistory(d, 'walk')).toEqual([])
    expect(strengthHistory(d, 'sq')).toEqual([{ workoutId: 'w1', date: '2026-10-10', e1rm: 116.7, topSet: { weight_kg: 100, reps: 5 } }])
    expect(progressList(d)).toEqual([{ exerciseId: 'sq', name: '深蹲', sessions: 1, best: 116.7, lastDate: '2026-10-10' }])
  })

  it('suggestWeight：有氧動作兩次只有有氧的訓練也是資料不足；重訓動作的建議不受同場有氧卡影響', () => {
    expect(suggestWeight(d, 'walk', 2.5, 'cur')).toEqual({ kind: 'insufficient' })
    // 同 suggestWeight 那組的 base([[60, 12] × 3])，h2 與進行中的 cur 各多一張有氧卡
    const mixed = db({
      exercises: [{ id: 'walk', name: '跑步機坡度健走', kind: 'incline_walk' }],
      workouts: [workout('h1', '2026-10-05'), workout('h2', '2026-10-08'), workout('cur', '2026-10-12')],
      workout_exercises: [entry('e1', 'h1', 'sq'), entry('e2', 'h2', 'sq'), entry('e3', 'cur', 'sq'), card('ch2', 'h2'), card('ccur', 'cur')],
      workout_sets: [
        set('a1', 'e1', 55, 12),
        { ...set('b0', 'e2', 60, 12), set_no: 1 },
        { ...set('b1', 'e2', 60, 12), set_no: 2 },
        { ...set('b2', 'e2', 60, 12), set_no: 3 },
      ],
    })
    expect(suggestWeight(mixed, 'sq', 2.5, 'cur')).toEqual({ kind: 'suggest', weight_kg: 62.5, reason: '上次三組都做到 12 下' })
  })
})
