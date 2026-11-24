/* 一個框記一餐（spec「一個框記一餐：搜尋和估一筆合一」，v2.164）：框裡只有正在打的那一段（同時是搜尋），
   打完一段（段落符號、或按完成）就移出框、在「這一餐」段變成一列——收件人欄的做法。
   每段各自判定：完全對上食品庫＝勾好的那一列；對不上＝「待估」，按了才只拿那一段去估。
   純邏輯，不沾 DOM。 */
import { ESTIMATE_TEXT_MAX, matchedAlias, type LibCandidate, type NearFood } from './estimate'
import { exactMatch, nearMatch } from './foodMatch'
import { aliasKey, foodKey, recordRow, type ListRow, type RowFood } from './listRows'
import { vendorInSentence } from './mealVendor'

/**
 * 框裡的段落符號：頓號、逗號、分號（全形半形）與換行。
 * **刻意不收** splitSegments 的「／ / ＋ +」：品名裡就有（「熟成紅茶+白玉」「義美無加糖豆奶/豆漿」），
 * 在框裡打到一半就被切走，搜尋就壞了。
 */
export const BOX_SEPARATOR = /[、，,；;\n]/

/** 一段最多幾個字（同估算描述框，碼位計）：超過的截掉，送估算時函式那端也收得下。 */
const clampSegment = (s: string): string => [...s.trim()].slice(0, ESTIMATE_TEXT_MAX).join('')

/**
 * 框裡的字 → 已經打完的段＋還在打的那段。final＝按了完成（Enter）：最後那段也算打完。
 * 空段（連打兩個頓號、只有空白）丟掉；還在打的那段只去掉開頭的空白（打到一半的「麻古 」後面那個空白要留著）。
 */
export function splitBox(value: string, final = false): { committed: string[]; rest: string } {
  const parts = value.split(BOX_SEPARATOR)
  const last = final ? '' : (parts.pop() ?? '')
  return { committed: parts.map(clampSegment).filter(Boolean), rest: last.replace(/^\s+/, '') }
}

/** 一段的判定：完全對上食品庫＝那一列的 key（靠「店家 品名」別名對上的是別名列）；對不上＝待估，附相近的那一筆。 */
export type SegmentHit = { kind: 'pick'; key: string } | { kind: 'pending'; near: NearFood | null }

/** 相近的那一筆（給待估列的提示；數字取整）。 */
function nearOf(seg: string, foods: readonly LibCandidate[], rank: ReadonlyMap<number, number>): NearFood | null {
  const n = nearMatch(seg, foods, rank)
  return n ? { id: n.id, name: n.name, vendor: n.vendor, kcal: Math.round(Number(n.kcal)) } : null
}

/** 完全對上的規則同估一筆先查食品庫（exactMatch：品名／店家＋品名／別名，同名挑最近記過的）；
 *  別名的店家照 matchedAlias（只對上品名段、好幾家都有這個品名就不猜，落回通用那一列）。 */
export function resolveSegment(seg: string, foods: readonly LibCandidate[], rank: ReadonlyMap<number, number>): SegmentHit {
  const f = exactMatch(seg, foods, rank)
  if (f) {
    const a = matchedAlias(seg, f)
    return { kind: 'pick', key: a ? aliasKey(f.id, a.alias) : foodKey(f.id) }
  }
  return { kind: 'pending', near: nearOf(seg, foods, rank) }
}

export type PendingStatus = 'idle' | 'busy' | 'error'

/** 「這一餐」段的一列，照打的順序：勾好的食品庫列（key＝清單的列）、待估、估好的草稿（key＝草稿的 key）。 */
export type MealEntry =
  | { id: string; kind: 'pick'; key: string }
  | { id: string; kind: 'pending'; text: string; status: PendingStatus; startedAt: number | null; near: NearFood | null; tiers: boolean; own: string }
  | { id: string; kind: 'draft'; key: string }

let seq = 0
const nextId = () => `seg-${++seq}`

/** 待估列（新店卡的「都不像 → 估一筆」不比對食品庫，使用者已經說要估；一段截到 300 字）。 */
export function pendingEntry(text: string, foods: readonly LibCandidate[], rank: ReadonlyMap<number, number>): MealEntry {
  const seg = clampSegment(text)
  return { id: nextId(), kind: 'pending', text: seg, status: 'idle', startedAt: null, near: nearOf(seg, foods, rank), tiers: false, own: '' }
}

/**
 * 打完的幾段 → 要加進「這一餐」的列、新勾的列各幾份、要多加一份的列。
 * - 同一批裡同一樣出現 n 次（「滷蛋、滷蛋」）：一列、**n 份**（從 1 數，不看這一餐上次吃幾份）；只出現一次的照上次的份量（counts 沒有它）。
 * - 對上的那一列已經在了（existing：清單上勾的、這一餐的食品庫草稿）：不再多一列，每出現一次多一份（bump，可重複）。
 */
export function entriesFromSegments(
  segments: readonly string[],
  foods: readonly LibCandidate[],
  rank: ReadonlyMap<number, number>,
  existing: ReadonlySet<string>,
): { add: MealEntry[]; counts: Map<string, number>; bump: string[] } {
  const add: MealEntry[] = []
  const bump: string[] = []
  const counts = new Map<string, number>()
  for (const seg of segments) {
    const hit = resolveSegment(seg, foods, rank)
    if (hit.kind === 'pending') {
      add.push({ id: nextId(), kind: 'pending', text: seg, status: 'idle', startedAt: null, near: hit.near, tiers: false, own: '' })
    } else if (existing.has(hit.key)) {
      bump.push(hit.key)
    } else if (counts.has(hit.key)) {
      counts.set(hit.key, (counts.get(hit.key) ?? 1) + 1)
    } else {
      counts.set(hit.key, 1)
      add.push({ id: nextId(), kind: 'pick', key: hit.key })
    }
  }
  for (const [k, n] of counts) if (n === 1) counts.delete(k)
  return { add, counts, bump }
}

/**
 * 待估列的相近提示按「改用」：換成那一筆食品庫食物的哪一列，店家與品名不能丟。
 * - 那一段對得上它的「店家 品名」別名（matchedAlias）＝那個別名列；
 * - 食物本身沒店家、那一段寫了已知店家（「在麻古買了紅萱波波微糖」）＝一列「那筆食物＋這家」（同新店卡記品名店家的列形狀）；
 * - 其他＝食物列。
 */
export function adoptRow<F extends RowFood & LibCandidate>(text: string, f: F, knownVendors: readonly string[]): { key: string; row: ListRow<F> | null } {
  const a = matchedAlias(text, f)
  if (a) return { key: aliasKey(f.id, a.alias), row: null }
  const v = f.vendor ? null : vendorInSentence(text, knownVendors)
  if (v) {
    const row = recordRow(f, null, v)
    return { key: row.key, row }
  }
  return { key: foodKey(f.id), row: null }
}

/** 一列換成別的（待估估好了換成草稿、改用相近的換成勾好的列）；找不到那一列（已經 ✕ 掉）就原樣不動。 */
export function replaceEntry(entries: readonly MealEntry[], id: string, next: readonly MealEntry[]): MealEntry[] {
  return entries.flatMap((e) => (e.id === id ? [...next] : [e]))
}

/** 新的草稿列（估好回來的、檔位）。 */
export const draftEntry = (key: string): MealEntry => ({ id: nextId(), kind: 'draft', key })
/** 新的勾好列（相近提示按了「改用」）。 */
export const pickEntry = (key: string): MealEntry => ({ id: nextId(), kind: 'pick', key })

/** 還沒估的（含估失敗的、正在估的）：還有這種列時不能「加入」——它沒有數字，加入就靜靜少一樣。 */
export const unresolved = (entries: readonly MealEntry[]): number => entries.filter((e) => e.kind === 'pending').length
/** 還在等使用者動手的待估列（不算正在估的）：確認列的提示只數這種。 */
export const waiting = (entries: readonly MealEntry[]): number => entries.filter((e) => e.kind === 'pending' && e.status !== 'busy').length

/** 「這一餐」那一列在畫面上的 data-key：待估列是自己的 id，勾好的與草稿是列／草稿的 key。 */
export const entryDomKey = (e: MealEntry): string => (e.kind === 'pending' ? e.id : e.key)
