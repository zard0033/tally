/* 目標熱量公式鏈：BMR（Mifflin-St Jeor）→ TDEE → 目標熱量 → 三大營養素。
   捨入時機、pct 的 clamp／驗證語意一律照 legacy/app.js 逐字搬，任何一個捨入點都不能改。 */
import { ageOn } from './dates'

export interface Profile {
  birth_date: string
  height_cm: number | string | null
  activity_factor: number | string | null
  sex: string
  goal: string
  protein_pct: number | string | null
  fat_pct: number | string | null
  carb_pct: number | string | null
}

export interface Targets {
  age: number
  bmr: number
  tdee: number
  kcal: number
  protein: number
  fat: number
  carb: number
}

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

/**
 * Mifflin-St Jeor → ×活動係數 → 目標調整。三大比例讀 profile。
 * today 只給測試注入固定日期用；正常呼叫不帶，年齡一律以目前時間計算（跟 legacy 一致）。
 */
export function computeTargets(profile: Profile, weightKg: number, today: Date = new Date()): Targets {
  const age = ageOn(profile.birth_date, today)
  const h = num(profile.height_cm)
  const af = num(profile.activity_factor)
  const bmr = 10 * weightKg + 6.25 * h - 5 * age + (profile.sex === 'male' ? 5 : -161)
  const tdee = bmr * af
  const kcal = profile.goal === 'cut' ? tdee * 0.8
    : profile.goal === 'bulk' ? tdee + 500
    : tdee
  return {
    age, bmr, tdee, kcal,
    protein: kcal * (num(profile.protein_pct) / 100) / 4,
    fat: kcal * (num(profile.fat_pct) / 100) / 9,
    carb: kcal * (num(profile.carb_pct) / 100) / 4,
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

export interface MacroPercentages {
  protein_pct: number
  fat_pct: number
  carb_pct: number
}

/**
 * DB 欄位是 numeric(4,1)，會先把每個值各自捨入到一位小數再檢查相加＝100。
 * 驗證要用同一個粒度，否則 33.33/33.33/33.34 前端算出剛好 100、存進去卻變成 99.9 被退回。
 */
export function normalizeMacroPercentages(p: MacroPercentages): MacroPercentages {
  return {
    protein_pct: roundTo1(p.protein_pct),
    fat_pct: roundTo1(p.fat_pct),
    carb_pct: roundTo1(p.carb_pct),
  }
}

/** 三大比例（各自先捨入到一位小數）相加是否等於 100。 */
export function macroPercentagesSumTo100(p: MacroPercentages): boolean {
  const n = normalizeMacroPercentages(p)
  return Math.abs(n.protein_pct + n.fat_pct + n.carb_pct - 100) <= 1e-9
}
