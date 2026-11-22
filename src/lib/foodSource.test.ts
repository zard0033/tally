import { describe, expect, it } from 'vitest'
import type { FoodSource } from './api'
import { isUnverified, kcalByFood, rankUnverified, sourceTag, SOURCE_CHOICES } from './foodSource'

describe('sourceTag', () => {
  it('只標標示／官方／粗估；自己填與未標不標', () => {
    expect(sourceTag('label')).toBe('標示')
    expect(sourceTag('official')).toBe('官方')
    expect(sourceTag('ai')).toBe('粗估')
    expect(sourceTag('manual')).toBe(null)
    expect(sourceTag('unknown')).toBe(null)
  })
  it('表單選項不含未標（未標＝沒選）', () => {
    expect(SOURCE_CHOICES.map((c) => c.key)).toEqual(['label', 'official', 'ai', 'manual'])
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
  const f = (id: number, name: string, source: FoodSource) => ({ id, name, source })
  const foods = [f(1, '乙', 'ai'), f(2, '甲', 'unknown'), f(3, '丙', 'official'), f(4, '丁', 'unknown'), f(5, '戊', 'label'), f(6, '己', 'manual'), f(7, '庚', 'unknown')]
  it('只留 AI 粗估與未標，吃最多的在前，沒吃過的排最後、照品名', () => {
    const eaten = new Map([[1, 300], [4, 900], [3, 5000], [5, 9999]])
    expect(rankUnverified(foods, eaten).map((x) => x.id)).toEqual([4, 1, 2, 7])
  })
  it('一樣都沒吃過 → 全照品名', () => {
    expect(rankUnverified(foods, new Map()).map((x) => x.name)).toEqual(['乙', '甲', '丁', '庚'].sort((a, b) => a.localeCompare(b, 'zh-Hant')))
  })
  it('isUnverified 與篩選一致；不改動傳進來的陣列', () => {
    expect((['label', 'official', 'ai', 'manual', 'unknown'] as FoodSource[]).filter(isUnverified)).toEqual(['ai', 'unknown'])
    const copy = [...foods]
    rankUnverified(foods, new Map([[7, 1]]))
    expect(foods).toEqual(copy)
  })
})
