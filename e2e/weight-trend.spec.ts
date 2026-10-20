/* 體重趨勢頁（spec.md「體重趨勢圖」）。recharts 的 SVG 內部不鎖，只驗使用者看得到、讀得出的東西：
   卡片與明細表有沒有出現、範圍切換後明細列數對不對、7 日平均的端點數字、十字線同步與 tooltip 讀數、
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

test('7 日平均的端點標籤是最後一天往前 7 日曆日的平均（80、82、84 → 82.0）', async ({ page }) => {
  await openTrend(page)
  await expect(page.locator('section[aria-label="體重"] .trend-endlabel')).toHaveText('82.0')
})

test('指標移到體脂圖：十字線同步，浮動讀數出現在體重圖並列出三個值', async ({ page }) => {
  await openTrend(page)
  // 30 天：一天約 9px，指標對得準；90 天一天只有 3px，差幾像素就會落到前兩天
  await page.locator('.seg button', { hasText: '30 天' }).click()
  const fat = page.locator('section[aria-label="體脂"] .recharts-wrapper')
  const box = await fat.boundingBox()
  expect(box, '拿不到體脂圖座標').not.toBeNull()
  // 圖的右緣（扣掉 margin.right 8px）是今天（X 軸終點）
  await page.mouse.move(box!.x + box!.width - 8, box!.y + box!.height / 2)
  const tip = page.locator('.trend-tip')
  await expect(tip).toHaveCount(1)
  await expect(tip).toContainText('84.0 kg')
  await expect(tip).toContainText('82.0 kg')
  await expect(tip).toContainText('20.5 %')
  await expect(page.locator('.recharts-tooltip-cursor')).toHaveCount(2)
})

test('範圍內一筆體脂都沒有：體脂卡不畫，改一行說明', async ({ page }) => {
  await openTrend(page, toRows(READINGS.map((r) => ({ ...r, fat: null }))))
  await expect(page.locator('section[aria-label="體重"] .recharts-wrapper')).toBeVisible()
  await expect(page.locator('section[aria-label="體脂"]')).toHaveCount(0)
  await expect(page.locator('[data-screen="weight-trend"]')).toContainText('這段期間沒有體脂紀錄')
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
