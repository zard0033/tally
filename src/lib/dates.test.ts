import { describe, expect, it } from 'vitest'
import { ageFromYear, isPlannable, localDate, maxPlanDate, shiftDate, weekdayDate } from './dates'

describe('localDate', () => {
  it('本地時區 yyyy-mm-dd，不受 UTC 偏移影響', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('shiftDate', () => {
  it('跨月', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('跨年', () => {
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
  })
  it('閏日', () => {
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29')
  })
})

/* v2.47：可檢視範圍的上界。**測的是「界在明天」這個規則本身**，不是 shiftDate
   （那個上面已經測過了）——所以每條都顯式傳入 today，不依賴系統時鐘，
   否則測試會在跨月／跨年那幾天自己變成另一個案例。 */
describe('maxPlanDate', () => {
  it('就是明天', () => {
    expect(maxPlanDate('2026-07-28')).toBe('2026-07-29')
  })
  it('跨月', () => {
    expect(maxPlanDate('2026-02-28')).toBe('2026-03-01')
  })
  it('跨年', () => {
    expect(maxPlanDate('2025-12-31')).toBe('2026-01-01')
  })
  it('閏年的 2/28 往前是 2/29，不是 3/1', () => {
    expect(maxPlanDate('2024-02-28')).toBe('2024-02-29')
  })
  it('不帶參數時以今天為基準（界會跟著午夜自己移動）', () => {
    expect(maxPlanDate()).toBe(shiftDate(localDate(), 1))
  })
})

/* v2.47（deep review 補）：「這天還能不能改變結果」。**兩個畫面問同一件事**——今日頁的
   主數字、記一筆 sheet 的確認列，所以它必須只有一份定義。同樣顯式傳 today，不吃系統時鐘。 */
describe('isPlannable', () => {
  it('今天為真', () => {
    expect(isPlannable('2026-07-28', '2026-07-28')).toBe(true)
  })
  it('明天為真——這正是 v2.47 開放的那一天', () => {
    expect(isPlannable('2026-07-29', '2026-07-28')).toBe(true)
  })
  it('昨天為假', () => {
    expect(isPlannable('2026-07-27', '2026-07-28')).toBe(false)
  })
  it('純字串比較，跨月不會出錯', () => {
    expect(isPlannable('2026-03-01', '2026-02-28')).toBe(true)
    expect(isPlannable('2026-02-28', '2026-03-01')).toBe(false)
  })
})

describe('weekdayDate', () => {
  it('格式為「週N M/D」、不帶年份', () => {
    expect(weekdayDate('2026-07-28')).toBe('週二 7/28')
  })
  it('跨年也不受影響（純字串解析，不經過 UTC 轉換）', () => {
    expect(weekdayDate('2025-12-31')).toBe('週三 12/31')
    expect(weekdayDate('2026-01-01')).toBe('週四 1/1')
  })
  it('個位數月/日不補零', () => {
    expect(weekdayDate('2026-03-05')).toBe('週四 3/5')
  })
})

describe('ageFromYear', () => {
  it('今年減出生年', () => {
    expect(ageFromYear(1993, new Date(2026, 6, 29))).toBe(33)
  })
  it('無效輸入（NaN）回 NaN，不擋、不丟錯——由呼叫端（computeTargets → App.tsx 的 kcal 檢查）守門', () => {
    expect(Number.isNaN(ageFromYear(NaN, new Date(2026, 6, 29)))).toBe(true)
  })
})
