/* 餐建議第二版：候選一律是自己吃過的整餐（某一天某一餐的全部品項），差別只在怎麼挑——
   晚餐在能算缺口時依缺口挑（gap），其他時候挑同類日最常吃的（frequent），沒有重複過才退回上一次（last）。
   同類日＝平日對平日、假日對假日。純函式、不碰 DOM。規則與 AC 見 spec.md「C. 餐建議」的「第二版」。 */
import type { IntakeRow, NewIntake } from './api'
import { isWeekend, shiftDate } from './dates'
import { num, sumIntake, type Goal } from './formulas'
import { MEALS, type MealKey } from './meals'
import { normalizeQty } from './quantity'

/** 回看天數，含第 28 天（D-28 是同一個星期幾）。 */
export const REPEAT_LOOKBACK_DAYS = 28
/** 蛋白質差這麼多以內算「達標」（spec 第二版第 3 步；設計決定，沒有文獻給容差數字）。 */
export const PROTEIN_SLACK_G = 5
/** 維持與增肌的熱量上限＝缺口 × 這個倍數；減重＝缺口本身。 */
export const KCAL_CAP_RATIO = 1.1

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

/** gap＝依缺口挑（標「建議」）；frequent＝同類日出現 ≥ 2 次中最多次的（「常吃」）；last＝最近一個同類日（「上次」）。 */
export type SuggestSource = 'gap' | 'frequent' | 'last'

export interface RepeatSuggestion {
  sourceDate: string
  meal: MealKey
  items: RepeatItem[]
  /** Σ kcal×qty，不捨入。 */
  kcal: number
  source: SuggestSource
  /** 依缺口挑時超過熱量上限的卡數（已捨入、> 0）；沒超或不是 gap 是 null。 */
  overKcal: number | null
  /** 這一餐可以輪流換的候選數（gap 是排序後的全部，其他是 1）。 */
  total: number
}

/** 今日頁與 sheet 吃的：每餐目前顯示的那一組。 */
export type RepeatByMeal = Partial<Record<MealKey, RepeatSuggestion>>
/** 每餐排好序的候選；frequent／last 只有一組。 */
export type SuggestionsByMeal = Partial<Record<MealKey, RepeatSuggestion[]>>

/** 依缺口挑需要的東西；App 在檢視日不是今天或明天、或目標還沒算出來時傳 null。 */
export interface GapContext {
  targets: { kcal: number; protein: number; fat: number; carb: number }
  goal: Goal
}

/* 同批寫入的 created_at 相同，所以要靠 id。created_at 用字串比較，缺值排最前。 */
function bySourceOrder(a: RepeatSourceRow, b: RepeatSourceRow): number {
  const at = a.created_at ?? ''
  const bt = b.created_at ?? ''
  if (at !== bt) return at < bt ? -1 : 1
  return a.id - b.id
}

/** 一天一餐的整組。key＝food_id 集合（不看份量），判斷「同一組」用。 */
interface DayCombo {
  date: string
  key: string
  items: RepeatItem[]
  kcal: number
  protein: number
  fat: number
  carb: number
}

/* 回看窗內、檢視日之前、該餐別的每一天各成一組（新的在前）。食物已不存在的列略過，整天都略過就不算那天。 */
function combosOf(rows: RepeatSourceRow[], viewDate: string, meal: MealKey, sameDayType: boolean): DayCombo[] {
  const earliest = shiftDate(viewDate, -REPEAT_LOOKBACK_DAYS)
  const weekend = isWeekend(viewDate)
  const byDate = new Map<string, RepeatSourceRow[]>()
  for (const r of rows) {
    if (r.meal !== meal || r.eaten_on < earliest || r.eaten_on >= viewDate) continue
    if (sameDayType && isWeekend(r.eaten_on) !== weekend) continue
    byDate.set(r.eaten_on, [...(byDate.get(r.eaten_on) ?? []), r])
  }
  const combos: DayCombo[] = []
  for (const [date, dayRows] of byDate) {
    const items: RepeatItem[] = []
    for (const r of [...dayRows].sort(bySourceOrder)) {
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
    if (items.length === 0) continue
    const t = sumIntake(items)
    const key = [...new Set(items.map((i) => i.food_id))].sort((a, b) => a - b).join(',')
    combos.push({ date, key, items, ...t })
  }
  return combos.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/* 同一組只留最近那次（寫入與顯示用它的品項與份量），附上出現次數。輸入已是新的在前。 */
function dedupe(combos: DayCombo[]): { combo: DayCombo; count: number }[] {
  const seen = new Map<string, { combo: DayCombo; count: number }>()
  for (const c of combos) {
    const hit = seen.get(c.key)
    if (hit) hit.count += 1
    else seen.set(c.key, { combo: c, count: 1 })
  }
  return [...seen.values()]
}

function toSuggestion(c: DayCombo, meal: MealKey, source: SuggestSource, overKcal: number | null, total: number): RepeatSuggestion {
  return { sourceDate: c.date, meal, items: c.items, kcal: c.kcal, source, overKcal, total }
}

/** 常吃／上次：同類日裡出現 ≥ 2 次的組合挑最多次的（同次數取較近的）；沒有就是最近一天。 */
export function suggestRepeat(rows: RepeatSourceRow[], viewDate: string, meal: MealKey): RepeatSuggestion | null {
  const combos = combosOf(rows, viewDate, meal, true)
  if (combos.length === 0) return null
  // dedupe 保留第一次出現（＝最近）的順序，所以 reduce 取「嚴格更多」就是同次數取較近
  const best = dedupe(combos).reduce((a, b) => (b.count > a.count ? b : a))
  return best.count >= 2 ? toSuggestion(best.combo, meal, 'frequent', null, 1) : toSuggestion(combos[0], meal, 'last', null, 1)
}

/* 克數比較先捨到 0.1 g：已吃與份量相乘是浮點數，剛好補滿缺口的那組會差 1e-15 被當成超出。 */
const round1 = (v: number) => Math.round(v * 10) / 10
const overG = (value: number, gap: number) => Math.max(0, round1(value - gap))

/** 依缺口挑的排序（spec 第二版六步）。回傳排好的全部候選；熱量缺口 ≤ 0 或沒有候選回空陣列。 */
export function suggestByGap(
  rows: RepeatSourceRow[],
  viewDate: string,
  meal: MealKey,
  eaten: { kcal: number; protein: number; fat: number; carb: number },
  ctx: GapContext,
): RepeatSuggestion[] {
  // 缺口＝round(目標) − 已吃，與營養素條的「差 N」同一算法；這裡不捨入結果，比較時才不會兩組同分
  const gap = {
    kcal: Math.round(ctx.targets.kcal) - eaten.kcal,
    protein: Math.round(ctx.targets.protein) - eaten.protein,
    fat: Math.round(ctx.targets.fat) - eaten.fat,
    carb: Math.round(ctx.targets.carb) - eaten.carb,
  }
  if (!(gap.kcal > 0)) return []
  const cap = ctx.goal === 'cut' ? gap.kcal : gap.kcal * KCAL_CAP_RATIO
  const scored = dedupe(combosOf(rows, viewDate, meal, false)).map(({ combo, count }) => {
    const over = Math.round(combo.kcal - cap)
    return {
      combo,
      count,
      kcalOver: over > 0 ? over : 0,
      // 脂肪、碳水超出的部分換算成熱量相加（9／4），超一點點總比超很多好
      macroOver: overG(combo.fat, gap.fat) * 9 + overG(combo.carb, gap.carb) * 4,
      proteinOk: round1(combo.protein - gap.protein + PROTEIN_SLACK_G) >= 0,
    }
  })
  scored.sort(
    (a, b) =>
      a.kcalOver - b.kcalOver ||
      a.macroOver - b.macroOver ||
      Number(b.proteinOk) - Number(a.proteinOk) ||
      (a.proteinOk ? 0 : b.combo.protein - a.combo.protein) ||
      b.count - a.count ||
      Math.abs(gap.carb - a.combo.carb) - Math.abs(gap.carb - b.combo.carb) ||
      a.combo.fat - b.combo.fat ||
      (a.combo.date < b.combo.date ? 1 : a.combo.date > b.combo.date ? -1 : 0),
  )
  return scored.map((s) => toSuggestion(s.combo, meal, 'gap', s.kcalOver > 0 ? s.kcalOver : null, scored.length))
}

/** 每餐的候選：該餐已有紀錄就不給；資料還沒到（任一 null）回空物件。
 *  晚餐在 ctx 有值、早餐與午餐都有紀錄時依缺口挑，此時挑不到就整格不出，不退回常吃（常吃會超過缺口）。 */
export function suggestMeals(
  rows: RepeatSourceRow[] | null,
  viewDate: string,
  dayRows: IntakeRow[] | null,
  ctx: GapContext | null,
): SuggestionsByMeal {
  if (rows === null || dayRows === null) return {}
  const has = (m: MealKey) => dayRows.some((r) => r.meal === m)
  const byMeal: SuggestionsByMeal = {}
  for (const { key } of MEALS) {
    if (has(key)) continue
    if (key === 'dinner' && ctx && has('breakfast') && has('lunch')) {
      const ranked = suggestByGap(rows, viewDate, key, sumIntake(dayRows), ctx)
      if (ranked.length > 0) byMeal[key] = ranked
      continue
    }
    const suggestion = suggestRepeat(rows, viewDate, key)
    if (suggestion) byMeal[key] = [suggestion]
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
