/* 新增／編輯食物表單的純邏輯（品名、店家、熱量、三大營養素）。原本各自長在 LogSheet 的
   「新增食物」與食品庫的就地編輯／範本新增裡，三處欄位規則逐字重複——抽成這裡共用。

   **v2.29 起 UI 那半也共用了**（`src/components/FoodFormFields.tsx`），原本這裡寫的
   「UI 留在各自的 screen」已作廢：那個分界撐不住，兩份 JSX 在它底下分岔過兩次
   （品名欄漏 inputMode、食品庫那份沒有店家 Autocomplete）。這個檔維持只放不沾 DOM 的
   邏輯，未來要原樣帶去 React Native。 */

export interface FoodForm {
  name: string
  vendor: string
  kcal: string
  protein: string
  fat: string
  carb: string
}

export const BLANK_FOOD_FORM: FoodForm = { name: '', vendor: '', kcal: '', protein: '', fat: '', carb: '' }

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
  return { food: { name, vendor, kcal, protein, fat, carb } }
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
export function readingToForm(r: LabelReading): Omit<FoodForm, 'vendor'> {
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
  }
}

export function foodToForm(f: { name: string; vendor: string | null; kcal: number; protein: number; fat: number; carb: number }): FoodForm {
  return {
    name: f.name,
    vendor: f.vendor ?? '',
    kcal: String(f.kcal),
    protein: String(f.protein),
    fat: String(f.fat),
    carb: String(f.carb),
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

/* 同時比對品名與店家——五筆「雞胸餐盒」其中三筆完全同名，只靠店家區分 */
export function foodMatches(f: { name: string; vendor: string | null }, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return f.name.toLowerCase().includes(s) || (f.vendor ?? '').toLowerCase().includes(s)
}
