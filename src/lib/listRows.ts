/* 記一筆清單的「列」（spec「記店家改版」，v2.162）：通用食物的每個「店家 品名」別名各自是一列，
   長得跟有店家的食物一樣（品名＋店家），勾了就連店家一起記；營養數字用背後那筆通用食物。
   列的 key 取代 food_id 當勾選狀態的鍵——同一筆通用食物會同時有好幾列（麻古的紅萱波波、青山的菜燕春青）。
   純邏輯，不沾 DOM。 */
import { ALIAS_LEN_MAX, ALIAS_MAX } from './foodForm'
import { aliasIncludes, normalizeKey, splitAlias } from './foodMatch'
import { clampVendor } from './mealVendor'

/** 列需要的食物欄位（Food 的子集，測試不用造整筆）。 */
export interface RowFood {
  id: number
  name: string
  vendor: string | null
  category: string | null
  aliases?: readonly string[]
  archived?: boolean
}

/** 「店家 品名」別名拆開的樣子。 */
export interface VendorAlias {
  /** 別名原字串（「麻古 紅萱波波」），列的 key 用它，所以食品庫改別名時舊 key 自然失效。 */
  alias: string
  vendor: string
  item: string
}

export interface ListRow<F extends RowFood = RowFood> {
  key: string
  /** 背後那筆食物的 id（營養、微調基準、軟性排序都看它）。 */
  id: number
  /** 分組用的類型（同那筆食物）。 */
  category: string | null
  food: F
  /** 列上寫的品名：別名列是別名的品名段，食物列是食物本身的品名。 */
  name: string
  /** 列上寫的店家：別名列是別名的店家段，食物列是食物本身的店家。 */
  vendor: string | null
  /** 別名列才有。 */
  alias: VendorAlias | null
}

export const foodKey = (id: number): string => `f:${id}`
export const aliasKey = (id: number, alias: string): string => `a:${id}:${alias}`
/** 自己記了品名或店家、卻對不上任何別名的紀錄（v2.161 的舊紀錄、新店卡沒勾記住的）：獨立一列，不搶食物列（不然建議段勾它會把通用那列換成別的名字）。 */
export const recordKey = (id: number, name: string | null, vendor: string | null): string => `r:${id}:${vendor ?? ''}|${name ?? ''}`

/** 列 key 背後的食物 id。 */
export function foodIdOf(key: string): number {
  const m = /^[far]:(\d+)/.exec(key)
  if (!m) throw new Error(`not a row key: ${key}`)
  return Number(m[1])
}

/** 一筆食物裡有店家段的別名。食物本身有店家就沒有（那是另一家的食物，別名只幫忙搜尋）。 */
export function vendorAliases(f: Pick<RowFood, 'vendor' | 'aliases'>): VendorAlias[] {
  if (f.vendor) return []
  const out: VendorAlias[] = []
  for (const a of f.aliases ?? []) {
    const { vendor, item } = splitAlias(a)
    if (vendor) out.push({ alias: a, vendor, item })
  }
  return out
}

/** 通用食物：本身沒店家、掛了「店家 品名」別名。它自己那列放到清單最下面「通用（說不出哪家）」。 */
export const isGeneric = (f: Pick<RowFood, 'vendor' | 'aliases'>): boolean => vendorAliases(f).length > 0

export function foodRow<F extends RowFood>(f: F): ListRow<F> {
  return { key: foodKey(f.id), id: f.id, category: f.category, food: f, name: f.name, vendor: f.vendor, alias: null }
}

export function aliasRow<F extends RowFood>(f: F, a: VendorAlias): ListRow<F> {
  return { key: aliasKey(f.id, a.alias), id: f.id, category: f.category, food: f, name: a.item, vendor: a.vendor, alias: a }
}

/** 一筆食物展開成的別名列（照別名的順序）。 */
export const aliasRowsOf = <F extends RowFood>(f: F): ListRow<F>[] => vendorAliases(f).map((a) => aliasRow(f, a))

/** 寫進 intake 的品名與店家，一條規則管所有列：列上的品名跟食物不同才記（別名列的「紅萱波波」、新店卡的「冬瓜檸檬」）；
 *  店家只在食物本身沒店家時記（v2.161 的 intakeVendor 語意）。食物列兩個都不記（null＝沿用 foods.name、店家看 foods.vendor）。 */
export function rowIntake(row: Pick<ListRow, 'name' | 'vendor'> & { food: Pick<RowFood, 'name' | 'vendor'> }): { name: string | null; vendor: string | null } {
  return { name: row.name !== row.food.name ? row.name : null, vendor: row.food.vendor ? null : row.vendor }
}

/** 一筆紀錄自己的列（對不上別名、但記了品名或店家）。 */
export function recordRow<F extends RowFood>(f: F, name: string | null, vendor: string | null): ListRow<F> {
  return { key: recordKey(f.id, name, vendor), id: f.id, category: f.category, food: f, name: name ?? f.name, vendor: f.vendor ?? vendor, alias: null }
}

/** 新店卡勾的那一列（spec 甲3）：搜尋字有店家段就是別名列（記住之後食品庫也會長出同一個 key），沒有就是只記品名的紀錄列。
 *  店家照 DB 的界截到 40 字（clampVendor）。 */
export function shopRow<F extends RowFood>(f: F, q: string): ListRow<F> {
  const text = normAlias(q)
  const { vendor, item } = splitAlias(text)
  if (vendor) {
    const v = clampVendor(vendor)
    return v === vendor ? aliasRow(f, { alias: text, vendor, item }) : recordRow(f, item, v)
  }
  return recordRow(f, item, null)
}

/**
 * 一筆紀錄對應到哪一列：記的品名＋店家對得上那筆食物的某個「店家 品名」別名 → 那個別名列；品名與店家都沒記 → 食物列；
 * 其餘（記了但對不上任何別名）→ 那筆紀錄自己的列（recordKey）。「最近記過」「照上次」「建議段」都用這個把紀錄接回清單上的列。
 * 比對照正規化（全形空白、大小寫不計）。
 */
export function rowKeyOfIntake(r: { food_id: number; name?: string | null; vendor?: string | null }, food: Pick<RowFood, 'vendor' | 'aliases'> | undefined): string {
  const name = r.name?.trim() || null
  const vendor = r.vendor?.trim() || null
  if (!name && !vendor) return foodKey(r.food_id)
  if (food && name && vendor) {
    const hit = vendorAliases(food).find((a) => normalizeKey(a.item) === normalizeKey(name) && normalizeKey(a.vendor) === normalizeKey(vendor))
    if (hit) return aliasKey(r.food_id, hit.alias)
  }
  return recordKey(r.food_id, name, vendor)
}

/**
 * 搜尋：哪些列出現。
 * - 別名列：搜尋字在那個別名裡（「麻古」「紅萱」「麻古紅萱」都算）。
 * - 通用食物自己那列：只在搜尋字對到它自己的品名、或沒有店家段的舊式別名時出現（spec：搜「麻古」不該冒出「手搖飲（…）」）。
 * - 其他食物照舊（品名、店家、別名，`matches`）。
 */
export function searchRows<F extends RowFood>(foods: readonly F[], q: string, matches: (f: F, q: string) => boolean): ListRow<F>[] {
  const s = q.trim()
  if (!s) return []
  const out: ListRow<F>[] = []
  for (const f of foods) {
    const aliasRows = aliasRowsOf(f)
    if (aliasRows.length === 0) {
      if (matches(f, s)) out.push(foodRow(f))
      continue
    }
    const plain = (f.aliases ?? []).filter((a) => !splitAlias(a).vendor)
    if (aliasIncludes(f.name, s) || plain.some((a) => aliasIncludes(a, s))) out.push(foodRow(f))
    for (const r of aliasRows) if (r.alias && aliasIncludes(r.alias.alias, s)) out.push(r)
  }
  return out
}

/** 新店第一次：搜尋字切成店家＋品名（第一個空白前＝店家，同別名規則）；沒有空白就只有品名。 */
export function parseShopQuery(q: string): { vendor: string | null; item: string } {
  return splitAlias(q.normalize('NFKC'))
}

/** 「跟哪一樣差不多？」的候選：使用中、掛了店家別名的通用食物，最近記過的在前（rank 越小越近），沒記過的照品名。 */
export function genericCandidates<F extends RowFood>(foods: readonly F[], rank: ReadonlyMap<number, number>): F[] {
  const r = (f: F) => rank.get(f.id) ?? Infinity
  return foods
    .filter((f) => !f.archived && isGeneric(f))
    .sort((a, b) => r(a) - r(b) || a.name.localeCompare(b.name, 'zh-Hant-u-co-stroke'))
}

/** 別名存的樣子：全形轉半形、去頭尾、連續空白收成一個（key 也用它，記住前後才對得上同一列）。 */
const normAlias = (q: string): string => q.normalize('NFKC').trim().replace(/\s+/g, ' ')

/** 「記住」為什麼不行（同食品庫表單的別名規則）；null＝可以。 */
export function aliasProblem(aliases: readonly string[], text: string): 'full' | 'long' | 'separator' | 'exists' | null {
  const t = normAlias(text)
  if (/[、，,]/.test(t)) return 'separator' // 食品庫表單照這三個符號切別名，存進去之後一編輯就被拆開
  if ([...t].length > ALIAS_LEN_MAX) return 'long'
  if (aliases.some((a) => normalizeKey(a) === normalizeKey(t))) return 'exists'
  if (aliases.length >= ALIAS_MAX) return 'full'
  return null
}

/** 「記住」：把搜尋字加成別名，回新的別名陣列；不行就回原因（aliasProblem），照記、不加。 */
export function withAlias(aliases: readonly string[], text: string): string[] | NonNullable<ReturnType<typeof aliasProblem>> {
  return aliasProblem(aliases, text) ?? [...aliases, normAlias(text)]
}
