/* 記一筆的「找」（spec「記一筆重做：兩個情境」，v2.167）。 */
import { describe, expect, it } from 'vitest'
import { foldKey, highlightRuns, knownStores, lastSeenText, learnableAlias, matchText, mergeResults, nameHistory, parseBox, relationOf, searchFoods, storeHistory, type LogRecord } from './logFind'

const f = (id: number, name: string, vendor: string | null = null, aliases: string[] = []) => ({ id, name, vendor, aliases, archived: false })
const WINTER = f(1, '冬瓜檸檬', '清心')
const WTEA = f(2, '冬瓜茶')
const LEMON = f(3, '檸檬綠茶', '清心')
const RIB = f(4, '炸排骨便當')
const EGG = f(5, '茶葉蛋', '7-11')
const LATTE = f(6, '拿鐵', '全家')
const TEA = f(7, '手搖飲（無糖純茶＋寒天，大杯）', null, ['麻古 紅萱波波'])

describe('比對（AC 3）', () => {
  it('忽略空白、全半形、大小寫與「-」「・」「.」：711＝7-11＝７－１１', () => {
    expect(foldKey('7-11')).toBe('711')
    expect(foldKey('７－１１')).toBe('711')
    expect(foldKey('Mr. 布朗・咖啡')).toBe('mr布朗咖啡')
    expect(matchText('711', '7-11')?.kind).toBe('exact')
  })
  it('字照順序出現：「冬檸」對到「冬瓜檸檬」，標「冬」「檸」', () => {
    const m = matchText('冬檸', '冬瓜檸檬')
    expect(m?.kind).toBe('order')
    expect(m?.hits).toEqual([0, 2])
    expect(highlightRuns('冬瓜檸檬', m?.hits ?? [])).toEqual([
      { text: '冬', hit: true }, { text: '瓜', hit: false }, { text: '檸', hit: true }, { text: '檬', hit: false },
    ])
  })
  it('連續兩個字出現：「排骨飯」對到「炸排骨便當」，標「排骨」', () => {
    const m = matchText('排骨飯', '炸排骨便當')
    expect(m?.kind).toBe('pair')
    expect(m?.hits).toEqual([1, 2])
  })
  it('整串連續出現＝contains；整串一樣＝exact（標整串）；一個字都對不到＝null', () => {
    expect(matchText('檸檬', '冬瓜檸檬')).toEqual({ kind: 'contains', hits: [2, 3] })
    expect(matchText('冬瓜檸檬', '冬瓜 檸檬')).toEqual({ kind: 'exact', hits: [0, 1, 3, 4] })
    expect(matchText('冬檸', '冬瓜茶')).toBeNull()
    expect(matchText('', '冬瓜茶')).toBeNull()
  })
  it('一個字只算 contains（不拆成順序或兩個字）', () => {
    expect(matchText('茶', '冬瓜茶')?.kind).toBe('contains')
    expect(matchText('飯', '冬瓜茶')).toBeNull()
  })
})

describe('搜尋：一張清單、完全符合排前面（AC 3）', () => {
  const foods = [RIB, WTEA, LEMON, WINTER, EGG, LATTE]
  it('「冬瓜檸檬」：完全符合的排第一（整串粗），名字有對到的接著', () => {
    const hits = searchFoods(foods, '冬瓜檸檬')
    expect(hits.map((h) => h.name)).toEqual(['冬瓜檸檬', '冬瓜茶', '檸檬綠茶'])
    expect(hits[0].kind).toBe('exact')
    expect(hits[0].hits).toEqual([0, 1, 2, 3])
    expect(hits[1].hits).toEqual([0, 1])
  })
  it('「排骨飯」對到炸排骨便當；「冬檸」只有冬瓜檸檬', () => {
    expect(searchFoods(foods, '排骨飯').map((h) => h.name)).toEqual(['炸排骨便當'])
    expect(searchFoods(foods, '冬檸').map((h) => h.name)).toEqual(['冬瓜檸檬'])
  })
  it('「711」對得到 7-11 的東西（比店家），只靠店家對到的不標粗、不算完全符合', () => {
    const [h] = searchFoods(foods, '711')
    expect(h.name).toBe('茶葉蛋')
    expect(h.hits).toEqual([])
    expect(h.kind).not.toBe('exact')
  })
  it('叫法（別名）完全符合也排第一、整串粗', () => {
    const learned = { ...WINTER, aliases: ['冬檸'] }
    const hits = searchFoods([WTEA, learned], '冬檸')
    expect(hits[0].food.id).toBe(1)
    expect(hits[0].kind).toBe('exact')
    expect(hits[0].hits).toEqual([0, 1, 2, 3])
  })
  it('每一列標怎麼對到的：品名、沒店家段的別名、只靠店家（食物的店家、「店家 品名」別名的店家段）', () => {
    const GUOTIE = f(30, '鍋貼', '八方')
    const MILK = f(31, '無糖豆漿', '全家')
    expect(searchFoods([GUOTIE], '八方').map((h) => h.via)).toEqual(['store'])
    expect(searchFoods([MILK], '全').map((h) => h.via)).toEqual(['store'])
    expect(searchFoods([TEA], '麻古紅').map((h) => [h.name, h.via])).toEqual([['紅萱波波', 'store']])
    expect(searchFoods([TEA], '紅萱').map((h) => [h.name, h.via])).toEqual([['紅萱波波', 'name']])
    expect(searchFoods([WINTER], '冬檸').map((h) => h.via)).toEqual(['name'])
    expect(searchFoods([{ ...WTEA, aliases: ['冬茶'] }], '冬茶').map((h) => h.via)).toEqual(['alias'])
  })
  it('「店家 品名」別名照常是一列（品名段＋店家段）；封存的不列', () => {
    const hits = searchFoods([TEA, { ...WTEA, archived: true }], '紅萱')
    expect(hits.map((h) => [h.name, h.vendor, h.alias])).toEqual([['紅萱波波', '麻古', '麻古 紅萱波波']])
    expect(searchFoods([TEA], '冬瓜')).toEqual([])
  })
})

describe('框：店名＋品名', () => {
  const stores = ['全家', '7-11', '春陽']
  it('框下按掉「在 {店} 買」：這次整串都是品名（「大杯 拿鐵」的大杯不是店）', () => {
    expect(parseBox('大杯 拿鐵', stores, '大杯')).toEqual({ store: null, item: '大杯 拿鐵', storeOnly: false })
    expect(parseBox('全家', stores, '全家')).toEqual({ store: null, item: '全家', storeOnly: false })
    // 按掉的是別的店名：不影響
    expect(parseBox('春陽 冬瓜', stores, '大杯')?.store).toBe('春陽')
  })
  it('有空白：第一段是店名，後面拿去找；店名照記過的寫法', () => {
    expect(parseBox('春陽 冬瓜檸檬', stores)).toEqual({ store: '春陽', item: '冬瓜檸檬', storeOnly: false })
    expect(parseBox('711　茶葉蛋', stores)).toEqual({ store: '7-11', item: '茶葉蛋', storeOnly: false })
    expect(parseBox('新店 雞排', stores)).toEqual({ store: '新店', item: '雞排', storeOnly: false })
  })
  it('整串就是記過的店名：storeOnly；不是店名就只是品名；空的 null', () => {
    expect(parseBox('711', stores)).toEqual({ store: '7-11', item: '711', storeOnly: true })
    expect(parseBox('冬瓜檸檬', stores)).toEqual({ store: null, item: '冬瓜檸檬', storeOnly: false })
    expect(parseBox('  ', stores)).toBeNull()
  })
  it('記過的店家：紀錄、食物、「店家 品名」別名的，照第一次的寫法去重', () => {
    expect(knownStores([{ vendor: '全家' }, { vendor: null }, { vendor: '7-11' }], [EGG, TEA, { ...LATTE, vendor: '全家' }])).toEqual(['全家', '7-11', '麻古'])
  })
})

describe('你在那家記過的（AC 4a、4b）', () => {
  const foodOf = (id: number) => [EGG, LATTE, WTEA, f(8, '無糖豆漿', null)].find((x) => x.id === id)
  const rec = (eaten_on: string, food_id: number, vendor: string | null, name: string | null = null): LogRecord => ({ eaten_on, meal: 'dinner', food_id, qty: 1, mods: [], name, vendor })
  const records = [
    rec('2026-11-30', 5, '全家'),
    rec('2026-11-24', 2, '春陽', '冬瓜檸檬'),
    rec('2026-11-20', 8, '全家'),
    rec('2026-11-18', 5, '全家'),
    rec('2026-11-12', 6, null),
  ]
  it('紀錄記的店家、或食物本身的店家；最近的在前、同一樣只留最近那次', () => {
    const hits = storeHistory(records, '全家', foodOf)
    expect(hits.map((h) => [h.foodId, h.date])).toEqual([[5, '2026-11-30'], [8, '2026-11-20'], [6, '2026-11-12']])
  })
  it('同一顆茶葉蛋（食物本身是 7-11 的）在全家記過：打「全家」有它，打「711」也有它（照食物的店家）', () => {
    expect(storeHistory([rec('2026-11-30', 5, '全家')], '全家', foodOf).map((h) => h.vendor)).toEqual(['全家'])
    expect(storeHistory([rec('2026-11-30', 5, null)], '711', foodOf).map((h) => h.vendor)).toEqual(['7-11'])
  })
  it('代替記的品名留著（冬瓜檸檬 · 春陽）；最多 max 樣；食品庫沒有的略過', () => {
    expect(storeHistory(records, '春陽', foodOf)).toEqual([{ foodId: 2, name: '冬瓜檸檬', vendor: '春陽', qty: 1, mods: [], date: '2026-11-24' }])
    expect(storeHistory(records, '全家', foodOf, 1)).toHaveLength(1)
    expect(storeHistory([rec('2026-11-30', 99, '全家')], '全家', foodOf)).toEqual([])
  })
  it('上次：今天、昨天、這週內星期幾、更早月/日', () => {
    expect(lastSeenText('2026-11-25', '2026-11-25')).toBe('今天')
    expect(lastSeenText('2026-11-24', '2026-11-25')).toBe('昨天')
    expect(lastSeenText('2026-11-23', '2026-11-25')).toBe('週一')
    expect(lastSeenText('2026-11-12', '2026-11-25')).toBe('11/12')
    // 記在未來的（先記明天的）不說今天
    expect(lastSeenText('2026-11-26', '2026-11-25')).toBe('11/26')
  })
})

describe('你記過的品名：代替記的「排骨飯」再打時浮上來（spec 情境一「拿差不多的代替」）', () => {
  const foodOf = (id: number) => [RIB, f(11, '雞胸餐盒', '減醣廚房')].find((x) => x.id === id)
  const rec = (eaten_on: string, food_id: number, name: string | null, vendor: string | null = null, qty = 1): LogRecord => ({ eaten_on, meal: 'lunch', food_id, qty, mods: [], name, vendor })
  const records = [
    rec('2026-11-24', RIB.id, '排骨便當小份'),
    rec('2026-11-22', RIB.id, '排骨飯', '池上', 2),
    rec('2026-11-20', RIB.id, '排骨飯'),
    rec('2026-11-19', 11, null),
    rec('2026-11-18', RIB.id, '炸排骨便當'),
  ]
  it('打「排骨飯」：完全符合的那筆排第一（整串粗），照最近那次記（份量、店家）；同一樣只留最近那次', () => {
    const hits = nameHistory(records, '排骨飯', foodOf)
    expect(hits.map((h) => [h.name, h.kind, h.qty, h.vendor])).toEqual([
      ['排骨飯', 'exact', 2, '池上'],
      ['排骨便當小份', 'pair', 1, null],
    ])
    expect(hits[0].hits).toEqual([0, 1, 2])
  })
  it('打「排骨」也找得到；打「雞胸」沒有（沒記品名、或品名跟食物一樣的不算）', () => {
    expect(nameHistory(records, '排骨', foodOf).map((h) => h.name)).toEqual(['排骨便當小份', '排骨飯'])
    expect(nameHistory(records, '雞胸', foodOf)).toEqual([])
    expect(nameHistory(records, '炸排骨便當', foodOf).map((h) => h.name)).not.toContain('炸排骨便當')
  })
  it('食品庫沒有那筆的略過；最多 max 樣', () => {
    expect(nameHistory([rec('2026-11-24', 99, '排骨飯')], '排骨飯', foodOf)).toEqual([])
    expect(nameHistory(records, '排骨', foodOf, 1)).toHaveLength(1)
  })
})

describe('你記過的品名與食品庫合成一張清單', () => {
  const n = (name: string, kind: 'exact' | 'contains' | 'order' | 'pair') => ({ name, kind })
  it('記過的品名完全符合或整串出現：放最上面', () => {
    const rows = mergeResults([n('排骨飯', 'exact')], [n('炸排骨便當', 'pair')])
    expect(rows.map((r) => [r.src, r.hit.name])).toEqual([['name', '排骨飯'], ['food', '炸排骨便當']])
  })
  it('只對到一部分的記過品名跟食品庫一起照程度排：打「牛肉麵」，食品庫完全符合的牛肉麵在記過的「牛肉飯」前面', () => {
    const rows = mergeResults([n('牛肉飯', 'pair')], [n('牛肉麵', 'exact'), n('牛肉湯', 'pair')])
    expect(rows.map((r) => [r.src, r.hit.name])).toEqual([['food', '牛肉麵'], ['food', '牛肉湯'], ['name', '牛肉飯']])
  })
})

describe('系統學兩件事（AC 4、4b）', () => {
  it('完全符合（品名、叫法、「店家 品名」的品名段）＝找得到，不學', () => {
    expect(relationOf('拿鐵', LATTE)).toBe('findable')
    expect(relationOf('冬檸', { ...WINTER, aliases: ['冬檸'] })).toBe('findable')
    expect(relationOf('紅萱波波', TEA)).toBe('findable')
  })
  it('整串連續是它名字或叫法的一段＝本來就找得到，不學（使用者核可的例子：打「冬瓜」勾冬瓜茶不記）', () => {
    expect(relationOf('冬瓜', WTEA)).toBe('findable')
    expect(relationOf('雞胸', { name: '雞胸餐盒', aliases: [] })).toBe('findable')
    expect(relationOf('手搖飲', TEA)).toBe('findable')
    expect(relationOf('檸檬', WINTER)).toBe('findable')
    expect(relationOf('寒天', { name: '無糖純茶', aliases: ['寒天綠茶'] })).toBe('findable')
  })
  it('只打店家、或店家＋品名連著打＝找得到，不算代替也不學（「八方」「全」「全家豆漿」「全家無糖」）', () => {
    expect(relationOf('八方', { name: '鍋貼', vendor: '八方', aliases: [] })).toBe('findable')
    expect(relationOf('全家豆漿', { name: '無糖豆漿', vendor: '全家', aliases: [] })).toBe('findable')
    expect(relationOf('全家無糖', { name: '無糖豆漿', vendor: '全家', aliases: [] })).toBe('findable')
    expect(relationOf('豆漿全家', { name: '無糖豆漿', vendor: '全家', aliases: [] })).toBe('findable')
    expect(relationOf('麻古紅', { name: '紅萱波波', vendor: '麻古', aliases: [] })).toBe('findable')
    // 店家的字不算進「照順序」：「全糖」不是無糖豆漿（全家）的叫法
    expect(relationOf('全糖', { name: '無糖豆漿', vendor: '全家', aliases: [] })).toBe('substitute')
  })
  it('字照順序出現但不連續＝你的叫法（alias）', () => {
    expect(relationOf('冬檸', WINTER)).toBe('alias')
    expect(relationOf('炸便當', RIB)).toBe('alias')
  })
  it('只對到一部分（兩個字）或對不上＝代替（故事三：冬瓜檸檬勾冬瓜茶）', () => {
    expect(relationOf('冬瓜檸檬', WTEA)).toBe('substitute')
    expect(relationOf('排骨飯', RIB)).toBe('substitute')
    expect(relationOf('鹽酥雞', WTEA)).toBe('substitute')
  })
  it('別名規則不收的不記：滿 10 個、超過 40 字、含頓號逗號、已經有了', () => {
    expect(learnableAlias([], ' 冬檸 ')).toBe('冬檸')
    expect(learnableAlias(Array.from({ length: 10 }, (_, i) => `a${i}`), '冬檸')).toBeNull()
    expect(learnableAlias([], '冬'.repeat(41))).toBeNull()
    expect(learnableAlias([], '冬、檸')).toBeNull()
    expect(learnableAlias(['冬檸'], '冬檸')).toBeNull()
  })
})
