import { describe, expect, it } from 'vitest'
import type { Food, RecentIntakeRow } from './api'
import { byQuotaFit, defaultQty, overQuotaAmounts, pickTotals, quotaOverage, recentStats } from './foodPicks'
import type { Targets } from './formulas'

const food = (id: number, kcal: number, protein: number, fat: number, carb: number): Food => ({
  id, name: `f${id}`, vendor: null, kcal, protein, fat, carb, archived: false, category: null, category_manual: false,
})
const A = food(1, 200, 30, 5, 0)
const B = food(2, 280, 5, 1, 60)
const C = food(3, 100, 2, 3, 15)
const D = food(4, 10, 0, 0, 1)
const byId = (id: number) => [A, B, C, D].find((f) => f.id === id)

const T: Targets = { age: 30, bmr: null, tdee: null, formulaTdee: null, kcal: 2000, protein: 120, fat: 60, carb: 250 }
const EATEN = { kcal: 1700, protein: 100, fat: 50, carb: 200 }

describe('pickTotals', () => {
  it('份量乘上每份營養後加總；樣數＝查得到的品項數', () => {
    // 2×A + 1×B：kcal 400+280、protein 60+5、fat 10+1、carb 0+60
    const t = pickTotals(new Map([[1, 2], [2, 1]]), byId)
    expect(t).toEqual({ n: 2, kcal: 680, protein: 65, fat: 11, carb: 60 })
  })
  it('查不到的 id（例如剛被封存）整筆略過，不算進樣數', () => {
    const t = pickTotals(new Map([[1, 1], [99, 3]]), byId)
    expect(t).toEqual({ n: 1, kcal: 200, protein: 30, fat: 5, carb: 0 })
  })
  it('什麼都沒選＝全 0', () => {
    expect(pickTotals(new Map(), byId)).toEqual({ n: 0, kcal: 0, protein: 0, fat: 0, carb: 0 })
  })
})

describe('recentStats', () => {
  // 由新到舊
  const hist: RecentIntakeRow[] = [
    { meal: 'lunch', food_id: 2, qty: 1 },
    { meal: 'lunch', food_id: 1, qty: 2 },
    { meal: 'lunch', food_id: 1, qty: 3 },
    { meal: 'dinner', food_id: 1, qty: 1 },
    { meal: 'lunch', food_id: 3, qty: 4 },
  ]
  it('各餐別按出現次數由多到少，同次數維持歷史出現順序；沒吃過的餐別是空陣列', () => {
    const { recent } = recentStats(hist)
    // 午餐：food1 兩次排第一；food2、food3 各一次，依出現順序
    expect(recent.get('lunch')).toEqual([1, 2, 3])
    expect(recent.get('dinner')).toEqual([1])
    expect(recent.get('breakfast')).toEqual([])
    expect(recent.get('snack')).toEqual([])
  })
  it('lastQty 取每個「餐別:食物」第一次見到的份量（＝最近一次）', () => {
    const { lastQty } = recentStats(hist)
    expect(lastQty.get('lunch:1')).toBe(2) // 不是更舊的 3
    expect(lastQty.get('lunch:2')).toBe(1)
    expect(lastQty.get('dinner:1')).toBe(1)
    expect(lastQty.get('lunch:3')).toBe(4)
    expect(lastQty.size).toBe(4)
  })
  it('沒有歷史＝四個餐別都空、lastQty 空', () => {
    const { recent, lastQty } = recentStats([])
    expect([...recent.values()]).toEqual([[], [], [], []])
    expect(lastQty.size).toBe(0)
  })
})

describe('defaultQty', () => {
  const lastQty = new Map([['lunch:1', 2], ['lunch:2', 0], ['lunch:3', NaN]])
  it('該餐上次的份量', () => {
    expect(defaultQty(lastQty, 'lunch', 1)).toBe(2)
  })
  it('沒紀錄、不是正數、餐別未定一律 1', () => {
    expect(defaultQty(lastQty, 'lunch', 9)).toBe(1)
    expect(defaultQty(lastQty, 'dinner', 1)).toBe(1)
    expect(defaultQty(lastQty, 'lunch', 2)).toBe(1)
    expect(defaultQty(lastQty, 'lunch', 3)).toBe(1)
    expect(defaultQty(lastQty, null, 1)).toBe(1)
  })
})

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
