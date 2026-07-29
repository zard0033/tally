import { describe, expect, it } from 'vitest'
import { ageOn, localDate, shiftDate, weekdayDate } from './dates'

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

describe('ageOn', () => {
  it('生日前一天：還沒滿歲', () => {
    expect(ageOn('1993-07-29', new Date(2026, 6, 28))).toBe(32)
  })
  it('生日當天：已經滿歲', () => {
    expect(ageOn('1993-07-29', new Date(2026, 6, 29))).toBe(33)
  })
})
