import { describe, expect, it } from 'vitest'
import { aliasVendors, clampVendor, intakeVendor, rowVendor, splitAlias, vendorInSentence } from './mealVendor'
import { exactMatch, keysOf } from './foodMatch'
import { aliasHit, foodMatches, vendorOptionsOf } from './foodForm'

const TEA = { id: 139, name: '手搖飲（無糖純茶＋寒天，大杯）', vendor: null, aliases: ['麻古 紅萱波波', '青山 菜燕春青'], verified: true, archived: false }

describe('splitAlias', () => {
  it('第一個空白前是店家，半形全形都算', () => {
    expect(splitAlias('麻古 紅萱波波')).toEqual({ vendor: '麻古', item: '紅萱波波' })
    expect(splitAlias('麻古　紅萱波波')).toEqual({ vendor: '麻古', item: '紅萱波波' })
    expect(splitAlias('紅港紅茶 紅港紅茶（白玉）')).toEqual({ vendor: '紅港紅茶', item: '紅港紅茶（白玉）' })
  })
  it('沒有空白就只有品名', () => {
    expect(splitAlias('熟成紅茶+白玉')).toEqual({ vendor: null, item: '熟成紅茶+白玉' })
  })
})

describe('rowVendor', () => {
  it('食物本身有店家優先，沒有才看這一筆記的', () => {
    expect(rowVendor({ vendor: '麻古', foods: { vendor: '壯壯餐盒' } })).toBe('壯壯餐盒')
    expect(rowVendor({ vendor: '麻古', foods: { vendor: null } })).toBe('麻古')
    expect(rowVendor({ vendor: '  ', foods: { vendor: null } })).toBeNull()
    expect(rowVendor({ foods: null })).toBeNull()
  })
})

describe('vendorInSentence（AC 7）', () => {
  const known = ['麻古', '麻古茶坊', '7-11', '吉']
  it('取最長的已知店家，全形半形、空白不影響', () => {
    expect(vendorInSentence('在麻古茶坊買了紅萱波波', known)).toBe('麻古茶坊')
    expect(vendorInSentence('在麻古買了紅萱波波和蛋餅', known)).toBe('麻古')
    expect(vendorInSentence('７－１１ 茶葉蛋', ['7-11'])).toBe('7-11')
  })
  it('沒提到、或只對到一個字的店家：null', () => {
    expect(vendorInSentence('夜市臭豆腐', known)).toBeNull()
    expect(vendorInSentence('吉野家牛丼', ['吉'])).toBeNull()
  })
})

describe('intakeVendor（AC 4）', () => {
  it('食物本身有店家就不寫；空白當沒有；超過 40 字截掉', () => {
    expect(intakeVendor({ vendor: '壯壯餐盒' }, '麻古')).toBeNull()
    expect(intakeVendor({ vendor: null }, ' 麻古 ')).toBe('麻古')
    expect(intakeVendor({ vendor: null }, '   ')).toBeNull()
    expect(intakeVendor({ vendor: null }, undefined)).toBeNull()
    expect([...(intakeVendor({ vendor: null }, '店'.repeat(45)) ?? '')].length).toBe(40)
  })
  it('照字截，不切斷 emoji', () => {
    const v = clampVendor('店'.repeat(39) + '🍜🍜')
    expect([...v]).toHaveLength(40)
    expect(v.endsWith('🍜')).toBe(true)
  })
})

describe('別名收一次（AC 9）', () => {
  it('搜尋：店名、品名、店名＋品名都找得到，對到的別名照回', () => {
    for (const q of ['麻古', '紅萱波波', '麻古紅萱', '麻古 紅萱']) {
      expect(foodMatches(TEA, q)).toBe(true)
      expect(aliasHit(TEA, q)).toBe('麻古 紅萱波波')
    }
  })
  it('比對鍵多收「品名」那段：估一筆 AI 回「紅萱波波」算完全一樣', () => {
    expect(keysOf(TEA)).toContain('紅萱波波')
    expect(keysOf(TEA)).toContain('麻古紅萱波波')
    expect(exactMatch('紅萱波波', [TEA], new Map())?.id).toBe(139)
    expect(exactMatch('麻古', [TEA], new Map())).toBeNull()
  })
  it('店家選項收別名裡的店家', () => {
    expect(aliasVendors([TEA, { aliases: ['麻古 珍珠奶茶', '熟成紅茶+白玉'] }])).toEqual(['麻古', '青山'])
    expect(vendorOptionsOf([TEA, { vendor: '7-11', aliases: [] }])).toEqual(expect.arrayContaining(['麻古', '青山', '7-11']))
  })
})
