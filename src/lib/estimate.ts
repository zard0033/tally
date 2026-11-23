/* 「估一筆」的純邏輯（spec.md「A. 用一句話記一餐」2026-11-13 版，樣張 `_design-sample/estimate-entry.html` B）：
   AI 估回來的品項、三個檔位、自己打的數字，一律先變成「草稿列」；使用者看過、改過，「帶回清單」放進已選，
   跟清單勾的食物一起按「加入」才寫入（使用者 2026-11-13：估一筆的結果帶回 sheet 打勾，一次加入）。
   寫入分兩步：每一列先建一筆 foods（沒勾「存進食品庫」的直接封存），再寫 intake——intake 要 food_id。
   這一層禁沾 DOM（未來要原樣帶去 React Native）。 */
import { MACRO_MAX } from './foodForm'
import { exactMatch, nearMatch, normalizeKey, type MatchFood } from './foodMatch'
import { mealLabel, type MealKey } from './meals'
import { intakeVendor, vendorInSentence } from './mealVendor'
import { normalizeQty } from './quantity'

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
  /** AI 的列：估這一樣用的那句話（修正時一起送，v2.151）；檔位與自己打的是 null。 */
  sentence: string | null
  /** AI 給的品名：使用者改過品名（name ≠ aiName）就保留他的，修正只換數字與假設。 */
  aiName: string
  /** 最近一次修正的字（畫面小標「已照『…』修正」）；沒修正過是 null。 */
  fixedBy: string | null
  /** 修正過幾次：畫面用來判斷「剛修正完」要播熱量滾動。 */
  fixCount: number
  /** 食品庫的列（spec「食品庫改版」第二步）：數字是食品庫那一筆 × 份數，不建新食物，寫入時直接用那筆的 food_id。AI 的、檔位、自己打的是 null。 */
  lib: LibLink | null
  /** AI 的列：食品庫有相近的那一筆（按「改用」才換）；沒有或已經不要食品庫了是 null。 */
  near: NearFood | null
  /** 使用者選了 AI 估（按過「改用 AI 估」）：這一列不再自動換成食品庫、也不出相近提示，否則按了又被換回去。 */
  noLib: boolean
}

/** 食品庫列記住的那一筆：顯示、換算、寫入都用這份（之後食品庫改了，這張草稿的數字不跟著變）。 */
export interface LibFood {
  id: number
  name: string
  vendor: string | null
  verified: boolean
  kcal: number
  protein: number
  fat: number
  carb: number
}

export interface LibLink {
  food: LibFood
  qty: number
  /** 份量框正在打的字（同清單的 qtyDrafts）。 */
  qtyDraft: string
  /** pre＝送 AI 之前整段就對上了（沒叫 AI）；post＝AI 回來的那一樣對上的，或按了相近提示的「改用」。 */
  via: 'pre' | 'post'
  /** 對上的那一段原文（pre 的「改用 AI 估」拿它去估）。 */
  segment: string
  /** post 的列：換成食品庫之前 AI 給的那一樣，「改用 AI 估」就換回它。 */
  ai: EstimateItem | null
}

export interface NearFood {
  id: number
  name: string
  vendor: string | null
  kcal: number
}

let seq = 0
const nextKey = () => `est-${++seq}`

const round1 = (n: number) => Math.round(n * 10) / 10

/** AI 回來的品項 → 草稿列。品名讀不到時留空，顯示與寫入用餐別頂替，不讓一列沒有名字。
 *  sentence＝估這批用的那句話，修正時要一起送回去（v2.151）。 */
export function draftsFromItems(items: readonly EstimateItem[], sentence: string | null = null): EstimateDraft[] {
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
      sentence: sentence?.trim() || null,
      aiName: it.name?.trim() ?? '',
      fixedBy: null,
      fixCount: 0,
      lib: null,
      near: null,
      noLib: false,
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
    sentence: null,
    aiName: '',
    fixedBy: null,
    fixCount: 0,
    lib: null,
    near: null,
    noLib: false,
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

/** 建 foods 用的那一筆。店家一律空：估算沒有抽店家（spec A「明確不做」）。
 *  來源一律粗估——勾不勾存進食品庫都是（spec「食品庫改版」）；檔位與自己打的熱量列也走這裡，同樣是粗估。 */
export function draftToFood(d: EstimateDraft, meal: MealKey) {
  return { name: draftName(d, meal), vendor: null, kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb, verified: false }
}

/** 寫 intake 用的列（份量 1、營養快照＝草稿當下的數字）。還沒建好 food 的列不該走到這裡，丟錯讓呼叫端知道順序錯了。
 *  食品庫的列不建新食物：直接用那一筆的 food_id、份數，營養快照是那筆的單份值（同清單勾選的寫法）。 */
export function draftsToIntake(drafts: readonly EstimateDraft[], meal: MealKey, date: string, knownVendors: readonly string[] = []) {
  return drafts.map((d) => {
    // 句子裡提到已知店家（「在麻古買了…」）就記成這一餐的店家；食物本身有店家的不寫（spec「每一餐記店家」AC 7）
    const said = d.sentence ? vendorInSentence(d.sentence, knownVendors) : null
    if (d.lib) {
      const f = d.lib.food
      const v = intakeVendor(f, said)
      return { eaten_on: date, meal, food_id: f.id, qty: d.lib.qty, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb, name: null, ...(v ? { vendor: v } : {}) }
    }
    if (d.foodId === null) throw new Error(`draft ${d.key} has no foodId yet`)
    return { eaten_on: date, meal, food_id: d.foodId, qty: 1, kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb, name: null, ...(said ? { vendor: intakeVendor({ vendor: null }, said) ?? undefined } : {}) }
  })
}

/* ── 先查食品庫（spec「食品庫改版」第二步，樣張 estimate-library.html A） ── */

/** 比對要用的食物：MatchFood 加上數字（食品庫列要顯示、換算）。 */
export type LibCandidate = MatchFood & Omit<LibFood, 'id' | 'name' | 'vendor' | 'verified'>

const libFoodOf = (f: LibCandidate): LibFood => ({
  id: f.id, name: f.name, vendor: f.vendor, verified: f.verified,
  kcal: Number(f.kcal), protein: Number(f.protein), fat: Number(f.fat), carb: Number(f.carb),
})

/** 食品庫列：數字＝那一筆 × 份數（份數預設 1——AI 估的份數不搬過來，它可能是 8 顆的總熱量，食品庫是 1 顆）。 */
export function draftFromLibrary(f: LibCandidate, via: 'pre' | 'post', segment: string, ai: EstimateItem | null = null): EstimateDraft {
  return withLibQty(
    {
      key: nextKey(),
      name: f.name,
      tag: '',
      kcal: 0, kcalDraft: '0', protein: 0, fat: 0, carb: 0,
      low: null, high: null, assumption: null,
      kcalOnly: false, macrosGuessed: false, keep: false, foodId: null,
      origin: { kcal: 0, protein: 0, fat: 0, carb: 0 },
      sentence: null, aiName: '', fixedBy: null, fixCount: 0,
      lib: { food: libFoodOf(f), qty: 1, qtyDraft: '1', via, segment, ai },
      near: null,
      noLib: false,
    },
    1,
  )
}

/** 食品庫列換份數：熱量取整、營養素到 0.1（同清單小計的捨入）。不是食品庫列就原樣回傳。 */
export function withLibQty(d: EstimateDraft, qty: number, raw: string = String(qty)): EstimateDraft {
  if (!d.lib) return d
  const f = d.lib.food
  const kcal = Math.round(f.kcal * qty)
  return {
    ...d,
    kcal, kcalDraft: String(kcal),
    protein: round1(f.protein * qty), fat: round1(f.fat * qty), carb: round1(f.carb * qty),
    lib: { ...d.lib, qty, qtyDraft: raw },
  }
}

/** 食品庫列的份數按 −／＋（同清單：normalizeQty，最少 1 份由按鈕停用守）。 */
export const stepLibQty = (d: EstimateDraft, dir: 1 | -1): EstimateDraft => (d.lib ? withLibQty(d, normalizeQty(d.lib.qty + dir)) : d)

/** AI 的列：附上相近的那一筆（沒有就 null）。使用者選過 AI 估的列不附。 */
function withNear(d: EstimateDraft, foods: readonly LibCandidate[], rank: ReadonlyMap<number, number>): EstimateDraft {
  if (d.noLib || d.lib || isManualDraft(d)) return d
  const n = nearMatch(d.name || d.aiName, foods, rank)
  return { ...d, near: n ? { id: n.id, name: n.name, vendor: n.vendor, kcal: Math.round(Number(n.kcal)) } : null }
}

/**
 * ① 送 AI 之前：每一段都完全對上就回食品庫列（不叫 AI）；有一段對不上回 null（照舊整句送 AI）。
 * 段落是 splitSegments 切的；空句子回 null。
 */
export function resolveBeforeAi(segments: readonly string[], foods: readonly LibCandidate[], rank: ReadonlyMap<number, number>): EstimateDraft[] | null {
  if (segments.length === 0) return null
  const hits = segments.map((s) => exactMatch(s, foods, rank))
  if (hits.some((h) => h === null)) return null
  return hits.map((f, i) => draftFromLibrary(f as LibCandidate, 'pre', segments[i]))
}

/** ② AI 回來後：品名完全一樣的換成食品庫列（記住 AI 那一樣，可以換回去）；其餘照舊是 AI 的列、附相近提示。 */
export function resolveAfterAi(items: readonly EstimateItem[], sentence: string, foods: readonly LibCandidate[], rank: ReadonlyMap<number, number>): EstimateDraft[] {
  const said = normalizeKey(sentence)
  return items.map((it) => {
    const hit = it.name ? exactMatch(it.name, foods, rank) : null
    /* AI 回的品名常把店家拿掉（「星巴克拿鐵」回「拿鐵」），只靠品名會對到別家的那一筆（全家拿鐵）。
       那筆有店家、而使用者那句話裡沒提到這個店家 → 不自動換，降成相近提示、按了才換（v2.154 review H1）。 */
    if (hit && (!hit.vendor || said.includes(normalizeKey(hit.vendor)))) return { ...draftFromLibrary(hit, 'post', it.name ?? '', it), sentence }
    const [d] = draftsFromItems([it], sentence)
    if (hit) return { ...d, near: { id: hit.id, name: hit.name, vendor: hit.vendor, kcal: Math.round(Number(hit.kcal)) } }
    return withNear(d, foods, rank)
  })
}

/** ③ 相近提示的「改用」：AI 的列換成那一筆食品庫列，記住目前的估算（「改用 AI 估」換回來）。key 不變，畫面不重掛。 */
export function adoptNear(d: EstimateDraft, f: LibCandidate): EstimateDraft {
  const lib = draftFromLibrary(f, 'post', d.name || d.aiName, fixRequestItem(d))
  return { ...lib, key: d.key, sentence: d.sentence }
}

/** post 的食品庫列按「改用 AI 估」：換回 AI 那一樣，之後不再自動換、不再提示。pre 的列沒有 AI 結果，呼叫端要先去估。 */
export function backToAi(d: EstimateDraft): EstimateDraft {
  if (!d.lib?.ai) return d
  const [next] = draftsFromItems([d.lib.ai], d.sentence)
  return { ...next, key: d.key, noLib: true }
}

/** pre 的食品庫列按「改用 AI 估」、估回來的品項：取代那一列，同樣標「選過 AI」。 */
export function aiDraftsChosen(items: readonly EstimateItem[], sentence: string): EstimateDraft[] {
  return draftsFromItems(items, sentence).map((d) => ({ ...d, noLib: true }))
}

/** 結果上面那一行：都是送 AI 前就對上的＝「N 樣都在食品庫，沒叫 AI」；有食品庫也有 AI 的＝「N 樣用食品庫、M 樣 AI 估」。沒有食品庫列不出這行。 */
export function libSummary(drafts: readonly EstimateDraft[]): string | null {
  const lib = drafts.filter((d) => d.lib)
  if (lib.length === 0) return null
  const ai = drafts.filter((d) => !d.lib && !isManualDraft(d) && d.foodId === null).length
  if (ai === 0 && lib.every((d) => d.lib?.via === 'pre')) return `${lib.length} 樣都在食品庫，沒叫 AI`
  return ai === 0 ? `${lib.length} 樣用食品庫` : `${lib.length} 樣用食品庫、${ai} 樣 AI 估`
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

/* ── 修正（spec.md A2 階段 1，v2.151） ── */

/** 修正字的上限，同函式那端 MAX_FIX（碼位計）。 */
export const FIX_TEXT_MAX = 100
export function fixTextOk(text: string): boolean {
  const n = [...text.trim()].length
  return n >= 1 && n <= FIX_TEXT_MAX
}

/** 函式那端 parseEstimate 收的範圍（熱量 0–3000、三大營養素 0–300 克）：手改超過的列送去會被整個擋掉（400），乾脆不給修正。 */
const FIX_KCAL_MAX = 3000
const FIX_MACRO_MAX = 300

/** 可以修正的列：AI 估的、有那句話、還沒建好食物（建好之後那一列鎖住）、數字在函式收得下的範圍。檔位與自己打的沒有假設可改。 */
export const canFix = (d: EstimateDraft): boolean =>
  !isManualDraft(d) && d.lib === null && d.sentence !== null && d.foodId === null &&
  d.kcal <= FIX_KCAL_MAX && [d.protein, d.fat, d.carb].every((g) => g <= FIX_MACRO_MAX)

/**
 * 送去修正的「這一樣目前的估算」：照畫面上現在的數字（使用者手改過熱量就是改過的）。
 * 範圍要夾住目前的熱量——手改到範圍外時，函式那端照 parseEstimate 驗 low ≤ kcal ≤ high 會整個擋掉（400）。
 */
export function fixRequestItem(d: EstimateDraft): EstimateItem {
  const low = Math.min(d.low ?? d.kcal, d.kcal)
  const high = Math.max(d.high ?? d.kcal, d.kcal)
  return {
    name: d.name.trim() || d.aiName || null,
    kcal: d.kcal, kcal_low: low, kcal_high: high,
    protein_g: d.protein, fat_g: d.fat, carb_g: d.carb,
    assumption: d.assumption,
  }
}

/** 修正回來的結果套回那一列：數字、範圍、假設換新，換算基準（origin）重設；使用者改過品名就保留他的。key 與「存進食品庫」不變。 */
export function applyFix(d: EstimateDraft, it: EstimateItem, fix: string): EstimateDraft {
  const [next] = draftsFromItems([it], d.sentence)
  const userNamed = d.name.trim() !== '' && d.name !== d.aiName
  return {
    ...next,
    key: d.key,
    keep: d.keep,
    name: userNamed ? d.name : next.name,
    aiName: next.aiName,
    fixedBy: fix.trim(),
    fixCount: d.fixCount + 1,
    // 選過 AI 的列修正完還是 AI 的；相近提示照舊
    noLib: d.noLib,
    near: d.near,
  }
}

/** 小標「已照『…』修正」裡的修正字：超過 12 字截斷加…（碼位計，不切斷罕用字）。 */
export function fixTag(fix: string): string {
  const cs = [...fix.trim()]
  return cs.length > 12 ? `${cs.slice(0, 12).join('')}…` : cs.join('')
}
