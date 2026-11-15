/* 「估一筆」的純邏輯（spec.md「A. 用一句話記一餐」2026-11-13 版，樣張 `_design-sample/estimate-entry.html` B）：
   AI 估回來的品項、三個檔位、自己打的數字，一律先變成「草稿列」；使用者看過、改過，「帶回清單」放進已選，
   跟清單勾的食物一起按「加入」才寫入（使用者 2026-11-13：估一筆的結果帶回 sheet 打勾，一次加入）。
   寫入分兩步：每一列先建一筆 foods（沒勾「存進食品庫」的直接封存），再寫 intake——intake 要 food_id。
   這一層禁沾 DOM（未來要原樣帶去 React Native）。 */
import { MACRO_MAX } from './foodForm'
import { mealLabel, type MealKey } from './meals'

/** read-label 估算模式回來的一樣（形狀同 handler.ts 的 parseEstimate）。 */
export interface EstimateItem {
  name: string | null
  kcal: number
  kcal_low: number
  kcal_high: number
  protein_g: number
  fat_g: number
  carb_g: number
  assumption: string | null
}

/** 檔位：給「描述不出來」的時候用（忘了吃什麼、AI 估不出來、懶得打字），所以按「那一餐大概是哪一種」分、不按份量。
 *  700＝國健署成人一餐建議量；1000≈國健署 2012 稿的傳統便當 900／炸豬排便當 1000；**400 是設計決定，沒有出處**。 */
export const TIERS = [
  { key: 'light', label: '吃得簡單', examples: '飯糰、麵包、蛋餅', kcal: 400 },
  { key: 'normal', label: '一般正餐', examples: '便當、一碗麵', kcal: 700 },
  { key: 'big', label: '吃很多', examples: '火鍋、夜市、聚餐', kcal: 1000 },
] as const
export type TierKey = (typeof TIERS)[number]['key']

export interface EstimateDraft {
  /** 畫面用的穩定鍵（刪掉一列時其他列不重掛）。 */
  key: string
  /** 使用者可改的品名（AI 的列預填 AI 給的名字，不加「（估算）」——使用者 2026-11-13）。
   *  空字串＝用「餐別＋tag」頂替，**寫入那一刻**才決定是哪一餐（回清單換了餐別，品名跟著寫進去的那一餐）。 */
  name: string
  /** 品名空著時接在餐別後面的說明：檔位是「（一般正餐）」這類，其他是空字串。 */
  tag: string
  kcal: number
  /** 熱量框正在打的字（打到一半的 "6" 不馬上正規化）。 */
  kcalDraft: string
  protein: number
  fat: number
  carb: number
  /** AI 回的範圍；檔位與自己打的沒有。 */
  low: number | null
  high: number | null
  assumption: string | null
  /** 檔位或自己打的、而且那一餐歷史太少算不出比例：三大營養素是 0，畫面要標「只估了熱量」。 */
  kcalOnly: boolean
  /** 檔位或自己打的、三大營養素照這一餐自己的歷史比例粗估（v2.142）：畫面標「粗估」。AI 的列是 false。 */
  macrosGuessed: boolean
  /** 「存進食品庫」：勾了不封存，下次可以直接選。 */
  keep: boolean
  /** 已經建好的 foods.id。寫 intake 失敗按重試時，有 id 的就不再建一次；有 id 之後這一列就鎖住（改了也對不上已建的食物）。 */
  foodId: number | null
  /** 縮放的基準：AI（或檔位）原本給的那組數字。改熱量一律從這組換算——每打一個字就拿「目前」的數字再縮放，
   *  四捨五入會一路疊加，中間打出 0 還會把營養素永久歸零（review B1）。 */
  origin: { kcal: number; protein: number; fat: number; carb: number }
}

let seq = 0
const nextKey = () => `est-${++seq}`

const round1 = (n: number) => Math.round(n * 10) / 10

/** AI 回來的品項 → 草稿列。品名讀不到時留空，顯示與寫入用餐別頂替，不讓一列沒有名字。 */
export function draftsFromItems(items: readonly EstimateItem[]): EstimateDraft[] {
  return items.map((it) => {
    const kcal = Math.round(it.kcal)
    const protein = round1(it.protein_g), fat = round1(it.fat_g), carb = round1(it.carb_g)
    return {
      key: nextKey(),
      name: it.name?.trim() ?? '',
      tag: '',
      kcal,
      kcalDraft: String(kcal),
      protein,
      fat,
      carb,
      // 範圍的下限不會是負的（上游沒擋 kcal_low ≥ 0，顯示「-50–600」沒有意義）
      low: Math.max(0, Math.round(it.kcal_low)),
      high: Math.round(it.kcal_high),
      assumption: it.assumption?.trim() || null,
      kcalOnly: false,
      macrosGuessed: false,
      keep: false,
      foodId: null,
      origin: { kcal, protein, fat, carb },
    }
  })
}

/** 三大營養素各佔熱量的比例（0–1，蛋白質與碳水 4 卡／g、脂肪 9 卡／g）。 */
export interface MacroRatio {
  protein: number
  fat: number
  carb: number
}

/** 算比例至少要這一餐有幾天的紀錄：太少的話一兩餐的特例就決定了比例。3 是設計決定，沒有出處。 */
export const RATIO_MIN_DAYS = 3

/**
 * 這一餐自己的三大營養素比例（v2.142，使用者 2026-11-15：檔位與自己打的熱量，三大照「那一餐自己的歷史比例」粗估）。
 * rows＝近期的 intake（餐建議那份 28 天的回看，快照值、要乘 qty）。這一餐記不到 RATIO_MIN_DAYS 天、或總熱量是 0 → null（維持只估熱量）。
 * **已知偏差**：會用檔位的多半是外食、聚餐，蛋白質通常比平常記的少——照平常比例，蛋白質大概估高（使用者知情）。
 */
export function mealMacroRatio(
  rows: readonly { eaten_on: string; meal: string; qty: number | string; kcal: number | string; protein: number | string; fat: number | string; carb: number | string }[],
  meal: MealKey,
): MacroRatio | null {
  const mine = rows.filter((r) => r.meal === meal)
  if (new Set(mine.map((r) => r.eaten_on)).size < RATIO_MIN_DAYS) return null
  let kcal = 0, p = 0, f = 0, c = 0
  for (const r of mine) {
    const q = Number(r.qty)
    kcal += Number(r.kcal) * q
    p += Number(r.protein) * q
    f += Number(r.fat) * q
    c += Number(r.carb) * q
  }
  if (!(kcal > 0) || ![p, f, c].every(Number.isFinite)) return null
  return { protein: (p * 4) / kcal, fat: (f * 9) / kcal, carb: (c * 4) / kcal }
}

/** 只有熱量的一列（檔位、自己打的數字）：品名預設空＝「餐別＋tag」（寫入時才決定是哪一餐），可以改。
 *  有比例就照比例粗估三大營養素（標粗估），沒有就記 0（標只估了熱量）。 */
function kcalOnlyDraft(kcal: number, tag: string, ratioIn: MacroRatio | null): EstimateDraft {
  const k = Math.round(kcal)
  // 0 卡沒有東西可以照比例分，之後改熱量也換算不出來（origin 是 0）——當成只估熱量，不標粗估（v2.142 review）
  const ratio = k > 0 ? ratioIn : null
  const protein = ratio ? round1((k * ratio.protein) / 4) : 0
  const fat = ratio ? round1((k * ratio.fat) / 9) : 0
  const carb = ratio ? round1((k * ratio.carb) / 4) : 0
  return {
    key: nextKey(),
    name: '',
    tag,
    kcal: k,
    kcalDraft: String(k),
    protein,
    fat,
    carb,
    low: null,
    high: null,
    assumption: null,
    kcalOnly: ratio === null,
    macrosGuessed: ratio !== null,
    keep: false,
    foodId: null,
    origin: { kcal: k, protein, fat, carb },
  }
}

/** 檔位或自己打的（不是 AI 估的）：AI 重估時保留、不算進「估好了 N 樣」。只看 kcalOnly 不夠——粗估的列 kcalOnly 是 false（v2.142 review）。 */
export const isManualDraft = (d: Pick<EstimateDraft, 'kcalOnly' | 'macrosGuessed'>): boolean => d.kcalOnly || d.macrosGuessed

export function draftFromTier(tier: TierKey, ratio: MacroRatio | null = null): EstimateDraft {
  const t = TIERS.find((x) => x.key === tier)
  if (!t) throw new Error(`unknown tier: ${tier}`)
  return kcalOnlyDraft(t.kcal, `（${t.label}）`, ratio)
}

export function draftFromKcal(kcal: number, ratio: MacroRatio | null = null): EstimateDraft {
  return kcalOnlyDraft(kcal, '', ratio)
}

/** 熱量框的字：空字串、非數字、負數、超過資料庫上界都不收（回 null）。小數照收、四捨五入到整數。 */
export function parseKcal(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > MACRO_MAX) return null
  return Math.round(n)
}

/** 改熱量：三大營養素照 origin 的比例換算（不是照「目前」的數字，見 origin 的註解），熱量和營養素才對得起來。
 *  origin 是 0 卡的列沒有比例可用，營養素維持 origin。打到一半不合法時只更新 kcalDraft，數字維持上一個合法值。 */
export function withKcalInput(d: EstimateDraft, raw: string): EstimateDraft {
  const k = parseKcal(raw)
  if (k === null) return { ...d, kcalDraft: raw }
  const o = d.origin
  if (o.kcal === 0) return { ...d, kcal: k, kcalDraft: raw, protein: o.protein, fat: o.fat, carb: o.carb }
  const r = k / o.kcal
  return { ...d, kcal: k, kcalDraft: raw, protein: round1(o.protein * r), fat: round1(o.fat * r), carb: round1(o.carb * r) }
}

/** 失焦時把熱量框的字收回成合法數字。 */
export function settleKcal(d: EstimateDraft): EstimateDraft {
  return { ...d, kcalDraft: String(d.kcal) }
}

/** 品名空著時的預設（也是品名框的 placeholder）。 */
export function defaultDraftName(d: EstimateDraft, meal: MealKey): string {
  return mealLabel(meal) + d.tag
}

export function draftName(d: EstimateDraft, meal: MealKey): string {
  return d.name.trim() || defaultDraftName(d, meal)
}

export function estimateTotals(drafts: readonly EstimateDraft[]) {
  return drafts.reduce(
    (t, d) => ({ n: t.n + 1, kcal: t.kcal + d.kcal, protein: t.protein + d.protein, fat: t.fat + d.fat, carb: t.carb + d.carb }),
    { n: 0, kcal: 0, protein: 0, fat: 0, carb: 0 },
  )
}

/** 建 foods 用的那一筆。店家一律空：估算沒有抽店家（spec A「明確不做」）。 */
export function draftToFood(d: EstimateDraft, meal: MealKey) {
  return { name: draftName(d, meal), vendor: null, kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb }
}

/** 寫 intake 用的列（份量 1、營養快照＝草稿當下的數字）。還沒建好 food 的列不該走到這裡，丟錯讓呼叫端知道順序錯了。 */
export function draftsToIntake(drafts: readonly EstimateDraft[], meal: MealKey, date: string) {
  return drafts.map((d) => {
    if (d.foodId === null) throw new Error(`draft ${d.key} has no foodId yet`)
    return { eaten_on: date, meal, food_id: d.foodId, qty: 1, kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb, name: null }
  })
}

/** 描述框：送出前 trim，1–300 字（以 code point 計，同 handler.ts）。 */
export const ESTIMATE_TEXT_MAX = 300
export function estimateTextOk(text: string): boolean {
  const n = [...text.trim()].length
  return n >= 1 && n <= ESTIMATE_TEXT_MAX
}

/** 回應是外部資料：逐欄驗型別。任一樣不合法整組丟掉（同 handler：悄悄少一樣使用者不會發現）。 */
export function parseEstimateResponse(data: unknown): EstimateItem[] | null {
  if (typeof data !== 'object' || data === null) return null
  const items = (data as { items?: unknown }).items
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) return null
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const out: EstimateItem[] = []
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) return null
    const it = raw as Record<string, unknown>
    const nums = [it.kcal, it.kcal_low, it.kcal_high, it.protein_g, it.fat_g, it.carb_g]
    if (!nums.every(fin)) return null
    const [kcal, lo, hi, p, f, c] = nums as number[]
    if (kcal < 0 || kcal > 3000 || !(lo <= kcal && kcal <= hi) || [p, f, c].some((g) => g < 0 || g > 300)) return null
    out.push({
      name: typeof it.name === 'string' ? it.name : null,
      kcal, kcal_low: lo, kcal_high: hi, protein_g: p, fat_g: f, carb_g: c,
      assumption: typeof it.assumption === 'string' ? it.assumption : null,
    })
  }
  return out
}
