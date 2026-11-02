/* 每日目標頁（DailyGoal）送出前的欄位檢查。畫面只負責把輸入框轉成數字（空白＝NaN）再丟進來，
   回傳錯誤文字，通過回 null——檢查規則在這裡，才單測得到。 */

/** 自訂目標：熱量要是大於 0 的數字，蛋白質／脂肪／碳水要是不小於 0 的數字（0 合法）。 */
export function checkCustomTargets(v: { kcal: number; proteinG: number; fatG: number; carbG: number }): string | null {
  if (!Number.isFinite(v.kcal) || v.kcal <= 0) return '熱量要填數字'
  if (![v.proteinG, v.fatG, v.carbG].every((n) => Number.isFinite(n) && n >= 0)) {
    return '蛋白質／脂肪／碳水都要填數字'
  }
  return null
}

/** Mifflin-St Jeor 用到的出生年與身高：出生年落在 1900–thisYear，身高大於 0。 */
export function checkBodyBasics(v: { birthYear: number; height: number }, thisYear: number): string | null {
  if (!Number.isFinite(v.birthYear) || v.birthYear < 1900 || v.birthYear > thisYear) {
    return '出生年要填合理的西元年'
  }
  if (!Number.isFinite(v.height) || v.height <= 0) return '身高要填數字'
  return null
}
