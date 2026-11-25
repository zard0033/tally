/* 記一筆的「找」（spec「記一筆重做：兩個情境」情境一，v2.167）：框只是搜尋。
   - 比對：完全符合＞整串連續出現＞字照順序出現＞打的字裡有連續兩個字出現；忽略空白、全半形、大小寫與「-」「・」「.」。
   - 店名：框裡有空白時第一段當店名；整串剛好是記過的店名也算打店名（只找「你在那家記過的」，品名照樣拿去找）。
   - 你在那家記過的：從紀錄找（紀錄記的店家，或食物本身的店家），照最近一次排、最多 8 樣。
   純邏輯，不沾 DOM。 */
import { aliasProblem, vendorAliases } from './listRows'
import { splitAlias } from './foodMatch'
import { monthDay } from './dates'
import { clampVendor } from './mealVendor'

/* ── 比對 ── */

/** 比對時跳過的字（NFKC 之後）：空白、各種橫線、中點、句點。 */
const SKIP = /[\s\-‐‑‒–—―・·.]/u

/** 摺疊的快取：同一批品名、別名、店家每打一個字就要再比一次，摺疊結果不會變。上限到了整個清掉（食品庫約百來筆，很少碰到）。 */
const FOLD_CACHE = new Map<string, { chars: string[]; pos: number[] }>()
const FOLD_CACHE_MAX = 5000

/** 摺疊後的字與每個字在原字串（以碼位計）的位置，標粗體要對回原字。 */
function fold(s: string): { chars: string[]; pos: number[] } {
  const hit = FOLD_CACHE.get(s)
  if (hit) return hit
  if (FOLD_CACHE.size >= FOLD_CACHE_MAX) FOLD_CACHE.clear()
  const out = foldRaw(s)
  FOLD_CACHE.set(s, out)
  return out
}

function foldRaw(s: string): { chars: string[]; pos: number[] } {
  const chars: string[] = []
  const pos: number[] = []
  ;[...s].forEach((c, i) => {
    for (const n of c.normalize('NFKC').toLowerCase()) {
      if (SKIP.test(n)) continue
      chars.push(n)
      pos.push(i)
    }
  })
  return { chars, pos }
}

/** 比對鍵：「7-11」「711」「７－１１」是同一個。 */
export const foldKey = (s: string): string => fold(s).chars.join('')

/** exact＝整串一樣；contains＝打的整串連續出現；order＝打的字照順序出現；pair＝打的字裡有連續兩個字出現。 */
export type MatchKind = 'exact' | 'contains' | 'order' | 'pair'

export interface TextMatch {
  kind: MatchKind
  /** 對到的字在原字串的位置（碼位），由小到大、不重複。 */
  hits: number[]
}

const indexOfSeq = (hay: string[], needle: string[], from = 0): number => {
  outer: for (let i = from; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/** 打的字對不對得到這段文字；對不到回 null。「冬檸」對「冬瓜檸檬」是 order，「排骨飯」對「炸排骨便當」是 pair。 */
export function matchText(query: string, text: string): TextMatch | null {
  const q = fold(query).chars
  const t = fold(text)
  if (!q.length || !t.chars.length) return null
  const at = (idx: number[]) => [...new Set(idx.map((i) => t.pos[i]))].sort((a, b) => a - b)
  if (q.join('') === t.chars.join('')) return { kind: 'exact', hits: at(t.chars.map((_, i) => i)) }
  const c = indexOfSeq(t.chars, q)
  if (c >= 0) return { kind: 'contains', hits: at(q.map((_, j) => c + j)) }
  if (q.length >= 2) {
    const seq: number[] = []
    let k = 0
    for (let i = 0; i < t.chars.length && k < q.length; i++) {
      if (t.chars[i] !== q[k]) continue
      seq.push(i)
      k++
    }
    if (k === q.length) return { kind: 'order', hits: at(seq) }
    const pairs: number[] = []
    for (let j = 0; j + 1 < q.length; j++) {
      const p = [q[j], q[j + 1]]
      for (let i = indexOfSeq(t.chars, p); i >= 0; i = indexOfSeq(t.chars, p, i + 1)) pairs.push(i, i + 1)
    }
    if (pairs.length) return { kind: 'pair', hits: at(pairs) }
  }
  return null
}

/** 標粗體用：把字串切成「對到／沒對到」的段。 */
export function highlightRuns(text: string, hits: readonly number[]): { text: string; hit: boolean }[] {
  const set = new Set(hits)
  const out: { text: string; hit: boolean }[] = []
  ;[...text].forEach((c, i) => {
    const hit = set.has(i)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += c
    else out.push({ text: c, hit })
  })
  return out
}

const RANK: Record<MatchKind, number> = { exact: 0, contains: 1, order: 2, pair: 3 }

/* ── 框：店名＋品名 ── */

export interface BoxQuery {
  /** 店名（有空白時的第一段，或整串剛好是記過的店名）；照記過的寫法（打「711」記成「7-11」）。 */
  store: string | null
  /** 拿去找食物、送去 AI 估的那段（不含店名）。 */
  item: string
  /** 整串就是一個店名：只找「你在那家記過的」與店家對到的食物，不學叫法、不算代替。 */
  storeOnly: boolean
}

/**
 * 框裡的字 → 店名＋品名。knownStores：紀錄與食品庫出現過的店家。
 * notStore：使用者在框下的「在 {店} 買 ✕」按掉的那個店名——這次整串都當品名（「大杯 拿鐵」的大杯不是店）。
 */
export function parseBox(text: string, knownStores: readonly string[], notStore: string | null = null): BoxQuery | null {
  const t = text.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!t) return null
  const known = (s: string) => knownStores.find((k) => foldKey(k) === foldKey(s)) ?? null
  const { vendor, item } = splitAlias(t)
  const q: BoxQuery = vendor
    ? { store: clampVendor(known(vendor) ?? vendor), item, storeOnly: false }
    : known(t)
      ? { store: known(t), item: t, storeOnly: true }
      : { store: null, item: t, storeOnly: false }
  if (q.store && notStore !== null && foldKey(q.store) === foldKey(notStore)) return { store: null, item: t, storeOnly: false }
  return q
}

/** 記過的店家：紀錄的店家、食物的店家、「店家 品名」別名的店家（去重，照第一次出現的寫法）。 */
export function knownStores(records: readonly { vendor: string | null }[], foods: readonly { vendor: string | null; aliases?: readonly string[] }[]): string[] {
  const out = new Map<string, string>()
  const add = (v: string | null | undefined) => {
    const s = v?.trim()
    if (s && !out.has(foldKey(s))) out.set(foldKey(s), s)
  }
  for (const r of records) add(r.vendor)
  for (const f of foods) {
    add(f.vendor)
    for (const a of vendorAliases(f)) add(a.vendor)
  }
  return [...out.values()]
}

/* ── 搜尋食品庫：一張清單 ── */

export interface FindFood {
  id: number
  name: string
  vendor: string | null
  aliases: readonly string[]
  archived?: boolean
}

export interface FoodHit<F extends FindFood> {
  food: F
  /** 列上的品名：別名列（v2.162 的「店家 品名」別名）是品名段，其餘是食物的品名。 */
  name: string
  /** 列上的店家：別名列是別名的店家段。 */
  vendor: string | null
  /** 別名列才有：「麻古 紅萱波波」。 */
  alias: string | null
  kind: MatchKind
  /** 列上品名要標粗的字；完全符合＝整串。 */
  hits: number[]
  /** 怎麼對到的：name＝品名（別名列是品名段）、alias＝沒店家段的別名、store＝只靠店家（食物的店家、「店家 品名」別名的店家段）。
   *  只靠店家對到的一律當「本來就找得到」：不把打的字記成品名、不學叫法（打「八方」勾八方的鍋貼不是代替）。 */
  via: 'name' | 'alias' | 'store'
}

/** 一筆食物（或它的一個「店家 品名」別名）對打的字的最好結果；對不到 null。 */
function bestOf(item: string, texts: readonly string[]): TextMatch | null {
  let best: TextMatch | null = null
  for (const t of texts) {
    const m = matchText(item, t)
    if (m && (!best || RANK[m.kind] < RANK[best.kind])) best = m
  }
  return best
}

/**
 * 搜尋（spec AC 3）：不分段、完全符合排前面，其餘照對到的程度、再照傳進來的順序（呼叫端先排好吃得下的在前）。
 * - 品名、別名、食物的店家都比；店家只對到店家的列不標粗。
 * - 通用食物的「店家 品名」別名各自一列（照常運作，v2.162）；食物自己那列只在品名或沒店家的別名對到時出現。
 */
export function searchFoods<F extends FindFood>(foods: readonly F[], item: string): FoodHit<F>[] {
  if (!foldKey(item)) return []
  const out: (FoodHit<F> & { order: number })[] = []
  foods.forEach((f, order) => {
    if (f.archived) return
    const named = matchText(item, f.name)
    const exact = (m: TextMatch | null) => m?.kind === 'exact'
    const vendorRows = vendorAliases(f)
    const plain = f.aliases.filter((a) => !splitAlias(a).vendor)
    const viaAlias = bestOf(item, plain)
    const viaVendor = vendorRows.length ? null : f.vendor ? matchText(item, f.vendor) : null
    const cands = [named, viaAlias, viaVendor].filter((m): m is TextMatch => m !== null)
    if (cands.length) {
      const kind = cands.reduce((a, m) => (RANK[m.kind] < RANK[a] ? m.kind : a), cands[0].kind)
      // 完全符合（含叫法）整串標粗；其他只標品名上對到的字
      const hits = exact(named) || exact(viaAlias) ? [...f.name].map((_, i) => i) : (named?.hits ?? [])
      // 只靠店家對到的不算完全符合（打「全家」不是在找叫全家的東西），排在對到品名的後面
      const k = viaVendor && cands.length === 1 && kind === 'exact' ? 'contains' : kind
      const via = !named && !viaAlias ? 'store' : named && (!viaAlias || RANK[named.kind] <= RANK[viaAlias.kind]) ? 'name' : 'alias'
      out.push({ food: f, name: f.name, vendor: f.vendor, alias: null, kind: k, hits, order, via })
    }
    for (const a of vendorRows) {
      const onItem = matchText(item, a.item)
      const m = bestOf(item, [a.item, a.alias])
      if (!m) continue
      const hits = m.kind === 'exact' ? [...a.item].map((_, i) => i) : (onItem?.hits ?? [])
      // 品名段對不到、只有整個別名（含店家段「麻古」）對得到：算靠店家對到
      out.push({ food: f, name: a.item, vendor: a.vendor, alias: a.alias, kind: m.kind, hits, order, via: onItem ? 'name' : 'store' })
    }
  })
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.order - b.order).map(({ order: _order, ...h }) => h)
}

/* ── 你在那家記過的 ── */

/** 紀錄（listRecentIntake 的一列）。eaten_on 舊資料可能沒有（e2e 的舊 fixture），用到日期的地方要擋。 */
export interface LogRecord {
  eaten_on?: string
  meal: string
  food_id: number
  qty: number
  mods: string[]
  name: string | null
  vendor: string | null
}

export interface StoreHit {
  foodId: number
  /** 紀錄自己的品名（null＝沿用食物的）。 */
  name: string | null
  /** 這一列的店家（紀錄的，或食物本身的）。 */
  vendor: string
  qty: number
  mods: string[]
  /** 上次是哪天；沒有日期的舊資料是 null。 */
  date: string | null
}

/** 你在那家記過的（spec 情境一「店名」）：最近的在前、同一樣（食物＋品名）只留最近那次、最多 max 樣。食物已不在食品庫的略過。 */
export function storeHistory(
  records: readonly LogRecord[],
  store: string,
  foodOf: (id: number) => { name: string; vendor: string | null } | undefined,
  max = 8,
): StoreHit[] {
  const want = foldKey(store)
  const seen = new Set<string>()
  const out: StoreHit[] = []
  for (const r of records) {
    const f = foodOf(r.food_id)
    if (!f) continue
    const v = r.vendor?.trim() || f.vendor
    if (!v || foldKey(v) !== want) continue
    const name = r.name?.trim() || null
    const k = `${r.food_id}|${foldKey(name ?? f.name)}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ foodId: r.food_id, name, vendor: v, qty: r.qty, mods: r.mods, date: r.eaten_on ?? null })
    if (out.length >= max) break
  }
  return out
}

export interface NameHit {
  foodId: number
  /** 紀錄自己的品名（代替時記的「排骨飯」）。 */
  name: string
  /** 紀錄的店家，沒記就是食物本身的；都沒有是 null。 */
  vendor: string | null
  qty: number
  mods: string[]
  date: string | null
  kind: MatchKind
  /** 品名上對到的字（完全符合＝整串）。 */
  hits: number[]
}

/**
 * 你記過的品名（spec 情境一「拿差不多的代替」）：紀錄自己記了品名（代替時記的「排骨飯」，數字照炸排骨便當）、
 * 而且打的字對得到那個品名的，再打一樣的字時列在搜尋結果最上面，點了照上次那樣記。
 * 完全符合的在前，同一級最近的在前；同一樣（食物＋品名）只留最近那次、最多 max 樣。食物已不在食品庫、品名跟食物一樣的略過。
 */
export function nameHistory(
  records: readonly LogRecord[],
  item: string,
  foodOf: (id: number) => { name: string; vendor: string | null } | undefined,
  max = 8,
): NameHit[] {
  const seen = new Set<string>()
  const out: (NameHit & { order: number })[] = []
  for (const r of records) {
    const name = r.name?.trim()
    const f = foodOf(r.food_id)
    if (!name || !f || foldKey(name) === foldKey(f.name)) continue
    const k = `${r.food_id}|${foldKey(name)}`
    if (seen.has(k)) continue
    seen.add(k)
    const m = matchText(item, name)
    if (!m) continue
    const hits = m.kind === 'exact' ? [...name].map((_, i) => i) : m.hits
    out.push({ foodId: r.food_id, name, vendor: r.vendor?.trim() || f.vendor, qty: r.qty, mods: r.mods, date: r.eaten_on ?? null, kind: m.kind, hits, order: out.length })
  }
  return out
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.order - b.order)
    .slice(0, max)
    .map(({ order: _order, ...h }) => h)
}

/** 搜尋結果的一列：你記過的品名（nameHistory）或食品庫（searchFoods）。 */
export type ResultRow<A, B> = { src: 'name'; hit: A } | { src: 'food'; hit: B }

/**
 * 你記過的品名與食品庫合成一張清單：記過的品名完全符合或整串出現的放最上面（打「排骨飯」，上次記的排骨飯在第一列）；
 * 只對到一部分的跟食品庫的一起照對到的程度排（完全符合的食品庫「牛肉麵」不會被記過的「牛肉飯」壓下去），同一級食品庫在前。
 */
export function mergeResults<A extends { kind: MatchKind }, B extends { kind: MatchKind }>(names: readonly A[], foods: readonly B[]): ResultRow<A, B>[] {
  const strong = names.filter((n) => n.kind === 'exact' || n.kind === 'contains')
  const weak = names.filter((n) => n.kind !== 'exact' && n.kind !== 'contains')
  const rest: (ResultRow<A, B> & { i: number })[] = [
    ...foods.map((hit, i) => ({ src: 'food' as const, hit, i })),
    ...weak.map((hit, i) => ({ src: 'name' as const, hit, i: foods.length + i })),
  ]
  rest.sort((a, b) => RANK[a.hit.kind] - RANK[b.hit.kind] || a.i - b.i)
  return [...strong.map((hit): ResultRow<A, B> => ({ src: 'name', hit })), ...rest.map(({ i: _i, ...r }) => r as ResultRow<A, B>)]
}

/** 「上次 …」：今天、昨天、這週內寫星期幾，更早寫月/日。today 是真正的今天；比它晚的（記在未來的）寫月/日。 */
export function lastSeenText(date: string, today: string): string {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000)
  if (days === 0) return '今天'
  if (days < 0) return monthDay(date)
  if (days === 1) return '昨天'
  if (days < 7) return `週${'日一二三四五六'[new Date(`${date}T00:00:00Z`).getUTCDay()]}`
  return monthDay(date)
}

/* ── 系統學兩件事（背景） ── */

/**
 * 打的品名跟勾的那一筆的關係（spec AC 4、4b；使用者核可的例子「打『冬瓜』勾冬瓜茶 → 不記，本來就找得到」）：
 * - findable＝完全符合，或整串連續出現在它的品名或別名裡（「雞胸」→雞胸餐盒）：本來就找得到，不學、也不算代替；
 * - alias＝字照順序出現、但不連續（「冬檸」→冬瓜檸檬）：你的叫法，加入成功後記成別名；
 * - substitute＝只對到一部分（「冬瓜檸檬」→冬瓜茶、「排骨飯」→炸排骨便當）或對不上：拿差不多的代替，紀錄品名寫你打的。
 */
export type PickRelation = 'findable' | 'alias' | 'substitute'

export function relationOf(item: string, food: { name: string; vendor?: string | null; aliases: readonly string[] }): PickRelation {
  const names = [food.name, ...food.aliases, ...food.aliases.flatMap((a) => (splitAlias(a).vendor ? [splitAlias(a).item] : []))]
  const vendor = food.vendor?.trim() || null
  // 店家＋品名連著打（「全家無糖」）也是找得到：連續出現在「店家品名」裡
  const m = bestOf(item, vendor ? [...names, ...names.map((n) => vendor + n)] : names)
  if (m && (m.kind === 'exact' || m.kind === 'contains')) return 'findable'
  if (vendor) {
    // 開頭或結尾是店家（「全家豆漿」、「八方」）：拿掉店家，剩下的找得到（或沒剩）就是找得到
    const k = foldKey(item)
    const v = foldKey(vendor)
    const rest = k.startsWith(v) ? k.slice(v.length) : k.endsWith(v) ? k.slice(0, k.length - v.length) : null
    if (rest !== null && (rest === '' || relationOf(rest, { name: food.name, aliases: food.aliases }) === 'findable')) return 'findable'
  }
  // 叫法只看品名與別名本身（店家的字不算進「照順序」）
  return bestOf(item, names)?.kind === 'order' ? 'alias' : 'substitute'
}

/** 要記成別名的叫法：不收的（滿 10 個、超過 40 字、含頓號逗號、已經有了）回 null，照記、不加。 */
export function learnableAlias(aliases: readonly string[], item: string): string | null {
  return aliasProblem(aliases, item) === null ? item.normalize('NFKC').trim().replace(/\s+/g, ' ') : null
}
