/* 一個框記一餐（spec「一個框記一餐」，v2.164）：框的切段規則、每段的判定、加進「這一餐」的列。 */
import { describe, expect, it } from 'vitest'
import type { LibCandidate } from './estimate'
import { adoptRow, entriesFromSegments, entryDomKey, pendingEntry, replaceEntry, resolveSegment, splitBox, unresolved, waiting, type MealEntry } from './mealBox'

const food = (id: number, name: string, vendor: string | null, kcal: number, extra: Partial<LibCandidate> = {}): LibCandidate & { category: string | null } => ({
  id, name, vendor, aliases: [], verified: false, archived: false, kcal, protein: 10, fat: 5, carb: 20, category: null, ...extra,
})
const TEA = food(139, '手搖飲（無糖純茶＋寒天，大杯）', null, 60, { aliases: ['麻古 紅萱波波', '青山 菜燕春青'] })
const LATTE = food(142, '無糖拿鐵（茶＋鮮奶，大杯）', null, 123, { aliases: ['50嵐 烏龍拿鐵', '茶湯會 觀音拿鐵', '清心 烏龍拿鐵'] })
const FOODS = [
  TEA,
  LATTE,
  food(135, '滷蛋', null, 80),
  food(17, '茶葉蛋', '7-11', 70),
  food(128, '麻辣鴨血臭豆腐', null, 450),
]
const none = new Map<number, number>()

describe('splitBox：打完一段就移出框', () => {
  it('段落符號前面的都打完了、後面那段還在打', () => {
    expect(splitBox('麻古 紅萱波波、滷蛋、夜市臭')).toEqual({ committed: ['麻古 紅萱波波', '滷蛋'], rest: '夜市臭' })
  })
  it('全形半形的逗號、分號、換行都算；連打兩個、只有空白的段丟掉', () => {
    expect(splitBox('白飯，，滷蛋;  ；味噌湯\n')).toEqual({ committed: ['白飯', '滷蛋', '味噌湯'], rest: '' })
  })
  it('／ ＋ 不算段落符號：品名裡就有（熟成紅茶+白玉、豆奶/豆漿）', () => {
    expect(splitBox('可不可 熟成紅茶+白玉')).toEqual({ committed: [], rest: '可不可 熟成紅茶+白玉' })
    expect(splitBox('義美無加糖豆奶/豆漿')).toEqual({ committed: [], rest: '義美無加糖豆奶/豆漿' })
  })
  it('final（按完成）：最後那段也移出；空的框什麼都沒有', () => {
    expect(splitBox('滷蛋、夜市臭豆腐', true)).toEqual({ committed: ['滷蛋', '夜市臭豆腐'], rest: '' })
    expect(splitBox('   ', true)).toEqual({ committed: [], rest: '' })
  })
  it('還在打的那段只去開頭空白，打到一半「麻古 」的空白留著', () => {
    expect(splitBox('滷蛋、 麻古 ')).toEqual({ committed: ['滷蛋'], rest: '麻古 ' })
  })
  it('一段超過 300 字截掉（估算那端收得下）', () => {
    const { committed } = splitBox(`${'飯'.repeat(305)}、`)
    expect([...committed[0]].length).toBe(300)
  })
})

describe('resolveSegment：每段各自判定', () => {
  it('對上「店家 品名」別名＝那個別名列；只打品名段、只有一家有＝那家', () => {
    expect(resolveSegment('麻古 紅萱波波', FOODS, none)).toEqual({ kind: 'pick', key: 'a:139:麻古 紅萱波波' })
    expect(resolveSegment('紅萱波波', FOODS, none)).toEqual({ kind: 'pick', key: 'a:139:麻古 紅萱波波' })
  })
  it('同一個品名好幾家都有、沒說哪家：不猜，落回通用那一列', () => {
    expect(resolveSegment('烏龍拿鐵', FOODS, none)).toEqual({ kind: 'pick', key: 'f:142' })
    expect(resolveSegment('清心 烏龍拿鐵', FOODS, none)).toEqual({ kind: 'pick', key: 'a:142:清心 烏龍拿鐵' })
  })
  it('對上一般食物＝食物列；有店家的食物用店家＋品名也對得上', () => {
    expect(resolveSegment('滷蛋', FOODS, none)).toEqual({ kind: 'pick', key: 'f:135' })
    expect(resolveSegment('7-11茶葉蛋', FOODS, none)).toEqual({ kind: 'pick', key: 'f:17' })
  })
  it('對不上＝待估，附相近的那一筆（數字取整）；連相近都沒有就 null', () => {
    expect(resolveSegment('臭豆腐', FOODS, none)).toEqual({ kind: 'pending', near: { id: 128, name: '麻辣鴨血臭豆腐', vendor: null, kcal: 450 } })
    expect(resolveSegment('螺獅粉', FOODS, none)).toEqual({ kind: 'pending', near: null })
  })
})

describe('entriesFromSegments：加進「這一餐」', () => {
  it('照打的順序：勾好的列、待估', () => {
    const { add, bump } = entriesFromSegments(['麻古 紅萱波波', '滷蛋', '夜市臭豆腐'], FOODS, none, new Set())
    expect(add.map((e) => [e.kind, e.kind === 'pending' ? e.text : e.key])).toEqual([
      ['pick', 'a:139:麻古 紅萱波波'],
      ['pick', 'f:135'],
      ['pending', '夜市臭豆腐'],
    ])
    expect(bump).toEqual([])
    const pend = add[2]
    expect(pend.kind === 'pending' && [pend.status, pend.tiers, pend.startedAt]).toEqual(['idle', false, null])
  })
  it('同一批裡同一樣打兩次：一列、2 份（從 1 數，不看上次吃幾份）；只出現一次的不給份數（照上次）', () => {
    const { add, counts, bump } = entriesFromSegments(['滷蛋', '香蕉', '滷蛋', '滷蛋'], [...FOODS, food(17, '香蕉', null, 105)], none, new Set())
    expect(add.map((e) => e.kind === 'pick' && e.key)).toEqual(['f:135', 'f:17'])
    expect([...counts]).toEqual([['f:135', 3]])
    expect(bump).toEqual([])
  })
  it('對上的那一列已經在了（清單上勾的、這一餐的食品庫草稿）：不再多一列，每出現一次多一份', () => {
    const { add, counts, bump } = entriesFromSegments(['麻古 紅萱波波', '滷蛋', '麻古 紅萱波波'], FOODS, none, new Set(['a:139:麻古 紅萱波波']))
    expect(add.map((e) => e.kind === 'pick' && e.key)).toEqual(['f:135'])
    expect(counts.size).toBe(0)
    expect(bump).toEqual(['a:139:麻古 紅萱波波', 'a:139:麻古 紅萱波波'])
  })
  it('每一列的 id 都不一樣（同一段打兩次待估也是兩列）', () => {
    const { add } = entriesFromSegments(['螺獅粉', '螺獅粉'], FOODS, none, new Set())
    expect(new Set(add.map((e) => e.id)).size).toBe(2)
  })
})

describe('pendingEntry：新店卡的「都不像 → 估一筆」不比對食品庫', () => {
  it('完全對上食品庫的字也是待估（使用者已經說要估）；截到 300 字；附相近', () => {
    const e = pendingEntry('滷蛋', FOODS, none)
    expect(e.kind === 'pending' && [e.text, e.status, e.own]).toEqual(['滷蛋', 'idle', ''])
    const long = pendingEntry('飯'.repeat(305), FOODS, none)
    expect(long.kind === 'pending' && [...long.text].length).toBe(300)
    const near = pendingEntry('臭豆腐', FOODS, none)
    expect(near.kind === 'pending' && near.near?.id).toBe(128)
  })
})

describe('adoptRow：待估列的相近按「改用」，店家與品名不能丟', () => {
  it('那一段對得上別名＝別名列', () => {
    expect(adoptRow('紅萱波波', TEA, ['麻古'])).toEqual({ key: 'a:139:麻古 紅萱波波', row: null })
  })
  it('食物沒店家、那一段寫了已知店家＝那筆食物＋這家的列（寫入記店家、不記品名）', () => {
    const r = adoptRow('在麻古買了紅萱波波微糖', TEA, ['麻古', '青山'])
    expect(r.key).toBe('r:139:麻古|')
    expect(r.row && [r.row.name, r.row.vendor, r.row.food.id]).toEqual([TEA.name, '麻古', 139])
  })
  it('食物本身有店家、或那一段沒提店家＝食物列', () => {
    expect(adoptRow('在麻古買的茶葉蛋', food(17, '茶葉蛋', '7-11', 70), ['麻古'])).toEqual({ key: 'f:17', row: null })
    expect(adoptRow('一杯寒天茶', TEA, ['麻古'])).toEqual({ key: 'f:139', row: null })
  })
})

describe('replaceEntry、unresolved、waiting、entryDomKey', () => {
  const a: MealEntry = { id: 'x1', kind: 'pick', key: 'f:135' }
  const p: MealEntry = { id: 'x2', kind: 'pending', text: '螺獅粉', status: 'error', startedAt: null, near: null, tiers: false, own: '' }
  it('待估換成估好的兩樣，留在原位；找不到那一列原樣不動', () => {
    const d1: MealEntry = { id: 'x3', kind: 'draft', key: 'est-1' }
    const d2: MealEntry = { id: 'x4', kind: 'draft', key: 'est-2' }
    expect(replaceEntry([a, p], 'x2', [d1, d2]).map((e) => e.id)).toEqual(['x1', 'x3', 'x4'])
    expect(replaceEntry([a], 'nope', [d1]).map((e) => e.id)).toEqual(['x1'])
  })
  it('還沒估（含估失敗的、正在估的）的列數；等使用者動手的不算正在估的', () => {
    const busy: MealEntry = { ...p, id: 'x5', status: 'busy' } as MealEntry
    expect(unresolved([a, p, busy])).toBe(2)
    expect(unresolved([a])).toBe(0)
    expect(waiting([a, p, busy])).toBe(1)
  })
  it('畫面上的 data-key：待估列用自己的 id，其他用 key', () => {
    expect([entryDomKey(a), entryDomKey(p)]).toEqual(['f:135', 'x2'])
  })
})
