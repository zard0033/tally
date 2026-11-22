/* 吃、練、體重並排（spec「階段 4 丁」，v2.148）：體重趨勢頁體重卡下面那張。
   切週、平均、記完整、訓練次數的運算由 src/lib/weeklyCompare.test.ts 守；這裡驗畫面看得到的東西。
   日期釘在 2026-11-20（週五）：週的切法跟今天是星期幾有關，用真的今天會每天換答案。預期值全部手算。 */
import { test, expect, type Page } from '@playwright/test'
import { FIX } from './fixtures'
import { openAppAt } from './harness'
import type { StubOptions } from './stub'

const DAY = '2026-11-20'
// 90 天＝8/23 起；週一切：8/17 那週 … 11/16 那週，共 14 週
const WEEKS_90 = 14
// 30 天＝10/22 起：10/19 … 11/16，共 5 週
const WEEKS_30 = 5

const kcal = (eaten_on: string, meal: string, k: number, qty = 1) => ({ eaten_on, qty, kcal: k, meal })
const KCAL = [
  // 11/02 那週：4 天記完整、每天 2100 → 實心、平均 2100
  ...['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].flatMap((d) => [kcal(d, 'lunch', 900), kcal(d, 'dinner', 1200)]),
  // 11/09 那週：11/10 完整 1800、11/11 完整 2200（晚餐 600×2）、11/12 只有午餐不算 → 2 天、平均 2000、空心
  kcal('2026-11-10', 'lunch', 800), kcal('2026-11-10', 'dinner', 1000),
  kcal('2026-11-11', 'lunch', 1000), kcal('2026-11-11', 'dinner', 600, 2),
  kcal('2026-11-12', 'lunch', 900),
]

/* 體重：10/20 80.0（第一筆＝趨勢 80.0）、11/10 80.0（趨勢不變）、11/13 81.0 → 趨勢 80 + (1 − 0.9³) × 1 = 80.271。
   11/09 那週的變化＝80.271 − 80.0（這週以前最後一筆是 10/20）＝ +0.3 */
const WEIGHTS = [
  { weight_kg: 80, measured_on: '2026-10-20', body_fat_pct: null },
  { weight_kg: 80, measured_on: '2026-11-10', body_fat_pct: null },
  { weight_kg: 81, measured_on: '2026-11-13', body_fat_pct: null },
]

/* 訓練：11/11 兩次（有打勾組）、11/12 一次（組都沒打勾，不算）→ 11/09 那週 2 次 */
const W = (id: string, performed_on: string) => ({ id, performed_on, started_at: `${performed_on}T04:00:00.000Z`, ended_at: `${performed_on}T05:00:00.000Z`, routine_id: null })
const EX = FIX.exercises[0].id as string
const WE = (id: string, workout_id: string) => ({ id, workout_id, exercise_id: EX, position: 1, minutes: null })
const SET = (id: string, workout_exercise_id: string, done: boolean) => ({ id, workout_exercise_id, set_no: 1, weight_kg: 50, reps: 10, done, rpe: null })
const TRAIN = {
  workouts: [W('aaaaaaaa-0000-4000-8000-000000000001', '2026-11-11'), W('aaaaaaaa-0000-4000-8000-000000000002', '2026-11-11'), W('aaaaaaaa-0000-4000-8000-000000000003', '2026-11-12')],
  workout_exercises: [
    WE('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001'),
    WE('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002'),
    WE('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000003'),
  ],
  workout_sets: [
    SET('cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', true),
    SET('cccccccc-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', true),
    SET('cccccccc-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000003', false),
  ],
}

const FIXTURE = { ...FIX, weight: WEIGHTS, kcalWindow: KCAL, ...TRAIN } as unknown as typeof FIX

async function openCard(page: Page, opts: StubOptions = {}, fix = FIXTURE) {
  await openAppAt(page, DAY, opts, fix)
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '體重趨勢' }).click()
  await expect(page.locator('[data-screen="weight-trend"]')).toBeVisible()
  await page.mouse.move(0, 0)
  const card = page.locator('section.wk-card')
  await expect(card.locator('.wk-stats')).toBeVisible()
  return card
}

test('讀數預設上週：平均只算記完整的天、訓練次數、體重趨勢變化', async ({ page }) => {
  const card = await openCard(page)
  await expect(card.locator('.wk-read-k')).toHaveText('上週（11/9–11/15）')
  const stats = card.locator('.wk-stats > div')
  await expect(stats.nth(0)).toContainText('2000卡')
  await expect(stats.nth(0)).toContainText('每天平均（2 天有記午晚餐）')
  await expect(stats.nth(1)).toContainText('2次')
  await expect(stats.nth(2)).toContainText('+0.3kg')
  // 這週以前最後一筆是 10/20，到 11/13 相隔 24 天 → 3 週：變化是三週累積的，要寫出來
  await expect(stats.nth(2)).toContainText('平均體重・3 週來')
})

test('三排對齊：體重排的點落在同一欄長條的中心，選取底色三排都有寬度', async ({ page }) => {
  const card = await openCard(page)
  const charts = card.locator('.recharts-wrapper')
  await charts.first().scrollIntoViewIfNeeded()
  // 11/09 那週：體重排最後一個點、攝取排唯一的空心長條
  const dot = (await charts.nth(0).locator('.recharts-line-dot').last().boundingBox())!
  const bar = (await card.locator('.wk-bar.is-thin').boundingBox())!
  expect(Math.abs(dot.x + dot.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(1.5)
  for (let i = 0; i < 3; i++) {
    const area = (await charts.nth(i).locator('.recharts-reference-area-rect').boundingBox())!
    expect(area.width, `第 ${i + 1} 排的選取底色`).toBeGreaterThan(10)
    expect(Math.abs(area.x + area.width / 2 - (bar.x + bar.width / 2)), `第 ${i + 1} 排的底色對準上週那欄`).toBeLessThan(1.5)
  }
})

test('鍵盤：卡片裡只有攝取那張圖能聚焦、有名字；方向鍵換週', async ({ page }) => {
  const card = await openCard(page)
  const focusable = card.locator('svg[tabindex="0"]')
  await expect(focusable).toHaveCount(1)
  await expect(focusable.locator('title')).toHaveText('每週平均攝取；方向鍵切換週，上面的讀數跟著換')
  await focusable.focus()
  await page.keyboard.press('ArrowRight')
  await expect(card.locator('.wk-read-k')).toHaveText(/那週$/)
})

test('攝取排：記完整 ≥4 天實心、不到 4 天空心、沒記的週寫「沒記」；訓練一次一格', async ({ page }) => {
  const card = await openCard(page)
  await expect(card.locator('.wk-bar:not(.is-thin)')).toHaveCount(1) // 11/02 那週
  await expect(card.locator('.wk-bar.is-thin')).toHaveCount(1) // 11/09 那週
  // 連續沒記的一段只寫一次：8/17–10/26 那 11 週一個、進行中的 11/16 那週一個
  await expect(card.locator('text.wk-gap')).toHaveCount(2)
  await expect(card.locator('text.wk-gap').first()).toHaveText('沒記')
  await expect(card.locator('.wk-sq')).toHaveCount(2) // 11/12 那次沒打勾，不算
  await expect(card.locator('.wk-band', { hasText: '平均攝取' })).toContainText('目標')
  await expect(card.locator('.recharts-reference-line-line[stroke-dasharray="4 3"]')).toHaveCount(1)
})

test('指到別週：讀數換那週，移開回到上週', async ({ page }) => {
  const card = await openCard(page)
  const chart = card.locator('.recharts-wrapper').nth(1) // 攝取排
  await chart.scrollIntoViewIfNeeded() // 卡片在體重卡下面，不捲進畫面的話滑鼠移到視窗外
  const box = (await chart.boundingBox())!
  // 繪圖區＝左邊 Y 軸 36、右邊留 8；11/02 那週是第 12 欄（索引 11）
  const plotW = box.width - 36 - 8
  await page.mouse.move(box.x + 36 + (11 + 0.5) * (plotW / WEEKS_90), box.y + box.height / 2)
  await expect(card.locator('.wk-read-k')).toHaveText('11/2–11/8 那週')
  await expect(card.locator('.wk-stats > div').nth(0)).toContainText('2100卡')
  await expect(card.locator('.wk-stats > div').nth(0)).toContainText('4 天有記午晚餐')
  await expect(card.locator('.wk-stats > div').nth(2)).toContainText('這週沒量體重')
  await page.mouse.move(0, 0)
  await expect(card.locator('.wk-read-k')).toHaveText('上週（11/9–11/15）')
})

test('週明細表：新到舊、進行中的這週有標；範圍切到 30 天跟著變', async ({ page }) => {
  const card = await openCard(page)
  await card.locator('.wk-details summary').click()
  const rows = card.locator('.wk-table tbody tr')
  await expect(rows).toHaveCount(WEEKS_90)
  await expect(rows.first()).toContainText('11/16')
  await expect(rows.first()).toContainText('進行中')
  await expect(rows.nth(1)).toContainText('2000 卡')
  await expect(rows.nth(1)).toContainText('2 次')
  await expect(rows.nth(1)).toContainText('+0.3 kg3 週來')
  await expect(rows.last()).toContainText('8/23') // 第一週被範圍切掉一半，寫範圍內的第一天
  await page.locator('.seg button', { hasText: '30 天' }).click()
  await expect(rows).toHaveCount(WEEKS_30)
})

test('飲食紀錄載不到：這張卡說連不上，體重卡照常', async ({ page }) => {
  await openAppAt(page, DAY, { kcalFail: true }, FIXTURE)
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '體重趨勢' }).click()
  await expect(page.locator('section.wk-card')).toContainText('連不上伺服器，載不到飲食紀錄')
  await expect(page.locator('section[aria-label="體重"] .recharts-wrapper')).toBeVisible()
})
