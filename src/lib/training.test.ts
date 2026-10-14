import { describe, expect, it } from 'vitest'
import type { QueueEntry } from './queue'
import { localDate } from './dates'
import {
  MUSCLE_GROUPS,
  PRESET_EXERCISES,
  applyQueue,
  backfillTimes,
  emptyTrainingDb,
  lastCompletedSets,
  parentRefs,
  prefillSets,
  presetExerciseId,
  presetsToSeed,
  workoutSummary,
  type Row,
  type TrainingDb,
  type TrainingTable,
} from './training'

/* ═══════════ 測試替身 ═══════════ */

const db = (p: Partial<Record<TrainingTable, readonly Row[]>> = {}): TrainingDb => ({ ...emptyTrainingDb(), ...p })

const entry = (
  seq: number,
  op: QueueEntry['op'],
  table: string,
  rowId: string,
  payload: Record<string, unknown> | null = {},
  userId = 'u1',
): QueueEntry => ({
  seq, op, table, rowId, userId,
  payload: op === 'delete' ? null : payload,
  createdAt: 0, attempts: 0, lastError: null, failure: null,
})

const workout = (id: string, performed_on: string, started_at = `${performed_on}T10:00:00.000Z`): Row => ({
  id, performed_on, started_at, ended_at: null, routine_id: null,
})
const we = (id: string, workout_id: string, exercise_id: string, position = 0): Row => ({
  id, workout_id, exercise_id, position,
})
const set = (
  id: string, workout_exercise_id: string, set_no: number, weight_kg: number, reps: number, done = true,
): Row => ({ id, workout_exercise_id, set_no, weight_kg, reps, done })

/* ═══════════ 預填動作（AC 1） ═══════════ */

describe('預填動作', () => {
  it('16 個，各肌群數量與 spec 一致，肌群都在七類之內', () => {
    expect(PRESET_EXERCISES).toHaveLength(16)
    const count = (g: string) => PRESET_EXERCISES.filter((p) => p.muscle_group === g).length
    expect({
      legs: count('legs'), back: count('back'), chest: count('chest'),
      shoulder: count('shoulder'), arms: count('arms'), core: count('core'), other: count('other'),
    }).toEqual({ legs: 6, back: 3, chest: 2, shoulder: 2, arms: 2, core: 1, other: 0 })
    for (const p of PRESET_EXERCISES) expect(MUSCLE_GROUPS).toContain(p.muscle_group)
  })

  it('確定性 id：同一個使用者永遠同一組 id（兩個容器各自預填不重複），不同使用者不撞', () => {
    const a = presetsToSeed('user-a', []).map((r) => r.id)
    expect(presetsToSeed('user-a', []).map((r) => r.id)).toEqual(a)
    expect(new Set(a).size).toBe(16)
    for (const id of a) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const b = presetsToSeed('user-b', []).map((r) => r.id)
    expect(b.filter((id) => a.includes(id))).toEqual([])
    expect(presetExerciseId('user-a', 'leg-press')).toBe(a[0])
  })

  it('列的內容：要點留空、未封存、帶 user_id', () => {
    const [first] = presetsToSeed('u1', [])
    expect(first).toMatchObject({ name: '腿推舉', muscle_group: 'legs', tips: null, archived: false, user_id: 'u1' })
  })

  it('只在一個動作都沒有時預填：有了就不補，免得把使用者改過的蓋回預設', () => {
    expect(presetsToSeed('u1', [{ id: 'x', name: '自訂動作' }])).toEqual([])
  })
})

/* ═══════════ 外鍵（AC 16） ═══════════ */

describe('parentRefs', () => {
  it('組只依賴動作；動作依賴訓練與動作庫；課表動作依賴課表與動作庫', () => {
    expect(parentRefs('workout_sets', { workout_exercise_id: 'we1' })).toEqual([
      { table: 'workout_exercises', rowId: 'we1' },
    ])
    expect(parentRefs('workout_exercises', { workout_id: 'w1', exercise_id: 'e1' })).toEqual([
      { table: 'workouts', rowId: 'w1' },
      { table: 'exercises', rowId: 'e1' },
    ])
    expect(parentRefs('routine_exercises', { routine_id: 'r1', exercise_id: 'e1' })).toEqual([
      { table: 'routines', rowId: 'r1' },
      { table: 'exercises', rowId: 'e1' },
    ])
  })

  it('可為空的外鍵沒填就不列（空白開始的訓練沒有課表）', () => {
    expect(parentRefs('workouts', { routine_id: null })).toEqual([])
    expect(parentRefs('workouts', {})).toEqual([])
    expect(parentRefs('workouts', { routine_id: 'r1' })).toEqual([{ table: 'routines', rowId: 'r1' }])
  })

  it('沒有外鍵的表回空陣列', () => {
    expect(parentRefs('exercises', { name: 'x' })).toEqual([])
    expect(parentRefs('cardio_sessions', { minutes: 30 })).toEqual([])
  })
})

/* ═══════════ 疊加未同步變更（AC 18） ═══════════ */

describe('applyQueue', () => {
  it('insert 排在後面、update 就地合併、delete 移除；不改動傳入的 base', () => {
    const base = db({ exercises: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] })
    const frozen = JSON.stringify(base)
    const out = applyQueue(
      base,
      [
        entry(1, 'insert', 'exercises', 'c', { name: 'C' }),
        entry(2, 'update', 'exercises', 'a', { name: 'A2' }),
        entry(3, 'delete', 'exercises', 'b'),
      ],
      'u1',
    )
    expect(out.exercises).toEqual([{ id: 'a', name: 'A2' }, { id: 'c', name: 'C' }])
    expect(JSON.stringify(base)).toBe(frozen)
  })

  it('依 seq 重放，不依陣列順序', () => {
    const out = applyQueue(
      db({ exercises: [{ id: 'a', name: 'A' }] }),
      [entry(2, 'update', 'exercises', 'a', { name: 'second' }), entry(1, 'update', 'exercises', 'a', { name: 'first' })],
      'u1',
    )
    expect(out.exercises[0].name).toBe('second')
  })

  it('只看自己的條目與認得的表', () => {
    const out = applyQueue(
      db(),
      [
        entry(1, 'insert', 'exercises', 'mine', { name: 'M' }),
        entry(2, 'insert', 'exercises', 'theirs', { name: 'T' }, 'u2'),
        entry(3, 'insert', 'foods', 'f1', { name: 'rice' }),
      ],
      'u1',
    )
    expect(out.exercises.map((r) => r.id)).toEqual(['mine'])
  })

  it('insert 是 upsert：已存在就合併欄位，不重複出現', () => {
    const out = applyQueue(
      db({ exercises: [{ id: 'a', name: 'A', tips: 'keep' }] }),
      [entry(1, 'insert', 'exercises', 'a', { name: 'A2' })],
      'u1',
    )
    expect(out.exercises).toEqual([{ id: 'a', name: 'A2', tips: 'keep' }])
  })

  it('update 一列不存在的列：不憑空長出一列', () => {
    const out = applyQueue(db(), [entry(1, 'update', 'exercises', 'ghost', { name: 'x' })], 'u1')
    expect(out.exercises).toEqual([])
  })

  it('刪訓練：動作與組一路隱藏（伺服器會 cascade），別的訓練不受影響', () => {
    const base = db({
      workouts: [workout('w1', '2026-10-10'), workout('w2', '2026-10-11')],
      workout_exercises: [we('we1', 'w1', 'e1'), we('we2', 'w2', 'e1')],
      workout_sets: [set('s1', 'we1', 1, 60, 10), set('s2', 'we2', 1, 60, 10)],
    })
    const out = applyQueue(base, [entry(1, 'delete', 'workouts', 'w1')], 'u1')
    expect(out.workouts.map((r) => r.id)).toEqual(['w2'])
    expect(out.workout_exercises.map((r) => r.id)).toEqual(['we2'])
    expect(out.workout_sets.map((r) => r.id)).toEqual(['s2'])
  })

  it('刪動作庫的動作（restrict，不級聯）：引用它的訓練動作不跟著消失', () => {
    const base = db({
      exercises: [{ id: 'e1', name: 'A' }],
      workout_exercises: [we('we1', 'w1', 'e1')],
    })
    const out = applyQueue(base, [entry(1, 'delete', 'exercises', 'e1')], 'u1')
    expect(out.exercises).toEqual([])
    expect(out.workout_exercises.map((r) => r.id)).toEqual(['we1'])
  })

  it('基底裡缺父列不等於被刪：沒有明確的 delete 就不隱藏子列', () => {
    const base = db({ workout_exercises: [we('we1', 'w-not-loaded', 'e1')] })
    expect(applyQueue(base, [], 'u1').workout_exercises).toHaveLength(1)
  })

  it('離線剛新增的整棵訓練（只在佇列裡）看得到，且帶出 id', () => {
    const out = applyQueue(
      db(),
      [
        entry(1, 'insert', 'workouts', 'w1', { performed_on: '2026-10-14' }),
        entry(2, 'insert', 'workout_exercises', 'we1', { workout_id: 'w1', exercise_id: 'e1', position: 0 }),
      ],
      'u1',
    )
    expect(out.workouts[0]).toMatchObject({ id: 'w1', performed_on: '2026-10-14' })
    expect(out.workout_exercises[0]).toMatchObject({ id: 'we1', workout_id: 'w1' })
  })
})

/* ═══════════ 預填上次的值（AC 5） ═══════════ */

describe('lastCompletedSets／prefillSets', () => {
  const history = db({
    workouts: [workout('w1', '2026-10-01'), workout('w2', '2026-10-08')],
    workout_exercises: [we('we1', 'w1', 'e1'), we('we2', 'w2', 'e1')],
    workout_sets: [
      set('s1', 'we1', 1, 50, 12),
      set('s2', 'we2', 2, 62.5, 8),
      set('s3', 'we2', 1, 60, 10),
      set('s4', 'we2', 3, 65, 6, false), // 沒打勾：不算完成
    ],
  })

  it('取最近一次的已打勾組，依 set_no 排，沒打勾的不帶', () => {
    expect(lastCompletedSets(history, 'e1')).toEqual([
      { weight_kg: 60, reps: 10 },
      { weight_kg: 62.5, reps: 8 },
    ])
  })

  it('進行中的這一次要排除，改看更早一次', () => {
    expect(lastCompletedSets(history, 'e1', 'w2')).toEqual([{ weight_kg: 50, reps: 12 }])
  })

  it('最近一次整次都沒打勾：跳過、改看更早一次', () => {
    const d = db({
      ...history,
      workouts: [...history.workouts, workout('w3', '2026-10-12')],
      workout_exercises: [...history.workout_exercises, we('we3', 'w3', 'e1')],
      workout_sets: [...history.workout_sets, set('s5', 'we3', 1, 99, 1, false)],
    })
    expect(lastCompletedSets(d, 'e1')).toHaveLength(2)
    expect(lastCompletedSets(d, 'e1')[0]).toEqual({ weight_kg: 60, reps: 10 })
  })

  it('同一天兩次訓練：以開始時間較晚的為準', () => {
    const d = db({
      workouts: [workout('wa', '2026-10-10', '2026-10-10T01:00:00.000Z'), workout('wb', '2026-10-10', '2026-10-10T09:00:00.000Z')],
      workout_exercises: [we('wea', 'wa', 'e1'), we('web', 'wb', 'e1')],
      workout_sets: [set('sa', 'wea', 1, 40, 10), set('sb', 'web', 1, 45, 10)],
    })
    expect(lastCompletedSets(d, 'e1')).toEqual([{ weight_kg: 45, reps: 10 }])
  })

  it('別的動作的歷史不混進來；沒有歷史回空陣列', () => {
    expect(lastCompletedSets(history, 'e-other')).toEqual([])
  })

  it('numeric 欄位以字串回來時也轉成數字', () => {
    const d = db({
      workouts: [workout('w1', '2026-10-01')],
      workout_exercises: [we('we1', 'w1', 'e1')],
      workout_sets: [{ id: 's1', workout_exercise_id: 'we1', set_no: 1, weight_kg: '22.50', reps: '12', done: true }],
    })
    expect(lastCompletedSets(d, 'e1')).toEqual([{ weight_kg: 22.5, reps: 12 }])
  })

  it('有歷史就用歷史（課表預設不覆蓋）；沒歷史才用課表預設，重量 0', () => {
    expect(prefillSets(history, 'e1', { target_sets: 5, target_reps: 15 })).toHaveLength(2)
    expect(prefillSets(history, 'e-new', { target_sets: 2, target_reps: 15 })).toEqual([
      { weight_kg: 0, reps: 15 },
      { weight_kg: 0, reps: 15 },
    ])
  })

  it('連課表預設都沒有：3 組、次數 0；組數不合理時至少 1 組', () => {
    expect(prefillSets(history, 'e-new')).toEqual(Array(3).fill({ weight_kg: 0, reps: 0 }))
    expect(prefillSets(history, 'e-new', { target_sets: 0 })).toHaveLength(1)
    expect(prefillSets(history, 'e-new', { target_sets: null, target_reps: null })).toHaveLength(3)
  })
})

/* ═══════════ 訓練摘要（AC 7） ═══════════ */

describe('workoutSummary', () => {
  const at = (iso: string) => new Date(iso)

  it('總訓練量只算已打勾的組：腿推舉 60×12×3＝2160（AC 7 驗算）', () => {
    const s = workoutSummary(
      [
        { weight_kg: 60, reps: 12, done: true },
        { weight_kg: 60, reps: 12, done: true },
        { weight_kg: 60, reps: 12, done: true },
        { weight_kg: 60, reps: 12, done: false },
      ],
      '2026-10-14T10:00:00.000Z', null, at('2026-10-14T10:36:59.000Z'),
    )
    expect(s).toMatchObject({ volume: 2160, doneSets: 3, totalSets: 4 })
  })

  it.each([
    [12.35, 3, 37.05],
    [16.1, 10, 161], // 直接 16.1×100×10÷100 會得 161.00000000000003
    [10.05, 10, 100.5], // 100.50000000000001
    [16.15, 10, 161.5], // 161.49999999999997
  ])('小數重量沒有浮點尾巴：%f kg × %i 次＝%f', (weight_kg, reps, expected) => {
    const s = workoutSummary([{ weight_kg, reps, done: true }], '2026-10-14T10:00:00.000Z', null, at('2026-10-14T10:00:00.000Z'))
    expect(s.volume).toBe(expected)
  })

  it('進行中用現在時間、已結束用 ended_at；滿幾分鐘才算（捨去）', () => {
    const started = '2026-10-14T10:00:00.000Z'
    expect(workoutSummary([], started, null, at('2026-10-14T10:36:59.000Z')).minutes).toBe(36)
    expect(workoutSummary([], started, '2026-10-14T11:00:00.000Z', at('2026-10-15T00:00:00.000Z')).minutes).toBe(60)
  })

  it('時鐘倒退或時間壞掉：時長 0，不出現負數或 NaN', () => {
    expect(workoutSummary([], '2026-10-14T10:00:00.000Z', null, at('2026-10-14T09:00:00.000Z')).minutes).toBe(0)
    expect(workoutSummary([], 'not-a-date', null, at('2026-10-14T09:00:00.000Z')).minutes).toBe(0)
  })

  it('沒有任何組：全是 0', () => {
    expect(workoutSummary([], '2026-10-14T10:00:00.000Z', null, at('2026-10-14T10:00:00.000Z'))).toEqual({
      volume: 0, doneSets: 0, totalSets: 0, minutes: 0,
    })
  })
})

/* ═══════════ 補記過去日子（AC 8a） ═══════════ */

describe('backfillTimes', () => {
  it('started_at 是該日本機 12:00（不論時區，本機日期就是補記的那天）', () => {
    const { started_at } = backfillTimes('2026-10-10', null)
    const d = new Date(started_at)
    expect(localDate(d)).toBe('2026-10-10')
    expect(d.getHours()).toBe(12)
    expect(d.getMinutes()).toBe(0)
  })

  it('略過時長：ended_at 等於 started_at；有填就加上去', () => {
    const none = backfillTimes('2026-10-10', null)
    expect(none.ended_at).toBe(none.started_at)
    const hour = backfillTimes('2026-10-10', 45)
    expect(Date.parse(hour.ended_at) - Date.parse(hour.started_at)).toBe(45 * 60_000)
  })

  it('跨午夜的時長不改 performed_on 的歸屬：started_at 仍在補記那一天', () => {
    const { started_at, ended_at } = backfillTimes('2026-10-10', 1440)
    expect(localDate(new Date(started_at))).toBe('2026-10-10')
    expect(Date.parse(ended_at) - Date.parse(started_at)).toBe(1440 * 60_000)
  })

  it.each([
    ['日期格式不對', '2026/10/10', 30],
    ['不存在的日期', '2026-02-31', 30],
    ['負的時長', '2026-10-10', -1],
    ['超過一天', '2026-10-10', 1441],
    ['NaN', '2026-10-10', Number.NaN],
  ])('%s 要丟錯，不默默修正', (_label, date, minutes) => {
    expect(() => backfillTimes(date, minutes)).toThrow()
  })
})
