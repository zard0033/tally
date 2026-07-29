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
