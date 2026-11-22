import { describe, expect, it } from 'vitest'
import {
  applyFix,
  canFix,
  fixRequestItem,
  fixTag,
  fixTextOk,
  mealMacroRatio,
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
  it('draftToFood：品名、店家空、來源一律 AI 粗估', () => {
    expect(draftToFood(draftsFromItems([item()])[0], 'dinner')).toEqual({ name: '螺獅粉', vendor: null, kcal: 620, protein: 22, fat: 25, carb: 80, source: 'ai' })
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

describe('檔位與自己打的熱量照這一餐的歷史比例粗估三大（v2.142）', () => {
  /* 晚餐每筆 500 卡：蛋白質 25 g（100 卡＝20%）、脂肪 20 g（180 卡＝36%）、碳水 55 g（220 卡＝44%） */
  const row = (eaten_on: string, meal: string, qty = 1) => ({ eaten_on, meal, qty, kcal: 500, protein: 25, fat: 20, carb: 55 })
  const dinners = [row('2026-11-10', 'dinner'), row('2026-11-11', 'dinner', 2), row('2026-11-12', 'dinner')]

  it('比例＝這一餐的三大熱量佔比（乘 qty 加總）；別餐的紀錄不算', () => {
    const r = mealMacroRatio([...dinners, { eaten_on: '2026-11-12', meal: 'lunch', qty: 1, kcal: 500, protein: 60, fat: 5, carb: 10 }], 'dinner')
    expect(r?.protein).toBeCloseTo(0.2, 10)
    expect(r?.fat).toBeCloseTo(0.36, 10)
    expect(r?.carb).toBeCloseTo(0.44, 10)
  })

  it('這一餐記不到 3 天、或總熱量 0 → null（退回只估熱量）', () => {
    expect(mealMacroRatio(dinners.slice(0, 2), 'dinner')).toBeNull()
    expect(mealMacroRatio([row('2026-11-10', 'dinner'), row('2026-11-10', 'dinner'), row('2026-11-10', 'dinner')], 'dinner')).toBeNull()
    expect(mealMacroRatio(dinners.map((d) => ({ ...d, kcal: 0 })), 'dinner')).toBeNull()
  })

  it('檔位 700 照比例：蛋白質 35、脂肪 28、碳水 77，標粗估不標只估熱量', () => {
    const d = draftFromTier('normal', { protein: 0.2, fat: 0.36, carb: 0.44 })
    expect(d).toMatchObject({ kcal: 700, protein: 35, fat: 28, carb: 77, kcalOnly: false, macrosGuessed: true })
    expect(d.origin).toEqual({ kcal: 700, protein: 35, fat: 28, carb: 77 })
  })

  it('自己打 500 卡照比例：25／20／55；改成 250 卡三大跟著減半', () => {
    const d = draftFromKcal(500, { protein: 0.2, fat: 0.36, carb: 0.44 })
    expect(d).toMatchObject({ protein: 25, fat: 20, carb: 55, macrosGuessed: true })
    expect(withKcalInput(d, '250')).toMatchObject({ kcal: 250, protein: 12.5, fat: 10, carb: 27.5 })
  })

  it('沒有比例：照舊三大記 0、標只估了熱量', () => {
    expect(draftFromTier('light', null)).toMatchObject({ kcal: 400, protein: 0, kcalOnly: true, macrosGuessed: false })
  })
})

describe('修正（spec A2 階段 1，v2.151）', () => {
  const ai = (o: Partial<Parameters<typeof draftsFromItems>[0][number]> = {}) =>
    draftsFromItems([{ name: '臭豆腐', kcal: 480, kcal_low: 380, kcal_high: 600, protein_g: 22, fat_g: 30, carb_g: 28, assumption: '炸臭豆腐 6 塊', ...o }], '  夜市臭豆腐、珍奶 ')[0]
  const fixed = { name: '臭豆腐', kcal: 400, kcal_low: 320, kcal_high: 500, protein_g: 18, fat_g: 25, carb_g: 23, assumption: '炸臭豆腐 5 塊' }

  it('AI 的列記下那句話（trim）與 AI 給的品名；檔位與自己打的沒有句子、不能修正', () => {
    const d = ai()
    expect(d.sentence).toBe('夜市臭豆腐、珍奶')
    expect(d.aiName).toBe('臭豆腐')
    expect(canFix(d)).toBe(true)
    expect(canFix(draftFromTier('normal'))).toBe(false)
    expect(canFix(draftFromKcal(500))).toBe(false)
    expect(canFix({ ...d, foodId: 9 }), '已建好食物的列鎖住').toBe(false)
    expect(canFix({ ...d, sentence: null })).toBe(false)
    // 手改到函式收不下的數字（熱量 > 3000、營養素 > 300 克）：送去會 400，不給修正
    expect(canFix({ ...d, kcal: 3001 })).toBe(false)
    expect(canFix({ ...d, kcal: 3000 })).toBe(true)
    expect(canFix({ ...d, protein: 301 })).toBe(false)
  })

  it('送出的估算照畫面上的數字；手改熱量到範圍外，範圍夾住它（不然函式那端驗 low ≤ kcal ≤ high 會 400）', () => {
    expect(fixRequestItem(ai())).toEqual({ name: '臭豆腐', kcal: 480, kcal_low: 380, kcal_high: 600, protein_g: 22, fat_g: 30, carb_g: 28, assumption: '炸臭豆腐 6 塊' })
    const up = withKcalInput(ai(), '700')
    expect(fixRequestItem(up)).toMatchObject({ kcal: 700, kcal_low: 380, kcal_high: 700 })
    const down = withKcalInput(ai(), '300')
    expect(fixRequestItem(down)).toMatchObject({ kcal: 300, kcal_low: 300, kcal_high: 600 })
  })

  it('套用：數字、範圍、假設換新，換算基準重設；key、勾選不變；記下修正字與次數', () => {
    const d = { ...ai(), keep: true }
    const n = applyFix(d, fixed, '  5 塊 ')
    expect(n).toMatchObject({ key: d.key, keep: true, kcal: 400, kcalDraft: '400', low: 320, high: 500, assumption: '炸臭豆腐 5 塊', fixedBy: '5 塊', fixCount: 1, sentence: '夜市臭豆腐、珍奶' })
    expect(n.origin).toEqual({ kcal: 400, protein: 18, fat: 25, carb: 23 })
    // 再修正一次：次數累加，換算基準照新的那組
    expect(applyFix(n, { ...fixed, kcal: 320, kcal_low: 260, kcal_high: 400 }, '4 塊').fixCount).toBe(2)
  })

  it('品名：沒改過就換成新的；使用者改過就保留他的', () => {
    expect(applyFix(ai(), { ...fixed, name: '炸臭豆腐' }, '5 塊').name).toBe('炸臭豆腐')
    expect(applyFix({ ...ai(), name: '阿宗臭豆腐' }, { ...fixed, name: '炸臭豆腐' }, '5 塊').name).toBe('阿宗臭豆腐')
    // 清空成空白＝沒改（用餐別頂替），換成新的
    expect(applyFix({ ...ai(), name: '' }, fixed, '5 塊').name).toBe('臭豆腐')
  })

  it('修正字：trim 後 1–100 碼位；小標超過 12 字截斷加…', () => {
    expect(fixTextOk('')).toBe(false)
    expect(fixTextOk('   ')).toBe(false)
    expect(fixTextOk('5 塊')).toBe(true)
    expect(fixTextOk('𠮷'.repeat(100))).toBe(true)
    expect(fixTextOk('x'.repeat(101))).toBe(false)
    expect(fixTag('5 塊')).toBe('5 塊')
    expect(fixTag('一二三四五六七八九十一二')).toBe('一二三四五六七八九十一二')
    expect(fixTag('一二三四五六七八九十一二三')).toBe('一二三四五六七八九十一二…')
  })
})
