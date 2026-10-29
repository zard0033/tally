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
}

/** 一列 insert／update 的 payload 該帶哪些 `parents`（佇列的父列依賴，AC 16）。
 *  每次 enqueue 都經過它，才不會有人漏填而讓子列搶在父列之前送出。 */
export function parentRefs(table: TrainingTable, payload: Readonly<Record<string, unknown>>): RowRef[] {
  return FOREIGN_KEYS[table].flatMap(({ column, parent, onDelete }) => {
    const v = payload[column]
    return typeof v === 'string' ? [{ table: parent, rowId: v, column, onDelete }] : []
  })
}

/** 未同步清單裡一條的白話標籤。只講「做了什麼」，不帶 rowId（使用者認不得 UUID）；
 *  表不在清單內（佇列格式是別版寫的）回保底「變更」。 */
const ENTRY_LABEL: Readonly<Record<TrainingTable, Readonly<Record<QueueEntry['op'], string>>>> = {
  exercises: { insert: '新增動作', update: '改動作', delete: '刪動作' },
  routines: { insert: '新增課表', update: '改課表', delete: '刪課表' },
  workouts: { insert: '新增訓練', update: '改訓練', delete: '刪訓練' },
  routine_exercises: { insert: '課表加動作', update: '改課表的動作', delete: '課表移除動作' },
  workout_exercises: { insert: '訓練加動作', update: '改訓練的動作', delete: '訓練移除動作' },
  workout_sets: { insert: '記一組', update: '改一組', delete: '刪一組' },
}

export function describeEntry(entry: Pick<QueueEntry, 'op' | 'table'>): string {
  return isTrainingTable(entry.table) ? ENTRY_LABEL[entry.table][entry.op] : '變更'
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

export interface CompletedSession {
  readonly workoutId: string
  /** 該次該動作已打勾的組，依 set_no 排 */
  readonly sets: PrefillSet[]
}

/** 該動作有已打勾組的各次訓練，由新到舊（同一次訓練的同動作出現兩個 entry 時各算一筆）。 */
export function completedSessions(db: TrainingDb, exerciseId: string, excludeWorkoutId?: string): CompletedSession[] {
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

  return candidates.map((c) => ({
    workoutId: c.workout.id,
    sets: [...c.done]
      .sort(
        (a, b) =>
          Number(a.set_no) - Number(b.set_no) ||
          String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
      )
      .map((s) => ({ weight_kg: Number(s.weight_kg), reps: Number(s.reps) })),
  }))
}

/** 該動作「上次實際完成」的各組：最近一次有打勾組的訓練裡，那個動作已打勾的組，依 set_no 排。
 *  - 沒打勾的組不算「完成」，整次都沒打勾的訓練跳過、改看更早一次。
 *  - `excludeWorkoutId`：進行中的這一次不能是自己的「上次」。
 *  吃的是已疊上佇列的 db，所以離線剛記完的訓練也算。 */
export function lastCompletedSets(db: TrainingDb, exerciseId: string, excludeWorkoutId?: string): PrefillSet[] {
  return completedSessions(db, exerciseId, excludeWorkoutId)[0]?.sets ?? []
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

/** 有訓練的日子，給日期元件的小點用。有氧併入動作後只看 workouts（只有一張有氧卡的訓練也是一次訓練）。 */
export function trainingDates(db: TrainingDb): Set<string> {
  const out = new Set<string>()
  for (const w of db.workouts) if (typeof w.performed_on === 'string') out.add(w.performed_on)
  return out
}

export interface WorkoutCard extends WorkoutSummary {
  readonly id: string
  readonly startedAt: string
  /** null＝進行中（App 重開後仍在，畫面提示可繼續，AC 9）。 */
  readonly endedAt: string | null
  readonly inProgress: boolean
  readonly exerciseCount: number
  /** 這次訓練只有一張有氧卡（spec「有氧併入動作」AC 9：舊的單筆有氧搬過來、或單獨記一筆有氧）：列表以動作名稱與
   *  有氧摘要列出，不寫「1 個動作 · 0/0 組 · 0 kg」。summary 是 `cardioSummary`，還沒填分鐘是空字串。其他情形 null。 */
  readonly soloCardio: { readonly name: string; readonly summary: string } | null
}

/** 某一天的訓練，依開始時間由早到晚。一天可以有多次（AC 9）。 */
export function workoutsOn(db: TrainingDb, date: string, now: Date): WorkoutCard[] {
  const exerciseById = new Map(db.exercises.map((e) => [e.id, e]))
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
      const only = exercises.length === 1 ? exerciseById.get(String(exercises[0].exercise_id)) : undefined
      return {
        ...summary,
        id: w.id,
        startedAt: String(w.started_at),
        endedAt,
        inProgress: endedAt === null,
        exerciseCount: exercises.length,
        soloCardio: only && isCardioExercise(only) ? { name: String(only.name), summary: cardioSummary(exercises[0]) } : null,
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
  /** insert 專用：id 已存在就不動它（upsert 的 ignoreDuplicates）。預填與補齊預設動作用，離線時不能蓋掉伺服器上被改過的列。 */
  ignoreDuplicates?: boolean
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
export function startWorkoutOps(args: { workoutId: string; date: string; now: Date; routineId?: string }): RowOp[] {
  const { workoutId, date, now, routineId } = args
  const live = date === localDate(now)
  const startedAt = live ? now.toISOString() : backfillTimes(date, null).started_at
  return [
    {
      op: 'insert',
      table: 'workouts',
      rowId: workoutId,
      payload: { performed_on: date, started_at: startedAt, ended_at: null, routine_id: routineId ?? null },
    },
  ]
}

/** 把一個動作加進這次訓練：一列 workout_exercises ＋ 預填的各組（有歷史就取上次實際完成的值）。
 *  有氧動作（spec「有氧併入動作」D1）只有那一列、沒有任何組，有氧欄位預填上次的值、分鐘留空（`cardioPrefill`），`target` 不用。
 *  動作是不是有氧看 db.exercises 的那列；找不到那列（本機底還沒載到）當重訓——沒有資訊可判。 */
export function addExerciseOps(args: {
  db: TrainingDb
  workoutId: string
  exerciseId: string
  newId: () => string
  target?: PrefillTarget
  /** 一口氣加好幾個動作時由呼叫端指定：db 還看不到前面幾個，自己算會全部撞在同一個位置。 */
  position?: number
}): RowOp[] {
  const { db, workoutId, exerciseId, newId, target } = args
  const taken = db.workout_exercises.filter((we) => we.workout_id === workoutId).map((we) => Number(we.position))
  const position = args.position ?? (taken.length === 0 ? 0 : Math.max(...taken) + 1)
  const entryId = newId()
  const kind = exerciseKind(db.exercises.find((e) => e.id === exerciseId))
  if (kind !== 'strength') {
    return [
      {
        op: 'insert',
        table: 'workout_exercises',
        rowId: entryId,
        payload: { workout_id: workoutId, exercise_id: exerciseId, position, ...cardioPrefill(db, exerciseId, kind, workoutId) },
      },
    ]
  }
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

/** 把這次訓練裡的某個動作換成另一個：先刪舊的 `workout_exercises` 列（組由 cascade 帶走），
 *  新的插在舊的 position，卡片不跑位。新動作的組用**它自己**的歷史預填，不沿用舊動作的重量。
 *  新列的 id 在回傳陣列的第二筆（`ops[1].rowId`），第一筆是刪除。 */
export function replaceExerciseOps(args: {
  db: TrainingDb
  workoutId: string
  entry: Row
  exerciseId: string
  newId: () => string
}): RowOp[] {
  const { db, workoutId, entry, exerciseId, newId } = args
  return [
    { op: 'delete', table: 'workout_exercises', rowId: entry.id },
    ...addExerciseOps({ db, workoutId, exerciseId, newId, position: Number(entry.position) }),
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

const findSet = (detail: WorkoutDetail, setId: string) => {
  for (const ex of detail.exercises) {
    const index = ex.sets.findIndex((s) => s.id === setId)
    if (index >= 0) return { ex, index }
  }
  return null
}

/** 同一個動作裡排在這一組後面、還沒打勾的組（「同步剩餘組數」要套到哪些、按鈕上的 N 是多少）。找不到這一組回空陣列。 */
export function remainingSetsAfter(detail: WorkoutDetail, setId: string): Row[] {
  const found = findSet(detail, setId)
  return found ? found.ex.sets.slice(found.index + 1).filter((s) => s.done !== true) : []
}

/** 把這一組的重量與次數套到後面所有還沒打勾的組；已打勾的不動、值本來就一樣的不寫。 */
export function syncSetsForwardOps(detail: WorkoutDetail, setId: string): RowOp[] {
  const source = findSet(detail, setId)?.ex.sets.find((s) => s.id === setId)
  if (!source) return []
  const weight = Number(source.weight_kg)
  const reps = Number(source.reps)
  return remainingSetsAfter(detail, setId).flatMap((s): RowOp[] => {
    const payload: Record<string, unknown> = {}
    if (Number(s.weight_kg) !== weight) payload.weight_kg = weight
    if (Number(s.reps) !== reps) payload.reps = reps
    return Object.keys(payload).length === 0 ? [] : [{ op: 'update', table: 'workout_sets', rowId: s.id, payload }]
  })
}

/** 欄頭雙勾的狀態：有組、而且每一組都打勾了才算「全部完成」。 */
export const allSetsDone = (sets: readonly Row[]): boolean => sets.length > 0 && sets.every((s) => s.done === true)

/** 欄頭雙勾按下去：還有沒打勾的就全部打勾；已經全勾就全部取消。一次回傳，呼叫端一次寫進佇列。 */
export function toggleAllDoneOps(detail: WorkoutDetail, workoutExerciseId: string): RowOp[] {
  const sets = detail.exercises.find((e) => e.entry.id === workoutExerciseId)?.sets ?? []
  const target = !allSetsDone(sets)
  return sets.flatMap((s): RowOp[] =>
    (s.done === true) === target ? [] : [{ op: 'update', table: 'workout_sets', rowId: s.id, payload: { done: target } }],
  )
}

/** 刪一組：單筆 delete。不重排 set_no（畫面的組號本來就用序號，`addSetOps` 取 max+1）。
 *  只剩一組、或找不到時回空陣列——要拿掉整個動作走「移除這個動作」。 */
export function removeSetOps(detail: WorkoutDetail, setId: string): RowOp[] {
  const found = findSet(detail, setId)
  if (!found || found.ex.sets.length <= 1) return []
  return [{ op: 'delete', table: 'workout_sets', rowId: setId }]
}

/* ═══════════ RPE（spec.md「階段 4 乙」） ═══════════ */

/** 休息條問「最後一組還能再做幾下」的四檔，對應 RPE ＝ 10 − 剩餘下數（3 下以上全歸 7）。 */
export const RPE_CHIPS = [
  { rpe: 7, label: '3 下以上' },
  { rpe: 8, label: '2 下' },
  { rpe: 9, label: '1 下' },
  { rpe: 10, label: '力竭' },
] as const

/** 組編輯 sheet 的五格；6 只有這裡有（休息條只問有沒有逼近極限）。DDL 的 check 是 5–10。 */
export const RPE_SHEET_VALUES = [6, 7, 8, 9, 10] as const

/** 勾完 setId 這一組之後，這個動作還有沒有未完成的組。沒有＝這個動作做完了（休息條該問 RPE）。找不到這組回 false。 */
export function completesExercise(sets: readonly Row[], setId: string): boolean {
  return sets.some((s) => s.id === setId) && sets.every((s) => s.id === setId || s.done === true)
}

/** 一個動作在訓練清單上的 RPE 狀態：做完了（每一組都打勾）才談得上填沒填；rpe 是**最後一組**的值，沒填＝null。
 *  （階段 4 丙／v2.105：RPE 是每組各一個，這裡只回休息條關心的那一組；原本取各組最大值，會讓別組的值冒充最後一組。） */
export function exerciseRpe(sets: readonly Row[]): { complete: boolean; rpe: number | null } {
  const complete = sets.length > 0 && sets.every((s) => s.done === true)
  const last = sets.at(-1)
  const n = last?.rpe == null ? NaN : Number(last.rpe)
  return { complete, rpe: Number.isFinite(n) ? n : null }
}

/** 休息條的快捷入口：只寫**最後一組**的 RPE，其他組不動（v2.105 起；原本會把其他組的 RPE 清成 null）。
 *  每組各自的 RPE 在組編輯 sheet 改，走 setRpeOps。 */
export function setExerciseRpeOps(sets: readonly Row[], rpe: number): RowOp[] {
  const last = sets.at(-1)
  return last ? setRpeOps(last.id, rpe) : []
}

/** 寫一組的 RPE；null＝清掉（回到沒填）。 */
export function setRpeOps(setId: string, rpe: number | null): RowOp[] {
  return [{ op: 'update', table: 'workout_sets', rowId: setId, payload: { rpe } }]
}

/** 收合列要看的進度：做完幾組、共幾組、下一組（第一個還沒打勾的）。全部做完 next＝null。 */
export function exerciseProgress(sets: readonly Row[]): {
  done: number
  total: number
  next: { weight: number; reps: number } | null
} {
  const next = sets.find((s) => s.done !== true)
  return {
    done: sets.filter((s) => s.done === true).length,
    total: sets.length,
    next: next ? { weight: Number(next.weight_kg), reps: Number(next.reps) } : null,
  }
}

/** 訓練中拖曳排序的結果 → 只更新位置有變的 workout_exercises。與課表那支同樣嚴格：對不上就丟錯。 */
export function reorderWorkoutExercisesOps(args: { entries: readonly Row[]; orderedIds: readonly string[] }): RowOp[] {
  const { entries, orderedIds } = args
  const known = new Map(entries.map((e) => [e.id, e]))
  if (new Set(orderedIds).size !== known.size || !orderedIds.every((id) => known.has(id))) {
    throw new Error('排序的項目與這次訓練現有的動作對不上')
  }
  return orderedIds.flatMap((id, i): RowOp[] =>
    Number(known.get(id)?.position) === i
      ? []
      : [{ op: 'update', table: 'workout_exercises', rowId: id, payload: { position: i } }],
  )
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
export const foldName = (s: unknown): string => String(s).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
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

/* ═══════════ 課表（AC 4、4a、4b） ═══════════ */

export const MAX_TARGET_SETS = 20
export const MAX_TARGET_REPS = 999

const byPositionAsc = (a: Row, b: Row) => Number(a.position) - Number(b.position)

/** 可為 null 的數字欄（伺服器回 null；佇列疊上的列可能整欄缺）。 */
const optNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** 建立時間由早到晚；剛記、還在佇列裡的沒有 created_at（伺服器才給），排最後——它就是最新的。 */
const byCreatedAsc = (a: Row, b: Row) => {
  const x = typeof a.created_at === 'string' ? a.created_at : null
  const y = typeof b.created_at === 'string' ? b.created_at : null
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
  return x.localeCompare(y)
}

export interface RoutineCard {
  readonly routine: Row
  readonly exerciseCount: number
  /** 最近一次照這份課表做的訓練日（YYYY-MM-DD）；沒做過是 null。 */
  readonly lastUsed: string | null
}

/** 課表列表：使用中與已封存分開，各依建立順序。 */
export function routineList(db: TrainingDb): { active: RoutineCard[]; archived: RoutineCard[] } {
  const counts = new Map<string, number>()
  for (const re of db.routine_exercises) {
    const key = String(re.routine_id)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const lastUsed = new Map<string, string>()
  for (const w of db.workouts) {
    if (typeof w.routine_id !== 'string' || typeof w.performed_on !== 'string') continue
    const seen = lastUsed.get(w.routine_id)
    if (seen === undefined || w.performed_on > seen) lastUsed.set(w.routine_id, w.performed_on)
  }
  const cards = [...db.routines].sort(byCreatedAsc).map(
    (routine): RoutineCard => ({
      routine,
      exerciseCount: counts.get(routine.id) ?? 0,
      lastUsed: lastUsed.get(routine.id) ?? null,
    }),
  )
  return {
    active: cards.filter((c) => c.routine.archived !== true),
    archived: cards.filter((c) => c.routine.archived === true),
  }
}

export interface RoutineExerciseDetail {
  /** routine_exercises 那一列（含 target_sets／target_reps）。 */
  readonly entry: Row
  /** 動作庫那一列；底還沒載到時是 null，畫面要有退路。 */
  readonly exercise: Row | null
}

export interface RoutineDetail {
  readonly routine: Row
  /** 依 position 排好。 */
  readonly exercises: readonly RoutineExerciseDetail[]
}

export function routineDetail(db: TrainingDb, routineId: string): RoutineDetail | null {
  const routine = db.routines.find((r) => r.id === routineId)
  if (!routine) return null
  const exerciseById = new Map(db.exercises.map((e) => [e.id, e]))
  const exercises = db.routine_exercises
    .filter((re) => re.routine_id === routineId)
    .sort(byPositionAsc)
    .map((entry) => ({ entry, exercise: exerciseById.get(String(entry.exercise_id)) ?? null }))
  return { routine, exercises }
}

export type RoutineNameCheck = { ok: true; name: string } | { ok: false; error: string }

/** 名稱不能空（DDL 有 btrim 檢查，擋在這裡才說得出白話）。不查重複：複製出來的「原名稱 複本」本來就會撞第二次。 */
export function checkRoutineName(name: string): RoutineNameCheck {
  const trimmed = name.trim()
  return trimmed === '' ? { ok: false, error: '名稱不能是空的' } : { ok: true, name: trimmed }
}

export interface RoutineTargetDraft {
  sets: string
  reps: string
}

export interface RoutineTarget {
  target_sets: number
  target_reps: number | null
}

export type RoutineTargetCheck = { ok: true; value: RoutineTarget } | { ok: false; error: string }

const parseWholeNumber = (raw: string): number | null => {
  const s = raw.normalize('NFKC').trim()
  return /^\d+$/.test(s) ? Number(s) : null
}

/** 範圍與 DDL 一致（組數 1–20 必填、次數 1–999 選填）。次數空白＝沒設，存 null。 */
export function checkRoutineTarget(draft: RoutineTargetDraft): RoutineTargetCheck {
  const sets = parseWholeNumber(draft.sets)
  if (sets === null || sets < 1 || sets > MAX_TARGET_SETS) {
    return { ok: false, error: `組數要是 1–${MAX_TARGET_SETS} 的整數` }
  }
  if (draft.reps.trim() === '') return { ok: true, value: { target_sets: sets, target_reps: null } }
  const reps = parseWholeNumber(draft.reps)
  if (reps === null || reps < 1 || reps > MAX_TARGET_REPS) {
    return { ok: false, error: `次數要是 1–${MAX_TARGET_REPS} 的整數，或留空` }
  }
  return { ok: true, value: { target_sets: sets, target_reps: reps } }
}

export function createRoutineOps(args: { id: string; name: string }): RowOp[] {
  return [{ op: 'insert', table: 'routines', rowId: args.id, payload: { name: args.name, archived: false } }]
}

/** 名稱沒變回空陣列（不排一筆空的 PATCH 進佇列）。 */
export function renameRoutineOps(args: { current: Row; name: string }): RowOp[] {
  const { current, name } = args
  return String(current.name) === name ? [] : [{ op: 'update', table: 'routines', rowId: current.id, payload: { name } }]
}

/** 封存／取消封存。不提供真刪（同動作庫）；已經用過的課表，歷史上的 routine_id 才不會斷。 */
export function setRoutineArchivedOps(args: { id: string; archived: boolean }): RowOp[] {
  return [{ op: 'update', table: 'routines', rowId: args.id, payload: { archived: args.archived } }]
}

/** 把一個動作加到課表尾端。沒給 target 就用預設 3 組、次數不設。 */
export function addRoutineExerciseOps(args: {
  db: TrainingDb
  routineId: string
  exerciseId: string
  newId: () => string
  target?: RoutineTarget
}): RowOp[] {
  const { db, routineId, exerciseId, newId, target } = args
  const taken = db.routine_exercises.filter((re) => re.routine_id === routineId).map((re) => Number(re.position))
  return [
    {
      op: 'insert',
      table: 'routine_exercises',
      rowId: newId(),
      payload: {
        routine_id: routineId,
        exercise_id: exerciseId,
        position: taken.length === 0 ? 0 : Math.max(...taken) + 1,
        target_sets: target?.target_sets ?? DEFAULT_TARGET_SETS,
        target_reps: target?.target_reps ?? null,
      },
    },
  ]
}

/** 課表動作列的副標：預設組次只在該動作從沒做過時才用，要講清楚免得誤會成「每次都這樣」。 */
export function formatRoutineTarget(entry: Row): string {
  const reps = optNum(entry.target_reps)
  return `沒做過時預設 ${Number(entry.target_sets)} 組${reps === null ? '' : ` × ${reps}`}`
}

/** 只帶有變的欄位；全沒變回空陣列。 */
export function updateRoutineExerciseTargetOps(args: { current: Row; value: RoutineTarget }): RowOp[] {
  const { current, value } = args
  const payload: Record<string, unknown> = {}
  if (Number(current.target_sets) !== value.target_sets) payload.target_sets = value.target_sets
  if (optNum(current.target_reps) !== value.target_reps) payload.target_reps = value.target_reps
  return Object.keys(payload).length === 0 ? [] : [{ op: 'update', table: 'routine_exercises', rowId: current.id, payload }]
}

export function removeRoutineExerciseOps(id: string): RowOp[] {
  return [{ op: 'delete', table: 'routine_exercises', rowId: id }]
}

/** 拖曳排序的結果 → 只更新位置有變的列。`orderedIds` 必須正好是這份課表現有的那些列（順序不同而已）；
 *  對不上代表畫面與資料已經分岔，丟錯而不是默默排出一份缺漏的課表。 */
export function reorderRoutineExercisesOps(args: { entries: readonly Row[]; orderedIds: readonly string[] }): RowOp[] {
  const { entries, orderedIds } = args
  const known = new Map(entries.map((e) => [e.id, e]))
  if (new Set(orderedIds).size !== known.size || !orderedIds.every((id) => known.has(id))) {
    throw new Error('排序的項目與課表現有的動作對不上')
  }
  return orderedIds.flatMap((id, i): RowOp[] =>
    Number(known.get(id)?.position) === i
      ? []
      : [{ op: 'update', table: 'routine_exercises', rowId: id, payload: { position: i } }],
  )
}

/** 複製課表：只複製結構（動作、順序、預設組次），名稱預設「原名稱 複本」。找不到來源回空陣列。 */
export function copyRoutineOps(args: { db: TrainingDb; routineId: string; newId: () => string; name?: string }): RowOp[] {
  const { db, routineId, newId } = args
  const source = routineDetail(db, routineId)
  if (!source) return []
  const copyId = newId()
  return [
    ...createRoutineOps({ id: copyId, name: args.name ?? `${String(source.routine.name)} 複本` }),
    ...source.exercises.map(
      ({ entry }, i): RowOp => ({
        op: 'insert',
        table: 'routine_exercises',
        rowId: newId(),
        payload: {
          routine_id: copyId,
          exercise_id: entry.exercise_id,
          position: i,
          target_sets: entry.target_sets,
          target_reps: entry.target_reps ?? null,
        },
      }),
    ),
  ]
}

/** 把一次訓練存成課表：帶入動作與順序，組數＝當時有幾組、次數＝第一組的次數（各組不同時取第一組；0 次不設）。
 *  不帶重量（課表不存重量）。找不到這次訓練回空陣列。 */
export function routineFromWorkoutOps(args: { db: TrainingDb; workoutId: string; name: string; newId: () => string }): RowOp[] {
  const { db, workoutId, name, newId } = args
  const detail = workoutDetail(db, workoutId)
  if (!detail) return []
  const routineId = newId()
  return [
    ...createRoutineOps({ id: routineId, name }),
    ...detail.exercises.map(({ entry, sets }, i): RowOp => {
      const reps = sets.length > 0 ? Number(sets[0].reps) : 0
      return {
        op: 'insert',
        table: 'routine_exercises',
        rowId: newId(),
        payload: {
          routine_id: routineId,
          exercise_id: entry.exercise_id,
          position: i,
          target_sets: sets.length === 0 ? DEFAULT_TARGET_SETS : Math.min(MAX_TARGET_SETS, sets.length),
          target_reps: reps >= 1 ? Math.min(MAX_TARGET_REPS, reps) : null,
        },
      }
    }),
  ]
}

/** 照課表開始一次訓練：訓練記下 routine_id（AC 4b），課表的動作依序帶入，各組一律預填上次實際完成的值，
 *  沒歷史才用課表的預設組次（addExerciseOps → prefillSets）。有氧動作帶出一張有氧卡、欄位預填上次的值，
 *  課表的 target_sets／target_reps 對它沒意義、不用。找不到課表回空陣列，不悄悄變成空白開始。 */
export function startWorkoutFromRoutineOps(args: {
  db: TrainingDb
  routineId: string
  workoutId: string
  date: string
  now: Date
  newId: () => string
}): RowOp[] {
  const { db, routineId, workoutId, date, now, newId } = args
  const routine = routineDetail(db, routineId)
  if (!routine) return []
  return [
    ...startWorkoutOps({ workoutId, date, now, routineId }),
    ...routine.exercises.flatMap(({ entry }, position) =>
      addExerciseOps({
        db,
        workoutId,
        exerciseId: String(entry.exercise_id),
        newId,
        position,
        target: { target_sets: Number(entry.target_sets), target_reps: optNum(entry.target_reps) },
      }),
    ),
  ]
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

/* ─── 有氧併入動作（spec「有氧併入動作」D1、D2）：動作庫的 kind 決定這個動作是不是有氧，
       有氧欄位放在 workout_exercises 那一列（一張有氧卡＝一列，沒有組）。 ─── */

/** 動作的類型。DDL 是 `exercises.kind text not null default 'strength'`。 */
export type ExerciseKind = 'strength' | CardioKind

/** 動作庫那一列的類型：kind 是 CARDIO_KINDS 之一才算有氧，其他一律當重訓——欄位缺（舊快取、還沒跑 DDL）、
 *  不認得的值、找不到那列都一樣。寧可把怪資料當重訓（多出幾組可刪），也不讓它變成沒有組、也填不了的卡。 */
export function exerciseKind(row: Row | null | undefined): ExerciseKind {
  return row && isCardioKind(row.kind) ? row.kind : 'strength'
}

export const isCardioExercise = (row: Row | null | undefined): boolean => exerciseKind(row) !== 'strength'

/** 這張有氧卡記了沒（D5：有氧卡沒有勾，分鐘有值＝有記錄）。 */
export const cardioRecorded = (entry: Row): boolean => entry.minutes !== null && entry.minutes !== undefined && entry.minutes !== ''

/** workout_exercises 上的四個有氧欄位（類型在動作上，不在這一列）。 */
export interface CardioFields {
  minutes: number | null
  speed_kmh: number | null
  incline_pct: number | null
  est_kcal: number | null
}

/** 這個動作「上次」那張有記錄的有氧卡。「上次」的規則同 prefillSets（completedSessions）：排除進行中的這一次、
 *  依 performed_on → started_at → position 由新到舊取第一張；沒填分鐘的卡不算記錄，跳過往更早找（同「整次沒打勾就跳過」）；
 *  訓練已不在的孤兒卡不算。 */
function lastCardioEntry(db: TrainingDb, exerciseId: string, excludeWorkoutId?: string): Row | undefined {
  const workouts = new Map(db.workouts.map((w) => [w.id, w]))
  return db.workout_exercises
    .filter((we) => we.exercise_id === exerciseId && we.workout_id !== excludeWorkoutId && cardioRecorded(we))
    .flatMap((we) => {
      const workout = workouts.get(String(we.workout_id))
      return workout ? [{ we, workout }] : []
    })
    .sort(
      (a, b) =>
        String(b.workout.performed_on).localeCompare(String(a.workout.performed_on)) ||
        startedMs(b.workout) - startedMs(a.workout) ||
        Number(b.we.position) - Number(a.we.position),
    )[0]?.we
}

/** 加有氧動作時預填的欄位：上次那張有記錄的有氧卡（`lastCardioEntry`）的速度／坡度／預估熱量。
 *  **分鐘一律 null**（使用者 2026-10-22 裁決）：有氧卡沒有勾，D5「分鐘有值＝有記錄」——分鐘也預填的話，帶出來那天沒做，
 *  結束訓練就留下一筆假記錄，下次又被當成「上次」往下傳。上次的分鐘改由 `cardioLastMinutes` 給有氧 sheet 當提示。
 *  不屬於該類型的欄位一律 null；沒有歷史就四個都是 null。四個鍵永遠都在。 */
export function cardioPrefill(db: TrainingDb, exerciseId: string, kind: CardioKind, excludeWorkoutId?: string): CardioFields {
  const last = lastCardioEntry(db, exerciseId, excludeWorkoutId)
  const out: CardioFields = { minutes: null, speed_kmh: null, incline_pct: null, est_kcal: null }
  for (const f of CARDIO_FIELDS[kind]) out[f] = optNum(last?.[f] === '' ? null : last?.[f])
  return out
}

/** 上次那張有記錄的有氧卡的分鐘（有氧 sheet 分鐘欄的「上次 N」提示）；沒有歷史回 null。挑法同 cardioPrefill。 */
export function cardioLastMinutes(db: TrainingDb, exerciseId: string, excludeWorkoutId?: string): number | null {
  return optNum(lastCardioEntry(db, exerciseId, excludeWorkoutId)?.minutes)
}

/** 一張有氧卡 → 有氧 sheet 的草稿。類型取自動作（`exerciseKind`）：動作找不到或不是有氧時 kind 是 'strength'，
 *  checkCardio 會擋下來——那不是能填有氧的卡。 */
export function cardioEntryDraft(entry: Row, exercise: Row | null): CardioDraft {
  return {
    kind: exerciseKind(exercise),
    minutes: draftNum(entry.minutes),
    speed_kmh: draftNum(entry.speed_kmh),
    incline_pct: draftNum(entry.incline_pct),
    est_kcal: draftNum(entry.est_kcal),
  }
}

/** 有氧卡存檔：只帶有變的欄位、全沒變回空陣列；**不帶 kind**——workout_exercises 沒有這欄，
 *  帶了 PostgREST 會整筆拒絕。 */
export function updateCardioEntryOps(args: { current: Row; value: CardioValue }): RowOp[] {
  const { current, value } = args
  const { minutes, speed_kmh, incline_pct, est_kcal } = value
  const payload = changedCardioFields(current, { minutes, speed_kmh, incline_pct, est_kcal })
  return Object.keys(payload).length === 0 ? [] : [{ op: 'update', table: 'workout_exercises', rowId: current.id, payload }]
}

/** 有氧欄位與現有那列比，回傳有變的。 */
function changedCardioFields(current: Row, value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const cur = current[k] === undefined || current[k] === '' ? null : current[k]
    // 不能直接 Number(cur)：Number(null) 是 0，「沒填 → 填 0」會被當成沒變
    const same = v === null || cur === null ? v === cur : Number(cur) === v
    if (!same) payload[k] = v
  }
  return payload
}

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

/** 一張有氧卡（workout_exercises）的摘要：「30 分 · 5.5 km/h · 坡度 8%」／「36 分 · 預估 121 kcal」。只列有填的欄位；
 *  預估熱量不稱「消耗」（AC 11）。還沒填分鐘回空字串（不然 Number(null) 會寫成「0 分」），畫面看到空字串顯示「點一下填寫」。 */
export function cardioSummary(row: Row): string {
  const has = (v: unknown) => v !== null && v !== undefined && v !== ''
  if (!cardioRecorded(row)) return ''
  const parts = [`${Number(row.minutes)} 分`]
  if (has(row.speed_kmh)) parts.push(`${Number(row.speed_kmh)} km/h`)
  if (has(row.incline_pct)) parts.push(`坡度 ${Number(row.incline_pct)}%`)
  if (has(row.est_kcal)) parts.push(`預估 ${Number(row.est_kcal).toLocaleString('en-US')} kcal`)
  return parts.join(' · ')
}

export interface ExerciseFilter {
  q: string
  group: MuscleGroup | 'all'
}

/** 認得的肌群回它在七類裡的位置；資料異常（不在七類）歸「其他」，才不會被篩選藏起來。 */
export const groupOf = (e: Row): MuscleGroup =>
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
