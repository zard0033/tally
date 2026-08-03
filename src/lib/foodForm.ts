/* 新增／編輯食物表單的純邏輯（品名、店家、熱量、三大營養素）。原本各自長在 LogSheet 的
   「新增食物」與這輪新增的食品庫就地編輯／範本新增裡，三處欄位規則逐字重複——抽成這裡
   共用，UI（renderField 之類的 JSX）留在各自的 screen，這裡只管字串轉數字與驗證。 */

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
