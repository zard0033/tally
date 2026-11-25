/* 記一筆的「這一餐」（spec「記一筆重做：兩個情境」，v2.167）：每一樣是一列，三種來源——
   食品庫的（常吃、整組、搜尋、你在那家記過的、食品庫頁、搭配卡）、AI 估的、只記熱量的。
   這裡管：同一樣的身分（key）、勾了要記成什麼（叫法、店家、代替）、加入時寫什麼、估好的存進食品庫怎麼存，
   以及常吃、整組（上次這一餐）、搭配卡的候選。純邏輯，不沾 DOM。 */
import type { Food, NewFood, NewIntake } from './api'
import { categoryOf, isMealType, type FoodCategory } from './categories'
import { isWeekend } from './dates'
import { draftToFood, isManualDraft, type EstimateDraft } from './estimate'
import { pickBest } from './foodMatch'
import { num } from './formulas'
import { foldKey, learnableAlias, relationOf, type BoxQuery, type LogRecord } from './logFind'
import { clampVendor } from './mealVendor'
import type { MealKey } from './meals'
import { applyMods, normalizeMods, type Macros } from './portionMods'
import { normalizeQty } from './quantity'

/** 這一餐用到的食物欄位（Food 的子集，測試不用造整筆）。 */
export type MealFood = Pick<Food, 'id' | 'name' | 'vendor' | 'kcal' | 'protein' | 'fat' | 'carb' | 'category' | 'aliases'>

/** 食品庫的一樣。 */
export interface LibItem {
  id: string
  kind: 'lib'
  /** 同一樣的身分（pickKey）：找東西的列看它決定 ＋ 還是 ✓。 */
  key: string
  foodId: number
  qty: number
  /** 份量框正在打的字（打到一半的「1.」不馬上正規化）。 */
  qtyDraft: string
  mods: string[]
  /** 紀錄的品名：null＝沿用食物的；代替時是你打的那個。 */
  name: string | null
  /** 紀錄的店家：null＝沿用食物的。 */
  vendor: string | null
  /** 你的叫法：加入成功後加成這筆食物的別名（畫面上不出現）。 */
  alias: string | null
}

/** AI 估好的、或只記熱量的一樣。 */
export interface DraftItem {
  id: string
  kind: 'draft'
  draft: EstimateDraft
  qty: number
  qtyDraft: string
  /** 框裡打的店名：只記在紀錄上。 */
  vendor: string | null
  /** 送去估的品名（不含店名）；AI 一次回好幾樣時是 null——一句話不是其中任何一樣的叫法。 */
  typed: string | null
  /** 已經存好的食品庫那一筆（加入失敗等重試時不再存第二次）；它的別名要等加入成功才加。 */
  saved: { foodId: number; alias: string | null } | null
}

/** 送去 AI 估、還沒回來或估不出來的一樣。 */
export interface EstItem {
  id: string
  kind: 'est'
  /** 送去估的品名（不含店名）。 */
  text: string
  /** 框裡打的店名。 */
  store: string | null
  status: 'busy' | 'error'
  startedAt: number | null
}

export type MealItem = LibItem | DraftItem | EstItem

let seq = 0
export const newItemId = (): string => `mi-${++seq}`

/** 同一樣的身分：食物＋紀錄的品名＋紀錄的店家（跟食物本身一樣的當沒寫）。 */
export function pickKey(food: Pick<MealFood, 'id' | 'name' | 'vendor'>, name: string | null, vendor: string | null): string {
  const n = name && foldKey(name) !== foldKey(food.name) ? foldKey(name) : ''
  const v = vendor && foldKey(vendor) !== foldKey(food.vendor ?? '') ? foldKey(vendor) : ''
  return `${food.id}|${n}|${v}`
}

/** 品名、店家跟食物本身一樣的收成 null（寫進 intake 才不會多一份重複的快照）。 */
function own(food: Pick<MealFood, 'name' | 'vendor'>, name: string | null, vendor: string | null) {
  const n = name?.trim() || null
  const v = vendor?.trim() ? clampVendor(vendor) : null
  return {
    name: n && foldKey(n) !== foldKey(food.name) ? n : null,
    vendor: v && foldKey(v) !== foldKey(food.vendor ?? '') ? v : null,
  }
}

/** 食品庫的一樣。份量預設 1；微調清掉這樣食物不適用的。 */
export function libItem(
  food: MealFood,
  opts: { name?: string | null; vendor?: string | null; qty?: number; mods?: readonly string[]; alias?: string | null } = {},
): LibItem {
  const { name, vendor } = own(food, opts.name ?? null, opts.vendor ?? null)
  const qty = normalizeQty(opts.qty ?? 1)
  return {
    id: newItemId(),
    kind: 'lib',
    key: pickKey(food, name, vendor),
    foodId: food.id,
    qty,
    qtyDraft: String(qty),
    mods: normalizeMods(opts.mods ?? [], food),
    name,
    vendor,
    alias: opts.alias ?? null,
  }
}

/** 搜尋結果的一列（logFind.searchFoods）：品名、店家、別名列的別名。 */
export interface FoundRow {
  name: string
  vendor: string | null
  alias: string | null
  /** 怎麼對到的（logFind.FoodHit.via）；store＝只靠店家對到，一律當「本來就找得到」。沒給當品名。 */
  via?: 'name' | 'alias' | 'store'
}

/**
 * 從搜尋結果勾一樣（spec「系統學兩件事」「拿差不多的代替」，判定見 logFind.relationOf）：
 * - 本來就找得到（完全符合、或整串是它名字的一段）→ 什麼都不記；
 * - 你的叫法：字照順序出現但不連續 → 加入成功後記成別名；
 * - 代替：只對到一部分或對不上 → 紀錄品名寫你打的、數字照它、不記別名；
 * - 店家：框裡有店名就記店名，沒有才用列上的（別名列的店家；食物本身有店家的不寫，顯示時退回它）。
 * 「店家 品名」別名列（v2.162）照常運作：不另外學叫法，對不上才算代替。整串只是店名、或只靠店家對到的（打「八方」勾八方的鍋貼、
 * 打「麻古紅」勾麻古的紅萱波波）不學也不算代替；店家＋品名連著打（「全家豆漿」）看 relationOf。
 */
export function foundItem(food: MealFood, row: FoundRow, query: BoxQuery | null): LibItem {
  const aliasRow = row.alias !== null
  let name = aliasRow ? row.name : null
  let alias: string | null = null
  if (query && !query.storeOnly && query.item && row.via !== 'store') {
    const rel = aliasRow ? relationOf(query.item, { name: row.name, vendor: row.vendor, aliases: [] }) : relationOf(query.item, food)
    if (rel === 'substitute') name = query.item
    else if (rel === 'alias' && !aliasRow) alias = learnableAlias(food.aliases, query.item)
  }
  const vendor = query?.store ?? (aliasRow ? row.vendor : null)
  return libItem(food, { name, vendor, alias })
}

/**
 * AI 回的品名完全對到食品庫、照舊換成那一筆（spec「AI 估」）：店家照框裡的店名；
 * 打的品名跟它不同、又不是它名字或別名的一段（找不到）就記成叫法（spec「估好一律存」：同名已有時別名加到那一筆）。
 * aliasRow：靠「店家 品名」別名對上的（v2.162），照別名記品名與店家、不另學叫法。
 * typed：AI 一次回好幾樣時是 null。
 */
export function aiLibItem(food: MealFood, aliasRow: { item: string; vendor: string } | null, store: string | null, typed: string | null): LibItem {
  if (aliasRow) return libItem(food, { name: aliasRow.item, vendor: store ?? aliasRow.vendor })
  const alias = typed && relationOf(typed, food) !== 'findable' ? learnableAlias(food.aliases, typed) : null
  return libItem(food, { vendor: store, alias })
}

/** 單份的數字：食品庫那一筆套上微調。 */
export function perServing(food: MealFood, mods: readonly string[]): Macros {
  const base = { kcal: num(food.kcal), protein: num(food.protein), fat: num(food.fat), carb: num(food.carb) }
  return mods.length ? applyMods(base, mods, food).result : base
}

/** 一列的合計（份數 × 單份）；還在估的是 null。 */
export function itemTotals(item: MealItem, foodOf: (id: number) => MealFood | undefined): Macros | null {
  if (item.kind === 'est') return null
  const unit = item.kind === 'draft' ? item.draft : (() => {
    const f = foodOf(item.foodId)
    return f ? perServing(f, item.mods) : null
  })()
  if (!unit) return null
  const q = item.qty
  return { kcal: unit.kcal * q, protein: unit.protein * q, fat: unit.fat * q, carb: unit.carb * q }
}

/** 還沒估好的（估算中、估不出來）：有這種列時不能加入。 */
export const unsettled = (items: readonly MealItem[]): number => items.filter((i) => i.kind === 'est').length

/** 食品庫那一樣寫進 intake：單份快照（套過微調）、份數、紀錄的品名與店家。 */
export function libIntake(item: LibItem, food: MealFood, meal: MealKey, date: string): NewIntake {
  const u = perServing(food, item.mods)
  return {
    eaten_on: date,
    meal,
    food_id: item.foodId,
    qty: item.qty,
    kcal: u.kcal,
    protein: u.protein,
    fat: u.fat,
    carb: u.carb,
    name: item.name,
    ...(item.mods.length ? { mods: item.mods } : {}),
    ...(item.vendor ? { vendor: item.vendor } : {}),
  }
}

/** 估好的一樣寫進 intake（食品庫那一筆要先存好）：數字照估的、店家照框裡的店名。 */
export function draftIntake(item: DraftItem, foodId: number, meal: MealKey, date: string): NewIntake {
  const d = item.draft
  return {
    eaten_on: date,
    meal,
    food_id: foodId,
    qty: item.qty,
    kcal: d.kcal,
    protein: d.protein,
    fat: d.fat,
    carb: d.carb,
    name: null,
    ...(item.vendor ? { vendor: item.vendor } : {}),
  }
}

export type SavePlan =
  | { kind: 'existing'; foodId: number; alias: string | null }
  | { kind: 'create'; food: NewFood; keep: boolean }

/**
 * 估好的怎麼存（spec「估好一律存進食品庫」）：
 * - AI 估的：一律存（粗估）。打的品名跟 AI 取的名字不同 → 打的記成別名；打的本來就是它名字的一段（找得到）不記。食品庫已有同名的 → 不另建，別名加到那一筆。
 * - 只記熱量的：不存（建立即封存的那一筆，紀錄要 food_id）。
 */
export function savePlan<F extends Food>(item: DraftItem, meal: MealKey, foods: readonly F[], rank: ReadonlyMap<number, number>): SavePlan {
  const d = item.draft
  if (isManualDraft(d)) return { kind: 'create', food: draftToFood(d, meal), keep: false }
  const name = d.name.trim() || item.typed || draftToFood(d, meal).name
  const same = pickBest(foods.filter((f) => !f.archived && foldKey(f.name) === foldKey(name)), rank)
  const typed = item.typed && relationOf(item.typed, { name, aliases: same?.aliases ?? [] }) !== 'findable' ? item.typed : null
  if (same) return { kind: 'existing', foodId: same.id, alias: typed && learnableAlias(same.aliases, typed) }
  const alias = typed && learnableAlias([], typed)
  return {
    kind: 'create',
    food: { name, vendor: null, kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb, verified: false, ...(alias ? { aliases: [alias] } : {}) },
    keep: true,
  }
}

/** 加入成功後要加的別名：同一筆食物收好幾個就依序加，滿了、重複的照 learnableAlias 的規則跳過。 */
export function aliasUpdates(wants: readonly { foodId: number; alias: string }[], foodOf: (id: number) => Pick<MealFood, 'aliases'> | undefined): Map<number, string[]> {
  const out = new Map<number, string[]>()
  for (const w of wants) {
    const cur = out.get(w.foodId) ?? foodOf(w.foodId)?.aliases
    if (!cur) continue
    const a = learnableAlias(cur, w.alias)
    if (a) out.set(w.foodId, [...cur, a])
  }
  return out
}

/* ── 常吃、整組、搭配卡 ── */

/** 紀錄接成「找東西的列」：同一樣（pickKey）＋最近一次的份量與微調。 */
export interface RecordRow {
  key: string
  food: MealFood
  name: string | null
  vendor: string | null
  qty: number
  mods: string[]
  /** 最近一次的日期（舊資料沒有日期時是 null）。 */
  date: string | null
}

function rowOf(r: LogRecord, food: MealFood): RecordRow {
  const { name, vendor } = own(food, r.name, r.vendor)
  return { key: pickKey(food, name, vendor), food, name, vendor, qty: normalizeQty(r.qty), mods: normalizeMods(r.mods ?? [], food), date: r.eaten_on ?? null }
}

/** {餐別}常吃（spec 情境一）：這一餐近 60 天出現次數最多的單品，最多 max 樣，帶最近一次的份量與微調。records 由新到舊。 */
export function frequentRows(records: readonly LogRecord[], meal: MealKey, foodOf: (id: number) => MealFood | undefined, max = 8): RecordRow[] {
  const byKey = new Map<string, { row: RecordRow; n: number }>()
  for (const r of records) {
    if (r.meal !== meal) continue
    const f = foodOf(r.food_id)
    if (!f) continue
    const row = rowOf(r, f)
    const hit = byKey.get(row.key)
    if (hit) hit.n++
    else byKey.set(row.key, { row, n: 1 })
  }
  return [...byKey.values()].sort((a, b) => b.n - a.n).slice(0, max).map((x) => x.row)
}

/** 每一樣（pickKey）最近一次的紀錄，不分餐別：從搜尋勾的也照上次的微調帶上（v2.156「照上次」；中杯微糖是習慣，跟哪一餐無關）。 */
export function lastRecords(records: readonly LogRecord[], foodOf: (id: number) => MealFood | undefined): Map<string, RecordRow> {
  const out = new Map<string, RecordRow>()
  for (const r of records) {
    const f = foodOf(r.food_id)
    if (!f) continue
    const row = rowOf(r, f)
    if (!out.has(row.key)) out.set(row.key, row)
  }
  return out
}

export interface LastCombo {
  date: string
  rows: RecordRow[]
}

/**
 * 整組「上次{餐別}」：上一個同類日（平日找平日、假日找假日）的這一餐整組。少於兩樣不算整組（那就是常吃的一列）。
 * 食物已不在食品庫的那幾樣略過；沒有日期的舊資料不算。
 */
export function lastCombo(records: readonly LogRecord[], meal: MealKey, viewDate: string, foodOf: (id: number) => MealFood | undefined): LastCombo | null {
  const weekend = isWeekend(viewDate)
  let date: string | null = null
  for (const r of records) {
    if (r.meal !== meal || !r.eaten_on || r.eaten_on >= viewDate || isWeekend(r.eaten_on) !== weekend) continue
    if (date === null || r.eaten_on > date) date = r.eaten_on
  }
  if (date === null) return null
  const rows = new Map<string, RecordRow>()
  // 紀錄是新的在前；整組照當天記的順序排
  for (const r of [...records].reverse()) {
    if (r.meal !== meal || r.eaten_on !== date) continue
    const f = foodOf(r.food_id)
    if (!f) continue
    const row = rowOf(r, f)
    if (!rows.has(row.key)) rows.set(row.key, row)
  }
  return rows.size >= 2 ? { date, rows: [...rows.values()] } : null
}

const PAIR_CATEGORIES: readonly FoodCategory[] = ['飲料', '點心']

/** 搭配卡要不要出（spec 情境一「搭配卡」）：這一餐有正餐類的東西、還沒有飲料。 */
export function wantsPair(categories: readonly (string | null)[]): boolean {
  return categories.some((c) => isMealType(categoryOf(c))) && !categories.some((c) => categoryOf(c) === '飲料')
}

/**
 * 搭配卡的候選：近 60 天跟這一餐裡的東西同一餐出現過的飲料、點心，照一起出現的次數（同次數取最近的），
 * 這一餐已經有的不列、放不進今天剩下額度（room）的不列，最多 max 個。records 由新到舊。
 */
export function pairCandidates(
  records: readonly LogRecord[],
  mealFoodIds: ReadonlySet<number>,
  foodOf: (id: number) => MealFood | undefined,
  opts: { exclude: ReadonlySet<string>; room: number; max?: number },
): RecordRow[] {
  const groups = new Map<string, LogRecord[]>()
  for (const r of records) {
    if (!r.eaten_on) continue
    const g = `${r.eaten_on}|${r.meal}`
    groups.set(g, [...(groups.get(g) ?? []), r])
  }
  const tally = new Map<string, { row: RecordRow; n: number }>()
  for (const rs of groups.values()) {
    if (!rs.some((r) => mealFoodIds.has(r.food_id))) continue
    for (const r of rs) {
      if (mealFoodIds.has(r.food_id)) continue
      const f = foodOf(r.food_id)
      const c = f ? categoryOf(f.category) : null
      if (!f || c === null || !PAIR_CATEGORIES.includes(c)) continue
      const row = rowOf(r, f)
      const hit = tally.get(row.key)
      if (hit) hit.n++
      else tally.set(row.key, { row, n: 1 })
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.n - a.n)
    .map((x) => x.row)
    .filter((r) => !opts.exclude.has(r.key) && perServing(r.food, r.mods).kcal * r.qty <= opts.room)
    .slice(0, opts.max ?? 4)
}
