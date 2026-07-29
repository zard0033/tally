/* 固定測試資料。移植自 C:\Users\Administrator\.claude\tools\tally-verify\verify.mjs
   （legacy vanilla 版回歸 harness）的同一組 FIX——沿用理由：目標熱量算得出來、
   「雞胸餐盒」兩筆同名不同 vendor 驗得了搜尋要吃兩欄。

   profile 這裡多補一個 user_id（legacy 沒有這個欄位，vanilla 版直接用全域 session；
   React 版 ProfileRow extends Profile 多了 user_id，updateProfile 呼叫要用到）。 */
export const TODAY = (() => {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
})()

export const USER_ID = '00000000-0000-0000-0000-000000000001'

export const FIX = {
  profile: [
    {
      user_id: USER_ID,
      sex: 'male',
      birth_date: '1993-01-01',
      height_cm: 175,
      activity_factor: 1.375,
      goal: 'cut',
      protein_pct: 27,
      fat_pct: 27,
      carb_pct: 46,
    },
  ],
  weight: [{ weight_kg: 75.95, measured_on: '2026-07-24' }],
  // 同名不同 vendor 是真實資料的形狀，搜尋必須兩個欄位都比對才分得開
  foods: [
    { id: 11, name: '雞胸餐盒', vendor: '健康盒', kcal: 420, protein: 45, fat: 12, carb: 30 },
    { id: 12, name: '雞胸餐盒', vendor: '減醣廚房', kcal: 380, protein: 42, fat: 9, carb: 28 },
    { id: 13, name: '乳清（1匙）', vendor: null, kcal: 120, protein: 24, fat: 1.5, carb: 2 },
    { id: 14, name: '地瓜', vendor: null, kcal: 130, protein: 2, fat: 0.2, carb: 31 },
    { id: 15, name: '無糖豆漿', vendor: '全家', kcal: 90, protein: 8, fat: 4, carb: 5 },
  ],
  // listRecentIntake 的形狀（meal, food_id, qty）——用於「常吃」排序
  history: [
    { meal: 'breakfast', food_id: 13, qty: 1 },
    { meal: 'breakfast', food_id: 15, qty: 1 },
    { meal: 'lunch', food_id: 11, qty: 1 },
  ],
  // listIntake(today) 的形狀，含 foods 巢狀關聯
  intake: [
    {
      id: 101,
      meal: 'breakfast',
      qty: 1,
      kcal: 120,
      protein: 24,
      fat: 1.5,
      carb: 2,
      foods: { name: '乳清（1匙）', vendor: null },
    },
    {
      id: 102,
      meal: 'lunch',
      qty: 1,
      kcal: 420,
      protein: 45,
      fat: 12,
      carb: 30,
      foods: { name: '雞胸餐盒', vendor: '健康盒' },
    },
  ],
}
