/* 記店家（v2.162，spec「記店家改版」，樣張 _design-sample/vendor-directions.html 甲、vendor-and-edit.html 問題二 D）。
   v2.167（spec「記一筆重做」）起新的店家記在紀錄上（框裡打店名，見 log-sheet.spec.ts 故事二、三）；已經掛好的「店家 品名」別名照常：
   別名列長得跟有店家的食物一樣、勾了寫品名＋店家、最近記過接回那一樣、今日頁點開只露常用的。各條都自己 openApp、不共用狀態。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'
import { FIX } from './fixtures'

test.describe.configure({ mode: 'parallel' })

const TEA = { id: 40, name: '手搖飲（無糖純茶＋珍珠，大杯）', vendor: null, kcal: 165, protein: 0, fat: 0, carb: 41, category: '飲料', category_manual: false, verified: true, aliases: ['麻古 紅萱波波', '50嵐 四季春青茶（珍珠）'] }
const BENTO = { id: 41, name: '滷雞腿便當', vendor: null, kcal: 885, protein: 40, fat: 30, carb: 110, category: '便當', category_manual: false, verified: false, aliases: ['日光食堂 滷雞腿飯'] }

const VFIX = {
  ...FIX,
  foods: [...FIX.foods, TEA, BENTO],
  // 最近記過：晚餐在日光食堂吃過兩次滷雞腿飯（別名列）——常吃要接回那個別名列，不是通用便當本身
  history: [
    { meal: 'dinner', food_id: 41, qty: 1, mods: ['rice:half'], name: '滷雞腿飯', vendor: '日光食堂' },
    { meal: 'dinner', food_id: 41, qty: 1, mods: [], name: '滷雞腿飯', vendor: '日光食堂' },
    // 通用便當本身（沒記品名店家）上次沒調：照上次只該帶在日光食堂那一列
    { meal: 'lunch', food_id: 41, qty: 1, mods: [], name: null, vendor: null },
    ...FIX.history,
  ],
  intake: [
    ...FIX.intake,
    { id: 401, meal: 'dinner', qty: 1, kcal: 885, protein: 40, fat: 30, carb: 110, name: '滷雞腿飯', mods: [], vendor: '日光食堂', food_id: 41, foods: { name: '滷雞腿便當', vendor: null, category: '便當' } },
    { id: 402, meal: 'dinner', qty: 1, kcal: 165, protein: 0, fat: 0, carb: 41, name: null, mods: [], vendor: null, food_id: 40, foods: { name: TEA.name, vendor: null, category: '飲料' } },
  ],
} as unknown as typeof FIX

interface W {
  __writes: { table: string; method: string; body: unknown }[]
}
const writes = (page: Page, table: string, method: string) =>
  page.evaluate(({ t, m }) => (window as unknown as W).__writes.filter((w) => w.table === t && w.method === m).map((w) => w.body), { t: table, m: method })
const intakeRows = async (page: Page) => (await writes(page, 'intake', 'POST')).flat() as Record<string, unknown>[]

async function openMeal(page: Page, meal = '晚餐') {
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  await page.locator('.chip', { hasText: meal }).click()
}
const search = (page: Page, q: string) => page.fill('input[aria-label="找食物"]', q)
/** 找東西的列：品名全等（v2.167 起清單只有這一種列） */
const listRow = (page: Page, name: string) =>
  page.locator('.find-row:not([data-key="combo"])', { has: page.locator('.fr-name', { hasText: new RegExp(`^${name.replace(/[()（）+＋]/g, '\\$&')}$`) }) })

test('記一筆：搜「麻古」出「紅萱波波 · 麻古」一列（v2.162 的別名照常），勾了寫 name＋vendor、沒有店家欄（AC 1）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page)
  await search(page, '麻古')
  const row = listRow(page, '紅萱波波')
  await expect(row.locator('.fr-vd')).toHaveText('麻古')
  // 通用食物自己那列不跟著冒出來
  await expect(listRow(page, TEA.name)).toHaveCount(0)
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  const picked = page.locator('.meal-rows > li').first()
  await expect(picked.locator('.mr-nm')).toHaveText('紅萱波波麻古')
  await expect(page.getByRole('combobox', { name: '店家' }), '記一筆不該再有店家欄').toHaveCount(0)
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  expect((await intakeRows(page))[0]).toMatchObject({ food_id: 40, name: '紅萱波波', vendor: '麻古' })
})

test('記一筆：同一筆通用食物的兩個別名列都加，寫兩筆、各自品名店家與份量（AC 2）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page)
  await search(page, '紅萱')
  await listRow(page, '紅萱波波').click()
  await search(page, '四季春')
  await listRow(page, '四季春青茶（珍珠）').click()
  const second = page.locator('.meal-rows > li').nth(1)
  await second.locator('.mr-head').click()
  await second.getByRole('button', { name: /增加/ }).click()
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(2)
  const rows = await intakeRows(page)
  expect(rows.map((r) => [r.food_id, r.name, r.vendor, r.qty])).toEqual([
    [40, '紅萱波波', '麻古', 1],
    [40, '四季春青茶（珍珠）', '50嵐', 2],
  ])
})

test('記一筆：通用食物自己那列搜品名才出（v2.167 拿掉「通用（說不出哪家）」段），勾了不寫 name、vendor（AC 3）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page, '早餐')
  await expect(page.getByText('通用（說不出哪家）')).toHaveCount(0)
  await search(page, TEA.name)
  await listRow(page, TEA.name).click()
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  const r = (await intakeRows(page))[0]
  expect(r).toMatchObject({ food_id: 40, name: null })
  expect(r).not.toHaveProperty('vendor')
})

test('記一筆：最近記過「滷雞腿飯 · 日光食堂」→ 常吃出的是那一樣、帶上次的半飯；通用便當本身不帶（AC 4）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page)
  await expect(page.locator('.food-scroll h3.sect-lb', { hasText: '晚餐常吃' })).toHaveCount(1)
  const alias = listRow(page, '滷雞腿飯')
  await expect(alias.locator('.fr-vd')).toHaveText('日光食堂')
  await expect(alias.locator('.fr-sub')).toContainText('上次 半飯')
  await expect(listRow(page, BENTO.name)).toHaveCount(0)
  await alias.click()
  const picked = page.locator('.meal-rows > li').first()
  await picked.locator('.mr-head').click()
  await expect(picked.locator('.pmods-sum')).toContainText('半飯')
  await search(page, '滷雞腿便當')
  await listRow(page, BENTO.name).click()
  const generic = page.locator('.meal-rows > li').nth(1)
  await generic.locator('.mr-head').click()
  await expect(generic.locator('.pmods-sum')).toContainText('正常飯量')
})

test('記一筆：有店家的食物照舊——列上灰字是自己的店家，沒打店名就不寫 name、vendor；今日頁補店家第二行（AC 9）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  // fixture 有兩家的雞胸餐盒（健康盒 id 11、減醣廚房 id 12）；今日頁午餐那筆是健康盒的
  await expect(page.locator('.item[data-row="102"] .vendor')).toHaveText('健康盒')
  await openMeal(page)
  await search(page, '雞胸餐盒')
  const row = listRow(page, '雞胸餐盒').filter({ has: page.locator('.fr-vd', { hasText: '減醣廚房' }) })
  await row.click()
  await expect(page.locator('.meal-rows .mr-vd')).toHaveText('減醣廚房')
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  const r = (await intakeRows(page))[0]
  expect(r).toMatchObject({ food_id: 12, name: null })
  expect(r).not.toHaveProperty('vendor')
})

test('今日頁：別名列記的顯示品名＋店家；點開只露份量、刪除、微調與「改餐別、品名、營養」，點了才出欄位（AC 5）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  const ROW = '.item[data-row="401"]'
  await expect(page.locator(`${ROW} .nm`)).toHaveText('滷雞腿飯')
  await expect(page.locator(`${ROW} .vendor`)).toHaveText('日光食堂')
  await page.locator(`${ROW} .item-content`).click()
  const ed = page.locator(`${ROW} .item-editor`)
  await expect(ed.locator('.ed-del')).toHaveCount(1)
  await expect(ed.locator('.pmods-sum')).toHaveText(/^正常飯量/)
  const more = ed.getByRole('button', { name: /改餐別、品名、營養/ })
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(more).toContainText('晚餐 · 885 卡')
  await expect(ed.locator('.seg button', { hasText: '早餐' })).toHaveCount(0)
  await expect(ed.locator('input')).toHaveCount(1) // 只有份量框
  await expect(ed.getByRole('combobox', { name: '店家' })).toHaveCount(0)
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(ed.getByRole('group', { name: '餐別' })).toBeVisible()
  await expect(ed.getByLabel('品名')).toHaveValue('滷雞腿飯')
  await expect(ed.getByLabel('熱量（卡）')).toHaveValue('885')
})
