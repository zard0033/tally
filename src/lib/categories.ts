/* 食物類型的固定清單（spec.md C 節「第三版」，使用者 2026-11-10 核可）。AI 只能從這張清單挑，
   挑不到一律「其他正餐」——同一類永遠同一個字，判斷重複才對得上。
   supabase/functions/read-label/handler.ts 有一份同樣的清單（Edge Function 不能 import src），
   兩份由 handler.test.ts 比對，改這裡要一起改那裡。純函式、不碰 DOM。 */

/** 餐點類型：參與避開重複的判斷。 */
export const MEAL_TYPE_CATEGORIES = [
  '燒臘', '便當', '健康餐盒', '飯類', '麵食', '餃類', '速食', '早餐店', '滷味／鹽水雞', '鍋物', '日式', '其他正餐',
] as const
/** 搭配類：永遠不算重複。 */
export const SIDE_CATEGORIES = ['飲料', '蛋白質補充', '配菜', '主食', '點心'] as const

export type FoodCategory = (typeof MEAL_TYPE_CATEGORIES)[number] | (typeof SIDE_CATEGORIES)[number]

export const FOOD_CATEGORIES: readonly FoodCategory[] = [...MEAL_TYPE_CATEGORIES, ...SIDE_CATEGORIES]
export const FALLBACK_CATEGORY: FoodCategory = '其他正餐'

const isListed = (v: string): v is FoodCategory => (FOOD_CATEGORIES as readonly string[]).includes(v)

/** 清單外（含非字串）一律「其他正餐」。半形斜線當成全形：模型常把「滷味／鹽水雞」寫成半形。 */
export function normalizeCategory(v: unknown): FoodCategory {
  if (typeof v !== 'string') return FALLBACK_CATEGORY
  const t = v.trim().replace(/\//g, '／')
  return isListed(t) ? t : FALLBACK_CATEGORY
}

/** 資料庫讀回來的值：null＝還沒分類（不參與類型判斷），其餘照 normalizeCategory。 */
export function categoryOf(v: string | null | undefined): FoodCategory | null {
  return v == null ? null : normalizeCategory(v)
}

export function isMealType(c: string | null | undefined): boolean {
  return c != null && (MEAL_TYPE_CATEGORIES as readonly string[]).includes(c)
}

/** 本次 session 補判或手動改過的類型，蓋到查詢結果的 foods.category 上（查詢的 join 是補判前撈的）。 */
export function withCategories<T extends { food_id: number; foods: { category: string | null } | null }>(
  rows: T[],
  overrides: ReadonlyMap<number, FoodCategory>,
): T[] {
  if (overrides.size === 0) return rows
  return rows.map((r) => {
    const c = overrides.get(r.food_id)
    return c && r.foods ? { ...r, foods: { ...r.foods, category: c } } : r
  })
}

/** 一餐要疊幾個類型圖示：照出現順序去重、未分類也算一種（同一個中性圖示），最多 max 個。 */
export function iconStack(raw: readonly (string | null | undefined)[], max = 3): (FoodCategory | null)[] {
  const out: (FoodCategory | null)[] = []
  for (const v of raw) {
    const c = categoryOf(v)
    if (!out.includes(c)) out.push(c)
    if (out.length === max) break
  }
  return out
}

/** 一組建議的代表類型：先挑餐點類型（便當、麵食…），沒有才用搭配類，全都沒分類就是 null。 */
export function leadCategory(raw: readonly (string | null | undefined)[]): FoodCategory | null {
  const cats = raw.map(categoryOf)
  return cats.find((c) => c !== null && isMealType(c)) ?? cats.find((c) => c !== null) ?? null
}
