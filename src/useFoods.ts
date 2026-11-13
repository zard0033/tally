import { useCallback, useState } from 'react'
import { createFood as apiCreateFood, updateFood as apiUpdateFood, type Food, type NewFood } from '@/lib/api'
import type { FoodCategory } from '@/lib/categories'
import { byFoodName } from '@/lib/foodForm'

export function useFoods() {
  const [foods, setFoods] = useState<Food[] | null>(null)

  /* archived：「估一筆」沒勾存進食品庫的列——建立就封存，不進「使用中」清單（今日頁選單不該冒出它）。 */
  const handleCreateFood = useCallback(async (food: NewFood, opts: { archived?: boolean } = {}): Promise<Food> => {
    const created = await apiCreateFood(food, opts)
    if (!created.archived) setFoods((prev) => [...(prev ?? []), created].sort(byFoodName))
    return created
  }, [])

  /* 食品庫管理頁的就地編輯：只動品名／店家／營養值，archived 不在 patch 裡。
   * App 的 foods（今日頁挑選清單）跟著更新同一筆，不必整包重撈。 */
  const handleUpdateFood = useCallback(async (id: number, patch: Partial<NewFood>): Promise<void> => {
    await apiUpdateFood(id, patch)
    setFoods((prev) => prev?.map((f) => (f.id === id ? { ...f, ...patch } : f)) ?? prev)
  }, [])

  /** 封存：從「使用中」清單移除（今日頁picker 不該再挑到它），回傳封存後的完整列
   *  給 FoodLibrary 的復原用——復原不必重新整包撈食品庫。呼叫端已經握著完整的 Food
   *  物件（就是清單裡點下封存那一列），直接收下來用，不必再回頭用 setFoods 的 updater
   *  當「順便讀一下目前 foods」的手段——updater 是否同步執行是 React 的最佳化細節，
   *  不是合約，拿它當讀取管道會在極少數時機（DB 已寫入成功後）踩到「找不到就 throw」，
   *  造成資料庫已封存、畫面卻回滾成失敗的不同步（precommit-review 抓到）。 */
  const handleArchiveFood = useCallback(async (food: Food): Promise<Food> => {
    await apiUpdateFood(food.id, { archived: true })
    setFoods((prev) => prev?.filter((f) => f.id !== food.id) ?? prev)
    return { ...food, archived: true }
  }, [])

  /** 復原：解封存，插回「使用中」清單並保持排序。 */
  const handleUnarchiveFood = useCallback(async (food: Food): Promise<void> => {
    await apiUpdateFood(food.id, { archived: false })
    setFoods((prev) => [...(prev ?? []).filter((f) => f.id !== food.id), { ...food, archived: false }].sort(byFoodName))
  }, [])

  /** 食品庫手動改類型：標成手動，之後 AI 補判不覆蓋。 */
  const handleSetFoodCategory = useCallback(async (id: number, category: FoodCategory): Promise<void> => {
    await apiUpdateFood(id, { category, category_manual: true })
    setFoods((prev) => prev?.map((f) => (f.id === id ? { ...f, category, category_manual: true } : f)) ?? prev)
  }, [])

  /** AI 補判寫入成功的類型。只補還沒有類型、沒手動改過的——補判途中手動改了的以手動為準。 */
  const applyAiCategories = useCallback((cats: ReadonlyMap<number, FoodCategory>) => {
    setFoods((prev) =>
      prev?.map((f) => {
        const c = cats.get(f.id)
        return c && f.category === null && !f.category_manual ? { ...f, category: c } : f
      }) ?? prev,
    )
  }, [])

  return {
    foods,
    setFoods,
    handleCreateFood,
    handleUpdateFood,
    handleArchiveFood,
    handleUnarchiveFood,
    handleSetFoodCategory,
    applyAiCategories,
  }
}
