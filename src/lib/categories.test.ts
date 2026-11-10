import { describe, expect, it } from 'vitest'
import { FOOD_CATEGORIES, categoryOf, isMealType, normalizeCategory, withCategories } from './categories'

describe('固定清單', () => {
  it('餐點類型 12 個、搭配類 5 個，順序照 spec', () => {
    expect(FOOD_CATEGORIES).toEqual([
      '燒臘', '便當', '健康餐盒', '飯類', '麵食', '餃類', '速食', '早餐店', '滷味／鹽水雞', '鍋物', '日式', '其他正餐',
      '飲料', '蛋白質補充', '配菜', '主食', '點心',
    ])
  })
})

describe('normalizeCategory', () => {
  it('清單內原樣、前後空白去掉', () => {
    expect(normalizeCategory('便當')).toBe('便當')
    expect(normalizeCategory('  燒臘 ')).toBe('燒臘')
  })

  it('半形斜線當全形', () => {
    expect(normalizeCategory('滷味/鹽水雞')).toBe('滷味／鹽水雞')
  })

  it.each([['炸物'], [''], ['其他'], [null], [undefined], [3], [{ category: '便當' }]])('清單外 %j ⇒ 其他正餐', (v) => {
    expect(normalizeCategory(v)).toBe('其他正餐')
  })
})

describe('categoryOf', () => {
  it('null／undefined 是還沒分類，其餘照 normalize', () => {
    expect(categoryOf(null)).toBeNull()
    expect(categoryOf(undefined)).toBeNull()
    expect(categoryOf('飲料')).toBe('飲料')
    expect(categoryOf('不在清單')).toBe('其他正餐')
  })
})

describe('isMealType', () => {
  it('餐點類型是、搭配類與 null 不是', () => {
    expect(isMealType('燒臘')).toBe(true)
    expect(isMealType('其他正餐')).toBe(true)
    expect(isMealType('飲料')).toBe(false)
    expect(isMealType('蛋白質補充')).toBe(false)
    expect(isMealType(null)).toBe(false)
    expect(isMealType('不在清單')).toBe(false)
  })
})

describe('withCategories', () => {
  const rows = [
    { food_id: 1, foods: { name: 'a', category: null } },
    { food_id: 2, foods: { name: 'b', category: '便當' } },
    { food_id: 3, foods: null },
  ]

  it('沒有覆寫時原樣回傳同一個陣列', () => {
    expect(withCategories(rows, new Map())).toBe(rows)
  })

  it('有覆寫的 food_id 換掉類型，其他欄位不動；食物不存在的列不補', () => {
    const out = withCategories(rows, new Map([[1, '燒臘'], [2, '飯類'], [3, '點心']]))
    expect(out).toEqual([
      { food_id: 1, foods: { name: 'a', category: '燒臘' } },
      { food_id: 2, foods: { name: 'b', category: '飯類' } },
      { food_id: 3, foods: null },
    ])
    expect(rows[0].foods!.category, '不改原本的列').toBeNull()
  })
})
