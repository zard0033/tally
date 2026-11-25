/* 每一餐記店家（spec「每一餐記店家＋別名收一次」）：在這一筆紀錄上記「在哪買」，食品庫不動。
   別名可寫「店家 品名」，第一個空白前是店家。純邏輯，不沾 DOM。
   v2.167 起記一筆框裡打的店名照記在紀錄上，就算食物本身有店家（spec「記一筆重做」，改 v2.161）。 */
import { splitAlias } from './foodMatch'

export { splitAlias }

/** 一筆紀錄的店家：這一筆記的優先（v2.167 起框裡打的店名照記，就算食物本身有店家——同一顆茶葉蛋在全家、7-11 都買），
 *  沒記才用食物本身的。空字串當沒有。 */
export function rowVendor(r: { vendor?: string | null; foods: { vendor: string | null } | null }): string | null {
  return r.vendor?.trim() || r.foods?.vendor?.trim() || null
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

/** 去頭尾空白、截到 40 個字（照字算，不切斷 emoji 這類兩個 UTF-16 單位的字）。 */
export function clampVendor(s: string): string {
  return Array.from(s.trim()).slice(0, VENDOR_MAX).join('')
}

/** DB check：1–40 字。 */
export const VENDOR_MAX = 40
