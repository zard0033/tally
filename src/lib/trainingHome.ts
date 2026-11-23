/* 訓練分頁改版（spec.md「訓練分頁改版」）的純運算：首頁天空那一行的狀態、開始 sheet 的建議課表、
   「訓練中」小條要找的那一次、完成畫面的亮點與本週第幾次、訓練中即時的新紀錄。
   不沾 DOM；吃的是已疊上離線佇列的 TrainingDb。 */
import { localDate, monthDay, weekDates } from './dates'
import { recoveryStatus } from './recovery'
import { e1rm } from './strength'
import {
  cardioRecorded,
  exerciseDisplayName,
  groupOf,
  isBackfilled,
  isCardioExercise,
  MUSCLE_GROUP_LABEL,
  startedMs,
  workoutsOn,
  type MuscleGroup,
  type RoutineCard,
  type Row,
  type TrainingDb,
} from './training'

/* ═══════════ 首頁天空那一行 ═══════════ */

/** 即時進行中＝沒有結束、而且不是補記（補記不計時）。 */
const isLive = (w: Row, today: string): boolean => w.ended_at == null && !isBackfilled(w, today)

/** 全庫的即時進行中訓練；同時有多次（別台裝置各開一次）取最晚開始的。給「訓練中」小條。 */
export function liveWorkout(db: TrainingDb, today: string = localDate()): Row | null {
  let best: Row | null = null
  for (const w of db.workouts) if (isLive(w, today) && (best === null || startedMs(w) > startedMs(best))) best = w
  return best
}

export type DayTraining =
  | { readonly kind: 'live'; readonly workoutId: string; readonly startedAt: string }
  | { readonly kind: 'done'; readonly volume: number; readonly minutes: number; readonly doneSets: number; readonly count: number }
  | { readonly kind: 'idle-today' }
  | { readonly kind: 'idle-other' }

/** 這一天在天空那一行要講什麼。即時進行中優先；其次有紀錄就加總（重量、組數算全部，時長只算已結束的——
 *  補記中的那次起點是 12:00，用現在減會灌水）；都沒有就看是不是今天。 */
export function dayTraining(db: TrainingDb, date: string, now: Date): DayTraining {
  const today = localDate(now)
  const live = db.workouts
    .filter((w) => w.performed_on === date && isLive(w, today))
    .sort((a, b) => startedMs(b) - startedMs(a))[0]
  if (live) return { kind: 'live', workoutId: live.id, startedAt: String(live.started_at) }
  const cards = workoutsOn(db, date, now)
  if (cards.length > 0) {
    const centis = cards.reduce((s, c) => s + Math.round(c.volume * 100), 0)
    return {
      kind: 'done',
      volume: centis / 100,
      minutes: cards.filter((c) => !c.inProgress).reduce((s, c) => s + c.minutes, 0),
      doneSets: cards.reduce((s, c) => s + c.doneSets, 0),
      count: cards.length,
    }
  }
  return date === today ? { kind: 'idle-today' } : { kind: 'idle-other' }
}

/** 今天沒練時天空那一行（使用者 2026-11-23：「改放今天練什麼」，恢復是它的理由）。
 *  ready＝已恢復、練過的肌群，最久沒練的排前、最多兩個（天空大字 44px，三個會撞到太陽）；從沒練過的不列（每天都會冒出來，等於沒說）。
 *  recovering＝還在恢復的，剩下的天數（小時無條件進位成天）少的排前。全都沒練過＝null（畫面寫「今天還沒練」）。 */
export interface TodayFocus {
  readonly ready: readonly string[]
  readonly recovering: readonly { readonly label: string; readonly days: number }[]
}

export function todayFocus(db: TrainingDb, now: Date): TodayFocus | null {
  const rows = recoveryStatus(db, now)
  if (rows.every((r) => r.state === 'none')) return null
  const ready = rows
    .filter((r) => r.state === 'ready')
    .sort((a, b) => String(a.lastDate).localeCompare(String(b.lastDate)))
    .slice(0, 2)
    .map((r) => MUSCLE_GROUP_LABEL[r.group])
  const recovering = rows
    .filter((r) => r.state === 'recovering')
    .map((r) => ({ label: MUSCLE_GROUP_LABEL[r.group], days: Math.max(1, Math.ceil((r.remainingHours ?? 0) / 24)) }))
    .sort((a, b) => a.days - b.days)
  return { ready, recovering }
}

/* ═══════════ 開始 sheet 的建議課表 ═══════════ */

/** 一份課表練到的肌群（不含「其他」；有氧屬其他）。 */
function routineGroups(db: TrainingDb, routineId: string): Set<MuscleGroup> {
  const byId = new Map(db.exercises.map((e) => [e.id, e]))
  const out = new Set<MuscleGroup>()
  for (const re of db.routine_exercises) {
    if (re.routine_id !== routineId) continue
    const ex = byId.get(String(re.exercise_id))
    if (ex && groupOf(ex) !== 'other') out.add(groupOf(ex))
  }
  return out
}

/** 最久沒做的那份：沒做過的排最前（依傳進來的順序＝建立順序），其餘 lastUsed 最舊者；同日取先建立的。 */
function stalest(cards: readonly RoutineCard[]): RoutineCard | null {
  let pick: RoutineCard | null = null
  for (const c of cards) {
    if (pick === null) pick = c
    else if (pick.lastUsed !== null && (c.lastUsed === null || c.lastUsed < pick.lastUsed)) pick = c
  }
  return pick
}

/** 建議課表（spec 裁決）：練到的肌群都已恢復（或沒練過）的課表裡最久沒做的那份，ready＝true；
 *  一份都沒有就挑全部裡最久沒做的、ready＝false（畫面不標「建議」）。沒有課表 → null。 */
export function suggestRoutine(db: TrainingDb, active: readonly RoutineCard[], now: Date): { card: RoutineCard; ready: boolean } | null {
  if (active.length === 0) return null
  const recovering = new Set(recoveryStatus(db, now).filter((r) => r.state === 'recovering').map((r) => r.group as MuscleGroup))
  const ready = active.filter((c) => ![...routineGroups(db, c.routine.id)].some((g) => recovering.has(g)))
  const fromReady = stalest(ready)
  return fromReady ? { card: fromReady, ready: true } : { card: stalest(active)!, ready: false }
}

/** 開始選項（首頁「照課表開始」與開始 sheet）每份課表的說明：練到的肌群（依固定順序、最多三個，沒有肌群的寫「N 個動作」）＋上次日期；
 *  練到的肌群有還在恢復的，改寫「胸部、肩膀還要約 1 天」——說明它為什麼不是建議（剩的天數取最長的那個）。 */
export function routineStartNotes(db: TrainingDb, cards: readonly RoutineCard[], now: Date): Map<string, string> {
  const status = new Map(recoveryStatus(db, now).map((r) => [r.group as MuscleGroup, r]))
  const out = new Map<string, string>()
  for (const c of cards) {
    const groups = (Object.keys(MUSCLE_GROUP_LABEL) as MuscleGroup[]).filter((g) => routineGroups(db, c.routine.id).has(g))
    const waiting = groups.filter((g) => status.get(g)?.state === 'recovering')
    const last = c.lastUsed ? ` · 上次 ${monthDay(c.lastUsed)}` : ''
    if (waiting.length > 0) {
      const days = Math.max(...waiting.map((g) => Math.max(1, Math.ceil((status.get(g)!.remainingHours ?? 0) / 24))))
      out.set(c.routine.id, `${waiting.map((g) => MUSCLE_GROUP_LABEL[g]).join('、')}還要約 ${days} 天${last}`)
    } else {
      const what = groups.length > 0 ? groups.slice(0, 3).map((g) => MUSCLE_GROUP_LABEL[g]).join('、') : `${c.exerciseCount} 個動作`
      out.set(c.routine.id, `${what}${last}`)
    }
  }
  return out
}

/* ═══════════ 新紀錄（訓練中即時＋完成畫面） ═══════════ */

/** 「在這一次之前」：日期較早，或同一天較早開始；同一天的補記起點都是 12:00，再比建立時間、最後比 id，兩筆一定分得出先後。 */
function isBefore(a: Row, b: Row): boolean {
  const da = String(a.performed_on)
  const dbb = String(b.performed_on)
  if (da !== dbb) return da < dbb
  if (startedMs(a) !== startedMs(b)) return startedMs(a) < startedMs(b)
  const ca = String(a.created_at ?? '')
  const cb = String(b.created_at ?? '')
  if (ca !== cb) return ca < cb
  return a.id < b.id
}

export interface SessionRecord {
  readonly exerciseId: string
  /** 這次訓練裡 e1RM 最高的那一組（同 e1RM 取較重的）。 */
  readonly setId: string
  readonly e1rm: number
  /** 比這次之前的最佳多多少（取小數一位）。 */
  readonly delta: number
}

export interface ExerciseBest {
  /** 這次之前的最佳 e1RM；之前沒做過（或沒有有效組）＝null。 */
  readonly prior: number | null
  /** 這次訓練目前最好的一組；還沒有有效組＝null。 */
  readonly current: { readonly setId: string; readonly e1rm: number } | null
}

/** 這次訓練每個動作的兩個 e1RM：這次之前的最佳、這次目前最好的一組（已打勾、10 下以內；同 e1RM 取較重的）。
 *  訓練中動作卡頭第二行與新紀錄共用（使用者 2026-11-23：卡頭常駐 1RM，破紀錄就更新數字＋「+N kg」）。 */
export function exerciseBests(db: TrainingDb, workoutId: string): Map<string, ExerciseBest> {
  const workouts = new Map(db.workouts.map((w) => [w.id, w]))
  const self = workouts.get(workoutId)
  const out = new Map<string, ExerciseBest>()
  if (!self) return out
  const entryInfo = new Map<string, { workout: Row; exerciseId: string }>()
  for (const we of db.workout_exercises) {
    const w = workouts.get(String(we.workout_id))
    if (w) entryInfo.set(we.id, { workout: w, exerciseId: String(we.exercise_id) })
  }
  const prior = new Map<string, number>()
  const current = new Map<string, { setId: string; e1rm: number; weight: number }>()
  for (const s of db.workout_sets) {
    if (s.done !== true) continue
    const info = entryInfo.get(String(s.workout_exercise_id))
    if (!info) continue
    const weight = Number(s.weight_kg)
    const est = e1rm(weight, Number(s.reps))
    if (est === null) continue
    if (info.workout.id === workoutId) {
      const cur = current.get(info.exerciseId)
      if (!cur || est > cur.e1rm || (est === cur.e1rm && weight > cur.weight)) current.set(info.exerciseId, { setId: s.id, e1rm: est, weight })
    } else if (isBefore(info.workout, self)) {
      prior.set(info.exerciseId, Math.max(prior.get(info.exerciseId) ?? 0, est))
    }
  }
  for (const id of new Set([...prior.keys(), ...current.keys()])) {
    const cur = current.get(id)
    out.set(id, { prior: prior.get(id) ?? null, current: cur ? { setId: cur.setId, e1rm: cur.e1rm } : null })
  }
  return out
}

/** 新紀錄：這次最好的一組高過這次之前的最佳。之前沒做過（沒有可比的最佳）不算——第一次做的每一組都會是「新高」，
 *  那是噪音，完成畫面另寫「第一次做」。 */
export function recordOf(best: ExerciseBest): { setId: string; e1rm: number; delta: number } | null {
  if (best.prior === null || best.current === null || best.current.e1rm <= best.prior) return null
  return { setId: best.current.setId, e1rm: best.current.e1rm, delta: Math.round((best.current.e1rm - best.prior) * 10) / 10 }
}

export function sessionRecords(db: TrainingDb, workoutId: string): SessionRecord[] {
  const out: SessionRecord[] = []
  for (const [exerciseId, best] of exerciseBests(db, workoutId)) {
    const r = recordOf(best)
    if (r) out.push({ exerciseId, ...r })
  }
  return out
}

/* ═══════════ 完成畫面 ═══════════ */

/** 這一次是本週（週一到週日）第幾次：同週已結束的訓練裡，排在它前面（含自己）的有幾次。自己還沒結束也算一次。 */
export function weekOrdinal(db: TrainingDb, workoutId: string): number {
  const self = db.workouts.find((w) => w.id === workoutId)
  if (!self) return 0
  const week = new Set(weekDates(String(self.performed_on)))
  return db.workouts.filter(
    (w) => week.has(String(w.performed_on)) && (w.id === workoutId || (w.ended_at != null && isBefore(w, self))),
  ).length
}

export type Highlight =
  | { readonly kind: 'record'; readonly name: string; readonly e1rm: number; readonly delta: number }
  | { readonly kind: 'vsLast'; readonly routineName: string; readonly pct: number }
  | { readonly kind: 'first'; readonly name: string }

const volumeOf = (db: TrainingDb, workoutId: string): number => {
  const entries = new Set(db.workout_exercises.filter((we) => we.workout_id === workoutId).map((we) => we.id))
  const centis = db.workout_sets
    .filter((s) => s.done === true && entries.has(String(s.workout_exercise_id)))
    .reduce((sum, s) => sum + Math.round(Number(s.weight_kg) * 100) * Number(s.reps), 0)
  return centis / 100
}

/** 完成畫面「這次的亮點」，最多三條，依序：新紀錄（新高多的排前）→ 比上次同一份課表的總重量（±%，四捨五入到整數，0% 不寫；
 *  上次總重量是 0 也不寫）→ 第一次做的動作（這次有做〔打勾的組或有氧分鐘〕、這次之前沒有任何一次訓練放過它）。都沒有就是空陣列，畫面不出這一段。 */
export function workoutHighlights(db: TrainingDb, workoutId: string): Highlight[] {
  const self = db.workouts.find((w) => w.id === workoutId)
  if (!self) return []
  const byId = new Map(db.exercises.map((e) => [e.id, e]))
  const out: Highlight[] = sessionRecords(db, workoutId)
    .sort((a, b) => b.delta - a.delta)
    .map((r) => ({ kind: 'record' as const, name: exerciseDisplayName(byId.get(r.exerciseId)), e1rm: r.e1rm, delta: r.delta }))

  const routineId = typeof self.routine_id === 'string' ? self.routine_id : null
  if (routineId !== null) {
    const last = db.workouts
      .filter((w) => w.routine_id === routineId && w.id !== workoutId && w.ended_at != null && isBefore(w, self))
      .sort((a, b) => (isBefore(a, b) ? 1 : -1))[0]
    const prev = last ? volumeOf(db, last.id) : 0
    if (last && prev > 0) {
      const pct = Math.round(((volumeOf(db, workoutId) - prev) / prev) * 100)
      const routine = db.routines.find((r) => r.id === routineId)
      if (pct !== 0 && routine) out.push({ kind: 'vsLast', routineName: String(routine.name), pct })
    }
  }

  const earlier = new Set(db.workouts.filter((w) => w.id !== workoutId && isBefore(w, self)).map((w) => w.id))
  const doneBefore = new Set(db.workout_exercises.filter((we) => earlier.has(String(we.workout_id))).map((we) => String(we.exercise_id)))
  // 這次真的有做的才算「第一次做」：重訓有打勾的組、有氧填了分鐘；只加進來沒做的不算
  const doneEntries = new Set(db.workout_sets.filter((x) => x.done === true).map((x) => String(x.workout_exercise_id)))
  const seen = new Set<string>()
  for (const we of db.workout_exercises.filter((x) => x.workout_id === workoutId).sort((a, b) => Number(a.position) - Number(b.position))) {
    const id = String(we.exercise_id)
    if (doneBefore.has(id) || seen.has(id) || !(doneEntries.has(we.id) || cardioRecorded(we))) continue
    seen.add(id)
    out.push({ kind: 'first', name: exerciseDisplayName(byId.get(id)) })
  }
  return out.slice(0, 3)
}

/** 練到的肌群：有打勾組的動作的肌群中文名，依 MUSCLE_GROUPS 順序；「其他」（含有氧）不列。 */
export function trainedGroups(db: TrainingDb, workoutId: string): string[] {
  const byId = new Map(db.exercises.map((e) => [e.id, e]))
  const doneEntries = new Set(db.workout_sets.filter((s) => s.done === true).map((s) => String(s.workout_exercise_id)))
  const groups = new Set<MuscleGroup>()
  for (const we of db.workout_exercises) {
    if (we.workout_id !== workoutId || !doneEntries.has(we.id)) continue
    const ex = byId.get(String(we.exercise_id))
    if (ex && !isCardioExercise(ex) && groupOf(ex) !== 'other') groups.add(groupOf(ex))
  }
  return (Object.keys(MUSCLE_GROUP_LABEL) as MuscleGroup[]).filter((g) => groups.has(g)).map((g) => MUSCLE_GROUP_LABEL[g])
}
