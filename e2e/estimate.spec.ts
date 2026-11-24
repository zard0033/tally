/* 一個框記一餐（spec「一個框記一餐：搜尋和估一筆合一」，v2.164，AC 1–10；樣張 _design-sample/one-box.html 甲）。
   框裡打完一段（頓號、逗號、或按完成）就移出框、在「這一餐」段變成一列：對上食品庫＝勾好那一列，對不上＝待估，按「估」只送那一段。
   估好的草稿保留 v2.134–v2.154 估一筆的全部（改名、改熱量照比例、修正、存進食品庫、相近、改用 AI 估、查重）。
   read-label 的估算模式由 stub 的 __estimate 控制（預設 null＝502）；寫入看 __writes。各條都自己 openApp、不共用狀態。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp, shiftIso } from './harness'
import { FIX, TODAY } from './fixtures'

test.describe.configure({ mode: 'parallel' })

interface StubWindow {
  __writes: { path: string; table: string; method: string; body: unknown }[]
  __estimate: { mode: 'ok' | 'fail'; body?: unknown; delayMs?: number } | null
  __estimateCalls: string[]
  __failNext: { table: string; method: string } | null
}

const ITEMS = [
  { name: '螺獅粉', kcal: 620, kcal_low: 520, kcal_high: 760, protein_g: 22, fat_g: 24, carb_g: 80, assumption: '米粉一碗約 250 克' },
  { name: '梅子可樂', kcal: 150, kcal_low: 110, kcal_high: 190, protein_g: 0, fat_g: 0, carb_g: 38, assumption: '一杯約 500 毫升' },
  { name: '地瓜球', kcal: 230, kcal_low: 170, kcal_high: 300, protein_g: 2, fat_g: 10, carb_g: 32, assumption: '一份約 10 顆' },
]

async function setEstimate(page: Page, v: StubWindow['__estimate']) {
  await page.evaluate((x) => ((window as unknown as StubWindow).__estimate = x), v)
}
const writes = (page: Page, table: string) =>
  page.evaluate((t) => (window as unknown as StubWindow).__writes.filter((w) => w.table === t && w.method === 'POST').map((w) => w.body), table)
const estimateCalls = (page: Page) => page.evaluate(() => (window as unknown as StubWindow).__estimateCalls)

/** 從現在起記下熱量框有沒有出現過 .counting（滾動中）。要在按「估」之前裝——只看最後的值證明不了有沒有滾。 */
async function watchCounting(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __sawCounting: boolean }
    w.__sawCounting = false
    new MutationObserver(() => {
      if (document.querySelector('.est-kc input.counting')) w.__sawCounting = true
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
  })
}
const sawCounting = (page: Page) => page.evaluate(() => (window as unknown as { __sawCounting: boolean }).__sawCounting)

const box = (page: Page) => page.locator('input[aria-label="吃了什麼"]')
const sect = (page: Page) => page.locator('.meal-sect')
const pend = (page: Page) => page.locator('.meal-pend')
const drafts = (page: Page) => page.locator('.meal-rows .est-draft')
const segPicks = (page: Page) => page.locator('.meal-rows .food-item.selected')
const addBtn = (page: Page) => page.locator('.pick-bar-btn')

async function openSheetDinner(page: Page) {
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  await page.locator('.chip', { hasText: '晚餐' }).click()
}

/** 打一整句並按完成：每一段都變成「這一餐」的一列。 */
async function say(page: Page, text: string) {
  await box(page).fill(text)
  await box(page).press('Enter')
}

/** 估一段：只有那一列待估時直接按它的「估」。 */
async function estimateRow(page: Page, text: string) {
  await pend(page).filter({ hasText: text }).locator('.mp-go').click()
}

test('打完一段就移出框：對上食品庫的勾好、對不上的待估；框裡正在打的那段只是搜尋（AC 1、7）', async ({ page }) => {
  await openApp(page) // __estimate 預設 null：整個過程不該叫 AI
  await openSheetDinner(page)
  // 只打一段、沒按完成：只是搜尋，「這一餐」不出現
  await box(page).fill('香蕉')
  await expect(sect(page)).toHaveCount(0)
  await expect(page.locator('.food-list .food-row', { hasText: '香蕉' })).toBeVisible()

  await box(page).fill('減醣廚房 溫泉蛋、香蕉、夜市臭豆腐')
  // 前兩段一打出頓號就各自變成勾好的列（照打的順序），框裡只剩還在打的那段
  await expect(segPicks(page).locator('.nm')).toHaveText(['溫泉蛋', '香蕉'])
  await expect(segPicks(page).nth(0).locator('.sub')).toHaveText('減醣廚房')
  await expect(box(page)).toHaveValue('夜市臭豆腐')
  await expect(pend(page)).toHaveCount(0)
  // 框裡那段同時是搜尋：搜尋結果照舊出現（找不到、新增那一列）
  await expect(page.locator('.sect-lb', { hasText: '搜尋結果' })).toBeVisible()
  await expect(page.locator('.add-food-row')).toHaveText('新增「夜市臭豆腐」到食品庫')
  // 勾好的列不在清單其他段重複出現
  await expect(page.locator('.food-item.selected')).toHaveCount(2)

  await box(page).press('Enter')
  await expect(box(page)).toHaveValue('')
  await expect(pend(page).locator('.mp-tx')).toHaveText('夜市臭豆腐')
  // 順序：照打的
  await expect(page.locator('.meal-rows > li')).toHaveCount(3)
  await expect(page.locator('.meal-rows > li').nth(2)).toHaveClass(/meal-pend/)
  await expect(page.locator('.pick-pin .pick-chip')).toHaveText(['溫泉蛋', '香蕉'])
  // 還有待估：加入停用、說還差什麼
  await expect(addBtn(page)).toBeDisabled()
  await expect(page.locator('.pick-hint')).toHaveText('還有 1 樣沒估：按「估」或「只記熱量」，不要的按 ✕')
  expect(await estimateCalls(page), '對上食品庫、待估都不叫 AI').toEqual([])

  // ✕ 拿掉待估那一列就能加入；勾好的列取消勾＝整列拿掉
  await pend(page).locator('.est-del').click()
  await expect(addBtn(page)).toBeEnabled()
  await segPicks(page).nth(1).locator('.food-row').click()
  await expect(segPicks(page).locator('.nm')).toHaveText(['溫泉蛋'])
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods'), '食品庫的列不建新食物').toEqual([])
  expect(await writes(page, 'intake')).toEqual([[{ eaten_on: TODAY, meal: 'dinner', food_id: 16, qty: 1, kcal: 80, protein: 7, fat: 5, carb: 1, name: null }]])
})

test('按「估」只送那一段：估的時候繞光、寫在等什麼、加入停用；回來在原位換成草稿、熱量從 0 滾上去（AC 2）', async ({ page }) => {
  await openApp(page, { intakePersist: true })
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[0], ITEMS[1]] }, delayMs: 2000 })
  await openSheetDinner(page)
  await say(page, '香蕉、夜市螺獅粉配梅子可樂')
  await watchCounting(page)
  // 用鍵盤按「估」：估的時候鈕留著（不 disabled），焦點不掉；估好那一列卸載後焦點接到第一樣估好的
  await pend(page).locator('.mp-go').focus()
  await page.keyboard.press('Enter')
  // 估的時候：那一列繞光、寫等什麼；加入停用
  await expect(pend(page)).toHaveClass(/busy/)
  await expect(pend(page).locator('.ai-ring.busy')).toBeVisible()
  await expect(pend(page).locator('.mp-wait')).toContainText('在看你吃了什麼…')
  await expect(pend(page).locator('.mp-go')).toBeFocused()
  await expect(addBtn(page)).toBeDisabled()

  await expect(drafts(page)).toHaveCount(2)
  await expect(pend(page)).toHaveCount(0)
  expect(await estimateCalls(page)).toEqual(['夜市螺獅粉配梅子可樂'])
  // 原位：香蕉在前、兩樣估好的接在後面
  await expect(page.locator('.meal-rows > li').nth(0)).toContainText('香蕉')
  await expect(drafts(page).nth(0).locator('.est-name')).toHaveValue('螺獅粉')
  await expect(drafts(page).nth(0).locator('.est-why')).toContainText('520–760')
  await expect(drafts(page).nth(0).locator('.est-kc input')).toHaveValue('620')
  expect(await sawCounting(page), '有滾動').toBe(true)
  // 浮現錯開只算剛回來的這一批：第一樣不延遲、第二樣 90ms（review M6）
  expect(await drafts(page).nth(0).evaluate((el) => (el as HTMLElement).style.animationDelay)).toBe('')
  expect(await drafts(page).nth(1).evaluate((el) => (el as HTMLElement).style.animationDelay)).toBe('90ms')
  // 估好的那一樣的膠囊描邊（最近加的）
  await expect(page.locator('.pick-pin .pick-chip.is-new')).toHaveText('螺獅粉')
  await expect(sect(page).locator('> [role="status"]')).toHaveText('估好了：螺獅粉 620 卡、梅子可樂 150 卡')
  // 焦點接到第一樣估好的那一列
  await expect(drafts(page).nth(0)).toBeFocused()
  await expect(page.locator('.pick-pin .pick-chip')).toHaveText(['香蕉', '螺獅粉', '梅子可樂'])
  await expect(page.locator('.pick-line')).toContainText('3 樣 · 875 卡')

  // 刪一列、改名，然後加入：建 1 筆封存食物＋香蕉直接用食品庫那一筆
  await drafts(page).nth(1).locator('.est-del').click()
  await drafts(page).nth(0).locator('.est-name').fill('夜市螺獅粉')
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([{ name: '夜市螺獅粉', vendor: null, kcal: 620, protein: 22, fat: 24, carb: 80, verified: false, archived: true }])
  expect(await writes(page, 'intake')).toEqual([
    [
      { eaten_on: TODAY, meal: 'dinner', food_id: 17, qty: 1, kcal: 105, protein: 1.3, fat: 0.4, carb: 27, name: null },
      { eaten_on: TODAY, meal: 'dinner', food_id: 999, qty: 1, kcal: 620, protein: 22, fat: 24, carb: 80, name: null },
    ],
  ])
  await expect(page.locator('.item .nm', { hasText: '夜市螺獅粉' })).toBeVisible()
})

test('清單勾的跟「這一餐」的一次加入；點估好那一樣的膠囊捲到那一列（AC 10）', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[0]] } })
  await openSheetDinner(page)
  await box(page).fill('無糖豆漿')
  await page.locator('.food-row', { hasText: '無糖豆漿' }).first().click()
  await box(page).fill('')
  await say(page, '夜市螺獅粉')
  await estimateRow(page, '夜市螺獅粉')
  await expect(drafts(page)).toHaveCount(1)
  await expect(page.locator('.food-row[aria-pressed="true"]', { hasText: '無糖豆漿' })).toBeVisible()
  await expect(page.locator('.pick-line')).toContainText('2 樣')
  await expect(page.locator('.pick-pin .pick-chip')).toHaveText(['無糖豆漿', '螺獅粉'])
  await page.getByRole('button', { name: '捲到 螺獅粉' }).click()
  await expect(drafts(page).nth(0)).toBeFocused()
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  const intake = (await writes(page, 'intake'))[0] as { food_id: number; kcal: number }[]
  expect(intake.map((r) => r.kcal)).toEqual([90, 620])
  expect(intake[1].food_id).toBe(999)
})

test('勾「存進食品庫」的那列不封存；改熱量時營養素照比例縮放', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[0]] } })
  await openSheetDinner(page)
  await say(page, '螺獅粉')
  await estimateRow(page, '螺獅粉')
  const d = drafts(page).first()
  await expect(d.locator('.est-kc input')).toHaveValue('620')
  await d.locator('.est-kc input').fill('310')
  await d.locator('.est-kc input').blur()
  await d.getByLabel('存進食品庫').check()
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([{ name: '螺獅粉', vendor: null, kcal: 310, protein: 11, fat: 12, carb: 40, verified: false }])
})

test('只記熱量：待估列展開三個檔位，選「一般正餐」那一列換成只估熱量的列，不叫 AI；加入後封存、營養素 0（AC 4）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await say(page, '聚餐吃很多')
  await expect(pend(page).locator('.est-tier')).toHaveCount(0)
  await pend(page).locator('.mp-only').click()
  await expect(pend(page).locator('.mp-only')).toHaveAttribute('aria-expanded', 'true')
  await expect(pend(page).locator('.est-tier')).toHaveText([/吃得簡單.*飯糰、麵包、蛋餅.*約 400/, /一般正餐.*便當、一碗麵.*約 700/, /吃很多.*火鍋、夜市、聚餐.*約 1000/])
  await pend(page).locator('.est-tier', { hasText: '一般正餐' }).click()
  await expect(pend(page)).toHaveCount(0)
  const d = drafts(page)
  await expect(d).toHaveCount(1)
  await expect(d.locator('.est-name')).toHaveAttribute('placeholder', '晚餐（一般正餐）')
  await expect(d.locator('.est-only')).toHaveText('只估了熱量')
  expect(await estimateCalls(page)).toEqual([])
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([{ name: '晚餐（一般正餐）', vendor: null, kcal: 700, protein: 0, fat: 0, carb: 0, verified: false, archived: true }])
})

/* v2.142：晚餐近三天都吃雞胸餐盒（380 卡、蛋白質 42、脂肪 9、碳水 28）→ 晚餐比例 P 168/380、F 81/380、C 112/380。
   一般正餐 700 → 蛋白質 700×168/380/4＝77.4、脂肪 700×81/380/9＝16.6、碳水 700×112/380/4＝51.6（手算，四捨五入到一位） */
test('只記熱量：這一餐有歷史就照比例粗估三大，標「粗估」，寫入的營養素不是 0', async ({ page }) => {
  const f = FIX.foods.find((x) => x.id === 12)!
  const row = (id: number, off: number) => ({ id, eaten_on: shiftIso(TODAY, off), meal: 'dinner', food_id: 12, qty: 1, kcal: f.kcal, protein: f.protein,
    fat: f.fat, carb: f.carb, name: null, created_at: `${shiftIso(TODAY, off)}T11:00:00.000Z`, foods: { name: f.name, vendor: f.vendor, archived: false } })
  await openApp(page, {}, { ...FIX, repeatWindow: [row(901, -1), row(902, -2), row(903, -3)] } as unknown as typeof FIX)
  await openSheetDinner(page)
  await say(page, '晚餐')
  await pend(page).locator('.mp-only').click()
  await pend(page).locator('.est-tier', { hasText: '一般正餐' }).click()
  await expect(drafts(page).locator('.est-only')).toHaveText('粗估')
  await expect(drafts(page)).toContainText('三大營養素照你平常這一餐的比例')
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([{ name: '晚餐（一般正餐）', vendor: null, kcal: 700, protein: 77.4, fat: 16.6, carb: 51.6, verified: false, archived: true }])
})

test('只記熱量・自己打：那一列換成只估熱量的列，品名預設＝餐別；換餐別後加入，寫的是那一餐', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await say(page, '不記得')
  await pend(page).locator('.mp-only').click()
  await pend(page).locator('.est-own input').fill('523')
  await pend(page).locator('.est-own-add').click()
  await expect(drafts(page).locator('.est-name')).toHaveAttribute('placeholder', '晚餐')
  await expect(drafts(page).locator('.est-only')).toHaveText('只估了熱量')
  await expect(drafts(page).locator('.est-kc input')).toHaveValue('523')
  // 品名空著跟著加入時的餐別
  await page.locator('.chip', { hasText: '午餐' }).click()
  await expect(drafts(page).locator('.est-name')).toHaveAttribute('placeholder', '午餐')
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([{ name: '午餐', vendor: null, kcal: 523, protein: 0, fat: 0, carb: 0, verified: false, archived: true }])
  expect((await writes(page, 'intake'))[0]).toMatchObject([{ meal: 'lunch' }])
})

test('兩列待估：「全部估」各自送出、各自回來；一段估失敗只那一列留錯誤與「重試」（AC 5）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await say(page, '螺獅粉、地瓜球')
  await expect(pend(page)).toHaveCount(2)
  await expect(page.getByRole('button', { name: '全部估，2 樣' })).toBeVisible()
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[2]] } })
  await page.getByRole('button', { name: '全部估，2 樣' }).click()
  await expect(drafts(page)).toHaveCount(2)
  expect((await estimateCalls(page)).sort()).toEqual(['地瓜球', '螺獅粉'])

  // 失敗的那一列：留錯誤、按鈕變「重試」、只記熱量照常；另一列照常估
  await say(page, '臭豆腐、珍奶')
  await setEstimate(page, null)
  await estimateRow(page, '臭豆腐')
  await expect(pend(page).filter({ hasText: '臭豆腐' }).locator('.mp-err')).toHaveText('這一樣估不出來，可以重試或只記熱量')
  await expect(pend(page).filter({ hasText: '臭豆腐' }).locator('.mp-go')).toHaveText('重試')
  // 估不出來只由那一列的 role=alert 唸，段裡的 live region 不再唸第二次（review nit）
  await expect(pend(page).filter({ hasText: '臭豆腐' }).locator('.mp-err')).toHaveAttribute('role', 'alert')
  await expect(sect(page).locator('> [role="status"]')).toHaveText('')
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[1]] } })
  await estimateRow(page, '珍奶')
  await expect(pend(page)).toHaveCount(1)
  await expect(pend(page).locator('.mp-tx')).toHaveText('臭豆腐')
  await estimateRow(page, '臭豆腐')
  await expect(pend(page)).toHaveCount(0)
  await expect(drafts(page)).toHaveCount(4)
})

test('店家只認自己那一段：「在麻古買了螺獅粉」記麻古，「蛋餅」不帶店家（AC 6）', async ({ page }) => {
  const VFIX = {
    ...FIX,
    foods: [...FIX.foods, { id: 40, name: '手搖飲（無糖純茶＋寒天，大杯）', vendor: null, kcal: 60, protein: 0, fat: 0, carb: 15, category: '飲料', category_manual: false, verified: false, aliases: ['麻古 紅萱波波'] }],
  } as unknown as typeof FIX
  await openApp(page, {}, VFIX)
  await openSheetDinner(page)
  await say(page, '在麻古買了螺獅粉、蛋餅')
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[0]] } })
  await estimateRow(page, '在麻古買了螺獅粉')
  await expect(drafts(page)).toHaveCount(1)
  await setEstimate(page, { mode: 'ok', body: { items: [{ name: '蛋餅', kcal: 300, kcal_low: 250, kcal_high: 350, protein_g: 10, fat_g: 12, carb_g: 35, assumption: '一份' }] } })
  await estimateRow(page, '蛋餅')
  await expect(drafts(page)).toHaveCount(2)
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  const rows = (await writes(page, 'intake'))[0] as Record<string, unknown>[]
  expect(rows[0]).toMatchObject({ kcal: 620, vendor: '麻古' })
  expect(rows[1]).toMatchObject({ kcal: 300 })
  expect(rows[1]).not.toHaveProperty('vendor')
})

test('搜不到時新店卡的「都不像 → 估一筆」：框裡那段當作打完、直接估（AC 7）', async ({ page }) => {
  const VFIX = {
    ...FIX,
    foods: [...FIX.foods, { id: 40, name: '手搖飲（無糖純茶＋寒天，大杯）', vendor: null, kcal: 60, protein: 0, fat: 0, carb: 15, category: '飲料', category_manual: false, verified: false, aliases: ['麻古 紅萱波波'] }],
  } as unknown as typeof FIX
  await openApp(page, {}, VFIX)
  await setEstimate(page, { mode: 'ok', body: { items: [{ name: '冬瓜檸檬', kcal: 220, kcal_low: 180, kcal_high: 260, protein_g: 0, fat_g: 0, carb_g: 55, assumption: '大杯、正常糖' }] }, delayMs: 300 })
  await openSheetDinner(page)
  await box(page).fill('春陽 冬瓜檸檬')
  await page.getByRole('button', { name: '都不像 → 估一筆' }).click()
  await expect(box(page)).toHaveValue('')
  await expect(pend(page)).toHaveClass(/busy/)
  await expect(drafts(page)).toHaveCount(1)
  await expect(drafts(page).locator('.est-name')).toHaveValue('冬瓜檸檬')
  expect(await estimateCalls(page)).toEqual(['春陽 冬瓜檸檬'])
})

test('貼上「白飯、滷蛋」一次變成兩列；注音組字中打的頓號不切段，組字結束才切（AC 8）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await box(page).focus()
  await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('input[aria-label="吃了什麼"]')!
    const dt = new DataTransfer()
    dt.setData('text', '香蕉、白飯')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.meal-rows > li')).toHaveCount(2)
  await expect(segPicks(page).locator('.nm')).toHaveText(['香蕉'])
  await expect(pend(page).locator('.mp-tx')).toHaveText('白飯')
  await expect(box(page)).toHaveValue('')

  // 組字中：框裡有頓號也不切
  const input = box(page)
  await input.dispatchEvent('compositionstart')
  await input.fill('地瓜、')
  await expect(page.locator('.meal-rows > li')).toHaveCount(2)
  await expect(input).toHaveValue('地瓜、')
  await input.dispatchEvent('compositionend')
  await expect(page.locator('.meal-rows > li')).toHaveCount(3)
  await expect(input).toHaveValue('')
})

test('畫面上不再有估一筆入口卡、「估一筆『…』」列、估一筆子畫面與「帶回清單」（AC 9）；Enter 在空框不做事', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await expect(page.locator('.est-entry')).toHaveCount(0)
  await box(page).fill('雞胸')
  await expect(page.locator('.est-row')).toHaveCount(0)
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.getByText('帶回清單')).toHaveCount(0)
  await box(page).fill('   ')
  await box(page).press('Enter')
  await expect(sect(page)).toHaveCount(0)
  expect(await estimateCalls(page)).toEqual([])
})

test('寫 intake 失敗按重試：已經建好的食物不再建一次，那一列鎖住（AC 10）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await say(page, '火鍋')
  await pend(page).locator('.mp-only').click()
  await pend(page).locator('.est-tier', { hasText: '吃很多' }).click()
  await page.evaluate(() => ((window as unknown as StubWindow).__failNext = { table: 'intake', method: 'POST' }))
  await addBtn(page).click()
  await expect(page.locator('.sheet-error')).toContainText('存不進去')
  await expect(addBtn(page)).toHaveText('重試')
  const d = drafts(page).first()
  await expect(d.locator('.est-kc input')).toHaveAttribute('readonly', '')
  await expect(d.locator('.est-name')).toHaveAttribute('readonly', '')
  await expect(d.locator('.est-del')).toBeDisabled()
  await expect(d.getByLabel('存進食品庫')).toBeDisabled()
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods'), '食物只建一次').toHaveLength(1)
  expect(await writes(page, 'intake'), 'intake 第一次失敗、重試成功').toHaveLength(2)
})

test('減少動態：繞光不循環，草稿只淡入、數字不滾動', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: ITEMS }, delayMs: 800 })
  await openSheetDinner(page)
  await say(page, '夜市')
  await watchCounting(page)
  await estimateRow(page, '夜市')
  await expect(pend(page).locator('.ai-ring.busy')).toBeVisible()
  const ring = await page.evaluate(() => getComputedStyle(document.querySelector('.ai-ring.busy')!, '::before').animationName)
  expect(ring).toBe('none')
  await expect(drafts(page).first().locator('.est-kc input')).toHaveValue('620', { timeout: 3000 })
  expect(await sawCounting(page), '減少動態不該滾動').toBe(false)
  const rowAnim = await drafts(page).first().evaluate((el) => getComputedStyle(el).animationName)
  expect(rowAnim).toBe('est-fade')
})

/* ── 修正（spec A2 階段 1，v2.151）：送的是那一段（v2.164 起每段各自估）。read-label 的修正模式由 stub 的 __estimateFix 控制。 ── */
interface FixWindow {
  __estimateFix: { mode: 'ok' | 'fail'; body?: unknown; delayMs?: number } | null
  __estimateFixCalls: Record<string, unknown>[]
}
const STINKY = [
  { name: '臭豆腐', kcal: 480, kcal_low: 380, kcal_high: 600, protein_g: 22, fat_g: 30, carb_g: 28, assumption: '炸臭豆腐 6 塊、泡菜一小碟' },
  { name: '珍珠奶茶', kcal: 450, kcal_low: 350, kcal_high: 560, protein_g: 5, fat_g: 12, carb_g: 80, assumption: '中杯 500 毫升、全糖' },
]
const FIXED = { name: '臭豆腐', kcal: 400, kcal_low: 320, kcal_high: 500, protein_g: 18, fat_g: 25, carb_g: 23, assumption: '炸臭豆腐 5 塊、泡菜一小碟' }
async function setFix(page: Page, v: FixWindow['__estimateFix']) {
  await page.evaluate((x) => ((window as unknown as FixWindow).__estimateFix = x), v)
}
const fixCalls = (page: Page) => page.evaluate(() => (window as unknown as FixWindow).__estimateFixCalls)
/** 一段「夜市臭豆腐配珍奶」估回兩樣。 */
async function estimateStinky(page: Page) {
  await openApp(page)
  await openSheetDinner(page)
  await setEstimate(page, { mode: 'ok', body: { items: STINKY } })
  await say(page, '夜市臭豆腐配珍奶')
  await estimateRow(page, '夜市臭豆腐配珍奶')
  await expect(drafts(page)).toHaveCount(2)
}
const row = (page: Page, i: number) => drafts(page).nth(i)

test('修正：AI 的列有「修正」（描邊膠囊），檔位的沒有；點了展開框、聚焦，Esc 只收起框不關 sheet、焦點回修正鈕', async ({ page }) => {
  await estimateStinky(page)
  await say(page, '宵夜')
  await pend(page).locator('.mp-only').click()
  await pend(page).locator('.est-tier').first().click()
  await expect(drafts(page)).toHaveCount(3)
  await expect(page.locator('.est-fix-btn.row-pill')).toHaveCount(2)
  await expect(row(page, 2).locator('.est-fix-btn'), '檔位的列沒有修正').toHaveCount(0)
  await row(page, 0).locator('.est-fix-btn').click()
  await expect(row(page, 0).locator('.est-fix-btn')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.est-fix-in')).toBeFocused()
  await expect(page.locator('.est-fix-go'), '空白不能送').toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('.est-fix')).toHaveCount(0)
  await expect(row(page, 0).locator('.est-fix-btn')).toBeFocused()
  // sheet 被 Esc 關掉時退場動畫期間 .sheet 還在：等過退場（約 0.5 秒）再看——只看當下會漏掉（v2.164 抓到）
  await page.waitForTimeout(900)
  await expect(page.locator('.sheet'), 'Esc 只收起修正框，不關 sheet').toHaveCount(1)
})

test('修正：送那一段＋那一列目前的估算＋修正字，只換那一列；修正中加入停用；標「已照…修正」，焦點回到修正鈕（AC 3）', async ({ page }) => {
  await estimateStinky(page)
  await setFix(page, { mode: 'ok', body: { items: [FIXED] }, delayMs: 300 })
  await row(page, 0).locator('.est-fix-btn').click()
  await page.locator('.est-fix-in').fill('5 塊')
  await page.locator('.est-fix-go').click()
  await expect(addBtn(page)).toBeDisabled()
  await expect(row(page, 0).locator('.est-why')).toContainText('炸臭豆腐 5 塊')
  const calls = await fixCalls(page)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual({ mode: 'estimate-fix', text: '夜市臭豆腐配珍奶', item: STINKY[0], fix: '5 塊' })
  await expect(row(page, 0).locator('.est-kc input')).toHaveValue('400')
  await expect(row(page, 0).locator('.est-fixed')).toHaveText('☀ 已照「5 塊」修正')
  await expect(sect(page).locator('> [role="status"]')).toHaveText('已照「5 塊」修正，臭豆腐 400 卡')
  await expect(page.locator('.est-fix'), '成功後框收起').toHaveCount(0)
  await expect(row(page, 0).locator('.est-fix-btn')).toBeFocused()
  await expect(row(page, 1).locator('.est-name')).toHaveValue('珍珠奶茶')
  await expect(row(page, 1).locator('.est-kc input')).toHaveValue('450')
  await expect(addBtn(page)).toBeEnabled()
  await expect(page.locator('.pick-line')).toContainText('2 樣 · 850 卡')
  // 加入：寫進去的是修正後的數字
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  const intake = (await writes(page, 'intake'))[0] as { kcal: number }[]
  expect(intake.map((r) => r.kcal)).toEqual([400, 450])
})

test('修正：手改過的品名保留；手改過的熱量照畫面上的數字送（範圍夾住它）', async ({ page }) => {
  await estimateStinky(page)
  await setFix(page, { mode: 'ok', body: { items: [{ ...FIXED, name: '炸臭豆腐' }] } })
  await row(page, 0).locator('.est-name').fill('阿宗臭豆腐')
  const kc = row(page, 0).locator('.est-kc input')
  await kc.fill('700')
  await kc.blur()
  await row(page, 0).locator('.est-fix-btn').click()
  await page.locator('.est-fix-in').fill('5 塊')
  await page.keyboard.press('Enter')
  await expect(row(page, 0).locator('.est-fixed')).toBeVisible()
  const [call] = await fixCalls(page)
  expect(call.item).toMatchObject({ name: '阿宗臭豆腐', kcal: 700, kcal_low: 380, kcal_high: 700 })
  await expect(row(page, 0).locator('.est-name')).toHaveValue('阿宗臭豆腐')
  await expect(kc).toHaveValue('400')
})

test('修正失敗：那一列維持原樣、說原本的估算還在、修正字留著，按重試再送', async ({ page }) => {
  await estimateStinky(page)
  await setFix(page, { mode: 'fail' })
  await row(page, 0).locator('.est-fix-btn').click()
  await page.locator('.est-fix-in').fill('5 塊')
  await page.locator('.est-fix-go').click()
  await expect(page.locator('.est-fix-err')).toHaveText('修正沒成功，原本的估算還在')
  await expect(row(page, 0).locator('.est-kc input')).toHaveValue('480')
  await expect(page.locator('.est-fix-in')).toHaveValue('5 塊')
  await expect(page.locator('.est-fix-go')).toHaveText('重試')
  await setFix(page, { mode: 'ok', body: { items: [FIXED] } })
  await page.locator('.est-fix-go').click()
  await expect(row(page, 0).locator('.est-kc input')).toHaveValue('400')
  await expect(page.locator('.est-fix-err')).toHaveCount(0)
  expect(await fixCalls(page)).toHaveLength(2)
})

test('修正：一列修正中，其他列的修正、那一列的刪除都停用；同一列修正第二次，焦點照樣回到修正鈕', async ({ page }) => {
  await estimateStinky(page)
  await setFix(page, { mode: 'ok', body: { items: [FIXED] }, delayMs: 400 })
  await row(page, 0).locator('.est-fix-btn').click()
  await page.locator('.est-fix-in').fill('5 塊')
  await page.locator('.est-fix-go').click()
  await expect(row(page, 1).locator('.est-fix-btn'), '別列不能同時修正').toBeDisabled()
  await expect(row(page, 0).locator('.est-del'), '修正中那一列不能刪').toBeDisabled()
  await expect(row(page, 0).locator('.est-fixed')).toHaveText('☀ 已照「5 塊」修正')
  await expect(row(page, 1).locator('.est-fix-btn')).toBeEnabled()
  await expect(row(page, 0).locator('.est-fix-btn')).toBeFocused()

  await setFix(page, { mode: 'ok', body: { items: [{ ...FIXED, kcal: 320, kcal_low: 260, kcal_high: 400, assumption: '炸臭豆腐 4 塊、泡菜一小碟' }] } })
  await row(page, 0).locator('.est-fix-btn').click()
  await page.locator('.est-fix-in').fill('4 塊')
  await page.locator('.est-fix-go').click()
  await expect(row(page, 0).locator('.est-fixed')).toHaveText('☀ 已照「4 塊」修正')
  await expect(row(page, 0).locator('.est-kc input')).toHaveValue('320')
  await expect(row(page, 0).locator('.est-fix-btn'), '第二次修正完焦點也要回來').toBeFocused()
  const calls = await fixCalls(page)
  expect(calls[1].item, '第二次拿的是修正過的那一列').toMatchObject({ kcal: 400, assumption: '炸臭豆腐 5 塊、泡菜一小碟' })
})

/* ── 接上食品庫（spec「食品庫改版」第二步；v2.164 起整段對上的直接勾好清單那一列） ── */

/** 茶葉蛋兩筆：7-11 那筆最近記過（未標）、通用版官方。全糖綠茶給互斥詞用。 */
const LIB_FIX = {
  ...FIX,
  foods: [
    ...FIX.foods,
    { id: 31, name: '茶葉蛋', vendor: '7-11', kcal: 70, protein: 7, fat: 4.5, carb: 1, category: '配菜', category_manual: false, verified: false, aliases: [] },
    { id: 32, name: '茶葉蛋', vendor: null, kcal: 75, protein: 7.1, fat: 4.7, carb: 1.1, category: '配菜', category_manual: false, verified: true, aliases: [] },
    { id: 33, name: '全糖綠茶', vendor: '50嵐', kcal: 280, protein: 0, fat: 0, carb: 70, category: '飲料', category_manual: false, verified: false, aliases: [] },
  ],
  history: [{ meal: 'breakfast', food_id: 31, qty: 1 }, ...FIX.history],
} as unknown as typeof FIX

test('整段對上食品庫：份數、份量微調同清單；同名好幾筆挑最近記過的（7-11 茶葉蛋）；同一樣打兩次＝2 份', async ({ page }) => {
  await openApp(page, {}, LIB_FIX)
  await openSheetDinner(page)
  await say(page, '茶葉蛋、茶葉蛋、香蕉')
  await expect(segPicks(page)).toHaveCount(2)
  await expect(segPicks(page).nth(0).locator('.nm')).toHaveText('茶葉蛋')
  await expect(segPicks(page).nth(0).locator('.sub')).toHaveText('7-11')
  await expect(segPicks(page).nth(0).locator('.qty-value')).toHaveValue('2')
  // 份數照清單的步進器
  await segPicks(page).nth(1).locator('.qty-btn').nth(1).click()
  await expect(segPicks(page).nth(1).locator('.qty-value')).toHaveValue('2')
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'intake')).toEqual([
    [
      { eaten_on: TODAY, meal: 'dinner', food_id: 31, qty: 2, kcal: 70, protein: 7, fat: 4.5, carb: 1, name: null },
      { eaten_on: TODAY, meal: 'dinner', food_id: 17, qty: 2, kcal: 105, protein: 1.3, fat: 0.4, carb: 27, name: null },
    ],
  ])
})

test('AI 回來品名完全一樣的換成食品庫列，「改用 AI 估」換回 AI 那一樣、不用再叫一次', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [
    { name: '拿鐵', kcal: 200, kcal_low: 150, kcal_high: 260, protein_g: 8, fat_g: 8, carb_g: 20, assumption: '中杯' },
  ] } })
  await openSheetDinner(page)
  await say(page, '全家大杯拿鐵')
  await estimateRow(page, '全家大杯拿鐵')
  const first = drafts(page).nth(0)
  await expect(first).toHaveClass(/est-lib/)
  await expect(first.locator('.est-lib-kc')).toContainText('150') // 食品庫的 150，不是 AI 的 200
  await first.locator('.row-pill', { hasText: '改用 AI 估' }).click()
  await expect(drafts(page).nth(0)).not.toHaveClass(/est-lib/)
  await expect(drafts(page).nth(0).locator('.est-kc input')).toHaveValue('200')
  expect(await estimateCalls(page), '換回 AI 不用再叫一次').toEqual(['全家大杯拿鐵'])
})

test('相近只提示、按「改用」才換；待估列的相近按「改用」直接勾好那一筆；互斥詞（無糖 vs 全糖）連提示都不出', async ({ page }) => {
  await openApp(page, {}, LIB_FIX)
  await openSheetDinner(page)
  // 待估列：「健康盒雞胸」相近「健康盒 雞胸餐盒」
  await say(page, '健康盒雞胸')
  await expect(pend(page).locator('.est-near')).toContainText('食品庫有「健康盒 雞胸餐盒」420 卡')
  await pend(page).locator('.est-near .row-pill').click()
  await expect(pend(page)).toHaveCount(0)
  await expect(segPicks(page).locator('.nm')).toHaveText(['雞胸餐盒'])

  await setEstimate(page, { mode: 'ok', body: { items: [
    { name: '無糖綠茶', kcal: 0, kcal_low: 0, kcal_high: 10, protein_g: 0, fat_g: 0, carb_g: 0, assumption: '大杯' },
    { name: '全糖綠茶大杯', kcal: 300, kcal_low: 250, kcal_high: 350, protein_g: 0, fat_g: 0, carb_g: 75, assumption: '大杯' },
  ] } })
  await say(page, '兩杯綠茶')
  await estimateRow(page, '兩杯綠茶')
  await expect(drafts(page)).toHaveCount(2)
  await expect(drafts(page).nth(0).locator('.est-near'), '無糖不該提示全糖').toHaveCount(0)
  await expect(drafts(page).nth(1).locator('.est-near'), '同樣是全糖就照常提示').toContainText('50嵐 全糖綠茶')
  await expect(drafts(page).nth(1)).not.toHaveClass(/est-lib/)
  await drafts(page).nth(1).locator('.est-near .row-pill').click()
  await expect(drafts(page).nth(1)).toHaveClass(/est-lib/)
  await drafts(page).nth(1).locator('.row-pill', { hasText: '改用 AI 估' }).click()
  await expect(drafts(page).nth(1)).not.toHaveClass(/est-lib/)
  await expect(drafts(page).nth(1).locator('.est-near'), '選過 AI 之後不再提示').toHaveCount(0)
})

test('勾「存進食品庫」但食品庫已有同名：擋下、給「改用那筆」；按了換成食品庫列', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [{ name: '香蕉片', kcal: 150, kcal_low: 120, kcal_high: 180, protein_g: 1, fat_g: 8, carb_g: 20, assumption: '一包' }] } })
  await openSheetDinner(page)
  await say(page, '香蕉片')
  await estimateRow(page, '香蕉片')
  const row0 = drafts(page).nth(0)
  await row0.locator('.est-name').fill('香蕉')
  await row0.locator('.est-keep input').check()
  await expect(row0.locator('.est-dup')).toContainText('食品庫已有「香蕉」')
  await row0.locator('.est-dup .row-pill').click()
  await expect(drafts(page).nth(0)).toHaveClass(/est-lib/)
})

test('記一筆的新增食物：同名同店家擋下，「改用那筆」直接勾起食品庫那一筆回清單、不新增', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await box(page).fill('香蕉')
  await page.locator('.add-food-row').click()
  await expect(page.locator('#f-name')).toHaveValue('香蕉')
  await expect(page.locator('.dup-block')).toContainText('食品庫已有「香蕉」')
  await expect(page.locator('.confirm-wrap .pick-bar-btn')).toBeDisabled()
  await page.locator('.dup-block .row-pill', { hasText: '改用那筆' }).click()
  await expect(page.locator('.food-list li .food-row[aria-pressed="true"] .nm', { hasText: '香蕉' })).toBeVisible()
  expect(await writes(page, 'foods')).toEqual([])
})

/* ── review 修正（v2.164 review） ── */
const VFIX2 = {
  ...FIX,
  foods: [...FIX.foods, { id: 40, name: '手搖飲（無糖純茶＋寒天，大杯）', vendor: null, kcal: 60, protein: 0, fat: 0, carb: 15, category: '飲料', category_manual: false, verified: false, aliases: ['麻古 紅萱波波'] }],
} as unknown as typeof FIX
const BANANA = { name: '香蕉', kcal: 110, kcal_low: 90, kcal_high: 130, protein_g: 1, fat_g: 0, carb_g: 28, assumption: '一根' }

test('寫入中框是唯讀的：打字、Enter 都收不進來，寫進去的只有按「加入」那一刻的（M1）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await say(page, '香蕉')
  await page.evaluate(() => ((window as unknown as { __writeDelayMs: number }).__writeDelayMs = 1500))
  await addBtn(page).click()
  await expect(box(page)).toHaveAttribute('readonly', '')
  // 硬塞字（繞過 readonly）＋按 Enter：都不能多出一列
  await box(page).evaluate((el) => {
    const input = el as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    set?.call(input, '滷蛋、')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await expect(page.locator('.meal-rows > li')).toHaveCount(1)
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'intake')).toEqual([[{ eaten_on: TODAY, meal: 'dinner', food_id: 17, qty: 1, kcal: 105, protein: 1.3, fat: 0.4, carb: 27, name: null }]])
})

test('「都不像 → 估一筆」不比對食品庫：搜到的只有已經在這一餐的那一列也照估，不說「找不到」（M2）', async ({ page }) => {
  await openApp(page, {}, VFIX2)
  await setEstimate(page, { mode: 'ok', body: { items: [BANANA] }, delayMs: 300 })
  await openSheetDinner(page)
  await say(page, '香蕉')
  await box(page).fill('香蕉')
  await expect(page.locator('.search-empty-msg')).toHaveText('「香蕉」已經在「這一餐」')
  await page.getByRole('button', { name: '都不像 → 估一筆' }).click()
  await expect(pend(page)).toHaveClass(/busy/)
  await expect(pend(page).locator('.mp-tx')).toHaveText('香蕉')
  // 原本勾好的香蕉沒有被多算一份
  await expect(segPicks(page).locator('.qty-value')).toHaveValue('1')
  expect(await estimateCalls(page)).toEqual(['香蕉'])
})

test('待估列的相近按「改用」：那一段寫的店家留著（在麻古買了紅萱波波去冰 → 記麻古）（M3）', async ({ page }) => {
  await openApp(page, {}, VFIX2)
  await openSheetDinner(page)
  // 「微糖」會跟通用那筆的「無糖」互斥、連相近都不出，所以用「去冰」
  await say(page, '在麻古買了紅萱波波去冰')
  await expect(pend(page).locator('.est-near')).toContainText('手搖飲（無糖純茶＋寒天，大杯）')
  await pend(page).locator('.est-near .row-pill').click()
  await expect(segPicks(page).locator('.sub')).toHaveText('麻古')
  await addBtn(page).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  const rows = (await writes(page, 'intake'))[0] as Record<string, unknown>[]
  expect(rows).toEqual([expect.objectContaining({ food_id: 40, name: null, vendor: '麻古' })])
})

test('組字剛結束的 Enter（keyCode 229）不算打完（M5）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  const input = box(page)
  await input.dispatchEvent('compositionstart')
  await input.fill('地瓜')
  await input.dispatchEvent('compositionend')
  await input.evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })))
  await expect(sect(page)).toHaveCount(0)
  await expect(input).toHaveValue('地瓜')
  // 真的按 Enter 才算
  await input.press('Enter')
  await expect(segPicks(page).locator('.nm')).toHaveText(['地瓜'])
})

test('已經在這一餐的同一樣：再打一次是那一列多一份、閃一下、焦點留在框裡；AI 估回來對上已勾的也只多一份（L1–L3）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await say(page, '香蕉')
  await box(page).fill('香蕉、')
  await expect(page.locator('.meal-rows > li')).toHaveCount(1)
  await expect(segPicks(page).locator('.qty-value')).toHaveValue('2')
  await expect(segPicks(page).locator('.row-flash')).toHaveCount(1)
  await expect(box(page)).toBeFocused()
  // AI 回「香蕉」對上已勾的那一列：多一份，不多一列草稿
  await setEstimate(page, { mode: 'ok', body: { items: [BANANA] } })
  await say(page, '一根大香蕉')
  await estimateRow(page, '一根大香蕉')
  await expect(pend(page)).toHaveCount(0)
  await expect(drafts(page)).toHaveCount(0)
  await expect(segPicks(page).locator('.qty-value')).toHaveValue('3')
})

test('先估出食品庫的那一樣、再打它的名字：那一列草稿多一份，不再多勾一列（L2）', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [BANANA] } })
  await openSheetDinner(page)
  await say(page, '一根大香蕉')
  await estimateRow(page, '一根大香蕉')
  await expect(drafts(page)).toHaveCount(1)
  await expect(drafts(page)).toHaveClass(/est-lib/)
  await box(page).fill('香蕉、')
  await expect(segPicks(page)).toHaveCount(0)
  await expect(drafts(page).locator('.qty-value')).toHaveValue('2')
})

test('貼上照游標位置插進去（L4）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await box(page).fill('地瓜')
  await box(page).evaluate((el) => {
    const input = el as HTMLInputElement
    input.setSelectionRange(0, 0)
    const dt = new DataTransfer()
    dt.setData('text', '香蕉、')
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(segPicks(page).locator('.nm')).toHaveText(['香蕉', '地瓜'])
})

test('「自己打」打到一半去新增食物再回來，字還在（L5）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await say(page, '不記得')
  await pend(page).locator('.mp-only').click()
  await pend(page).locator('.est-own input').fill('52')
  await box(page).fill('新的東西')
  await page.locator('.add-food-row').click()
  await page.locator('.back-btn').click()
  await expect(pend(page).locator('.est-own input')).toHaveValue('52')
})

test('✕ 拿掉這一餐的一列：焦點到下一列，最後一列拿掉就回框裡（L6）', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await say(page, '螺獅粉、臭豆腐')
  // 用鍵盤按 ✕（WebKit 點按鈕不會把焦點給按鈕，按鈕卸載後焦點掉不掉要看鍵盤路徑）
  await pend(page).nth(0).locator('.est-del').focus()
  await page.keyboard.press('Enter')
  await expect(pend(page)).toHaveCount(1)
  await expect(pend(page).nth(0)).toBeFocused()
  await pend(page).nth(0).locator('.est-del').focus()
  await page.keyboard.press('Enter')
  await expect(box(page)).toBeFocused()
})
