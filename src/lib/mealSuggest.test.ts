import { describe, expect, it } from 'vitest'
import type { IntakeRow } from './api'
import { isWeekend } from './dates'
import { macroGap } from './formulas'
import {
  mergeByFood,
  recentMeals,
  repeatToIntake,
  suggestByGap,
  suggestLabel,
  suggestMeals,
  suggestRepeat,
  type GapContext,
  type RepeatItem,
  type RepeatSourceRow,
  type RepeatSuggestion,
} from './mealSuggest'

const WHEY = { name: '乳清（1匙）', vendor: null, archived: false, category: null }
const SOY = { name: '無糖豆漿', vendor: '全家', archived: false, category: null }

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
    ['28 天平日：D-28 算', '2026-11-04', ['2026-10-07'], '2026-10-07'],
    ['28 天平日：D-29 不算', '2026-11-04', ['2026-10-06'], null],
    ['28 天假日：D-28 算', '2026-11-08', ['2026-10-11'], '2026-10-11'],
    ['28 天假日：D-29 不算', '2026-11-08', ['2026-10-10'], null],
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

  it('那天的品項全被刪：那天不算，往前一天找（第二版；線上 food_id 是 on delete restrict 走不到）', () => {
    const rows = [row('2026-11-03', { foods: null }), row('2026-11-03', { foods: null }), row('2026-11-02')]
    expect(sourceOf(rows, '2026-11-04')).toBe('2026-11-02')
    expect(suggestRepeat([row('2026-11-03', { foods: null })], '2026-11-04', 'breakfast')).toBeNull()
  })
})

describe('suggestRepeat 常吃與上次（2026-11-04 週三）', () => {
  const OATS = { food_id: 31, foods: { name: '燕麥', vendor: null, archived: false, category: null } }
  const RICE = { food_id: 32, foods: { name: '飯糰', vendor: '7-11', archived: false, category: null } }

  it('出現 ≥ 2 次的組合勝過最近一次，取那組最近一次的日期與份量', () => {
    const rows = [
      row('2026-11-03', RICE),
      row('2026-11-02', { ...OATS, qty: 2 }),
      row('2026-10-29', OATS),
      row('2026-10-28', OATS),
    ]
    const s = suggestRepeat(rows, '2026-11-04', 'breakfast')!
    expect(s).toMatchObject({ source: 'frequent', sourceDate: '2026-11-02', overKcal: null, total: 1 })
    expect(s.items[0]).toMatchObject({ food_id: 31, qty: 2 })
  })

  it('每組都只出現一次：退回上次', () => {
    const rows = [row('2026-11-03', RICE), row('2026-11-02', OATS)]
    expect(suggestRepeat(rows, '2026-11-04', 'breakfast')).toMatchObject({ source: 'last', sourceDate: '2026-11-03' })
  })

  it('次數一樣：取最近一次比較近的那組', () => {
    const rows = [row('2026-10-30', OATS), row('2026-10-29', RICE), row('2026-10-28', OATS), row('2026-10-27', RICE)]
    expect(suggestRepeat(rows, '2026-11-04', 'breakfast')).toMatchObject({ source: 'frequent', sourceDate: '2026-10-30' })
  })

  it('同一組只看食物、不看份量；多樣品項看集合不看順序', () => {
    const rows = [
      row('2026-11-03', { ...OATS, qty: 1, created_at: 't1' }),
      row('2026-11-03', { food_id: 15, foods: SOY, created_at: 't2' }),
      row('2026-11-02', { food_id: 15, foods: SOY, created_at: 't1' }),
      row('2026-11-02', { ...OATS, qty: 3, created_at: 't2' }),
      row('2026-11-01', RICE),
    ]
    expect(suggestRepeat(rows, '2026-11-04', 'breakfast')).toMatchObject({ source: 'frequent', sourceDate: '2026-11-03' })
  })

  it('假日的次數不算進平日', () => {
    const rows = [row('2026-11-03', RICE), row('2026-11-01', OATS), row('2026-10-31', OATS)]
    expect(suggestRepeat(rows, '2026-11-04', 'breakfast')).toMatchObject({ source: 'last', sourceDate: '2026-11-03' })
  })
})

/* 依缺口挑：一組＝一天的晚餐，預期值手算。目標 1778／137／65／163（DESIGN 樣張的數字）。 */
describe('suggestByGap', () => {
  const VIEW = '2026-11-04'
  const TARGETS = { kcal: 1778, protein: 137, fat: 65, carb: 163 }
  const cut: GapContext = { targets: TARGETS, goal: 'cut' }
  let fid = 100
  /** 一種晚餐（單一食物），在指定日子各吃一次。 */
  function meal(dates: string[], n: { kcal: number; protein: number; fat: number; carb: number }, name = `餐${fid}`) {
    const food_id = fid++
    return dates.map((d) => row(d, { meal: 'dinner', food_id, ...n, foods: { name, vendor: null, archived: false, category: null } }))
  }
  const names = (s: RepeatSuggestion[]) => s.map((x) => x.items[0].label)
  // 已吃 1258／97／47／118 ⇒ 缺口 520／40／18／45
  const EATEN = { kcal: 1258, protein: 97, fat: 47, carb: 118 }

  it('使用者的例子：雞腿便當勝過蛋白質更高但脂肪超標的麥當勞', () => {
    const rows = [
      ...meal(['2026-11-03', '2026-10-27', '2026-10-20'], { kcal: 470, protein: 50, fat: 13, carb: 33 }, '雞胸餐盒'),
      ...meal(['2026-11-02', '2026-10-26'], { kcal: 510, protein: 38, fat: 17, carb: 44 }, '雞腿便當'),
      ...meal(['2026-11-01', '2026-10-31', '2026-10-25', '2026-10-24'], { kcal: 500, protein: 42, fat: 24, carb: 40 }, '麥當勞'),
    ]
    const ranked = suggestByGap(rows, VIEW, 'dinner', EATEN, cut)
    expect(names(ranked)).toEqual(['雞胸餐盒', '雞腿便當', '麥當勞'])
    expect(ranked.map((s) => s.total)).toEqual([3, 3, 3])
    expect(ranked.every((s) => s.source === 'gap' && s.overKcal === null)).toBe(true)
    // 只有麥當勞與雞腿便當時，麥當勞脂肪超 6 g 排後面
    expect(names(suggestByGap(rows.filter((r) => r.foods?.name !== '雞胸餐盒'), VIEW, 'dinner', EATEN, cut))).toEqual(['雞腿便當', '麥當勞'])
  })

  it('熱量全都超過上限：超最少的排前面，回傳超出卡數', () => {
    // 已吃 1458 ⇒ 缺口 320
    const eaten = { kcal: 1458, protein: 107, fat: 55, carb: 135 }
    const rows = [
      ...meal(['2026-11-03'], { kcal: 510, protein: 38, fat: 17, carb: 44 }, '510'),
      ...meal(['2026-11-02'], { kcal: 470, protein: 50, fat: 13, carb: 33 }, '470'),
      ...meal(['2026-11-01'], { kcal: 500, protein: 42, fat: 24, carb: 40 }, '500'),
    ]
    const ranked = suggestByGap(rows, VIEW, 'dinner', eaten, cut)
    expect(names(ranked)).toEqual(['470', '500', '510'])
    expect(ranked.map((s) => s.overKcal)).toEqual([150, 180, 190])
  })

  it('上限內的永遠排在超過的前面，即使超過的蛋白質高很多', () => {
    const rows = [
      ...meal(['2026-11-03'], { kcal: 530, protein: 90, fat: 5, carb: 20 }, '超'),
      ...meal(['2026-11-02'], { kcal: 300, protein: 10, fat: 5, carb: 20 }, '內'),
    ]
    expect(names(suggestByGap(rows, VIEW, 'dinner', EATEN, cut))).toEqual(['內', '超'])
  })

  it('熱量上限：減重＝缺口，維持與增肌＝缺口 × 1.1', () => {
    const rows = meal(['2026-11-03'], { kcal: 560, protein: 40, fat: 10, carb: 30 })
    expect(suggestByGap(rows, VIEW, 'dinner', EATEN, cut)[0].overKcal).toBe(40)
    // 520 × 1.1 = 572
    expect(suggestByGap(rows, VIEW, 'dinner', EATEN, { targets: TARGETS, goal: 'maintain' })[0].overKcal).toBeNull()
    expect(suggestByGap(rows, VIEW, 'dinner', EATEN, { targets: TARGETS, goal: 'bulk' })[0].overKcal).toBeNull()
    const big = meal(['2026-11-03'], { kcal: 600, protein: 40, fat: 10, carb: 30 })
    expect(suggestByGap(big, VIEW, 'dinner', EATEN, { targets: TARGETS, goal: 'bulk' })[0].overKcal).toBe(28)
  })

  it('脂肪碳水都超：換算熱量超出最少的排前面（脂 ×9、碳 ×4）', () => {
    const rows = [
      ...meal(['2026-11-03'], { kcal: 400, protein: 40, fat: 20, carb: 40 }, '脂超2'), // 2×9 = 18
      ...meal(['2026-11-02'], { kcal: 400, protein: 40, fat: 10, carb: 49 }, '碳超4'), // 4×4 = 16
    ]
    expect(names(suggestByGap(rows, VIEW, 'dinner', EATEN, cut))).toEqual(['碳超4', '脂超2'])
  })

  it('蛋白質差 5 g 內算達標、彼此同分；都沒達標時蛋白質多的優先', () => {
    const okLow = meal(['2026-11-03', '2026-11-02'], { kcal: 400, protein: 35, fat: 10, carb: 30 }, '35g兩次')
    const okHigh = meal(['2026-11-01'], { kcal: 400, protein: 60, fat: 10, carb: 30 }, '60g一次')
    const short = meal(['2026-10-31', '2026-10-30', '2026-10-29'], { kcal: 400, protein: 34, fat: 10, carb: 30 }, '34g三次')
    // 35 與 60 都達標 ⇒ 同分，比次數；34 沒達標，次數再多也排後面
    expect(names(suggestByGap([...okHigh, ...okLow, ...short], VIEW, 'dinner', EATEN, cut))).toEqual(['35g兩次', '60g一次', '34g三次'])
    const a = meal(['2026-11-03', '2026-11-02'], { kcal: 400, protein: 20, fat: 10, carb: 30 }, '20g')
    const b = meal(['2026-11-01'], { kcal: 400, protein: 30, fat: 10, carb: 30 }, '30g')
    expect(names(suggestByGap([...a, ...b], VIEW, 'dinner', EATEN, cut))).toEqual(['30g', '20g'])
  })

  it('再同分：碳水越接近補滿越好，再來脂肪低的，最後比較近的', () => {
    const carb = [
      ...meal(['2026-11-03'], { kcal: 400, protein: 40, fat: 10, carb: 30 }, '碳30'),
      ...meal(['2026-11-02'], { kcal: 400, protein: 40, fat: 10, carb: 44 }, '碳44'),
    ]
    expect(names(suggestByGap(carb, VIEW, 'dinner', EATEN, cut))).toEqual(['碳44', '碳30'])
    const fat = [
      ...meal(['2026-11-03'], { kcal: 400, protein: 40, fat: 15, carb: 40 }, '脂15'),
      ...meal(['2026-11-02'], { kcal: 400, protein: 40, fat: 9, carb: 40 }, '脂9'),
    ]
    expect(names(suggestByGap(fat, VIEW, 'dinner', EATEN, cut))).toEqual(['脂9', '脂15'])
    const tie = [
      ...meal(['2026-11-01'], { kcal: 400, protein: 40, fat: 10, carb: 40 }, '舊'),
      ...meal(['2026-11-03'], { kcal: 400, protein: 40, fat: 10, carb: 40 }, '新'),
    ]
    expect(names(suggestByGap(tie, VIEW, 'dinner', EATEN, cut))).toEqual(['新', '舊'])
  })

  it('不分平日假日、同一組只算一個候選、份量照最近那次', () => {
    const food = { food_id: 99, foods: { name: '週末便當', vendor: null, archived: false, category: null }, kcal: 200, protein: 40, fat: 5, carb: 20 }
    const rows = [row('2026-11-01', { ...food, meal: 'dinner', qty: 2 }), row('2026-10-25', { ...food, meal: 'dinner', qty: 1 })]
    const ranked = suggestByGap(rows, VIEW, 'dinner', EATEN, cut)
    expect(ranked).toHaveLength(1)
    expect(ranked[0]).toMatchObject({ sourceDate: '2026-11-01', kcal: 400, total: 1 })
  })

  it('剛好補滿脂肪缺口不算超出：浮點誤差不能讓它輸', () => {
    // 已吃脂肪 64.7 ⇒ 缺口 65−64.7＝0.29999999999999716；那組兩樣各 0.1、0.2 g 加起來是 0.30000000000000004，
    // 直接相減會「超出」2.9e-15 g（node 實算）。捨到 0.1 g 後是 0
    const eaten = { kcal: 1258, protein: 97, fat: 64.7, carb: 118 }
    const food = (food_id: number, name: string, fat: number, carb: number) =>
      row('2026-11-03', { meal: 'dinner', food_id, kcal: 250, protein: 20, fat, carb, foods: { name, vendor: null, archived: false, category: null } })
    const rows = [
      food(901, '剛好補滿', 0.1, 20),
      food(902, '剛好補滿二', 0.2, 20),
      ...meal(['2026-11-02'], { kcal: 500, protein: 40, fat: 0.1, carb: 10 }, '碳水少'),
    ]
    // 兩組都沒超 ⇒ 比到碳水，剛好補滿那組碳水 40 比較接近缺口 45
    expect(names(suggestByGap(rows, VIEW, 'dinner', eaten, cut))).toEqual(['剛好補滿', '碳水少'])
  })

  it('熱量缺口 ≤ 0：沒有候選', () => {
    const rows = meal(['2026-11-03'], { kcal: 100, protein: 10, fat: 1, carb: 1 })
    expect(suggestByGap(rows, VIEW, 'dinner', { ...EATEN, kcal: 1778 }, cut)).toEqual([])
    expect(suggestByGap(rows, VIEW, 'dinner', { ...EATEN, kcal: 1900 }, cut)).toEqual([])
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
      row(DAY, { food_id: 1, name: '自訂品名', foods: { name: '原名', vendor: 'V', archived: true, category: null } }),
      row(DAY, { food_id: 2, name: null, foods: { name: '原名二', vendor: null, archived: true, category: null } }),
    ]
    const [a, b] = suggestRepeat(rows, VIEW, 'breakfast')!.items
    expect(a).toMatchObject({ label: '自訂品名', name: '自訂品名', vendor: 'V', archived: true, category: null })
    expect(b).toMatchObject({ label: '原名二', name: null, vendor: null, archived: true, category: null })
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
    category: null,
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

describe('suggestMeals', () => {
  const rows = [row('2026-11-03'), row('2026-11-03', { meal: 'dinner', kcal: 400, protein: 40, fat: 5, carb: 20 })]
  const dayRow = (meal: IntakeRow['meal'], kcal = 120): IntakeRow => ({ id: nextId++, meal, qty: 1, kcal, protein: 24, fat: 1.5, carb: 2, name: null, food_id: 13, foods: null })
  const ctx: GapContext = { targets: { kcal: 1778, protein: 137, fat: 65, carb: 163 }, goal: 'cut' }

  it('該餐已有紀錄就不給，其他餐照給', () => {
    const byMeal = suggestMeals(rows, '2026-11-04', [dayRow('breakfast')], ctx)
    expect(byMeal.breakfast).toBeUndefined()
    expect(byMeal.dinner?.[0]).toMatchObject({ sourceDate: '2026-11-03', source: 'last' })
    expect(byMeal.lunch).toBeUndefined()
  })

  it('晚餐依缺口挑要三個條件：有 ctx、早餐與午餐都有紀錄', () => {
    const both = [dayRow('breakfast'), dayRow('lunch')]
    expect(suggestMeals(rows, '2026-11-04', both, ctx).dinner?.[0].source).toBe('gap')
    expect(suggestMeals(rows, '2026-11-04', both, null).dinner?.[0].source).toBe('last')
    expect(suggestMeals(rows, '2026-11-04', [dayRow('breakfast')], ctx).dinner?.[0].source).toBe('last')
    expect(suggestMeals(rows, '2026-11-04', [dayRow('lunch')], ctx).dinner?.[0].source).toBe('last')
    // 點心不算條件，有了也不影響
    expect(suggestMeals(rows, '2026-11-04', [...both, dayRow('snack')], ctx).dinner?.[0].source).toBe('gap')
  })

  it('依缺口挑但熱量缺口 ≤ 0：晚餐整格不出，不退回常吃', () => {
    const full = [dayRow('breakfast', 900), dayRow('lunch', 900)]
    expect(suggestMeals(rows, '2026-11-04', full, ctx).dinner).toBeUndefined()
  })

  it('任一資料還沒到回空物件', () => {
    expect(suggestMeals(null, '2026-11-04', [], ctx)).toEqual({})
    expect(suggestMeals(rows, '2026-11-04', null, ctx)).toEqual({})
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

/* 第三版：避開重複（spec.md C 節「第三版」AC 1–4）。2026-11-04 是週三，前一天 11-03（週二）。
   食物都是通用名；類型與店家照真實資料的形狀：外食有店家、自己準備的沒有。預期值手算。 */
describe('第三版：避開重複', () => {
  const VIEW = '2026-11-04'
  const food = (food_id: number, name: string, vendor: string | null, category: string | null) => ({
    food_id,
    foods: { name, vendor, archived: false, category },
  })
  const ROAST_A = food(201, '叉燒飯', '燒臘店甲', '燒臘')
  const ROAST_B = food(202, '燒臘便當', '燒臘店乙', '燒臘')
  const CHICKEN = food(203, '雞腿便當', '便當店', '便當')
  const BURGER = food(204, '漢堡套餐', '漢堡店', '速食')
  const NUGGET = food(205, '雞塊', '漢堡店', '速食')
  const TEA = food(206, '無糖綠茶', '飲料店', '飲料')
  const WHEY2 = food(207, '乳清', null, '蛋白質補充')
  const EGG = food(208, '茶葉蛋', null, '配菜')
  const BEEF = food(209, '牛肉麵', '麵店', '麵食')
  const DUMPLING = food(210, '水餃', '麵店', '餃類')
  const SOYMILK = food(211, '豆漿', '便利店', '飲料')
  const OMELET = food(212, '蛋餅', '早餐店甲', '早餐店')

  type F = ReturnType<typeof food>
  const n0 = { kcal: 500, protein: 30, fat: 15, carb: 60 }
  /** 某天某餐吃了這幾樣（每樣一列）。 */
  const ate = (date: string, meal: RepeatSourceRow['meal'], fs: F[], n = n0) =>
    fs.map((f, i) => row(date, { meal, ...f, ...n, created_at: `${date}T0${i}:00:00+00:00` }))
  /** 同一組在幾天各吃一次。 */
  const days = (dates: string[], meal: RepeatSourceRow['meal'], fs: F[], n = n0) => dates.flatMap((d) => ate(d, meal, fs, n))
  /** 檢視日的紀錄（listIntake 的形狀）。 */
  const today = (meal: IntakeRow['meal'], f: F, n = n0): IntakeRow => ({
    id: nextId++,
    meal,
    qty: 1,
    ...n,
    name: null,
    food_id: f.food_id,
    foods: { name: f.foods.name, vendor: f.foods.vendor, category: f.foods.category },
  })
  const label = (s: RepeatSuggestion | null | undefined) => s?.items.map((i) => i.label).join('・')

  describe('recentMeals（AC 1）', () => {
    it('類型只收餐點類型、品項只收有店家的、店家只看當天其他餐', () => {
      const dayRows = [today('breakfast', WHEY2), today('lunch', ROAST_A), today('lunch', TEA)]
      const rows = [...ate('2026-11-03', 'dinner', [BEEF, EGG]), ...ate('2026-11-02', 'dinner', [CHICKEN])]
      const r = recentMeals(rows, VIEW, dayRows, 'dinner')
      expect([...r.categories].sort()).toEqual(['燒臘', '麵食'].sort())
      expect([...r.items].sort()).toEqual([201, 206, 209])
      expect([...r.vendors].sort()).toEqual(['燒臘店甲', '飲料店'].sort())
    })

    it('不含要建議的這一餐本身', () => {
      const r = recentMeals([], VIEW, [today('breakfast', WHEY2), today('lunch', ROAST_A)], 'lunch')
      expect(r).toEqual({ categories: new Set(), items: new Set(), vendors: new Set() })
    })

    it('店家前後空白不算不同家、空白當沒填', () => {
      const spaced = food(220, '雞塊', ' 漢堡店 ', '速食')
      const blank = food(221, '白飯', '  ', '主食')
      const r = recentMeals([], VIEW, [today('lunch', spaced), today('lunch', blank)], 'dinner')
      expect([...r.vendors]).toEqual(['漢堡店'])
      expect([...r.items]).toEqual([220])
    })
  })

  describe('常吃／上次（AC 1、3）', () => {
    it('中午燒臘：最常吃的燒臘便當跟午餐同類型，改出下一個沒重複的雞腿便當', () => {
      const rows = [...days(['2026-10-28', '2026-10-27', '2026-10-26'], 'dinner', [ROAST_B]), ...days(['2026-10-30', '2026-10-29'], 'dinner', [CHICKEN])]
      expect(label(suggestRepeat(rows, VIEW, 'dinner')), '對照：沒有避開時是燒臘便當').toBe('燒臘便當')
      const s = suggestMeals(rows, VIEW, [today('lunch', ROAST_A)], null).dinner![0]
      expect(s).toMatchObject({ source: 'frequent', sourceDate: '2026-10-30' })
      expect(label(s)).toBe('雞腿便當')
    })

    it('沒重複的組都沒出現 2 次：最近一個沒重複的同類日，標「上次」', () => {
      const rows = [...days(['2026-10-28', '2026-10-27'], 'dinner', [ROAST_B]), ...ate('2026-10-26', 'dinner', [CHICKEN]), ...ate('2026-10-22', 'dinner', [BEEF])]
      const s = suggestMeals(rows, VIEW, [today('lunch', ROAST_A)], null).dinner![0]
      expect(s).toMatchObject({ source: 'last', sourceDate: '2026-10-26' })
    })

    it('全部都重複：照第二版（允許重複），不會整格空白', () => {
      const rows = [...days(['2026-10-28', '2026-10-27'], 'dinner', [ROAST_B]), ...ate('2026-10-29', 'dinner', [food(213, '燒肉飯', '燒臘店乙', '燒臘')])]
      const s = suggestMeals(rows, VIEW, [today('lunch', ROAST_A)], null).dinner![0]
      expect(s).toMatchObject({ source: 'frequent', sourceDate: '2026-10-28' })
      expect(label(s)).toBe('燒臘便當')
    })

    it('當天其他餐出現過的店家：整組拿掉（含混著別家的那組）', () => {
      const rows = [
        ...days(['2026-10-28', '2026-10-27', '2026-10-26'], 'dinner', [NUGGET]),
        ...days(['2026-10-23', '2026-10-22'], 'dinner', [CHICKEN, NUGGET]),
        ...ate('2026-10-30', 'dinner', [BEEF]),
      ]
      const s = suggestMeals(rows, VIEW, [today('lunch', BURGER)], null).dinner![0]
      expect(s).toMatchObject({ source: 'last', sourceDate: '2026-10-30' })
      expect(label(s)).toBe('牛肉麵')
    })

    it('拿掉同店家後沒有候選：不出建議', () => {
      const rows = days(['2026-10-28', '2026-10-27'], 'dinner', [NUGGET])
      expect(suggestMeals(rows, VIEW, [today('lunch', BURGER)], null).dinner).toBeUndefined()
    })

    it('前一天同店同品項算重複、同店不同品項（不同類型）可以', () => {
      const rows = [
        ...ate('2026-11-03', 'dinner', [BEEF]),
        ...days(['2026-10-28', '2026-10-27', '2026-10-26'], 'dinner', [BEEF]),
        ...days(['2026-10-30', '2026-10-29'], 'dinner', [DUMPLING]),
      ]
      const s = suggestMeals(rows, VIEW, [], null).dinner![0]
      expect(label(s)).toBe('水餃')
      expect(s.source).toBe('frequent')
    })

    it('搭配類不算類型重複：前一天喝過別家的飲料，含飲料的那組照樣是常吃', () => {
      const rows = [
        ...ate('2026-11-03', 'lunch', [SOYMILK]),
        ...days(['2026-10-28', '2026-10-27', '2026-10-26'], 'dinner', [CHICKEN, TEA]),
        ...days(['2026-10-30', '2026-10-29'], 'dinner', [BEEF]),
      ]
      expect(label(suggestMeals(rows, VIEW, [], null).dinner![0])).toBe('雞腿便當・無糖綠茶')
    })

    it('沒填店家的品項同 food_id 不算重複', () => {
      const rows = [
        ...ate('2026-11-03', 'dinner', [WHEY2, EGG]),
        ...days(['2026-10-28', '2026-10-27', '2026-10-26'], 'dinner', [WHEY2, EGG]),
        ...days(['2026-10-30', '2026-10-29'], 'dinner', [CHICKEN]),
      ]
      expect(label(suggestMeals(rows, VIEW, [], null).dinner![0])).toBe('乳清・茶葉蛋')
    })

    it('還沒分類（null）的食物不參與類型判斷', () => {
      const plain = food(214, '某便當', '某店', null)
      const rows = [
        ...ate('2026-11-03', 'dinner', [food(215, '另一個便當', '另一家', null)]),
        ...days(['2026-10-28', '2026-10-27'], 'dinner', [plain]),
        ...ate('2026-10-30', 'dinner', [CHICKEN]),
      ]
      expect(label(suggestMeals(rows, VIEW, [], null).dinner![0])).toBe('某便當')
    })

    it('早餐與點心不套用：同類型、同店家照樣建議', () => {
      const rows = [
        ...ate('2026-11-03', 'breakfast', [OMELET]),
        ...days(['2026-10-28', '2026-10-27'], 'breakfast', [OMELET]),
        ...days(['2026-10-28', '2026-10-27'], 'snack', [NUGGET]),
      ]
      const byMeal = suggestMeals(rows, VIEW, [today('lunch', BURGER)], null)
      expect(label(byMeal.breakfast![0])).toBe('蛋餅')
      expect(label(byMeal.snack![0])).toBe('雞塊')
    })

    it('午餐也套用：早餐吃了漢堡店，午餐的漢堡店組拿掉', () => {
      const rows = [...days(['2026-10-28', '2026-10-27'], 'lunch', [NUGGET]), ...ate('2026-10-29', 'lunch', [CHICKEN])]
      expect(label(suggestMeals(rows, VIEW, [today('breakfast', BURGER)], null).lunch![0])).toBe('雞腿便當')
    })

    it('明天（AC 4）：前一天就是今天，今天的紀錄在回看資料裡', () => {
      const TOMORROW = '2026-11-05'
      const rows = [
        ...ate('2026-11-04', 'lunch', [ROAST_A]),
        ...days(['2026-10-28', '2026-10-27', '2026-10-26'], 'dinner', [ROAST_B]),
        ...days(['2026-10-30', '2026-10-29'], 'dinner', [CHICKEN]),
      ]
      expect(label(suggestMeals(rows, TOMORROW, [], null).dinner![0])).toBe('雞腿便當')
      // 對照：今天那筆拿掉就回到燒臘便當
      expect(label(suggestMeals(rows.slice(1), TOMORROW, [], null).dinner![0])).toBe('燒臘便當')
    })
  })

  describe('依缺口挑（AC 2）', () => {
    const ctx: GapContext = { targets: { kcal: 1778, protein: 137, fat: 65, carb: 163 }, goal: 'cut' }
    // 早餐乳清 120／24／1.5／2 ＋ 午餐叉燒飯 700／30／25／90 ⇒ 已吃 820／54／26.5／92 ⇒ 缺口 958／83／38.5／71，上限（減重）958
    const DAY = [today('breakfast', WHEY2, { kcal: 120, protein: 24, fat: 1.5, carb: 2 }), today('lunch', ROAST_A, { kcal: 700, protein: 30, fat: 25, carb: 90 })]
    const RB = { kcal: 750, protein: 45, fat: 20, carb: 70 }
    const CK = { kcal: 650, protein: 35, fat: 18, carb: 60 }
    const names = (s: RepeatSuggestion[] | undefined) => (s ?? []).map((x) => label(x))

    it('使用者的例子：中午燒臘，晚餐燒臘便當與雞腿便當都在上限內 ⇒ 雞腿便當', () => {
      const rows = [...ate('2026-10-30', 'dinner', [ROAST_B], RB), ...ate('2026-10-29', 'dinner', [CHICKEN], CK)]
      // 對照（第二版）：兩組脂碳都沒超、蛋白質都沒達標（45、35 < 83−5）⇒ 蛋白質多的燒臘便當在前
      expect(names(suggestByGap(rows, VIEW, 'dinner', { kcal: 820, protein: 54, fat: 26.5, carb: 92 }, ctx))).toEqual(['燒臘便當', '雞腿便當'])
      const ranked = suggestMeals(rows, VIEW, DAY, ctx).dinner
      expect(names(ranked)).toEqual(['雞腿便當', '燒臘便當'])
      expect(ranked!.every((s) => s.source === 'gap' && s.overKcal === null && s.total === 2)).toBe(true)
    })

    it('全部超過上限：排序與第二版相同（超出一樣多的兩組不因重複換位）', () => {
      // 午餐改 1100 卡 ⇒ 已吃 1220 ⇒ 缺口 558；兩組都 750 ⇒ 都超 192，接著比蛋白質 ⇒ 燒臘便當在前
      const day = [DAY[0], today('lunch', ROAST_A, { kcal: 1100, protein: 30, fat: 25, carb: 90 })]
      const rows = [...ate('2026-10-30', 'dinner', [ROAST_B], RB), ...ate('2026-10-29', 'dinner', [CHICKEN], { ...CK, kcal: 750 })]
      const ranked = suggestMeals(rows, VIEW, day, ctx).dinner!
      expect(names(ranked)).toEqual(['燒臘便當', '雞腿便當'])
      expect(ranked.map((s) => s.overKcal)).toEqual([192, 192])
      expect(names(ranked)).toEqual(names(suggestByGap(rows, VIEW, 'dinner', { kcal: 1220, protein: 54, fat: 26.5, carb: 92 }, ctx)))
    })

    it('熱量優先於重複：上限內但重複的，排在超過上限但沒重複的前面', () => {
      const rows = [...ate('2026-10-30', 'dinner', [ROAST_B], RB), ...ate('2026-10-29', 'dinner', [BEEF], { kcal: 1000, protein: 40, fat: 20, carb: 60 })]
      expect(names(suggestMeals(rows, VIEW, DAY, ctx).dinner)).toEqual(['燒臘便當', '牛肉麵'])
    })

    it('全部都重複：仍出建議', () => {
      const rows = ate('2026-10-30', 'dinner', [ROAST_B], RB)
      expect(names(suggestMeals(rows, VIEW, DAY, ctx).dinner)).toEqual(['燒臘便當'])
    })

    it('當天其他餐的店家：整組拿掉、不算進換一個的總數；拿掉完沒有候選就不出', () => {
      const sameShop = food(216, '燒鴨飯', '燒臘店甲', '燒臘')
      const rows = [...ate('2026-10-30', 'dinner', [sameShop], CK), ...ate('2026-10-29', 'dinner', [CHICKEN], CK)]
      const ranked = suggestMeals(rows, VIEW, DAY, ctx).dinner!
      expect(names(ranked)).toEqual(['雞腿便當'])
      expect(ranked[0].total).toBe(1)
      expect(suggestMeals(ate('2026-10-30', 'dinner', [sameShop], CK), VIEW, DAY, ctx).dinner).toBeUndefined()
    })

    it('前一天吃過的品項（有店家）也算重複', () => {
      const rows = [
        ...ate('2026-11-03', 'lunch', [CHICKEN], CK),
        ...ate('2026-10-30', 'dinner', [CHICKEN], CK),
        ...ate('2026-10-29', 'dinner', [food(217, '排骨便當', '另一家便當', '便當')], { kcal: 600, protein: 30, fat: 18, carb: 60 }),
        ...ate('2026-10-28', 'dinner', [BEEF], { kcal: 600, protein: 25, fat: 18, carb: 60 }),
      ]
      // 午餐叉燒飯（燒臘）＋ 前一天雞腿便當（便當、有店家）⇒ 雞腿便當與排骨便當都重複，牛肉麵沒有
      expect(names(suggestMeals(rows, VIEW, DAY, ctx).dinner)).toEqual(['牛肉麵', '雞腿便當', '排骨便當'])
    })
  })
})
