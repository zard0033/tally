/* 餐別常數與預設餐別判斷。純函式、不碰 DOM。照 legacy/app.js 的 MEALS／
   mealLabel／defaultMeal 逐字搬語意。三個畫面（Today／LogSheet）都要用到同一份
   餐別清單與標籤，集中在這裡，避免各自重複一份會走鐘的常數。 */

export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface Meal {
  key: MealKey
  label: string
}

export const MEALS: Meal[] = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
  { key: 'snack', label: '點心' },
]

export const mealLabel = (key: MealKey): string => MEALS.find((m) => m.key === key)?.label ?? ''

/** 主 CTA 沒指定餐別時，依時間預選一個 chip：早餐 <10、午餐 <15、晚餐 <21、其餘點心。 */
export function defaultMeal(now: Date = new Date()): MealKey {
  const h = now.getHours()
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack'
}
