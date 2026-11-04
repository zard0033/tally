/* 餐建議 R（重複的餐）：從最近的紀錄找「同類日」的同一餐，當成這一餐的建議。純函式、不碰 DOM。
   同類日＝平日對平日、假日對假日。規則與 AC 見 spec.md「C. 餐建議」。 */
import type { IntakeRow, NewIntake } from './api'
import { isWeekend, shiftDate } from './dates'
import { num } from './formulas'
import { MEALS, type MealKey } from './meals'
import { normalizeQty } from './quantity'

/** 回看天數，含第 14 天（D-14 是同一個星期幾）。 */
export const REPEAT_LOOKBACK_DAYS = 14

/** 回看查詢的一列。營養值是單份快照；foods 是 null＝食物已不存在。 */
export interface RepeatSourceRow {
  id: number
  eaten_on: string
  meal: MealKey
  food_id: number
  qty: number
  kcal: number
  protein: number
  fat: number
  carb: number
  name: string | null
  created_at?: string
  foods: { name: string; vendor: string | null; archived: boolean } | null
}

export interface RepeatItem {
  food_id: number
  qty: number
  kcal: number
  protein: number
  fat: number
  carb: number
  /** 寫入用的快照，來源是 null 就寫 null，不可把 foods.name 寫進去。 */
  name: string | null
  /** 顯示用：row.name ?? foods.name。 */
  label: string
  vendor: string | null
  archived: boolean
}

export interface RepeatSuggestion {
  sourceDate: string
  meal: MealKey
  items: RepeatItem[]
  /** Σ kcal×qty，不捨入。 */
  kcal: number
}

export type RepeatByMeal = Partial<Record<MealKey, RepeatSuggestion>>

/* 同批寫入的 created_at 相同，所以要靠 id。created_at 用字串比較，缺值排最前。 */
function bySourceOrder(a: RepeatSourceRow, b: RepeatSourceRow): number {
  const at = a.created_at ?? ''
  const bt = b.created_at ?? ''
  if (at !== bt) return at < bt ? -1 : 1
  return a.id - b.id
}

/** 檢視日這一餐的建議：最近一個有該餐紀錄的同類日。來源那天的品項全被刪就回 null，不往更舊的日子找。 */
export function suggestRepeat(rows: RepeatSourceRow[], viewDate: string, meal: MealKey): RepeatSuggestion | null {
  const earliest = shiftDate(viewDate, -REPEAT_LOOKBACK_DAYS)
  const weekend = isWeekend(viewDate)
  const candidates = rows.filter(
    (r) => r.meal === meal && r.eaten_on >= earliest && r.eaten_on < viewDate && isWeekend(r.eaten_on) === weekend,
  )
  if (candidates.length === 0) return null

  const sourceDate = candidates.reduce((latest, r) => (r.eaten_on > latest ? r.eaten_on : latest), '')
  const items: RepeatItem[] = []
  for (const r of candidates.filter((c) => c.eaten_on === sourceDate).sort(bySourceOrder)) {
    if (!r.foods) continue
    items.push({
      food_id: r.food_id,
      qty: num(r.qty),
      kcal: num(r.kcal),
      protein: num(r.protein),
      fat: num(r.fat),
      carb: num(r.carb),
      name: r.name,
      label: r.name ?? r.foods.name,
      vendor: r.foods.vendor,
      archived: r.foods.archived,
    })
  }
  if (items.length === 0) return null

  return { sourceDate, meal, items, kcal: items.reduce((sum, i) => sum + i.kcal * i.qty, 0) }
}

/** 今日頁與 sheet 共用的一份：該餐已有紀錄就不給。資料還沒到（任一 null）回空物件。 */
export function suggestRepeatByMeal(
  rows: RepeatSourceRow[] | null,
  viewDate: string,
  dayRows: IntakeRow[] | null,
): RepeatByMeal {
  if (rows === null || dayRows === null) return {}
  const byMeal: RepeatByMeal = {}
  for (const { key } of MEALS) {
    if (dayRows.some((r) => r.meal === key)) continue
    const suggestion = suggestRepeat(rows, viewDate, key)
    if (suggestion) byMeal[key] = suggestion
  }
  return byMeal
}

/** 要寫入的列：快照一律取自來源，eaten_on 與 meal 取自檢視日與餐別。 */
export function repeatToIntake(s: RepeatSuggestion, date: string): NewIntake[] {
  return s.items.map((i) => ({
    eaten_on: date,
    meal: s.meal,
    food_id: i.food_id,
    qty: i.qty,
    kcal: i.kcal,
    protein: i.protein,
    fat: i.fat,
    carb: i.carb,
    name: i.name,
  }))
}

/** 「乳清（1匙） ×2・無糖豆漿」，份量不是 1 才加 ×N。 */
export function suggestLabel(s: RepeatSuggestion): string {
  return s.items.map((i) => (i.qty === 1 ? i.label : `${i.label} ×${i.qty}`)).join('・')
}

/** sheet 的勾選以 food_id 為鍵，同食物要合併：份量相加、其餘取第一列。 */
export function mergeByFood(items: RepeatItem[]): RepeatItem[] {
  const merged = new Map<number, RepeatItem>()
  for (const item of items) {
    const first = merged.get(item.food_id)
    merged.set(item.food_id, first ? { ...first, qty: normalizeQty(first.qty + item.qty) } : item)
  }
  return [...merged.values()]
}
