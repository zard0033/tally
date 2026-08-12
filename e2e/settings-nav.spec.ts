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

/* 全站契約（v2.33）：**每一組多欄輸入都必須包在 `<form>` 裡**。

   這條守的不是送出——所有畫面的送出都走自己的按鈕，`onSubmit` 一律 preventDefault。
   它守的是 **iOS 鍵盤上下箭頭（form accessory bar）**：沒有 `<form>` 時 Safari 只能靠
   DOM 相鄰性猜「哪些欄位算同一組」，猜歪了就會出現真機回報的那個症狀——從品名往下切，
   切到熱量就下不去，但直接從熱量起跳上下都順。桌面 Tab 順序在兩條路徑上都正常，
   所以這個 bug 在桌面**重現不了**，只能靠結構契約防它復發。

   之所以寫成「走訪三個畫面」而不是各自一條：真正的風險是**新增第四處時漏掉**，
   而那種漏掉只有一條會掃全站的測試抓得到。 */
test('多欄輸入群組一律包在 form 裡（iOS 鍵盤上下箭頭靠它分組）', async ({ page }) => {
  await openApp(page)

  const inForm = (sel: string) =>
    page.locator(sel).first().evaluate((el) => !!el.closest('form'))

  // ① 今日頁的就地編輯區
  await page.locator('.timeline .item-content').first().click()
  await expect(page.locator('.item-editor')).toBeVisible()
  expect(await inForm('.item-editor .ed-detail input'), '就地編輯區的欄位不在 form 裡').toBe(true)
  expect(await inForm('.item-editor .qty-value'), '就地編輯區的份量欄不在 form 裡').toBe(true)
  await page.locator('.timeline .item-content').first().click()

  await openSettings(page)

  // ② 更新身體數據 sheet（量測日／體重／體脂）
  await page.locator('.entry-row', { hasText: '更新身體數據' }).click()
  await expect(page.locator('#w-kg')).toBeVisible()
  expect(await inForm('#w-kg'), '體重 sheet 的欄位不在 form 裡').toBe(true)
  await page.locator('#settings-sheet-root .icon-btn[aria-label="關閉"]').click()

  // ③ 食品庫的新增食物 sheet（FoodFormFields，三處共用同一份）
  await page.locator('.entry-row', { hasText: '食品庫管理' }).click()
  await page.locator('.lib-fab').click()
  await expect(page.locator('#lf-name')).toBeVisible()
  for (const f of ['name', 'vendor', 'kcal', 'protein', 'fat', 'carb']) {
    expect(await inForm(`#lf-${f}`), `新增食物的「${f}」欄不在 form 裡`).toBe(true)
  }

  /* 包 form 的代價：欄位裡按 Enter 可能觸發 submit，整頁重整、填到一半的東西全沒。
     **這條守的是 `onSubmit={preventDefault}`，不是 `type="button"`**——實測過了：
     在 form 裡塞一顆漏標 type 的按鈕、但 preventDefault 還在，測試照樣綠；要把
     preventDefault 也拿掉才轉紅。所以那句 preventDefault 才是保險絲，`type="button"`
     是語意上的第二層。**誠實記帳：目前的 FoodFormFields 裡一顆按鈕都沒有**，而 HTML 的
     implicit submission 規則在「多個 text input ＋ 無 submit button」時本來就不送出，
     所以這條在現況下是恆綠的。留著的理由是它會在**日後往這個 form 加按鈕的那一刻**
     開始生效——那正是最容易忘記 preventDefault 還在不在的時機。 */
  await page.evaluate(() => ((window as unknown as { __alive: number }).__alive = 1))
  await page.locator('#lf-kcal').fill('123')
  await page.locator('#lf-kcal').press('Enter')
  expect(
    await page.evaluate(() => (window as unknown as { __alive?: number }).__alive),
    '在欄位按 Enter 讓表單送出並重整了頁面——onSubmit 的 preventDefault 不見了',
  ).toBe(1)
  await expect(page.locator('#lf-kcal'), 'Enter 之後表單狀態不見了').toHaveValue('123')
})
