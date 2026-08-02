/* 額度預警提示（DESIGN.md v2.10）的迴歸鎖。用 qty stepper 把單一食物的份量推高，
   不依賴 fixture 剛好帶超標資料——這樣才驗得到「份量疊加後才超標」這個判定路徑，
   不是只驗「這筆本身就超標」。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'
import { FIX, TODAY, USER_ID } from './fixtures'
import { seedFetchStub } from './stub'

test('逐筆超標預警與底部確認列——熱量脂肪推過線後，delta 與蛋白/脂/碳都正確顯示', async ({ page }) => {
  await openApp(page)
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })

  // 起點乾淨：還沒勾任何東西，不該有任何一筆被標超標
  await expect(page.locator('.kc.over')).toHaveCount(0)
  await expect(page.locator('.kc-delta')).toHaveCount(0)

  const row = page.locator('.food-row', { hasText: '雞胸餐盒' }).first()
  await row.click()
  const plus = page.locator('.qty-btn[aria-label*="增加"]').first()
  for (let i = 0; i < 4; i++) await plus.click()
  await page.waitForTimeout(150)

  // 底部確認列：超標時「剩」讓位，delta 掛在小計數字右邊，且不再顯示「剩」
  const pickLine = page.locator('.pick-line')
  await expect(pickLine.locator('.over-delta')).toBeVisible()
  await expect(pickLine.locator('.remain')).toHaveCount(0)

  // 蛋白/脂/碳三個誠實數字都在。判定跟今日頁三大營養素條同一條規則：
  // qty=5 把脂肪推過線、碳水還在範圍內——脂肪要變色，蛋白質永遠不變色（DESIGN.md v2.11 訂正）
  const macroLine = page.locator('.macro-line')
  await expect(macroLine).toBeVisible()
  await expect(macroLine).toContainText('蛋白')
  await expect(macroLine.locator('span', { hasText: '蛋白' })).not.toHaveClass(/over/)
  await expect(macroLine.locator('span.over', { hasText: '脂' })).toBeVisible()

  // 逐筆超標預警：全部食物已經被推到超標基準之上，未勾選列的 kc 應該變色，
  // delta 小字只列脂肪／碳水——v2.11 拿掉熱量，不能再出現「卡」字（避免跟 kc 數字重複）
  const unpickedKc = page.locator('.food-row[aria-pressed="false"] .kc.over').first()
  await expect(unpickedKc).toBeVisible()
  const unpickedDelta = page.locator('.food-row[aria-pressed="false"] .kc-delta').first()
  await expect(unpickedDelta).toContainText('脂')
  await expect(unpickedDelta).not.toContainText('卡')
})

/* 軟性排序（DESIGN.md v2.15）的迴歸鎖。固定 fixture 的 eaten（540 大卡）離目標
   （約 1862 大卡）太遠，沒有任何食物加下去會超標，驗不到排序。這裡複製一份 fixture、
   只覆寫 intake 讓 eaten 貼近額度上緣，其餘欄位（foods／history）不動——刻意不改
   共用 e2e/fixtures.ts，免得動到其他測試的基準值。算出來的結果（見下方各 test 開頭
   註解的算式）：加「無糖豆漿」「溫泉蛋」都還吃得下，加其餘六筆都會推過熱量或碳水線。 */
const HEAVY_FIX = {
  ...FIX,
  intake: [
    { id: 501, meal: 'lunch', qty: 1, kcal: 1750, protein: 100, fat: 50, carb: 200, foods: { name: '測試基準', vendor: null } },
  ],
}

async function openHeavyApp(page: Page) {
  await seedFetchStub(page, HEAVY_FIX, TODAY, USER_ID)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#view-app:not([hidden])', { timeout: 5000 })
  await page.waitForSelector('.gauge-num', { timeout: 5000 })
}

test('軟性排序——全部食物：符合今日剩餘額度的排前面，不符合的排後面且仍可點選加入', async ({ page }) => {
  await openHeavyApp(page)
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  await page.locator('.chip', { hasText: '午餐' }).click()

  // 「全部食物」（午餐常吃只有雞胸餐盒/健康盒 id11，其餘 7 筆都在這裡）：
  // 目標 kcal≈1862.6／fat≈55.9／carb≈214.2，eaten=1750/50/200。
  // 無糖豆漿（+90/+4/+5）、溫泉蛋（+80/+5/+1）三項都還在額度內——排前面。
  // 其餘（雞胸餐盒·減醣廚房、乳清、地瓜、香蕉、拿鐵）至少一項會被推過線——排後面。
  const restList = page.locator('.sect-lb', { hasText: '全部食物' }).locator('xpath=following-sibling::ul[1]')
  const names = await restList.locator('.food-row .nm').allTextContents()
  const fitNames = new Set(['無糖豆漿', '溫泉蛋'])
  const overNames = new Set(['雞胸餐盒', '乳清（1匙）', '地瓜', '香蕉', '拿鐵'])
  // 先確認兩組真的都有出現在畫面上——lastFitIdx 沒對到任何一筆時預設 -1、
  // firstOverIdx 沒對到時預設 Infinity，-1 < Infinity 恆真，缺了這道檢查的話，
  // fixture 漂移或 .nm 選擇器失效時這條斷言會空洞通過（precommit-review 抓到）。
  const foundFit = names.filter((n) => fitNames.has(n))
  const foundOver = names.filter((n) => overNames.has(n))
  expect(foundFit, `符合額度的品項應該都出現在清單裡，實際：${names.join(', ')}`).toHaveLength(fitNames.size)
  expect(foundOver, `不符合額度的品項應該都出現在清單裡，實際：${names.join(', ')}`).toHaveLength(overNames.size)
  const lastFitIdx = Math.max(...names.map((n, i) => (fitNames.has(n) ? i : -1)))
  const firstOverIdx = Math.min(...names.map((n, i) => (overNames.has(n) ? i : Infinity)))
  expect(lastFitIdx, `符合額度的品項應排在不符合的前面，實際順序：${names.join(', ')}`).toBeLessThan(firstOverIdx)

  // .over-quota 只是排序/測試用的語意標記，v2.17 起刻意不掛任何視覺樣式（見 DESIGN.md）
  await expect(restList.locator('.food-item', { hasText: '拿鐵' })).toHaveClass(/over-quota/)
  await expect(restList.locator('.food-item', { hasText: '溫泉蛋' })).not.toHaveClass(/over-quota/)

  // 不符合額度不等於不能選：拿鐵一樣可以正常點選加入
  await restList.locator('.food-row', { hasText: '拿鐵' }).click()
  await expect(page.locator('.food-row[aria-pressed="true"]', { hasText: '拿鐵' })).toHaveCount(1)
})

test('軟性排序——凍結：勾選一筆之後，清單順序不會跟著即時重新洗牌', async ({ page }) => {
  await openHeavyApp(page)
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  await page.locator('.chip', { hasText: '午餐' }).click()

  const restList = page.locator('.sect-lb', { hasText: '全部食物' }).locator('xpath=following-sibling::ul[1]')
  const before = await restList.locator('.food-row .nm').allTextContents()
  expect(before.length).toBeGreaterThan(1)

  // 勾第一筆（排序基準是 eaten，不含這次已勾選的，所以勾選不該讓清單重排）
  const firstName = before[0]
  await restList.locator('.food-row').first().click()
  await expect(page.locator('.food-row[aria-pressed="true"]', { hasText: firstName })).toHaveCount(1)

  const after = await restList.locator('.food-row .nm').allTextContents()
  expect(after, '勾選後剩餘品項的相對順序應該跟勾選前一樣（凍結排序）').toEqual(before.slice(1))
})

test('軟性排序——常吃：只淡化不重排，維持原本的常吃順序', async ({ page }) => {
  await openHeavyApp(page)
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  // 主 CTA 依時間預選餐別，早上會直接是早餐；明確點一次早餐 chip 保證測試不受執行時間影響
  await page.locator('.chip', { hasText: '早餐' }).click()

  // 早餐常吃＝乳清、無糖豆漿（fixture history 的既有順序）。
  // eaten=1750/50/200：加乳清（+120/+1.5/+2）會把 kcal 推過線（不符合）；
  // 加無糖豆漿（+90/+4/+5）三項都還在額度內（符合）。順序仍應維持乳清在前——
  // 排序基準只用在「全部食物」／「搜尋結果」，「常吃」語意是常吃順序，不能被額度打亂。
  const recentList = page.locator('.sect-lb', { hasText: '早餐常吃' }).locator('xpath=following-sibling::ul[1]')
  const items = recentList.locator('.food-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0).locator('.nm')).toHaveText('乳清（1匙）')
  await expect(items.nth(1).locator('.nm')).toHaveText('無糖豆漿')
  await expect(items.nth(0)).toHaveClass(/over-quota/)
  await expect(items.nth(1)).not.toHaveClass(/over-quota/)
})
