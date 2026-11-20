/* 體重趨勢頁（spec.md「體重趨勢圖」）。recharts 的 SVG 內部不鎖，只驗使用者看得到、讀得出的東西：
   卡片與明細表有沒有出現、範圍切換後明細列數對不對、讀數區的趨勢數字、十字線同步與拖曳讀數、
   各種空狀態。數字運算本身由 src/lib/weightTrend.test.ts 守，這裡的預期值全部從固定資料手算，
   不呼叫被測的函式。 */
import { test, expect, type Page } from '@playwright/test'
import { FIX, TODAY } from './fixtures'
import { openApp, shiftIso } from './harness'

interface Reading { off: number; kg: number; fat: number | null }

/* 固定資料（off＝距今天數）。刻意的設計：
   - off -120 只有「全部」看得到（90 天外）；
   - 規律的舊資料止於 off -8，所以今天的 7 日窗口（off -6…0）內只有最後三筆：80、82、84 → 平均 82.0；
   - 體脂只填一部分，今天那筆是 20.5。 */
const READINGS: Reading[] = [
  { off: -120, kg: 60, fat: null },
  ...Array.from({ length: 26 }, (_, i) => ({
    off: -58 + i * 2,
    kg: 78 + ((i % 5) - 2) * 0.4,
    fat: i % 3 === 0 ? 21 + i * 0.01 : null,
  })),
  { off: -2, kg: 80, fat: null },
  { off: -1, kg: 82, fat: null },
  { off: 0, kg: 84, fat: 20.5 },
]

const toRows = (rs: Reading[]) =>
  rs.map((r) => ({ weight_kg: r.kg, measured_on: shiftIso(TODAY, r.off), body_fat_pct: r.fat }))

async function openTrend(page: Page, rows = toRows(READINGS)) {
  await openApp(page, {}, { ...FIX, weight: rows })
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '體重趨勢' }).click()
  await expect(page.locator('[data-screen="weight-trend"]')).toBeVisible()
  // 點入口的位置換頁後剛好落在圖上，滑鼠停在圖上讀數就會顯示那一天；移開，讓讀數從「最新」起手
  await page.mouse.move(0, 0)
}

const tableRows = (page: Page) => page.locator('.trend-table tbody tr')
const inRange = (days: number | null) => READINGS.filter((r) => days === null || r.off >= -(days - 1)).length

test('預設 90 天：體重與體脂兩張圖、明細表，佔位卡與開發備註不見了', async ({ page }) => {
  await openTrend(page)
  await expect(page.locator('section[aria-label="體重"] .recharts-wrapper')).toBeVisible()
  await expect(page.locator('section[aria-label="體脂"] .recharts-wrapper')).toBeVisible()
  await expect(tableRows(page)).toHaveCount(inRange(90))
  await expect(page.locator('[data-screen="weight-trend"]')).not.toContainText('〔完整圖表區域〕')
  await expect(page.locator('[data-screen="weight-trend"]')).not.toContainText('留到圖表定案時再決定')
  await expect(page.locator('.seg button[aria-pressed="true"]')).toHaveText('90 天')
})

test('範圍切換：30 天／90 天／全部，明細列數跟著變，全部才看得到 90 天外那筆', async ({ page }) => {
  await openTrend(page)
  await page.locator('.seg button', { hasText: '30 天' }).click()
  await expect(tableRows(page)).toHaveCount(inRange(30))
  await page.locator('.seg button', { hasText: '全部' }).click()
  await expect(tableRows(page)).toHaveCount(inRange(null))
  await expect(tableRows(page).last()).toContainText('60.0 kg')
  await page.locator('.seg button', { hasText: '90 天' }).click()
  await expect(tableRows(page)).toHaveCount(inRange(90))
})

test('明細表新到舊：最上面是今天，體重與體脂欄對得上', async ({ page }) => {
  await openTrend(page)
  const first = tableRows(page).first()
  await expect(first).toContainText('84.0 kg')
  await expect(first).toContainText('20.5 %')
  await expect(tableRows(page).nth(1)).toContainText('82.0 kg')
  await expect(tableRows(page).nth(1)).toContainText('—')
})

/* 讀數（v2.146）的預期值用獨立的 Python 照 0.9 平滑常數逐筆算（不呼叫被測函式）：
   全部歷史平滑到今天＝79.709…；90 天範圍第一點（off −58）＝77.175…，變化 +2.53；
   計畫從 77.175 起每週 −0.5、到今天（58 天）＝73.03，比計畫多 6.68。 */
test('讀數：大數字是現在的趨勢體重，下一行是這段變化與比計畫多少', async ({ page }) => {
  await openTrend(page)
  const read = page.locator('section[aria-label="體重"] .trend-read')
  await expect(read.locator('.trend-read-k')).toHaveText('現在的趨勢體重')
  await expect(read.locator('.trend-read-big b')).toHaveText('79.7')
  await expect(read.locator('.trend-read-sub')).toHaveText('90 天 +2.5 kg・比計畫多 6.7 kg')
})

test('指標移到體脂圖：十字線同步，讀數換成那一天（當次量測、趨勢、體脂），移開回到最新', async ({ page }) => {
  await openTrend(page)
  // 30 天：一天約 9px，指標對得準；90 天一天只有 3px，差幾像素就會落到前兩天
  await page.locator('.seg button', { hasText: '30 天' }).click()
  const fat = page.locator('section[aria-label="體脂"] .recharts-wrapper')
  const box = await fat.boundingBox()
  expect(box, '拿不到體脂圖座標').not.toBeNull()
  // 圖的右緣（扣掉 margin.right 8px）是今天（X 軸終點）
  await page.mouse.move(box!.x + box!.width - 8, box!.y + box!.height / 2)
  const read = page.locator('section[aria-label="體重"] .trend-read')
  await expect(read.locator('.trend-read-k')).toContainText('量到')
  await expect(read.locator('.trend-read-big b')).toHaveText('84.0')
  await expect(read.locator('.trend-read-sub')).toContainText('趨勢 79.7')
  await expect(read.locator('.trend-read-sub')).toContainText('體脂 20.5%')
  await expect(page.locator('section[aria-label="體脂"] .trend-subval')).toHaveText('20.5%')
  await expect(page.locator('.recharts-tooltip-cursor')).toHaveCount(2)
  await page.mouse.move(0, 0)
  await expect(read.locator('.trend-read-big b')).toHaveText('79.7')
  await expect(read.locator('.trend-read-k')).toHaveText('現在的趨勢體重')
})

/* 手指放開（v2.146 review H1）：recharts 放開後不收 tooltip，讀數回到最新的同時十字線也要收掉，畫面上不能有兩個「現在」。
   桌面 WebKit 沒有真的觸控，這裡在圖上派一個 touchend（React 收得到，recharts 把它轉給 onTouchEnd）；真機手感另驗。 */
test('手指放開：讀數回到最新，兩張圖的十字線一起收掉', async ({ page }) => {
  await openTrend(page)
  await page.locator('.seg button', { hasText: '30 天' }).click()
  const wrap = page.locator('section[aria-label="體重"] .recharts-wrapper')
  const box = await wrap.boundingBox()
  await page.mouse.move(box!.x + box!.width - 8, box!.y + box!.height / 2)
  const big = page.locator('section[aria-label="體重"] .trend-read-big b')
  await expect(big).toHaveText('84.0')
  await expect(page.locator('.recharts-tooltip-cursor')).toHaveCount(2)
  await wrap.locator('.recharts-surface').dispatchEvent('touchend')
  await expect(big).toHaveText('79.7')
  await expect(page.locator('.recharts-tooltip-cursor')).toHaveCount(0)
})

test('範圍內一筆體脂都沒有：體脂卡不畫，改一行說明', async ({ page }) => {
  await openTrend(page, toRows(READINGS.map((r) => ({ ...r, fat: null }))))
  await expect(page.locator('section[aria-label="體重"] .recharts-wrapper')).toBeVisible()
  await expect(page.locator('section[aria-label="體脂"] .recharts-wrapper')).toHaveCount(0)
  await expect(page.locator('section[aria-label="體脂"]')).toContainText('這段期間沒有體脂紀錄')
})

test('範圍內沒有紀錄但歷史有：說明＋「看全部」可以切過去', async ({ page }) => {
  await openTrend(page, toRows([{ off: -200, kg: 70, fat: null }]))
  await expect(page.locator('[data-screen="weight-trend"]')).toContainText('這段期間沒有紀錄')
  await expect(tableRows(page)).toHaveCount(0)
  await page.getByRole('button', { name: '看全部' }).click()
  await expect(tableRows(page)).toHaveCount(1)
  await expect(page.locator('.seg button[aria-pressed="true"]')).toHaveText('全部')
})

test('只有一筆：畫得出來、不丟錯', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openTrend(page, toRows([{ off: 0, kg: 75, fat: 18 }]))
  await expect(page.locator('section[aria-label="體重"] .recharts-wrapper')).toBeVisible()
  await expect(tableRows(page)).toHaveCount(1)
  expect(errors, '一筆資料時頁面丟了例外').toEqual([])
})

const setDataDown = (page: Page, down: boolean) =>
  page.evaluate((d) => ((window as unknown as { __dataDown: boolean }).__dataDown = d), down)

test('連不上伺服器、手上又沒有資料可畫：說「連不上」，不能說成「還沒有體重紀錄」', async ({ page }) => {
  await openApp(page, {}, { ...FIX, weight: toRows(READINGS) })
  // 開設定頁之前先斷網：設定頁自己撈體重失敗，傳給趨勢頁的是 []（跟真的 0 筆長得一樣）
  await setDataDown(page, true)
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '體重趨勢' }).click()
  // v2.128 起讀取一次失敗就拋，骨架可能一閃而過，不再斷言它（原本要等 1＋2＋4 秒的退避）
  await expect(page.locator('[data-screen="weight-trend"]')).toContainText('連不上伺服器', { timeout: 20_000 })
  await expect(page.locator('[data-screen="weight-trend"]')).not.toContainText('還沒有體重紀錄')
  await expect(page.locator('.recharts-wrapper')).toHaveCount(0)
})

test('趨勢頁自己的請求失敗、但設定頁已經有資料：退回那一份，圖照畫', async ({ page }) => {
  await openApp(page, {}, { ...FIX, weight: toRows(READINGS) })
  await page.locator('.tab[aria-label="設定"]').click()
  await expect(page.locator('.entry-row .spark'), '設定頁的體重已載入').toBeVisible()
  await setDataDown(page, true)
  await page.locator('.entry-row', { hasText: '體重趨勢' }).click()
  await expect(page.locator('section[aria-label="體重"] .recharts-wrapper')).toBeVisible()
  await expect(tableRows(page)).toHaveCount(inRange(90))
  await expect(page.locator('[data-screen="weight-trend"]')).not.toContainText('連不上伺服器')
})

/* 計畫 vs 實際（v2.137，spec「減重回饋圈 review」④）。FIX 的目標是減重每週 0.5 kg＝每月 2.17 kg。 */
const weightCard = (page: Page) => page.locator('section[aria-label="體重"]')
const planPath = (page: Page) => weightCard(page).locator('path[stroke-dasharray="4 4"]')

test('計畫 vs 實際：讀數寫比計畫多少，圖上有一條虛線計畫線，穿出圖框的地方標「計畫：今天該在」', async ({ page }) => {
  await openTrend(page)
  await expect(weightCard(page).locator('.trend-read-sub')).toContainText('比計畫多 6.7 kg')
  await expect(weightCard(page).locator('.trend-legend')).toContainText('計畫')
  await expect(planPath(page), '計畫線沒畫出來').toHaveCount(1)
  // 計畫到今天是 73.0，在 Y 軸（照量到的值撐）之外：小標標在穿出底邊的地方，箭頭朝下
  await expect(weightCard(page).locator('.trend-chart-note')).toHaveText('計畫：今天該在 73.0 ↓')
})

test('自訂目標沒有速度：不畫計畫線，讀數只寫這段變化', async ({ page }) => {
  await openApp(page, {}, { ...FIX, weight: toRows(READINGS), profile: [{ ...FIX.profile[0], use_custom_targets: true, custom_kcal: 2000, custom_protein_g: 150, custom_fat_g: 60, custom_carb_g: 200 }] })
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '體重趨勢' }).click()
  await expect(weightCard(page).locator('.trend-read-sub')).toHaveText('90 天 +2.5 kg')
  await expect(planPath(page)).toHaveCount(0)
  await expect(weightCard(page).locator('.trend-chart-note')).toHaveCount(0)
})

/* 量法斷點（v2.138；v2.146 起只切體脂）。資料：體重 76，off −20 起 75；體脂 20，off −20 起整段 22（換電池），off −20 那筆標斷點。
   體重不在斷點重算：76 → 75 之後每 4 天差距乘 0.9^4，到今天剩 0.0798 → 75.1（在斷點重算的話會是 75.0）。 */
const BREAK_ROWS = [
  ...[-40, -36, -32, -28, -24].map((off) => ({ weight_kg: 76, measured_on: shiftIso(TODAY, off), body_fat_pct: 20, method_break: false })),
  { weight_kg: 75, measured_on: shiftIso(TODAY, -20), body_fat_pct: 22, method_break: true },
  ...[-16, -12, -8, -4, 0].map((off) => ({ weight_kg: 75, measured_on: shiftIso(TODAY, off), body_fat_pct: 22, method_break: false })),
]
const fatCard = (page: Page) => page.locator('section[aria-label="體脂"]')
const breakLine = (page: Page) => fatCard(page).locator('.recharts-reference-line')

test('量法斷點只切體脂：體脂圖一條細線標「換量法」、斷點前那段畫淡；體重圖沒有細線、趨勢一條到底', async ({ page }) => {
  await openTrend(page, BREAK_ROWS)
  await expect(breakLine(page)).toHaveCount(1)
  await expect(fatCard(page).locator('.trend-chart-note')).toHaveText('換量法')
  await expect(weightCard(page).locator('.recharts-reference-line'), '體重不看斷點').toHaveCount(0)
  await expect(page.locator(`tr[data-date="${shiftIso(TODAY, -20)}"] .trend-brk-tag`)).toHaveText('換量法')
  await expect(fatCard(page).locator('.trend-note')).toContainText('換量法，前後不能直接比')
  await expect(fatCard(page).locator('.trend-note'), '換了之後量了 6 筆，夠了就不寫筆數').not.toContainText('換了之後量了')
  // 體脂讀數只算新的那段：斷點後全是 22，趨勢就是 22.0（跨段平滑的話會被 20 拉低）
  await expect(fatCard(page).locator('.trend-subval')).toHaveText('22.0% 趨勢')
  const fatLines = fatCard(page).locator('path.recharts-line-curve[stroke="var(--ink-muted)"]')
  await expect(fatLines, '體脂趨勢要在斷點斷開（兩段各一條）').toHaveCount(2)
  await expect(fatLines.first(), '斷點前那段畫淡').toHaveAttribute('stroke-opacity', '0.45')
  await expect(weightCard(page).locator('path.recharts-line-curve[stroke="var(--accent)"]'), '體重趨勢一條到底').toHaveCount(1)
  await expect(weightCard(page).locator('.trend-read-big b'), '體重趨勢不在斷點重算').toHaveText('75.1')
})

test('量法斷點：明細表點日期展開開關，改了就存；取消後細線消失；體重讀數不受影響', async ({ page }) => {
  await openTrend(page, BREAK_ROWS.map((r) => ({ ...r, method_break: false })))
  await expect(breakLine(page)).toHaveCount(0)
  const big = weightCard(page).locator('.trend-read-big b')
  await expect(big).toHaveText('75.1')

  const day = shiftIso(TODAY, -20)
  const btn = page.locator(`tr[data-date="${day}"] .trend-row-btn`)
  await btn.click()
  await expect(btn).toHaveAttribute('aria-expanded', 'true')
  const box = page.getByRole('checkbox', { name: /體脂從這天起量法不同/ })
  await box.check()
  // stub 在頁面裡攔 fetch（不經過網路），寫入記在 __writes
  const patches = () =>
    page.evaluate(() =>
      (window as unknown as { __writes: { path: string; table: string; method: string; body: unknown }[] }).__writes.filter(
        (w) => w.table === 'weight' && w.method === 'PATCH',
      ),
    )
  await expect.poll(async () => (await patches()).length, '開關沒有存').toBe(1)
  const [w] = await patches()
  expect(decodeURIComponent(w.path)).toContain(`measured_on=eq.${day}`)
  expect(w.body).toEqual({ method_break: true })
  await expect(breakLine(page)).toHaveCount(1)
  await expect(big, '斷點只切體脂，體重讀數不變').toHaveText('75.1')

  await box.uncheck()
  await expect(breakLine(page)).toHaveCount(0)
})
