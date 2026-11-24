/* 每一餐記店家（spec「每一餐記店家＋別名收一次」）：通用食物（店家欄留空）在這一筆紀錄上記「在哪買」，
   食品庫不動。別名可寫「店家 品名」，第一個空白前是店家。純邏輯，不沾 DOM。
   v2.162 起記一筆不再另外問店家：勾「店家 品名」別名那一列就連店家一起記（listRows，spec「記店家改版」）。 */
import { normalizeKey, splitAlias } from './foodMatch'

export { splitAlias }

/** 一筆紀錄的店家：食物本身有店家就用它（intake.vendor 不會寫），沒有才看這一筆記的。空字串當沒有。 */
export function rowVendor(r: { vendor?: string | null; foods: { vendor: string | null } | null }): string | null {
  return r.foods?.vendor?.trim() || r.vendor?.trim() || null
}

/** 別名裡寫到的店家（去重）。 */
export function aliasVendors(foods: readonly { aliases?: readonly string[] }[]): string[] {
  const out = new Set<string>()
  for (const f of foods) for (const a of f.aliases ?? []) {
    const v = splitAlias(a).vendor
    if (v) out.add(v)
  }
  return [...out]
}

/** 估一筆：句子裡出現的已知店家，取最長的（「麻古茶坊」先於「麻古」）；一個字的店家不認，誤中比對中多。 */
export function vendorInSentence(sentence: string, known: readonly string[]): string | null {
  const s = normalizeKey(sentence)
  let best: string | null = null
  for (const v of known) {
    const k = normalizeKey(v)
    if ([...k].length < 2 || !s.includes(k)) continue
    if (!best || [...k].length > [...normalizeKey(best)].length) best = v
  }
  return best
}

/** 寫進 intake.vendor 的值：食物本身有店家就不寫（null），空白當沒有。 */
export function intakeVendor(food: { vendor: string | null }, picked: string | null | undefined): string | null {
  if (food.vendor) return null
  return clampVendor(picked ?? '') || null
}

/** 去頭尾空白、截到 40 個字（照字算，不切斷 emoji 這類兩個 UTF-16 單位的字）。 */
export function clampVendor(s: string): string {
  return Array.from(s.trim()).slice(0, VENDOR_MAX).join('')
}

/** DB check：1–40 字。 */
export const VENDOR_MAX = 40
