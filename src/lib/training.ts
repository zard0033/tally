/* 訓練記錄的純邏輯（階段 2，spec.md「階段 2 spec」AC 1、5、7、8a、18、21）。
 *
 * 範圍：只有純函式，禁沾 DOM／supabase（這層未來要原樣帶去 React Native）。資料列的形狀照 DDL
 * （snake_case 欄位），讓佇列條目的 payload、伺服器回的列、畫面讀的列是同一個形狀、不必來回轉。
 * 接線（IndexedDB adapter、Supabase sender、App.tsx）不在這裡，等 UI 步驟。 */

import type { QueueEntry, RowRef } from './queue'
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
  /** 伺服器端是 on delete cascade：父列刪了，這一列跟著消失。restrict／set null 不是。 */
  readonly cascade: boolean
}

/** 與 DDL 逐條對應。`exercise_id` 是 restrict（動作不真刪、只封存），所以不級聯；
 *  `workouts.routine_id` 是 set null，同樣不級聯，但仍是「要等它先到」的父列。 */
const FOREIGN_KEYS: Readonly<Record<TrainingTable, readonly ForeignKey[]>> = {
  exercises: [],
  routines: [],
  workouts: [{ column: 'routine_id', parent: 'routines', cascade: false }],
  routine_exercises: [
    { column: 'routine_id', parent: 'routines', cascade: true },
    { column: 'exercise_id', parent: 'exercises', cascade: false },
  ],
  workout_exercises: [
    { column: 'workout_id', parent: 'workouts', cascade: true },
    { column: 'exercise_id', parent: 'exercises', cascade: false },
  ],
  workout_sets: [{ column: 'workout_exercise_id', parent: 'workout_exercises', cascade: true }],
  cardio_sessions: [],
}

/** 一列 insert／update 的 payload 該帶哪些 `parents`（佇列的父列依賴，AC 16）。
 *  每次 enqueue 都經過它，才不會有人漏填而讓子列搶在父列之前送出。 */
export function parentRefs(table: TrainingTable, payload: Readonly<Record<string, unknown>>): RowRef[] {
  return FOREIGN_KEYS[table].flatMap(({ column, parent }) => {
    const v = payload[column]
    return typeof v === 'string' ? [{ table: parent, rowId: v }] : []
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
      rows[t].set(e.rowId, { ...current, ...e.payload, id: e.rowId })
    } else if (current) {
      rows[t].set(e.rowId, { ...current, ...e.payload, id: e.rowId })
    }
  }

  for (const t of TRAINING_TABLES) {
    for (const fk of FOREIGN_KEYS[t]) {
      if (!fk.cascade || deleted[fk.parent].size === 0) continue
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
