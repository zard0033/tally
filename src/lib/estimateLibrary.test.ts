/* 估一筆先查食品庫（spec「食品庫改版」第二步）：estimate.ts 裡接上食品庫的那幾支。比對本身在 foodMatch.test.ts。 */
import { describe, expect, it } from 'vitest'
import {
  adoptNear,
  aiDraftsChosen,
  backToAi,
  canFix,
  draftsFromItems,
  draftsToIntake,
  estimateTotals,
  libSummary,
  resolveAfterAi,
  resolveBeforeAi,
  stepLibQty,
  withLibQty,
  type EstimateItem,
  type LibCandidate,
} from './estimate'
import { splitSegments } from './foodMatch'

const food = (id: number, name: string, vendor: string | null, kcal: number, extra: Partial<LibCandidate> = {}): LibCandidate => ({
  id, name, vendor, aliases: [], verified: false, archived: false, kcal, protein: 10, fat: 5, carb: 20, ...extra,
})
const FOODS = [
  food(1, '油雞腿飯', '十八燒', 780),
  food(17, '茶葉蛋', '7-11', 70, { verified: true, protein: 7, fat: 4.5, carb: 1 }),
  food(39, '薯條', '麥當勞', 346, { verified: true }),
  food(41, '雙牛堡', '麥當勞', 461),
]
const none = new Map<number, number>()
const item = (name: string, kcal: number): EstimateItem => ({ name, kcal, kcal_low: kcal - 50, kcal_high: kcal + 50, protein_g: 10, fat_g: 10, carb_g: 30, assumption: '一份' })

describe('① 送 AI 之前', () => {
  it('每一段都完全對上 → 全部是食品庫列（pre、份量 1、數字＝那一筆）', () => {
    const r = resolveBeforeAi(['十八燒油雞腿飯', '茶葉蛋'], FOODS, none)
    expect(r?.map((d) => [d.lib?.food.id, d.lib?.via, d.lib?.qty, d.kcal])).toEqual([[1, 'pre', 1, 780], [17, 'pre', 1, 70]])
  })
  it('對上通用食物的「店家 品名」別名 → 寫入時記那家；店家只算那一段，不擴到同句其他段（v2.161 真機漏掉）', () => {
    const tea = food(139, '手搖飲（無糖純茶＋寒天，大杯）', null, 60, { aliases: ['麻古 紅萱波波', '青山 菜燕春青'] })
    const egg = food(135, '滷蛋', null, 75)
    const r = resolveBeforeAi(splitSegments('麻古 紅萱波波、滷蛋'), [...FOODS, tea, egg], none) // 走真的切段：空白不能被切掉
    expect(r?.map((d) => d.lib?.food.id)).toEqual([139, 135])
    const rows = draftsToIntake(r ?? [], 'breakfast', '2026-11-24', ['麻古', '青山'])
    expect(rows[0].vendor).toBe('麻古')
    expect(rows[1]).not.toHaveProperty('vendor') // 滷蛋那段沒提店家
  })
  it('有一段對不上 → null（整句送 AI）；空句子也是 null', () => {
    expect(resolveBeforeAi(['十八燒油雞腿飯', '夜市臭豆腐'], FOODS, none)).toBeNull()
    expect(resolveBeforeAi([], FOODS, none)).toBeNull()
  })
})

describe('② AI 回來後', () => {
  it('品名完全一樣的換成食品庫列、記住 AI 那一樣；其餘照舊是 AI 的列、附相近提示', () => {
    const r = resolveAfterAi([item('雙牛堡', 520), item('十八燒雞腿飯', 720), item('臭豆腐', 480)], '麥當勞雙牛堡、十八燒雞腿飯、臭豆腐', FOODS, none)
    expect(r[0].lib?.food.id).toBe(41)
    expect(r[0].lib?.via).toBe('post')
    expect(r[0].lib?.ai?.kcal).toBe(520)
    expect(r[0].kcal).toBe(461) // AI 的份數與熱量不搬過來
    expect(r[1].lib).toBeNull()
    expect(r[1].near?.id).toBe(1)
    expect(r[2].near).toBeNull()
  })
  it('AI 把店家拿掉的品名對到有店家的那筆、但句子裡沒提這個店家 → 不自動換，降成相近提示（review H1）', () => {
    // 使用者打星巴克，食品庫只有麥當勞的；AI 回「薯條」→ 不能靜默換成麥當勞薯條
    const [d] = resolveAfterAi([item('薯條', 330)], '星巴克薯條', FOODS, none)
    expect(d.lib).toBeNull()
    expect(d.kcal).toBe(330)
    expect(d.near?.id).toBe(39)
    // 句子裡有這個店家就照舊自動換
    const [m] = resolveAfterAi([item('薯條', 330)], '麥當勞薯條加大', FOODS, none)
    expect(m.lib?.food.id).toBe(39)
  })
})

describe('食品庫列', () => {
  const [lib] = resolveBeforeAi(['茶葉蛋'], FOODS, none) as ReturnType<typeof draftsFromItems>
  it('換份數：熱量取整、營養素到 0.1；−／＋ 照 normalizeQty', () => {
    const two = withLibQty(lib, 2)
    expect([two.kcal, two.protein, two.fat, two.carb, two.lib?.qty]).toEqual([140, 14, 9, 2, 2])
    expect(stepLibQty(two, -1).lib?.qty).toBe(1)
    expect(stepLibQty(lib, 1).kcal).toBe(140)
  })
  it('不能修正（沒有假設可改）', () => {
    expect(canFix(lib)).toBe(false)
  })
  it('寫 intake：用那一筆的 food_id、份數，快照是單份值；不需要先建食物', () => {
    const rows = draftsToIntake([withLibQty(lib, 2)], 'lunch', '2026-11-23')
    expect(rows).toEqual([{ eaten_on: '2026-11-23', meal: 'lunch', food_id: 17, qty: 2, kcal: 70, protein: 7, fat: 4.5, carb: 1, name: null }])
  })
  it('小計算的是份數 × 單份', () => {
    expect(estimateTotals([withLibQty(lib, 3)]).kcal).toBe(210)
  })
})

describe('改用與改用 AI 估', () => {
  it('相近的「改用」：AI 的列換成食品庫列（key 不變），「改用 AI 估」換回原本的估算、之後不再提示', () => {
    const [ai] = resolveAfterAi([item('十八燒雞腿飯', 720)], '十八燒雞腿飯', FOODS, none)
    const lib = adoptNear(ai, FOODS[0])
    expect(lib.key).toBe(ai.key)
    expect(lib.lib?.food.id).toBe(1)
    const back = backToAi(lib)
    expect(back.key).toBe(ai.key)
    expect(back.lib).toBeNull()
    expect(back.kcal).toBe(720)
    expect(back.noLib).toBe(true)
    expect(back.sentence).toBe('十八燒雞腿飯')
  })
  it('pre 的列沒有 AI 結果：backToAi 原樣回傳（呼叫端要先去估）；估回來的列標「選過 AI」', () => {
    const [pre] = resolveBeforeAi(['茶葉蛋'], FOODS, none) as ReturnType<typeof draftsFromItems>
    expect(backToAi(pre)).toBe(pre)
    expect(aiDraftsChosen([item('茶葉蛋', 80)], '茶葉蛋').every((d) => d.noLib && d.lib === null)).toBe(true)
  })
})

describe('結果上面那一行', () => {
  it('都是送 AI 前對上的＝沒叫 AI；有 AI 的列＝N 樣用食品庫、M 樣 AI 估；沒有食品庫列不出', () => {
    const pre = resolveBeforeAi(['十八燒油雞腿飯', '茶葉蛋'], FOODS, none) ?? []
    expect(libSummary(pre)).toBe('2 樣都在食品庫，沒叫 AI')
    const post = resolveAfterAi([item('雙牛堡', 520), item('薯條', 330), item('臭豆腐', 480)], '麥當勞雙牛堡、薯條、臭豆腐', FOODS, none)
    expect(libSummary(post)).toBe('2 樣用食品庫、1 樣 AI 估')
    expect(libSummary(draftsFromItems([item('臭豆腐', 480)]))).toBeNull()
  })
})
