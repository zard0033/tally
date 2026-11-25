/* 「店家 品名」別名（spec「記店家改版」，v2.162）：通用食物（本身沒店家）的別名可寫「麻古 紅萱波波」，
   搜尋時各自是一列（品名段＋店家段），勾了記那個品名與店家；營養數字用背後那筆通用食物。
   v2.167 起新的店家一律記在紀錄上、不再長出這種別名（spec「記一筆重做」），已經掛好的照常運作。
   以及別名收不收的規則（叫法、存進食品庫的別名共用）。純邏輯，不沾 DOM。 */
import { ALIAS_LEN_MAX, ALIAS_MAX } from './foodForm'
import { normalizeKey, splitAlias } from './foodMatch'

/** 「店家 品名」別名拆開的樣子。 */
export interface VendorAlias {
  /** 別名原字串（「麻古 紅萱波波」）。 */
  alias: string
  vendor: string
  item: string
}

/** 一筆食物裡有店家段的別名。食物本身有店家就沒有（那是另一家的食物，別名只幫忙搜尋）。 */
export function vendorAliases(f: { vendor: string | null; aliases?: readonly string[] }): VendorAlias[] {
  if (f.vendor) return []
  const out: VendorAlias[] = []
  for (const a of f.aliases ?? []) {
    const { vendor, item } = splitAlias(a)
    if (vendor) out.push({ alias: a, vendor, item })
  }
  return out
}

/** 別名存的樣子：全形轉半形、去頭尾、連續空白收成一個。 */
const normAlias = (q: string): string => q.normalize('NFKC').trim().replace(/\s+/g, ' ')

/** 這個字能不能加成別名（同食品庫表單的別名規則）；null＝可以。 */
export function aliasProblem(aliases: readonly string[], text: string): 'full' | 'long' | 'separator' | 'exists' | null {
  const t = normAlias(text)
  if (/[、，,]/.test(t)) return 'separator' // 食品庫表單照這三個符號切別名，存進去之後一編輯就被拆開
  if ([...t].length > ALIAS_LEN_MAX) return 'long'
  if (aliases.some((a) => normalizeKey(a) === normalizeKey(t))) return 'exists'
  if (aliases.length >= ALIAS_MAX) return 'full'
  return null
}
