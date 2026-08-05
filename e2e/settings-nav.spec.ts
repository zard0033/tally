/* 設定頁的次級頁面路由（v2.21/v2.22）。專案沒裝 react-router，Settings.tsx 自己管一個
   view state；三個入口的進出、以及「次級頁要收起底部列」全靠那個 state 加一個
   onSubViewChange callback 撐著。沒有 URL 可以直接開，壞了只有走一遍才知道。

   體重趨勢頁目前是佔位卡（完整圖表要等 dataviz 定案），所以這裡只驗它進得去、回得來，
   不鎖卡片內容——鎖了等於把一塊明講是暫時的東西焊死。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'

const ENTRIES = [
  { label: '每日目標', screen: 'daily-goal' },
  { label: '食品庫管理', screen: 'food-library' },
  { label: '體重趨勢', screen: 'weight-trend' },
] as const

async function openSettings(page: Page) {
  await page.locator('.tab[aria-label="設定"]').click()
  await expect(page.locator('[data-screen="settings"]')).toBeVisible()
}

test('三個入口都進得去，返回鍵都回得到設定頁', async ({ page }) => {
  await openApp(page)
  await openSettings(page)

  for (const e of ENTRIES) {
    await page.locator('.entry-row', { hasText: e.label }).click()
    await expect(page.locator(`[data-screen="${e.screen}"]`), `「${e.label}」沒導到對應畫面`).toBeVisible()

    await page.locator('.lib-topbar .icon-btn[aria-label="返回設定"]').click()
    await expect(page.locator('[data-screen="settings"]'), `從「${e.label}」按返回沒回到設定頁`).toBeVisible()
  }
})

/* 次級頁把底部列整條收起來（畫面才夠高），回列表要還原。三個入口各驗一次——收起來
   的是同一條規則，但還原走的是各自的返回鍵，其中一個忘了接就只有那一頁會卡住。

   Settings.tsx 的 useEffect 另外在 cleanup 補一次 onSubViewChange(false)，防的是
   「人還停在次級頁，設定分頁就被卸載」。**這條路徑目前的 UI 走不到**：底部列已經
   收起來，分頁鈕點不到，也沒有 URL 可以繞過去。所以這裡不驗它——測不到的東西寫成
   測試只會變成一條看起來有守、其實在守別的東西的斷言。那行 cleanup 留著是廉價的
   深度防禦，等哪天次級頁多出別的離開方式再回來補。 */
test('進次級頁收起底部列，三個入口的返回鍵都要把它還原', async ({ page }) => {
  await openApp(page)
  await openSettings(page)
  await expect(page.locator('.bottom-bar')).toBeVisible()

  for (const e of ENTRIES) {
    await page.locator('.entry-row', { hasText: e.label }).click()
    await expect(page.locator('.bottom-bar'), `「${e.label}」沒收起底部列`).toHaveCount(0)

    await page.locator('.lib-topbar .icon-btn[aria-label="返回設定"]').click()
    await expect(page.locator('.bottom-bar'), `從「${e.label}」返回後底部列沒回來`).toBeVisible()
  }
})

test('設定頁入口列出目前的每日目標數字，跟每日目標頁算出來的一致', async ({ page }) => {
  await openApp(page)
  await openSettings(page)

  const sub = ((await page.locator('.entry-row', { hasText: '每日目標' }).locator('.lb-sub').textContent()) ?? '').trim()
  const entryKcal = Number(/^(\d+) 卡/.exec(sub)?.[1])
  expect(Number.isFinite(entryKcal), `設定頁入口的熱量讀不出來：「${sub}」`).toBe(true)

  await page.locator('.entry-row', { hasText: '每日目標' }).click()
  const goalKcal = Number(((await page.locator('.goal-hero .gauge-num').textContent()) ?? '').replace(/[^\d]/g, ''))

  /* 兩處各自算一次同一個目標：入口列走 App.tsx 的 targets，每日目標頁走 draft 的
     live 預覽。使用者什麼都還沒改，兩個數字就該一樣——對不上表示 touched-ref 那組
     規則在某一側失效了（precommit-review 抓到過的正是這個症狀）。 */
  expect(goalKcal, '設定頁入口與每日目標頁顯示的熱量對不上').toBe(entryKcal)
})
