import { describe, expect, it } from 'vitest'
import { bestE1rm, chartPoints, e1rm, progressList, strengthHistory, type StrengthPoint } from './strength'
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
