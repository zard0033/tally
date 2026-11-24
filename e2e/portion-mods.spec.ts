/* 份量微調（spec「份量微調＋類型壓縮…」，樣張 _design-sample/portion-mods.html B）＋記一筆的「對到：別名」。
   規則與數字由 src/lib/portionMods.test.ts 釘；這裡驗畫面接線：摘要行、展開控件、照上次、寫進 intake 的快照與 mods、
   今日頁就地編輯重算、食品庫不被動到。各條都自己 openApp、不共用狀態。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp, openEditMore } from './harness'
import { FIX } from './fixtures'

test.describe.configure({ mode: 'parallel' })

const TEA = { id: 40, name: '手搖飲（無糖純茶＋珍珠，大杯）', vendor: null, kcal: 165, protein: 0, fat: 0, carb: 41, category: '飲料', category_manual: false, verified: true, aliases: ['紅萱波波', '麻古 紅萱波波'] }
const BENTO = { id: 41, name: '排骨便當（滷）', vendor: null, kcal: 858, protein: 33.8, fat: 25.8, carb: 119.5, category: '便當', category_manual: false, verified: false, aliases: [] }

const MODS_FIX = {
  ...FIX,
  foods: [...FIX.foods, TEA, BENTO],
  // 排骨便當上一次是半飯 → 記一筆勾它時預設帶半飯、標「照上次」
  history: [{ meal: 'dinner', food_id: 41, qty: 1, mods: ['rice:half'] }, ...FIX.history],
  intake: [
    ...FIX.intake,
    { id: 301, meal: 'dinner', qty: 1, kcal: 629.3, protein: 29.9, fat: 25.4, carb: 68.3, name: null, mods: ['rice:half'], food_id: 41, foods: { name: '排骨便當（滷）', vendor: null, category: '便當' } },
  ],
} as unknown as typeof FIX

interface W {
  __writes: { table: string; method: string; body: unknown }[]
}
const writes = (page: Page, table: string, method: string) =>
  page.evaluate(({ t, m }) => (window as unknown as W).__writes.filter((w) => w.table === t && w.method === m).map((w) => w.body), { t: table, m: method })
const intakeRows = async (page: Page) => (await writes(page, 'intake', 'POST')).flat() as Record<string, unknown>[]

async function openDinner(page: Page) {
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  await page.locator('.chip', { hasText: '晚餐' }).click()
}
async function search(page: Page, q: string) {
  await page.fill('input[aria-label="吃了什麼"]', q)
}
const pickedRow = (page: Page, name: string) => page.locator('.food-item.selected', { has: page.locator('.nm', { hasText: name }) })

test('記一筆：搜到沒有店家段的舊式別名，副標寫「對到：紅萱波波」、對上的字標主色；「店家 品名」別名自己是一列（v2.162）', async ({ page }) => {
  await openApp(page, {}, MODS_FIX)
  await openDinner(page)
  await search(page, '紅萱')
  const row = page.locator('.food-row', { has: page.locator('.nm', { hasText: TEA.name }) })
  await expect(row.locator('.sub')).toHaveText('對到：紅萱波波')
  await expect(row.locator('.sub mark')).toHaveText('紅萱')
  await expect(row).toHaveAttribute('aria-label', /對到 紅萱波波/)
  // 「麻古 紅萱波波」是別名列：品名＋店家，不寫「對到」
  const aliasRow = page.locator('.food-row', { has: page.locator('.nm', { hasText: /^紅萱波波$/ }) })
  await expect(aliasRow.locator('.sub')).toHaveText('麻古')
  // 品名本身對上的不寫「對到」
  await search(page, '手搖飲')
  await expect(row.locator('.sub')).toHaveCount(0)
})

test('記一筆：飲料按中杯＋微糖，寫入調整後的單份快照與 mods；摘要與算式跟著變', async ({ page }) => {
  await openApp(page, {}, MODS_FIX)
  await openDinner(page)
  await search(page, '紅萱')
  await page.locator('.food-row', { has: page.locator('.nm', { hasText: TEA.name }) }).click()
  const row = pickedRow(page, TEA.name)
  const sum = row.locator('.pmods-sum')
  await expect(sum).toHaveText(/大杯・無糖/)
  await expect(sum).toHaveAttribute('aria-expanded', 'false')
  await sum.click()
  await expect(sum).toHaveAttribute('aria-expanded', 'true')
  await row.locator('.seg[aria-label^="杯型"] button', { hasText: '中杯' }).click()
  await row.locator('.seg[aria-label^="甜度"] button', { hasText: '微' }).click()
  await expect(sum).toHaveText(/中杯・微糖/)
  await expect(row.locator('.pmods-calc')).toHaveText('165 × 0.7 ＋ 微糖 11 g ＝ 160 卡')
  // 確認列的小計用調整後的值
  await expect(page.locator('.pick-line .sub')).toContainText('160 卡')
  await page.locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  expect((await intakeRows(page))[0]).toMatchObject({ food_id: 40, kcal: 159.6, protein: 0, fat: 0, carb: 39.7, mods: ['cup:m', 'sweet:slight'], name: null })
  expect(await writes(page, 'foods', 'PATCH'), '食品庫被動到了').toHaveLength(0)
})

test('記一筆：配料可複選、不隨中杯縮；按回「大杯」「無糖」就是沒調', async ({ page }) => {
  await openApp(page, {}, MODS_FIX)
  await openDinner(page)
  await search(page, '紅萱')
  await page.locator('.food-row', { has: page.locator('.nm', { hasText: TEA.name }) }).click()
  const row = pickedRow(page, TEA.name)
  await row.locator('.pmods-sum').click()
  await row.locator('.pmods-chip', { hasText: '寒天' }).click()
  await row.locator('.pmods-chip', { hasText: '椰果' }).click()
  await expect(row.locator('.pmods-chip[aria-pressed="true"]')).toHaveText(['寒天', '椰果'])
  await expect(row.locator('.pmods-sum')).toHaveText(/大杯・無糖・＋寒天・＋椰果/)
  await row.locator('.seg[aria-label^="杯型"] button', { hasText: '中杯' }).click()
  // 165 × 0.7 ＋ 寒天 60 ＋ 椰果 90
  await expect(row.locator('.pmods-calc')).toHaveText('165 × 0.7 ＋ 寒天 60 ＋ 椰果 90 ＝ 266 卡')
  await row.locator('.seg[aria-label^="杯型"] button', { hasText: '大杯' }).click()
  await row.locator('.pmods-chip', { hasText: '寒天' }).click()
  await row.locator('.pmods-chip', { hasText: '椰果' }).click()
  await expect(row.locator('.pmods-calc')).toHaveCount(0)
  await page.locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  expect((await intakeRows(page))[0]).toMatchObject({ kcal: 165 })
  expect((await intakeRows(page))[0], '沒調不帶 mods（DB 預設空陣列，跟其他寫入路徑同形狀）').not.toHaveProperty('mods')
})

test('記一筆：照上次——便當上次半飯，勾起來預設半飯、標「照上次」；自己改了就不再標', async ({ page }) => {
  await openApp(page, {}, MODS_FIX)
  await openDinner(page)
  await search(page, '排骨')
  await page.locator('.food-row', { has: page.locator('.nm', { hasText: BENTO.name }) }).click()
  const row = pickedRow(page, BENTO.name)
  await expect(row.locator('.pmods-sum')).toHaveText(/半飯/)
  await expect(row.locator('.pmods-last')).toHaveText('· 照上次')
  await row.locator('.pmods-sum').click()
  await expect(row.locator('.seg[aria-label^="飯量"] button[aria-pressed="true"]')).toHaveText('半飯')
  await expect(row.locator('.pmods-calc')).toHaveText('858 − 半飯 229 ＝ 629 卡')
  await row.locator('.seg[aria-label^="飯量"] button', { hasText: '少飯' }).click()
  await expect(row.locator('.pmods-last')).toHaveCount(0)
  await row.locator('.seg[aria-label^="飯量"] button', { hasText: '半飯' }).click()
  await page.locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  expect((await intakeRows(page))[0]).toMatchObject({ food_id: 41, kcal: 629.3, carb: 68.3, mods: ['rice:half'] })
})

test('記一筆：健康餐盒加主菜可複選（＋雞胸＋蛋），寫入加上去的單份與 mods；沒有適用微調的（蛋白質補充）不出摘要行', async ({ page }) => {
  await openApp(page, {}, MODS_FIX)
  await openDinner(page)
  await search(page, '雞胸')
  await page.locator('.food-row', { has: page.locator('.sub', { hasText: '健康盒' }) }).click()
  const row = pickedRow(page, '雞胸餐盒')
  const sum = row.locator('.pmods-sum')
  await expect(sum).toHaveText(/沒加主菜/)
  await sum.click()
  const chips = row.locator('.pmods-chips[aria-label^="加主菜"]')
  await expect(chips.locator('.pmods-chip')).toHaveText(['雞胸', '雞腿', '牛肉', '豬肉', '鮭魚', '鯛魚', '蛋'])
  await chips.locator('.pmods-chip', { hasText: '雞胸' }).click()
  await chips.locator('.pmods-chip', { hasText: '蛋' }).click()
  await expect(chips.locator('.pmods-chip', { hasText: '雞胸' })).toHaveAttribute('aria-pressed', 'true')
  await expect(sum).toHaveText(/＋雞胸・＋蛋/)
  await expect(row.locator('.pmods-calc')).toHaveText('420 ＋ 雞胸 117 ＋ 蛋 79 ＝ 616 卡')
  await page.locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  // 420／45／12／30 ＋ 雞胸 117／23.3／1.9／0.6 ＋ 蛋 79／7.7／5.1／0.9
  expect((await intakeRows(page))[0]).toMatchObject({ food_id: 11, kcal: 616, protein: 76, fat: 19, carb: 31.5, mods: ['main:chicken', 'main:egg'], name: null })
  expect(await writes(page, 'foods', 'PATCH'), '食品庫被動到了').toHaveLength(0)
})

test('記一筆：沒有適用微調的食物（蛋白質補充）不出摘要行', async ({ page }) => {
  await openApp(page, {}, MODS_FIX)
  await openDinner(page)
  await search(page, '乳清')
  await page.locator('.food-row', { has: page.locator('.nm', { hasText: '乳清（1匙）' }) }).click()
  await expect(pickedRow(page, '乳清（1匙）')).toHaveCount(1)
  await expect(pickedRow(page, '乳清（1匙）').locator('.pmods')).toHaveCount(0)
})

test('今日頁：調過的紀錄品名後接「（半飯）」；就地編輯改回正常飯量，用食品庫現在的數字重算、一次送 mods 與四個值', async ({ page }) => {
  await openApp(page, {}, MODS_FIX)
  const ROW = '.item[data-row="301"]'
  await expect(page.locator(`${ROW} .nm`)).toContainText('排骨便當（滷）（半飯）')
  await page.locator(`${ROW} .item-content`).click()
  const ed = page.locator(`${ROW} .item-editor`)
  await expect(ed).toBeVisible()
  // 就地編輯的品名欄是原名，不帶後綴（沒改就關不會把後綴存成品名）；品名收在「改餐別、品名、營養」裡（v2.162）
  await openEditMore(page, ROW)
  await expect(ed.locator('.ed-detail input').first()).toHaveValue('排骨便當（滷）')
  await ed.locator('.pmods-sum').click()
  await expect(ed.locator('.pmods-calc').first()).toHaveText('用食品庫現在的數字重算')
  await ed.locator('.seg[aria-label^="飯量"] button', { hasText: '正常' }).click()
  await expect.poll(async () => (await writes(page, 'intake', 'PATCH')).length).toBe(1)
  expect((await writes(page, 'intake', 'PATCH'))[0]).toEqual({ mods: [], kcal: 858, protein: 33.8, fat: 25.8, carb: 119.5 })
  await expect(page.locator(`${ROW} .nm`)).not.toContainText('（半飯）')
  expect(await writes(page, 'foods', 'PATCH'), '食品庫被動到了').toHaveLength(0)
})
