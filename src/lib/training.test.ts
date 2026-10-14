import { describe, expect, it } from 'vitest'
import type { QueueEntry } from './queue'
import { localDate } from './dates'
import {
  MUSCLE_GROUPS,
  PRESET_EXERCISES,
  cardioDraft,
  cardioLabel,
  cardioOn,
  cardioSummary,
  checkCardio,
  createCardioOps,
  deleteCardioOps,
  updateCardioOps,
  type CardioDraft,
  addExerciseOps,
  addSetOps,
  applyQueue,
  backfillTimes,
  checkExercise,
  createExerciseOps,
  emptyTrainingDb,
  filterExercises,
  finishWorkoutOps,
  formatLastSets,
  isBackfilled,
  lastCompletedSets,
  parentRefs,
  prefillSets,
  presetExerciseId,
  presetsToSeed,
  setExerciseArchivedOps,
  setsOfDetail,
  startWorkoutOps,
  trainingDates,
  updateExerciseOps,
  workoutDetail,
  workoutSummary,
  workoutsOn,
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
const exercise = (id: string, name = id): Row => ({ id, name, muscle_group: 'legs', tips: null, archived: false })

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
  it('組只依賴動作；動作依賴訓練與動作庫；課表動作依賴課表與動作庫；帶欄位與 DDL 的 on delete', () => {
    expect(parentRefs('workout_sets', { workout_exercise_id: 'we1' })).toEqual([
      { table: 'workout_exercises', rowId: 'we1', column: 'workout_exercise_id', onDelete: 'cascade' },
    ])
    expect(parentRefs('workout_exercises', { workout_id: 'w1', exercise_id: 'e1' })).toEqual([
      { table: 'workouts', rowId: 'w1', column: 'workout_id', onDelete: 'cascade' },
      { table: 'exercises', rowId: 'e1', column: 'exercise_id', onDelete: 'restrict' },
    ])
    expect(parentRefs('routine_exercises', { routine_id: 'r1', exercise_id: 'e1' })).toEqual([
      { table: 'routines', rowId: 'r1', column: 'routine_id', onDelete: 'cascade' },
      { table: 'exercises', rowId: 'e1', column: 'exercise_id', onDelete: 'restrict' },
    ])
  })

  it('可為空的外鍵沒填就不列（空白開始的訓練沒有課表）', () => {
    expect(parentRefs('workouts', { routine_id: null })).toEqual([])
    expect(parentRefs('workouts', {})).toEqual([])
    expect(parentRefs('workouts', { routine_id: 'r1' })).toEqual([
      { table: 'routines', rowId: 'r1', column: 'routine_id', onDelete: 'setNull' },
    ])
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

/* ═══════════ 訓練頁的資料 ═══════════ */

describe('trainingDates', () => {
  it('重訓與有氧的日子都算，同一天只算一次', () => {
    const d = db({
      workouts: [workout('w1', '2026-10-10'), workout('w2', '2026-10-10'), workout('w3', '2026-10-12')],
      cardio_sessions: [{ id: 'c1', performed_on: '2026-10-11' }, { id: 'c2', performed_on: '2026-10-12' }],
    })
    expect([...trainingDates(d)].sort()).toEqual(['2026-10-10', '2026-10-11', '2026-10-12'])
  })

  it('沒有任何訓練＝空集合', () => {
    expect(trainingDates(db()).size).toBe(0)
  })
})

describe('workoutsOn', () => {
  const now = new Date('2026-10-14T10:36:59.000Z')
  const d = db({
    workouts: [
      { ...workout('late', '2026-10-14', '2026-10-14T09:00:00.000Z'), ended_at: null },
      { ...workout('early', '2026-10-14', '2026-10-14T01:00:00.000Z'), ended_at: '2026-10-14T01:36:00.000Z' },
      workout('other-day', '2026-10-13'),
    ],
    workout_exercises: [we('we1', 'early', 'e1'), we('we2', 'early', 'e2'), we('we3', 'late', 'e1')],
    workout_sets: [
      set('s1', 'we1', 1, 60, 12),
      set('s2', 'we1', 2, 60, 12),
      set('s3', 'we2', 1, 40, 10, false),
      set('s4', 'we3', 1, 50, 10),
    ],
  })

  it('只列這一天的，依開始時間由早到晚', () => {
    expect(workoutsOn(d, '2026-10-14', now).map((c) => c.id)).toEqual(['early', 'late'])
    expect(workoutsOn(d, '2026-10-13', now).map((c) => c.id)).toEqual(['other-day'])
    expect(workoutsOn(d, '2026-10-01', now)).toEqual([])
  })

  it('動作數、組數、訓練量只算已打勾的、時長用結束時間', () => {
    const [early] = workoutsOn(d, '2026-10-14', now)
    expect(early).toMatchObject({
      exerciseCount: 2, doneSets: 2, totalSets: 3, volume: 1440, minutes: 36, inProgress: false,
    })
  })

  it('進行中的（沒有結束時間）標記出來，時長算到現在', () => {
    const late = workoutsOn(d, '2026-10-14', now)[1]
    expect(late).toMatchObject({ inProgress: true, endedAt: null, minutes: 96, volume: 500 })
  })

  it('沒有任何動作的訓練也列出來（剛開始、還沒加動作）', () => {
    const only = db({ workouts: [workout('w', '2026-10-14')] })
    expect(workoutsOn(only, '2026-10-14', now)[0]).toMatchObject({ exerciseCount: 0, totalSets: 0, volume: 0 })
  })
})

/* ═══════════ 一次訓練的內容與寫入組裝 ═══════════ */

const idGen = () => {
  let i = 0
  return () => `n${++i}`
}

describe('workoutDetail／setsOfDetail', () => {
  const d = db({
    exercises: [exercise('e1', '腿推舉'), exercise('e2', '坐姿胸推')],
    workouts: [workout('w1', '2026-10-14'), workout('w2', '2026-10-14')],
    workout_exercises: [we('we2', 'w1', 'e2', 1), we('we1', 'w1', 'e1', 0), we('weX', 'w2', 'e1', 0), we('weGone', 'w1', 'e-deleted', 2)],
    workout_sets: [
      set('s2', 'we1', 2, 62.5, 10),
      set('s1', 'we1', 1, 60, 12),
      set('s3', 'we2', 1, 35, 12, false),
      set('sx', 'weX', 1, 99, 1),
    ],
  })

  it('動作依 position、組依 set_no 排好，且只含這一次訓練的列', () => {
    const detail = workoutDetail(d, 'w1')!
    expect(detail.exercises.map((e) => e.entry.id)).toEqual(['we1', 'we2', 'weGone'])
    expect(detail.exercises[0].sets.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(detail.exercises.flatMap((e) => e.sets).some((s) => s.id === 'sx')).toBe(false)
  })

  it('帶出動作庫那一列；動作庫裡找不到時是 null，不讓畫面崩', () => {
    const detail = workoutDetail(d, 'w1')!
    expect(detail.exercises[0].exercise?.name).toBe('腿推舉')
    expect(detail.exercises[2].exercise).toBeNull()
  })

  it('找不到這次訓練（被刪了）回 null', () => {
    expect(workoutDetail(d, 'nope')).toBeNull()
  })

  it('攤平成各組，供 workoutSummary 計算', () => {
    const flat = setsOfDetail(workoutDetail(d, 'w1')!)
    expect(flat).toEqual([
      { weight_kg: 60, reps: 12, done: true },
      { weight_kg: 62.5, reps: 10, done: true },
      { weight_kg: 35, reps: 12, done: false },
    ])
  })
})

describe('isBackfilled', () => {
  const TODAY = '2026-10-14'
  const synthetic = (date: string) => ({ ...workout('w', date), started_at: backfillTimes(date, null).started_at })

  it('過去的日子、起點剛好是當天本機 12:00＝補記', () => {
    expect(isBackfilled(synthetic('2026-10-10'), TODAY)).toBe(true)
  })

  it('今天的不算補記，即使時間剛好是 12:00', () => {
    expect(isBackfilled(synthetic(TODAY), TODAY)).toBe(false)
  })

  it('過去那天真的開始、沒結束的（跨午夜忘了按完成）不算補記：它有真的起點', () => {
    expect(isBackfilled({ ...workout('w', '2026-10-10'), started_at: '2026-10-10T02:17:00.000Z' }, TODAY)).toBe(false)
  })

  it('壞掉的日期不丟錯', () => {
    expect(isBackfilled({ id: 'w', performed_on: 'garbage', started_at: 'x' }, TODAY)).toBe(false)
  })
})

describe('startWorkoutOps', () => {
  const now = new Date(2026, 9, 14, 10, 30, 0) // 本機 2026-10-14 10:30

  it('選到今天：現在開始，進行中', () => {
    const [op] = startWorkoutOps({ workoutId: 'w1', date: '2026-10-14', now })
    expect(op).toEqual({
      op: 'insert', table: 'workouts', rowId: 'w1',
      payload: { performed_on: '2026-10-14', started_at: now.toISOString(), ended_at: null, routine_id: null },
    })
  })

  it('選到過去：補記，起點是那天中午、一樣是進行中（完成時才手填時長）', () => {
    const [op] = startWorkoutOps({ workoutId: 'w1', date: '2026-10-10', now })
    expect(op.payload).toMatchObject({ performed_on: '2026-10-10', ended_at: null })
    const started = new Date(String(op.payload?.started_at))
    expect(localDate(started)).toBe('2026-10-10')
    expect(started.getHours()).toBe(12)
  })
})

describe('addExerciseOps', () => {
  const history = db({
    workouts: [workout('old', '2026-10-01')],
    workout_exercises: [we('weOld', 'old', 'e1')],
    workout_sets: [set('o1', 'weOld', 1, 60, 10), set('o2', 'weOld', 2, 62.5, 8)],
  })
  const setsOf = (ops: ReturnType<typeof addExerciseOps>) => ops.filter((o) => o.table === 'workout_sets')

  it('有歷史：各組取上次實際完成的值、都沒打勾、組號從 1 起', () => {
    const ops = addExerciseOps({ db: history, workoutId: 'w', exerciseId: 'e1', newId: idGen() })
    expect(ops[0]).toMatchObject({ op: 'insert', table: 'workout_exercises', payload: { workout_id: 'w', exercise_id: 'e1', position: 0 } })
    expect(setsOf(ops).map((o) => o.payload)).toEqual([
      { workout_exercise_id: ops[0].rowId, set_no: 1, weight_kg: 60, reps: 10, done: false },
      { workout_exercise_id: ops[0].rowId, set_no: 2, weight_kg: 62.5, reps: 8, done: false },
    ])
  })

  it('沒歷史：用課表預設的組數與次數，重量 0', () => {
    const ops = addExerciseOps({ db: db(), workoutId: 'w', exerciseId: 'e9', newId: idGen(), target: { target_sets: 2, target_reps: 8 } })
    expect(setsOf(ops).map((o) => [o.payload?.weight_kg, o.payload?.reps])).toEqual([[0, 8], [0, 8]])
  })

  it('沒歷史也沒課表預設：3 組、次數 0', () => {
    const ops = addExerciseOps({ db: db(), workoutId: 'w', exerciseId: 'e9', newId: idGen() })
    expect(setsOf(ops)).toHaveLength(3)
  })

  it('position 接在這次訓練已有的動作後面', () => {
    const d = db({ workout_exercises: [we('a', 'w', 'e1', 0), we('b', 'w', 'e2', 1), we('c', 'other', 'e1', 5)] })
    const ops = addExerciseOps({ db: d, workoutId: 'w', exerciseId: 'e3', newId: idGen() })
    expect(ops[0].payload?.position).toBe(2)
  })

  it('這一次訓練自己打勾的組不能當成「上次」', () => {
    const d = db({
      workouts: [workout('w', '2026-10-14')],
      workout_exercises: [we('weNow', 'w', 'e1')],
      workout_sets: [set('now1', 'weNow', 1, 99, 1)],
    })
    const ops = addExerciseOps({ db: d, workoutId: 'w', exerciseId: 'e1', newId: idGen() })
    expect(setsOf(ops).map((o) => o.payload?.weight_kg)).toEqual([0, 0, 0])
  })

  it('每一列的 id 都不同', () => {
    const ops = addExerciseOps({ db: history, workoutId: 'w', exerciseId: 'e1', newId: idGen() })
    expect(new Set(ops.map((o) => o.rowId)).size).toBe(ops.length)
  })
})

describe('addSetOps', () => {
  it('預填上一組的值，組號接在最大的後面', () => {
    const d = db({ workout_sets: [set('a', 'we', 1, 60, 12), set('b', 'we', 2, 62.5, 10), set('z', 'other', 1, 5, 5)] })
    const [op] = addSetOps({ db: d, workoutExerciseId: 'we', newId: () => 'new' })
    expect(op).toEqual({
      op: 'insert', table: 'workout_sets', rowId: 'new',
      payload: { workout_exercise_id: 'we', set_no: 3, weight_kg: 62.5, reps: 10, done: false },
    })
  })

  it('這個動作還沒有任何組：第 1 組、0×0', () => {
    const [op] = addSetOps({ db: db(), workoutExerciseId: 'we', newId: () => 'new' })
    expect(op.payload).toMatchObject({ set_no: 1, weight_kg: 0, reps: 0, done: false })
  })
})

describe('finishWorkoutOps', () => {
  const now = new Date(2026, 9, 14, 11, 0, 0)

  it('即時的訓練：ended_at＝現在，不動 started_at', () => {
    const w = { ...workout('w', '2026-10-14'), started_at: new Date(2026, 9, 14, 10, 0, 0).toISOString() }
    const [op] = finishWorkoutOps({ workout: w, now, minutes: null })
    expect(op).toEqual({ op: 'update', table: 'workouts', rowId: 'w', payload: { ended_at: now.toISOString() } })
  })

  it('補記的訓練：由手填分鐘算出 started_at／ended_at，略過就相等', () => {
    const w = { ...workout('w', '2026-10-10'), started_at: backfillTimes('2026-10-10', null).started_at }
    const [withMin] = finishWorkoutOps({ workout: w, now, minutes: 45 })
    const p = withMin.payload as { started_at: string; ended_at: string }
    expect(Date.parse(p.ended_at) - Date.parse(p.started_at)).toBe(45 * 60_000)
    const [skipped] = finishWorkoutOps({ workout: w, now, minutes: null })
    const q = skipped.payload as { started_at: string; ended_at: string }
    expect(q.ended_at).toBe(q.started_at)
  })

  it('補記的時長超出範圍：丟錯，不默默改', () => {
    const w = { ...workout('w', '2026-10-10'), started_at: backfillTimes('2026-10-10', null).started_at }
    expect(() => finishWorkoutOps({ workout: w, now, minutes: 5000 })).toThrow()
  })
})

describe('formatLastSets', () => {
  it('各組一樣：合成「重量 × 次數 × 組數」', () => {
    expect(formatLastSets([{ weight_kg: 60, reps: 12 }, { weight_kg: 60, reps: 12 }, { weight_kg: 60, reps: 12 }])).toBe('60 kg × 12 × 3')
    expect(formatLastSets([{ weight_kg: 22.5, reps: 10 }])).toBe('22.5 kg × 10 × 1')
  })

  it('各組不一樣：逐組列', () => {
    expect(formatLastSets([{ weight_kg: 60, reps: 10 }, { weight_kg: 62.5, reps: 8 }])).toBe('60 × 10 · 62.5 × 8')
  })

  it('沒有歷史：空字串（畫面不顯示「上次」）', () => {
    expect(formatLastSets([])).toBe('')
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

/* ═══════════ 動作庫管理（AC 2、3） ═══════════ */

const ex = (id: string, name: string, muscle_group: string, extra: Record<string, unknown> = {}): Row => ({
  id,
  name,
  muscle_group,
  tips: null,
  archived: false,
  ...extra,
})

describe('checkExercise', () => {
  const existing = [ex('a', '腿推舉', 'legs'), ex('b', '舊的肩推', 'shoulder', { archived: true })]
  const draft = { name: '深蹲', muscle_group: 'legs', tips: '' }

  it('合法：名稱去頭尾空白、要點空白存成 null', () => {
    const r = checkExercise({ name: '  深蹲 ', muscle_group: 'legs', tips: '   ' }, existing)
    expect(r).toEqual({ ok: true, value: { name: '深蹲', muscle_group: 'legs', tips: null } })
  })

  it('要點保留內容（只去頭尾空白），不改寫', () => {
    const r = checkExercise({ ...draft, tips: ' 背貼緊\n第三組降 2.5 ' }, existing)
    expect(r.ok && r.value.tips).toBe('背貼緊\n第三組降 2.5')
  })

  it('名稱空白要擋（DDL 的 btrim 檢查），並說明', () => {
    const r = checkExercise({ ...draft, name: '   ' }, existing)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/名稱/)
  })

  it('肌群不在七類之中要擋，不靜默改成「其他」', () => {
    expect(checkExercise({ ...draft, muscle_group: 'neck' }, existing).ok).toBe(false)
  })

  it('同名（忽略大小寫與頭尾空白）要擋；撞到已封存的要說明可以取消封存', () => {
    const dup = checkExercise({ ...draft, name: ' 腿推舉 ' }, existing)
    expect(dup.ok).toBe(false)
    const archived = checkExercise({ ...draft, name: '舊的肩推' }, existing)
    expect(!archived.ok && archived.error).toMatch(/封存/)
    expect(checkExercise({ ...draft, name: 'LEG PRESS' }, [ex('c', 'leg press', 'legs')]).ok).toBe(false)
  })

  it('全形／半形與連續空白視為同名（列表上看起來一樣）', () => {
    const base = [ex('c', '槓鈴 臥推', 'chest'), ex('d', 'Bench', 'chest')]
    expect(checkExercise({ ...draft, name: '槓鈴　臥推' }, base).ok).toBe(false)
    expect(checkExercise({ ...draft, name: '槓鈴  臥推' }, base).ok).toBe(false)
    expect(checkExercise({ ...draft, name: 'Ｂench' }, base).ok).toBe(false)
  })

  it('改自己：同名不算重複（只改肌群或要點時名稱不變）', () => {
    expect(checkExercise({ name: '腿推舉', muscle_group: 'back', tips: '' }, existing, 'a').ok).toBe(true)
  })
})

describe('動作庫的寫入描述', () => {
  it('新增：insert exercises、不封存、不帶 user_id（伺服器 default auth.uid()）', () => {
    const ops = createExerciseOps({ id: 'n1', value: { name: '深蹲', muscle_group: 'legs', tips: null } })
    expect(ops).toEqual([
      {
        op: 'insert',
        table: 'exercises',
        rowId: 'n1',
        payload: { name: '深蹲', muscle_group: 'legs', tips: null, archived: false },
      },
    ])
  })

  it('更新：只帶有變的欄位；全沒變回空陣列（不排一筆空的 PATCH）', () => {
    const cur = ex('a', '腿推舉', 'legs', { tips: '背貼緊' })
    const changed = updateExerciseOps({ current: cur, value: { name: '腿推舉', muscle_group: 'back', tips: '背貼緊' } })
    expect(changed).toEqual([{ op: 'update', table: 'exercises', rowId: 'a', payload: { muscle_group: 'back' } }])
    expect(updateExerciseOps({ current: cur, value: { name: '腿推舉', muscle_group: 'legs', tips: '背貼緊' } })).toEqual([])
  })

  it('更新：要點清掉 ＝ 寫 null；原本就是 null／空字串視為沒變', () => {
    const had = ex('a', '腿推舉', 'legs', { tips: '背貼緊' })
    expect(updateExerciseOps({ current: had, value: { name: '腿推舉', muscle_group: 'legs', tips: null } })[0].payload).toEqual({
      tips: null,
    })
    const blank = ex('b', '腿屈伸', 'legs', { tips: '' })
    expect(updateExerciseOps({ current: blank, value: { name: '腿屈伸', muscle_group: 'legs', tips: null } })).toEqual([])
  })

  it('封存／取消封存：只動 archived，不真刪', () => {
    expect(setExerciseArchivedOps({ id: 'a', archived: true })).toEqual([
      { op: 'update', table: 'exercises', rowId: 'a', payload: { archived: true } },
    ])
    expect(setExerciseArchivedOps({ id: 'a', archived: false })[0].op).toBe('update')
  })
})

describe('filterExercises', () => {
  const rows = [
    ex('1', '肩推', 'shoulder'),
    ex('2', '腿推舉', 'legs'),
    ex('3', '坐姿胸推', 'chest'),
    ex('4', '腿屈伸', 'legs'),
    ex('5', '二頭彎舉', 'arms'),
  ]

  it('依肌群順序（胸→背→下半身→肩→手臂→腹→其他）再依名稱排', () => {
    expect(filterExercises(rows, { q: '', group: 'all' }).map((r) => r.id)).toEqual(['3', '4', '2', '1', '5'])
  })

  it('搜尋比對名稱（忽略大小寫與頭尾空白）；肌群條件與搜尋同時成立', () => {
    expect(filterExercises(rows, { q: ' 推', group: 'all' }).map((r) => r.id).sort()).toEqual(['1', '2', '3'])
    expect(filterExercises(rows, { q: '推', group: 'legs' }).map((r) => r.id)).toEqual(['2'])
  })

  it('沒有符合的回空陣列；不改動傳進來的陣列', () => {
    const copy = [...rows]
    expect(filterExercises(rows, { q: 'zzz', group: 'all' })).toEqual([])
    expect(rows).toEqual(copy)
  })

  it('肌群欄位不認得的列（資料異常）歸在「其他」，不會因篩選而消失', () => {
    const odd = [ex('x', '怪動作', 'weird')]
    expect(filterExercises(odd, { q: '', group: 'all' })).toHaveLength(1)
    expect(filterExercises(odd, { q: '', group: 'other' })).toHaveLength(1)
    expect(filterExercises(odd, { q: '', group: 'chest' })).toHaveLength(0)
  })
})

/* ═══════════ 有氧（AC 10–12） ═══════════ */

const walkDraft = (p: Partial<CardioDraft> = {}): CardioDraft => ({
  kind: 'incline_walk', minutes: '30', speed_kmh: '5.5', incline_pct: '8', est_kcal: '', ...p,
})
const boxDraft = (p: Partial<CardioDraft> = {}): CardioDraft => ({
  kind: 'boxing', minutes: '36', speed_kmh: '', incline_pct: '', est_kcal: '121', ...p,
})
const cardio = (id: string, performed_on: string, p: Record<string, unknown> = {}): Row => ({
  id, performed_on, kind: 'incline_walk', minutes: 30, speed_kmh: null, incline_pct: null, est_kcal: null, ...p,
})

describe('checkCardio', () => {
  it('走路：分鐘＋速度＋坡度；預估熱量不屬於走路，就算表單有殘值也存 null', () => {
    expect(checkCardio(walkDraft({ est_kcal: '200' }))).toEqual({
      ok: true,
      value: { kind: 'incline_walk', minutes: 30, speed_kmh: 5.5, incline_pct: 8, est_kcal: null },
    })
  })

  it('拳擊：分鐘＋預估熱量；速度、坡度存 null', () => {
    expect(checkCardio(boxDraft({ speed_kmh: '6', incline_pct: '3' }))).toEqual({
      ok: true,
      value: { kind: 'boxing', minutes: 36, speed_kmh: null, incline_pct: null, est_kcal: 121 },
    })
  })

  it('選填欄位留空＝null；分鐘必填', () => {
    const r = checkCardio(walkDraft({ speed_kmh: '', incline_pct: '  ' }))
    expect(r.ok && r.value).toMatchObject({ speed_kmh: null, incline_pct: null })
    expect(checkCardio(walkDraft({ minutes: '' }))).toEqual({ ok: false, error: '分鐘要填' })
  })

  it('邊界：分鐘 >0 且 ≤1440；速度 >0 且 ≤40；坡度 0–40；預估熱量 0–10000（範圍外擋下並說明）', () => {
    expect(checkCardio(walkDraft({ minutes: '0' })).ok).toBe(false)
    expect(checkCardio(walkDraft({ minutes: '0.1' })).ok).toBe(true)
    expect(checkCardio(walkDraft({ minutes: '1440' })).ok).toBe(true)
    expect(checkCardio(walkDraft({ minutes: '1440.1' }))).toEqual({ ok: false, error: '分鐘要大於 0、最多 1440' })
    expect(checkCardio(walkDraft({ speed_kmh: '0' }))).toEqual({ ok: false, error: '速度要大於 0、最多 40 km/h' })
    expect(checkCardio(walkDraft({ speed_kmh: '40' })).ok).toBe(true)
    expect(checkCardio(walkDraft({ speed_kmh: '40.1' })).ok).toBe(false)
    expect(checkCardio(walkDraft({ incline_pct: '0' })).ok).toBe(true)
    expect(checkCardio(walkDraft({ incline_pct: '40' })).ok).toBe(true)
    expect(checkCardio(walkDraft({ incline_pct: '40.5' }))).toEqual({ ok: false, error: '坡度要在 0–40% 之間' })
    expect(checkCardio(boxDraft({ est_kcal: '0' })).ok).toBe(true)
    expect(checkCardio(boxDraft({ est_kcal: '10000' })).ok).toBe(true)
    expect(checkCardio(boxDraft({ est_kcal: '10000.5' })).ok).toBe(false)
  })

  it('看不懂的字、負數、超過一位小數都擋（numeric(_,1) 會默默四捨五入，不能放過去）', () => {
    expect(checkCardio(walkDraft({ minutes: 'abc' }))).toEqual({ ok: false, error: '分鐘要填數字' })
    expect(checkCardio(walkDraft({ minutes: '-5' }))).toEqual({ ok: false, error: '分鐘要填數字' })
    expect(checkCardio(walkDraft({ speed_kmh: '5.55' }))).toEqual({ ok: false, error: '速度最多一位小數' })
    expect(checkCardio(walkDraft({ speed_kmh: '5.5.5' }))).toEqual({ ok: false, error: '速度要填數字' })
  })

  it('「30.」「.5」是數字；小數位數不算尾端的 0（5.50＝5.5）', () => {
    const r = checkCardio(walkDraft({ minutes: '30.', speed_kmh: '.5', incline_pct: '8.50' }))
    expect(r.ok && r.value).toMatchObject({ minutes: 30, speed_kmh: 0.5, incline_pct: 8.5 })
    expect(checkCardio(walkDraft({ incline_pct: '8.05' })).ok, '真的有兩位就擋').toBe(false)
  })

  it('全形數字與全形小數點認得（中文鍵盤切出來的）', () => {
    const r = checkCardio(walkDraft({ minutes: '３０', speed_kmh: '５．５' }))
    expect(r.ok && r.value).toMatchObject({ minutes: 30, speed_kmh: 5.5 })
  })

  it('不認得的類型擋下', () => {
    expect(checkCardio(walkDraft({ kind: 'swim' }))).toEqual({ ok: false, error: '請選有氧類型' })
  })
})

describe('有氧的寫入組裝', () => {
  it('新增：記在選的那天，帶全部欄位（不屬於該類型的是 null）', () => {
    const check = checkCardio(boxDraft())
    if (!check.ok) throw new Error('fixture')
    expect(createCardioOps({ id: 'c1', date: '2026-10-13', value: check.value })).toEqual([
      {
        op: 'insert',
        table: 'cardio_sessions',
        rowId: 'c1',
        payload: { performed_on: '2026-10-13', kind: 'boxing', minutes: 36, speed_kmh: null, incline_pct: null, est_kcal: 121 },
      },
    ])
  })

  it('更新只帶有變的欄位；全沒變回空陣列', () => {
    const current = cardio('c1', '2026-10-13', { minutes: '30.0', speed_kmh: '5.5', incline_pct: 8 })
    const same = checkCardio(walkDraft())
    if (!same.ok) throw new Error('fixture')
    expect(updateCardioOps({ current, value: same.value }), '伺服器回字串型數字也算沒變').toEqual([])
    const changed = checkCardio(walkDraft({ minutes: '45' }))
    if (!changed.ok) throw new Error('fixture')
    expect(updateCardioOps({ current, value: changed.value })).toEqual([
      { op: 'update', table: 'cardio_sessions', rowId: 'c1', payload: { minutes: 45 } },
    ])
  })

  it('沒填 → 填 0 是變更（Number(null) 是 0，不能拿來比）', () => {
    const current = cardio('c1', '2026-10-13', { kind: 'boxing', minutes: 36, est_kcal: null })
    const v = checkCardio(boxDraft({ est_kcal: '0' }))
    if (!v.ok) throw new Error('fixture')
    expect(updateCardioOps({ current, value: v.value })[0].payload).toEqual({ est_kcal: 0 })
  })

  it('換類型：舊類型的欄位清成 null、新類型的欄位帶上', () => {
    const current = cardio('c1', '2026-10-13', { minutes: 30, speed_kmh: 5.5, incline_pct: 8 })
    const v = checkCardio(boxDraft({ minutes: '30', est_kcal: '100' }))
    if (!v.ok) throw new Error('fixture')
    expect(updateCardioOps({ current, value: v.value })[0].payload).toEqual({
      kind: 'boxing', speed_kmh: null, incline_pct: null, est_kcal: 100,
    })
  })

  it('刪除是一條 delete', () => {
    expect(deleteCardioOps('c1')).toEqual([{ op: 'delete', table: 'cardio_sessions', rowId: 'c1' }])
  })

  it('cardioDraft：既有那筆轉回表單字串；null 欄位是空字串；新增預設走路', () => {
    expect(cardioDraft(cardio('c1', 'x', { kind: 'boxing', minutes: '36.0', est_kcal: 121 }))).toEqual({
      kind: 'boxing', minutes: '36', speed_kmh: '', incline_pct: '', est_kcal: '121',
    })
    expect(cardioDraft(null)).toEqual({ kind: 'incline_walk', minutes: '', speed_kmh: '', incline_pct: '', est_kcal: '' })
  })

  it('cardioDraft：不認得的類型原樣保留，checkCardio 擋下（不悄悄改成走路、清掉欄位）', () => {
    const d = cardioDraft(cardio('c1', 'x', { kind: 'swim', est_kcal: 150 }))
    expect(d.kind).toBe('swim')
    expect(checkCardio(d)).toEqual({ ok: false, error: '請選有氧類型' })
  })
})

describe('有氧的顯示', () => {
  it('cardioSummary 只列有填的欄位；預估熱量不稱「消耗」', () => {
    expect(cardioSummary(cardio('c', 'x', { minutes: 30, speed_kmh: 5.5, incline_pct: 8 }))).toBe('30 分 · 5.5 km/h · 坡度 8%')
    expect(cardioSummary(cardio('c', 'x', { kind: 'boxing', minutes: 36, est_kcal: 1210 }))).toBe('36 分 · 預估 1,210 kcal')
    expect(cardioSummary(cardio('c', 'x', { minutes: '30.0' }))).toBe('30 分')
    expect(cardioSummary(cardio('c', 'x', { incline_pct: 0 })), '坡度 0 是有填').toBe('30 分 · 坡度 0%')
  })

  it('cardioLabel：認得的顯示中文，不認得的原樣顯示', () => {
    expect(cardioLabel(cardio('c', 'x', { kind: 'boxing' }))).toBe('有氧拳擊')
    expect(cardioLabel(cardio('c', 'x', { kind: 'swim' }))).toBe('swim')
  })

  it('cardioOn：只取那天；依 created_at 排，還在佇列裡（沒有 created_at）的排最後、彼此維持順序', () => {
    const rows = [
      cardio('q1', '2026-10-13'),
      cardio('late', '2026-10-13', { created_at: '2026-10-13T12:00:00Z' }),
      cardio('other', '2026-10-12', { created_at: '2026-10-12T08:00:00Z' }),
      cardio('q2', '2026-10-13'),
      cardio('early', '2026-10-13', { created_at: '2026-10-13T08:00:00Z' }),
    ]
    expect(cardioOn(db({ cardio_sessions: rows }), '2026-10-13').map((r) => r.id)).toEqual(['early', 'late', 'q1', 'q2'])
  })
})

describe('applyQueue 與預填（review #4）', () => {
  const seed = (seq: number, id: string): QueueEntry => ({
    ...entry(seq, 'insert', 'exercises', id, { name: '預設名', archived: false, tips: null }),
    ignoreDuplicates: true,
  })

  it('ignoreDuplicates 的 insert：列已在就不動它（伺服器是 on conflict do nothing）', () => {
    const base = db({ exercises: [{ id: 'e1', name: '我改的名', archived: true, tips: '我的要點' }] })
    const out = applyQueue(base, [seed(1, 'e1')], 'u1')
    expect(out.exercises).toEqual([{ id: 'e1', name: '我改的名', archived: true, tips: '我的要點' }])
  })

  it('列不在才放進去；一般 insert 照舊會覆蓋', () => {
    expect(applyQueue(db(), [seed(1, 'e1')], 'u1').exercises[0]?.name).toBe('預設名')
    const base = db({ exercises: [{ id: 'e1', name: '舊' }] })
    expect(applyQueue(base, [entry(1, 'insert', 'exercises', 'e1', { name: '新' })], 'u1').exercises[0]?.name).toBe('新')
  })
})
