/* 記一筆 sheet 的「還吃得下嗎」軟性排序。常吃、整組、搭配卡在 logMeal.ts（v2.167）。
   不沾 DOM，未來要原樣帶去 React Native。 */
import type { Food } from './api'
import { num, rowOverage, type IntakeTotals, type OverDelta, type Targets } from './formulas'

/* 軟性排序（v2.15，取代「篩選會清空清單」的疑慮；視覺降權在 v2.17 拿掉）：全部食物／搜尋結果
   依「加上這一筆還吃得下嗎」排前面。判斷基準刻意用 eaten（今日已吃，不含這次 sheet 內勾選中的
   品項）而不是 combined（含勾選中）——如果用 combined，使用者每勾一個東西整批清單就重新排序
   一次，手指還沒點完下一個就跳位，容易誤觸。逐列變色／kc-delta 維持用 combined 即時反應，
   這裡刻意跟那邊不同源，兩者互不干擾。「常吃」清單語意是「這餐平常都吃這些」，不重排；
   搜尋結果先照對到的程度（完全符合在前，v2.167），同一級才看這個。 */

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
export function byQuotaFit<T extends { id: number }>(list: T[], overAmounts: Map<number, OverDelta>): T[] {
  return [...list].sort((a, b) => {
    const oa = overAmounts.get(a.id)
    const ob = overAmounts.get(b.id)
    if (!oa !== !ob) return oa ? 1 : -1
    if (!oa || !ob) return 0
    return (oa.kcal + oa.fat + oa.carb) - (ob.kcal + ob.fat + ob.carb)
  })
}
