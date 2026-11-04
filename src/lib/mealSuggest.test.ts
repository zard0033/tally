import { describe, expect, it } from 'vitest'
import type { IntakeRow } from './api'
import { isWeekend } from './dates'
import { macroGap } from './formulas'
import {
  mergeByFood,
  repeatToIntake,
  suggestLabel,
  suggestRepeat,
  suggestRepeatByMeal,
  type RepeatItem,
  type RepeatSourceRow,
  type RepeatSuggestion,
} from './mealSuggest'

const WHEY = { name: '乳清（1匙）', vendor: null, archived: false }
const SOY = { name: '無糖豆漿', vendor: '全家', archived: false }

let nextId = 1
function row(eaten_on: string, over: Partial<RepeatSourceRow> = {}): RepeatSourceRow {
  return {
    id: nextId++,
    eaten_on,
    meal: 'breakfast',
    food_id: 13,
    qty: 1,
    kcal: 120,
    protein: 24,
    fat: 1.5,
    carb: 2,
    name: null,
    created_at: `${eaten_on}T08:00:00+00:00`,
    foods: WHEY,
    ...over,
  }
}

const sourceOf = (rows: RepeatSourceRow[], view: string, meal: RepeatSourceRow['meal'] = 'breakfast') =>
  suggestRepeat(rows, view, meal)?.sourceDate ?? null

describe('suggestRepeat 來源日（2026-11-04 是週三）', () => {
  it.each([
    ['平日基本', '2026-11-04', ['2026-11-03'], '2026-11-03'],
    ['週一邊界＋跨月', '2026-11-02', ['2026-11-01', '2026-10-31', '2026-10-30'], '2026-10-30'],
    ['週日邊界', '2026-11-01', ['2026-10-31', '2026-10-30'], '2026-10-31'],
    ['週六跳平日', '2026-11-07', ['2026-11-06', '2026-11-01'], '2026-11-01'],
    ['假日跨月', '2026-10-31', ['2026-10-30', '2026-10-25'], '2026-10-25'],
    ['14 天平日：D-14 算', '2026-11-04', ['2026-10-21'], '2026-10-21'],
    ['14 天平日：D-15 不算', '2026-11-04', ['2026-10-20'], null],
    ['14 天假日：D-14 算', '2026-11-08', ['2026-10-25'], '2026-10-25'],
    ['14 天假日：D-15 不算', '2026-11-08', ['2026-10-24'], null],
    ['來源早於檢視日：跳過當天與未來', '2026-11-03', ['2026-11-04', '2026-11-03', '2026-11-02'], '2026-11-02'],
    ['來源早於檢視日：只有當天與未來', '2026-11-03', ['2026-11-04', '2026-11-03'], null],
    ['明天', '2026-11-05', ['2026-11-04'], '2026-11-04'],
    ['跨年', '2027-01-01', ['2026-12-31'], '2026-12-31'],
  ])('%s', (_name, view, dates, want) => {
    expect(sourceOf(dates.map((d) => row(d)), view)).toBe(want)
  })

  it('跳過沒有該餐紀錄的日子', () => {
    const rows = [row('2026-11-03', { meal: 'lunch' }), row('2026-11-02')]
    expect(sourceOf(rows, '2026-11-04', 'breakfast')).toBe('2026-11-02')
  })

  it('全部被刪：回 null，不往更舊的日子找', () => {
    const rows = [row('2026-11-03', { foods: null }), row('2026-11-03', { foods: null }), row('2026-11-02')]
    expect(suggestRepeat(rows, '2026-11-04', 'breakfast')).toBeNull()
  })
})

describe('suggestRepeat 品項', () => {
  const VIEW = '2026-11-04'
  const DAY = '2026-11-03'

  it('依 created_at、id 排序，不改動輸入', () => {
    const rows = [
      row(DAY, { id: 5, created_at: 't2' }),
      row(DAY, { id: 7, created_at: 't1', food_id: 71 }),
      row(DAY, { id: 6, created_at: 't1', food_id: 61 }),
    ]
    const s = suggestRepeat(rows, VIEW, 'breakfast')!
    expect(s.items.map((i) => i.food_id)).toEqual([61, 71, 13])
    expect(rows.map((r) => r.id)).toEqual([5, 7, 6])
  })

  it('沒有 created_at 的列也排得出來，靠 id', () => {
    const rows = [row(DAY, { id: 9, created_at: undefined }), row(DAY, { id: 8, created_at: undefined, food_id: 81 })]
    expect(suggestRepeat(rows, VIEW, 'breakfast')!.items.map((i) => i.food_id)).toEqual([81, 13])
  })

  it('熱量乘份量；只有份量不是 1 才加 ×N', () => {
    const rows = [
      row(DAY, { qty: 2, kcal: 120, foods: WHEY }),
      row(DAY, { qty: 1, kcal: 90, food_id: 15, foods: SOY }),
    ]
    const s = suggestRepeat(rows, VIEW, 'breakfast')!
    expect(s.kcal).toBe(330)
    expect(suggestLabel(s)).toBe('乳清（1匙） ×2・無糖豆漿')
  })

  it('PostgREST 回字串的 numeric 欄位過 num()', () => {
    const rows = [row(DAY, { qty: '1.5' as unknown as number, kcal: '100' as unknown as number })]
    const s = suggestRepeat(rows, VIEW, 'breakfast')!
    expect(s.items[0].qty).toBe(1.5)
    expect(s.kcal).toBe(150)
  })

  it('部分被刪：只留剩下的，熱量不算被刪的', () => {
    const rows = [
      row(DAY, { qty: 1, kcal: 120 }),
      row(DAY, { qty: 1, kcal: 90, foods: null }),
      row(DAY, { qty: 2, kcal: 80, food_id: 16 }),
    ]
    const s = suggestRepeat(rows, VIEW, 'breakfast')!
    expect(s.items).toHaveLength(2)
    expect(s.kcal).toBe(280)
  })

  it('封存保留；label 有值取 name、null 取 foods.name；寫入的 name 維持 null', () => {
    const rows = [
      row(DAY, { food_id: 1, name: '自訂品名', foods: { name: '原名', vendor: 'V', archived: true } }),
      row(DAY, { food_id: 2, name: null, foods: { name: '原名二', vendor: null, archived: true } }),
    ]
    const [a, b] = suggestRepeat(rows, VIEW, 'breakfast')!.items
    expect(a).toMatchObject({ label: '自訂品名', name: '自訂品名', vendor: 'V', archived: true })
    expect(b).toMatchObject({ label: '原名二', name: null, vendor: null, archived: true })
  })
})

describe('repeatToIntake', () => {
  it('eaten_on 取檢視日、沒有 id、快照與 name 取自來源', () => {
    const rows = [
      row('2026-10-30', { id: 42, qty: 2, name: '自訂品名' }),
      row('2026-10-30', { id: 43, food_id: 15, kcal: 90, protein: 8, fat: 4, carb: 5, foods: SOY }),
    ]
    const s = suggestRepeat(rows, '2026-11-04', 'breakfast')!
    expect(repeatToIntake(s, '2026-11-04')).toEqual([
      { eaten_on: '2026-11-04', meal: 'breakfast', food_id: 13, qty: 2, kcal: 120, protein: 24, fat: 1.5, carb: 2, name: '自訂品名' },
      { eaten_on: '2026-11-04', meal: 'breakfast', food_id: 15, qty: 1, kcal: 90, protein: 8, fat: 4, carb: 5, name: null },
    ])
  })
})

describe('mergeByFood', () => {
  const item = (over: Partial<RepeatItem>): RepeatItem => ({
    food_id: 13,
    qty: 1,
    kcal: 120,
    protein: 24,
    fat: 1.5,
    carb: 2,
    name: null,
    label: '乳清（1匙）',
    vendor: null,
    archived: false,
    ...over,
  })

  it('同食物份量相加，單份值與快照取第一列，順序照第一次出現', () => {
    const merged = mergeByFood([
      item({ qty: 1, kcal: 120, name: '第一列' }),
      item({ food_id: 15, label: '無糖豆漿' }),
      item({ qty: 2, kcal: 999, name: '第二列' }),
    ])
    expect(merged.map((i) => i.food_id)).toEqual([13, 15])
    expect(merged[0]).toMatchObject({ qty: 3, kcal: 120, name: '第一列' })
  })

  it('小數份量相加不留浮點尾巴', () => {
    expect(mergeByFood([item({ qty: 0.1 }), item({ qty: 0.2 })])[0].qty).toBe(0.3)
  })
})

describe('suggestLabel', () => {
  it('單項份量 1 不加 ×N', () => {
    const s: RepeatSuggestion = suggestRepeat([row('2026-11-03')], '2026-11-04', 'breakfast')!
    expect(suggestLabel(s)).toBe('乳清（1匙）')
  })
})

describe('suggestRepeatByMeal', () => {
  const rows = [row('2026-11-03'), row('2026-11-03', { meal: 'dinner' })]
  const breakfastRow = { id: 1, meal: 'breakfast', qty: 1, kcal: 120, protein: 24, fat: 1.5, carb: 2, name: null, foods: null } satisfies IntakeRow

  it('該餐已有紀錄就不給，其他餐照給', () => {
    const byMeal = suggestRepeatByMeal(rows, '2026-11-04', [breakfastRow])
    expect(byMeal.breakfast).toBeUndefined()
    expect(byMeal.dinner?.sourceDate).toBe('2026-11-03')
    expect(byMeal.lunch).toBeUndefined()
  })

  it('任一資料還沒到回空物件', () => {
    expect(suggestRepeatByMeal(null, '2026-11-04', [])).toEqual({})
    expect(suggestRepeatByMeal(rows, '2026-11-04', null)).toEqual({})
  })
})

describe('isWeekend', () => {
  it.each([
    ['2026-11-01', true],
    ['2026-10-31', true],
    ['2026-11-02', false],
    ['2026-10-30', false],
  ])('%s → %s', (iso, want) => {
    expect(isWeekend(iso)).toBe(want)
  })
})

describe('macroGap', () => {
  it.each([
    [0, 137, 137],
    [97, 137, 40],
    [136.5, 137, 1],
    [136.6, 137, null],
    [137, 137, null],
    [150, 137, null],
    [100.4, 136.6, 37],
    [NaN, 137, null],
  ])('(%s, %s) → %s', (cur, target, want) => {
    expect(macroGap(cur, target)).toBe(want)
  })
})
