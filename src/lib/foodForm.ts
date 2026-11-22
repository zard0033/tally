/* 新增／編輯食物表單的純邏輯（品名、店家、熱量、三大營養素）。原本各自長在 LogSheet 的
   「新增食物」與食品庫的就地編輯／範本新增裡，三處欄位規則逐字重複——抽成這裡共用。

   **v2.29 起 UI 那半也共用了**（`src/components/FoodFormFields.tsx`），原本這裡寫的
   「UI 留在各自的 screen」已作廢：那個分界撐不住，兩份 JSX 在它底下分岔過兩次
   （品名欄漏 inputMode、食品庫那份沒有店家 Autocomplete）。這個檔維持只放不沾 DOM 的
   邏輯，未來要原樣帶去 React Native。 */

import type { FoodSource } from './api'

/** 拍標示讀到的四個數字。只有拍照辨識會設它——存檔時任一個被改過，來源就從「標示」退成「自己填」。 */
export interface LabelScan {
  kcal: number
  protein: number
  fat: number
  carb: number
}

export interface FoodForm {
  name: string
  vendor: string
  kcal: string
  protein: string
  fat: string
  carb: string
  /** 來源（spec「食品庫改版」）。新增預設「自己填」；編輯舊食物帶它原本的，改數字不自動變。 */
  source: FoodSource
  aliases: string[]
  /** 一份幾克，空字串＝不知道。 */
  serving_g: string
  labelScan: LabelScan | null
}

export const BLANK_FOOD_FORM: FoodForm = { name: '', vendor: '', kcal: '', protein: '', fat: '', carb: '', source: 'manual', aliases: [], serving_g: '', labelScan: null }

/** 別名的界：對齊 DB check（cardinality ≤ 10），單個長度是表單自己的界。 */
export const ALIAS_MAX = 10
export const ALIAS_LEN_MAX = 40
/** 一份幾克的上界，對齊 DB check（serving_g ≤ 5000）。 */
export const SERVING_G_MAX = 5000

/** 輸入框打的字 → 加進別名：照頓號、逗號切開，去空白、去重（也不跟已有的重複）、丟掉空的。
 *  超過 10 個或單個超過 40 字不在這裡擋——存檔時 validateFoodForm 講原因，使用者才知道哪裡不行。 */
export function addAliases(current: readonly string[], input: string): string[] {
  const out = [...current]
  for (const raw of input.split(/[、，,]/)) {
    const a = raw.trim()
    if (a && !out.includes(a)) out.push(a)
  }
  return out
}

/** 熱量與三大營養素的上界，對齊 DB（schema.sql foods）：protein／fat／carb 是 `numeric(6,2)`、kcal 是
 *  `numeric(7,2)`，取嚴的那個當統一門檻。少了它，手滑多打一個 0 會讓 Postgres 回 numeric field overflow，
 *  使用者看到的是一句資料庫原文。就地編輯（ItemEditor）用同一個常數與同一句話。 */
export const MACRO_MAX = 9999.99

const fieldNum = (v: string): number => (v.trim() === '' ? NaN : Number(v.trim()))
/** 選填數值留空當 0——無糖飲料的蛋白質與脂肪本來就是 0，不必逼人打出來 */
const fieldOptNum = (v: string): number => (v.trim() === '' ? 0 : Number(v.trim()))

export interface ValidatedFood {
  name: string
  vendor: string | null
  kcal: number
  protein: number
  fat: number
  carb: number
  source: FoodSource
  aliases: string[]
  serving_g: number | null
}

/** 品名／熱量必填，三大營養素留空當 0。錯誤訊息跟既有 LogSheet 新增食物表單逐字一致。 */
export function validateFoodForm(form: FoodForm): { food: ValidatedFood } | { error: string } {
  const name = form.name.trim()
  const vendor = form.vendor.trim() || null
  const kcal = fieldNum(form.kcal)
  const protein = fieldOptNum(form.protein)
  const fat = fieldOptNum(form.fat)
  const carb = fieldOptNum(form.carb)
  if (!name) return { error: '品名要填' }
  if (!Number.isFinite(kcal) || kcal < 0) return { error: '熱量要填數字' }
  if (kcal > MACRO_MAX) return { error: `熱量要填 0 到 ${MACRO_MAX} 之間的數字` }
  if ([protein, fat, carb].some((n) => !Number.isFinite(n) || n < 0)) return { error: '營養素要填數字或留空' }
  if ([protein, fat, carb].some((n) => n > MACRO_MAX)) return { error: `營養素要填 0 到 ${MACRO_MAX} 之間的數字或留空` }
  const aliases = addAliases([], form.aliases.join('、'))
  if (aliases.length > ALIAS_MAX) return { error: `別名最多 ${ALIAS_MAX} 個` }
  if (aliases.some((a) => [...a].length > ALIAS_LEN_MAX)) return { error: `每個別名最多 ${ALIAS_LEN_MAX} 個字` }
  const raw = form.serving_g.trim() === '' ? null : Number(form.serving_g.trim())
  // DB 是 numeric(7,2)：先四捨五入到兩位再驗，否則 0.001 過得了這裡、到 DB 變 0.00 被 check 擋成一句原文錯誤
  const sg = raw === null || !Number.isFinite(raw) ? raw : Math.round(raw * 100) / 100
  if (sg !== null && (!Number.isFinite(sg) || sg <= 0 || sg > SERVING_G_MAX)) return { error: `一份幾克要大於 0、最多 ${SERVING_G_MAX}，或留空` }
  return { food: { name, vendor, kcal, protein, fat, carb, source: sourceAtSave(form, { kcal, protein, fat, carb }), aliases, serving_g: sg } }
}

/** 拍了標示又手改任一個數字 → 不再是標示上的數字，退成「自己填」。labelScan 只有拍照會設，
 *  所以編輯舊食物（沒拍）時來源照使用者選的，不因改數字自動變（spec「食品庫改版」）。 */
function sourceAtSave(form: FoodForm, n: LabelScan): FoodSource {
  const s = form.labelScan
  if (form.source !== 'label' || !s) return form.source
  return s.kcal === n.kcal && s.protein === n.protein && s.fat === n.fat && s.carb === n.carb ? 'label' : 'manual'
}

/** 店家 Autocomplete 的選項：食品庫裡出現過的 vendor 去重，按筆畫序排。
 *  排序 locale 明釘 `zh-Hant-u-co-stroke`——WebKit 目前的預設 collation 剛好就是筆畫序，
 *  但預設值不保證跨引擎/版本穩定（DESIGN.md v2.8）。
 *  **這段本來在 LogSheet 與 FoodLibrary 各有一份逐字相同的 useMemo**，v2.29 的
 *  precommit-review 抓到：那一輪的主旨正是消除兩份表單的分岔，卻在同一次改動裡
 *  製造了新的分岔源頭。兩處現在都呼叫這裡。 */
export function vendorOptionsOf(foods: { vendor: string | null }[] | null): string[] {
  if (!foods) return []
  const set = new Set<string>()
  for (const f of foods) if (f.vendor) set.add(f.vendor)
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant-u-co-stroke'))
}

/* 拍照辨識回來的讀數（spec.md AC4）。**這個型別在 Edge Function 那邊也有一份**
   （`supabase/functions/read-label/handler.ts` 的 `LabelReading`）——刻意不共用：
   兩邊是不同 runtime，讓前端 import 過去會把 `jose` 拖進 bundle，而為了一個七欄介面
   架一層共用型別模組是把管線蓋得比水還粗。契約由 spec.md AC4 定義，兩邊各自有測試釘住。 */
export interface LabelReading {
  name: string | null
  basis: 'per_serving' | 'per_100g'
  serving_g: number | null
  kcal: number
  protein_g: number
  fat_g: number
  carb_g: number
}

/**
 * 讀數 → 表單欄位。**店家不動**：標示上沒有店家，那欄是使用者自己的分類。
 *
 * 品名一律接上括號標籤，說明這組數字的基準是什麼——沒有它，「82 大卡」到底是一份還是
 * 一百公克無從得知，而那個差異在這張奶茶標示上是 5.9 倍。**讀不到品名時只留括號**
 * （`（每份 17g）`），使用者在前面補打即可；比整欄留白好用，因為括號那半已經填好了。
 */
export function readingToForm(r: LabelReading): Omit<FoodForm, 'vendor' | 'aliases'> {
  const label =
    r.basis === 'per_100g'
      ? '（每100克）'
      : r.serving_g === null
        ? '（每份）'
        : `（每份 ${r.serving_g}g）`
  return {
    name: `${r.name ?? ''}${label}`,
    kcal: String(r.kcal),
    protein: String(r.protein_g),
    fat: String(r.fat_g),
    carb: String(r.carb_g),
    source: 'label',
    // 每 100 克的標示：存下來的「一份」就是 100 克（review B4）；每份但讀不到重量就留空
    // 讀錯的每份重量（0、負的、超過 5000）丟掉留空：那欄收在「更多」裡，帶進去會在看不到的欄位上存不了檔
    serving_g:
      r.basis === 'per_100g' ? '100' : r.serving_g === null || !(r.serving_g > 0 && r.serving_g <= SERVING_G_MAX) ? '' : String(r.serving_g),
    labelScan: { kcal: r.kcal, protein: r.protein_g, fat: r.fat_g, carb: r.carb_g },
  }
}

export function foodToForm(f: {
  name: string
  vendor: string | null
  kcal: number
  protein: number
  fat: number
  carb: number
  source: FoodSource
  aliases: string[]
  serving_g: number | null
}): FoodForm {
  return {
    name: f.name,
    vendor: f.vendor ?? '',
    kcal: String(f.kcal),
    protein: String(f.protein),
    fat: String(f.fat),
    carb: String(f.carb),
    source: f.source,
    aliases: [...f.aliases],
    serving_g: f.serving_g === null ? '' : String(f.serving_g),
    labelScan: null,
  }
}

/** 食品庫的排序：依品名，中文照 zh-Hant 排。 */
export const byFoodName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'zh-Hant')

/** vendor 為 null 的食物在食品庫裡歸的那一組。 */
export const NO_VENDOR = '未標店家'

/** 依店家分組，未標店家的排最後——它不是一個真的店家名，跟著筆畫排序沒有意義。 */
export function groupByVendor<F extends { name: string; vendor: string | null }>(foods: F[]): { vendor: string; items: F[] }[] {
  const map = new Map<string, F[]>()
  for (const f of [...foods].sort(byFoodName)) {
    const key = f.vendor ?? NO_VENDOR
    const list = map.get(key)
    if (list) list.push(f)
    else map.set(key, [f])
  }
  const named = [...map.entries()]
    .filter(([v]) => v !== NO_VENDOR)
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant-u-co-stroke'))
  const rest = map.get(NO_VENDOR)
  return [...named, ...(rest ? [[NO_VENDOR, rest] as [string, F[]]] : [])]
    .map(([vendor, items]) => ({ vendor, items }))
}

/* 同時比對品名、店家與別名——五筆「雞胸餐盒」其中三筆完全同名，只靠店家區分；
   別名讓「中薯」找得到「麥當勞薯條（中）」（spec「食品庫改版」）。 */
export function foodMatches(f: { name: string; vendor: string | null; aliases?: readonly string[] }, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return f.name.toLowerCase().includes(s) || (f.vendor ?? '').toLowerCase().includes(s) || (f.aliases ?? []).some((a) => a.toLowerCase().includes(s))
}
