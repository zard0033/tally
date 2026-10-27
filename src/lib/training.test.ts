import { describe, expect, it } from 'vitest'
import type { QueueEntry } from './queue'
import { localDate } from './dates'
import {
  MUSCLE_GROUPS,
  RPE_CHIPS,
  RPE_SHEET_VALUES,
  completesExercise,
  exerciseRpe,
  setExerciseRpeOps,
  setRpeOps,
  PRESET_EXERCISES,
  cardioEntryDraft,
  cardioLastMinutes,
  cardioPrefill,
  cardioRecorded,
  cardioSummary,
  checkCardio,
  describeEntry,
  exerciseKind,
  isCardioExercise,
  updateCardioEntryOps,
  type CardioDraft,
  type RowOp,
  addExerciseOps,
  addRoutineExerciseOps,
  addSetOps,
  allSetsDone,
  applyQueue,
  exerciseProgress,
  remainingSetsAfter,
  removeSetOps,
  replaceExerciseOps,
  reorderWorkoutExercisesOps,
  syncSetsForwardOps,
  toggleAllDoneOps,
  checkRoutineName,
  checkRoutineTarget,
  copyRoutineOps,
  formatRoutineTarget,
  createRoutineOps,
  removeRoutineExerciseOps,
  renameRoutineOps,
  reorderRoutineExercisesOps,
  routineDetail,
  routineFromWorkoutOps,
  routineList,
  setRoutineArchivedOps,
  startWorkoutFromRoutineOps,
  updateRoutineExerciseTargetOps,
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
    const ids = (u: string) => PRESET_EXERCISES.map((p) => presetExerciseId(u, p.key))
    const a = ids('user-a')
    expect(ids('user-a')).toEqual(a)
    expect(new Set(a).size).toBe(16)
    for (const id of a) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(ids('user-b').filter((id) => a.includes(id))).toEqual([])
    expect(presetExerciseId('user-a', 'leg-press')).toBe(a[0])
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
  })
})

/* ═══════════ 條目白話標籤 ═══════════ */

describe('describeEntry', () => {
  it.each([
    ['insert', 'exercises', '新增動作'],
    ['update', 'exercises', '改動作'],
    ['delete', 'exercises', '刪動作'],
    ['insert', 'routines', '新增課表'],
    ['update', 'routines', '改課表'],
    ['delete', 'routines', '刪課表'],
    ['insert', 'workouts', '新增訓練'],
    ['update', 'workouts', '改訓練'],
    ['delete', 'workouts', '刪訓練'],
    ['insert', 'routine_exercises', '課表加動作'],
    ['update', 'routine_exercises', '改課表的動作'],
    ['delete', 'routine_exercises', '課表移除動作'],
    ['insert', 'workout_exercises', '訓練加動作'],
    ['update', 'workout_exercises', '改訓練的動作'],
    ['delete', 'workout_exercises', '訓練移除動作'],
    ['insert', 'workout_sets', '記一組'],
    ['update', 'workout_sets', '改一組'],
    ['delete', 'workout_sets', '刪一組'],
  ] as const)('%s %s → %s', (op, table, label) => {
    expect(describeEntry(entry(1, op, table, 'a-uuid'))).toBe(label)
  })

  it('不認得的表回保底「變更」；標籤不出現 rowId', () => {
    expect(describeEntry(entry(1, 'insert', 'mystery', 'row-123'))).toBe('變更')
    // 有氧併入動作後不再讀寫舊表：舊版 App 留在佇列裡的條目落到保底（sender 也會以「不認得的表」拒絕）
    expect(describeEntry(entry(1, 'insert', 'cardio_sessions', 'row-123'))).toBe('變更')
    for (const t of ['exercises', 'workout_sets']) {
      expect(describeEntry(entry(1, 'update', t, 'row-123'))).not.toContain('row-123')
    }
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
  it('訓練的日子都算，同一天只算一次', () => {
    const d = db({
      workouts: [workout('w1', '2026-10-10'), workout('w2', '2026-10-10'), workout('w3', '2026-10-12')],
    })
    expect([...trainingDates(d)].sort()).toEqual(['2026-10-10', '2026-10-12'])
  })

  it('沒有任何訓練＝空集合', () => {
    expect(trainingDates(db()).size).toBe(0)
  })

  it('只有一張有氧卡、沒有任何組的訓練也算（有氧併入動作後，有氧日就是 workouts 的日子）', () => {
    const d = db({
      workouts: [workout('wc', '2026-10-15')],
      workout_exercises: [{ ...we('c1', 'wc', 'walk'), minutes: 30 }],
    })
    expect([...trainingDates(d)]).toEqual(['2026-10-15'])
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

describe('replaceExerciseOps', () => {
  // 這次訓練 w：三個動作，要換的是中間那個（position 1），它已經打了勾；e2 在更早的訓練做過 40 kg × 12
  const d = db({
    exercises: [exercise('e1'), exercise('e2'), exercise('e3'), { id: 'walk', name: '健走', muscle_group: 'other', kind: 'incline_walk', tips: null, archived: false }],
    workouts: [workout('old', '2026-10-01'), workout('w', '2026-10-14')],
    workout_exercises: [we('a', 'w', 'e3', 0), we('b', 'w', 'e1', 1), we('c', 'w', 'e3', 2), we('oldE2', 'old', 'e2')],
    workout_sets: [set('now1', 'b', 1, 99, 1), set('h1', 'oldE2', 1, 40, 12), set('h2', 'oldE2', 2, 40, 10)],
  })
  const entryB = d.workout_exercises.find((r) => r.id === 'b')!
  const replace = (exerciseId: string) => replaceExerciseOps({ db: d, workoutId: 'w', entry: entryB, exerciseId, newId: idGen() })

  it('第一筆刪舊的那列，第二筆插新的；舊動作的組不另外下刪除（交給 cascade）', () => {
    const ops = replace('e2')
    expect(ops[0]).toEqual({ op: 'delete', table: 'workout_exercises', rowId: 'b' })
    expect(ops[1]).toMatchObject({ op: 'insert', table: 'workout_exercises', payload: { workout_id: 'w', exercise_id: 'e2' } })
    expect(ops.filter((o) => o.op === 'delete')).toHaveLength(1)
  })

  it('新的插在舊的 position，不是接在最後', () => {
    expect(replace('e2')[1].payload?.position).toBe(1)
  })

  it('新動作的組取它自己的歷史，不沿用舊動作這次打的 99 kg', () => {
    const sets = replace('e2').filter((o) => o.table === 'workout_sets')
    expect(sets.map((o) => [o.payload?.weight_kg, o.payload?.reps, o.payload?.done])).toEqual([[40, 12, false], [40, 10, false]])
  })

  it('換成有氧動作：只有那一列，沒有組', () => {
    const ops = replace('walk')
    expect(ops.map((o) => o.table)).toEqual(['workout_exercises', 'workout_exercises'])
    expect(ops[1].payload?.position).toBe(1)
  })

  it('每一列的 id 都不同，且不碰舊列以外的 id', () => {
    const ops = replace('e2')
    expect(new Set(ops.map((o) => o.rowId)).size).toBe(ops.length)
    expect(ops.slice(1).every((o) => o.rowId !== 'b')).toBe(true)
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

describe('訓練中改版的寫入組裝', () => {
  // 動作 A（3 組：1 已勾、2 未勾、3 未勾）、動作 B（2 組全勾）、動作 C（1 組未勾）
  const d = db({
    workouts: [workout('w1', '2026-10-17')],
    exercises: [exercise('eA'), exercise('eB'), exercise('eC')],
    workout_exercises: [we('A', 'w1', 'eA', 0), we('B', 'w1', 'eB', 1), we('C', 'w1', 'eC', 2)],
    workout_sets: [
      set('a1', 'A', 1, 60, 12, true),
      set('a2', 'A', 2, 50, 10, false),
      set('a3', 'A', 3, 60, 12, false),
      set('b1', 'B', 1, 20, 8, true),
      set('b2', 'B', 2, 20, 8, true),
      set('c1', 'C', 1, 5, 5, false),
    ],
  })
  const detail = workoutDetail(d, 'w1')!

  describe('remainingSetsAfter／syncSetsForwardOps', () => {
    it('只算排在後面、還沒打勾的組；已勾的、前面的、別的動作的都不算', () => {
      expect(remainingSetsAfter(detail, 'a1').map((s) => s.id)).toEqual(['a2', 'a3'])
      expect(remainingSetsAfter(detail, 'a2').map((s) => s.id)).toEqual(['a3'])
      expect(remainingSetsAfter(detail, 'a3')).toEqual([])
    })

    it('套用這一組的重量與次數，值本來就一樣的那組不寫', () => {
      const ops = syncSetsForwardOps(detail, 'a1')
      // a3 本來就是 60×12，只剩 a2 要改
      expect(ops).toEqual([
        { op: 'update', table: 'workout_sets', rowId: 'a2', payload: { weight_kg: 60, reps: 12 } },
      ])
    })

    it('只有一個欄位不同就只寫那個欄位', () => {
      const d2 = db({
        ...d,
        workout_sets: [set('x1', 'A', 1, 60, 12, false), set('x2', 'A', 2, 60, 8, false)],
      })
      const ops = syncSetsForwardOps(workoutDetail(d2, 'w1')!, 'x1')
      expect(ops.map((o) => o.payload)).toEqual([{ reps: 12 }])
    })

    it('已打勾的後面組不動', () => {
      const d2 = db({
        ...d,
        workout_sets: [set('x1', 'A', 1, 60, 12, false), set('x2', 'A', 2, 40, 6, true), set('x3', 'A', 3, 40, 6, false)],
      })
      expect(syncSetsForwardOps(workoutDetail(d2, 'w1')!, 'x1').map((o) => o.rowId)).toEqual(['x3'])
    })

    it('找不到這一組、或沒有剩餘組：回空陣列', () => {
      expect(syncSetsForwardOps(detail, 'nope')).toEqual([])
      expect(syncSetsForwardOps(detail, 'a3')).toEqual([])
    })
  })

  describe('allSetsDone／toggleAllDoneOps', () => {
    it('有沒打勾的：只把沒打勾的組打勾', () => {
      expect(toggleAllDoneOps(detail, 'A')).toEqual([
        { op: 'update', table: 'workout_sets', rowId: 'a2', payload: { done: true } },
        { op: 'update', table: 'workout_sets', rowId: 'a3', payload: { done: true } },
      ])
    })

    it('已經全勾：全部取消', () => {
      expect(toggleAllDoneOps(detail, 'B').map((o) => [o.rowId, o.payload])).toEqual([
        ['b1', { done: false }],
        ['b2', { done: false }],
      ])
    })

    it('沒有組的動作、找不到的動作：不寫、也不算全部完成', () => {
      const empty = workoutDetail(db({ ...d, workout_sets: [] }), 'w1')!
      expect(toggleAllDoneOps(empty, 'A')).toEqual([])
      expect(toggleAllDoneOps(detail, 'nope')).toEqual([])
      expect(allSetsDone([])).toBe(false)
    })

    it('allSetsDone：每一組都勾了才是 true', () => {
      expect(allSetsDone(detail.exercises[0].sets)).toBe(false)
      expect(allSetsDone(detail.exercises[1].sets)).toBe(true)
    })
  })

  describe('removeSetOps', () => {
    it('單筆 delete，不重排其他組', () => {
      expect(removeSetOps(detail, 'a2')).toEqual([{ op: 'delete', table: 'workout_sets', rowId: 'a2' }])
    })

    it('只剩一組、找不到：回空陣列（要拿掉整個動作走「移除這個動作」）', () => {
      expect(removeSetOps(detail, 'c1')).toEqual([])
      expect(removeSetOps(detail, 'nope')).toEqual([])
    })
  })

  describe('exerciseProgress', () => {
    it('做完幾組、共幾組、下一組是第一個沒打勾的', () => {
      expect(exerciseProgress(detail.exercises[0].sets)).toEqual({ done: 1, total: 3, next: { weight: 50, reps: 10 } })
    })

    it('全部做完：next 是 null', () => {
      expect(exerciseProgress(detail.exercises[1].sets)).toEqual({ done: 2, total: 2, next: null })
    })

    it('沒有組：0／0、沒有下一組', () => {
      expect(exerciseProgress([])).toEqual({ done: 0, total: 0, next: null })
    })
  })
})

describe('reorderWorkoutExercisesOps', () => {
  const entries = [we('a', 'w', 'e1', 0), we('b', 'w', 'e2', 1), we('c', 'w', 'e3', 2)]

  it('只更新位置有變的列', () => {
    const ops = reorderWorkoutExercisesOps({ entries, orderedIds: ['c', 'a', 'b'] })
    expect(ops).toEqual([
      { op: 'update', table: 'workout_exercises', rowId: 'c', payload: { position: 0 } },
      { op: 'update', table: 'workout_exercises', rowId: 'a', payload: { position: 1 } },
      { op: 'update', table: 'workout_exercises', rowId: 'b', payload: { position: 2 } },
    ])
    expect(reorderWorkoutExercisesOps({ entries, orderedIds: ['a', 'c', 'b'] }).map((o) => o.rowId)).toEqual(['c', 'b'])
  })

  it('順序沒變回空陣列；刪過動作留下的空洞會被整理成 0..n-1', () => {
    expect(reorderWorkoutExercisesOps({ entries, orderedIds: ['a', 'b', 'c'] })).toEqual([])
    const gappy = [we('a', 'w', 'e1', 0), we('c', 'w', 'e3', 5)]
    expect(reorderWorkoutExercisesOps({ entries: gappy, orderedIds: ['a', 'c'] }).map((o) => [o.rowId, o.payload])).toEqual([
      ['c', { position: 1 }],
    ])
  })

  it('項目對不上（缺、多、重複）丟錯', () => {
    expect(() => reorderWorkoutExercisesOps({ entries, orderedIds: ['a', 'b'] })).toThrow()
    expect(() => reorderWorkoutExercisesOps({ entries, orderedIds: ['a', 'b', 'c', 'd'] })).toThrow()
    expect(() => reorderWorkoutExercisesOps({ entries, orderedIds: ['a', 'a', 'b'] })).toThrow()
    expect(() => reorderWorkoutExercisesOps({ entries, orderedIds: ['a', 'b', 'z'] })).toThrow()
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

describe('有氧的顯示', () => {
  it('cardioSummary 只列有填的欄位；預估熱量不稱「消耗」', () => {
    expect(cardioSummary(cardio('c', 'x', { minutes: 30, speed_kmh: 5.5, incline_pct: 8 }))).toBe('30 分 · 5.5 km/h · 坡度 8%')
    expect(cardioSummary(cardio('c', 'x', { kind: 'boxing', minutes: 36, est_kcal: 1210 }))).toBe('36 分 · 預估 1,210 kcal')
    expect(cardioSummary(cardio('c', 'x', { minutes: '30.0' }))).toBe('30 分')
    expect(cardioSummary(cardio('c', 'x', { incline_pct: 0 })), '坡度 0 是有填').toBe('30 分 · 坡度 0%')
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

/* ═══════════ 課表 ═══════════ */

const routine = (id: string, name: string, extra: Record<string, unknown> = {}): Row => ({ id, name, archived: false, ...extra })
const re = (id: string, routine_id: string, exercise_id: string, position: number, target_sets = 3, target_reps: number | null = null): Row => ({
  id, routine_id, exercise_id, position, target_sets, target_reps,
})

describe('routineList', () => {
  it('使用中與已封存分開，各依建立時間；還在佇列裡（沒有 created_at）的排最後', () => {
    const d = db({
      routines: [
        routine('queued', '新的'),
        routine('b', 'B', { created_at: '2026-10-02T00:00:00Z' }),
        routine('old', '舊的', { created_at: '2026-10-01T00:00:00Z', archived: true }),
        routine('a', 'A', { created_at: '2026-10-01T00:00:00Z' }),
      ],
    })
    const { active, archived } = routineList(d)
    expect(active.map((c) => c.routine.id)).toEqual(['a', 'b', 'queued'])
    expect(archived.map((c) => c.routine.id)).toEqual(['old'])
  })

  it('動作數只算自己這份課表的', () => {
    const d = db({
      routines: [routine('a', 'A'), routine('b', 'B')],
      routine_exercises: [re('1', 'a', 'e1', 0), re('2', 'a', 'e2', 1), re('3', 'b', 'e1', 0)],
    })
    expect(routineList(d).active.map((c) => c.exerciseCount)).toEqual([2, 1])
  })

  it('上次是最近一次照這份課表做的那天；沒做過、空白開始的不算', () => {
    const d = db({
      routines: [routine('a', 'A'), routine('b', 'B')],
      workouts: [
        { ...workout('w1', '2026-10-01'), routine_id: 'a' },
        { ...workout('w3', '2026-10-11'), routine_id: 'a' },
        { ...workout('w2', '2026-10-05'), routine_id: 'a' },
        workout('blank', '2026-10-13'),
      ],
    })
    expect(routineList(d).active.map((c) => c.lastUsed)).toEqual(['2026-10-11', null])
  })
})

describe('routineDetail', () => {
  const d = db({
    exercises: [{ id: 'e1', name: '腿推舉' }, { id: 'e2', name: '肩推' }],
    routines: [routine('a', 'A')],
    routine_exercises: [re('x2', 'a', 'e2', 1), re('x1', 'a', 'e1', 0), re('other', 'zzz', 'e1', 0)],
  })

  it('動作依 position 排、帶出動作庫那一列，不混入別份課表的', () => {
    const detail = routineDetail(d, 'a')
    expect(detail?.exercises.map((e) => [e.entry.id, e.exercise?.name])).toEqual([['x1', '腿推舉'], ['x2', '肩推']])
  })

  it('動作庫還沒載到：exercise 是 null，不丟錯', () => {
    const lonely = db({ routines: [routine('a', 'A')], routine_exercises: [re('x', 'a', 'gone', 0)] })
    expect(routineDetail(lonely, 'a')?.exercises[0].exercise).toBeNull()
  })

  it('找不到課表回 null', () => {
    expect(routineDetail(d, 'nope')).toBeNull()
  })
})

describe('checkRoutineName／checkRoutineTarget', () => {
  it('名稱空白不行，前後空白去掉', () => {
    expect(checkRoutineName('   ')).toEqual({ ok: false, error: '名稱不能是空的' })
    expect(checkRoutineName(' 菜單 A ')).toEqual({ ok: true, name: '菜單 A' })
  })

  it('組數 1–20 整數必填；次數 1–999 整數或留空', () => {
    expect(checkRoutineTarget({ sets: '3', reps: '12' })).toEqual({ ok: true, value: { target_sets: 3, target_reps: 12 } })
    expect(checkRoutineTarget({ sets: '3', reps: '' })).toEqual({ ok: true, value: { target_sets: 3, target_reps: null } })
    expect(checkRoutineTarget({ sets: '20', reps: '999' }).ok).toBe(true)
    for (const sets of ['', '0', '21', '2.5', '-1', 'abc']) {
      expect(checkRoutineTarget({ sets, reps: '' }).ok, `組數 ${sets}`).toBe(false)
    }
    for (const reps of ['0', '1000', '8.5', 'x']) {
      expect(checkRoutineTarget({ sets: '3', reps }).ok, `次數 ${reps}`).toBe(false)
    }
  })

  it('全形數字也認得（中文鍵盤）', () => {
    expect(checkRoutineTarget({ sets: '３', reps: '１２' })).toEqual({ ok: true, value: { target_sets: 3, target_reps: 12 } })
  })
})

describe('課表的寫入組裝', () => {
  it('建立：名稱、未封存；不帶 user_id', () => {
    expect(createRoutineOps({ id: 'r', name: 'A' })).toEqual([
      { op: 'insert', table: 'routines', rowId: 'r', payload: { name: 'A', archived: false } },
    ])
  })

  it('改名：沒變回空陣列', () => {
    expect(renameRoutineOps({ current: routine('r', 'A'), name: 'A' })).toEqual([])
    expect(renameRoutineOps({ current: routine('r', 'A'), name: 'B' })).toEqual([
      { op: 'update', table: 'routines', rowId: 'r', payload: { name: 'B' } },
    ])
  })

  it('封存只改 archived，不提供真刪', () => {
    expect(setRoutineArchivedOps({ id: 'r', archived: true })).toEqual([
      { op: 'update', table: 'routines', rowId: 'r', payload: { archived: true } },
    ])
  })

  it('加動作：接在這份課表最大 position 後面，預設 3 組、次數不設', () => {
    const d = db({ routine_exercises: [re('1', 'a', 'e1', 0), re('2', 'a', 'e2', 4), re('3', 'b', 'e1', 9)] })
    const [op] = addRoutineExerciseOps({ db: d, routineId: 'a', exerciseId: 'e3', newId: () => 'new' })
    expect(op).toEqual({
      op: 'insert', table: 'routine_exercises', rowId: 'new',
      payload: { routine_id: 'a', exercise_id: 'e3', position: 5, target_sets: 3, target_reps: null },
    })
  })

  it('加動作：空課表從 0 開始，可帶預設組次', () => {
    const [op] = addRoutineExerciseOps({
      db: db(), routineId: 'a', exerciseId: 'e1', newId: () => 'n', target: { target_sets: 4, target_reps: 10 },
    })
    expect(op.payload).toMatchObject({ position: 0, target_sets: 4, target_reps: 10 })
  })

  it('改預設組次：只帶有變的欄位，null 與缺欄視為同一件事', () => {
    const cur = re('x', 'a', 'e1', 0, 3, null)
    expect(updateRoutineExerciseTargetOps({ current: cur, value: { target_sets: 3, target_reps: null } })).toEqual([])
    expect(updateRoutineExerciseTargetOps({ current: { id: 'x', target_sets: 3 }, value: { target_sets: 3, target_reps: null } })).toEqual([])
    expect(updateRoutineExerciseTargetOps({ current: cur, value: { target_sets: 4, target_reps: null } })[0].payload).toEqual({ target_sets: 4 })
    expect(updateRoutineExerciseTargetOps({ current: cur, value: { target_sets: 3, target_reps: 12 } })[0].payload).toEqual({ target_reps: 12 })
    expect(updateRoutineExerciseTargetOps({ current: re('x', 'a', 'e1', 0, 3, 12), value: { target_sets: 3, target_reps: null } })[0].payload).toEqual({ target_reps: null })
  })

  it('移除動作：一條 delete', () => {
    expect(removeRoutineExerciseOps('x')).toEqual([{ op: 'delete', table: 'routine_exercises', rowId: 'x' }])
  })
})

describe('reorderRoutineExercisesOps', () => {
  const entries = [re('a', 'r', 'e1', 0), re('b', 'r', 'e2', 1), re('c', 'r', 'e3', 2)]

  it('只更新位置有變的列', () => {
    const ops = reorderRoutineExercisesOps({ entries, orderedIds: ['a', 'c', 'b'] })
    expect(ops.map((o) => [o.rowId, o.payload])).toEqual([['c', { position: 1 }], ['b', { position: 2 }]])
  })

  it('順序沒變回空陣列', () => {
    expect(reorderRoutineExercisesOps({ entries, orderedIds: ['a', 'b', 'c'] })).toEqual([])
  })

  it('刪過動作留下的空洞會被整理成 0..n-1', () => {
    const gappy = [re('a', 'r', 'e1', 0), re('c', 'r', 'e3', 5)]
    const ops = reorderRoutineExercisesOps({ entries: gappy, orderedIds: ['a', 'c'] })
    expect(ops.map((o) => [o.rowId, o.payload])).toEqual([['c', { position: 1 }]])
  })

  it('項目對不上（缺、多、重複）丟錯，不默默排出缺漏的課表', () => {
    expect(() => reorderRoutineExercisesOps({ entries, orderedIds: ['a', 'b'] })).toThrow()
    expect(() => reorderRoutineExercisesOps({ entries, orderedIds: ['a', 'b', 'c', 'd'] })).toThrow()
    expect(() => reorderRoutineExercisesOps({ entries, orderedIds: ['a', 'a', 'b'] })).toThrow()
    expect(() => reorderRoutineExercisesOps({ entries, orderedIds: ['a', 'b', 'z'] })).toThrow()
  })
})

describe('copyRoutineOps', () => {
  const d = db({
    routines: [routine('r', '菜單 A')],
    routine_exercises: [re('x2', 'r', 'e2', 7, 4, 10), re('x1', 'r', 'e1', 3, 3, null), re('other', 'zz', 'e9', 0)],
  })

  it('複製結構：名稱「原名稱 複本」、動作與預設組次照搬、順序整理成 0..n-1，id 全新', () => {
    const ops = copyRoutineOps({ db: d, routineId: 'r', newId: idGen() })
    const [head, ...rest] = ops
    expect(head).toMatchObject({ op: 'insert', table: 'routines', payload: { name: '菜單 A 複本', archived: false } })
    expect(rest.map((o) => o.payload)).toEqual([
      { routine_id: head.rowId, exercise_id: 'e1', position: 0, target_sets: 3, target_reps: null },
      { routine_id: head.rowId, exercise_id: 'e2', position: 1, target_sets: 4, target_reps: 10 },
    ])
    expect(new Set(ops.map((o) => o.rowId)).size).toBe(ops.length)
    expect(head.rowId).not.toBe('r')
  })

  it('可指定名稱；找不到來源回空陣列', () => {
    expect(copyRoutineOps({ db: d, routineId: 'r', newId: idGen(), name: 'B' })[0].payload?.name).toBe('B')
    expect(copyRoutineOps({ db: d, routineId: 'nope', newId: idGen() })).toEqual([])
  })

  it('課表本身沒有重量：複製出來的列沒有 weight 欄', () => {
    const rest = copyRoutineOps({ db: d, routineId: 'r', newId: idGen() }).slice(1)
    expect(rest.every((o) => !('weight_kg' in (o.payload ?? {})))).toBe(true)
  })
})

describe('routineFromWorkoutOps（存成課表）', () => {
  const d = db({
    workouts: [workout('w', '2026-10-14')],
    workout_exercises: [we('weB', 'w', 'e2', 1), we('weA', 'w', 'e1', 0), we('weC', 'w', 'e3', 2), we('weD', 'w', 'e4', 3)],
    workout_sets: [
      set('a1', 'weA', 1, 60, 12), set('a2', 'weA', 2, 65, 10), set('a3', 'weA', 3, 65, 8, false),
      set('b1', 'weB', 1, 20, 15),
      set('c1', 'weC', 1, 10, 0),
    ],
  })

  it('依訓練中的順序帶入動作；組數＝當時有幾組（含沒打勾）、次數＝第一組；不帶重量', () => {
    const ops = routineFromWorkoutOps({ db: d, workoutId: 'w', name: '菜單 C', newId: idGen() })
    const [head, ...rest] = ops
    expect(head).toMatchObject({ table: 'routines', payload: { name: '菜單 C', archived: false } })
    expect(rest.map((o) => o.payload)).toEqual([
      { routine_id: head.rowId, exercise_id: 'e1', position: 0, target_sets: 3, target_reps: 12 },
      { routine_id: head.rowId, exercise_id: 'e2', position: 1, target_sets: 1, target_reps: 15 },
      { routine_id: head.rowId, exercise_id: 'e3', position: 2, target_sets: 1, target_reps: null }, // 0 次＝沒設
      { routine_id: head.rowId, exercise_id: 'e4', position: 3, target_sets: 3, target_reps: null }, // 沒有任何組＝預設 3 組
    ])
    expect(rest.every((o) => !('weight_kg' in (o.payload ?? {})))).toBe(true)
  })

  it('組數超過 DDL 上限 20 時收斂到 20，不讓伺服器拒掉整批', () => {
    const many = db({
      workouts: [workout('w', '2026-10-14')],
      workout_exercises: [we('we', 'w', 'e1', 0)],
      workout_sets: Array.from({ length: 25 }, (_, i) => set(`s${i}`, 'we', i + 1, 10, 5)),
    })
    const [, row] = routineFromWorkoutOps({ db: many, workoutId: 'w', name: 'x', newId: idGen() })
    expect(row.payload?.target_sets).toBe(20)
  })

  it('找不到訓練回空陣列', () => {
    expect(routineFromWorkoutOps({ db: d, workoutId: 'nope', name: 'x', newId: idGen() })).toEqual([])
  })
})

describe('startWorkoutFromRoutineOps', () => {
  const now = new Date(2026, 9, 14, 10, 30, 0)
  const base = db({
    routines: [routine('r', '菜單 A')],
    routine_exercises: [re('x2', 'r', 'e2', 1, 2, 8), re('x1', 'r', 'e1', 0, 3, 12)],
    workouts: [workout('old', '2026-10-01')],
    workout_exercises: [we('weOld', 'old', 'e1', 0)],
    workout_sets: [set('o1', 'weOld', 1, 60, 10), set('o2', 'weOld', 2, 62.5, 8)],
  })
  const ops = () => startWorkoutFromRoutineOps({ db: base, routineId: 'r', workoutId: 'w', date: '2026-10-14', now, newId: idGen() })

  it('訓練記下 routine_id（AC 4b）', () => {
    expect(ops()[0]).toMatchObject({ table: 'workouts', rowId: 'w', payload: { routine_id: 'r', ended_at: null } })
  })

  it('動作依課表順序帶入，position 各自不同（0、1）', () => {
    const entries = ops().filter((o) => o.table === 'workout_exercises')
    expect(entries.map((o) => [o.payload?.exercise_id, o.payload?.position])).toEqual([['e1', 0], ['e2', 1]])
  })

  it('有歷史的動作取上次實際完成的值；沒歷史的用課表預設組次、重量 0', () => {
    const all = ops()
    const [e1, e2] = all.filter((o) => o.table === 'workout_exercises')
    const setsOf = (id: string) => all.filter((o) => o.table === 'workout_sets' && o.payload?.workout_exercise_id === id)
    expect(setsOf(e1.rowId).map((o) => [o.payload?.weight_kg, o.payload?.reps])).toEqual([[60, 10], [62.5, 8]])
    expect(setsOf(e2.rowId).map((o) => [o.payload?.weight_kg, o.payload?.reps])).toEqual([[0, 8], [0, 8]])
  })

  it('所有組都沒打勾', () => {
    expect(ops().filter((o) => o.table === 'workout_sets').every((o) => o.payload?.done === false)).toBe(true)
  })

  it('找不到課表回空陣列，不悄悄變成空白開始', () => {
    expect(startWorkoutFromRoutineOps({ db: base, routineId: 'nope', workoutId: 'w', date: '2026-10-14', now, newId: idGen() })).toEqual([])
  })

  it('選到過去的日子＝補記，照樣記 routine_id', () => {
    const [head] = startWorkoutFromRoutineOps({ db: base, routineId: 'r', workoutId: 'w', date: '2026-10-10', now, newId: idGen() })
    expect(head.payload).toMatchObject({ performed_on: '2026-10-10', routine_id: 'r' })
  })
})

describe('startWorkoutOps 的 routineId', () => {
  it('不給＝null（空白開始）', () => {
    expect(startWorkoutOps({ workoutId: 'w', date: '2026-10-14', now: new Date(2026, 9, 14, 10) })[0].payload?.routine_id).toBeNull()
  })
})

describe('課表的寫入經 parentRefs 補父列依賴', () => {
  it('routine_exercises 依賴 routine（cascade）與 exercise（restrict）；workouts 依賴 routine（setNull）', () => {
    expect(parentRefs('routine_exercises', { routine_id: 'r', exercise_id: 'e' }).map((p) => [p.table, p.onDelete])).toEqual([
      ['routines', 'cascade'],
      ['exercises', 'restrict'],
    ])
    expect(parentRefs('workouts', { routine_id: 'r' }).map((p) => [p.table, p.onDelete])).toEqual([['routines', 'setNull']])
  })
})

describe('formatRoutineTarget', () => {
  it('有次數寫「組 × 次」，沒設次數只寫組', () => {
    expect(formatRoutineTarget(re('x', 'r', 'e', 0, 3, 12))).toBe('沒做過時預設 3 組 × 12')
    expect(formatRoutineTarget(re('x', 'r', 'e', 0, 4, null))).toBe('沒做過時預設 4 組')
    expect(formatRoutineTarget({ id: 'x', target_sets: 2 })).toBe('沒做過時預設 2 組')
  })
})

describe('RPE（spec.md「階段 4 乙」）', () => {
  it('休息條四檔：3 下以上＝7、2 下＝8、1 下＝9、力竭＝10', () => {
    expect(RPE_CHIPS.map((c) => [c.label, c.rpe])).toEqual([['3 下以上', 7], ['2 下', 8], ['1 下', 9], ['力竭', 10]])
  })
  it('組編輯 sheet 五格 6–10，都落在 DDL 的 5–10 之內', () => {
    expect([...RPE_SHEET_VALUES]).toEqual([6, 7, 8, 9, 10])
  })
  it('completesExercise：其餘組都已完成才算這個動作做完；自己不用先打勾；沒有未完成的別組才成立', () => {
    const set = (id: string, done: boolean): Row => ({ id, done })
    expect(completesExercise([set('a', true), set('b', true), set('c', false)], 'c')).toBe(true)
    expect(completesExercise([set('a', true), set('b', false), set('c', false)], 'c')).toBe(false)
    expect(completesExercise([set('a', false)], 'a')).toBe(true) // 只有一組
    expect(completesExercise([set('a', true)], 'zz')).toBe(false) // 找不到這組
    expect(completesExercise([], 'a')).toBe(false)
  })
  it('exerciseRpe：每一組都打勾才算做完；rpe 取各組最大值，都沒填＝null；沒有組＝沒做完', () => {
    const set = (done: boolean, rpe?: number | null): Row => ({ id: `${Math.random()}`, done, ...(rpe === undefined ? {} : { rpe }) })
    expect(exerciseRpe([set(true), set(true)])).toEqual({ complete: true, rpe: null })
    expect(exerciseRpe([set(true, 8), set(true, 9), set(true, null)])).toEqual({ complete: true, rpe: 9 })
    expect(exerciseRpe([set(true, 9), set(false)])).toEqual({ complete: false, rpe: 9 })
    expect(exerciseRpe([])).toEqual({ complete: false, rpe: null })
  })
  it('setExerciseRpeOps：寫在最後一組；同動作其他組已有的 RPE 一併清成 null，沒有的不動；沒有組＝不寫', () => {
    const rows: Row[] = [{ id: 'a', rpe: 8 }, { id: 'b' }, { id: 'c', rpe: null }, { id: 'd' }]
    expect(setExerciseRpeOps(rows, 9)).toEqual([
      { op: 'update', table: 'workout_sets', rowId: 'a', payload: { rpe: null } },
      { op: 'update', table: 'workout_sets', rowId: 'd', payload: { rpe: 9 } },
    ])
    expect(setExerciseRpeOps([{ id: 'x' }], 7)).toEqual([{ op: 'update', table: 'workout_sets', rowId: 'x', payload: { rpe: 7 } }])
    expect(setExerciseRpeOps([], 7)).toEqual([])
  })
  it('setRpeOps：單筆 update，payload 只有 rpe；null＝清掉', () => {
    expect(setRpeOps('s1', 9)).toEqual([{ op: 'update', table: 'workout_sets', rowId: 's1', payload: { rpe: 9 } }])
    expect(setRpeOps('s1', null)).toEqual([{ op: 'update', table: 'workout_sets', rowId: 's1', payload: { rpe: null } }])
  })
})

/* ═══════════ 有氧併入動作（spec「有氧併入動作」AC 1–7） ═══════════ */

const walkEx: Row = { id: 'walk', name: '跑步機坡度健走', muscle_group: 'other', kind: 'incline_walk', tips: null, archived: false }
const boxEx: Row = { id: 'box', name: '有氧拳擊', muscle_group: 'other', kind: 'boxing', tips: null, archived: false }
/** 一張有氧卡（workout_exercises 一列）；有氧欄位預設全空＝還沒填。 */
const card = (id: string, workout_id: string, exercise_id: string, fields: Record<string, unknown> = {}, position = 0): Row => ({
  id, workout_id, exercise_id, position, minutes: null, speed_kmh: null, incline_pct: null, est_kcal: null, ...fields,
})

describe('exerciseKind／isCardioExercise／cardioRecorded', () => {
  it('kind 是兩種有氧之一才算有氧', () => {
    expect(exerciseKind(walkEx)).toBe('incline_walk')
    expect(exerciseKind(boxEx)).toBe('boxing')
    expect(isCardioExercise(walkEx)).toBe(true)
    expect(isCardioExercise(boxEx)).toBe(true)
  })

  it('strength、欄位缺（舊快取）、不認得的值、空字串、null、找不到那列：一律當重訓', () => {
    for (const row of [{ id: 'x', kind: 'strength' }, { id: 'x' }, { id: 'x', kind: 'swim' }, { id: 'x', kind: '' }, { id: 'x', kind: null }]) {
      expect(exerciseKind(row)).toBe('strength')
      expect(isCardioExercise(row)).toBe(false)
    }
    expect(exerciseKind(null)).toBe('strength')
    expect(exerciseKind(undefined)).toBe('strength')
    expect(isCardioExercise(null)).toBe(false)
  })

  it('cardioRecorded：分鐘有值才算有記錄（D5：有氧卡沒有勾）', () => {
    expect(cardioRecorded(card('c', 'w', 'walk', { minutes: 30 }))).toBe(true)
    expect(cardioRecorded(card('c', 'w', 'walk', { minutes: '30.0' }))).toBe(true)
    expect(cardioRecorded(card('c', 'w', 'walk'))).toBe(false)
    expect(cardioRecorded(card('c', 'w', 'walk', { minutes: '' }))).toBe(false)
    expect(cardioRecorded({ id: 'c' }), '欄位整個缺（佇列疊上的列）').toBe(false)
  })
})

describe('自建動作不能是有氧（AC 2）', () => {
  it('新增動作的寫入不帶 kind（伺服器 default strength）', () => {
    const [op] = createExerciseOps({ id: 'n1', value: { name: '跳繩', muscle_group: 'other', tips: null } })
    expect(op.payload).not.toHaveProperty('kind')
  })

  it('編輯動作（含兩個有氧動作）只帶改了的欄位，不動 kind', () => {
    expect(updateExerciseOps({ current: walkEx, value: { name: '坡度健走', muscle_group: 'other', tips: '扶手不抓' } })).toEqual([
      { op: 'update', table: 'exercises', rowId: 'walk', payload: { name: '坡度健走', tips: '扶手不抓' } },
    ])
  })
})

describe('addExerciseOps：有氧動作（AC 3）', () => {
  const hist = db({
    exercises: [walkEx, boxEx, exercise('e1')],
    workouts: [workout('old', '2026-10-01'), workout('prev', '2026-10-08')],
    workout_exercises: [
      card('c-old', 'old', 'walk', { minutes: 20, speed_kmh: 5, incline_pct: 3 }),
      // 伺服器的 numeric 欄位以字串回來
      card('c-prev', 'prev', 'walk', { minutes: '30.0', speed_kmh: '5.5', incline_pct: '8.0' }),
    ],
  })
  const add = (d: TrainingDb, exerciseId: string, extra: { target?: { target_sets: number; target_reps: number } } = {}) =>
    addExerciseOps({ db: d, workoutId: 'w', exerciseId, newId: idGen(), ...extra })

  it('沒有歷史：只寫一列 workout_exercises，四個有氧欄位都是 null，沒有任何組（課表目標也不產組）', () => {
    expect(add(db({ exercises: [walkEx] }), 'walk', { target: { target_sets: 5, target_reps: 10 } })).toEqual([
      {
        op: 'insert',
        table: 'workout_exercises',
        rowId: 'n1',
        payload: { workout_id: 'w', exercise_id: 'walk', position: 0, minutes: null, speed_kmh: null, incline_pct: null, est_kcal: null },
      },
    ])
  })

  it('有歷史（上次 30 分、5.5 km/h、坡度 8%）：速度與坡度預填、轉成數字；分鐘留空，所以這張卡還不算記錄、摘要是空字串', () => {
    const ops = add(hist, 'walk')
    expect(ops).toHaveLength(1)
    // 分鐘不預填（2026-10-22 裁決）：預填了就分不出「做了」與「帶出來但沒做」，沒做的那天會留下假記錄
    expect(ops[0].payload).toEqual({
      workout_id: 'w', exercise_id: 'walk', position: 0, minutes: null, speed_kmh: 5.5, incline_pct: 8, est_kcal: null,
    })
    expect(cardioRecorded({ id: ops[0].rowId, ...ops[0].payload })).toBe(false)
    expect(cardioSummary({ id: ops[0].rowId, ...ops[0].payload }), '卡片顯示「點一下填寫」').toBe('')
  })

  it('進行中的這一次自己的有氧卡不算「上次」；沒填分鐘的卡不算記錄，往更早找', () => {
    const d = db({
      ...hist,
      workouts: [...hist.workouts, workout('later', '2026-10-10'), workout('w', '2026-10-14')],
      workout_exercises: [
        ...hist.workout_exercises,
        card('c-empty', 'later', 'walk', { speed_kmh: 7, incline_pct: 12 }), // 10/10 加了卡、速度坡度有值，但沒填分鐘
        card('c-now', 'w', 'walk', { minutes: 99, speed_kmh: 9, incline_pct: 9 }),
      ],
    })
    const [op] = add(d, 'walk')
    expect(op.payload).toMatchObject({ position: 1, minutes: null, speed_kmh: 5.5, incline_pct: 8, est_kcal: null })
  })

  it('同一天兩次：開始時間較晚的為準；訓練已不在（孤兒卡）不算', () => {
    const d = db({
      exercises: [walkEx],
      workouts: [workout('a', '2026-10-10', '2026-10-10T01:00:00.000Z'), workout('b', '2026-10-10', '2026-10-10T09:00:00.000Z')],
      workout_exercises: [
        card('ca', 'a', 'walk', { minutes: 40, speed_kmh: 4 }),
        card('cb', 'b', 'walk', { minutes: 25, speed_kmh: 6 }),
        card('cx', 'gone', 'walk', { minutes: 99, speed_kmh: 9 }),
      ],
    })
    expect(add(d, 'walk')[0].payload?.speed_kmh).toBe(6)
    expect(cardioLastMinutes(d, 'walk')).toBe(25)
  })

  it('拳擊：預估熱量預填、分鐘留空；歷史上不屬於拳擊的欄位（髒資料）一律 null', () => {
    const d = db({
      ...hist,
      workout_exercises: [...hist.workout_exercises, card('c-box', 'old', 'box', { minutes: 36, speed_kmh: 6, incline_pct: 2, est_kcal: '121.0' })],
    })
    expect(add(d, 'box')[0].payload).toMatchObject({ minutes: null, speed_kmh: null, incline_pct: null, est_kcal: 121 })
  })

  it('別的有氧動作的歷史不混進來：拳擊沒歷史就全空，即使健走有', () => {
    expect(add(hist, 'box')[0].payload).toMatchObject({ minutes: null, speed_kmh: null, incline_pct: null, est_kcal: null })
  })

  it('cardioPrefill 直接呼叫：分鐘一律 null；健走的預估熱量即使歷史有值也是 null；空字串視為沒填', () => {
    const d = db({
      workouts: [workout('o', '2026-10-01')],
      workout_exercises: [card('c', 'o', 'walk', { minutes: 30, speed_kmh: '', incline_pct: 0, est_kcal: 200 })],
    })
    expect(cardioPrefill(d, 'walk', 'incline_walk')).toEqual({ minutes: null, speed_kmh: null, incline_pct: 0, est_kcal: null })
    expect(cardioPrefill(d, 'walk', 'incline_walk', 'o')).toEqual({ minutes: null, speed_kmh: null, incline_pct: null, est_kcal: null })
  })

  describe('cardioLastMinutes（有氧 sheet 分鐘欄的「上次 N」）', () => {
    it('沒有歷史：null', () => {
      expect(cardioLastMinutes(db({ exercises: [walkEx] }), 'walk')).toBeNull()
    })

    it('有歷史：最近一張有記錄的卡的分鐘，伺服器回的字串轉成數字（10/08 的 "30.0"，不是 10/01 的 20）', () => {
      expect(cardioLastMinutes(hist, 'walk')).toBe(30)
    })

    it('排除這一次：這次的卡（99）不算，回上一次的 30；只有這次有卡就是 null', () => {
      const d = db({
        ...hist,
        workouts: [...hist.workouts, workout('w', '2026-10-14')],
        workout_exercises: [...hist.workout_exercises, card('c-now', 'w', 'walk', { minutes: 99 })],
      })
      expect(cardioLastMinutes(d, 'walk', 'w')).toBe(30)
      expect(cardioLastMinutes(d, 'walk'), '不排除時這次就是最新的').toBe(99)
      const only = db({ workouts: [workout('w', '2026-10-14')], workout_exercises: [card('c-now', 'w', 'walk', { minutes: 99 })] })
      expect(cardioLastMinutes(only, 'walk', 'w')).toBeNull()
    })

    it('跳過沒填分鐘的卡：10/10 那張只有速度，往前找到 10/08 的 30', () => {
      const d = db({
        ...hist,
        workouts: [...hist.workouts, workout('later', '2026-10-10')],
        workout_exercises: [...hist.workout_exercises, card('c-empty', 'later', 'walk', { speed_kmh: 7 }), card('c-blank', 'later', 'walk', { minutes: '' }, 1)],
      })
      expect(cardioLastMinutes(d, 'walk')).toBe(30)
    })

    it('別的動作不混：拳擊沒歷史就是 null，即使健走有；拳擊有歷史回自己的 36', () => {
      expect(cardioLastMinutes(hist, 'box')).toBeNull()
      const d = db({ ...hist, workout_exercises: [...hist.workout_exercises, card('c-box', 'old', 'box', { minutes: 36 })] })
      expect(cardioLastMinutes(d, 'box')).toBe(36)
      expect(cardioLastMinutes(d, 'walk'), '健走仍是自己的 30').toBe(30)
    })
  })

  it('動作庫找不到那列、或 kind 不認得：當重訓（3 組 0×0）——沒有資訊可判，不悄悄變成沒有組的卡', () => {
    expect(add(db(), 'walk').filter((o) => o.table === 'workout_sets')).toHaveLength(3)
    const odd = db({ exercises: [{ ...walkEx, kind: 'swim' }] })
    const ops = add(odd, 'walk')
    expect(ops.filter((o) => o.table === 'workout_sets')).toHaveLength(3)
    expect(ops[0].payload).toEqual({ workout_id: 'w', exercise_id: 'walk', position: 0 })
  })

  it('重訓動作的寫入不變：workout_exercises 不帶有氧欄位', () => {
    expect(add(hist, 'e1')[0].payload).toEqual({ workout_id: 'w', exercise_id: 'e1', position: 0 })
  })
})

describe('startWorkoutFromRoutineOps：課表裡的有氧動作（AC 7）', () => {
  const now = new Date(2026, 9, 14, 10, 30, 0)
  const d = db({
    exercises: [exercise('e1'), walkEx],
    routines: [routine('r', '腿日')],
    // 有氧那列的目標 5 組 × 15 對有氧沒有意義，不能變成 5 組
    routine_exercises: [re('x1', 'r', 'e1', 0, 3, 12), re('x2', 'r', 'walk', 1, 5, 15)],
    workouts: [workout('prev', '2026-10-08')],
    workout_exercises: [card('c-prev', 'prev', 'walk', { minutes: 30, speed_kmh: 5.5, incline_pct: 8 })],
  })

  it('帶出有氧卡、速度與坡度預填上次的值、分鐘留空（同加動作）；組只有重訓動作的，target 對有氧不用', () => {
    const ops = startWorkoutFromRoutineOps({ db: d, routineId: 'r', workoutId: 'w', date: '2026-10-14', now, newId: idGen() })
    // n1＝腿推舉那列、n2–n4＝它的三組、n5＝有氧卡
    expect(ops).toHaveLength(6)
    expect(ops.filter((o) => o.table === 'workout_sets').map((o) => o.payload?.workout_exercise_id)).toEqual(['n1', 'n1', 'n1'])
    expect(ops[5]).toEqual({
      op: 'insert',
      table: 'workout_exercises',
      rowId: 'n5',
      payload: { workout_id: 'w', exercise_id: 'walk', position: 1, minutes: null, speed_kmh: 5.5, incline_pct: 8, est_kcal: null },
    })
  })
})

describe('有氧卡的編輯（AC 4）', () => {
  it('cardioEntryDraft：類型來自動作；數字轉回表單字串，空欄位是空字串', () => {
    expect(cardioEntryDraft(card('c1', 'w', 'walk', { minutes: '30.0', speed_kmh: '5.5', incline_pct: 8 }), walkEx)).toEqual({
      kind: 'incline_walk', minutes: '30', speed_kmh: '5.5', incline_pct: '8', est_kcal: '',
    })
    expect(cardioEntryDraft(card('c2', 'w', 'box'), boxEx)).toEqual({ kind: 'boxing', minutes: '', speed_kmh: '', incline_pct: '', est_kcal: '' })
  })

  it('還沒填就存：分鐘必填', () => {
    expect(checkCardio(cardioEntryDraft(card('c2', 'w', 'box'), boxEx))).toEqual({ ok: false, error: '分鐘要填' })
  })

  it('動作找不到或不是有氧：kind 是 strength，checkCardio 擋下（那不是能填有氧的卡）', () => {
    const filled = card('c1', 'w', 'walk', { minutes: 30 })
    expect(cardioEntryDraft(filled, null).kind).toBe('strength')
    expect(checkCardio(cardioEntryDraft(filled, null))).toEqual({ ok: false, error: '請選有氧類型' })
    expect(checkCardio(cardioEntryDraft(filled, exercise('e1')))).toEqual({ ok: false, error: '請選有氧類型' })
  })

  it('範圍外擋下並說明：分鐘 0、速度 41、坡度 41、熱量 10001、超過一位小數', () => {
    const walk = cardioEntryDraft(card('c1', 'w', 'walk', { minutes: 30, speed_kmh: 5.5, incline_pct: 8 }), walkEx)
    const box = cardioEntryDraft(card('c2', 'w', 'box', { minutes: 36, est_kcal: 121 }), boxEx)
    expect(checkCardio({ ...walk, minutes: '0' })).toEqual({ ok: false, error: '分鐘要大於 0、最多 1440' })
    expect(checkCardio({ ...walk, speed_kmh: '41' })).toEqual({ ok: false, error: '速度要大於 0、最多 40 km/h' })
    expect(checkCardio({ ...walk, incline_pct: '41' })).toEqual({ ok: false, error: '坡度要在 0–40% 之間' })
    expect(checkCardio({ ...box, est_kcal: '10001' })).toEqual({ ok: false, error: '預估熱量要在 0–10000 kcal 之間' })
    expect(checkCardio({ ...walk, speed_kmh: '5.55' })).toEqual({ ok: false, error: '速度最多一位小數' })
    expect(checkCardio(walk)).toEqual({ ok: true, value: { kind: 'incline_walk', minutes: 30, speed_kmh: 5.5, incline_pct: 8, est_kcal: null } })
  })

  it('updateCardioEntryOps：只帶有變的欄位、全沒變回空陣列，寫的是 workout_exercises', () => {
    const current = card('c1', 'w', 'walk', { minutes: '30.0', speed_kmh: '5.5', incline_pct: 8 })
    const same = checkCardio(walkDraft())
    if (!same.ok) throw new Error('fixture')
    expect(updateCardioEntryOps({ current, value: same.value }), '伺服器回字串型數字也算沒變').toEqual([])
    const changed = checkCardio(walkDraft({ minutes: '45' }))
    if (!changed.ok) throw new Error('fixture')
    expect(updateCardioEntryOps({ current, value: changed.value })).toEqual([
      { op: 'update', table: 'workout_exercises', rowId: 'c1', payload: { minutes: 45 } },
    ])
  })

  it('updateCardioEntryOps：不帶 kind（workout_exercises 沒有這欄，帶了伺服器整筆拒絕）；第一次填就帶齊該類型的欄位', () => {
    const v = checkCardio(boxDraft())
    if (!v.ok) throw new Error('fixture')
    expect(updateCardioEntryOps({ current: card('c2', 'w', 'box'), value: v.value })).toEqual([
      { op: 'update', table: 'workout_exercises', rowId: 'c2', payload: { minutes: 36, est_kcal: 121 } },
    ])
  })

  it('updateCardioEntryOps：沒填 → 填 0 是變更；有值 → 清空寫 null', () => {
    const zero = checkCardio(boxDraft({ est_kcal: '0' }))
    if (!zero.ok) throw new Error('fixture')
    expect(updateCardioEntryOps({ current: card('c2', 'w', 'box', { minutes: 36 }), value: zero.value })[0].payload).toEqual({ est_kcal: 0 })
    const cleared = checkCardio(walkDraft({ speed_kmh: '' }))
    if (!cleared.ok) throw new Error('fixture')
    expect(updateCardioEntryOps({ current: card('c1', 'w', 'walk', { minutes: 30, speed_kmh: 5.5, incline_pct: 8 }), value: cleared.value })[0].payload).toEqual({
      speed_kmh: null,
    })
  })

  it('cardioSummary 對有氧卡同樣適用；還沒填分鐘回空字串（畫面顯示「點一下填寫」，不寫成「0 分」）', () => {
    expect(cardioSummary(card('c1', 'w', 'walk', { minutes: '30.0', speed_kmh: '5.5', incline_pct: '8.0' }))).toBe('30 分 · 5.5 km/h · 坡度 8%')
    expect(cardioSummary(card('c2', 'w', 'box', { minutes: 36, est_kcal: 121 }))).toBe('36 分 · 預估 121 kcal')
    expect(cardioSummary(card('c3', 'w', 'walk'))).toBe('')
    expect(cardioSummary(card('c4', 'w', 'walk', { speed_kmh: 5.5 })), '只有速度沒有分鐘＝還沒記').toBe('')
  })
})

describe('有氧卡走離線佇列（AC 5）', () => {
  it('離線加有氧動作、填寫、結束訓練：疊上佇列後是一次已結束的訓練、一張填好的有氧卡、沒有任何組', () => {
    const base = db({ exercises: [walkEx] })
    const start = new Date(2026, 9, 14, 10, 30, 0)
    const end = new Date(2026, 9, 14, 11, 10, 0)
    const toEntries = (ops: readonly RowOp[], from: number) => ops.map((o, i) => entry(from + i, o.op, o.table, o.rowId, o.payload ?? null))

    const added = toEntries(
      [
        ...startWorkoutOps({ workoutId: 'w1', date: '2026-10-14', now: start }),
        ...addExerciseOps({ db: base, workoutId: 'w1', exerciseId: 'walk', newId: () => 'c1' }),
      ],
      1,
    )
    const mid = applyQueue(base, added, 'u1')
    const filled = checkCardio({ ...cardioEntryDraft(mid.workout_exercises[0], walkEx), minutes: '30', speed_kmh: '5.5', incline_pct: '8' })
    if (!filled.ok) throw new Error('fixture')
    const all = [
      ...added,
      ...toEntries(
        [
          ...updateCardioEntryOps({ current: mid.workout_exercises[0], value: filled.value }),
          ...finishWorkoutOps({ workout: mid.workouts[0], now: end, minutes: null }),
        ],
        3,
      ),
    ]

    const view = applyQueue(base, all, 'u1')
    expect(view.workouts).toEqual([
      { id: 'w1', performed_on: '2026-10-14', started_at: start.toISOString(), ended_at: end.toISOString(), routine_id: null },
    ])
    expect(view.workout_exercises).toEqual([
      { id: 'c1', workout_id: 'w1', exercise_id: 'walk', position: 0, minutes: 30, speed_kmh: 5.5, incline_pct: 8, est_kcal: null },
    ])
    expect(view.workout_sets).toEqual([])
    expect(all.map((e) => describeEntry(e))).toEqual(['新增訓練', '訓練加動作', '改訓練的動作', '改訓練'])
    // 有氧卡的 insert 要等訓練與動作先上傳（佇列的父列依賴）
    expect(parentRefs('workout_exercises', all[1].payload ?? {}).map((p) => [p.table, p.rowId, p.onDelete])).toEqual([
      ['workouts', 'w1', 'cascade'],
      ['exercises', 'walk', 'restrict'],
    ])
  })
})

describe('有氧卡不影響其他功能（AC 6）', () => {
  const now = new Date('2026-10-14T12:00:00.000Z')
  const d = db({
    exercises: [exercise('e1', '腿推舉'), walkEx],
    workouts: [
      { ...workout('w', '2026-10-14', '2026-10-14T01:00:00.000Z'), ended_at: '2026-10-14T01:36:00.000Z' },
      { ...workout('wc', '2026-10-14', '2026-10-14T09:00:00.000Z'), ended_at: '2026-10-14T09:30:00.000Z' },
    ],
    workout_exercises: [
      we('we1', 'w', 'e1', 0),
      card('c1', 'w', 'walk', { minutes: 30, speed_kmh: 5.5, incline_pct: 8 }, 1),
      card('c2', 'wc', 'walk', { minutes: 20 }),
    ],
    workout_sets: [set('s1', 'we1', 1, 60, 12), set('s2', 'we1', 2, 60, 12)],
  })

  it('workoutsOn：有氧卡算一個動作，但組數、訓練量是 0；只有有氧的訓練時長照起訖', () => {
    expect(workoutsOn(d, '2026-10-14', now)).toEqual([
      { id: 'w', startedAt: '2026-10-14T01:00:00.000Z', endedAt: '2026-10-14T01:36:00.000Z', inProgress: false, exerciseCount: 2, volume: 1440, doneSets: 2, totalSets: 2, minutes: 36, soloCardio: null },
      { id: 'wc', startedAt: '2026-10-14T09:00:00.000Z', endedAt: '2026-10-14T09:30:00.000Z', inProgress: false, exerciseCount: 1, volume: 0, doneSets: 0, totalSets: 0, minutes: 30, soloCardio: { name: '跑步機坡度健走', summary: '20 分' } },
    ])
  })

  it('workoutDetail：有氧卡的 sets 是空陣列、帶出動作庫那列；攤平的組只有重訓的', () => {
    const detail = workoutDetail(d, 'w')!
    expect(detail.exercises.map((e) => [e.entry.id, e.exercise?.id, e.sets.length])).toEqual([['we1', 'e1', 2], ['c1', 'walk', 0]])
    expect(setsOfDetail(detail)).toEqual([
      { weight_kg: 60, reps: 12, done: true },
      { weight_kg: 60, reps: 12, done: true },
    ])
  })

  it('沒有組的卡：進度 0/0 沒有下一組、不算全部完成、RPE 不算做完、全部完成鈕不寫任何東西', () => {
    const detail = workoutDetail(d, 'w')!
    expect(exerciseProgress([])).toEqual({ done: 0, total: 0, next: null })
    expect(allSetsDone([])).toBe(false)
    expect(exerciseRpe([])).toEqual({ complete: false, rpe: null })
    expect(completesExercise([], 'c1')).toBe(false)
    expect(toggleAllDoneOps(detail, 'c1')).toEqual([])
  })

  it('重量預填看不到有氧卡；重訓動作的上次照舊', () => {
    expect(lastCompletedSets(d, 'walk')).toEqual([])
    expect(lastCompletedSets(d, 'e1')).toEqual([
      { weight_kg: 60, reps: 12 },
      { weight_kg: 60, reps: 12 },
    ])
  })

  it('排序：有氧卡和其他動作一樣排', () => {
    const entries = workoutDetail(d, 'w')!.exercises.map((e) => e.entry)
    expect(reorderWorkoutExercisesOps({ entries, orderedIds: ['c1', 'we1'] })).toEqual([
      { op: 'update', table: 'workout_exercises', rowId: 'c1', payload: { position: 0 } },
      { op: 'update', table: 'workout_exercises', rowId: 'we1', payload: { position: 1 } },
    ])
  })

  it('存成課表：有氧動作照預設存 3 組、次數不設（D1：用不到的 target_sets）', () => {
    const ops = routineFromWorkoutOps({ db: d, workoutId: 'w', name: '腿日', newId: idGen() })
    expect(ops.slice(1).map((o) => [o.payload?.exercise_id, o.payload?.target_sets, o.payload?.target_reps])).toEqual([
      ['e1', 2, 12],
      ['walk', 3, null],
    ])
  })
})

describe('workoutsOn：只有一張有氧卡的訓練（AC 9：已完成列表以動作名稱與有氧摘要列出）', () => {
  const now = new Date('2026-10-15T12:00:00.000Z')
  const at = (id: string, hour: string): Row => ({
    ...workout(id, '2026-10-15', `2026-10-15T${hour}:00:00.000Z`),
    ended_at: `2026-10-15T${hour}:30:00.000Z`,
  })
  const d = db({
    exercises: [exercise('e1', '腿推舉'), walkEx, boxEx],
    workouts: [at('walk-only', '01'), at('box-empty', '02'), at('mixed', '03'), at('two-cardio', '04'), at('strength', '05'), at('none', '06'), at('ghost', '07')],
    workout_exercises: [
      card('c1', 'walk-only', 'walk', { minutes: 30, speed_kmh: 5.5, incline_pct: 8 }),
      card('c2', 'box-empty', 'box'),
      we('we1', 'mixed', 'e1', 0),
      card('c3', 'mixed', 'walk', { minutes: 20 }, 1),
      card('c4', 'two-cardio', 'walk', { minutes: 15 }, 0),
      card('c5', 'two-cardio', 'box', { minutes: 10 }, 1),
      we('we2', 'strength', 'e1', 0),
      card('c6', 'ghost', 'gone', { minutes: 30 }),
    ],
    workout_sets: [set('s1', 'we1', 1, 60, 12), set('s2', 'we2', 1, 60, 12)],
  })
  const solo = Object.fromEntries(workoutsOn(d, '2026-10-15', now).map((c) => [c.id, c.soloCardio]))

  it('只有一張有氧卡：動作名稱＋有氧摘要；還沒填分鐘的摘要是空字串', () => {
    expect(solo['walk-only']).toEqual({ name: '跑步機坡度健走', summary: '30 分 · 5.5 km/h · 坡度 8%' })
    expect(solo['box-empty']).toEqual({ name: '有氧拳擊', summary: '' })
  })

  it('混了重訓、兩張有氧卡、只有重訓、沒有動作、動作庫找不到那列：都不是（照舊顯示動作數與組數）', () => {
    expect([solo.mixed, solo['two-cardio'], solo.strength, solo.none, solo.ghost]).toEqual([null, null, null, null, null])
  })
})
