/* 訓練分析 A（動作進度；spec.md「階段 4 甲」AC 8）。recharts 的 SVG 內部不鎖，只驗使用者看得到、讀得出的東西：
   入口列、列表的順序與數字、單一動作頁的最佳值／最近一次／明細列數／範圍切換、十字線讀數、空狀態、離線。
   e1RM 運算本身由 src/lib/strength.test.ts 守，這裡的預期值全部從固定資料手算（Epley：重量 ×（1＋次數/30）），
   不呼叫被測的函式。獨立成檔因為 fixture 要有多次訓練。 */
import { test, expect, type Page } from '@playwright/test'
import { FIX, TODAY } from './fixtures'
import { openApp, shiftIso } from './harness'

const SQ = 'aaaaaaaa-0000-4000-8000-000000000001' // 深蹲
const BP = 'aaaaaaaa-0000-4000-8000-000000000002' // 臥推
const PU = 'aaaaaaaa-0000-4000-8000-000000000003' // 引體向上（0 kg，不算）
const UNUSED = 'aaaaaaaa-0000-4000-8000-000000000004' // 沒有任何紀錄

const ex = (id: string, name: string, muscle_group: string) =>
  ({ id, name, muscle_group, tips: null, archived: false, created_at: '2026-10-01T00:00:00.000Z' })

/* 固定資料（off＝距今天數）：
   深蹲 off -120（90 天外，只有「全部」看得到）：100×5 → 116.7
        off -10：70×8 → 88.7　　off -5：75×6 → 90.0　　off -1：80×5（93.3）與 60×10（80.0）→ 取 93.3（80×5）
   臥推 off -2：60×10 → 80.0；另有一組 100×12（超過 10 下不算）與一組沒打勾的 90×5
   引體向上 off -2：0 kg × 8 → 不算
   「沒有紀錄」動作：完全沒有組 */
interface Sess { id: string; off: number; ex: string; sets: [number, number, boolean][] }
const SESSIONS: Sess[] = [
  { id: 'w-a', off: -120, ex: SQ, sets: [[100, 5, true]] },
  { id: 'w-b', off: -10, ex: SQ, sets: [[70, 8, true]] },
  { id: 'w-c', off: -5, ex: SQ, sets: [[75, 6, true]] },
  { id: 'w-d', off: -1, ex: SQ, sets: [[60, 10, true], [80, 5, true]] },
  { id: 'w-e', off: -2, ex: BP, sets: [[60, 10, true], [100, 12, true], [90, 5, false]] },
  { id: 'w-f', off: -2, ex: PU, sets: [[0, 8, true]] },
]

function build(sessions: Sess[]): typeof FIX {
  const workouts: Record<string, unknown>[] = []
  const entries: Record<string, unknown>[] = []
  const sets: Record<string, unknown>[] = []
  for (const s of sessions) {
    const day = shiftIso(TODAY, s.off)
    workouts.push({ id: s.id, performed_on: day, started_at: `${day}T08:00:00.000Z`, ended_at: `${day}T09:00:00.000Z`, routine_id: null })
    entries.push({ id: `${s.id}-e`, workout_id: s.id, exercise_id: s.ex, position: 0 })
    s.sets.forEach(([w, r, done], i) =>
      sets.push({ id: `${s.id}-s${i}`, workout_exercise_id: `${s.id}-e`, set_no: i + 1, weight_kg: w, reps: r, done }),
    )
  }
  return {
    ...FIX,
    exercises: [ex(SQ, '槓鈴深蹲', 'legs'), ex(BP, '槓鈴臥推', 'chest'), ex(PU, '引體向上', 'back'), ex(UNUSED, '腿推舉', 'legs')],
    workouts,
    workout_exercises: entries,
    workout_sets: sets,
  }
}

async function openAnalysis(page: Page, fix = build(SESSIONS)) {
  await openApp(page, {}, fix)
  await page.locator('.tab[aria-label="訓練"]').click()
  await page.locator('[data-action="open-analysis"]').click()
  await expect(page.locator('[data-screen="analysis"]')).toBeVisible()
}

const openExercise = async (page: Page, id: string) => {
  await page.locator(`[data-screen="analysis"] .tr-row[data-exercise-id="${id}"]`).click()
  await expect(page.locator('[data-screen="analysis-exercise"]')).toBeVisible()
}
const tableRows = (page: Page) => page.locator('.trend-table tbody tr')

test('訓練頁有「訓練分析」入口列，副標算有進度的動作數；點了進整頁、底部列收起', async ({ page }) => {
  await openApp(page, {}, build(SESSIONS))
  await page.locator('.tab[aria-label="訓練"]').click()
  const entry = page.locator('[data-screen="training"] [data-action="open-analysis"]')
  await expect(entry).toBeVisible()
  // 深蹲、臥推有效；引體向上 0 kg 不算；腿推舉沒有紀錄 → 2 個
  await expect(entry.locator('.sub')).toHaveText('2 個動作有進度 · 估算 1RM')
  await entry.click()
  await expect(page.locator('[data-screen="analysis"] h1')).toHaveText('訓練分析')
  await expect(page.locator('.tab[aria-label="設定"]'), '整頁接管畫面，底部列收起').toBeHidden()
  await page.getByRole('button', { name: '返回訓練' }).click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
})

test('沒有任何可估算的紀錄：入口副標與整頁都說還沒有', async ({ page }) => {
  await openApp(page, {}, build([]))
  await page.locator('.tab[aria-label="訓練"]').click()
  await expect(page.locator('[data-action="open-analysis"] .sub')).toHaveText('還沒有可估算的紀錄')
  await page.locator('[data-action="open-analysis"]').click()
  await expect(page.locator('[data-screen="analysis"]')).toContainText('還沒有可估算的紀錄')
  await expect(page.locator('[data-section="progress-list"]')).toHaveCount(0)
})

test('列表：只列有有效組的動作、依最近練的排、數字是歷來最佳 e1RM', async ({ page }) => {
  await openAnalysis(page)
  const rows = page.locator('[data-section="progress-list"] .tr-row')
  await expect(rows).toHaveCount(2)
  // 深蹲最近 off -1、臥推 off -2 → 深蹲在前。深蹲歷來最佳＝100×5＝116.7（那次在 90 天外，列表仍算）
  await expect(rows.nth(0).locator('.nm')).toHaveText('槓鈴深蹲')
  await expect(rows.nth(0).locator('.sub')).toContainText('4 次訓練')
  await expect(rows.nth(0).locator('.an-val')).toContainText('116.7')
  await expect(rows.nth(1).locator('.nm')).toHaveText('槓鈴臥推')
  await expect(rows.nth(1).locator('.sub')).toContainText('1 次訓練')
  // 臥推：60×10＝80.0；100×12 超過 10 下、90×5 沒打勾，都不能進來
  await expect(rows.nth(1).locator('.an-val')).toContainText('80.0')
  await expect(page.locator('[data-screen="analysis"]')).not.toContainText('引體向上')
  await expect(page.locator('[data-screen="analysis"]')).not.toContainText('腿推舉')
})

test('單一動作：最佳值、最近一次、折線與明細（預設 90 天，90 天外那次不在）', async ({ page }) => {
  await openAnalysis(page)
  await openExercise(page, SQ)
  const screen = page.locator('[data-screen="analysis-exercise"]')
  await expect(screen.locator('h1')).toHaveText('槓鈴深蹲')
  await expect(screen.locator('.seg button[aria-pressed="true"]')).toHaveText('90 天')
  // 歷來最佳不隨範圍變：116.7；最近一次是 off -1 那次的最大值 93.3（80×5）
  await expect(screen.locator('.an-hero div').nth(0)).toContainText('116.7')
  await expect(screen.locator('.an-hero div').nth(1)).toContainText('93.3')
  await expect(screen.locator('section[aria-label="e1RM"] .recharts-wrapper')).toBeVisible()
  await expect(tableRows(page)).toHaveCount(3)
  // 新到舊；一次訓練取 e1RM 最大的那組：off -1 是 80×5（93.3），不是 60×10（80.0）
  await expect(tableRows(page).nth(0)).toContainText('80 kg × 5')
  await expect(tableRows(page).nth(0)).toContainText('93.3 kg')
  await expect(tableRows(page).nth(1)).toContainText('75 kg × 6')
  await expect(tableRows(page).nth(1)).toContainText('90.0 kg')
  await expect(tableRows(page).nth(2)).toContainText('70 kg × 8')
  await expect(tableRows(page).nth(2)).toContainText('88.7 kg')
  // 最後一點標出數字
  await expect(screen.locator('.trend-endlabel')).toHaveText('93.3')
})

test('範圍切換：30 天／全部，明細列數跟著變，全部才看得到 90 天外那次', async ({ page }) => {
  await openAnalysis(page)
  await openExercise(page, SQ)
  await page.locator('.seg button', { hasText: '30 天' }).click()
  await expect(tableRows(page)).toHaveCount(3) // off -10、-5、-1 都在 30 天內
  await page.locator('.seg button', { hasText: '全部' }).click()
  await expect(tableRows(page)).toHaveCount(4)
  await expect(tableRows(page).last()).toContainText('100 kg × 5')
  await expect(tableRows(page).last()).toContainText('116.7 kg')
  await page.locator('.seg button', { hasText: '90 天' }).click()
  await expect(tableRows(page)).toHaveCount(3)
})

test('範圍內沒有紀錄但歷史有：說明＋「看全部」可以切過去，最佳值仍在', async ({ page }) => {
  const fix = build([{ id: 'w-old', off: -200, ex: SQ, sets: [[100, 5, true]] }])
  await openAnalysis(page, fix)
  await openExercise(page, SQ)
  const screen = page.locator('[data-screen="analysis-exercise"]')
  await expect(screen).toContainText('這段期間沒有紀錄')
  await expect(screen.locator('.an-hero div').nth(0)).toContainText('116.7')
  await expect(tableRows(page)).toHaveCount(0)
  await expect(screen.locator('section[aria-label="明細"]'), '沒有紀錄時不該有空的明細卡').toHaveCount(0)
  await page.getByRole('button', { name: '看全部' }).click()
  await expect(tableRows(page)).toHaveCount(1)
  await expect(screen.locator('.seg button[aria-pressed="true"]')).toHaveText('全部')
})

test('只有 1 次訓練：畫得出點、不丟例外、說明還畫不出線', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openAnalysis(page, build([{ id: 'w-one', off: -3, ex: BP, sets: [[60, 10, true]] }]))
  await openExercise(page, BP)
  const screen = page.locator('[data-screen="analysis-exercise"]')
  await expect(screen.locator('section[aria-label="e1RM"] .recharts-wrapper')).toBeVisible()
  await expect(screen).toContainText('只有 1 次訓練，再練一次就畫得出線')
  await expect(screen.locator('.trend-endlabel')).toHaveText('80.0')
  await expect(tableRows(page)).toHaveCount(1)
  expect(errors, '一個點時頁面丟了例外').toEqual([])
})

test('指標移到圖上：十字線出現，讀數列出 e1RM 與最重一組', async ({ page }) => {
  await openAnalysis(page)
  await openExercise(page, SQ)
  // 30 天：一天約 10px，指標對得準；90 天一天只有 3px
  await page.locator('.seg button', { hasText: '30 天' }).click()
  const chart = page.locator('section[aria-label="e1RM"] .recharts-wrapper')
  const box = await chart.boundingBox()
  expect(box, '拿不到圖的座標').not.toBeNull()
  // 圖的右緣（扣掉 margin.right 8px）是今天；最後一點在昨天（off -1），往左約一天的寬度
  const plotW = box!.width - 36 - 8
  const x = box!.x + box!.width - 8 - plotW / 29
  await page.mouse.move(x, box!.y + box!.height / 2)
  const tip = page.locator('.trend-tip')
  await expect(tip).toHaveCount(1)
  await expect(tip).toContainText('93.3 kg')
  await expect(tip).toContainText('80 × 5')
  await expect(page.locator('.recharts-tooltip-cursor')).toHaveCount(1)
})

test('單一動作頁返回回到列表', async ({ page }) => {
  await openAnalysis(page)
  await openExercise(page, BP)
  await page.getByRole('button', { name: '返回訓練分析' }).click()
  await expect(page.locator('[data-screen="analysis"]')).toBeVisible()
  await expect(page.locator('[data-section="progress-list"]')).toBeVisible()
})

test('連不上伺服器：資料來自本機底，列表與單一動作頁照常顯示', async ({ page }) => {
  await openApp(page, {}, build(SESSIONS))
  await page.locator('.tab[aria-label="訓練"]').click()
  await expect(page.locator('[data-action="open-analysis"]')).toBeVisible()
  await page.evaluate(() => {
    ;(window as unknown as { __dataDown: boolean }).__dataDown = true
    window.dispatchEvent(new Event('online'))
  })
  // 等到重新載入真的失敗（postgrest-js 的 GET 會重試約 1＋2＋4 秒），之後看到的才是本機底而不是記憶體裡剛載好的那份
  await expect(page.locator('[data-screen="training"] .tr-status')).toContainText('連不上伺服器，顯示的是本機資料', { timeout: 15_000 })
  await page.locator('[data-action="open-analysis"]').click()
  await expect(page.locator('[data-section="progress-list"] .tr-row')).toHaveCount(2)
  await openExercise(page, SQ)
  await expect(tableRows(page)).toHaveCount(3)
  await expect(page.locator('[data-screen="analysis-exercise"] .an-hero div').nth(0)).toContainText('116.7')
})
