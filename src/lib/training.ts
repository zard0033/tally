/* 訓練記錄的純邏輯（階段 2，spec.md「階段 2 spec」AC 1、5、7、8a、18、21）。
 *
 * 範圍：只有純函式，禁沾 DOM／supabase（這層未來要原樣帶去 React Native）。資料列的形狀照 DDL
 * （snake_case 欄位），讓佇列條目的 payload、伺服器回的列、畫面讀的列是同一個形狀、不必來回轉。
 * 接線（IndexedDB adapter、Supabase sender、App.tsx）不在這裡，等 UI 步驟。 */

import type { OnParentDelete, QueueEntry, RowRef } from './queue'
import { localDate } from './dates'
import { uuidV5 } from './uuid'

/* ═══════════ 型別與資料表 ═══════════ */

export const MUSCLE_GROUPS = ['chest', 'back', 'legs', 'shoulder', 'arms', 'core', 'other'] as const
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

/** 沿用 Gymwork 的七類。 */
export const MUSCLE_GROUP_LABEL: Readonly<Record<MuscleGroup, string>> = {
  chest: '胸部',
  back: '背部',
  legs: '下半身',
  shoulder: '肩膀',
  arms: '手臂',
  core: '腹肌',
  other: '其他',
}

/** 父表在前、子表在後：級聯隱藏要由父往子走一次就收斂。 */
export const TRAINING_TABLES = [
  'exercises',
  'routines',
  'workouts',
  'routine_exercises',
  'workout_exercises',
  'workout_sets',
  'cardio_sessions',
] as const
export type TrainingTable = (typeof TRAINING_TABLES)[number]

export type Row = { readonly id: string } & Readonly<Record<string, unknown>>
export type TrainingDb = Readonly<Record<TrainingTable, readonly Row[]>>

export function emptyTrainingDb(): TrainingDb {
  return Object.fromEntries(TRAINING_TABLES.map((t) => [t, []])) as unknown as TrainingDb
}

const isTrainingTable = (t: string): t is TrainingTable => (TRAINING_TABLES as readonly string[]).includes(t)

/* ═══════════ 外鍵 ═══════════ */

interface ForeignKey {
  readonly column: string
  readonly parent: TrainingTable
  /** 伺服器端的 on delete。三種都是「要等父列先到」，差別在父列不會存在了時子列怎麼辦（見 queue.ts）。 */
  readonly onDelete: OnParentDelete
}

/** 與 DDL 逐條對應。`exercise_id` 是 restrict（動作不真刪、只封存）；`workouts.routine_id` 是 set null。 */
const FOREIGN_KEYS: Readonly<Record<TrainingTable, readonly ForeignKey[]>> = {
  exercises: [],
  routines: [],
  workouts: [{ column: 'routine_id', parent: 'routines', onDelete: 'setNull' }],
  routine_exercises: [
    { column: 'routine_id', parent: 'routines', onDelete: 'cascade' },
    { column: 'exercise_id', parent: 'exercises', onDelete: 'restrict' },
  ],
  workout_exercises: [
    { column: 'workout_id', parent: 'workouts', onDelete: 'cascade' },
    { column: 'exercise_id', parent: 'exercises', onDelete: 'restrict' },
  ],
  workout_sets: [{ column: 'workout_exercise_id', parent: 'workout_exercises', onDelete: 'cascade' }],
  cardio_sessions: [],
}

/** 一列 insert／update 的 payload 該帶哪些 `parents`（佇列的父列依賴，AC 16）。
 *  每次 enqueue 都經過它，才不會有人漏填而讓子列搶在父列之前送出。 */
export function parentRefs(table: TrainingTable, payload: Readonly<Record<string, unknown>>): RowRef[] {
  return FOREIGN_KEYS[table].flatMap(({ column, parent, onDelete }) => {
    const v = payload[column]
    return typeof v === 'string' ? [{ table: parent, rowId: v, column, onDelete }] : []
  })
}

/* ═══════════ 預填動作（AC 1） ═══════════ */

const EXERCISE_NAMESPACE = '3f2b8a52-6c1e-4d0a-9b7e-5a1c2d4e6f80'

export const PRESET_EXERCISES: readonly { readonly key: string; readonly name: string; readonly muscle_group: MuscleGroup }[] = [
  { key: 'leg-press', name: '腿推舉', muscle_group: 'legs' },
  { key: 'leg-extension', name: '腿屈伸', muscle_group: 'legs' },
  { key: 'leg-curl', name: '腿彎舉', muscle_group: 'legs' },
  { key: 'calf-raise', name: '小腿提踵', muscle_group: 'legs' },
  { key: 'hip-abduction', name: '髖外展', muscle_group: 'legs' },
  { key: 'hip-adduction', name: '髖內收', muscle_group: 'legs' },
  { key: 'lat-pulldown', name: '滑輪下拉', muscle_group: 'back' },
  { key: 'seated-row', name: '坐姿划船', muscle_group: 'back' },
  { key: 'back-extension', name: '背伸展機', muscle_group: 'back' },
  { key: 'chest-press', name: '坐姿胸推', muscle_group: 'chest' },
  { key: 'pec-fly', name: '蝴蝶機夾胸', muscle_group: 'chest' },
  { key: 'shoulder-press', name: '肩推', muscle_group: 'shoulder' },
  { key: 'reverse-fly', name: '反向蝴蝶機', muscle_group: 'shoulder' },
  { key: 'biceps-curl', name: '二頭彎舉（機械）', muscle_group: 'arms' },
  { key: 'triceps-pushdown', name: '三頭下壓（滑輪）', muscle_group: 'arms' },
  { key: 'ab-crunch', name: '腹部捲曲機', muscle_group: 'core' },
]

/** 確定性：同一個使用者的同一個動作 key 永遠是同一個 id——Safari 分頁與主畫面 App 各自預填，
 *  只會 upsert 到同一列。要把 userId 放進去：id 是全域主鍵，兩個帳號不能撞。 */
export function presetExerciseId(userId: string, key: string): string {
  return uuidV5(EXERCISE_NAMESPACE, `${userId}:exercise:${key}`)
}

/** 該帳號一個動作都沒有時回傳 16 列要預填的動作，否則回空陣列。
 *  **只在「一個都沒有」時預填**：有了就不再補——使用者改名、封存、寫要點之後再補一次，
 *  會把他改的東西蓋回預設。**enqueue 時要帶 `ignoreDuplicates: true`**：離線時本機快取還是空的就預填，
 *  回線後若用一般 upsert 會蓋掉伺服器上已被改過的同 id 列。 */
export function presetsToSeed(userId: string, existing: readonly Row[]): Row[] {
  if (existing.length > 0) return []
  return PRESET_EXERCISES.map((p) => ({
    id: presetExerciseId(userId, p.key),
    user_id: userId,
    name: p.name,
    muscle_group: p.muscle_group,
    tips: null,
    archived: false,
  }))
}

/* ═══════════ 疊加未同步變更（AC 18） ═══════════ */

/** 把佇列裡尚未同步的條目疊在伺服器資料上：剛記的馬上看得到、重開也不消失。
 *  - 依 seq 重放（不依陣列順序）；只看屬於 userId 的條目，別的帳號的殘留不動。
 *  - insert 是 upsert（與 Sender 契約一致）；update 對不存在的列不做事（伺服器也是 0 列）。
 *  - delete 之後，**伺服器端會 cascade 的子列**一併隱藏（離線時只排了一條 delete）。
 *    只認明確的 delete，不認「父列不在」：基底資料可能只載了一部分，缺父列不代表被刪。
 *  - id 不重用：同一個 id 刪掉再插入的情形不特別處理。 */
export function applyQueue(base: TrainingDb, entries: readonly QueueEntry[], userId: string): TrainingDb {
  const rows = {} as Record<TrainingTable, Map<string, Row>>
  const deleted = {} as Record<TrainingTable, Set<string>>
  for (const t of TRAINING_TABLES) {
    rows[t] = new Map(base[t].map((r) => [r.id, r]))
    deleted[t] = new Set()
  }

  const mine = entries
    .filter((e) => e.userId === userId && isTrainingTable(e.table))
    .sort((a, b) => a.seq - b.seq)
  for (const e of mine) {
    const t = e.table as TrainingTable
    const current = rows[t].get(e.rowId)
    if (e.op === 'delete') {
      rows[t].delete(e.rowId)
      deleted[t].add(e.rowId)
    } else if (e.op === 'insert') {
      // 預填（ignoreDuplicates）在伺服器上是 on conflict do nothing：列已在就不動它。
      // 照一般 insert 疊上去，會把使用者改過名、封存、寫過要點的動作在畫面與本機底上蓋回預設值。
      if (current && e.ignoreDuplicates) continue
      rows[t].set(e.rowId, { ...current, ...e.payload, id: e.rowId })
    } else if (current) {
      rows[t].set(e.rowId, { ...current, ...e.payload, id: e.rowId })
    }
  }

  for (const t of TRAINING_TABLES) {
    for (const fk of FOREIGN_KEYS[t]) {
      if (fk.onDelete !== 'cascade' || deleted[fk.parent].size === 0) continue
      for (const [id, row] of rows[t]) {
        const ref = row[fk.column]
        if (typeof ref === 'string' && deleted[fk.parent].has(ref)) {
          rows[t].delete(id)
          deleted[t].add(id) // 孫列要看得到這一層也被刪了
        }
      }
    }
  }

  return Object.fromEntries(TRAINING_TABLES.map((t) => [t, [...rows[t].values()]])) as unknown as TrainingDb
}

/* ═══════════ 預填上次的值（AC 5） ═══════════ */

export interface PrefillSet {
  readonly weight_kg: number
  readonly reps: number
}

export const DEFAULT_TARGET_SETS = 3

const startedMs = (w: Row): number => {
  const ms = Date.parse(String(w.started_at))
  return Number.isNaN(ms) ? 0 : ms
}

/** 該動作「上次實際完成」的各組：最近一次有打勾組的訓練裡，那個動作已打勾的組，依 set_no 排。
 *  - 沒打勾的組不算「完成」，整次都沒打勾的訓練跳過、改看更早一次。
 *  - `excludeWorkoutId`：進行中的這一次不能是自己的「上次」。
 *  吃的是已疊上佇列的 db，所以離線剛記完的訓練也算。 */
export function lastCompletedSets(db: TrainingDb, exerciseId: string, excludeWorkoutId?: string): PrefillSet[] {
  const workouts = new Map(db.workouts.map((w) => [w.id, w]))
  const setsByWe = new Map<string, Row[]>()
  for (const s of db.workout_sets) {
    if (s.done !== true) continue
    const ref = String(s.workout_exercise_id)
    setsByWe.set(ref, [...(setsByWe.get(ref) ?? []), s])
  }

  const candidates = db.workout_exercises
    .filter((we) => we.exercise_id === exerciseId && we.workout_id !== excludeWorkoutId)
    .flatMap((we) => {
      const workout = workouts.get(String(we.workout_id))
      const done = setsByWe.get(we.id)
      return workout && done ? [{ we, workout, done }] : []
    })
    .sort(
      (a, b) =>
        String(b.workout.performed_on).localeCompare(String(a.workout.performed_on)) ||
        startedMs(b.workout) - startedMs(a.workout) ||
        Number(b.we.position) - Number(a.we.position),
    )

  const latest = candidates[0]
  if (!latest) return []
  return [...latest.done]
    .sort(
      (a, b) =>
        Number(a.set_no) - Number(b.set_no) ||
        String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
    )
    .map((s) => ({ weight_kg: Number(s.weight_kg), reps: Number(s.reps) }))
}

export interface PrefillTarget {
  readonly target_sets?: number | null
  readonly target_reps?: number | null
}

/** 開始訓練時一個動作要帶出的各組。有歷史就一律取上次實際完成的值（不論空白開始或從課表開始）；
 *  沒歷史才用課表的預設組數與次數，重量一律 0（課表不存重量）；連課表預設都沒有就 3 組、次數 0。 */
export function prefillSets(
  db: TrainingDb,
  exerciseId: string,
  target?: PrefillTarget,
  excludeWorkoutId?: string,
): PrefillSet[] {
  const last = lastCompletedSets(db, exerciseId, excludeWorkoutId)
  if (last.length > 0) return last
  const count = Math.max(1, Math.floor(target?.target_sets ?? DEFAULT_TARGET_SETS))
  const reps = target?.target_reps ?? 0
  return Array.from({ length: count }, () => ({ weight_kg: 0, reps }))
}

/* ═══════════ 訓練摘要（AC 7） ═══════════ */

export interface SetLike {
  readonly weight_kg: number
  readonly reps: number
  readonly done: boolean
}

export interface WorkoutSummary {
  /** 已打勾各組 重量×次數 的總和（kg）。 */
  readonly volume: number
  readonly doneSets: number
  readonly totalSets: number
  /** 滿幾分鐘（無條件捨去）。 */
  readonly minutes: number
}

/** 重量有小數（22.5）時，先換成百分之一公斤的整數再乘，避免 12.35×3 這類浮點尾巴。 */
export function workoutSummary(
  sets: readonly SetLike[],
  startedAt: string,
  endedAt: string | null,
  now: Date,
): WorkoutSummary {
  const done = sets.filter((s) => s.done)
  const volumeCentis = done.reduce((sum, s) => sum + Math.round(s.weight_kg * 100) * s.reps, 0)
  const end = endedAt === null ? now.getTime() : Date.parse(endedAt)
  const ms = end - Date.parse(startedAt)
  return {
    volume: volumeCentis / 100,
    doneSets: done.length,
    totalSets: sets.length,
    minutes: Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0,
  }
}

/* ═══════════ 訓練頁的資料（日期小點、當天的訓練卡） ═══════════ */

/** 有訓練（重訓或有氧）的日子，給日期元件的小點用。 */
export function trainingDates(db: TrainingDb): Set<string> {
  const out = new Set<string>()
  for (const w of db.workouts) if (typeof w.performed_on === 'string') out.add(w.performed_on)
  for (const c of db.cardio_sessions) if (typeof c.performed_on === 'string') out.add(c.performed_on)
  return out
}

export interface WorkoutCard extends WorkoutSummary {
  readonly id: string
  readonly startedAt: string
  /** null＝進行中（App 重開後仍在，畫面提示可繼續，AC 9）。 */
  readonly endedAt: string | null
  readonly inProgress: boolean
  readonly exerciseCount: number
}

/** 某一天的重訓，依開始時間由早到晚。一天可以有多次（AC 9）。 */
export function workoutsOn(db: TrainingDb, date: string, now: Date): WorkoutCard[] {
  const exercisesOf = new Map<string, Row[]>()
  for (const we of db.workout_exercises) {
    const key = String(we.workout_id)
    exercisesOf.set(key, [...(exercisesOf.get(key) ?? []), we])
  }
  const setsOf = new Map<string, Row[]>()
  for (const s of db.workout_sets) {
    const key = String(s.workout_exercise_id)
    setsOf.set(key, [...(setsOf.get(key) ?? []), s])
  }
  return db.workouts
    .filter((w) => w.performed_on === date)
    .sort((a, b) => startedMs(a) - startedMs(b))
    .map((w) => {
      const exercises = exercisesOf.get(w.id) ?? []
      const sets = exercises.flatMap((e) => setsOf.get(e.id) ?? [])
      const endedAt = typeof w.ended_at === 'string' ? w.ended_at : null
      const summary = workoutSummary(
        sets.map((s) => ({ weight_kg: Number(s.weight_kg), reps: Number(s.reps), done: s.done === true })),
        String(w.started_at),
        endedAt,
        now,
      )
      return {
        ...summary,
        id: w.id,
        startedAt: String(w.started_at),
        endedAt,
        inProgress: endedAt === null,
        exerciseCount: exercises.length,
      }
    })
}

/* ═══════════ 一次訓練的內容與寫入組裝（AC 4、5、8、8a） ═══════════ */

export interface WorkoutExerciseDetail {
  /** workout_exercises 那一列。 */
  readonly entry: Row
  /** 動作庫的那一列；動作被刪（理論上 restrict 擋著）或底還沒載到時是 null，畫面要有退路。 */
  readonly exercise: Row | null
  /** 依 set_no 排好。 */
  readonly sets: readonly Row[]
}

export interface WorkoutDetail {
  readonly workout: Row
  /** 依 position 排好。 */
  readonly exercises: readonly WorkoutExerciseDetail[]
}

/** 訓練中／編輯一次訓練時畫面要的整份資料。找不到這次訓練（被刪了）回 null。 */
export function workoutDetail(db: TrainingDb, workoutId: string): WorkoutDetail | null {
  const workout = db.workouts.find((w) => w.id === workoutId)
  if (!workout) return null
  const exerciseById = new Map(db.exercises.map((e) => [e.id, e]))
  const byPosition = (a: Row, b: Row) => Number(a.position) - Number(b.position)
  const bySetNo = (a: Row, b: Row) =>
    Number(a.set_no) - Number(b.set_no) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  const exercises = db.workout_exercises
    .filter((we) => we.workout_id === workoutId)
    .sort(byPosition)
    .map((entry) => ({
      entry,
      exercise: exerciseById.get(String(entry.exercise_id)) ?? null,
      sets: db.workout_sets.filter((s) => s.workout_exercise_id === entry.id).sort(bySetNo),
    }))
  return { workout, exercises }
}

/** 一組一組攤平，給 workoutSummary 用。 */
export function setsOfDetail(detail: WorkoutDetail): SetLike[] {
  return detail.exercises.flatMap((e) =>
    e.sets.map((s) => ({ weight_kg: Number(s.weight_kg), reps: Number(s.reps), done: s.done === true })),
  )
}

/** 寫入的最小描述；與 trainingRuntime 的 WriteOp 同形（不引用它，那邊反過來引用這裡）。 */
export interface RowOp {
  op: 'insert' | 'update' | 'delete'
  table: TrainingTable
  rowId: string
  payload?: Record<string, unknown>
}

/** 這次訓練是不是「補記」建的：started_at 剛好是 performed_on 當天本機 12:00:00.000（補記的合成起點，
 *  `backfillTimes`），而且不是今天。真的在 12:00:00.000 整按下開始的機率是零。補記不跑計時，完成時要手填時長。 */
export function isBackfilled(workout: Row, today: string = localDate()): boolean {
  const performedOn = String(workout.performed_on)
  if (performedOn >= today) return false
  try {
    return backfillTimes(performedOn, null).started_at === new Date(String(workout.started_at)).toISOString()
  } catch {
    return false
  }
}

/** 開始一次訓練。選到今天＝現在開始、開始跑計時；選到過去＝補記（起點 12:00、不計時）。
 *  ended_at 一律 null＝進行中，App 重開後仍在、畫面提示可繼續（AC 9）。 */
export function startWorkoutOps(args: { workoutId: string; date: string; now: Date }): RowOp[] {
  const { workoutId, date, now } = args
  const live = date === localDate(now)
  const startedAt = live ? now.toISOString() : backfillTimes(date, null).started_at
  return [
    {
      op: 'insert',
      table: 'workouts',
      rowId: workoutId,
      payload: { performed_on: date, started_at: startedAt, ended_at: null, routine_id: null },
    },
  ]
}

/** 把一個動作加進這次訓練：一列 workout_exercises ＋ 預填的各組（有歷史就取上次實際完成的值）。 */
export function addExerciseOps(args: {
  db: TrainingDb
  workoutId: string
  exerciseId: string
  newId: () => string
  target?: PrefillTarget
}): RowOp[] {
  const { db, workoutId, exerciseId, newId, target } = args
  const taken = db.workout_exercises.filter((we) => we.workout_id === workoutId).map((we) => Number(we.position))
  const position = taken.length === 0 ? 0 : Math.max(...taken) + 1
  const entryId = newId()
  const prefilled = prefillSets(db, exerciseId, target, workoutId)
  return [
    {
      op: 'insert',
      table: 'workout_exercises',
      rowId: entryId,
      payload: { workout_id: workoutId, exercise_id: exerciseId, position },
    },
    ...prefilled.map(
      (s, i): RowOp => ({
        op: 'insert',
        table: 'workout_sets',
        rowId: newId(),
        payload: { workout_exercise_id: entryId, set_no: i + 1, weight_kg: s.weight_kg, reps: s.reps, done: false },
      }),
    ),
  ]
}

/** 新增一組：預填上一組的值（AC 5）；這個動作還沒有任何組就 0×0。 */
export function addSetOps(args: { db: TrainingDb; workoutExerciseId: string; newId: () => string }): RowOp[] {
  const { db, workoutExerciseId, newId } = args
  const sets = db.workout_sets.filter((s) => s.workout_exercise_id === workoutExerciseId)
  const last = [...sets].sort((a, b) => Number(a.set_no) - Number(b.set_no)).at(-1)
  const setNo = sets.length === 0 ? 1 : Math.max(...sets.map((s) => Number(s.set_no))) + 1
  return [
    {
      op: 'insert',
      table: 'workout_sets',
      rowId: newId(),
      payload: {
        workout_exercise_id: workoutExerciseId,
        set_no: setNo,
        weight_kg: last ? Number(last.weight_kg) : 0,
        reps: last ? Number(last.reps) : 0,
        done: false,
      },
    },
  ]
}

/** 結束一次進行中的訓練。即時的：ended_at＝現在；補記的：started_at／ended_at 由手填分鐘算
 *  （略過＝等於起點）。已結束的訓練重新打開編輯時，修改都是當下就存，不再呼叫這個。 */
export function finishWorkoutOps(args: { workout: Row; now: Date; minutes: number | null }): RowOp[] {
  const { workout, now, minutes } = args
  const payload = isBackfilled(workout, localDate(now))
    ? backfillTimes(String(workout.performed_on), minutes)
    : { ended_at: now.toISOString() }
  return [{ op: 'update', table: 'workouts', rowId: workout.id, payload }]
}

/** 重量的顯示：最多兩位小數、不補零（60、62.5、22.25）。 */
export const formatKg = (n: number): string => String(Number(n.toFixed(2)))

/** 「上次 60 kg × 12 × 3」：各組一樣就合成一句，不一樣就逐組列。沒有歷史回空字串。 */
export function formatLastSets(sets: readonly PrefillSet[]): string {
  if (sets.length === 0) return ''
  const kg = formatKg
  const same = sets.every((s) => s.weight_kg === sets[0].weight_kg && s.reps === sets[0].reps)
  if (same) return `${kg(sets[0].weight_kg)} kg × ${sets[0].reps} × ${sets.length}`
  return sets.map((s) => `${kg(s.weight_kg)} × ${s.reps}`).join(' · ')
}

/* ═══════════ 補記過去日子（AC 8a） ═══════════ */

/** 補記不跑計時：started_at＝該日本機 12:00，ended_at＝started_at＋手填分鐘（略過＝null＝相等）。
 *  performed_on 就是傳進來的那天。日期不合法（含 2026-02-31 這種）或分鐘超出 0–1440 都丟錯，不默默修正。 */
export function backfillTimes(
  performedOn: string,
  minutes: number | null,
): { started_at: string; ended_at: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(performedOn)
  if (!m) throw new Error(`日期格式不對：${performedOn}`)
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0)
  if (localDate(start) !== performedOn) throw new Error(`不存在的日期：${performedOn}`)
  if (minutes !== null && !(Number.isFinite(minutes) && minutes >= 0 && minutes <= 1440)) {
    throw new Error(`時長要在 0–1440 分鐘：${minutes}`)
  }
  const end = new Date(start.getTime() + (minutes ?? 0) * 60_000)
  return { started_at: start.toISOString(), ended_at: end.toISOString() }
}

/* ═══════════ 動作庫管理（AC 2、3） ═══════════ */

export interface ExerciseDraft {
  name: string
  muscle_group: string
  tips: string
}

/** 通過檢查、可以寫進去的值。tips 空白存成 null（DDL 的 tips 可為 null，「沒寫」只有一種表示）。 */
export interface ExerciseValue {
  name: string
  muscle_group: MuscleGroup
  tips: string | null
}

export type ExerciseCheck = { ok: true; value: ExerciseValue } | { ok: false; error: string }

/** 比對用：全形／半形、大小寫、連續空白都視為同一個名字（存的仍是使用者輸入的原樣）。 */
const foldName = (s: unknown): string => String(s).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
const sameName = (a: unknown, b: string) => foldName(a) === foldName(b)

/** 表單送出前的檢查。名稱不能空（DDL 有 btrim 檢查，擋在這裡才說得出白話）、肌群必須是七類之一、
 *  名稱不與其他動作重複（含已封存的——重複的名稱在清單與歷史裡分不出誰是誰）。
 *  `selfId`＝正在編輯的那列，不與自己比。 */
export function checkExercise(draft: ExerciseDraft, existing: readonly Row[], selfId?: string): ExerciseCheck {
  const name = draft.name.trim()
  if (name === '') return { ok: false, error: '名稱不能是空的' }
  if (!(MUSCLE_GROUPS as readonly string[]).includes(draft.muscle_group)) {
    return { ok: false, error: '肌群要選七類其中一個' }
  }
  const clash = existing.find((e) => e.id !== selfId && sameName(e.name, name))
  if (clash) {
    return {
      ok: false,
      error: clash.archived === true ? `「${name}」已經在封存裡，到封存區取消封存就能用` : `已經有「${name}」這個動作`,
    }
  }
  const tips = draft.tips.trim()
  return {
    ok: true,
    value: { name, muscle_group: draft.muscle_group as MuscleGroup, tips: tips === '' ? null : tips },
  }
}

/** 新增動作。不帶 user_id（伺服器 default auth.uid()），與 startWorkoutOps 等其他寫入一致。 */
export function createExerciseOps(args: { id: string; value: ExerciseValue }): RowOp[] {
  const { id, value } = args
  return [{ op: 'insert', table: 'exercises', rowId: id, payload: { ...value, archived: false } }]
}

/** 更新動作：只帶有變的欄位，全沒變回空陣列（不排一筆空的 PATCH 進佇列）。
 *  tips 的 null 與空字串視為同一件事（都是「沒寫」）。 */
export function updateExerciseOps(args: { current: Row; value: ExerciseValue }): RowOp[] {
  const { current, value } = args
  const payload: Record<string, unknown> = {}
  if (String(current.name) !== value.name) payload.name = value.name
  if (current.muscle_group !== value.muscle_group) payload.muscle_group = value.muscle_group
  const curTips = typeof current.tips === 'string' && current.tips !== '' ? current.tips : null
  if (curTips !== value.tips) payload.tips = value.tips
  return Object.keys(payload).length === 0 ? [] : [{ op: 'update', table: 'exercises', rowId: current.id, payload }]
}

/** 封存／取消封存。不提供真刪：歷史才不會爛（AC 2）。 */
export function setExerciseArchivedOps(args: { id: string; archived: boolean }): RowOp[] {
  return [{ op: 'update', table: 'exercises', rowId: args.id, payload: { archived: args.archived } }]
}

/* ═══════════ 有氧（AC 10–12） ═══════════ */

/** 現在只有兩種，不做「新類型」入口（使用者裁決）。存的是代碼、畫面顯示名稱；要加一種＝在這裡加一行。 */
export const CARDIO_KINDS = ['incline_walk', 'boxing'] as const
export type CardioKind = (typeof CARDIO_KINDS)[number]

export const CARDIO_KIND_LABEL: Readonly<Record<CardioKind, string>> = {
  incline_walk: '跑步機坡度健走',
  boxing: '有氧拳擊',
}

type CardioOptional = 'speed_kmh' | 'incline_pct' | 'est_kcal'

/** 類型決定欄位：分鐘兩種都有（必填），其餘依類型。不屬於該類型的欄位一律存 null。 */
export const CARDIO_FIELDS: Readonly<Record<CardioKind, readonly CardioOptional[]>> = {
  incline_walk: ['speed_kmh', 'incline_pct'],
  boxing: ['est_kcal'],
}

/** 範圍與 DDL 的 check 一致（速度 DDL 是 >0，比 AC 12 的「0–40」嚴；照 DDL，不然伺服器會拒）。
 *  欄位都是 numeric(_,1)：超過一位小數 Postgres 會默默四捨五入，所以在這裡擋下來說清楚。 */
const CARDIO_RULES: Readonly<
  Record<'minutes' | CardioOptional, { label: string; min: number; minExclusive: boolean; max: number; range: string }>
> = {
  minutes: { label: '分鐘', min: 0, minExclusive: true, max: 1440, range: '大於 0、最多 1440' },
  speed_kmh: { label: '速度', min: 0, minExclusive: true, max: 40, range: '大於 0、最多 40 km/h' },
  incline_pct: { label: '坡度', min: 0, minExclusive: false, max: 40, range: '在 0–40% 之間' },
  est_kcal: { label: '預估熱量', min: 0, minExclusive: false, max: 10000, range: '在 0–10000 kcal 之間' },
}

export interface CardioDraft {
  kind: string
  minutes: string
  speed_kmh: string
  incline_pct: string
  est_kcal: string
}

export interface CardioValue {
  kind: CardioKind
  minutes: number
  speed_kmh: number | null
  incline_pct: number | null
  est_kcal: number | null
}

export type CardioCheck = { ok: true; value: CardioValue } | { ok: false; error: string }

const isCardioKind = (k: unknown): k is CardioKind => (CARDIO_KINDS as readonly string[]).includes(String(k))

/** 一個欄位的字串 → 數字。空白回 null（選填的「沒填」）；看不懂、超出範圍、超過一位小數回錯誤訊息。
 *  NFKC 讓全形數字與全形小數點也認得（手機中文鍵盤切出來的常是全形）。 */
function parseCardioField(field: keyof typeof CARDIO_RULES, raw: string): number | null | { error: string } {
  const s = raw.normalize('NFKC').trim()
  if (s === '') return null
  const rule = CARDIO_RULES[field]
  // 「30.」「.5」都是數字；小數位數不算尾端的 0（5.50 就是 5.5）
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return { error: `${rule.label}要填數字` }
  if ((s.split('.')[1] ?? '').replace(/0+$/, '').length > 1) return { error: `${rule.label}最多一位小數` }
  const n = Number(s)
  const tooLow = rule.minExclusive ? n <= rule.min : n < rule.min
  if (tooLow || n > rule.max) return { error: `${rule.label}要${rule.range}` }
  return n
}

/** 表單送出前的檢查（AC 12：範圍外要擋並說明，不靜默截斷）。 */
export function checkCardio(draft: CardioDraft): CardioCheck {
  if (!isCardioKind(draft.kind)) return { ok: false, error: '請選有氧類型' }
  const minutes = parseCardioField('minutes', draft.minutes)
  if (minutes === null) return { ok: false, error: '分鐘要填' }
  if (typeof minutes === 'object') return { ok: false, error: minutes.error }
  const value: CardioValue = { kind: draft.kind, minutes, speed_kmh: null, incline_pct: null, est_kcal: null }
  for (const f of CARDIO_FIELDS[draft.kind]) {
    const v = parseCardioField(f, draft[f])
    if (v !== null && typeof v === 'object') return { ok: false, error: v.error }
    value[f] = v
  }
  return { ok: true, value }
}

/** 數字欄 → 表單字串（編輯既有那筆時的初始值）。 */
const draftNum = (v: unknown): string => (v === null || v === undefined || v === '' ? '' : String(Number(v)))

/** 一筆既有的有氧 → 編輯表單的草稿；null＝新增，預設跑步機坡度健走。
 *  不認得的類型原樣保留：退成「走路」的話，什麼都沒改按儲存也會把那筆改成走路、清掉它的欄位；
 *  保留下來，checkCardio 會擋下來要使用者自己選。 */
export function cardioDraft(row: Row | null): CardioDraft {
  return {
    kind: row ? String(row.kind) : 'incline_walk',
    minutes: draftNum(row?.minutes),
    speed_kmh: draftNum(row?.speed_kmh),
    incline_pct: draftNum(row?.incline_pct),
    est_kcal: draftNum(row?.est_kcal),
  }
}

/** 新增一筆有氧，記在畫面選的那一天。不帶 user_id（伺服器 default auth.uid()）。 */
export function createCardioOps(args: { id: string; date: string; value: CardioValue }): RowOp[] {
  const { id, date, value } = args
  return [{ op: 'insert', table: 'cardio_sessions', rowId: id, payload: { performed_on: date, ...value } }]
}

/** 只帶有變的欄位；全沒變回空陣列。換類型時舊類型的欄位會一起變成 null（checkCardio 已經清掉）。 */
export function updateCardioOps(args: { current: Row; value: CardioValue }): RowOp[] {
  const { current, value } = args
  const payload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const cur = current[k] === undefined || current[k] === '' ? null : current[k]
    // 不能直接 Number(cur)：Number(null) 是 0，「沒填 → 填 0」會被當成沒變
    const same = v === null || cur === null ? v === cur : k === 'kind' ? cur === v : Number(cur) === v
    if (!same) payload[k] = v
  }
  return Object.keys(payload).length === 0 ? [] : [{ op: 'update', table: 'cardio_sessions', rowId: current.id, payload }]
}

export function deleteCardioOps(id: string): RowOp[] {
  return [{ op: 'delete', table: 'cardio_sessions', rowId: id }]
}

/** 列表上那一筆的名稱：認得的類型顯示中文；不認得（未來的類型、資料異常）原樣顯示，不藏起來。 */
export const cardioLabel = (row: Row): string => (isCardioKind(row.kind) ? CARDIO_KIND_LABEL[row.kind] : String(row.kind))

/** 「30 分 · 5.5 km/h · 坡度 8%」／「36 分 · 預估 121 kcal」。只列有填的欄位；預估熱量不稱「消耗」（AC 11）。 */
export function cardioSummary(row: Row): string {
  const has = (v: unknown) => v !== null && v !== undefined && v !== ''
  const parts = [`${Number(row.minutes)} 分`]
  if (has(row.speed_kmh)) parts.push(`${Number(row.speed_kmh)} km/h`)
  if (has(row.incline_pct)) parts.push(`坡度 ${Number(row.incline_pct)}%`)
  if (has(row.est_kcal)) parts.push(`預估 ${Number(row.est_kcal).toLocaleString('en-US')} kcal`)
  return parts.join(' · ')
}

/** 某一天的有氧，依建立時間排。剛記、還在佇列裡的那筆沒有 created_at（伺服器才給），排在最後——
 *  它就是最新的。同樣沒有的維持原順序（佇列重放的順序＝記的順序）。 */
export function cardioOn(db: TrainingDb, date: string): Row[] {
  const at = (r: Row) => (typeof r.created_at === 'string' ? r.created_at : null)
  return db.cardio_sessions
    .filter((c) => c.performed_on === date)
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = at(a.row)
      const y = at(b.row)
      if (x !== null && y !== null) return x.localeCompare(y) || a.i - b.i
      if (x === null && y === null) return a.i - b.i
      return x === null ? 1 : -1
    })
    .map(({ row }) => row)
}

export interface ExerciseFilter {
  q: string
  group: MuscleGroup | 'all'
}

/** 認得的肌群回它在七類裡的位置；資料異常（不在七類）歸「其他」，才不會被篩選藏起來。 */
const groupOf = (e: Row): MuscleGroup =>
  (MUSCLE_GROUPS as readonly string[]).includes(String(e.muscle_group)) ? (e.muscle_group as MuscleGroup) : 'other'

/** 搜尋名稱＋肌群條件，依肌群順序再依名稱排。動作庫頁與加動作 sheet 共用。 */
export function filterExercises(exercises: readonly Row[], filter: ExerciseFilter): Row[] {
  const needle = filter.q.trim().toLowerCase()
  return exercises
    .filter((e) => (filter.group === 'all' || groupOf(e) === filter.group) && (needle === '' || String(e.name).toLowerCase().includes(needle)))
    .sort(
      (a, b) =>
        MUSCLE_GROUPS.indexOf(groupOf(a)) - MUSCLE_GROUPS.indexOf(groupOf(b)) ||
        String(a.name).localeCompare(String(b.name), 'zh-Hant'),
    )
}
