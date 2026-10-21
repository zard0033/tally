/* 訓練分析 C（spec.md「階段 4 甲」）的純運算：各肌群「最近一次練完到現在」的恢復狀態。
   不沾 DOM；吃的是已疊上離線佇列的 TrainingDb，所以離線剛記完的訓練也算。
   窗口是依文獻範圍估的起點，不是診斷：下半身比上半身慢（48–72 小時 vs 24 小時內），訓練量大要更久。
   文獻還說「離力竭多近」影響最大（多 24–48 小時）：D（spec.md「階段 4 乙」）起，那次訓練該肌群有任一組 RPE ≥ 9 就加 24 小時。
   熱身組（重量不到該動作當天最重一組的 60%）不計入組數，沒有熱身欄位，純用規則判斷。 */
import { dayIndex } from './weightTrend'
import { groupOf, MUSCLE_GROUPS, type MuscleGroup, type Row, type TrainingDb } from './training'
import { localDate } from './dates'

/** 「其他」含有氧，不算；順序同 MUSCLE_GROUPS。 */
export const RECOVERY_GROUPS = MUSCLE_GROUPS.filter((g): g is Exclude<MuscleGroup, 'other'> => g !== 'other')
export type RecoveryGroup = (typeof RECOVERY_GROUPS)[number]

export type RecoveryState = 'recovering' | 'ready' | 'none'

export interface MuscleRecovery {
  readonly group: RecoveryGroup
  readonly state: RecoveryState
  /** 最近一次那場該肌群已打勾的組數；沒練過＝0 */
  readonly sets: number
  /** 最近一次的 performed_on；沒練過＝null */
  readonly lastDate: string | null
  /** 按日曆日算，今天＝0；沒練過＝null */
  readonly daysAgo: number | null
  readonly windowHours: number | null
  /** 最近一次那場該肌群有任一組已打勾、RPE ≥ 9；沒練過＝false */
  readonly nearFailure: boolean
  /** 恢復中＝還剩幾小時（無條件進位）；可再練＝0；沒練過＝null */
  readonly remainingHours: number | null
}

const HOUR_MS = 3600_000

/** RPE ≥ 9（還能再做 1 下以內）算近力竭。 */
export const NEAR_FAILURE_RPE = 9

/** 一個肌群練了 n 組後的恢復窗口（小時）。n 以 10 為界；下半身基準 48、其餘 24，量大加 24，近力竭再加 24。 */
export function recoveryWindowHours(group: RecoveryGroup, sets: number, nearFailure = false): number {
  const base = group === 'legs' ? 48 : 24
  return (sets >= 10 ? base + 24 : base) + (nearFailure ? 24 : 0)
}

/** 熱身組的重量門檻：低於該動作當天最重一組的 60%。比較用「分」的整數，免得 0.6 的浮點誤差把剛好 60% 判成熱身。 */
const WARMUP_PCT = 60

/** 一個動作（同一次訓練）的各組裡，哪些是熱身：已打勾、最重一組 > 0、且重量 < 最重一組的 60%。 */
export function warmupSetIds(sets: readonly Row[]): Set<string> {
  const cents = (s: Row) => Math.round(Number(s.weight_kg) * 100)
  const done = sets.filter((s) => s.done === true)
  const max = Math.max(0, ...done.map(cents))
  const out = new Set<string>()
  if (max <= 0) return out
  for (const s of done) if (cents(s) * 100 < max * WARMUP_PCT) out.add(s.id)
  return out
}

/** 一場訓練結束的時間點；進行中（沒有 ended_at）用開始時間。兩者都解析不了＝NaN。 */
function finishedMs(w: Row): number {
  const ended = typeof w.ended_at === 'string' ? Date.parse(w.ended_at) : NaN
  return Number.isNaN(ended) ? Date.parse(String(w.started_at)) : ended
}

export function recoveryStatus(db: TrainingDb, now: Date): MuscleRecovery[] {
  const today = localDate(now)
  const workouts = new Map(db.workouts.map((w) => [w.id, w]))
  const groupOfExercise = new Map(db.exercises.map((e) => [e.id, groupOf(e)]))
  const entryOf = new Map<string, { workoutId: string; group: MuscleGroup }>()
  for (const we of db.workout_exercises) {
    const group = groupOfExercise.get(String(we.exercise_id))
    const workoutId = String(we.workout_id)
    if (group !== undefined && workouts.has(workoutId)) entryOf.set(we.id, { workoutId, group })
  }

  const setsOfEntry = new Map<string, Row[]>()
  for (const s of db.workout_sets) {
    const id = String(s.workout_exercise_id)
    if (entryOf.has(id)) setsOfEntry.set(id, [...(setsOfEntry.get(id) ?? []), s])
  }

  // workoutId → 肌群 → 已打勾且非熱身的組數、有沒有近力竭的組
  const counts = new Map<string, Map<MuscleGroup, { sets: number; nearFailure: boolean }>>()
  for (const [entryId, sets] of setsOfEntry) {
    const entry = entryOf.get(entryId)!
    const warm = warmupSetIds(sets)
    const byGroup = counts.get(entry.workoutId) ?? new Map<MuscleGroup, { sets: number; nearFailure: boolean }>()
    const cur = byGroup.get(entry.group) ?? { sets: 0, nearFailure: false }
    for (const s of sets) {
      if (s.done !== true) continue
      if (!warm.has(s.id)) cur.sets += 1
      if (Number(s.rpe) >= NEAR_FAILURE_RPE) cur.nearFailure = true
    }
    byGroup.set(entry.group, cur)
    counts.set(entry.workoutId, byGroup)
  }

  return RECOVERY_GROUPS.map((group): MuscleRecovery => {
    let latest: { w: Row; ms: number; sets: number; nearFailure: boolean } | null = null
    for (const [workoutId, byGroup] of counts) {
      const c = byGroup.get(group)
      if (!c || c.sets === 0) continue
      const w = workouts.get(workoutId)!
      const ms = finishedMs(w)
      if (Number.isNaN(ms)) continue
      if (!latest || ms > latest.ms || (ms === latest.ms && w.id > latest.w.id)) latest = { w, ms, sets: c.sets, nearFailure: c.nearFailure }
    }
    if (!latest) return { group, state: 'none', sets: 0, lastDate: null, daysAgo: null, windowHours: null, nearFailure: false, remainingHours: null }

    const hoursSince = Math.max(0, (now.getTime() - latest.ms) / HOUR_MS) // 時鐘偏差造成的未來時間當 0
    const windowHours = recoveryWindowHours(group, latest.sets, latest.nearFailure)
    const recovering = hoursSince < windowHours
    const lastDate = String(latest.w.performed_on)
    return {
      group,
      state: recovering ? 'recovering' : 'ready',
      sets: latest.sets,
      lastDate,
      daysAgo: Math.max(0, dayIndex(today) - dayIndex(lastDate)),
      windowHours,
      nearFailure: latest.nearFailure,
      remainingHours: recovering ? Math.ceil(windowHours - hoursSince) : 0,
    }
  })
}
