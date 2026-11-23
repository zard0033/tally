/* 食品庫的「來源」：列上的小標，與「粗估」篩選的排序。純邏輯，不沾 DOM。
   2026-11-23 使用者把四種（標示／官方／AI 粗估／自己填）併成兩種：這個欄位只回答「這個數字能不能信、
   還沒核對的有哪些」，標示與官方對他沒有差別；不是按 AI 估的，都是他照產品標示或官方資料打的。 */

/** 列上的小標：兩邊都標（使用者 2026-11-23：只標粗估時，沒標的看不出是官方還是忘了標）。
 *  外觀輕重不同（樣張 portion-mods.html 乙）：官方＝主色打勾＋字、無底色；粗估＝灰底小標。 */
export const sourceTag = (verified: boolean): string => (verified ? '官方' : '粗估')

/** 表單來源選擇器的兩格；key 與 verified 互轉見 FoodFormFields。 */
export type SourceKey = 'verified' | 'rough'
export const SOURCE_CHOICES: { key: SourceKey; label: string }[] = [
  { key: 'verified', label: '官方標示' },
  { key: 'rough', label: '粗估' },
]

/** 每樣食物在這段期間吃掉的熱量（快照熱量 × 份量）。 */
export function kcalByFood(rows: readonly { food_id: number; kcal: number; qty: number }[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of rows) m.set(r.food_id, (m.get(r.food_id) ?? 0) + Number(r.kcal) * Number(r.qty))
  return m
}

/** 粗估的食物，吃最多的在前；沒吃過的排最後、照品名。核對的順序就是這個——先核吃最多的。 */
export function rankUnverified<F extends { id: number; name: string; verified: boolean }>(foods: readonly F[], eaten: ReadonlyMap<number, number>): F[] {
  return foods
    .filter((f) => !f.verified)
    .sort((a, b) => (eaten.get(b.id) ?? 0) - (eaten.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'zh-Hant'))
}
