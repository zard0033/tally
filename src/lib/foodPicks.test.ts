import { describe, expect, it } from 'vitest'
import type { Food } from './api'
import { byQuotaFit, overQuotaAmounts, quotaOverage } from './foodPicks'
import type { Targets } from './formulas'

const food = (id: number, kcal: number, protein: number, fat: number, carb: number): Food => ({
  id, name: `f${id}`, vendor: null, kcal, protein, fat, carb, archived: false, category: null, category_manual: false,
  verified: false, aliases: [],
})
const A = food(1, 200, 30, 5, 0)
const B = food(2, 280, 5, 1, 60)
const C = food(3, 100, 2, 3, 15)
const D = food(4, 10, 0, 0, 1)

const T: Targets = { age: 30, bmr: null, tdee: null, formulaTdee: null, kcal: 2000, protein: 120, fat: 60, carb: 250 }
const EATEN = { kcal: 1700, protein: 100, fat: 50, carb: 200 }

describe('quotaOverage', () => {
  it('2 份 A：kcal 1700+400=2100 超 100；脂 50+10=60、碳 200 剛好不超', () => {
    expect(quotaOverage(A, 2, EATEN, T)).toEqual({ kcal: 100, fat: 0, carb: 0 })
  })
  it('1 份 B：kcal 1980 沒超；碳 200+60=260 超 10', () => {
    expect(quotaOverage(B, 1, EATEN, T)).toEqual({ kcal: 0, fat: 0, carb: 10 })
  })
})

describe('overQuotaAmounts', () => {
  const qtyOf = (f: Food) => (f.id === 1 ? 2 : 1)
  it('只收會超標的品項，吃得下的不在裡面', () => {
    const m = overQuotaAmounts([A, B, C], qtyOf, EATEN, T)
    expect([...m.keys()]).toEqual([1, 2])
    expect(m.get(1)).toEqual({ kcal: 100, fat: 0, carb: 0 })
    expect(m.get(2)).toEqual({ kcal: 0, fat: 0, carb: 10 })
    expect(m.has(3)).toBe(false) // C：kcal 1800、脂 53、碳 215 都沒超
  })
  it('用傳進來的份量算：A 改 1 份（kcal 1900）就吃得下', () => {
    expect(overQuotaAmounts([A], () => 1, EATEN, T).size).toBe(0)
  })
})

describe('byQuotaFit', () => {
  const amounts = overQuotaAmounts([A, B, C, D], (f) => (f.id === 1 ? 2 : 1), EATEN, T)
  it('吃得下的排前面，超標的依超出總量由小到大（B 10 < A 100）', () => {
    expect(byQuotaFit([A, C, B], amounts).map((f) => f.id)).toEqual([3, 2, 1])
  })
  it('同組內維持原本順序（穩定排序）', () => {
    expect(byQuotaFit([D, A, C], amounts).map((f) => f.id)).toEqual([4, 3, 1])
    expect(byQuotaFit([C, D], amounts).map((f) => f.id)).toEqual([3, 4])
  })
  it('不改動傳進來的陣列', () => {
    const list = [A, C, B]
    byQuotaFit(list, amounts)
    expect(list.map((f) => f.id)).toEqual([1, 3, 2])
  })
})
