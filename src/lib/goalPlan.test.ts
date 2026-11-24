import { describe, expect, it } from 'vitest'
import { addMonths, arrivalLabel, arrivalText, directionOf, gapText, monthlyOf, monthsToGoal, reached, snapGoal, weeklyRate } from './goalPlan'
import { rateWeeklyToMonthly } from './formulas'

describe('directionOf：由目標體重推方向（±0.5 kg）', () => {
  it('輕 0.5 以上＝減重、重 0.5 以上＝增重、其餘＝維持', () => {
    expect(directionOf(66, 70.4)).toBe('cut')
    expect(directionOf(72, 70.4)).toBe('bulk')
    expect(directionOf(70.6, 70.4)).toBe('maintain')
    expect(directionOf(70.1, 70.4)).toBe('maintain')
  })
  it('剛好差 0.5 算有方向（浮點誤差不會把它推回維持）', () => {
    expect(directionOf(69.9, 70.4)).toBe('cut')
    expect(directionOf(70.9, 70.4)).toBe('bulk')
    expect(directionOf(0.1 + 0.2 + 69.6, 70.4)).toBe('cut') // 69.9000…01
    expect(directionOf(70.4 + 0.1 + 0.2 + 0.2, 70.4)).toBe('bulk') // 差 0.5000…01
  })
})

describe('gapText', () => {
  it('平均體重先捨到 0.1 再減（畫面寫「現在 76.0」）：75.95 對 77 是重 1.0、不是 1.05 捨成 1.0 或 1.1 看浮點運氣', () => {
    expect(gapText(77, 75.95)).toBe('比現在重 1.0 kg')
    expect(gapText(70, 75.95)).toBe('比現在輕 6.0 kg')
    expect(gapText(69.5, 70.05)).toBe('比現在輕 0.6 kg') // 畫面寫現在 70.1：70.1 − 69.5；直接減會是 0.5
    expect(directionOf(75.5, 75.95)).toBe('cut') // 畫面寫現在 76.0、目標 75.5，差 0.5＝有方向（直接減是 0.45＝維持）
  })
  it('寫距離、到 0.1 kg；差不到 0.5 寫「差不到」', () => {
    expect(gapText(66, 70.4)).toBe('比現在輕 4.4 kg')
    expect(gapText(72, 70.4)).toBe('比現在重 1.6 kg')
    expect(gapText(70.6, 70.4)).toBe('差不到 0.5 kg')
  })
})

describe('reached：減重 ≤ 目標、增重 ≥ 目標、維持沒有到', () => {
  it('邊界相等算到', () => {
    expect(reached('cut', 66, 66)).toBe(true)
    expect(reached('cut', 66, 66.1)).toBe(false)
    expect(reached('bulk', 72, 72)).toBe(true)
    expect(reached('bulk', 72, 71.9)).toBe(false)
    expect(reached('maintain', 70, 70)).toBe(false)
  })
})

describe('幾月到', () => {
  it('還差的公斤 ÷ 每月速度；維持、沒速度、已經到了回 null', () => {
    expect(monthsToGoal('cut', 66, 70.4, 1)).toBeCloseTo(4.4)
    expect(monthsToGoal('bulk', 72, 70.4, 0.5)).toBeCloseTo(3.2)
    expect(monthsToGoal('maintain', 66, 70.4, 1)).toBeNull()
    expect(monthsToGoal('cut', 66, 70.4, 0)).toBeNull()
    expect(monthsToGoal('cut', 70, 70, 1), '到了').toBeNull()
    expect(monthsToGoal('cut', 70, 69.8, 1), '減重卻已比目標輕').toBeNull()
  })
  it('±0.5 只用來選方向：方向定了，最後那 0.5 kg 照樣有日期', () => {
    expect(arrivalText('2026-11-24', 'cut', 70, 70.3, 1)).not.toBeNull()
    expect(arrivalText('2026-11-24', 'bulk', 70.3, 70, 1)).not.toBeNull()
  })
  it('月初／中／底：1–10、11–20、21 以後', () => {
    expect(arrivalLabel('2026-11-24', '2027-04-10')).toBe('4 月初')
    expect(arrivalLabel('2026-11-24', '2027-04-11')).toBe('4 月中')
    expect(arrivalLabel('2026-11-24', '2027-04-20')).toBe('4 月中')
    expect(arrivalLabel('2026-11-24', '2027-04-21')).toBe('4 月底')
  })
  it('年份看日期：今年不帶、明年但月份比這個月早不帶；明年同月或更晚寫「明年」、再之後寫西元年', () => {
    expect(arrivalLabel('2026-11-24', '2026-12-05')).toBe('12 月初')
    expect(arrivalLabel('2026-11-24', '2027-02-05')).toBe('2 月初')
    expect(arrivalLabel('2026-11-24', '2027-10-28')).toBe('10 月底')
    expect(arrivalLabel('2026-11-24', '2027-11-02')).toBe('明年 11 月初') // 不帶年會被讀成這個月
    expect(arrivalLabel('2026-11-24', '2027-12-28')).toBe('明年 12 月底')
    expect(arrivalLabel('2026-11-24', '2028-03-02')).toBe('2028 年 3 月初')
    // 剛好 12 個月：11/24 ＋ 364 天＝隔年 11/23
    expect(arrivalText('2026-11-24', 'cut', 64, 76, 1)).toBe('明年 11 月底')
  })
  it('arrivalText 串起來：11/24 起、差 4.4 kg、每月 1 kg → 4 月初', () => {
    expect(addMonths('2026-11-24', 4.4)).toBe('2027-04-06') // 4.4 × 30.33 ≈ 133 天
    expect(arrivalText('2026-11-24', 'cut', 66, 70.4, 1)).toBe('4 月初')
    expect(arrivalText('2026-11-24', 'cut', 70.4, 70.4, 1)).toBeNull()
  })
})

describe('速度換算', () => {
  it('weeklyRate 捨到 0.01（DB numeric(3,2)）；monthlyOf 換回 kg/月、沒有回 null', () => {
    expect(weeklyRate(1)).toBe(0.23)
    expect(monthlyOf(0.23)).toBeCloseTo(rateWeeklyToMonthly(0.23))
    expect(monthlyOf(null)).toBeNull()
    expect(monthlyOf(0)).toBeNull()
  })
})

describe('snapGoal：起始值對齊 0.5、夾在 30–250', () => {
  it.each([[70.4, 70.5], [70.2, 70], [75.95, 76], [12, 30], [400, 250]])('%s → %s', (kg, out) => {
    expect(snapGoal(kg)).toBe(out)
  })
})
