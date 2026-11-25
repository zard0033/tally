/* 「店家 品名」別名與別名收不收（v2.162；v2.167 起其餘的列邏輯搬到 logFind／logMeal）。 */
import { describe, expect, it } from 'vitest'
import { aliasProblem, vendorAliases } from './listRows'

const TEA = { vendor: null, aliases: ['麻古 紅萱波波', '青山 菜燕春青', '四季春'] }

describe('vendorAliases', () => {
  it('通用食物：有店家段的別名拆成店家＋品名；沒有店家段的不算', () => {
    expect(vendorAliases(TEA)).toEqual([
      { alias: '麻古 紅萱波波', vendor: '麻古', item: '紅萱波波' },
      { alias: '青山 菜燕春青', vendor: '青山', item: '菜燕春青' },
    ])
  })
  it('食物本身有店家就沒有（別名只幫忙搜尋）', () => {
    expect(vendorAliases({ vendor: '7-11', aliases: ['全家 厚乳'] })).toEqual([])
  })
})

describe('aliasProblem', () => {
  it('可以：null；含頓號逗號、超過 40 字、已經有（不分全半形大小寫）、滿 10 個：各自的原因', () => {
    expect(aliasProblem([], '冬檸')).toBeNull()
    expect(aliasProblem([], '冬、檸')).toBe('separator')
    expect(aliasProblem([], '冬'.repeat(41))).toBe('long')
    expect(aliasProblem(['ＡＢ'], 'ab')).toBe('exists')
    expect(aliasProblem(Array.from({ length: 10 }, (_, i) => `a${i}`), '冬檸')).toBe('full')
  })
})
