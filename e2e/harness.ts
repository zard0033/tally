/* e2e 共用件。從 tally.spec.ts 抽出來的目的只有一個：**讓新的互動測試可以單獨跑**。

   tally.spec.ts 是 15 條路徑跑在同一個 test() 裡的累積狀態回歸（那是刻意的紀律，見該檔頭），
   代價是要驗證一條斷言就得重跑整份、還得等前面的路徑把狀態鋪好，一輪 20 秒起跳。
   除錯手勢／動畫這種要反覆試的東西，那個迴圈太慢——2026-07-29 有一條拖曳斷言就是因為
   每次驗證都要重跑全份，試了幾輪還是沒查出根因，最後只能放棄留白。

   所以：既有那串原樣保留，新的互動路徑寫成各自獨立的 test()，開場呼叫 openApp() 一行到位。
   跑單一條：npx playwright test -g "關鍵字" */
import { expect, type Page } from '@playwright/test'
import { FIX, TODAY, USER_ID } from './fixtures'
import { seedFetchStub, type StubOptions } from './stub'

/** 種好 fetch stub 與 session，開到今日頁且資料已到齊。零真實網路請求。
 *  opts 目前只轉發 intakeDelayMs，給要量「無感切日期」實際毫秒數的測試用。 */
export async function openApp(page: Page, opts: StubOptions = {}) {
  await seedFetchStub(page, FIX, TODAY, USER_ID, opts)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#view-app:not([hidden])', { timeout: 5000 })
  // Today 只在 profile／weight／targets 都到齊才掛載，#view-app 出現不代表內容在了
  await page.waitForSelector('.gauge-num', { timeout: 5000 })
}

export async function must(page: Page, sel: string, label: string) {
  if ((await page.locator(sel).count()) === 0) {
    throw new Error(`契約缺失：${label}　selector \`${sel}\` 在畫面上不存在`)
  }
}

/* waitForTimeout 之後立刻 count() 一次是賭一個固定毫秒數在所有並行負載下都夠——
   tally.spec.ts 同時起跑時 CPU 被搶，React 狀態更新／DOM 移除可能比那個數字慢，
   斷言就會在「其實還沒到，只是還沒等到」的時候讀到舊值（2026-07-31 verifier 抓到，
   e2e/interaction.spec.ts 的 undo 跨日期／日期快取 4 各掛過一次）。
   改用 Playwright 內建的輪詢斷言：有明確的到達條件（count 等於期望值），
   到了就馬上通過，沒到才等到 timeout 才真的失敗——不是「等更久」，是「等對事」。 */
export async function waitCount(page: Page, sel: string, n: number, msg: string, timeout = 5000) {
  await expect(page.locator(sel), msg).toHaveCount(n, { timeout })
}

export async function mustText(page: Page, sel: string, want: string, label: string) {
  const got = ((await page.locator(sel).first().textContent()) ?? '').trim()
  if (!got.includes(want)) throw new Error(`${label}：預期含「${want}」，實際「${got}」`)
}

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

export const numFrom = async (page: Page, sel: string) =>
  Number(((await page.locator(sel).first().textContent()) ?? '').replace(/[^\d.-]/g, ''))

/* 逐點移動＋每點停一小段。`mouse.move(x, y, { steps })` 在冷頁面上不足以讓 motion 的
   drag 起手——實測同一個手勢連跑四次全都沒觸發拖曳、收尾等於一次 click，於是「拖了
   沒刪」這種斷言會在什麼都沒發生的情況下綠著（verifier 抓到的假通過風險）。 */
export async function slowDrag(page: Page, from: { x: number; y: number }, path: { x: number; y: number }[]) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (const p of path) {
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
}

/** 從起點到終點切成 n 段，配合 slowDrag 用 */
export const leg = (from: { x: number; y: number }, to: { x: number; y: number }, n = 10) =>
  Array.from({ length: n }, (_, i) => ({
    x: from.x + ((to.x - from.x) * (i + 1)) / n,
    y: from.y + ((to.y - from.y) * (i + 1)) / n,
  }))

/* 累積狀態的路徑開場先把第一列正規化成關閉，斷言才不會建在上一條留下的中間狀態上。
   v2.20 起「活躍」有兩種樣子（is-open＝左滑露出刪除鈕、is-edit＝點按展開編輯區），
   兩種都要收——點一下 .item-content 對兩者都是收合（同一顆 active state）。 */
export async function closeFirstRow(page: Page) {
  const row = page.locator('.timeline .item-row').first()
  if ((await row.count()) === 0) return
  if (await row.evaluate((el) => el.classList.contains('is-open') || el.classList.contains('is-edit'))) {
    await page.locator('.timeline .item-content').first().click()
    await page.waitForTimeout(300)
  }
}

/** 不經手勢的刪除路徑：點品項展開編輯區 → 按裡面的刪除鈕。
 *  v2.20 前是「點品項露出紅圓 → 按紅圓」；點按語意改成展開編輯區之後，鍵盤與
 *  非觸控的刪除入口跟著搬進編輯區（左滑露出紅圓那條手勢路徑完全沒變）。
 *  這裡集中一份，之後入口再搬只改這裡，不必回頭掃每一條刪除測試。 */
export async function deleteViaTap(page: Page, n = 0) {
  await page.locator('.timeline .item-content').nth(n).click()
  const del = page.locator('.timeline .item-editor .ed-del')
  await expect(del, '點品項後編輯區沒展開，找不到刪除鈕').toHaveCount(1)
  await del.click()
}

/** 第 n 列的可觀察狀態。斷言與探針共用——量出來再改，不要用推理決定手勢的門檻。 */
export async function rowState(page: Page, n = 0) {
  const row = page.locator('.timeline .item-row').nth(n)
  const slide = page.locator('.timeline .item-slide').nth(n)
  return {
    count: await page.locator('.timeline .item').count(),
    open: (await row.count()) > 0 && (await row.evaluate((el) => el.classList.contains('is-open'))),
    transform: (await slide.count()) > 0 ? await slide.evaluate((el) => getComputedStyle(el).transform) : 'gone',
    undoBar: await page.locator('.undo-bar').count(),
  }
}

/** 第 n 列 .item-content 的中心偏右起手點（避開左邊的品名文字） */
export async function grabPoint(page: Page, n = 0) {
  const box = await page.locator('.timeline .item-content').nth(n).boundingBox()
  expect(box, '拿不到品項座標').not.toBeNull()
  return { x: box!.x + box!.width - 20, y: box!.y + box!.height / 2 }
}
