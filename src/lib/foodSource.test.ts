import { describe, expect, it } from 'vitest'
import { kcalByFood, rankUnverified, sourceTag, SOURCE_CHOICES } from './foodSource'

describe('sourceTag', () => {
  it('只標粗估；官方標示不標', () => {
    expect(sourceTag(false)).toBe('粗估')
    expect(sourceTag(true)).toBe(null)
  })
  it('表單只有兩格：官方標示、粗估', () => {
    expect(SOURCE_CHOICES.map((c) => c.label)).toEqual(['官方標示', '粗估'])
  })
})

describe('kcalByFood', () => {
  it('快照熱量 × 份量，同一樣加總；numeric 欄回字串也照算', () => {
    const m = kcalByFood([
      { food_id: 1, kcal: 100, qty: 2 },
      { food_id: 1, kcal: 100, qty: 0.5 },
      { food_id: 2, kcal: '80' as unknown as number, qty: '1' as unknown as number },
    ])
    expect(m.get(1)).toBe(250)
    expect(m.get(2)).toBe(80)
    expect(m.has(3)).toBe(false)
  })
})

describe('rankUnverified', () => {
  const f = (id: number, name: string, verified: boolean) => ({ id, name, verified })
  const foods = [f(1, '乙', false), f(2, '甲', false), f(3, '丙', true), f(4, '丁', false), f(5, '戊', true), f(6, '己', true), f(7, '庚', false)]
  it('只留粗估，吃最多的在前，沒吃過的排最後、照品名', () => {
    const eaten = new Map([[1, 300], [4, 900], [3, 5000], [5, 9999]])
    expect(rankUnverified(foods, eaten).map((x) => x.id)).toEqual([4, 1, 2, 7])
  })
  it('一樣都沒吃過 → 全照品名', () => {
    expect(rankUnverified(foods, new Map()).map((x) => x.name)).toEqual(['乙', '甲', '丁', '庚'].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
  })
  it('不改動傳進來的陣列', () => {
    const copy = [...foods]
    rankUnverified(foods, new Map([[7, 1]]))
    expect(foods).toEqual(copy)
  })
})
