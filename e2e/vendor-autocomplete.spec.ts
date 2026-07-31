/* 店家 Autocomplete 的獨立路徑（各自 openApp，互不影響）。
   驗的是送出的 POST body，不是畫面文字——選字看得到不代表送對值。 */
import { test, expect } from '@playwright/test'
import { openApp } from './harness'

interface Write {
  path: string
  table: string
  method: string
  body: unknown
}

/* 兩條測試共用的前置動作：開 sheet → 搜尋一個食品庫沒有的品名 → 點「新增到食品庫」
   進到新增食物表單，並把必填的熱量欄位填好，讓後面只需要專心操作店家欄位。 */
async function openFoodForm(page: import('@playwright/test').Page, name: string) {
  await page.click('button.cta')
  await page.waitForSelector('.sheet', { timeout: 3000 })
  const q = page.locator('input[aria-label="搜尋食物"]')
  await q.click()
  await q.pressSequentially(name, { delay: 40 })
  await page.locator('.add-food-row').click()
  await page.waitForSelector('#f-kcal', { timeout: 3000 })
  await page.locator('#f-kcal').click()
  await page.locator('#f-kcal').pressSequentially('100', { delay: 40 })
}

test('店家 Autocomplete — 選既有店家送出，POST body vendor 等於既有值', async ({ page }) => {
  await openApp(page)
  await openFoodForm(page, '測試打卡蛋')

  const vendorInput = page.locator('#f-vendor')
  await vendorInput.click()
  await page.waitForSelector('.vendor-popup', { timeout: 2000 })
  // 減醣廚房在 fixtures 裡有兩筆食物，選它同時驗「去重」——選項只出現一次
  const options = page.locator('.vendor-item', { hasText: '減醣廚房' })
  expect(await options.count(), '「減醣廚房」選項應該只出現一次（去重）').toBe(1)
  await options.first().click()
  expect(await vendorInput.inputValue(), '選完既有店家後輸入框的值應完全等於該店家名').toBe('減醣廚房')

  await page.locator('.confirm-wrap .pick-bar-btn').click()
  await page.waitForTimeout(400)

  const writes = (await page.evaluate(() => (window as unknown as { __writes: Write[] }).__writes)) ?? []
  const posted = writes.filter((w) => w.table === 'foods' && w.method === 'POST')
  expect(posted.length, `應該有一筆 foods POST，實際 ${posted.length} 筆`).toBe(1)
  const body = (Array.isArray(posted[0]?.body) ? posted[0]?.body[0] : posted[0]?.body) as { vendor?: string }
  expect(body?.vendor, '送出的 vendor 應等於既有店家值，不因選取產生變體').toBe('減醣廚房')
})

test('店家 Autocomplete — 打新店家送出，POST body vendor 等於該新字串', async ({ page }) => {
  await openApp(page)
  await openFoodForm(page, '測試香草豆花')

  const vendorInput = page.locator('#f-vendor')
  await vendorInput.click()
  await vendorInput.pressSequentially('巷口早餐店', { delay: 40 })
  // 點別的欄位讓 Autocomplete 失焦收起下拉——不用 Escape：那個鍵會被 vaul Drawer
  // 自己的預設關閉行為接住，整張 sheet 跟著關掉（實測撞到，見回報）。
  await page.locator('#f-kcal').click()
  await page.waitForTimeout(150)
  expect(await vendorInput.inputValue()).toBe('巷口早餐店')

  await page.locator('.confirm-wrap .pick-bar-btn').click()
  await page.waitForTimeout(400)

  const writes = (await page.evaluate(() => (window as unknown as { __writes: Write[] }).__writes)) ?? []
  const posted = writes.filter((w) => w.table === 'foods' && w.method === 'POST')
  expect(posted.length, `應該有一筆 foods POST，實際 ${posted.length} 筆`).toBe(1)
  const body = (Array.isArray(posted[0]?.body) ? posted[0]?.body[0] : posted[0]?.body) as { vendor?: string }
  expect(body?.vendor, '送出的 vendor 應等於使用者打的新字串').toBe('巷口早餐店')
})
