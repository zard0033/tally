/* 目標熱量公式鏈（2026-08-03 重新設計）：
   BMR：有體脂率（去脂體重）→ Katch-McArdle；沒有 → Mifflin-St Jeor。
   TDEE = BMR × 活動係數。
   目標熱量：減重/增肌依 rate_kg_per_week 換算的每日熱量差額在 TDEE 上加減
   （7700 卡／公斤是常見估算值），維持＝TDEE。
   蛋白質 = 體重 × protein_g_per_kg；脂肪／碳水依目標對照表分「剩餘熱量」
   （減重 35/65、維持 40/60、增肌 30/70）——這兩個比例不開放使用者調整，寫死在這裡。
   use_custom_targets 開著時完全繞過以上公式，直接回傳 custom_* 四個數字。
   捨入時機：只在最終顯示時捨入，這裡的計算鏈全程不捨入。 */
import { ageFromYear } from './dates'

export type Goal = 'cut' | 'maintain' | 'bulk'

export interface Profile {
  birth_year: number | string | null
  height_cm: number | string | null
  activity_factor: number | string | null
  sex: string
  goal: Goal
  rate_kg_per_week: number | string | null
  protein_g_per_kg: number | string | null
  use_custom_targets: boolean
  custom_kcal: number | string | null
  custom_protein_g: number | string | null
  custom_fat_g: number | string | null
  custom_carb_g: number | string | null
}

export interface Targets {
  age: number
  bmr: number | null
  tdee: number | null
  kcal: number
  protein: number
  fat: number
  carb: number
}

/** 減重/增肌時，脂肪／碳水分「剩餘熱量」（扣掉蛋白質熱量後）的比例。維持態也需要一組，
 *  蛋白質同樣先扣，只是熱量差額為 0。常見健身社群比例，非嚴謹公式，跟 Mifflin-St Jeor
 *  不同級別——這點要在畫面的「計算依據」老實寫出來，不能包裝成同等硬科學。 */
const GOAL_MACRO_PRESET: Record<Goal, { fatPct: number; carbPct: number }> = {
  cut: { fatPct: 35, carbPct: 65 },
  maintain: { fatPct: 40, carbPct: 60 },
  bulk: { fatPct: 30, carbPct: 70 },
}

/** 1 公斤體脂肪 ≈ 7700 大卡的常見估算值，用來把「每週想變化幾公斤」換算成每天的熱量差額。 */
const KCAL_PER_KG = 7700

export interface IntakeTotals {
  kcal: number
  protein: number
  fat: number
  carb: number
}

export interface IntakeAmount {
  qty: unknown
  kcal: unknown
  protein: unknown
  fat: unknown
  carb: unknown
}

/** null/undefined 一律回 NaN，其餘交給 Number()——DB 的 numeric 欄位可能回字串。 */
export const num = (v: unknown): number => (v === null || v === undefined ? NaN : Number(v))

/** num() 的 nullable 版——欄位可能沒填，區分「沒填」（null）跟「填了但看不懂」（NaN）
 *  在初始化表單狀態時有意義，但送去 computeTargets 前一律再走一次 num()。 */
export function numOrNull(v: unknown): number | null {
  const n = num(v)
  return Number.isFinite(n) ? n : null
}

/** 目標＋變化速度合併選單的狀態機（Settings.tsx 表單 UI 用）。放在 lib 層而不是
 *  screens/ 是因為它是「DB 欄位 ↔ 選單值」的純映射，跟 DOM 無關，vitest 測得到；
 *  放在 UI 層的話只有 e2e 測得到，這輪的表單重寫恰好還沒有 e2e 覆蓋（precommit-review
 *  抓到），先把邏輯挪到能被 vitest 釘住的地方比補 e2e 便宜。
 *  維持沒有速度可選，減重/增肌各是五個固定 kg/月選項的其中一個——**沒有自訂**（使用者
 *  2026-08-03 裁決：只開放這五格，不留手動輸入escape hatch，跟活動量選單刻意不同款）。
 *  DB 欄位 rate_kg_per_week 存的仍是「每週」（沿用既有 7700 卡/公斤的每日熱量差額公式，
 *  不改 computeTargets），這裡只在 UI 邊界做 kg/月 ↔ kg/週 的換算，換算基準用
 *  52 週/年 ÷ 12 個月，不是 4.3482…（365.25/12/7）——這個領域本來就是估算值的疊加
 *  （7700 卡/公斤本身就不精確），沒有必要為換算常數多一位精度。 */
export const RATE_PRESETS_KG_PER_MONTH = [0.5, 0.75, 1, 1.25, 1.5] as const
type RatePreset = (typeof RATE_PRESETS_KG_PER_MONTH)[number]
export type GoalMode = 'maintain' | `cut:${RatePreset}` | `bulk:${RatePreset}`

const WEEKS_PER_MONTH = 52 / 12

export const rateWeeklyToMonthly = (kgPerWeek: number): number => kgPerWeek * WEEKS_PER_MONTH
export const rateMonthlyToWeekly = (kgPerMonth: number): number => kgPerMonth / WEEKS_PER_MONTH

/** 讀資料庫的每週速度換算回月選單時，用最接近的 preset 對齊——DB numeric(3,2) 只存到
 *  小數兩位，換算來回會有極小誤差（遠小於 preset 間距 0.25kg/月），直接比對浮點數相等
 *  會找不到，取最近的才是正確作法。 */
function nearestRatePreset(kgPerMonth: number): RatePreset {
  return RATE_PRESETS_KG_PER_MONTH.reduce((best, p) =>
    Math.abs(p - kgPerMonth) < Math.abs(best - kgPerMonth) ? p : best)
}

export function goalModeFrom(goal: Goal, rateKgPerWeek: number | null): GoalMode {
  if (goal === 'maintain') return 'maintain'
  const monthly = rateKgPerWeek !== null ? rateWeeklyToMonthly(rateKgPerWeek) : RATE_PRESETS_KG_PER_MONTH[0]
  return `${goal}:${nearestRatePreset(monthly)}`
}

export function goalFromMode(mode: GoalMode): Goal {
  return mode === 'maintain' ? 'maintain' : (mode.split(':')[0] as Goal)
}

/** mode 帶的 kg/月 preset 換算回要存進 DB 的 kg/週；maintain 沒有速度，回 null。 */
export function rateFromMode(mode: GoalMode): number | null {
  if (mode === 'maintain') return null
  return rateMonthlyToWeekly(Number(mode.split(':')[1]))
}

/** 活動量選單的五個固定係數；不是這四個之一就是「自訂」。回傳原始數字而不是選單用的
 *  字串，UI 層自己決定怎麼呈現——標籤文字（久坐/輕度…）是畫面用詞，不是這裡的事。 */
export const ACTIVITY_FACTOR_PRESETS = [1.2, 1.375, 1.55, 1.725] as const

export function activityChoiceFrom(af: number): number | 'custom' {
  const preset = ACTIVITY_FACTOR_PRESETS.find((p) => Math.abs(p - af) < 1e-9)
  return preset ?? 'custom'
}

/**
 * weightKg／bodyFatPct 一律取 weight 表最新一筆（呼叫端負責查）；bodyFatPct 那一筆若沒填
 * 傳 null，不找更舊的值——體脂率會隨時間變，用舊資料騙自己比老實承認沒有更糟。
 * today 只給測試注入固定日期用；正常呼叫不帶，年齡一律以目前時間計算。
 */
export function computeTargets(
  profile: Profile,
  weightKg: number,
  bodyFatPct: number | null,
  today: Date = new Date(),
): Targets {
  const age = ageFromYear(num(profile.birth_year), today)

  if (profile.use_custom_targets) {
    return {
      age, bmr: null, tdee: null,
      kcal: num(profile.custom_kcal),
      protein: num(profile.custom_protein_g),
      fat: num(profile.custom_fat_g),
      carb: num(profile.custom_carb_g),
    }
  }

  const h = num(profile.height_cm)
  const af = num(profile.activity_factor)
  const bmr = bodyFatPct !== null && Number.isFinite(bodyFatPct)
    ? 370 + 21.6 * weightKg * (1 - bodyFatPct / 100) // Katch-McArdle：去脂體重
    : 10 * weightKg + 6.25 * h - 5 * age + (profile.sex === 'male' ? 5 : -161) // Mifflin-St Jeor
  const tdee = bmr * af

  // rate 缺失或非數字時刻意不 fallback 成 0——goal≠maintain 卻沒有速度是資料不完整，
  // 讓它以 NaN 傳染到 kcal，App.tsx 既有的 Number.isFinite(t.kcal) 守門會擋下並顯示
  // 「目標熱量算不出來」，而不是靜默把減重/增肌算成維持態（precommit-review 抓到的
  // 真實案例：migration 沒補 rate_kg_per_week 的既有使用者會落入這個狀態）。
  // maintain 態不受影響——kcal 分支不讀 dailyDelta，rate 是否有值都無所謂。
  const rate = num(profile.rate_kg_per_week)
  const dailyDelta = (rate * KCAL_PER_KG) / 7
  const kcal = profile.goal === 'cut' ? tdee - dailyDelta
    : profile.goal === 'bulk' ? tdee + dailyDelta
    : tdee

  const protein = num(profile.protein_g_per_kg) * weightKg
  // 蛋白質熱量可能大於目標熱量（例如 rate/protein_g_per_kg 兩個獨立輸入剛好交叉），
  // 剩餘熱量不夾住 0 的話會變負數，脂肪／碳水目標跟著變負，rowOverage 會把每一筆
  // 食物都判成超標——夾住比讓它算出一個誤導性的負目標誠實。
  const remainingKcal = Math.max(0, kcal - protein * 4)
  const preset = GOAL_MACRO_PRESET[profile.goal]

  return {
    age, bmr, tdee, kcal, protein,
    fat: (remainingKcal * preset.fatPct / 100) / 9,
    carb: (remainingKcal * preset.carbPct / 100) / 4,
  }
}

/**
 * 小計一律由未捨入值加總，只在顯示時捨入。
 * 營養值取 intake 自己的快照欄，不取 foods——改食物庫的營養值不該改寫過去的紀錄。
 */
export function sumIntake(rows: IntakeAmount[]): IntakeTotals {
  const t: IntakeTotals = { kcal: 0, protein: 0, fat: 0, carb: 0 }
  for (const r of rows) {
    const q = num(r.qty)
    t.kcal += num(r.kcal) * q
    t.protein += num(r.protein) * q
    t.fat += num(r.fat) * q
    t.carb += num(r.carb) * q
  }
  return t
}

/** 進度條寬度／百分比。分母為 0 或 NaN 一律回 0，破表夾住 100。 */
export function pct(cur: number, target: number): number {
  if (!Number.isFinite(cur) || !Number.isFinite(target) || target <= 0) return 0
  return Math.min(100, Math.max(0, (cur / target) * 100))
}

export const roundTo1 = (n: number): number => Math.round(n * 10) / 10

/**
 * 破表判定要跟顯示同一個粒度（一位小數）判斷，否則 126.4/126 明明超了卻不判破表。
 */
export function macroExceeds(cur: number, target: number): boolean {
  return roundTo1(cur) > roundTo1(target)
}

/* 補記過去某天時「剩 479」是錯的語意——那天已經過完了，沒有「剩」可言，
   歷史日看的是加進去之後那天總共吃了多少。剩餘／超出不用正負號，避免「+594」
   被讀成「多攝取 594」。v2.10：熱量超標時「剩」讓位，超出量改掛在小計數字右邊
   （`(+40)`），deltaText 與 remainText 因此互斥，同時只有一個非空。 */
export function pickBarRight(isToday: boolean, eatenKcal: number, targetKcal: number, picksKcal: number) {
  if (!isToday) {
    const total = Math.round(eatenKcal + picksKcal)
    return { remainText: `共 ${total}`, deltaText: '', ariaLabel: `共 ${total} 大卡`, over: false }
  }
  const left = Math.round(targetKcal) - Math.round(eatenKcal + picksKcal)
  const over = left < 0
  return {
    remainText: over ? '' : `剩 ${left}`,
    deltaText: over ? `(+${-left})` : '',
    ariaLabel: over ? `超出 ${-left} 大卡` : `剩 ${left} 大卡`,
    over,
  }
}

export interface OverDelta {
  kcal: number
  fat: number
  carb: number
}

/* 逐筆超標預警（DESIGN.md v2.10）：把 add* 疊加到 base 上算會不會被推過線——
   不含蛋白質，它的語意是「達標」不是「超標」，走 pickBarRight／底部確認列那條。
   這一筆若已經算進 base（已勾選的情況），呼叫端傳 0/0/0，不重複疊加。 */
export function rowOverage(base: IntakeTotals, addKcal: number, addFat: number, addCarb: number, targets: Targets): OverDelta {
  const over = (cur: number, target: number) => Math.max(0, roundTo1(cur) - roundTo1(target))
  return {
    kcal: over(base.kcal + addKcal, targets.kcal),
    fat: over(base.fat + addFat, targets.fat),
    carb: over(base.carb + addCarb, targets.carb),
  }
}

/* 判定用 rowOverage 的 0.1 級精度（over.fat > 0 就代表「有超」），但顯示是整數——
   兩個精度沒對齊會讓 0.1~0.4 這種超標量捨入成 0，畫面印出「+0g脂」這種語意錯亂的東西
   （precommit review 抓到，2026-08-01）。兩支 format 函式都要用「捨到整數後還大於 0」
   當顯示開關，而不是原始值大於 0。 */

/** 「+26g脂 +32g碳」——不含熱量：kc 數字本身變色已經是熱量超標的訊號，sheet 底部的
 *  `(+40)` 也已經講了總計超出多少，delta 這裡再列一次「+110卡」會跟這兩處疊成三重複，
 *  使用者真機實測回報「看起來像同一件事講兩次」。只列真的觸發的，全部零回空字串
 *  （呼叫端據此決定要不要多畫一行）。只給視覺看——螢幕閱讀器要唸的版本見 formatOverAria，
 *  那邊沒有顏色可以借，熱量超標一樣要照唸。 */
export function formatOverDelta(over: OverDelta): string {
  const parts: string[] = []
  const fat = Math.round(over.fat)
  const carb = Math.round(over.carb)
  if (fat > 0) parts.push(`+${fat}g脂`)
  if (carb > 0) parts.push(`+${carb}g碳`)
  return parts.join(' ')
}

/** formatOverDelta 的口語版，給 aria-label 唸——三項都照唸，螢幕閱讀器使用者沒有
 *  「kc 數字變色」這個視覺捷徑可以借，熱量超標一樣要用文字講出來。 */
export function formatOverAria(over: OverDelta): string {
  const parts: string[] = []
  const kcal = Math.round(over.kcal)
  const fat = Math.round(over.fat)
  const carb = Math.round(over.carb)
  if (kcal > 0) parts.push(`熱量會超出 ${kcal} 大卡`)
  if (fat > 0) parts.push(`脂肪會超出 ${fat} 克`)
  if (carb > 0) parts.push(`碳水會超出 ${carb} 克`)
  return parts.join('，')
}

