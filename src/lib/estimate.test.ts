import { describe, expect, it } from 'vitest'
import {
  draftFromKcal,
  draftFromTier,
  draftName,
  draftToFood,
  draftsFromItems,
  draftsToIntake,
  estimateTextOk,
  estimateTotals,
  parseEstimateResponse,
  parseKcal,
  settleKcal,
  TIERS,
  withKcalInput,
  type EstimateItem,
} from './estimate'

const item = (over: Partial<EstimateItem> = {}): EstimateItem => ({
  name: '螺獅粉', kcal: 620, kcal_low: 520, kcal_high: 760, protein_g: 22, fat_g: 25, carb_g: 80, assumption: '米粉一碗約 250 克', ...over,
})

describe('draftsFromItems', () => {
  it('一樣一列、品名就是 AI 給的（不加「（估算）」）、範圍與假設帶過來、預設不存進食品庫', () => {
    const [d] = draftsFromItems([item()])
    expect(draftName(d, 'dinner')).toBe('螺獅粉')
    expect(d).toMatchObject({ kcal: 620, kcalDraft: '620', low: 520, high: 760, assumption: '米粉一碗約 250 克', kcalOnly: false, keep: false, foodId: null })
  })
  it('品名讀不到時用餐別頂替，空白假設當 null', () => {
    const [d] = draftsFromItems([item({ name: '  ', assumption: ' ' })])
    expect(draftName(d, 'lunch')).toBe('午餐')
    expect(d.assumption).toBeNull()
  })
  it('熱量四捨五入成整數，營養素留一位小數', () => {
    const [d] = draftsFromItems([item({ kcal: 620.6, kcal_low: 500.4, kcal_high: 760.5, protein_g: 22.26 })])
    expect(d).toMatchObject({ kcal: 621, low: 500, high: 761, protein: 22.3 })
  })
  it('每列的 key 都不同（刪一列時其他列不重掛）', () => {
    const ds = draftsFromItems([item(), item(), item()])
    expect(new Set(ds.map((d) => d.key)).size).toBe(3)
  })
})

describe('檔位與自己打的數字', () => {
  it('三個檔位：吃得簡單 400、一般正餐 700、吃很多 1000', () => {
    expect(TIERS.map((t) => [t.label, t.kcal])).toEqual([['吃得簡單', 400], ['一般正餐', 700], ['吃很多', 1000]])
  })
  it('檔位草稿：品名預設＝餐別＋（檔位名）、營養素 0、標只估了熱量；改了名就用改的', () => {
    const d = draftFromTier('normal')
    expect(draftName(d, 'dinner')).toBe('晚餐（一般正餐）')
    // 餐別在寫入那一刻才決定（回清單換了餐別再加入，品名跟著那一餐）
    expect(draftName(d, 'lunch')).toBe('午餐（一般正餐）')
    expect(draftName({ ...d, name: ' 媽媽煮的 ' }, 'lunch')).toBe('媽媽煮的')
    expect(d).toMatchObject({ kcal: 700, protein: 0, fat: 0, carb: 0, kcalOnly: true, low: null, high: null })
  })
  it('自己打的數字：品名預設＝餐別，只估了熱量', () => {
    const d = draftFromKcal(523.4)
    expect(draftName(d, 'snack')).toBe('點心')
    expect(d).toMatchObject({ kcal: 523, kcalOnly: true })
  })
})

describe('parseKcal', () => {
  it.each([['620', 620], [' 99.5 ', 100], ['0', 0], ['9999.99', 10000]])('%s → %s', (raw, n) => expect(parseKcal(raw)).toBe(n))
  it.each(['', ' ', 'abc', '-1', '10000', 'NaN', 'Infinity'])('%s → null', (raw) => expect(parseKcal(raw)).toBeNull())
})

describe('withKcalInput：改熱量，營養素照比例縮放', () => {
  const base = draftsFromItems([item({ kcal: 600, kcal_low: 500, kcal_high: 700, protein_g: 30, fat_g: 20, carb_g: 60 })])[0]
  it('600 改 300 ⇒ 營養素減半', () => {
    expect(withKcalInput(base, '300')).toMatchObject({ kcal: 300, kcalDraft: '300', protein: 15, fat: 10, carb: 30 })
  })
  it('打到一半不合法：只動 kcalDraft，數字維持上一個合法值', () => {
    expect(withKcalInput(base, '')).toMatchObject({ kcal: 600, kcalDraft: '', protein: 30 })
  })
  it('原本 0 卡沒有比例可用：只改熱量，營養素維持原本那組', () => {
    const z = draftFromKcal(0)
    expect(withKcalInput({ ...z, origin: { ...z.origin, protein: 5 } }, '200')).toMatchObject({ kcal: 200, protein: 5 })
  })
  it('一個字一個字改（620 → 62 → 6 → 65 → 650）：營養素照原本比例，不會一路疊誤差（review B1）', () => {
    const d0 = draftsFromItems([item()])[0] // 620 / P22 / F25 / C80
    const d = ['62', '6', '65', '650'].reduce(withKcalInput, d0)
    expect(d).toMatchObject({ kcal: 650, protein: 23.1, fat: 26.2, carb: 83.9 })
  })
  it('中間打出 0 也不會把營養素永久歸零', () => {
    const d0 = draftsFromItems([item()])[0]
    const d = ['0', '', '620'].reduce(withKcalInput, d0)
    expect(d).toMatchObject({ kcal: 620, protein: 22, fat: 25, carb: 80 })
  })
  it('範圍下限是負的就當 0', () => {
    expect(draftsFromItems([item({ kcal_low: -50 })])[0].low).toBe(0)
  })
  it('settleKcal 把框裡的字收回合法數字', () => {
    expect(settleKcal(withKcalInput(base, 'abc')).kcalDraft).toBe('600')
  })
})

describe('合計與寫入', () => {
  it('estimateTotals 加總熱量與營養素', () => {
    const ds = [...draftsFromItems([item(), item({ kcal: 150, kcal_low: 110, kcal_high: 190, protein_g: 0, fat_g: 0, carb_g: 38 })]), draftFromTier('light')]
    expect(estimateTotals(ds)).toEqual({ n: 3, kcal: 1170, protein: 22, fat: 25, carb: 118 })
  })
  it('draftToFood：品名、店家空', () => {
    expect(draftToFood(draftsFromItems([item()])[0], 'dinner')).toEqual({ name: '螺獅粉', vendor: null, kcal: 620, protein: 22, fat: 25, carb: 80 })
  })
  it('draftsToIntake：份量 1、營養快照＝草稿、餐別與日期照傳入', () => {
    const d = { ...draftsFromItems([item()])[0], foodId: 42 }
    expect(draftsToIntake([d], 'dinner', '2026-11-13')).toEqual([
      { eaten_on: '2026-11-13', meal: 'dinner', food_id: 42, qty: 1, kcal: 620, protein: 22, fat: 25, carb: 80, name: null },
    ])
  })
  it('還沒建好 food 的列不能寫 intake', () => {
    expect(() => draftsToIntake(draftsFromItems([item()]), 'dinner', '2026-11-13')).toThrow()
  })
})

describe('estimateTextOk：trim 後 1–300 字（code point）', () => {
  it.each([['', false], ['   ', false], ['螺獅粉', true], ['a'.repeat(300), true], ['a'.repeat(301), false], ['😀'.repeat(300), true]])('%#', (t, ok) =>
    expect(estimateTextOk(t)).toBe(ok),
  )
})

describe('parseEstimateResponse：回應是外部資料', () => {
  it('合法的整組收下，缺的 name／assumption 當 null', () => {
    const r = parseEstimateResponse({ items: [{ ...item(), name: undefined, assumption: 3 }] })
    expect(r).toEqual([{ ...item(), name: null, assumption: null }])
  })
  it.each([
    ['不是物件', null],
    ['沒有 items', {}],
    ['空陣列', { items: [] }],
    ['21 樣', { items: Array.from({ length: 21 }, () => item()) }],
    ['low > kcal', { items: [item({ kcal_low: 700 })] }],
    ['kcal > high', { items: [item({ kcal_high: 600 })] }],
    ['kcal 不是有限數', { items: [item({ kcal: Number.NaN })] }],
    ['kcal 超過 3000', { items: [item({ kcal: 3001, kcal_high: 3100 })] }],
    ['營養素負數', { items: [item({ fat_g: -1 })] }],
    ['營養素超過 300', { items: [item({ carb_g: 301 })] }],
    ['其中一樣壞掉整組丟掉', { items: [item(), item({ protein_g: Number.POSITIVE_INFINITY })] }],
  ])('%s ⇒ null', (_, data) => expect(parseEstimateResponse(data)).toBeNull())
})
