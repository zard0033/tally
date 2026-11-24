/* 估一筆接上食品庫（spec「食品庫改版」第二步；v2.164 起每段各自估，整段對上食品庫的在 mealBox.test.ts）：estimate.ts 裡接上食品庫的那幾支。比對本身在 foodMatch.test.ts。 */
import { describe, expect, it } from 'vitest'
import {
  adoptNear,
  backToAi,
  canFix,
  draftsToIntake,
  estimateTotals,
  libShown,
  matchedAlias,
  resolveAfterAi,
  stepLibQty,
  withLibQty,
  type EstimateItem,
  type LibCandidate,
} from './estimate'

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

describe('靠「店家 品名」別名對上（AI 估完那一段）', () => {
  it('寫入時記那家；店家只認這一段寫的（v2.161 真機漏掉、v2.164 每段各自估）', () => {
    const tea = food(139, '手搖飲（無糖純茶＋寒天，大杯）', null, 60, { aliases: ['麻古 紅萱波波', '青山 菜燕春青'] })
    const [d] = resolveAfterAi([item('紅萱波波', 80)], '麻古 紅萱波波', [...FOODS, tea], none)
    expect(d.lib?.food.id).toBe(139)
    expect(d.sentence).toBe('麻古 紅萱波波')
    expect(draftsToIntake([d], 'breakfast', '2026-11-24', ['麻古', '青山'])[0].vendor).toBe('麻古')
  })
  it('顯示與寫入都用別名的品名與店家，跟清單勾別名列同一個結果（v2.162 AC 6）', () => {
    const tea = food(139, '手搖飲（無糖純茶＋寒天，大杯）', null, 60, { aliases: ['麻古 紅萱波波', '青山 菜燕春青'] })
    const [post] = resolveAfterAi([item('紅萱波波', 80)], '早上一杯紅萱波波', [...FOODS, tea], none)
    expect(post.lib?.food.id).toBe(139)
    expect([post.name, post.lib?.alias?.vendor]).toEqual(['紅萱波波', '麻古'])
    expect(libShown(post.lib!)).toEqual({ name: '紅萱波波', vendor: '麻古' })
    // 那一段沒有已知店家也照別名寫（不靠 vendorInSentence）
    expect(draftsToIntake([post], 'breakfast', '2026-11-24', [])[0]).toMatchObject({ food_id: 139, name: '紅萱波波', vendor: '麻古' })
    // AI 回的是品名本身：不算別名，照舊不寫品名
    const [byName] = resolveAfterAi([item('手搖飲（無糖純茶＋寒天，大杯）', 60)], '一杯無糖寒天', [...FOODS, tea], none)
    expect(byName.lib?.alias).toBeNull()
    expect(draftsToIntake([byName], 'breakfast', '2026-11-24', [])[0]).toMatchObject({ name: null })
    expect(matchedAlias('青山菜燕春青', tea)?.vendor).toBe('青山')
    expect(matchedAlias('紅萱波波', { ...tea, vendor: '麻古' })).toBeNull()
  })
  it('好幾家有同一個品名：整個別名對上就是那家；只對上品名時看那一段提到哪家，沒提或提了兩家就不猜（review #2）', () => {
    const tea = food(140, '手搖飲（無糖純茶＋珍珠，大杯）', null, 165, { aliases: ['50嵐 四季春青茶', '清心 四季春青茶', '麻古 紅萱波波'] })
    const foods = [...FOODS, tea]
    expect(matchedAlias('清心 四季春青茶', tea)?.vendor).toBe('清心')
    expect(matchedAlias('四季春青茶', tea, '下午在清心買了四季春青茶')?.vendor).toBe('清心')
    expect(matchedAlias('四季春青茶', tea, '一杯四季春青茶')).toBeNull()
    expect(matchedAlias('四季春青茶', tea, '50嵐跟清心的四季春青茶')).toBeNull()
    // 只有一家有的品名：沒提店家也是那家
    expect(matchedAlias('紅萱波波', tea, '一杯紅萱波波')?.vendor).toBe('麻古')
    const [named] = resolveAfterAi([item('四季春青茶', 160)], '下午在清心買了四季春青茶', foods, none)
    expect(draftsToIntake([named], 'snack', '2026-11-24', ['50嵐', '清心'])[0]).toMatchObject({ food_id: 140, name: '四季春青茶', vendor: '清心' })
    const [unnamed] = resolveAfterAi([item('四季春青茶', 160)], '一杯四季春青茶', foods, none)
    expect(unnamed.lib?.alias).toBeNull()
    const row = draftsToIntake([unnamed], 'snack', '2026-11-24', ['50嵐', '清心'])[0]
    expect(row).toMatchObject({ food_id: 140, name: null })
    expect(row).not.toHaveProperty('vendor')
  })
})

describe('② AI 回來後', () => {
  it('品名完全一樣的換成食品庫列、記住 AI 那一樣；其餘照舊是 AI 的列、附相近提示', () => {
    const r = resolveAfterAi([item('雙牛堡', 520), item('十八燒雞腿飯', 720), item('臭豆腐', 480)], '麥當勞雙牛堡、十八燒雞腿飯、臭豆腐', FOODS, none)
    expect(r[0].lib?.food.id).toBe(41)
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
  // AI 回「茶葉蛋」、那一段有提 7-11 → 換成 7-11 那一筆
  const [lib] = resolveAfterAi([item('茶葉蛋', 80)], '7-11 茶葉蛋', FOODS, none)
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
})
