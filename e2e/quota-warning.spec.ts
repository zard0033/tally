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
  // 餐別釘午餐：雞胸餐盒在午餐常吃
  await page.locator('.chip', { hasText: '午餐' }).click()

  // 起點乾淨：還沒勾任何東西，不該有任何一筆被標超標
  await expect(page.locator('.fr-kc.over')).toHaveCount(0)
  await expect(page.locator('.kc-delta')).toHaveCount(0)

  const row = page.locator('.find-row', { hasText: '雞胸餐盒' }).first()
  await row.click()
  // v2.167：份量在「這一餐」那一列點開裡
  await page.locator('.meal-rows .mr-head').first().click()
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
  // 「超出目標 126 克」會被讀成超出了 126 克，文案與今日頁同一句
  await expect(macroLine).toHaveAttribute('aria-label', /脂肪 [\d.]+ 克，已超出，目標 \d+ 克/)
  await expect(macroLine.locator('span.over', { hasText: '脂' })).toBeVisible()

  // 逐筆超標預警：已經被推到超標基準之上，還沒加的列熱量應該變色，
  // delta 小字只列脂肪／碳水——v2.11 拿掉熱量，不能再出現「卡」字（避免跟熱量數字重複）
  await page.getByLabel('找食物').fill('溫泉蛋')
  const unpickedKc = page.locator('.find-row[aria-pressed="false"] .fr-kc.over').first()
  await expect(unpickedKc).toBeVisible()
  const unpickedDelta = page.locator('.find-row[aria-pressed="false"] .kc-delta').first()
  await expect(unpickedDelta).toContainText('脂')
  await expect(unpickedDelta).not.toContainText('卡')
})

/* 軟性排序（DESIGN.md v2.15）的迴歸鎖。固定 fixture 的 eaten 離目標太遠，沒有任何食物
   加下去會超標，驗不到排序。這裡複製一份 fixture、只覆寫 intake 讓 eaten 貼近額度上緣，
   其餘欄位（foods／history）不動——刻意不改共用 e2e/fixtures.ts，免得動到其他測試的
   基準值。

   2026-08-03「每日目標」公式重新設計後，公式估算模式的目標會隨 `computeTargets` 內部
   用 `new Date()` 算的年齡每年 1/1 跳一次（precommit-review 抓到：舊校準的餘裕只剩
   5.2 卡，2027 年就會紅）。這裡改用 **自訂目標模式**（`use_custom_targets: true`）
   把目標數字直接釘死，繞過公式與年齡計算，測試的目標值不再受執行日期影響。
   目標 kcal=1800／fat=50／carb=200，eaten=1705/100/30/150：加「無糖豆漿」（+90/+4/+5）、
   「溫泉蛋」（+80/+5/+1）都還在額度內；加其餘六筆（雞胸餐盒·減醣廚房、乳清、地瓜、
   香蕉、拿鐵）熱量都會被推過線。 */
const HEAVY_FIX = {
  ...FIX,
  profile: [
    {
      ...FIX.profile[0],
      use_custom_targets: true,
      custom_kcal: 1800,
      custom_protein_g: 130,
      custom_fat_g: 50,
      custom_carb_g: 200,
    },
  ],
  intake: [
    { id: 501, meal: 'lunch', qty: 1, kcal: 1705, protein: 100, fat: 30, carb: 150, foods: { name: '測試基準', vendor: null } },
  ],
}

async function openHeavyApp(page: Page) {
  await seedFetchStub(page, HEAVY_FIX, TODAY, USER_ID)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#view-app:not([hidden])', { timeout: 5000 })
  await page.waitForSelector('.gauge-num', { timeout: 5000 })
}

/* v2.167：「全部食物」搬到食品庫頁，軟性排序留在搜尋結果——完全符合排前面之後，同一級裡吃得下的在前。
   搜「全」：無糖豆漿、拿鐵都只靠店家「全家」對到（同一級）；照品名拿鐵在前，吃得下的無糖豆漿要被排到前面。 */
test('軟性排序——搜尋結果：同一級裡符合今日剩餘額度的排前面，不符合的排後面、熱量轉紅、仍可加入', async ({ page }) => {
  await openHeavyApp(page)
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  await page.locator('.chip', { hasText: '午餐' }).click()
  await page.getByLabel('找食物').fill('全')
  const names = page.locator('.find-row .fr-name')
  await expect(names).toHaveText(['無糖豆漿', '拿鐵'])
  await expect(page.locator('.find-row', { hasText: '拿鐵' }).locator('.fr-kc')).toHaveClass(/over/)
  await expect(page.locator('.find-row', { hasText: '無糖豆漿' }).locator('.fr-kc')).not.toHaveClass(/over/)
  // 不符合額度不等於不能選：拿鐵一樣可以加
  await page.locator('.find-row', { hasText: '拿鐵' }).click()
  await expect(page.locator('.find-row[aria-pressed="true"]', { hasText: '拿鐵' })).toHaveCount(1)
})

test('軟性排序——凍結：加一樣之後，清單順序不會跟著即時重新洗牌', async ({ page }) => {
  await openHeavyApp(page)
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  await page.locator('.chip', { hasText: '午餐' }).click()
  await page.getByLabel('找食物').fill('全')
  const names = page.locator('.find-row .fr-name')
  await expect(names).toHaveText(['無糖豆漿', '拿鐵'])
  // 排序基準是 eaten，不含這一餐已經加的，所以加了不該讓清單重排
  await page.locator('.find-row').first().click()
  await expect(page.locator('.find-row').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(names, '加了之後清單順序應該跟之前一樣（凍結排序、加的留在原位）').toHaveText(['無糖豆漿', '拿鐵'])
})

test('軟性排序——常吃：不重排，維持原本的常吃順序；會超標的只是熱量轉紅', async ({ page }) => {
  await openHeavyApp(page)
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  // 主 CTA 依時間預選餐別，早上會直接是早餐；明確點一次早餐 chip 保證測試不受執行時間影響
  await page.locator('.chip', { hasText: '早餐' }).click()

  // 早餐常吃＝乳清、無糖豆漿（fixture history 的既有順序）。
  // eaten=1705/100/30/150：加乳清（+120/+1.5/+2）會把 kcal 推過線（不符合）；
  // 加無糖豆漿（+90/+4/+5）三項都還在額度內（符合）。順序仍應維持乳清在前——「常吃」語意是常吃順序，不能被額度打亂。
  const items = page.locator('.find-list .find-row')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0).locator('.fr-name')).toHaveText('乳清（1匙）')
  await expect(items.nth(1).locator('.fr-name')).toHaveText('無糖豆漿')
  await expect(items.nth(0).locator('.fr-kc')).toHaveClass(/over/)
  await expect(items.nth(1).locator('.fr-kc')).not.toHaveClass(/over/)
})

/* 確認列蛋白/脂/碳每格後面接「這次加了多少」（DESIGN.md v2.100）：吃完後累計／目標是判斷依據，
   +N 補的是這次勾選的貢獻。預期值用勾選列實際的份量乘 fixture 的單份數字手算（無糖豆漿 8/4/5、溫泉蛋 7/5/1），
   不抄實作的 totals。 */
test('確認列每格接「+這次」：蛋白/脂/碳各是勾選品項的加總，份量改了跟著變', async ({ page }) => {
  await openApp(page)
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  // 餐別釘早餐：豆漿在早餐常吃；溫泉蛋用搜尋找
  await page.locator('.chip', { hasText: '早餐' }).click()

  await page.locator('.find-row', { hasText: '無糖豆漿' }).first().click()
  await page.getByLabel('找食物').fill('溫泉蛋')
  await page.locator('.find-row', { hasText: '溫泉蛋' }).first().click()
  await page.waitForTimeout(150)
  const mealRow = (name: string) => page.locator('.meal-rows > li', { hasText: name })
  const qtyOf = async (name: string) => Number(((await mealRow(name).locator('.mr-qty').textContent()) ?? '').replace('×', ''))
  const adds = () => page.locator('.macro-line .add').allInnerTexts()
  const expected = async () => {
    const soy = await qtyOf('無糖豆漿')
    const egg = await qtyOf('溫泉蛋')
    return [`(+${Math.round(8 * soy + 7 * egg)})`, `(+${Math.round(4 * soy + 5 * egg)})`, `(+${Math.round(5 * soy + 1 * egg)})`]
  }
  expect(await adds()).toEqual(await expected())

  // 豆漿加一份：三格都重算
  await mealRow('無糖豆漿').locator('.mr-head').click()
  await mealRow('無糖豆漿').locator('.qty-btn[aria-label*="增加"]').click()
  await page.waitForTimeout(150)
  expect(await adds()).toEqual(await expected())
  await expect(page.locator('.macro-line')).toHaveAttribute('aria-label', /這次加 .* 克/)
})
