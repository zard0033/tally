/* 記店家（v2.162，spec「記店家改版」，樣張 _design-sample/vendor-directions.html 甲、vendor-and-edit.html 問題二 D）。
   規則由 src/lib/listRows.test.ts、mealVendor.test.ts 釘；這裡驗畫面接線：別名列長得跟有店家的食物一樣、勾了寫品名＋店家、
   通用食物自己那列在最下面、最近記過接回別名列、新店卡、今日頁點開只露常用的。各條都自己 openApp、不共用狀態。 */
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
const search = (page: Page, q: string) => page.fill('input[aria-label="吃了什麼"]', q)
/** 清單上一列：品名（.nm 全等）＋副標（店家） */
const listRow = (page: Page, name: string) => page.locator('.food-item', { has: page.locator('.nm', { hasText: new RegExp(`^${name.replace(/[()（）+＋]/g, '\\$&')}$`) }) })

test('記一筆：搜「麻古」出「紅萱波波 · 麻古」一列，勾了寫 name＋vendor、沒有店家欄（AC 1）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page)
  await search(page, '麻古')
  const row = listRow(page, '紅萱波波')
  await expect(row.locator('.sub')).toHaveText('麻古')
  // 通用食物自己那列不跟著冒出來
  await expect(listRow(page, TEA.name)).toHaveCount(0)
  await row.locator('.food-row').click()
  await expect(row).toHaveClass(/selected/)
  await expect(row.locator('.nm')).toHaveText('紅萱波波')
  await expect(row.locator('.sub')).toHaveText('麻古')
  await expect(row.locator('.pmods-sum')).toHaveText(/^大杯・無糖/)
  await expect(page.getByRole('combobox', { name: '店家' }), '記一筆不該再有店家欄').toHaveCount(0)
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  expect((await intakeRows(page))[0]).toMatchObject({ food_id: 40, name: '紅萱波波', vendor: '麻古' })
})

test('記一筆：同一筆通用食物的兩個別名列同時勾，寫兩筆、各自品名店家與份量（AC 2）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page)
  await search(page, '紅萱')
  await listRow(page, '紅萱波波').locator('.food-row').click()
  await search(page, '四季春')
  const second = listRow(page, '四季春青茶（珍珠）')
  await second.locator('.food-row').click()
  await second.getByRole('button', { name: /增加/ }).click()
  await expect(page.locator('.pick-chip')).toHaveCount(2)
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(2)
  const rows = await intakeRows(page)
  expect(rows.map((r) => [r.food_id, r.name, r.vendor, r.qty])).toEqual(
    expect.arrayContaining([
      [40, '紅萱波波', '麻古', 1],
      [40, '四季春青茶（珍珠）', '50嵐', 2],
    ]),
  )
})

test('記一筆：沒搜尋時通用食物自己那列只在「通用（說不出哪家）」，勾了不寫 name、vendor（AC 3）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page, '早餐')
  const lbs = page.locator('.food-scroll .sect-lb')
  await expect(lbs.last()).toHaveText('通用（說不出哪家）')
  const generic = page.locator('.food-scroll .sect-lb', { hasText: '通用（說不出哪家）' }).locator('+ .food-list .food-item')
  await expect(generic.locator('.nm')).toHaveText([BENTO.name, TEA.name].sort((a, b) => a.localeCompare(b, 'zh-Hant-u-co-stroke')))
  // 別名列在類型分組裡；通用食物自己那列不在分組裡（只在最下面那段）
  await expect(page.locator('.food-groups .food-item', { has: page.locator('.nm', { hasText: /^紅萱波波$/ }) })).toHaveCount(1)
  await expect(page.locator('.food-groups .nm', { hasText: TEA.name })).toHaveCount(0)
  await generic.filter({ has: page.locator('.nm', { hasText: TEA.name }) }).locator('.food-row').click()
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  const r = (await intakeRows(page))[0]
  expect(r).toMatchObject({ food_id: 40, name: null })
  expect(r).not.toHaveProperty('vendor')
})

test('記一筆：最近記過「滷雞腿飯 · 日光食堂」→ 常吃出的是那個別名列（AC 4）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page)
  const sect = page.locator('.food-scroll .sect-lb', { hasText: '晚餐常吃' })
  await expect(sect).toHaveCount(1)
  const recent = sect.locator('+ .food-list')
  await expect(recent.locator('.food-item', { has: page.locator('.nm', { hasText: /^滷雞腿飯$/ }) }).locator('.sub')).toHaveText('日光食堂')
  await expect(recent.locator('.nm', { hasText: /^滷雞腿便當$/ })).toHaveCount(0)
  // 照上次以列為單位：日光食堂那列帶半飯、通用便當本身不帶
  const alias = recent.locator('.food-item', { has: page.locator('.nm', { hasText: /^滷雞腿飯$/ }) })
  await alias.locator('.food-row').click()
  await expect(alias.locator('.pmods-sum')).toContainText('半飯')
  await expect(alias.locator('.pmods-last')).toHaveText('· 照上次')
  await search(page, '滷雞腿便當')
  const generic = listRow(page, BENTO.name)
  await generic.locator('.food-row').click()
  await expect(generic.locator('.pmods-sum')).toContainText('正常飯量')
  await expect(generic.locator('.pmods-last')).toHaveCount(0)
})

test('記一筆：有店家的食物照舊——列上副標是自己的店家，寫入不帶 name、vendor；今日頁補店家第二行（AC 9）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  // fixture 有兩家的雞胸餐盒（健康盒 id 11、減醣廚房 id 12）；今日頁午餐那筆是健康盒的
  await expect(page.locator('.item[data-row="102"] .vendor')).toHaveText('健康盒')
  await openMeal(page)
  await search(page, '雞胸')
  const row = listRow(page, '雞胸餐盒').filter({ has: page.locator('.sub', { hasText: '減醣廚房' }) })
  await expect(row.locator('.sub')).toHaveText('減醣廚房')
  await row.locator('.food-row').click()
  await expect(row.locator('.sub')).toHaveText('減醣廚房')
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  const r = (await intakeRows(page))[0]
  expect(r).toMatchObject({ food_id: 12, name: null })
  expect(r).not.toHaveProperty('vendor')
})

test('記一筆：新店卡只打品名時，「記住」不承諾記成這個名字，只說搜得到（review #5）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page)
  await search(page, '冬瓜檸檬')
  const card = page.getByRole('group', { name: '跟哪一樣差不多？' })
  await expect(card.locator('.shop-keep')).toHaveText('記住：下次搜「冬瓜檸檬」找得到這樣')
  await search(page, '春陽 冬瓜檸檬')
  await expect(card.locator('.shop-keep')).toHaveText('記住：下次搜「春陽 冬瓜檸檬」直接是這樣')
})

test('記一筆：搜不到出「跟哪一樣差不多？」，選了記成「品名 · 店家」、記住成別名（AC 7）', async ({ page }) => {
  await openApp(page, {}, VFIX)
  await openMeal(page)
  await search(page, '春陽 冬瓜檸檬')
  const card = page.getByRole('group', { name: '跟哪一樣差不多？' })
  await expect(card).toBeVisible()
  // v2.164 起沒有「估一筆『…』」那一列（卡裡「都不像 → 估一筆」＝這一段直接估）
  await expect(page.locator('.est-row')).toHaveCount(0)
  await card.locator('.shop-opt', { hasText: TEA.name }).click()
  await expect(card.locator('.shop-opt', { hasText: TEA.name })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByRole('checkbox')).toBeChecked()
  await card.getByRole('button', { name: '記成「冬瓜檸檬 · 春陽」' }).click()
  await expect.poll(async () => (await writes(page, 'foods', 'PATCH')).length).toBe(1)
  expect((await writes(page, 'foods', 'PATCH'))[0]).toEqual({ aliases: [...TEA.aliases, '春陽 冬瓜檸檬'] })
  // 回清單、勾著那一列（品名＋店家）
  await expect(page.locator('input[aria-label="吃了什麼"]')).toHaveValue('')
  const row = listRow(page, '冬瓜檸檬')
  await expect(row).toHaveClass(/selected/)
  await expect(row.locator('.sub')).toHaveText('春陽')
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  expect((await intakeRows(page))[0]).toMatchObject({ food_id: 40, name: '冬瓜檸檬', vendor: '春陽', kcal: 165 })
})

test('記一筆：新店卡不勾「記住」就不改食品庫；別名滿 10 個時不出勾選、寫「別名滿了」（AC 8）', async ({ page }) => {
  const FULL = { ...BENTO, aliases: Array.from({ length: 10 }, (_, i) => `店${i} 品${i}`) }
  const fix = { ...VFIX, foods: [...FIX.foods, TEA, FULL] } as unknown as typeof FIX
  await openApp(page, {}, fix)
  await openMeal(page)
  await search(page, '春陽 冬瓜檸檬')
  const card = page.getByRole('group', { name: '跟哪一樣差不多？' })
  await card.locator('.shop-opt', { hasText: BENTO.name }).click()
  await expect(card.getByRole('checkbox')).toHaveCount(0)
  await expect(card).toContainText('別名滿了，這次沒記住')
  await card.locator('.shop-opt', { hasText: TEA.name }).click()
  await card.getByRole('checkbox').uncheck()
  await card.getByRole('button', { name: /^記成/ }).click()
  await expect(page.locator('.food-scroll .sect-lb', { hasText: '剛加的' })).toHaveCount(1)
  await page.locator('.pick-bar .pick-bar-btn').click()
  await expect.poll(async () => (await intakeRows(page)).length).toBe(1)
  expect(await writes(page, 'foods', 'PATCH'), '沒勾記住卻改了食品庫').toHaveLength(0)
  expect((await intakeRows(page))[0]).toMatchObject({ food_id: 40, name: '冬瓜檸檬', vendor: '春陽' })
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
