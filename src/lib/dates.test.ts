import { describe, expect, it } from 'vitest'
import { ageFromYear, localDate, shiftDate, weekdayDate } from './dates'

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
