/* AI 估完對食品庫（spec「食品庫改版」第二步；v2.167 起對上的在畫面上換成食品庫的那一樣，見 logMeal.aiLibItem）。比對本身在 foodMatch.test.ts。 */
import { describe, expect, it } from 'vitest'
import { canFix, matchedAlias, resolveAfterAi, type EstimateItem, type LibCandidate } from './estimate'

const food = (id: number, name: string, vendor: string | null, kcal: number, extra: Partial<LibCandidate> = {}): LibCandidate => ({
  id, name, vendor, aliases: [], verified: false, archived: false, kcal, ...extra,
})
const FOODS = [
  food(1, '油雞腿飯', '十八燒', 780),
  food(17, '茶葉蛋', '7-11', 70, { verified: true }),
  food(39, '薯條', '麥當勞', 346, { verified: true }),
  food(41, '雙牛堡', '麥當勞', 461),
]
const none = new Map<number, number>()
const item = (name: string, kcal: number): EstimateItem => ({ name, kcal, kcal_low: kcal - 50, kcal_high: kcal + 50, protein_g: 10, fat_g: 10, carb_g: 30, assumption: '一份' })

describe('靠「店家 品名」別名對上', () => {
  it('AI 回的是別名的品名段：記那個別名（品名＋店家）；回品名本身不算別名', () => {
    const tea = food(139, '手搖飲（無糖純茶＋寒天，大杯）', null, 60, { aliases: ['麻古 紅萱波波', '青山 菜燕春青'] })
    const [post] = resolveAfterAi([item('紅萱波波', 80)], '紅萱波波', [...FOODS, tea], none)
    expect(post.lib?.food.id).toBe(139)
    expect([post.lib?.alias?.item, post.lib?.alias?.vendor]).toEqual(['紅萱波波', '麻古'])
    const [byName] = resolveAfterAi([item('手搖飲（無糖純茶＋寒天，大杯）', 60)], '無糖寒天', [...FOODS, tea], none)
    expect(byName.lib?.alias).toBeNull()
    expect(matchedAlias('青山菜燕春青', tea)?.vendor).toBe('青山')
    expect(matchedAlias('紅萱波波', { ...tea, vendor: '麻古' })).toBeNull()
  })
  it('好幾家有同一個品名：整個別名對上就是那家；只對上品名時看店名＋那一段提到哪家，沒提或提了兩家就不猜（review #2）', () => {
    const tea = food(140, '手搖飲（無糖純茶＋珍珠，大杯）', null, 165, { aliases: ['50嵐 四季春青茶', '清心 四季春青茶', '麻古 紅萱波波'] })
    expect(matchedAlias('清心 四季春青茶', tea)?.vendor).toBe('清心')
    expect(matchedAlias('四季春青茶', tea, '清心 四季春青茶')?.vendor).toBe('清心')
    expect(matchedAlias('四季春青茶', tea, '四季春青茶')).toBeNull()
    expect(matchedAlias('四季春青茶', tea, '50嵐跟清心的四季春青茶')).toBeNull()
    expect(matchedAlias('紅萱波波', tea, '紅萱波波')?.vendor).toBe('麻古')
    // 店名不送 AI，但對食品庫時一起看（context）；草稿的 sentence 只留送去估的那段
    const [named] = resolveAfterAi([item('四季春青茶', 160)], '清心 四季春青茶', [...FOODS, tea], none, '四季春青茶')
    expect(named.lib?.alias?.vendor).toBe('清心')
    expect(named.sentence).toBe('四季春青茶')
  })
})

describe('AI 回來後', () => {
  it('品名完全一樣的標上食品庫那一筆；其餘照舊是 AI 的列、附相近提示', () => {
    const r = resolveAfterAi([item('雙牛堡', 520), item('十八燒雞腿飯', 720), item('臭豆腐', 480)], '麥當勞雙牛堡', FOODS, none)
    expect(r[0].lib?.food.id).toBe(41)
    expect(canFix(r[0])).toBe(false)
    expect(r[1].lib).toBeNull()
    expect(r[1].near?.id).toBe(1)
    expect(r[2].near).toBeNull()
  })
  it('AI 把店家拿掉的品名對到有店家的那筆、但沒提這個店家 → 不自動換，降成相近提示（review H1）', () => {
    const [d] = resolveAfterAi([item('薯條', 330)], '星巴克 薯條', FOODS, none, '薯條')
    expect(d.lib).toBeNull()
    expect(d.kcal).toBe(330)
    expect(d.near?.id).toBe(39)
    const [m] = resolveAfterAi([item('薯條', 330)], '麥當勞 薯條', FOODS, none, '薯條')
    expect(m.lib?.food.id).toBe(39)
  })
})
