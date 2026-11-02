import { useCallback, useState } from 'react'
import { createFood as apiCreateFood, updateFood as apiUpdateFood, type Food, type NewFood } from '@/lib/api'
import { byFoodName } from '@/lib/foodForm'

export function useFoods() {
  const [foods, setFoods] = useState<Food[] | null>(null)

  const handleCreateFood = useCallback(async (food: NewFood): Promise<Food> => {
    const created = await apiCreateFood(food)
    setFoods((prev) => [...(prev ?? []), created].sort(byFoodName))
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

  return { foods, setFoods, handleCreateFood, handleUpdateFood, handleArchiveFood, handleUnarchiveFood }
}
