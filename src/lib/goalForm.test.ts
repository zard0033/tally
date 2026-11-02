import { describe, expect, it } from 'vitest'
import { checkBodyBasics, checkCustomTargets } from './goalForm'

describe('checkCustomTargets', () => {
  const ok = { kcal: 1800, proteinG: 120, fatG: 60, carbG: 200 }
  it('都填了數字 → 通過', () => {
    expect(checkCustomTargets(ok)).toBeNull()
  })
  it('蛋白質／脂肪／碳水可以是 0（無碳飲食合法），不能是負數', () => {
    expect(checkCustomTargets({ ...ok, proteinG: 0, fatG: 0, carbG: 0 })).toBeNull()
    expect(checkCustomTargets({ ...ok, fatG: -1 })).toBe('蛋白質／脂肪／碳水都要填數字')
  })
  it('熱量必須大於 0；空白（NaN）也不行', () => {
    expect(checkCustomTargets({ ...ok, kcal: 0 })).toBe('熱量要填數字')
    expect(checkCustomTargets({ ...ok, kcal: Number.NaN })).toBe('熱量要填數字')
  })
  it('營養素空白（NaN）→ 營養素的錯誤', () => {
    expect(checkCustomTargets({ ...ok, carbG: Number.NaN })).toBe('蛋白質／脂肪／碳水都要填數字')
  })
  it('兩邊都錯時先報熱量', () => {
    expect(checkCustomTargets({ kcal: -5, proteinG: Number.NaN, fatG: 1, carbG: 1 })).toBe('熱量要填數字')
  })
})

describe('checkBodyBasics', () => {
  it('合理的出生年與身高 → 通過；出生年界線含 1900 與今年', () => {
    expect(checkBodyBasics({ birthYear: 1990, height: 175 }, 2026)).toBeNull()
    expect(checkBodyBasics({ birthYear: 1900, height: 175 }, 2026)).toBeNull()
    expect(checkBodyBasics({ birthYear: 2026, height: 50 }, 2026)).toBeNull()
  })
  it('出生年 1899、明年、空白（NaN）都不行', () => {
    expect(checkBodyBasics({ birthYear: 1899, height: 175 }, 2026)).toBe('出生年要填合理的西元年')
    expect(checkBodyBasics({ birthYear: 2027, height: 175 }, 2026)).toBe('出生年要填合理的西元年')
    expect(checkBodyBasics({ birthYear: Number.NaN, height: 175 }, 2026)).toBe('出生年要填合理的西元年')
  })
  it('身高必須大於 0', () => {
    expect(checkBodyBasics({ birthYear: 1990, height: 0 }, 2026)).toBe('身高要填數字')
    expect(checkBodyBasics({ birthYear: 1990, height: Number.NaN }, 2026)).toBe('身高要填數字')
  })
  it('兩邊都錯時先報出生年', () => {
    expect(checkBodyBasics({ birthYear: 1800, height: 0 }, 2026)).toBe('出生年要填合理的西元年')
  })
})
