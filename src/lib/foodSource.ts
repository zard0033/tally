/* 食品庫的「來源」（spec「食品庫改版」第一步）：列上的小標，與「沒查證過」篩選的排序。純邏輯，不沾 DOM。 */
import type { FoodSource } from './api'

/** 列上的小標。只標查得到出處或 AI 估的；自己填與未標不標（每列都有字就沒有訊號了）。 */
export function sourceTag(s: FoodSource): string | null {
  return s === 'label' ? '標示' : s === 'official' ? '官方' : s === 'ai' ? '粗估' : null
}

/** 表單來源選擇器的選項（未標不在裡面：未標＝沒選）。 */
export const SOURCE_CHOICES: { key: FoodSource; label: string }[] = [
  { key: 'label', label: '標示' },
  { key: 'official', label: '官方' },
  { key: 'ai', label: 'AI 粗估' },
  { key: 'manual', label: '自己填' },
]

/** 「沒查證過」＝AI 粗估或未標。 */
export const isUnverified = (s: FoodSource): boolean => s === 'ai' || s === 'unknown'

/** 每樣食物在這段期間吃掉的熱量（快照熱量 × 份量）。 */
export function kcalByFood(rows: readonly { food_id: number; kcal: number; qty: number }[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of rows) m.set(r.food_id, (m.get(r.food_id) ?? 0) + Number(r.kcal) * Number(r.qty))
  return m
}

/** 沒查證過的食物，吃最多的在前；沒吃過的排最後、照品名。核對的順序就是這個——先核吃最多的。 */
export function rankUnverified<F extends { id: number; name: string; source: FoodSource }>(foods: readonly F[], eaten: ReadonlyMap<number, number>): F[] {
  return foods
    .filter((f) => isUnverified(f.source))
    .sort((a, b) => (eaten.get(b.id) ?? 0) - (eaten.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'zh-Hant'))
}
