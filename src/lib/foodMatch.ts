/* 估一筆先查食品庫（spec「食品庫改版」第二步）：切段、正規化、比對鍵、完全一樣、相近、互斥詞、同名多筆怎麼挑、新增時查重。
   純邏輯，不沾 DOM（未來原樣帶去 React Native）。相近與互斥詞的作法取自 FoodKcalNotes（server/journal.js 的 similarity／EXCLUSIVE，
   ADR 0003），清單照 spec 改過：收「水煮」、不收「生 vs 熟」（「熟成牛排」含「熟」，誤擋比擋對多）。 */
import type { FoodSource } from './api'

/** 比對用的食物欄位（Food 的子集，測試不用造整筆）。 */
export interface MatchFood {
  id: number
  name: string
  vendor: string | null
  aliases: string[]
  source: FoodSource
  archived: boolean
}

/** 比對前的正規化：全形轉半形（NFKC）、去掉所有空白、英文小寫。「十八燒 油雞腿飯」與「十八燒油雞腿飯」算同一個。 */
export function normalizeKey(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/** 一句話照標點切段（、，,；;／/＋+ 與換行），去掉空段。「和」「跟」不切——「和風沙拉」「跟」都可能是品名的一部分，切錯比不切糟。 */
export function splitSegments(text: string): string[] {
  return text
    .normalize('NFKC')
    .split(/[、，,；;／/＋+\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 一筆食物的比對鍵：品名、店家＋品名、每個別名、店家＋別名（都正規化、去重）。 */
export function keysOf(f: Pick<MatchFood, 'name' | 'vendor' | 'aliases'>): string[] {
  const names = [f.name, ...f.aliases].map(normalizeKey).filter(Boolean)
  const vendor = f.vendor ? normalizeKey(f.vendor) : ''
  return [...new Set([...names, ...(vendor ? names.map((n) => vendor + n) : [])])]
}

/** 同來源的先後：官方 ＞ 標示 ＞ 自己填 ＞ AI 粗估 ＞ 未標。 */
const SOURCE_ORDER: FoodSource[] = ['official', 'label', 'manual', 'ai', 'unknown']

/**
 * 同名好幾筆時挑哪一筆：**最近記過的優先**（rank 越小越近），都沒記過才看來源（使用者 2026-11-22：
 * 匯入的通用茶葉蛋是官方，會壓過他天天吃的 7-11 那筆；習慣比來源更能代表他說的是哪一筆）。再平手取 id 小的（先建的），結果固定。
 */
export function pickBest<F extends MatchFood>(cands: readonly F[], rank: ReadonlyMap<number, number>): F | null {
  if (cands.length === 0) return null
  const r = (f: F) => rank.get(f.id) ?? Infinity
  return [...cands].sort((a, b) => r(a) - r(b) || SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || a.id - b.id)[0]
}

/** 完全一樣：正規化後等於某筆使用中食物的任一個鍵。封存的不算（估一筆沒勾存進食品庫的就是封存的，本來就是一次性）。 */
export function exactMatch<F extends MatchFood>(text: string, foods: readonly F[], rank: ReadonlyMap<number, number>): F | null {
  const k = normalizeKey(text)
  if (!k) return null
  return pickBest(foods.filter((f) => !f.archived && keysOf(f).includes(k)), rank)
}

/* 互斥詞：兩邊分別含同一組的左右兩側，就一定不是同一種，連相近提示都不出。左側優先（「不加糖」含「加糖」仍算左側）。 */
const EXCLUSIVE: [string[], string[]][] = [
  [['無糖', '零糖', '0糖', '不加糖', '無加糖', '零卡'], ['有糖', '含糖', '加糖', '全糖', '半糖', '微糖', '少糖', '減糖']],
  [['全糖'], ['半糖', '微糖', '少糖', '減糖']],
  [['炸'], ['水煮', '清蒸', '蒸', '烤', '滷', '燙', '涼拌']],
  [['去皮'], ['帶皮', '連皮']],
  [['脫脂', '低脂'], ['全脂']],
]

export function conflicts(a: string, b: string): boolean {
  const x = normalizeKey(a)
  const y = normalizeKey(b)
  const side = (s: string, left: string[], right: string[]) => (left.some((w) => s.includes(w)) ? 'L' : right.some((w) => s.includes(w)) ? 'R' : '')
  return EXCLUSIVE.some(([left, right]) => {
    const p = side(x, left, right)
    const q = side(y, left, right)
    return p !== '' && q !== '' && p !== q
  })
}

/** 字元雙字組相似度（Dice）；一方完整包含另一方（短的至少 3 個字）算 0.9。輸入要先正規化。 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if ([...short].length >= 3 && long.includes(short)) return 0.9
  const grams = (s: string) => {
    const cs = [...s]
    const out: string[] = []
    for (let i = 0; i < cs.length - 1; i++) out.push(cs[i] + cs[i + 1])
    return out
  }
  const left = grams(a)
  const pool = grams(b)
  if (!left.length || !pool.length) return 0
  const total = left.length + pool.length
  let shared = 0
  for (const g of left) {
    const i = pool.indexOf(g)
    if (i >= 0) {
      shared++
      pool.splice(i, 1)
    }
  }
  return (2 * shared) / total
}

/** 相近的門檻（同 FoodKcalNotes 的候選門檻）。 */
export const NEAR_MIN = 0.5
/** 相近只比 3 個字以上的：兩個字的名字雙字組只有一組，「地瓜球」對「地瓜」就有 0.67，雜訊比訊號多。完全一樣不受這條限制。 */
const NEAR_MIN_LEN = 3

/**
 * 相近：完全一樣的不算（那是 exactMatch 的事）、互斥詞擋掉的不算；取分數最高的一筆，同分照 pickBest 的規則。
 * 比的是正規化後的字串對每個鍵；互斥詞看原句對那筆的品名（含店家）。
 */
export function nearMatch<F extends MatchFood>(text: string, foods: readonly F[], rank: ReadonlyMap<number, number>): F | null {
  const k = normalizeKey(text)
  if ([...k].length < NEAR_MIN_LEN) return null
  let best = 0
  let cands: F[] = []
  for (const f of foods) {
    if (f.archived) continue
    const keys = keysOf(f)
    if (keys.includes(k)) continue
    if (conflicts(text, `${f.vendor ?? ''}${f.name}`) || f.aliases.some((a) => conflicts(text, a))) continue
    const long = keys.filter((key) => [...key].length >= NEAR_MIN_LEN)
    if (long.length === 0) continue
    const score = Math.max(...long.map((key) => similarity(k, key)))
    if (score < NEAR_MIN) continue
    if (score > best) {
      best = score
      cands = [f]
    } else if (score === best) cands.push(f)
  }
  return pickBest(cands, rank)
}

/** 最近記過的順序：rows 是照「最近的在前」排好的 intake（listRecentIntake）；回 food_id → 第幾近（0 最近）。 */
export function recencyRank(rows: readonly { food_id: number }[]): Map<number, number> {
  const m = new Map<number, number>()
  rows.forEach((r, i) => {
    if (!m.has(r.food_id)) m.set(r.food_id, i)
  })
  return m
}

/** 新增時查重的結果：block＝店家＋品名（或別名）完全一樣，擋下；note＝品名一樣、店家不同，提醒但照存。 */
export interface DuplicateCheck<F> {
  block: F | null
  note: F | null
}

/**
 * 新增（或改名）一筆食物前查重（spec AC 13）。比的是「品名＋別名」兩邊有沒有交集、店家是否相同（正規化後；兩邊都沒店家也算相同）。
 * selfId：編輯時排除自己。封存的不算。
 */
export function duplicateCheck<F extends MatchFood>(
  draft: { name: string; vendor: string | null; aliases?: readonly string[] },
  foods: readonly F[],
  selfId: number | null = null,
): DuplicateCheck<F> {
  const mine = new Set([draft.name, ...(draft.aliases ?? [])].map(normalizeKey).filter(Boolean))
  const vendor = normalizeKey(draft.vendor ?? '')
  let block: F | null = null
  let note: F | null = null
  for (const f of foods) {
    if (f.archived || f.id === selfId) continue
    const theirs = [f.name, ...f.aliases].map(normalizeKey)
    if (!theirs.some((n) => mine.has(n))) continue
    if (normalizeKey(f.vendor ?? '') === vendor) block ??= f
    else note ??= f
  }
  return { block, note }
}

/** 給人看的名稱：有店家就「店家 品名」。 */
export const foodLabel = (f: Pick<MatchFood, 'name' | 'vendor'>): string => (f.vendor ? `${f.vendor} ${f.name}` : f.name)
