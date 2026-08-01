/* 額度預警提示（DESIGN.md v2.10）的迴歸鎖。用 qty stepper 把單一食物的份量推高，
   不依賴 fixture 剛好帶超標資料——這樣才驗得到「份量疊加後才超標」這個判定路徑，
   不是只驗「這筆本身就超標」。 */
import { test, expect } from '@playwright/test'
import { openApp } from './harness'

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
