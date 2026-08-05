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

export const fieldNum = (v: string): number => (v.trim() === '' ? NaN : Number(v.trim()))
/** 選填數值留空當 0——無糖飲料的蛋白質與脂肪本來就是 0，不必逼人打出來 */
export const fieldOptNum = (v: string): number => (v.trim() === '' ? 0 : Number(v.trim()))

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
  if ([protein, fat, carb].some((n) => !Number.isFinite(n) || n < 0)) return { error: '營養素要填數字或留空' }
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
