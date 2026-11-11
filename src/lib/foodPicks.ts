/* 記一筆 sheet 的挑選邏輯：已選小計、「常吃」排名與最近份量、「還吃得下嗎」的軟性排序。
   原本長在 LogSheet.tsx 裡，抽出來才能單測；不沾 DOM，未來要原樣帶去 React Native。 */
import type { Food, RecentIntakeRow } from './api'
import { categoryOf, FOOD_CATEGORIES, type FoodCategory } from './categories'
import { num, rowOverage, sumIntake, type IntakeTotals, type OverDelta, type Targets } from './formulas'
import { MEALS, type MealKey } from './meals'

/** 已勾選品項的營養小計與樣數；查不到的 id（例如剛被封存）略過，不算進樣數。 */
export function pickTotals(
  picks: Map<number, number>,
  foodById: (id: number) => Food | undefined,
): IntakeTotals & { n: number } {
  const amounts = [...picks]
    .map(([id, qty]) => ({ f: foodById(id), qty }))
    .filter((x): x is { f: Food; qty: number } => !!x.f)
  const totals = sumIntake(amounts.map(({ f, qty }) => ({ qty, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb })))
  return { n: amounts.length, ...totals }
}

/** 「常吃」＝該餐別歷史出現次數（多的排前面，同次數維持歷史出現順序），
 *  順便記住每個「餐別:食物」最近一次的份量。hist 要由新到舊排（listRecentIntake 的順序），
 *  第一次見到的 key 才是「最近一次」。 */
export function recentStats(hist: RecentIntakeRow[]): {
  recent: Map<MealKey, number[]>
  lastQty: Map<string, number>
  /** 餐別 → 食物 → 次數。sheet 依類型分組的組序用（同一份歷史，不另外查）。 */
  counts: Map<MealKey, Map<number, number>>
} {
  const byMeal = new Map<MealKey, Map<number, number>>(MEALS.map((m) => [m.key, new Map()]))
  const lastQty = new Map<string, number>()
  for (const r of hist) {
    const key = `${r.meal}:${r.food_id}`
    if (!lastQty.has(key)) lastQty.set(key, num(r.qty))
    const c = byMeal.get(r.meal)
    if (c) c.set(r.food_id, (c.get(r.food_id) ?? 0) + 1)
  }
  const recent = new Map([...byMeal].map(([k, counts]) => [k, [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id)] as [MealKey, number[]]))
  return { recent, lastQty, counts: byMeal }
}

/* ── 「全部食物」依類型分組（spec.md C 節第三版）──
   清單用標示、建議用排序：組序只看「這一餐吃過幾次」，吃過的提示（徽章）不改組序。 */

export interface FoodGroup {
  /** null＝還沒分類，也是一組。 */
  category: FoodCategory | null
  /** 照傳進來的順序（呼叫端先排好「吃得下的在前、再照品名」）。 */
  foods: Food[]
  /** 這一餐吃過這一類幾次。 */
  count: number
}

export interface GroupedFoods {
  /** 這一餐吃過的類型（次數多的在前），接著是哪一餐都沒吃過的（新加的食物）。 */
  main: FoodGroup[]
  /** 只在其他餐吃過的類型：沉到最底、收合。這一餐還沒有任何歷史時是空的（不收）。 */
  elsewhere: FoodGroup[]
}

const categoryRank = (c: FoodCategory | null) => (c === null ? FOOD_CATEGORIES.length : FOOD_CATEGORIES.indexOf(c))

/** list＝要分組的食物（已排好序）；categoryById 要查得到歷史裡的食物（含不在 list 裡的，例如已勾、常吃那幾樣）。
 *  查不到的 food_id（已封存、已刪）不算次數。同次數照固定清單的順序，未分類排最後。 */
export function groupByCategory(
  list: Food[],
  meal: MealKey | null,
  counts: Map<MealKey, Map<number, number>>,
  categoryById: (id: number) => FoodCategory | null | undefined,
): GroupedFoods {
  const tally = (m: MealKey) => {
    const out = new Map<FoodCategory | null, number>()
    for (const [id, n] of counts.get(m) ?? []) {
      const c = categoryById(id)
      if (c !== undefined) out.set(c, (out.get(c) ?? 0) + n)
    }
    return out
  }
  const here = meal ? tally(meal) : new Map<FoodCategory | null, number>()
  const elsewhereCats = new Set<FoodCategory | null>()
  // 這一餐還沒有任何歷史（例如從沒記過點心）就不收：否則吃過的類型全被收起來，清單只剩沒吃過的
  for (const m of here.size > 0 ? MEALS : []) {
    if (m.key === meal) continue
    for (const c of tally(m.key).keys()) if (!here.has(c)) elsewhereCats.add(c)
  }

  const byCat = new Map<FoodCategory | null, Food[]>()
  for (const f of list) {
    const c = categoryOf(f.category)
    const arr = byCat.get(c)
    if (arr) arr.push(f)
    else byCat.set(c, [f])
  }
  const groups = [...byCat].map(([category, foods]) => ({ category, foods, count: here.get(category) ?? 0 }))
  groups.sort((a, b) => b.count - a.count || categoryRank(a.category) - categoryRank(b.category))
  return {
    main: groups.filter((g) => !elsewhereCats.has(g.category)),
    elsewhere: groups.filter((g) => elsewhereCats.has(g.category)),
  }
}

/** 勾選時的預設份量：該餐上次吃這樣東西的份量，沒有（或不是正數）就 1。 */
export function defaultQty(lastQty: Map<string, number>, meal: MealKey | null, foodId: number): number {
  if (!meal) return 1
  const q = lastQty.get(`${meal}:${foodId}`)
  return Number.isFinite(q) && (q as number) > 0 ? (q as number) : 1
}

/* 軟性排序（v2.15，取代「篩選會清空清單」的疑慮；視覺降權在 v2.17 拿掉）：全部食物／搜尋結果
   依「加上這一筆還吃得下嗎」排前面。判斷基準刻意用 eaten（今日已吃，不含這次 sheet 內勾選中的
   品項）而不是 combined（含勾選中）——如果用 combined，使用者每勾一個東西整批清單就重新排序
   一次，手指還沒點完下一個就跳位，容易誤觸。逐列變色／kc-delta 維持用 combined 即時反應，
   這裡刻意跟那邊不同源，兩者互不干擾。「常吃」清單語意是「這餐平常都吃這些」，不重排。 */

/** 這一筆以 qty 份加進「今日已吃」會超標多少。 */
export function quotaOverage(f: Food, qty: number, eaten: IntakeTotals, targets: Targets): OverDelta {
  return rowOverage(eaten, num(f.kcal) * qty, num(f.fat) * qty, num(f.carb) * qty, targets)
}

/** 會超標的品項 → 超標量；吃得下的不收。超標品項的 OverDelta 順便存起來給 byQuotaFit 的
 *  排序分數用，不必為了 tie-break 對同一筆再呼叫一次 quotaOverage（precommit-review 抓到的重複運算）。 */
export function overQuotaAmounts(
  foods: Food[],
  qtyOf: (f: Food) => number,
  eaten: IntakeTotals,
  targets: Targets,
): Map<number, OverDelta> {
  const amounts = new Map<number, OverDelta>()
  for (const f of foods) {
    const over = quotaOverage(f, qtyOf(f), eaten, targets)
    if (over.kcal !== 0 || over.fat !== 0 || over.carb !== 0) amounts.set(f.id, over)
  }
  return amounts
}

/** 符合的排前面（維持原本順序，Array.sort 穩定排序）；不符合的排後面，按超出總量
 *  （kcal ＋ 脂 ＋ 碳，三個單位不同但只拿來排序不顯示，不必為排序另外換算成同一單位）由小到大。 */
export function byQuotaFit(list: Food[], overAmounts: Map<number, OverDelta>): Food[] {
  return [...list].sort((a, b) => {
    const oa = overAmounts.get(a.id)
    const ob = overAmounts.get(b.id)
    if (!oa !== !ob) return oa ? 1 : -1
    if (!oa || !ob) return 0
    return (oa.kcal + oa.fat + oa.carb) - (ob.kcal + ob.fat + ob.carb)
  })
}
