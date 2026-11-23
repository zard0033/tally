/* 每一餐記店家（spec「每一餐記店家＋別名收一次」，樣張 _design-sample/meal-vendor.html S1＋T-A）。
   規則由 src/lib/mealVendor.test.ts 釘；這裡驗畫面接線：記一筆自動帶／手填店家、寫進 intake.vendor、
   有店家的食物不出欄位、今日頁店家第二行、就地編輯改店家只動那一筆。各條都自己 openApp、不共用狀態。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'
import { FIX } from './fixtures'

test.describe.configure({ mode: 'parallel' })

const TEA = { id: 40, name: '手搖飲（無糖純茶＋珍珠，大杯）', vendor: null, kcal: 165, protein: 0, fat: 0, carb: 41, category: '飲料', category_manual: false, verified: true, aliases: ['麻古 紅萱波波', '50嵐 四季春青茶（珍珠）'] }
const BENTO = { id: 41, name: '滷雞腿便當', vendor: null, kcal: 885, protein: 40, fat: 30, carb: 110, category: '便當', category_manual: false, verified: false, aliases: ['日光食堂 滷雞腿飯'] }

const VFIX = {
  ...FIX,
  foods: [...FIX.foods, TEA, BENTO],
  intake: [
    ...FIX.intake,
    { id: 401, meal: 'dinner', qty: 1, kcal: 885, protein: 40, fat: 30, carb: 110, name: null, mods: [], vendor: '日光食堂', food_id: 41, foods: { name: '滷雞腿便當', vendor: null, category: '便當' } },
    { id: 402, meal: 'dinner', qty: 1, kcal: 165, protein: 0, fat: 0, carb: 41, name: null, mods: [], vendor: null, food_id: 40, foods: { name: TEA.name, vendor: null, category: '飲料' } },
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
const search = (page: Page, q: string) => page.fill('input[aria-label="搜尋食物"]', q)
const rowOf = (page: Page, name: string) => page.locator('.food-row', { has: page.locator('.nm', { hasText: name }) })
const pickedRow = (page: Page, name: string) => page.locator('.food-item.selected', { has: page.locator('.nm', { hasText: name }) })

test('記一筆：搜「麻古」勾通用飲料，摘要接「・麻古」、寫入 vendor＝麻古（AC 1）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openDinner(page)
  await search(page, '麻古')
  await rowOf(page, TEA.name).click()
  const row = pickedRow(page, TEA.name)
  await expect(row.locator('.pmods-sum')).toContainText('大杯・無糖・麻古')
  await page.locator('.pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  expect((await intakeRows(page))[0]).toMatchObject({ food_id: 40, vendor: '麻古' })
})

test('記一筆：搜品名本身（不經別名）不帶店家，摘要寫「＋店家」；展開填店家後寫入（AC 3）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openDinner(page)
  await search(page, '滷雞腿')
  await rowOf(page, BENTO.name).click()
  const row = pickedRow(page, BENTO.name)
  const sum = row.locator('.pmods-sum')
  await expect(sum).toContainText('正常飯量・＋店家')
  await sum.click()
  const input = row.getByRole('combobox', { name: '店家' })
  await expect(input).toHaveValue('')
  await input.fill('日光食堂')
  await expect(sum).toContainText('正常飯量・日光食堂')
  await input.blur()
  await page.locator('.pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  expect((await intakeRows(page))[0]).toMatchObject({ food_id: 41, vendor: '日光食堂' })
})

test('記一筆：有店家的食物、通用的主食都不出店家欄，寫入不帶 vendor（AC 4、5）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openDinner(page)
  await search(page, '減醣')
  await rowOf(page, '雞胸餐盒').click()
  await search(page, '地瓜')
  await rowOf(page, '地瓜').click()
  await search(page, '')
  await expect(page.locator('.food-item.selected')).toHaveCount(2)
  await expect(page.locator('.food-item.selected .pmods-vendor, .food-item.selected .pmods-sum:has-text("店家")')).toHaveCount(0)
  await page.locator('.pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(2)
  for (const r of await intakeRows(page)) expect(r).not.toHaveProperty('vendor')
})

test('今日頁：有店家的列都在品名下補一行店家；通用食物寫這一筆記的那家（T-A）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await expect(page.locator('.item[data-row="401"] .vendor')).toHaveText('日光食堂')
  await expect(page.locator('.item[data-row="401"] .nm')).toHaveText('滷雞腿便當')
  await expect(page.locator('.item[data-row="402"] .vendor')).toHaveCount(0)
  // 有店家的食物（fixture 的午餐雞胸餐盒）也補
  const lunchWithVendor = page.locator('.item .vendor')
  expect(await lunchWithVendor.count()).toBeGreaterThan(1)
})

test('今日頁就地編輯：通用飲料填店家，離開欄位存，只 PATCH 那一筆的 vendor（AC 8）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  const ROW = '.item[data-row="402"]'
  await page.locator(`${ROW} .item-content`).click()
  const ed = page.locator(`${ROW} .item-editor`)
  await expect(ed.locator('.pmods-sum')).toContainText('大杯・無糖・＋店家')
  await ed.locator('.pmods-sum').click()
  const input = ed.getByRole('combobox', { name: '店家' })
  await input.fill('麻古')
  await input.blur()
  await expect.poll(async () => (await writes(page, 'intake', 'PATCH')).length).toBe(1)
  expect((await writes(page, 'intake', 'PATCH'))[0]).toEqual({ vendor: '麻古' })
  expect(await writes(page, 'foods', 'PATCH'), '食品庫被動到了').toHaveLength(0)
  await expect(page.locator(`${ROW} .vendor`)).toHaveText('麻古')
})

test('今日頁就地編輯：估一筆帶了店家的列（類型不在範圍）照樣改得掉；封存的食物只出店家、不出微調（review #1 #2）', async ({ page }) => {
  const fix = {
    ...VFIX,
    intake: [
      ...VFIX.intake,
      { id: 403, meal: 'snack', qty: 1, kcal: 130, protein: 2, fat: 0.2, carb: 31, name: null, mods: [], vendor: '全聯', food_id: 14, foods: { name: '地瓜', vendor: null, category: '主食' } },
      { id: 404, meal: 'snack', qty: 1, kcal: 808, protein: 40, fat: 30, carb: 90, name: null, mods: [], vendor: null, food_id: 99, foods: { name: '炸雞腿便當', vendor: null, category: '便當' } },
    ],
  } as unknown as typeof FIX
  await openApp(page, {}, fix)
  await page.locator('.item[data-row="403"] .item-content').click()
  const ed = page.locator('.item[data-row="403"] .item-editor')
  await expect(ed.locator('.pmods-sum')).toHaveText(/^全聯/)
  await ed.locator('.pmods-sum').click()
  const input = ed.getByRole('combobox', { name: '店家' })
  await input.fill('')
  await input.blur()
  await expect.poll(async () => (await writes(page, 'intake', 'PATCH')).length).toBe(1)
  expect((await writes(page, 'intake', 'PATCH'))[0]).toEqual({ vendor: null })

  await page.locator('.item[data-row="404"] .item-content').click()
  const ed2 = page.locator('.item[data-row="404"] .item-editor')
  await expect(ed2.locator('.pmods-sum')).toHaveText(/^＋店家/)
  await ed2.locator('.pmods-sum').click()
  await expect(ed2.locator('.pmods-panel .seg')).toHaveCount(0)
})
