/* 記一筆清單的列（spec「記店家改版」，v2.162）。 */
import { describe, expect, it } from 'vitest'
import { foodMatches } from './foodForm'
import {
  aliasKey,
  aliasRowsOf,
  foodIdOf,
  foodKey,
  foodRow,
  genericCandidates,
  aliasProblem,
  recordKey,
  recordRow,
  isGeneric,
  parseShopQuery,
  rowIntake,
  rowKeyOfIntake,
  searchRows,
  shopRow,
  vendorAliases,
  withAlias,
} from './listRows'
import { recentStats, defaultQty } from './foodPicks'
import type { RecentIntakeRow } from './api'

const TEA = { id: 139, name: '手搖飲（無糖純茶＋寒天，大杯）', vendor: null, category: '飲料', aliases: ['麻古 紅萱波波', '青山 菜燕春青'], archived: false }
const LATTE = { id: 142, name: '無糖拿鐵（茶＋鮮奶，大杯）', vendor: null, category: '飲料', aliases: ['50嵐 烏龍拿鐵（無糖）'], archived: false }
const SEVEN = { id: 5, name: '厚乳拿鐵', vendor: '7-11', category: '飲料', aliases: ['厚乳'], archived: false }
const OATS = { id: 3, name: '燕麥片（5匙）', vendor: null, category: '主食', aliases: [], archived: false }
const PLAIN = { id: 50, name: '無糖純茶', vendor: null, category: '飲料', aliases: ['四季春', '麻古 四季春'], archived: false }

describe('列與 key', () => {
  it('通用食物：每個「店家 品名」別名一列，品名＝品名段、店家＝店家段；key 帶食物 id 與別名原字', () => {
    const rows = aliasRowsOf(TEA)
    expect(rows.map((r) => [r.key, r.name, r.vendor, r.id])).toEqual([
      ['a:139:麻古 紅萱波波', '紅萱波波', '麻古', 139],
      ['a:139:青山 菜燕春青', '菜燕春青', '青山', 139],
    ])
    expect(foodIdOf(rows[1].key)).toBe(139)
    expect(foodIdOf(foodKey(5))).toBe(5)
    expect(() => foodIdOf('x')).toThrow()
  })
  it('有店家的食物、沒有店家段的別名都不變成列；判斷通用食物只看店家別名', () => {
    expect(vendorAliases(SEVEN)).toEqual([])
    expect(aliasRowsOf(OATS)).toEqual([])
    expect(isGeneric(TEA)).toBe(true)
    expect(isGeneric(SEVEN)).toBe(false)
    expect(isGeneric(OATS)).toBe(false)
    expect(aliasRowsOf(PLAIN).map((r) => r.name)).toEqual(['四季春'])
  })
  it('寫入：別名列記品名與店家（AC 1），食物列不記（AC 3），有店家的食物不寫店家（AC 9）', () => {
    expect(rowIntake(aliasRowsOf(TEA)[0])).toEqual({ name: '紅萱波波', vendor: '麻古' })
    expect(rowIntake(foodRow(TEA))).toEqual({ name: null, vendor: null })
    expect(rowIntake(foodRow(SEVEN))).toEqual({ name: null, vendor: null })
    // 有店家的食物被改過名的紀錄列：記品名、店家仍看食品庫
    expect(rowIntake(recordRow(SEVEN, '厚乳拿鐵（少冰）', null))).toEqual({ name: '厚乳拿鐵（少冰）', vendor: null })
  })
})

describe('紀錄接回列（AC 4）', () => {
  it('品名＋店家對得上某個別名 → 那個別名列；兩個都沒記 → 食物列；記了但對不上 → 那筆紀錄自己的列，不搶食物列（review #3）', () => {
    expect(rowKeyOfIntake({ food_id: 139, name: '紅萱波波', vendor: '麻古' }, TEA)).toBe('a:139:麻古 紅萱波波')
    expect(rowKeyOfIntake({ food_id: 139, name: null, vendor: null }, TEA)).toBe('f:139')
    expect(rowKeyOfIntake({ food_id: 139, name: '  ', vendor: '' }, TEA)).toBe('f:139')
    expect(rowKeyOfIntake({ food_id: 139, name: '紅萱波波', vendor: '青山' }, TEA)).toBe(recordKey(139, '紅萱波波', '青山'))
    expect(rowKeyOfIntake({ food_id: 139, name: null, vendor: '麻古' }, TEA)).toBe(recordKey(139, null, '麻古')) // v2.161 的舊紀錄
    expect(rowKeyOfIntake({ food_id: 139, name: '冬瓜檸檬', vendor: null }, TEA)).toBe(recordKey(139, '冬瓜檸檬', null))
    // 食品庫查不到（封存）：對不上別名，也是紀錄列
    expect(rowKeyOfIntake({ food_id: 139, name: '紅萱波波', vendor: '麻古' }, undefined)).toBe(recordKey(139, '紅萱波波', '麻古'))
    expect(foodIdOf(recordKey(139, null, '麻古'))).toBe(139)
    // 紀錄列：品名沒記就用食物的、店家照記
    const r = recordRow(TEA, null, '麻古')
    expect([r.name, r.vendor]).toEqual([TEA.name, '麻古'])
    expect(rowIntake(r)).toEqual({ name: null, vendor: '麻古' })
  })
  it('常吃、上次份量、照上次都以列為單位：麻古那杯不跟青山那杯混', () => {
    const hist: RecentIntakeRow[] = [
      { meal: 'breakfast', food_id: 139, qty: 2, mods: ['sweet:light'], name: '紅萱波波', vendor: '麻古' },
      { meal: 'breakfast', food_id: 139, qty: 1, mods: [], name: '菜燕春青', vendor: '青山' },
      { meal: 'breakfast', food_id: 139, qty: 1, mods: [], name: '紅萱波波', vendor: '麻古' },
    ]
    const s = recentStats(hist, (r) => rowKeyOfIntake(r, TEA))
    expect(s.recent.get('breakfast')).toEqual(['a:139:麻古 紅萱波波', 'a:139:青山 菜燕春青'])
    expect(s.lastMods.get('a:139:麻古 紅萱波波')).toEqual(['sweet:light'])
    expect(s.lastMods.get('a:139:青山 菜燕春青')).toEqual([])
    expect(defaultQty(s.lastQty, 'breakfast', 'a:139:麻古 紅萱波波')).toBe(2)
    expect(defaultQty(s.lastQty, 'breakfast', 'a:139:青山 菜燕春青')).toBe(1)
    // 類型分組的次數仍以食物計
    expect(s.counts.get('breakfast')?.get(139)).toBe(3)
  })
})

describe('搜尋（AC 1、3）', () => {
  const foods = [TEA, LATTE, SEVEN, OATS, PLAIN]
  const keys = (q: string) => searchRows(foods, q, foodMatches).map((r) => r.key)
  it('對到別名就出那個別名列；通用食物自己那列不跟著冒出來', () => {
    expect(keys('麻古')).toEqual(['a:139:麻古 紅萱波波', 'a:50:麻古 四季春'])
    expect(keys('紅萱')).toEqual(['a:139:麻古 紅萱波波'])
    expect(keys('麻古紅萱')).toEqual(['a:139:麻古 紅萱波波'])
  })
  it('通用食物那列只在搜尋字對到它自己的品名、或沒有店家段的舊式別名時出現', () => {
    expect(keys('手搖飲')).toEqual(['f:139'])
    expect(keys('四季春')).toEqual(['f:50', 'a:50:麻古 四季春'])
  })
  it('其他食物照舊：品名、店家、別名', () => {
    expect(keys('7-11')).toEqual(['f:5'])
    expect(keys('厚乳')).toEqual(['f:5'])
    expect(keys('燕麥')).toEqual(['f:3'])
    expect(keys('  ')).toEqual([])
  })
})

describe('新店第一次（AC 7、8）', () => {
  it('搜尋字切成店家＋品名；沒有空白就只有品名；全形空白也算', () => {
    expect(parseShopQuery('春陽 冬瓜檸檬')).toEqual({ vendor: '春陽', item: '冬瓜檸檬' })
    expect(parseShopQuery('春陽　冬瓜檸檬')).toEqual({ vendor: '春陽', item: '冬瓜檸檬' })
    expect(parseShopQuery('冬瓜檸檬')).toEqual({ vendor: null, item: '冬瓜檸檬' })
  })
  it('新店卡勾的列：有店家段＝別名列（記住之後食品庫長出同一個 key）；沒有＝只記品名', () => {
    const r = shopRow(TEA, '春陽　冬瓜檸檬')
    expect([r.key, r.name, r.vendor]).toEqual(['a:139:春陽 冬瓜檸檬', '冬瓜檸檬', '春陽'])
    expect(rowIntake(r)).toEqual({ name: '冬瓜檸檬', vendor: '春陽' })
    const next = withAlias(TEA.aliases, '春陽　冬瓜檸檬')
    expect(next).toEqual(['麻古 紅萱波波', '青山 菜燕春青', '春陽 冬瓜檸檬'])
    expect(aliasRowsOf({ ...TEA, aliases: next as string[] }).map((x) => x.key)).toContain(r.key)
    const p = shopRow(TEA, '冬瓜檸檬')
    expect([p.key, p.name, p.vendor]).toEqual([recordKey(139, '冬瓜檸檬', null), '冬瓜檸檬', null])
    expect(rowIntake(p)).toEqual({ name: '冬瓜檸檬', vendor: null })
    // 下次從最近記過接回來是同一列
    expect(rowKeyOfIntake({ food_id: 139, ...rowIntake(p) }, TEA)).toBe(p.key)
    // 店家照 DB 的界截到 40 字（review #8）
    const long = shopRow(TEA, `${'店'.repeat(45)} 冬瓜檸檬`)
    expect([...(long.vendor ?? '')].length).toBe(40)
    expect(rowIntake(long).vendor).toBe('店'.repeat(40))
    expect(aliasKey(139, 'x')).toBe('a:139:x')
  })
  it('記住：已有一樣的回 exists；滿 10 個回 full；超過 40 字、含頓號逗號（食品庫會拿它們切別名）都不行（review #7）', () => {
    expect(withAlias(TEA.aliases, '麻古紅萱波波')).toBe('exists')
    const ten = Array.from({ length: 10 }, (_, i) => `店${i} 品${i}`)
    expect(withAlias(ten, '春陽 冬瓜檸檬')).toBe('full')
    expect(withAlias(TEA.aliases, `春陽 ${'冬'.repeat(40)}`)).toBe('long')
    for (const sep of ['、', '，', ',']) expect(withAlias(TEA.aliases, `春陽 冬瓜${sep}檸檬`)).toBe('separator')
    expect(aliasProblem(TEA.aliases, '春陽 冬瓜檸檬')).toBeNull()
  })
  it('候選：使用中、掛了店家別名的通用食物，最近記過的在前，沒記過的照品名', () => {
    const archived = { ...LATTE, id: 999, archived: true }
    const rank = new Map([[142, 0], [139, 5]])
    expect(genericCandidates([TEA, LATTE, SEVEN, OATS, archived, PLAIN], rank).map((f) => f.id)).toEqual([142, 139, 50])
  })
})
