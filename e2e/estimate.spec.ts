/* 「估一筆」（spec.md A 節 2026-11-13 版，AC 7–16）。樣張 _design-sample/estimate-entry.html B、ai-flair.html 光暈 A。
   流程（使用者 2026-11-13）：估一筆的草稿「帶回清單」放進已選打勾，跟清單勾的食物一起按「加入」。
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
    { name: '螺獅粉', vendor: null, kcal: 620, protein: 22, fat: 24, carb: 80, verified: false, archived: true },
    { name: '夜市地瓜球', vendor: null, kcal: 230, protein: 2, fat: 10, carb: 32, verified: false, archived: true },
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
  expect(await writes(page, 'foods')).toEqual([{ name: '螺獅粉', vendor: null, kcal: 310, protein: 11, fat: 12, carb: 40, verified: false }])
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
  expect(await writes(page, 'foods')).toEqual([{ name: '晚餐（一般正餐）', vendor: null, kcal: 700, protein: 0, fat: 0, carb: 0, verified: false, archived: true }])
})

/* v2.142：晚餐近三天都吃雞胸餐盒（380 卡、蛋白質 42、脂肪 9、碳水 28）→ 晚餐比例 P 168/380、F 81/380、C 112/380。
   一般正餐 700 → 蛋白質 700×168/380/4＝77.4、脂肪 700×81/380/9＝16.6、碳水 700×112/380/4＝51.6（手算，四捨五入到一位） */
test('檔位：這一餐有歷史就照比例粗估三大，標「粗估」，寫入的營養素不是 0', async ({ page }) => {
  const f = FIX.foods.find((x) => x.id === 12)!
  const row = (id: number, off: number) => ({ id, eaten_on: shiftIso(TODAY, off), meal: 'dinner', food_id: 12, qty: 1, kcal: f.kcal, protein: f.protein,
    fat: f.fat, carb: f.carb, name: null, created_at: `${shiftIso(TODAY, off)}T11:00:00.000Z`, foods: { name: f.name, vendor: f.vendor, archived: false } })
  await openApp(page, {}, { ...FIX, repeatWindow: [row(901, -1), row(902, -2), row(903, -3)] } as unknown as typeof FIX)
  await openEstimate(page)
  await page.locator('.est-tier', { hasText: '一般正餐' }).click()
  const d = page.locator('.est-draft')
  await expect(d.locator('.est-only')).toHaveText('粗估')
  await expect(d).toContainText('三大營養素照你平常這一餐的比例')
  await bringBackAndAdd(page)
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods')).toEqual([{ name: '晚餐（一般正餐）', vendor: null, kcal: 700, protein: 77.4, fat: 16.6, carb: 51.6, verified: false, archived: true }])
})

test('粗估的檔位列在 AI 估算回來後還在（不被當成上一批 AI 的列換掉；v2.142 review）', async ({ page }) => {
  const f = FIX.foods.find((x) => x.id === 12)!
  const row = (id: number, off: number) => ({ id, eaten_on: shiftIso(TODAY, off), meal: 'dinner', food_id: 12, qty: 1, kcal: f.kcal, protein: f.protein,
    fat: f.fat, carb: f.carb, name: null, created_at: `${shiftIso(TODAY, off)}T11:00:00.000Z`, foods: { name: f.name, vendor: f.vendor, archived: false } })
  await openApp(page, {}, { ...FIX, repeatWindow: [row(901, -1), row(902, -2), row(903, -3)] } as unknown as typeof FIX)
  await setEstimate(page, { mode: 'ok', body: { items: ITEMS } })
  await openEstimate(page)
  await page.locator('.est-tier', { hasText: '一般正餐' }).click()
  await expect(page.locator('.est-draft .est-only')).toHaveText(['粗估'])
  await page.locator('textarea[aria-label="描述吃了什麼"]').fill('夜市螺獅粉、梅子可樂、一份地瓜球')
  await page.locator('.est-go').click()
  await expect(page.locator('.est-draft'), '檔位那一列被 AI 的結果換掉了').toHaveCount(1 + ITEMS.length)
  await expect(page.locator('.est-draft .est-only')).toHaveText(['粗估'])
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
  expect(await writes(page, 'foods')).toEqual([{ name: '晚餐', vendor: null, kcal: 523, protein: 0, fat: 0, carb: 0, verified: false, archived: true }])
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

/* ── 修正（spec A2 階段 1，v2.151，樣張 estimate-correct.html B）。read-label 的修正模式由 stub 的 __estimateFix 控制。 ── */
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
async function estimateStinky(page: Page) {
  await openApp(page)
  await openEstimate(page)
  await setEstimate(page, { mode: 'ok', body: { items: STINKY } })
  await page.locator('textarea[aria-label="描述吃了什麼"]').fill('夜市臭豆腐、珍奶')
  await page.locator('.est-go').click()
  await expect(page.locator('.est-draft')).toHaveCount(2)
}
const row = (page: Page, i: number) => page.locator('.est-draft').nth(i)

test('修正：AI 的列有「修正」，檔位與自己打的沒有；點了展開框、聚焦，Esc 只收起框不關 sheet', async ({ page }) => {
  await estimateStinky(page)
  await page.locator('.est-tier').first().click()
  await expect(page.locator('.est-draft')).toHaveCount(3)
  await expect(page.locator('.est-fix-btn')).toHaveCount(2)
  await expect(row(page, 2).locator('.est-fix-btn'), '檔位的列沒有修正').toHaveCount(0)
  await row(page, 0).locator('.est-fix-btn').click()
  await expect(row(page, 0).locator('.est-fix-btn')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.est-fix-in')).toBeFocused()
  await expect(page.locator('.est-fix-go'), '空白不能送').toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('.est-fix')).toHaveCount(0)
  await expect(page.locator('.sheet-title', { hasText: '估一筆' }), 'Esc 只收起修正框').toBeVisible()
})

test('修正：送原句＋那一列目前的估算＋修正字，只換那一列；標「已照…修正」，焦點回到修正鈕', async ({ page }) => {
  await estimateStinky(page)
  await setFix(page, { mode: 'ok', body: { items: [FIXED] }, delayMs: 300 })
  await row(page, 0).locator('.est-fix-btn').click()
  await page.locator('.est-fix-in').fill('5 塊')
  await page.locator('.est-fix-go').click()
  // 修正中：帶回清單、返回、重估都停用
  await expect(page.locator('.pick-bar-btn', { hasText: '帶回清單' })).toBeDisabled()
  await expect(page.locator('.back-btn')).toBeDisabled()
  await expect(row(page, 0).locator('.est-why')).toContainText('炸臭豆腐 5 塊')
  const calls = await fixCalls(page)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual({ mode: 'estimate-fix', text: '夜市臭豆腐、珍奶', item: STINKY[0], fix: '5 塊' })
  await expect(row(page, 0).locator('.est-kc input')).toHaveValue('400')
  await expect(row(page, 0).locator('.est-fixed')).toHaveText('☀ 已照「5 塊」修正')
  await expect(page.locator('.est-fix'), '成功後框收起').toHaveCount(0)
  await expect(row(page, 0).locator('.est-fix-btn')).toBeFocused()
  // 其他列不動
  await expect(row(page, 1).locator('.est-name')).toHaveValue('珍珠奶茶')
  await expect(row(page, 1).locator('.est-kc input')).toHaveValue('450')
  await expect(row(page, 1).locator('.est-fixed')).toHaveCount(0)
  await expect(page.locator('.pick-bar-btn', { hasText: '帶回清單' })).toContainText('2 樣 · 850 卡')
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

test('修正後帶回清單、加入：寫進去的是修正後的數字', async ({ page }) => {
  await estimateStinky(page)
  await setFix(page, { mode: 'ok', body: { items: [FIXED] } })
  await row(page, 0).locator('.est-fix-btn').click()
  await page.locator('.est-fix-in').fill('5 塊')
  await page.locator('.est-fix-go').click()
  await expect(row(page, 0).locator('.est-kc input')).toHaveValue('400')
  await bringBackAndAdd(page)
  await expect(page.locator('.sheet')).toHaveCount(0)
  const intake = (await writes(page, 'intake'))[0] as { kcal: number }[]
  expect(intake.map((r) => r.kcal)).toEqual([400, 450])
})

test('修正：一列修正中，其他列的修正、整句重估、那一列的刪除都停用；同一列修正第二次，焦點照樣回到修正鈕', async ({ page }) => {
  await estimateStinky(page)
  await setFix(page, { mode: 'ok', body: { items: [FIXED] }, delayMs: 400 })
  await row(page, 0).locator('.est-fix-btn').click()
  await page.locator('.est-fix-in').fill('5 塊')
  await page.locator('.est-fix-go').click()
  await expect(row(page, 1).locator('.est-fix-btn'), '別列不能同時修正').toBeDisabled()
  await expect(page.locator('.est-go').first(), '不能整句重估（結果會換掉那一列）').toBeDisabled()
  await expect(row(page, 0).locator('.est-del'), '修正中那一列不能刪').toBeDisabled()
  await expect(row(page, 0).locator('.est-fixed')).toHaveText('☀ 已照「5 塊」修正')
  await expect(row(page, 1).locator('.est-fix-btn')).toBeEnabled()
  await expect(row(page, 0).locator('.est-fix-btn')).toBeFocused()

  // 同一列再修正一次
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

test('修正：Esc 收起框，焦點回到修正鈕', async ({ page }) => {
  await estimateStinky(page)
  await row(page, 0).locator('.est-fix-btn').click()
  await expect(page.locator('.est-fix-in')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.est-fix')).toHaveCount(0)
  await expect(row(page, 0).locator('.est-fix-btn')).toBeFocused()
})

/* ── 先查食品庫（spec「食品庫改版」第二步，AC 9–12；樣張 estimate-library.html A） ── */

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

const descBox = (page: Page) => page.locator('textarea[aria-label="描述吃了什麼"]')

test('① 每一段都在食品庫：不叫 AI、份數可調、加入時直接用那筆的 food_id，不建新食物', async ({ page }) => {
  await openApp(page)
  await openEstimate(page)
  await descBox(page).fill('減醣廚房 溫泉蛋、香蕉')
  await page.locator('.est-go').click()

  const lib = page.locator('.est-draft.est-lib')
  await expect(lib).toHaveCount(2)
  expect(await estimateCalls(page), '全部對上不該叫 AI').toEqual([])
  await expect(page.locator('.est-lib-sum')).toHaveText('2 樣都在食品庫，沒叫 AI')
  await expect(page.locator('.est-body > [role="status"]')).toHaveText('2 樣都在食品庫，沒叫 AI')
  await expect(lib.nth(0).locator('.est-lib-name')).toHaveText('減醣廚房溫泉蛋')
  await expect(lib.nth(0).locator('.est-lib-tag')).toHaveText('食品庫')
  await expect(lib.nth(1).locator('.est-lib-kc')).toContainText('105')
  // 份數 ＋ 一次：熱量跟著變
  await lib.nth(1).locator('.qty-btn').nth(1).click()
  await expect(lib.nth(1).locator('.est-lib-kc')).toContainText('210')
  await expect(page.locator('.pick-bar-btn')).toHaveText('帶回清單（2 樣 · 290 卡）')

  await bringBackAndAdd(page)
  await expect(page.locator('.sheet')).toHaveCount(0)
  expect(await writes(page, 'foods'), '食品庫的列不建新食物').toEqual([])
  expect(await writes(page, 'intake')).toEqual([
    [
      { eaten_on: TODAY, meal: 'dinner', food_id: 16, qty: 1, kcal: 80, protein: 7, fat: 5, carb: 1, name: null },
      { eaten_on: TODAY, meal: 'dinner', food_id: 17, qty: 2, kcal: 105, protein: 1.3, fat: 0.4, carb: 27, name: null },
    ],
  ])
})

test('① AI 服務壞掉時全部對上照樣出結果（不靠 AI）', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, null) // 函式回 502
  await openEstimate(page)
  await descBox(page).fill('香蕉')
  await page.locator('.est-go').click()
  await expect(page.locator('.est-draft.est-lib')).toHaveCount(1)
  await expect(page.locator('.est-err')).toHaveCount(0)
  expect(await estimateCalls(page)).toEqual([])
})

test('同名好幾筆：挑最近記過的（7-11 茶葉蛋），不是來源最好的（官方通用版）', async ({ page }) => {
  await openApp(page, {}, LIB_FIX)
  await openEstimate(page)
  await descBox(page).fill('茶葉蛋')
  await page.locator('.est-go').click()
  const lib = page.locator('.est-draft.est-lib')
  await expect(lib).toHaveCount(1)
  await expect(lib.locator('.est-lib-name')).toHaveText('7-11茶葉蛋')
  await expect(lib.locator('.est-lib-kc')).toContainText('70')
})

test('② 有一段對不上就整句送 AI；AI 回來品名完全一樣的換成食品庫列，「改用 AI 估」換回 AI 那一樣', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [
    { name: '拿鐵', kcal: 200, kcal_low: 150, kcal_high: 260, protein_g: 8, fat_g: 8, carb_g: 20, assumption: '中杯' },
    { name: '臭豆腐', kcal: 480, kcal_low: 380, kcal_high: 600, protein_g: 20, fat_g: 30, carb_g: 25, assumption: '炸臭豆腐 6 塊' },
  ] } })
  await openEstimate(page)
  await descBox(page).fill('全家拿鐵、夜市臭豆腐')
  await page.locator('.est-go').click()
  await expect(page.locator('.est-draft')).toHaveCount(2)
  expect(await estimateCalls(page)).toEqual(['全家拿鐵、夜市臭豆腐'])
  await expect(page.locator('.est-lib-sum')).toHaveText('1 樣用食品庫、1 樣 AI 估')
  const first = page.locator('.est-draft').nth(0)
  await expect(first).toHaveClass(/est-lib/)
  await expect(first.locator('.est-lib-kc')).toContainText('150') // 食品庫的 150，不是 AI 的 200
  await first.locator('.row-pill', { hasText: '改用 AI 估' }).click()
  await expect(page.locator('.est-draft').nth(0)).not.toHaveClass(/est-lib/)
  await expect(page.locator('.est-draft').nth(0).locator('.est-kc input')).toHaveValue('200')
  await expect(page.locator('.est-lib-sum')).toHaveCount(0)
  expect(await estimateCalls(page), 'post 的列換回 AI 不用再叫一次').toEqual(['全家拿鐵、夜市臭豆腐'])
})

test('③ 相近只提示、按「改用」才換；互斥詞（無糖 vs 全糖）連提示都不出', async ({ page }) => {
  await openApp(page, {}, LIB_FIX)
  await setEstimate(page, { mode: 'ok', body: { items: [
    { name: '健康盒雞胸餐盒便當', kcal: 500, kcal_low: 420, kcal_high: 600, protein_g: 40, fat_g: 15, carb_g: 45, assumption: '一盒' },
    { name: '無糖綠茶', kcal: 0, kcal_low: 0, kcal_high: 10, protein_g: 0, fat_g: 0, carb_g: 0, assumption: '大杯' },
    { name: '全糖綠茶大杯', kcal: 300, kcal_low: 250, kcal_high: 350, protein_g: 0, fat_g: 0, carb_g: 75, assumption: '大杯' },
  ] } })
  await openEstimate(page)
  await descBox(page).fill('雞胸便當、無糖綠茶、全糖綠茶大杯')
  await page.locator('.est-go').click()
  const rows = page.locator('.est-draft')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0).locator('.est-near')).toContainText('食品庫有「健康盒 雞胸餐盒」420 卡')
  await expect(rows.nth(1).locator('.est-near'), '無糖不該提示全糖').toHaveCount(0)
  await expect(rows.nth(2).locator('.est-near'), '同樣是全糖就照常提示').toContainText('50嵐 全糖綠茶')
  // 沒按之前那一列還是 AI 的
  await expect(rows.nth(0)).not.toHaveClass(/est-lib/)
  await rows.nth(0).locator('.est-near .row-pill').click()
  await expect(rows.nth(0)).toHaveClass(/est-lib/)
  await expect(rows.nth(0).locator('.est-lib-name')).toHaveText('健康盒雞胸餐盒')
  // 換回 AI 之後不再提示（選過 AI 了）
  await rows.nth(0).locator('.row-pill', { hasText: '改用 AI 估' }).click()
  await expect(rows.nth(0)).not.toHaveClass(/est-lib/)
  await expect(rows.nth(0).locator('.est-near')).toHaveCount(0)
})

test('① 的列按「改用 AI 估」：拿那一段去估一次，估回來的列不會又被換回食品庫', async ({ page }) => {
  await openApp(page)
  await openEstimate(page)
  await descBox(page).fill('香蕉')
  await page.locator('.est-go').click()
  await expect(page.locator('.est-draft.est-lib')).toHaveCount(1)
  await setEstimate(page, { mode: 'ok', body: { items: [{ name: '香蕉', kcal: 120, kcal_low: 90, kcal_high: 150, protein_g: 1, fat_g: 0, carb_g: 30, assumption: '一根大的' }] } })
  await page.locator('.row-pill', { hasText: '改用 AI 估' }).click()
  await expect(page.locator('.est-draft.est-lib')).toHaveCount(0)
  await expect(page.locator('.est-draft .est-kc input')).toHaveValue('120')
  expect(await estimateCalls(page)).toEqual(['香蕉'])
})

test('勾「存進食品庫」但食品庫已有同名：擋下、給「改用那筆」；按了換成食品庫列', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: [{ name: '香蕉片', kcal: 150, kcal_low: 120, kcal_high: 180, protein_g: 1, fat_g: 8, carb_g: 20, assumption: '一包' }] } })
  await openEstimate(page)
  await descBox(page).fill('香蕉片')
  await page.locator('.est-go').click()
  const row0 = page.locator('.est-draft').nth(0)
  await row0.locator('.est-name').fill('香蕉')
  await row0.locator('.est-keep input').check()
  await expect(row0.locator('.est-dup')).toContainText('食品庫已有「香蕉」')
  await row0.locator('.est-dup .row-pill').click()
  await expect(page.locator('.est-draft').nth(0)).toHaveClass(/est-lib/)
})

test('文字鈕新規則：返回是藍字、修正是描邊膠囊（DESIGN「文字鈕與列內動作」）', async ({ page }) => {
  await openApp(page)
  await setEstimate(page, { mode: 'ok', body: { items: ITEMS } })
  await openEstimate(page)
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
  const back = await page.locator('.back-btn').evaluate((el) => getComputedStyle(el).color)
  const toRgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
  expect(back).toBe(toRgb(accent))
  await descBox(page).fill('夜市螺獅粉、梅子可樂、一份地瓜球')
  await page.locator('.est-go').click()
  await expect(page.locator('.est-fix-btn.row-pill')).toHaveCount(3)
  // 「地瓜球」不提示「地瓜」（相近只比 3 個字以上的）
  await expect(page.locator('.est-near')).toHaveCount(0)
})

test('記一筆的新增食物：同名同店家擋下，「改用那筆」直接勾起食品庫那一筆回清單、不新增', async ({ page }) => {
  await openApp(page)
  await openSheetDinner(page)
  await page.fill('input[aria-label="搜尋食物"]', '香蕉')
  await page.locator('.add-food-row').click()
  await expect(page.locator('#f-name')).toHaveValue('香蕉')
  await expect(page.locator('.dup-block')).toContainText('食品庫已有「香蕉」')
  await expect(page.locator('.confirm-wrap .pick-bar-btn')).toBeDisabled()
  await page.locator('.dup-block .row-pill', { hasText: '改用那筆' }).click()
  await expect(page.locator('.food-list li .food-row[aria-pressed="true"] .nm', { hasText: '香蕉' })).toBeVisible()
  expect(await writes(page, 'foods')).toEqual([])
})
