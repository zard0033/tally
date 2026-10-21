/* 訓練分析 C（spec.md「階段 4 甲」）的純運算：各肌群「最近一次練完到現在」的恢復狀態。
   不沾 DOM；吃的是已疊上離線佇列的 TrainingDb，所以離線剛記完的訓練也算。
   窗口是依文獻範圍估的起點，不是診斷：下半身比上半身慢（48–72 小時 vs 24 小時內），訓練量大要更久。
   文獻還說「離力竭多近」影響最大（多 24–48 小時），但現在沒有 RPE 可算——要加時只改 recoveryWindowHours。 */
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
  /** 恢復中＝還剩幾小時（無條件進位）；可再練＝0；沒練過＝null */
  readonly remainingHours: number | null
}

const HOUR_MS = 3600_000

/** 一個肌群練了 n 組後的恢復窗口（小時）。n 以 10 為界；下半身基準 48、其餘 24，量大各加 24。 */
export function recoveryWindowHours(group: RecoveryGroup, sets: number): number {
  const base = group === 'legs' ? 48 : 24
  return sets >= 10 ? base + 24 : base
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

  // workoutId → 肌群 → 已打勾組數
  const counts = new Map<string, Map<MuscleGroup, number>>()
  for (const s of db.workout_sets) {
    if (s.done !== true) continue
    const entry = entryOf.get(String(s.workout_exercise_id))
    if (!entry) continue
    const byGroup = counts.get(entry.workoutId) ?? new Map<MuscleGroup, number>()
    byGroup.set(entry.group, (byGroup.get(entry.group) ?? 0) + 1)
    counts.set(entry.workoutId, byGroup)
  }

  return RECOVERY_GROUPS.map((group): MuscleRecovery => {
    let latest: { w: Row; ms: number; sets: number } | null = null
    for (const [workoutId, byGroup] of counts) {
      const sets = byGroup.get(group)
      if (!sets) continue
      const w = workouts.get(workoutId)!
      const ms = finishedMs(w)
      if (Number.isNaN(ms)) continue
      if (!latest || ms > latest.ms || (ms === latest.ms && w.id > latest.w.id)) latest = { w, ms, sets }
    }
    if (!latest) return { group, state: 'none', sets: 0, lastDate: null, daysAgo: null, windowHours: null, remainingHours: null }

    const hoursSince = Math.max(0, (now.getTime() - latest.ms) / HOUR_MS) // 時鐘偏差造成的未來時間當 0
    const windowHours = recoveryWindowHours(group, latest.sets)
    const recovering = hoursSince < windowHours
    const lastDate = String(latest.w.performed_on)
    return {
      group,
      state: recovering ? 'recovering' : 'ready',
      sets: latest.sets,
      lastDate,
      daysAgo: Math.max(0, dayIndex(today) - dayIndex(lastDate)),
      windowHours,
      remainingHours: recovering ? Math.ceil(windowHours - hoursSince) : 0,
    }
  })
}
