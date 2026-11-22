/* 訓練分析 A（spec.md「階段 4 甲」）的純運算：e1RM 與單一動作的歷次進度。
   不沾 DOM；吃的是已疊上離線佇列的 TrainingDb，所以離線剛記完的訓練也算。 */
import { dayIndex } from './dates'
import { rangeStart, type TrendRange } from './weightTrend'
import { completedSessions, startedMs, type Row, type TrainingDb } from './training'
import { warmupSetIds } from './recovery'

/** 只信 10 下以內：次數越高 Epley 估得越不準。 */
const E1RM_MAX_REPS = 10

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Epley：重量 × (1 + 次數 / 30)，取小數一位。次數 1 直接等於重量（公式在 1 下會多算 3%）。
 *  重量 ≤ 0（徒手動作）、次數不在 1–10 的整數、非有限數字 → null。 */
export function e1rm(weightKg: number, reps: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return null
  if (weightKg <= 0 || !Number.isInteger(reps) || reps < 1 || reps > E1RM_MAX_REPS) return null
  return reps === 1 ? round1(weightKg) : round1(weightKg * (1 + reps / 30))
}

export interface StrengthPoint {
  readonly workoutId: string
  /** yyyy-mm-dd */
  readonly date: string
  /** 該次訓練該動作所有有效已打勾組 e1RM 的最大值 */
  readonly e1rm: number
  /** 產出該 e1RM 的那一組 */
  readonly topSet: { readonly weight_kg: number; readonly reps: number }
}

/** 某動作歷次訓練的進度，由舊到新。一次訓練一點：取該次有效已打勾組 e1RM 最大的那一組
 *  （沒有熱身標記，所以取最大值讓熱身組不影響）。同一次訓練同動作出現兩個 entry 時併成一點。
 *  整次沒有有效組（沒打勾、次數超過 10、0 kg）的訓練不出點。 */
export function strengthHistory(db: TrainingDb, exerciseId: string): StrengthPoint[] {
  const workouts = new Map(db.workouts.map((w) => [w.id, w]))
  const entryIds = new Map<string, string>()
  for (const we of db.workout_exercises) {
    if (we.exercise_id === exerciseId) entryIds.set(we.id, String(we.workout_id))
  }

  const best = new Map<string, { e1rm: number; weight_kg: number; reps: number }>()
  for (const s of db.workout_sets) {
    if (s.done !== true) continue
    const workoutId = entryIds.get(String(s.workout_exercise_id))
    if (workoutId === undefined || !workouts.has(workoutId)) continue
    const weight_kg = Number(s.weight_kg)
    const reps = Number(s.reps)
    const est = e1rm(weight_kg, reps)
    if (est === null) continue
    const cur = best.get(workoutId)
    // e1RM 四捨五入後相同時取較重的一組（60×10 與 75×2 都是 80.0），不讓結果取決於資料列順序
    if (!cur || est > cur.e1rm || (est === cur.e1rm && weight_kg > cur.weight_kg)) best.set(workoutId, { e1rm: est, weight_kg, reps })
  }

  return [...best]
    .map(([workoutId, b]): StrengthPoint => ({
      workoutId,
      date: String(workouts.get(workoutId)!.performed_on),
      e1rm: b.e1rm,
      topSet: { weight_kg: b.weight_kg, reps: b.reps },
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        startedMs(workouts.get(a.workoutId)!) - startedMs(workouts.get(b.workoutId)!),
    )
}

/** 歷來最大的 e1RM；沒有任何有效組 → null。 */
export function bestE1rm(points: readonly StrengthPoint[]): number | null {
  return points.length === 0 ? null : Math.max(...points.map((p) => p.e1rm))
}

export interface ProgressListItem {
  readonly exerciseId: string
  readonly name: string
  readonly sessions: number
  readonly best: number
  /** 最近一次有效訓練的日期 */
  readonly lastDate: string
}

/** 動作進度頁的列表：有至少一個有效已打勾組的動作，依最近練的排前面。 */
export function progressList(db: TrainingDb): ProgressListItem[] {
  const items: ProgressListItem[] = []
  for (const ex of db.exercises) {
    const pts = strengthHistory(db, ex.id)
    if (pts.length === 0) continue
    items.push({
      exerciseId: ex.id,
      name: String(ex.name),
      sessions: pts.length,
      best: bestE1rm(pts)!,
      lastDate: pts[pts.length - 1].date,
    })
  }
  return items.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name))
}

export interface ChartPoint extends StrengthPoint {
  /** 自 1970-01-01 起算的天數（同體重趨勢：X 軸用數字軸，沒練的日子留白） */
  readonly t: number
}

/* ═══════════ 重量建議（B；雙重進階的簡化版）═══════════ */

/** 沒有課表目標次數時，用多少下當「做到了」的門檻（使用者 2026-10-20 裁決 12）。 */
const DEFAULT_SUGGEST_REPS = 12

export type WeightSuggestion =
  | { readonly kind: 'suggest'; readonly weight_kg: number; readonly reason: string }
  | { readonly kind: 'insufficient' }
  /** 這個動作沒有重量可加（最近一次最高重量 0 kg，徒手記法）：畫面整行不出現，不說「資料不足」（再記也不會變）。 */
  | { readonly kind: 'none' }

const NUMERALS = ['', '一', '兩', '三', '四', '五', '六', '七', '八', '九', '十']
const countText = (n: number): string => NUMERALS[n] || String(n)
const round2 = (n: number): number => Math.round(n * 100) / 100

/** 這次訓練所屬課表替該動作設的目標次數；沒有課表、沒設、設成 0 都回 null。 */
function routineTargetReps(db: TrainingDb, workoutId: string, exerciseId: string): number | null {
  const routineId = db.workouts.find((w) => w.id === workoutId)?.routine_id
  if (typeof routineId !== 'string') return null
  const re = db.routine_exercises.find((r) => r.routine_id === routineId && r.exercise_id === exerciseId)
  const reps = re?.target_reps == null ? null : Number(re.target_reps)
  return reps !== null && Number.isFinite(reps) && reps >= 1 ? reps : null
}

/** 歷史只算「比正在編輯的這一次更早」的訓練：打開已結束或補記的舊訓練時，不能拿它之後的訓練當「上次」去建議。 */
function earlierSessions(db: TrainingDb, exerciseId: string, currentWorkoutId: string) {
  const workouts = new Map(db.workouts.map((w) => [w.id, w]))
  const cur = workouts.get(currentWorkoutId)
  const all = completedSessions(db, exerciseId, currentWorkoutId)
  if (!cur) return all
  const curDay = String(cur.performed_on)
  const curStart = startedMs(cur)
  return all.filter((s) => {
    const w = workouts.get(s.workoutId)!
    const day = String(w.performed_on)
    return day < curDay || (day === curDay && startedMs(w) < curStart)
  })
}

/** 上次最重那組的 RPE（spec 階段 4 丙 階段 1）：同重量有多組有填時取最後一組（rows 依加入順序排）；都沒填＝null。
 *  **只在較輕的組填了 RPE 也算沒填**（v2.140 review）：休息條快捷鍵寫的是最後一組，遞減金字塔的最後一組最輕；
 *  拿輕組的 RPE 去判最重那組會錯，保守當沒填——沒填一律不降。 */
function topSetRpe(rows: readonly Row[], top: number): number | null {
  let rpe: number | null = null
  for (const s of rows) {
    const v = s.rpe === null || s.rpe === undefined ? NaN : Number(s.rpe)
    if (Number(s.weight_kg) === top && Number.isFinite(v)) rpe = v
  }
  return rpe
}

/** RPE 的意思寫成白話：10＝做到沒力，其餘＝還能多做 10 − RPE 下 */
const spare = (rpe: number): string => (rpe >= 10 ? '已經做到沒力' : `還能多做 ${10 - rpe} 下`)

/**
 * 下次的重量建議（spec.md「階段 4 丙」階段 1，2026-10-28 核可；v2.140 實作）。只看上次這個動作、熱身組不算：
 * - 上次最重那組 RPE ≤7（剩 3 下以上）→ 加一格，不論次數有沒有到；
 * - 每組都做到目標次數 → 加一格；但最重那組 RPE 9–10 → 維持；
 * - 沒全做到、**最重那幾組**裡最差的少 ≥2 下、而且 RPE ≥9 → 降一格（唯一會降的情況：有 RPE 且確實吃力才降）；
 *   「最差」只看最重那幾組，跟 RPE 取自同一組（v2.140 review：spec 寫「最差那組」，較輕的收尾組沒做到會讓
 *   最重那組明明成功卻被降，理由還把兩組的次數與 RPE 寫成一組。spec 寫「調整交給我」，這是我定的）；
 * - 其他沒做到（含沒填 RPE）→ 維持。**沒填 RPE 一律不退步**，跟原本的雙重進階一樣。
 * 只讀已疊上離線佇列的 db；進行中的這一次與它之後的訓練都不算歷史；最高重量 ≤ 0（徒手）→ none。
 * 規則與門檻是設計決定（Helms 2016 只給「目標次數＋目標 RIR，做不到就降、有餘力就升」的邏輯），不是文獻給的界線。
 */
export function suggestWeight(db: TrainingDb, exerciseId: string, step: number, currentWorkoutId: string): WeightSuggestion {
  const sessions = earlierSessions(db, exerciseId, currentWorkoutId)
  // 做過一次就給（原本要兩次）；沒做過的畫面只給指引、不編數字
  if (sessions.length === 0) return { kind: 'insufficient' }

  /* 同一次訓練裡這個動作出現兩次（例如後面又補一組收尾）要合在一起看：completedSessions 一個 entry 一筆、同一次訓練裡
     後加的排前面，只看 sessions[0] 會漏掉先做的那幾組（v2.140 review）。反轉回加入順序，「最後一組」才有定義 */
  const latest = sessions[0].workoutId
  const rows = sessions.filter((s) => s.workoutId === latest).reverse().flatMap((s) => s.rows)
  const warm = warmupSetIds(rows)
  const work = rows.filter((s) => !warm.has(s.id))
  const top = Math.max(...work.map((s) => Number(s.weight_kg)))
  if (!Number.isFinite(top) || top <= 0) return { kind: 'none' }

  const target = routineTargetReps(db, currentWorkoutId, exerciseId) ?? DEFAULT_SUGGEST_REPS
  const rpe = topSetRpe(work, top)
  const allDone = work.every((s) => Number(s.reps) >= target)
  const topWorst = Math.min(...work.filter((s) => Number(s.weight_kg) === top).map((s) => Number(s.reps)))
  const up = round2(top + step)

  /* 理由不寫 RPE 數字（v2.150 用詞檢查：使用者看不懂裸的「RPE 7」），換成它的意思「還能多做幾下」＝10 − RPE */
  if (rpe !== null && rpe <= 7) return { kind: 'suggest', weight_kg: up, reason: `上次${spare(rpe)}，可以加重` }
  if (allDone) {
    if (rpe !== null && rpe >= 9) return { kind: 'suggest', weight_kg: top, reason: `上次${spare(rpe)}，先維持` }
    const done = work.length === 1 ? '上次那組做到' : `上次${countText(work.length)}組都做到`
    return { kind: 'suggest', weight_kg: up, reason: rpe === null ? `${done} ${target} 下` : `${done} ${target} 下、${spare(rpe)}` }
  }
  if (rpe !== null && rpe >= 9 && target - topWorst >= 2 && top - step > 0) {
    return { kind: 'suggest', weight_kg: round2(top - step), reason: `上次只做到 ${topWorst} 下又很吃力，減一點重量` }
  }
  // 最重那幾組其實做到了、是較輕的組沒做到：說是哪個重量，不然「再做到 12 下」像在說最重那組（v2.140 review）
  const missed = topWorst >= target ? work.find((s) => Number(s.reps) < target) : undefined
  return { kind: 'suggest', weight_kg: top, reason: missed ? `${round2(Number(missed.weight_kg))} kg 那組再做到 ${target} 下` : `再做到 ${target} 下` }
}

/** 範圍切片＋補上 X 軸座標。範圍起點（含）同體重趨勢：「30 天」＝今天加前 29 天；全部不設下界。 */
export function chartPoints(points: readonly StrengthPoint[], range: TrendRange, today: string): ChartPoint[] {
  const from = rangeStart(range, today)
  return points.filter((p) => from === null || p.date >= from).map((p) => ({ ...p, t: dayIndex(p.date) }))
}

