/* 記一筆的「這一餐」（spec「記一筆重做：兩個情境」，v2.167）。 */
import { describe, expect, it } from 'vitest'
import type { Food } from './api'
import { draftFromTier, draftsFromItems } from './estimate'
import { parseBox, type LogRecord } from './logFind'
import { aiLibItem, aliasUpdates, lastRecords, draftIntake, foundItem, frequentRows, itemTotals, lastCombo, libIntake, libItem, pairCandidates, pickKey, savePlan, unsettled, wantsPair, type DraftItem, type MealItem } from './logMeal'

const food = (id: number, name: string, kcal: number, category: string | null, vendor: string | null = null, aliases: string[] = []): Food => ({
  id, name, vendor, kcal, protein: kcal / 20, fat: 1, carb: 2, category, aliases, archived: false, category_manual: false, verified: true,
})
const WINTER = food(1, '冬瓜檸檬', 170, '飲料', '清心')
const WTEA = food(2, '冬瓜茶', 130, '飲料')
const EGG = food(5, '茶葉蛋', 70, '配菜')
const LATTE = food(6, '拿鐵', 150, '飲料', '全家')
const BOX = food(11, '雞胸餐盒', 380, '健康餐盒', '減醣廚房')
const MILK = food(15, '無糖豆漿', 90, '飲料', '全家')
const BANANA = food(17, '香蕉', 105, '點心')
const TEA = food(7, '手搖飲', 60, '飲料', null, ['麻古 紅萱波波'])
const ALL = [WINTER, WTEA, EGG, LATTE, BOX, MILK, BANANA, TEA]
const foodOf = (id: number) => ALL.find((f) => f.id === id)
const stores = ['全家', '7-11', '春陽', '麻古']
const q = (text: string) => parseBox(text, stores)

describe('勾了要記成什麼', () => {
  it('故事一：打「冬檸」勾冬瓜檸檬＝記你的叫法（加入成功後才加），品名不寫', () => {
    const it1 = foundItem(WINTER, { name: WINTER.name, vendor: WINTER.vendor, alias: null }, q('冬檸'))
    expect(it1.alias).toBe('冬檸')
    expect(it1.name).toBeNull()
  })
  it('打「拿鐵」勾拿鐵：本來就完全符合，不記叫法', () => {
    expect(foundItem(LATTE, { name: '拿鐵', vendor: '全家', alias: null }, q('拿鐵')).alias).toBeNull()
  })
  it('只靠店家對到的（「八方」勾八方的鍋貼、「全」勾全家的豆漿、「麻古紅」勾麻古的紅萱波波）、店家＋品名連著打（「全家豆漿」）：不把打的字記成品名、不學叫法', () => {
    const GUOTIE = food(30, '鍋貼', 300, '其他正餐', '八方')
    const g = foundItem(GUOTIE, { name: '鍋貼', vendor: '八方', alias: null, via: 'store' }, q('八方'))
    expect([g.name, g.alias]).toEqual([null, null])
    const m = foundItem(MILK, { name: '無糖豆漿', vendor: '全家', alias: null, via: 'store' }, q('全'))
    expect([m.name, m.alias, m.vendor]).toEqual([null, null, null])
    const t = foundItem(TEA, { name: '紅萱波波', vendor: '麻古', alias: '麻古 紅萱波波', via: 'store' }, q('麻古紅'))
    expect([t.name, t.vendor, t.alias]).toEqual(['紅萱波波', '麻古', null])
    const d = foundItem(MILK, { name: '無糖豆漿', vendor: '全家', alias: null, via: 'name' }, q('全家豆漿'))
    expect([d.name, d.alias]).toEqual([null, null])
  })
  it('打「冬瓜」勾冬瓜茶、打「雞胸」勾雞胸餐盒：整串是它名字的一段、本來就找得到，不記叫法也不算代替', () => {
    for (const [typed, f] of [['冬瓜', WTEA], ['雞胸', BOX]] as const) {
      const it0 = foundItem(f, { name: f.name, vendor: f.vendor, alias: null }, q(typed))
      expect([it0.alias, it0.name]).toEqual([null, null])
    }
  })
  it('故事二：打「全家 茶葉蛋」勾茶葉蛋＝紀錄店家記全家（食物本身沒店家也照記），食品庫不動、不記叫法', () => {
    const it2 = foundItem(EGG, { name: '茶葉蛋', vendor: null, alias: null }, q('全家 茶葉蛋'))
    expect([it2.vendor, it2.name, it2.alias]).toEqual(['全家', null, null])
  })
  it('改 v2.161：食物本身有店家（7-11 的）時，框裡打的店家照樣記在紀錄上', () => {
    const seven = { ...EGG, vendor: '7-11' }
    expect(foundItem(seven, { name: '茶葉蛋', vendor: '7-11', alias: null }, q('全家 茶葉蛋')).vendor).toBe('全家')
    // 跟食物本身一樣的店家不重複寫
    expect(foundItem(seven, { name: '茶葉蛋', vendor: '7-11', alias: null }, q('711 茶葉蛋')).vendor).toBeNull()
  })
  it('故事三：打「春陽 冬瓜檸檬」勾冬瓜茶＝代替：品名寫打的、店家記春陽、不記叫法', () => {
    const it3 = foundItem(WTEA, { name: '冬瓜茶', vendor: null, alias: null }, q('春陽 冬瓜檸檬'))
    expect([it3.name, it3.vendor, it3.alias]).toEqual(['冬瓜檸檬', '春陽', null])
    const row = libIntake(it3, WTEA, 'dinner', '2026-11-25')
    expect([row.name, row.vendor, row.kcal, row.food_id]).toEqual(['冬瓜檸檬', '春陽', 130, 2])
  })
  it('只打店名（整串是店名）：店家照記，不學叫法也不算代替', () => {
    const it4 = foundItem(MILK, { name: '無糖豆漿', vendor: '全家', alias: null }, q('全家'))
    expect([it4.name, it4.alias, it4.vendor]).toEqual([null, null, null])
    const it5 = foundItem(EGG, { name: '茶葉蛋', vendor: null, alias: null }, q('全家'))
    expect(it5.vendor).toBe('全家')
  })
  it('「店家 品名」別名列照常：記品名段與店家段，不另外學叫法', () => {
    const it6 = foundItem(TEA, { name: '紅萱波波', vendor: '麻古', alias: '麻古 紅萱波波' }, q('紅萱'))
    expect([it6.name, it6.vendor, it6.alias]).toEqual(['紅萱波波', '麻古', null])
  })
  it('身分：同一樣東西同一個 key（品名、店家跟食物一樣的當沒寫）', () => {
    expect(pickKey(LATTE, '拿鐵', '全家')).toBe(pickKey(LATTE, null, null))
    expect(pickKey(EGG, null, '全家')).not.toBe(pickKey(EGG, null, null))
    expect(libItem(EGG, { vendor: ' 全家 ' }).key).toBe(pickKey(EGG, null, '全家'))
  })
})

describe('AI 回的品名完全對到食品庫（照舊換成那一筆）', () => {
  it('打的品名跟它不同：記成叫法；店家照框裡的店名', () => {
    const it1 = aiLibItem(WINTER, null, '春陽', '冬檸')
    expect([it1.foodId, it1.alias, it1.vendor, it1.name]).toEqual([1, '冬檸', '春陽', null])
  })
  it('打的就是它、是它名字的一段、或 AI 一次回好幾樣（typed 是 null）：不記叫法', () => {
    expect(aiLibItem(WINTER, null, null, '冬瓜檸檬').alias).toBeNull()
    expect(aiLibItem(WINTER, null, null, '冬瓜').alias).toBeNull()
    expect(aiLibItem(WINTER, null, null, null).alias).toBeNull()
  })
  it('靠「店家 品名」別名對上的：照別名記品名與店家，框裡的店名優先', () => {
    const a = aiLibItem(TEA, { item: '紅萱波波', vendor: '麻古' }, null, '紅萱')
    expect([a.name, a.vendor, a.alias]).toEqual(['紅萱波波', '麻古', null])
    expect(aiLibItem(TEA, { item: '紅萱波波', vendor: '麻古' }, '青山', null).vendor).toBe('青山')
  })
})

describe('寫入', () => {
  it('食品庫的一樣：單份快照套過微調、份數、微調代碼；沒調不帶 mods', () => {
    const cup = libItem({ ...WTEA, kcal: 165, protein: 0, fat: 0, carb: 41 }, { mods: ['cup:m'], qty: 2 })
    const row = libIntake(cup, { ...WTEA, kcal: 165, protein: 0, fat: 0, carb: 41 }, 'lunch', '2026-11-25')
    expect(row.qty).toBe(2)
    expect(row.kcal).toBeCloseTo(165 * 0.7, 0)
    expect(row.mods).toEqual(['cup:m'])
    expect('mods' in libIntake(libItem(EGG), EGG, 'lunch', '2026-11-25')).toBe(false)
  })
  it('合計＝份數 × 單份；還在估的沒有數字，擋加入', () => {
    const items: MealItem[] = [libItem(EGG, { qty: 2 }), { id: 'x', kind: 'est', text: '冬瓜檸檬', store: null, status: 'busy', startedAt: 0 }]
    expect(itemTotals(items[0], foodOf)?.kcal).toBe(140)
    expect(itemTotals(items[1], foodOf)).toBeNull()
    expect(unsettled(items)).toBe(1)
  })
})

describe('估好一律存進食品庫（AC 5）', () => {
  const [ai] = draftsFromItems([{ name: '冬瓜檸檬', kcal: 210, kcal_low: 180, kcal_high: 260, protein_g: 0, fat_g: 0, carb_g: 52, assumption: null }], '冬瓜檸檬')
  const draft = (typed: string | null, d = ai): DraftItem => ({ id: 'd', kind: 'draft', draft: d, qty: 1, qtyDraft: '1', vendor: '春陽', typed, saved: null })
  it('食品庫沒有同名：建一筆（粗估、不封存）；打的跟 AI 名字一樣不加別名', () => {
    const p = savePlan(draft('冬瓜檸檬'), 'dinner', [WTEA], new Map())
    expect(p).toEqual({ kind: 'create', keep: true, food: { name: '冬瓜檸檬', vendor: null, kcal: 210, protein: 0, fat: 0, carb: 52, verified: false } })
  })
  it('打的是 AI 名字的一段（「冬瓜」→冬瓜檸檬）：本來就找得到，不加別名', () => {
    const p = savePlan(draft('冬瓜'), 'dinner', [WTEA], new Map())
    expect(p.kind === 'create' && p.food.aliases).toBeUndefined()
  })
  it('打的品名跟 AI 名字不同：打的記成新那筆的別名；店名不進名字也不進別名', () => {
    const p = savePlan(draft('冬檸'), 'dinner', [WTEA], new Map())
    expect(p.kind === 'create' && p.food.aliases).toEqual(['冬檸'])
    expect(p.kind === 'create' && p.food.name).toBe('冬瓜檸檬')
  })
  it('食品庫已有同名：不另建，別名加到那一筆；紀錄照 AI 數字、店家照店名', () => {
    const p = savePlan(draft('冬檸'), 'dinner', [WINTER], new Map())
    expect(p).toEqual({ kind: 'existing', foodId: 1, alias: '冬檸' })
    const row = draftIntake(draft('冬檸'), 1, 'dinner', '2026-11-25')
    expect([row.food_id, row.kcal, row.vendor, row.name]).toEqual([1, 210, '春陽', null])
  })
  it('同一次加入兩樣同名的：第一樣建好後放進比對清單，第二樣照同名已有、不另建', () => {
    const first = savePlan(draft(null), 'dinner', [WTEA], new Map())
    expect(first.kind).toBe('create')
    const created = { ...WINTER, id: 999, vendor: null }
    expect(savePlan(draft(null), 'dinner', [WTEA, created], new Map())).toEqual({ kind: 'existing', foodId: 999, alias: null })
  })
  it('只記熱量的不存（建立即封存的那一筆）', () => {
    const p = savePlan(draft(null, draftFromTier('normal')), 'dinner', [], new Map())
    expect(p.kind === 'create' && p.keep).toBe(false)
    expect(p.kind === 'create' && p.food.name).toBe('晚餐（一般正餐）')
  })
  it('別名依序加到同一筆；滿了、重複的跳過', () => {
    const full = { ...WINTER, aliases: Array.from({ length: 9 }, (_, i) => `x${i}`) }
    const m = aliasUpdates([{ foodId: 1, alias: '冬檸' }, { foodId: 1, alias: '冬檸' }, { foodId: 1, alias: '再一個' }], () => full)
    expect(m.get(1)).toEqual([...full.aliases, '冬檸'])
  })
})

describe('常吃、整組、搭配卡', () => {
  const rec = (eaten_on: string | undefined, meal: string, food_id: number, extra: Partial<LogRecord> = {}): LogRecord => ({ eaten_on, meal, food_id, qty: 1, mods: [], name: null, vendor: null, ...extra })
  // 2026-11-25 是週三；11/24 週二、11/22 週日
  const records: LogRecord[] = [
    rec('2026-11-24', 'dinner', 11),
    rec('2026-11-24', 'dinner', 15),
    rec('2026-11-22', 'dinner', 5),
    rec('2026-11-22', 'dinner', 17),
    rec('2026-11-20', 'dinner', 11, { qty: 2 }),
    rec('2026-11-20', 'dinner', 15),
    rec('2026-11-19', 'dinner', 11),
    rec('2026-11-19', 'dinner', 17),
    rec('2026-11-18', 'lunch', 11),
    rec('2026-11-18', 'lunch', 6),
  ]
  it('常吃：這一餐出現次數最多的在前，帶最近一次的份量；最多 max 樣', () => {
    const rows = frequentRows(records, 'dinner', foodOf)
    expect(rows.map((r) => [r.food.id, r.qty])).toEqual([[11, 1], [15, 1], [17, 1], [5, 1]])
    expect(frequentRows(records, 'dinner', foodOf, 2)).toHaveLength(2)
  })
  it('每一樣最近一次的紀錄（不分餐別）：搜尋勾的也照上次的微調', () => {
    const last = lastRecords([rec('2026-11-24', 'lunch', 15, { mods: ['cup:m'] }), rec('2026-11-20', 'dinner', 15)], foodOf)
    expect(last.get(pickKey(MILK, null, null))?.mods).toEqual(['cup:m'])
    expect(last.size).toBe(1)
  })
  it('整組：上一個同類日（週三找平日→週二）的這一餐整組；假日找假日（週六找週日那組）', () => {
    // 紀錄由新到舊，同一天後記的在前；整組照當天記的順序（先記的在前）
    expect(lastCombo(records, 'dinner', '2026-11-25', foodOf)?.rows.map((r) => r.food.id)).toEqual([15, 11])
    expect(lastCombo(records, 'dinner', '2026-11-28', foodOf)?.rows.map((r) => r.food.id)).toEqual([17, 5])
  })
  it('整組少於兩樣、沒有日期的舊資料不算', () => {
    expect(lastCombo([rec('2026-11-24', 'dinner', 11)], 'dinner', '2026-11-25', foodOf)).toBeNull()
    expect(lastCombo([rec(undefined, 'dinner', 11), rec(undefined, 'dinner', 15)], 'dinner', '2026-11-25', foodOf)).toBeNull()
  })
  it('搭配卡：這一餐有正餐類、沒飲料才出', () => {
    expect(wantsPair(['健康餐盒'])).toBe(true)
    expect(wantsPair(['健康餐盒', '飲料'])).toBe(false)
    expect(wantsPair(['點心'])).toBe(false)
  })
  it('搭配卡候選：跟這一餐裡的東西同一餐出現過的飲料、點心，照次數；放不進剩下額度的不列；已經有的不列', () => {
    const rows = pairCandidates(records, new Set([11]), foodOf, { exclude: new Set(), room: 500 })
    // 雞胸餐盒跟豆漿一起 2 次、香蕉 1 次、拿鐵 1 次（午餐）
    expect(rows.map((r) => r.food.id)).toEqual([15, 17, 6])
    expect(pairCandidates(records, new Set([11]), foodOf, { exclude: new Set(), room: 100 }).map((r) => r.food.id)).toEqual([15])
    expect(pairCandidates(records, new Set([11]), foodOf, { exclude: new Set([pickKey(MILK, null, null)]), room: 500 }).map((r) => r.food.id)).toEqual([17, 6])
    expect(pairCandidates(records, new Set([11]), foodOf, { exclude: new Set(), room: 500, max: 1 })).toHaveLength(1)
  })
})
