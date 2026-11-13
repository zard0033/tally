/* 「估一筆」（spec.md A 節 2026-11-13 版，AC 7–16）。樣張 _design-sample/estimate-entry.html B、ai-flair.html 光暈 A。
   流程（使用者 2026-11-13）：估一筆的草稿「帶回清單」放進已選打勾，跟清單勾的食物一起按「加入」。
   read-label 的估算模式由 stub 的 __estimate 控制（預設 null＝502）；寫入看 __writes。各條都自己 openApp、不共用狀態。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'
import { TODAY } from './fixtures'

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

/** 從現在起記下熱量框有沒有出現過 .counting（滾動中）。要在送出估算之前裝——只看最後的值證明不了有沒有滾。 */
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

async function openSheetDinner(page: Page) {
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  await page.locator('.chip', { hasText: '晚餐' }).click()
}

async function openEstimate(page: Page) {
  await openSheetDinner(page)
  await page.locator('.est-entry').click()
  await expect(page.locator('.sheet-title', { hasText: '估一筆' })).toBeVisible()
}

/** 估一筆底部「帶回清單」→ 回到清單 → 按「加入」。 */
async function bringBackAndAdd(page: Page) {
  await page.locator('.pick-bar-btn', { hasText: '帶回清單' }).click()
  await expect(page.locator('.est-entry')).toBeVisible()
  await page.locator('.pick-bar-btn', { hasText: '加入' }).click()
}

test('入口：清單最上面有「估一筆」卡、搜尋時收起；搜尋有輸入時「估一筆『…』」在「新增『…』」正上方', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  const list = page.locator('.food-scroll')
  await expect(list.locator('> *').first()).toHaveClass(/est-entry/)

  // 有結果的搜尋也出現（不是只在找不到時）
  await page.fill('input[aria-label="搜尋食物"]', '雞胸')
  await expect(page.locator('.est-entry')).toHaveCount(0)
  // 「估一筆」在「新增」正上方：兩列是搜尋結果清單的最後兩個 li
  const rows = page.locator('.food-list li > .est-row, .food-list li > .add-food-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveText('估一筆「雞胸」')
  await expect(rows.nth(1)).toHaveText('新增「雞胸」到食品庫')

  // 點了把字帶進描述框、焦點在描述框；返回清單時搜尋字還在
  await rows.nth(0).click()
  const box = page.locator('textarea[aria-label="描述吃了什麼"]')
  await expect(box).toHaveValue('雞胸')
  await expect(box).toBeFocused()
  await page.locator('.back-btn').click()
  await expect(page.locator('input[aria-label="搜尋食物"]')).toHaveValue('雞胸')
})

test('AI 估算：等待插圖 → 草稿逐樣出現，帶回清單前後都不寫；刪一列、改名、帶回清單再加入 ⇒ 建 2 筆封存食物＋2 列 intake', async ({ page }) => {
  await openApp(page, { intakePersist: true })
  // 延遲要夠長：等待中還要檢查 live region、焦點、帶回清單停用
  await setEstimate(page, { mode: 'ok', body: { items: ITEMS }, delayMs: 2500 })
  await openEstimate(page)
  await expect(page.locator('.sheet-title')).toBeFocused()

  const box = page.locator('textarea[aria-label="描述吃了什麼"]')
  await box.fill('夜市螺獅粉、梅子可樂、一份地瓜球')
  await watchCounting(page)
  await page.locator('.est-go').click()
  // 等待中：光暈在繞、插圖出現；讀屏的 live region 唸等待的說法，焦點留在描述框（readOnly 不是 disabled）
  await expect(page.locator('.ai-ring.busy')).toBeVisible()
  await expect(page.locator('.est-wait-msg')).toHaveText('在看你吃了什麼…')
  await expect(page.locator('.est-body > [role="status"]')).toHaveText('在看你吃了什麼…')
  await expect(box).toBeFocused()
  // 估算還在跑時不能帶回清單（結果回來會換掉草稿）——先放一個檔位進草稿，鈕出現但停用
  await page.locator('.est-tier', { hasText: '吃得簡單' }).click()
  await expect(page.locator('.pick-bar-btn')).toBeDisabled()
  await page.locator('.est-draft').first().locator('.est-del').click()

  const drafts = page.locator('.est-draft')
  await expect(drafts).toHaveCount(3)
  await expect(page.locator('.ai-ring.busy')).toHaveCount(0)
  expect(await estimateCalls(page)).toEqual(['夜市螺獅粉、梅子可樂、一份地瓜球'])
  // 品名就是 AI 給的，不加「（估算）」，可以改
  await expect(drafts.nth(0).locator('.est-name')).toHaveValue('螺獅粉')
  await expect(drafts.nth(0).locator('.est-why')).toContainText('520–760')
  await expect(drafts.nth(0).locator('.est-why')).toContainText('米粉一碗約 250 克')
  // 熱量從 0 滾到估算值，滾完才是可改的框；讀屏唸「估好了」
  await expect(drafts.nth(0).locator('.est-kc input')).toHaveValue('620')
  expect(await sawCounting(page), '有滾動').toBe(true)
  await expect(page.locator('.est-body > [role="status"]')).toHaveText('估好了，3 樣')
  await expect(page.locator('.pick-bar-btn')).toHaveText('帶回清單（3 樣 · 1000 卡）')

  await drafts.nth(1).locator('.est-del').click()
  await drafts.nth(1).locator('.est-name').fill('夜市地瓜球')
  await page.locator('.pick-bar-btn', { hasText: '帶回清單' }).click()
  // 回到清單：草稿在已選段打勾，還沒有任何寫入
  const picked = page.locator('.food-row.est-picked')
  await expect(picked).toHaveCount(2)
  await expect(picked.nth(0).locator('.nm')).toHaveText('螺獅粉')
  await expect(picked.nth(1).locator('.nm')).toHaveText('夜市地瓜球')
  await expect(page.locator('.pick-line')).toContainText('2 樣 · 850 卡')
  expect(await writes(page, 'foods')).toEqual([])
  expect(await writes(page, 'intake')).toEqual([])

  await page.locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([
    { name: '螺獅粉', vendor: null, kcal: 620, protein: 22, fat: 24, carb: 80, archived: true },
    { name: '夜市地瓜球', vendor: null, kcal: 230, protein: 2, fat: 10, carb: 32, archived: true },
  ])
  expect(await writes(page, 'intake')).toEqual([
    [
      { eaten_on: TODAY, meal: 'dinner', food_id: 999, qty: 1, kcal: 620, protein: 22, fat: 24, carb: 80, name: null },
      { eaten_on: TODAY, meal: 'dinner', food_id: 1000, qty: 1, kcal: 230, protein: 2, fat: 10, carb: 32, name: null },
    ],
  ])
  // 封存的食物照樣在今日頁時間軸顯示品名
  await expect(page.locator('.item .nm', { hasText: '螺獅粉' })).toBeVisible()
  await expect(page.locator('.item .nm', { hasText: '夜市地瓜球' })).toBeVisible()
})

test('清單勾的食物跟估一筆帶回來的一次加入（先勾無糖豆漿、再估螺獅粉）', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[0]] } })
  await openSheetDinner(page)
  await page.fill('input[aria-label="搜尋食物"]', '無糖豆漿')
  await page.locator('.food-row', { hasText: '無糖豆漿' }).first().click()
  await page.fill('input[aria-label="搜尋食物"]', '')
  await page.locator('.est-entry').click()
  await page.locator('textarea[aria-label="描述吃了什麼"]').fill('夜市螺獅粉')
  await page.locator('.est-go').click()
  await expect(page.locator('.est-draft')).toHaveCount(1)
  await page.locator('.pick-bar-btn', { hasText: '帶回清單' }).click()
  // 已選段：豆漿與螺獅粉都打勾，確認列 2 樣
  await expect(page.locator('.food-row[aria-pressed="true"]', { hasText: '無糖豆漿' })).toBeVisible()
  await expect(page.locator('.food-row.est-picked', { hasText: '螺獅粉' })).toBeVisible()
  await expect(page.locator('.pick-line')).toContainText('2 樣')
  // 點已選的估算列回估一筆修改
  await page.locator('.food-row.est-picked').click()
  await expect(page.locator('.est-draft .est-name')).toHaveValue('螺獅粉')
  await page.locator('.back-btn').click()
  await page.locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  const intake = (await writes(page, 'intake'))[0] as { food_id: number; kcal: number }[]
  expect(intake.map((r) => r.kcal)).toEqual([90, 620])
  expect(intake[1].food_id).toBe(999)
})

test('勾「存進食品庫」的那列不封存；改熱量時營養素照比例縮放', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[0]] } })
  await openEstimate(page)
  await page.locator('textarea[aria-label="描述吃了什麼"]').fill('螺獅粉')
  await page.locator('.est-go').click()
  const d = page.locator('.est-draft').first()
  await expect(d.locator('.est-kc input')).toHaveValue('620')
  await d.locator('.est-kc input').fill('310')
  await d.locator('.est-kc input').blur()
  await d.getByLabel('存進食品庫').check()
  await bringBackAndAdd(page)
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([{ name: '螺獅粉', vendor: null, kcal: 310, protein: 11, fat: 12, carb: 40 }])
})

test('檔位：點「一般正餐」產生只估熱量的一列，不呼叫 AI；加入後封存、營養素記 0', async ({ page }) => {
  await openApp(page)
  await openEstimate(page)
  await expect(page.locator('.est-tier')).toHaveText([/吃得簡單.*飯糰、麵包、蛋餅.*約 400/, /一般正餐.*便當、一碗麵.*約 700/, /吃很多.*火鍋、夜市、聚餐.*約 1000/])
  await page.locator('.est-tier', { hasText: '一般正餐' }).click()
  const d = page.locator('.est-draft')
  await expect(d).toHaveCount(1)
  await expect(d.locator('.est-name')).toHaveAttribute('placeholder', '晚餐（一般正餐）')
  await expect(d.locator('.est-only')).toHaveText('只估了熱量')
  expect(await estimateCalls(page)).toEqual([])
  await bringBackAndAdd(page)
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([{ name: '晚餐（一般正餐）', vendor: null, kcal: 700, protein: 0, fat: 0, carb: 0, archived: true }])
})

test('自己打數字：加一列只估熱量的草稿，品名預設＝餐別；加入後封存、營養素 0', async ({ page }) => {
  await openApp(page)
  await openEstimate(page)
  await page.fill('#est-own-kcal', '523')
  await page.locator('.est-own-add').click()
  await expect(page.locator('.est-draft .est-name')).toHaveAttribute('placeholder', '晚餐')
  await expect(page.locator('.est-draft .est-only')).toHaveText('只估了熱量')
  await expect(page.locator('.est-draft .est-kc input')).toHaveValue('523')
  await expect(page.locator('#est-own-kcal')).toHaveValue('')
  await bringBackAndAdd(page)
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([{ name: '晚餐', vendor: null, kcal: 523, protein: 0, fat: 0, carb: 0, archived: true }])
})

test('檔位的品名跟著加入時的餐別：回清單換成午餐再加入，寫的是「午餐（一般正餐）」與 lunch', async ({ page }) => {
  await openApp(page)
  await openEstimate(page)
  await page.locator('.est-tier', { hasText: '一般正餐' }).click()
  await page.locator('.pick-bar-btn', { hasText: '帶回清單' }).click()
  await page.locator('.chip', { hasText: '午餐' }).click()
  await expect(page.locator('.food-row.est-picked .nm')).toHaveText('午餐（一般正餐）')
  await page.locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect((await writes(page, 'foods'))[0]).toMatchObject({ name: '午餐（一般正餐）' })
  expect((await writes(page, 'intake'))[0]).toMatchObject([{ meal: 'lunch' }])
})

test('AI 失敗：句子留著、顯示原因與重試，檔位照常可點，sheet 不用重開', async ({ page }) => {
  await openApp(page)
  await openEstimate(page) // __estimate 預設 null＝502
  const box = page.locator('textarea[aria-label="描述吃了什麼"]')
  await box.fill('夜市螺獅粉')
  await page.locator('.est-go').click()
  await expect(page.locator('.est-err[role="alert"]')).toContainText('這次估不出來')
  await expect(box).toHaveValue('夜市螺獅粉')
  await expect(page.locator('.est-go')).toHaveText('重試')
  await page.locator('.est-tier', { hasText: '吃得簡單' }).click()
  await expect(page.locator('.est-draft .est-name')).toHaveAttribute('placeholder', '晚餐（吃得簡單）')
  // 重試成功
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[1]] } })
  await page.locator('.est-go').click()
  await expect(page.locator('.est-draft')).toHaveCount(2)
  await expect(page.locator('.est-err')).toHaveCount(0)
})

test('寫 intake 失敗按重試：已經建好的食物不再建一次，那一列鎖住', async ({ page }) => {
  await openApp(page)
  await openEstimate(page)
  await page.locator('.est-tier', { hasText: '吃很多' }).click()
  await page.evaluate(() => ((window as unknown as StubWindow).__failNext = { table: 'intake', method: 'POST' }))
  await bringBackAndAdd(page)
  await expect(page.locator('.sheet-error')).toContainText('存不進去')
  await expect(page.locator('.pick-bar-btn')).toHaveText('重試')
  // 已經建好食物的那一列鎖住：改了熱量、品名、勾選或刪掉都會跟已建的食物對不上
  await page.locator('.food-row.est-picked').click()
  const d = page.locator('.est-draft').first()
  await expect(d.locator('.est-kc input')).toHaveAttribute('readonly', '')
  await expect(d.locator('.est-name')).toHaveAttribute('readonly', '')
  await expect(d.locator('.est-del')).toBeDisabled()
  await expect(d.getByLabel('存進食品庫')).toBeDisabled()
  await page.locator('.back-btn').click()
  await page.locator('.pick-bar-btn').click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods'), '食物只建一次').toHaveLength(1)
  expect(await writes(page, 'intake'), 'intake 第一次失敗、重試成功').toHaveLength(2)
})

test('描述框按 Enter 送出，空白不送', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [ITEMS[2]] } })
  await openEstimate(page)
  const box = page.locator('textarea[aria-label="描述吃了什麼"]')
  await box.fill('   ')
  await box.press('Enter')
  expect(await estimateCalls(page)).toEqual([])
  await expect(page.locator('.est-go')).toBeDisabled()
  await box.fill('地瓜球')
  await box.press('Enter')
  await expect(page.locator('.est-draft')).toHaveCount(1)
})

test('減少動態：繞光與插圖不循環，草稿只淡入、數字不滾動', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: ITEMS }, delayMs: 800 })
  await openEstimate(page)
  await page.locator('textarea[aria-label="描述吃了什麼"]').fill('夜市')
  await watchCounting(page)
  await page.locator('.est-go').click()
  await expect(page.locator('.est-wait')).toBeVisible()
  const anim = await page.evaluate(() =>
    ['.est-pencil', '.est-cover', '.est-rays', '.est-art', '.est-steam'].map((s) => getComputedStyle(document.querySelector(s)!).animationName),
  )
  expect(anim).toEqual(['none', 'none', 'none', 'none', 'none'])
  const ring = await page.evaluate(() => getComputedStyle(document.querySelector('.ai-ring.busy')!, '::before').animationName)
  expect(ring).toBe('none')
  // 熱量不滾動：從頭到尾沒出現過 .counting；草稿列只淡入（est-fade）、不位移
  await expect(page.locator('.est-draft').first().locator('.est-kc input')).toHaveValue('620', { timeout: 3000 })
  expect(await sawCounting(page), '減少動態不該滾動').toBe(false)
  const rowAnim = await page.locator('.est-draft').first().evaluate((el) => getComputedStyle(el).animationName)
  expect(rowAnim).toBe('est-fade')
})
