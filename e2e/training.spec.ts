/* 訓練分頁（階段 2 第一輪第 2a 段）：分頁進得去、資料從本機底讀得到、連不上伺服器時講清楚、
   第一次開時預填 16 個動作。開始訓練／記組／離線記錄在後面的段落補。
   fetch 全 stub；注意 stub 的寫入不落地（寫進去的列下一次 GET 不會出現）。 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { gotoDate, leg, openApp, shiftIso, slowDrag } from './harness'
import { FIX, TODAY } from './fixtures'

const EX_ID = '11111111-1111-4111-8111-111111111111'

/** 今天有一次已結束的訓練：1 個動作、2 組各 60×12（已打勾）、36 分鐘。 */
const WITH_WORKOUT: typeof FIX = {
  ...FIX,
  workouts: [
    {
      id: 'w-1',
      performed_on: TODAY,
      started_at: `${TODAY}T08:00:00.000Z`,
      ended_at: `${TODAY}T08:36:00.000Z`,
      routine_id: null,
    },
  ],
  workout_exercises: [{ id: 'we-1', workout_id: 'w-1', exercise_id: EX_ID, position: 0 }],
  workout_sets: [
    { id: 's-1', workout_exercise_id: 'we-1', set_no: 1, weight_kg: 60, reps: 12, done: true },
    { id: 's-2', workout_exercise_id: 'we-1', set_no: 2, weight_kg: 60, reps: 12, done: true },
  ],
}

test('訓練分頁進得去：日期元件在、這天沒有訓練、分頁選中態正確', async ({ page }) => {
  await openApp(page)
  await page.locator('.tab[aria-label="訓練"]').click()
  const screen = page.locator('[data-screen="training"]')
  await expect(screen).toBeVisible()
  await expect(screen.locator('.datectl')).toBeVisible()
  await expect(screen.getByText('這天沒有訓練紀錄')).toBeVisible()
  await expect(page.locator('.tab[aria-current="page"]')).toHaveAttribute('aria-label', '訓練')
  // 沒有任何異常時不顯示同步細條（它不是常駐的裝飾）
  await expect(screen.locator('.tr-status')).toHaveCount(0)
})

test('已記的訓練從本機底讀得到：動作數、組數、訓練量、時長', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await page.locator('.tab[aria-label="訓練"]').click()
  const row = page.locator('[data-screen="training"] .tr-row[data-workout-id="w-1"]')
  await expect(row).toBeVisible()
  await expect(row.locator('.nm')).toHaveText('1 個動作')
  await expect(row.locator('.sub')).toHaveText('2/2 組 · 1,440 kg · 36 分')
  // 有訓練的日子在日期元件上有小點
  await expect(page.locator('[data-screen="training"] .datectl-day.is-today')).toHaveClass(/is-marked/)
})

test('進行中的訓練與已完成的分開列（App 重開後進行中的那次要認得出來）', async ({ page }) => {
  const fix: typeof FIX = {
    ...WITH_WORKOUT,
    workouts: [
      ...WITH_WORKOUT.workouts,
      { id: 'w-live', performed_on: TODAY, started_at: `${TODAY}T09:00:00.000Z`, ended_at: null, routine_id: null },
    ],
  }
  await openApp(page, {}, fix)
  await page.locator('.tab[aria-label="訓練"]').click()
  const screen = page.locator('[data-screen="training"]')
  const live = screen.locator('.tr-row[data-workout-id="w-live"]')
  const done = screen.locator('.tr-row[data-workout-id="w-1"]')
  await expect(live).toBeVisible()
  await expect(done).toBeVisible()
  // 各在自己的標題底下：進行中那段的卡片只含 w-live，已完成那段只含 w-1
  await expect(screen.locator('.tr-sec', { hasText: '進行中' })).toHaveCount(1)
  await expect(screen.locator('.tr-sec', { hasText: '已完成' })).toHaveCount(1)
  await expect(screen.locator('.tr-sec:has-text("進行中") + .tr-card .tr-row')).toHaveAttribute('data-workout-id', 'w-live')
  await expect(screen.locator('.tr-sec:has-text("已完成") + .tr-card .tr-row')).toHaveAttribute('data-workout-id', 'w-1')
})

test('連不上伺服器：訓練分頁照常顯示本機的資料，並明講是本機資料', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await page.locator('.tab[aria-label="訓練"]').click()
  const row = page.locator('[data-screen="training"] .tr-row[data-workout-id="w-1"]')
  await expect(row).toBeVisible()

  // 把資料請求切斷，再給一個「網路回來」的提示——這會觸發同步，同步讀不到伺服器。
  // 讀不到要等：postgrest-js 對 GET 內建重試（約 1＋2＋4 秒），七張表約 7–8 秒才放棄。
  // 畫面上的資料一直是本機的、不受影響，晚到的只是這句說明，所以 timeout 放寬到 15 秒。
  await page.evaluate(() => {
    ;(window as unknown as { __dataDown: boolean }).__dataDown = true
    window.dispatchEvent(new Event('online'))
  })
  const status = page.locator('[data-screen="training"] .tr-status')
  await expect(status).toContainText('連不上伺服器，顯示的是本機資料', { timeout: 15_000 })
  await expect(row, '連不上伺服器後，已載入的訓練不該消失').toBeVisible()
})

test('第一次開、伺服器上沒有任何動作：預填 16 個，且是 insert-ignore（不蓋掉改過的）', async ({ page }) => {
  await openApp(page, {}, { ...FIX, exercises: [] })
  type W = { table: string; method: string; path: string; body: Record<string, unknown> | Record<string, unknown>[] }
  const posted = async () => {
    const writes = await page.evaluate(() => (window as unknown as { __writes: W[] }).__writes)
    return writes.filter((w) => w.table === 'exercises' && w.method === 'POST')
  }
  await expect.poll(async () => (await posted()).length, { timeout: 8000 }).toBeGreaterThanOrEqual(16)

  const all = await posted()
  const ids = new Set(all.map((w) => String((Array.isArray(w.body) ? w.body[0] : w.body).id)))
  expect(ids.size, '16 個預填動作的 id 應互不相同').toBe(16)
  expect(all.every((w) => w.path.includes('on_conflict=id')), '預填要以 id 為衝突鍵').toBe(true)
  const names = all.map((w) => String((Array.isArray(w.body) ? w.body[0] : w.body).name))
  expect(names).toContain('腿推舉')
  expect(names).toContain('腹部捲曲機')
})

/* ═══════════ 開始訓練 → 記組 → 完成（第一輪 2b） ═══════════ */

type TrainWindow = {
  __dataDown: boolean
  __trainRows: (table: string) => Record<string, unknown>[]
}

const trainRows = (page: Page, table: string) =>
  page.evaluate((t) => (window as unknown as TrainWindow).__trainRows(t), table)
const setOffline = (page: Page, down: boolean) =>
  page.evaluate((d) => {
    ;(window as unknown as TrainWindow).__dataDown = d
    if (!d) window.dispatchEvent(new Event('online'))
  }, down)

async function openTraining(page: Page) {
  await page.locator('.tab[aria-label="訓練"]').click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
}

/** 主 CTA → 開始訓練 sheet → 空白開始，落在訓練中整頁。 */
async function startBlank(page: Page) {
  await page.getByRole('button', { name: '開始訓練' }).click()
  await page.locator('[data-action="start-blank"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
}

async function addExercise(page: Page, name: string) {
  await page.locator('.tr-bottom .tr-secondary').click()
  await page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: name }).click()
  await expect(page.locator('.ex .set').first()).toBeVisible()
  // 等選單收完再做下一步：收合動畫期間的點擊會落在正在收的 sheet 上（pointerdown 在按鈕、pointerup 在 sheet）
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
}

const stat = (page: Page, key: 'time' | 'volume' | 'sets') => page.locator(`[data-stat="${key}"]`)
const tick = (page: Page, n: number) => page.locator('.ex .set').nth(n).locator('.tr-check').click()

test('開始訓練：空白開始、加動作預填上次實際完成的值、打勾累計訓練量', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  // 訓練中整頁接管：底部列（分頁與 CTA）收起來，避免流汗時誤觸離開
  await expect(page.locator('.bottom-bar')).toHaveCount(0)
  await expect(stat(page, 'sets')).toHaveText('0/0')

  await addExercise(page, '腿推舉')
  const first = page.locator('.ex .set').first()
  await expect(first.locator('.w'), '重量應預填上次實際完成的 60').toHaveText('60')
  await expect(first.locator('.r'), '次數應預填上次的 12').toHaveText('12')
  await expect(page.locator('.ex .set')).toHaveCount(2)
  await expect(stat(page, 'sets')).toHaveText('0/2')
  await expect(stat(page, 'volume'), '預填的值還沒打勾，不算訓練量').toHaveText('0')

  await tick(page, 0)
  await expect(stat(page, 'volume')).toHaveText('720')
  await expect(stat(page, 'sets')).toHaveText('1/2')
  await tick(page, 1)
  await expect(stat(page, 'volume')).toHaveText('1,440')
  await expect(stat(page, 'sets')).toHaveText('2/2')
  await expect(page.locator('.ex .set').first()).toHaveClass(/done/)
})

const setSheet = (page: Page) => page.locator('[data-screen="set-sheet"]')

/** 點某組的重量或次數開組編輯 sheet，等它落定。 */
async function openSetSheet(page: Page, setIndex: number, field: 'w' | 'r' = 'w') {
  await page.locator('.ex .set').nth(setIndex).locator(`.${field}`).click()
  await expect(setSheet(page)).toBeVisible()
}

/** 關掉 sheet 並等它從畫面上卸載（spring 約 1 秒）：之後才能放心點背景頁。 */
async function closeSetSheet(page: Page) {
  await setSheet(page).getByRole('button', { name: '完成', exact: true }).click()
  await expect(setSheet(page)).toHaveCount(0)
}

test('調整：點數字開組編輯 sheet，± 與大數字輸入都立即寫入；不合法的輸入放回原值、不截斷成別的數字', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await expect(stat(page, 'volume')).toHaveText('720')

  const first = page.locator('.ex .set').first()
  await expect(setSheet(page)).toHaveCount(0)
  await openSetSheet(page, 0)
  const sheet = setSheet(page)
  await expect(sheet.getByRole('heading', { name: '腿推舉 · 第 1 組' })).toBeVisible()

  await sheet.getByRole('button', { name: '重量加 2.5 公斤' }).click()
  await expect(first.locator('.w'), '背景頁該列同步更新，沒有儲存鈕').toHaveText('62.5')
  await expect(stat(page, 'volume')).toHaveText('750') // 62.5 × 12

  // 點中間的大數字才叫出鍵盤
  await expect(sheet.getByRole('textbox')).toHaveCount(0)
  await sheet.getByRole('button', { name: '次數，點一下直接輸入' }).click()
  const reps = sheet.getByRole('textbox', { name: '次數' })
  await reps.fill('8')
  await reps.press('Enter')
  await expect(first.locator('.r')).toHaveText('8')
  await expect(stat(page, 'volume')).toHaveText('500') // 62.5 × 8

  const weight = async (raw: string) => {
    await sheet.getByRole('button', { name: '重量，點一下直接輸入' }).click()
    const input = sheet.getByRole('textbox', { name: '重量' })
    await input.fill(raw)
    await input.press('Enter')
  }
  await weight('abc')
  await expect(first.locator('.w'), '打不出數字的輸入要放回原值').toHaveText('62.5')
  await weight('1500') // 超過 DDL 的 1000 上限
  await expect(first.locator('.w'), '超過上限的輸入不寫入、放回原值').toHaveText('62.5')
  await expect(stat(page, 'volume')).toHaveText('500')

  // 第一下 Esc 只取消輸入，不連 sheet 一起關掉
  await sheet.getByRole('button', { name: '重量，點一下直接輸入' }).click()
  await sheet.getByRole('textbox', { name: '重量' }).fill('99')
  await page.keyboard.press('Escape')
  await expect(sheet.getByRole('textbox')).toHaveCount(0)
  await expect(sheet).toBeVisible()
  await expect(first.locator('.w')).toHaveText('62.5')
})

test('組編輯 sheet：上次的籤點了套用整組；關閉後焦點回到被點的那顆；X、Esc 都能關', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const first = page.locator('.ex .set').first()

  await openSetSheet(page, 0)
  const sheet = setSheet(page)
  const chips = sheet.getByRole('group', { name: '上次' }).getByRole('button')
  await expect(chips, '上次實際完成的各組（60×12 兩組）').toHaveText(['60 × 12', '60 × 12'])
  await expect(chips.first(), '目前這一組對到的那顆標起來').toHaveClass(/is-current/)

  await sheet.getByRole('button', { name: '重量加 5 公斤' }).click()
  await sheet.getByRole('button', { name: '次數減 5' }).click()
  await expect(first.locator('.w')).toHaveText('65')
  await expect(first.locator('.r')).toHaveText('7')
  await expect(chips.first()).not.toHaveClass(/is-current/)
  await chips.first().click()
  await expect(first.locator('.w'), '點籤＝重量與次數一起套到這一組').toHaveText('60')
  await expect(first.locator('.r')).toHaveText('12')

  await closeSetSheet(page)
  await expect(first.locator('.w'), '焦點回到被點的那顆數字鈕').toBeFocused()

  await openSetSheet(page, 1, 'r')
  await setSheet(page).getByRole('button', { name: '關閉' }).click()
  await expect(setSheet(page)).toHaveCount(0)
  await expect(page.locator('.ex .set').nth(1).locator('.r')).toBeFocused()

  await openSetSheet(page, 0)
  await page.keyboard.press('Escape')
  await expect(setSheet(page)).toHaveCount(0)
})

test('沒做過的動作：上次寫「沒有紀錄」', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '坐姿划船')
  await openSetSheet(page, 0)
  await expect(setSheet(page).getByText('沒有紀錄')).toBeVisible()
  await expect(setSheet(page).getByRole('group', { name: '上次' })).toHaveCount(0)
})

test('同步剩餘組數：只改這一組後面、還沒打勾的組，已打勾的不動；沒有剩餘組時 disabled', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const card = page.locator('.ex').first()
  await card.getByRole('button', { name: '新增一組' }).click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await tick(page, 1) // 第 2 組已完成，同步時不能動它

  await openSetSheet(page, 0)
  const sheet = setSheet(page)
  await sheet.getByRole('button', { name: '重量加 5 公斤' }).click()
  await sheet.getByRole('button', { name: '次數加 1' }).click()
  const sync = sheet.locator('.set-sync')
  await expect(sync, '只有第 3 組還沒打勾').toHaveText('同步剩餘 1 組')
  await sync.click()
  await expect(sync).toHaveText('已同步 ✓')
  await closeSetSheet(page)

  const sets = page.locator('.ex .set')
  await expect(sets.nth(2).locator('.w')).toHaveText('65')
  await expect(sets.nth(2).locator('.r')).toHaveText('13')
  await expect(sets.nth(1).locator('.w'), '已打勾的不動').toHaveText('60')
  await expect(sets.nth(1).locator('.r')).toHaveText('12')

  await expect
    .poll(async () => {
      const rows = await trainRows(page, 'workout_sets')
      const mine = rows.filter((r) => r.workout_exercise_id !== 'we-1')
      return mine.map((r) => `${r.weight_kg}x${r.reps}`).sort()
    })
    .toEqual(['60x12', '65x13', '65x13'])

  // 最後一組：沒有剩餘組
  await openSetSheet(page, 2)
  await expect(setSheet(page).getByRole('button', { name: '沒有剩餘組' })).toBeDisabled()
})

test('組編輯 sheet 刪除這一組：沒打勾直接刪；已打勾先確認；只剩一組不能刪', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await expect(page.locator('.ex .set')).toHaveCount(2)

  // 已打勾的第 1 組：先問，「先不要」不刪
  await openSetSheet(page, 0)
  const sheet = setSheet(page)
  await sheet.getByRole('button', { name: '刪除這一組' }).click()
  const dialog = page.getByRole('alertdialog', { name: '刪除這一組？' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '先不要' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.ex .set')).toHaveCount(2)

  await sheet.getByRole('button', { name: '刪除這一組' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '刪除', exact: true }).click()
  await expect(setSheet(page)).toHaveCount(0)
  await expect(page.locator('.ex .set')).toHaveCount(1)
  await expect(stat(page, 'sets')).toHaveText('0/1')
  await expect(page.locator('.ex .set').first().locator('.no'), '剩下的組號是序號').toHaveText('1')

  // 只剩一組：兩條路都不能刪
  await openSetSheet(page, 0)
  await expect(setSheet(page).getByRole('button', { name: '刪除這一組' })).toBeDisabled()
})

test('完成訓練：摘要 sheet 列事實，按完成回到清單並落到伺服器', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await tick(page, 1)

  await page.getByRole('button', { name: '完成訓練' }).click()
  const sheet = page.locator('[data-screen="finish-sheet"]')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('finish-volume')).toContainText('1,440')
  await expect(sheet.locator('.tr-row', { hasText: '腿推舉' })).toContainText('60 × 12 · 60 × 12')
  await expect(sheet.getByLabel('時長（分鐘）'), '即時的訓練不問時長（有計時）').toHaveCount(0)
  await sheet.getByRole('button', { name: '完成', exact: true }).click()

  // 回到清單：今天現在有兩次已完成的訓練
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
  await expect(page.locator('.tr-sec', { hasText: '進行中' })).toHaveCount(0)
  await expect(page.locator('.tr-sec:has-text("已完成") + .tr-card .tr-row')).toHaveCount(2)
  await expect(page.locator('.bottom-bar')).toHaveCount(1)

  await expect
    .poll(async () => (await trainRows(page, 'workouts')).filter((x) => x.id !== 'w-1' && x.ended_at != null).length)
    .toBe(1)
  expect(await trainRows(page, 'workout_sets')).toHaveLength(4) // fixture 2 ＋ 新的 2
})

test('離線時整套記錄下來，回線後自動上傳、不重複、細條消失', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await setOffline(page, true)

  await startBlank(page)
  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await tick(page, 1)
  await page.getByRole('button', { name: '完成訓練' }).click()
  await page.locator('[data-screen="finish-sheet"]').getByRole('button', { name: '完成', exact: true }).click()

  // 離線：畫面上看得到、細條明講有幾筆沒上傳，伺服器那邊還沒有
  await expect(page.locator('.tr-sec:has-text("已完成") + .tr-card .tr-row')).toHaveCount(2)
  await expect(page.locator('[data-screen="training"] .tr-status')).toContainText('筆尚未同步')
  expect(await trainRows(page, 'workouts')).toHaveLength(1)

  // 回線：online 觸發同步
  await setOffline(page, false)
  // 依序送：workouts 先落地、組在後面——兩個都要等到齊才斷言，不能看到第一個就往下
  await expect.poll(async () => (await trainRows(page, 'workout_sets')).length, { timeout: 15_000 }).toBe(4)
  expect(await trainRows(page, 'workouts'), '不重複：fixture 1 ＋ 新的 1').toHaveLength(2)
  expect(await trainRows(page, 'workout_exercises'), '不重複：fixture 1 ＋ 新的 1').toHaveLength(2)
  await expect(page.locator('[data-screen="training"] .tr-status')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('.tr-sec:has-text("已完成") + .tr-card .tr-row')).toHaveCount(2)
})

test('補記過去的日子：不計時、完成時手填時長，記在那一天', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  const yesterday = shiftIso(TODAY, -1)
  await gotoDate(page, yesterday)

  await page.getByRole('button', { name: '開始訓練' }).click()
  await expect(page.locator('[data-screen="start-sheet"]')).toContainText('補記')
  await page.locator('[data-action="start-blank"]').click()
  await expect(stat(page, 'time'), '補記不跑計時').toHaveText('—')

  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await page.getByRole('button', { name: '完成訓練' }).click()
  const sheet = page.locator('[data-screen="finish-sheet"]')
  await sheet.getByLabel('時長（分鐘）').fill('45')
  await sheet.getByRole('button', { name: '完成', exact: true }).click()

  // 昨天那天的清單有一筆 45 分；今天的還是原本那一筆
  await expect(page.locator('.tr-row .sub', { hasText: '45 分' })).toHaveCount(1)
  // 畫面先更新（疊在佇列上），伺服器那筆「完成」的 update 稍後才送到——等它到，不能讀一次就斷言
  const made = async () => (await trainRows(page, 'workouts')).find((x) => x.id !== 'w-1')
  await expect.poll(async () => (await made())?.ended_at ?? null).not.toBeNull()
  expect((await made())?.performed_on).toBe(yesterday)
  const row = await made()
  expect(Date.parse(String(row?.ended_at)) - Date.parse(String(row?.started_at))).toBe(45 * 60_000)
})

test('刪除整次訓練要確認，確認後從清單與伺服器都消失', async ({ page }) => {
  await openApp(page)
  await openTraining(page)
  await startBlank(page)
  await expect.poll(async () => (await trainRows(page, 'workouts')).length).toBe(1)

  await page.getByRole('button', { name: '刪除這次訓練' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('刪除這次訓練？')
  await dialog.getByRole('button', { name: '先不要' }).click()
  await expect(page.locator('[data-screen="training-session"]'), '按「先不要」不該刪掉').toBeVisible()

  await page.getByRole('button', { name: '刪除這次訓練' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '刪除', exact: true }).click()
  await expect(page.getByText('這天沒有訓練紀錄')).toBeVisible()
  await expect(page.locator('.bottom-bar')).toHaveCount(1)
  await expect.poll(async () => (await trainRows(page, 'workouts')).length).toBe(0)
})

test('進行中的訓練退出再回來還在，可以繼續', async ({ page }) => {
  await openApp(page)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await page.getByRole('button', { name: '返回（訓練繼續進行）' }).click()

  await expect(page.locator('.tr-sec', { hasText: '進行中' })).toHaveCount(1)
  await page.locator('.tr-sec:has-text("進行中") + .tr-card .tr-row').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
  await expect(page.locator('.ex')).toHaveCount(1)
})

test('登出前佇列非空：先問、說明筆數；「先不要」不登出，「仍要登出」才登出並清掉', async ({ page }) => {
  await openApp(page)
  await openTraining(page)
  await setOffline(page, true)
  await startBlank(page)
  await page.getByRole('button', { name: '返回（訓練繼續進行）' }).click()
  await expect(page.locator('[data-screen="training"] .tr-status')).toContainText('1 筆尚未同步')

  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.settings .signout').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('還有 1 筆記錄沒上傳')
  await dialog.getByRole('button', { name: '先不要' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.settings .signout'), '按「先不要」不該登出').toBeVisible()

  await page.locator('.settings .signout').click()
  await page.getByRole('alertdialog').getByRole('button', { name: '仍要登出' }).click()
  await expect(page.locator('#view-login')).toHaveCount(1)
})

test('登出時佇列是空的：不多問一句', async ({ page }) => {
  await openApp(page)
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.settings .signout').click()
  await expect(page.locator('#view-login')).toHaveCount(1)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
})

/* ═══════════ 動作庫與編輯動作（第一輪第 3 段） ═══════════ */

const LEG_ID = EX_ID
const ROW_ID = '22222222-2222-4222-8222-222222222222'
const OLD_ID = '33333333-3333-4333-8333-333333333333'

/** 三個動作：腿推舉（下半身、有要點）、坐姿划船（背部）、舊的肩推（肩膀、已封存）。 */
const LIBRARY_FIX: typeof FIX = {
  ...FIX,
  exercises: [
    { id: LEG_ID, name: '腿推舉', muscle_group: 'legs', tips: '背貼緊椅背', archived: false, created_at: '2026-10-01T00:00:00.000Z' },
    { id: ROW_ID, name: '坐姿划船', muscle_group: 'back', tips: null, archived: false, created_at: '2026-10-01T00:00:01.000Z' },
    { id: OLD_ID, name: '舊的肩推', muscle_group: 'shoulder', tips: null, archived: true, created_at: '2026-10-01T00:00:02.000Z' },
  ],
}

const library = (page: Page) => page.locator('[data-screen="exercise-library"]')
const editSheet = (page: Page) => page.locator('[data-screen="exercise-edit"]')

async function openLibrary(page: Page) {
  await page.locator('[data-action="open-library"]').click()
  await expect(library(page)).toBeVisible()
}

test('動作庫：入口顯示未封存的動作數、整頁接管（底部列收起）、返回回到訓練頁', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await expect(page.locator('[data-action="open-library"]')).toContainText('2 個動作')

  await openLibrary(page)
  await expect(page.locator('.bottom-bar')).toHaveCount(0)
  await expect(library(page).locator('.tr-row')).toHaveCount(3)
  await expect(library(page).locator('.tr-row', { hasText: '腿推舉' })).toContainText('有要點')

  await library(page).getByRole('button', { name: '返回' }).click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
  await expect(page.locator('.bottom-bar')).toBeVisible()
})

test('動作庫：搜尋名稱與肌群橫條同時成立；封存的列在底下的「已封存」區', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)

  const archived = library(page).locator('[data-section="archived"] .tr-row')
  await expect(archived).toHaveCount(1)
  await expect(archived).toContainText('舊的肩推')

  await library(page).getByRole('searchbox', { name: '搜尋動作' }).fill('划船')
  await expect(library(page).locator('.tr-row')).toHaveCount(1)
  await expect(library(page).locator('.tr-row')).toContainText('坐姿划船')

  await library(page).getByRole('searchbox', { name: '搜尋動作' }).fill('')
  await library(page).getByRole('button', { name: '下半身', exact: true }).click()
  await expect(library(page).locator('.tr-row')).toHaveCount(1)
  await expect(library(page).locator('.tr-row')).toContainText('腿推舉')
  await library(page).getByRole('button', { name: '手臂', exact: true }).click()
  await expect(library(page).getByText('沒有符合的動作')).toBeVisible()
})

test('編輯動作：改名、肌群、要點，儲存後落到伺服器', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)

  await library(page).locator('.tr-row', { hasText: '坐姿划船' }).click()
  await expect(editSheet(page)).toBeVisible()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('  坐姿划船（機械）  ')
  await editSheet(page).getByRole('combobox', { name: '肌群' }).selectOption('arms')
  await editSheet(page).getByRole('textbox', { name: '要點' }).fill('挺胸；拉到肚臍')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)

  const row = library(page).locator('.tr-row', { hasText: '坐姿划船（機械）' })
  await expect(row).toContainText('手臂 · 有要點')
  await expect
    .poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === ROW_ID))
    .toMatchObject({ name: '坐姿划船（機械）', muscle_group: 'arms', tips: '挺胸；拉到肚臍', archived: false })
})

test('新增動作：右上＋、預設肌群「其他」、儲存後進清單與伺服器', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)

  await library(page).getByRole('button', { name: '新增動作' }).click()
  await expect(editSheet(page).getByRole('combobox', { name: '肌群' })).toHaveValue('other')
  await expect(editSheet(page).getByRole('button', { name: '封存這個動作' }), '新增時不顯示封存').toHaveCount(0)
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('硬舉')
  await editSheet(page).getByRole('combobox', { name: '肌群' }).selectOption('back')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()

  await expect(library(page).locator('.tr-row', { hasText: '硬舉' })).toContainText('背部')
  await expect.poll(async () => (await trainRows(page, 'exercises')).length).toBe(4)
  const rows = await trainRows(page, 'exercises')
  expect(rows.find((r) => r.name === '硬舉')).toMatchObject({ muscle_group: 'back', tips: null, archived: false })
})

test('名稱空白或與別的動作重複：擋在 sheet 裡說明，不寫入；撞到已封存的提示可取消封存', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)
  await library(page).getByRole('button', { name: '新增動作' }).click()

  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page).getByRole('alert')).toContainText('名稱不能是空的')

  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill(' 腿推舉 ')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page).getByRole('alert')).toContainText('已經有「腿推舉」')

  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('舊的肩推')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page).getByRole('alert')).toContainText('取消封存')

  expect(await trainRows(page, 'exercises'), '被擋下的都不該寫入').toHaveLength(3)
})

test('封存：從「加動作」的選單消失；選單也有肌群橫條', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)

  await library(page).locator('.tr-row', { hasText: '腿推舉' }).click()
  await editSheet(page).getByRole('button', { name: '封存這個動作' }).click()
  await expect(editSheet(page)).toHaveCount(0)
  await expect(library(page).locator('[data-section="archived"] .tr-row', { hasText: '腿推舉' })).toHaveCount(1)
  await expect.poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === LEG_ID)?.archived).toBe(true)

  await library(page).getByRole('button', { name: '返回' }).click()
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  const picker = page.locator('[data-screen="exercise-picker"]')
  await expect(picker.locator('.tr-row', { hasText: '坐姿划船' })).toBeVisible()
  await expect(picker.locator('.tr-row', { hasText: '腿推舉' })).toHaveCount(0)
  await expect(picker.locator('.tr-row', { hasText: '舊的肩推' })).toHaveCount(0)

  await picker.getByRole('button', { name: '背部', exact: true }).click()
  await expect(picker.locator('.tr-row')).toHaveCount(1)
})

test('取消封存：回到清單與選單', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)

  await library(page).locator('[data-section="archived"] .tr-row', { hasText: '舊的肩推' }).click()
  await editSheet(page).getByRole('button', { name: '取消封存這個動作' }).click()
  await expect(editSheet(page)).toHaveCount(0)
  await expect(library(page).locator('[data-section="archived"]')).toHaveCount(0)
  await expect(library(page).locator('.tr-row', { hasText: '舊的肩推' })).toHaveCount(1)
  await expect.poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === OLD_ID)?.archived).toBe(false)
})

/* ═══════════ 動作示意圖與補齊預設動作 ═══════════ */

/** 圖已載入且是我們產的 240 寬 webp（lazy 圖要在視窗內才會載，所以用 poll）。 */
const imgLoaded = (img: Locator) =>
  expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth), { timeout: 10_000 }).toBe(240)

/** 第一次開、伺服器沒有動作 → App 預填 16 個（帶 user_id），等伺服器那邊真的收到再往下。 */
async function openSeededLibrary(page: Page) {
  await openApp(page, {}, { ...FIX, exercises: [] })
  await openTraining(page)
  await expect(page.locator('[data-action="open-library"]')).toContainText('16 個動作', { timeout: 15_000 })
  await expect.poll(async () => (await trainRows(page, 'exercises')).length, { timeout: 15_000 }).toBe(16)
  await openLibrary(page)
}

test('動作示意圖：預設動作有照片、自建的動作用肌群單字；動作庫、加動作 sheet、訓練中卡片都有', async ({ page }) => {
  await openSeededLibrary(page)
  // 自建一個動作（沒有圖）
  await library(page).getByRole('button', { name: '新增動作' }).click()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('我的自建動作')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)

  const legRow = library(page).locator('.tr-row', { hasText: '腿推舉' })
  const img = legRow.locator('img.ex-thumb')
  await expect(img).toHaveCount(1)
  expect(await img.getAttribute('src')).toMatch(/\/assets\/leg-press-[\w-]+\.webp$/)
  expect(await img.getAttribute('alt'), '旁邊就是名稱，圖是裝飾').toBe('')
  await imgLoaded(img)

  const custom = library(page).locator('.tr-row', { hasText: '我的自建動作' })
  await expect(custom.locator('img.ex-thumb')).toHaveCount(0)
  await expect(custom.locator('.ex-thumb.is-glyph')).toHaveText('他')
  const a = (await img.boundingBox())!
  const b = (await custom.locator('.ex-thumb').boundingBox())!
  expect([b.width, b.height], '沒有圖的縮圖與有圖的同尺寸，列不會因為有沒有圖而跳').toEqual([a.width, a.height])
  expect(await legRow.evaluate((el) => el.getBoundingClientRect().height)).toBe(await custom.evaluate((el) => el.getBoundingClientRect().height))

  // 加動作 sheet 與訓練中卡片
  await library(page).getByRole('button', { name: '返回' }).click()
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  const pickRow = page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: '腿推舉' })
  await expect(pickRow.locator('img.ex-thumb')).toHaveCount(1)
  await imgLoaded(pickRow.locator('img.ex-thumb'))
  await pickRow.click()
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
  const cardImg = page.locator('.ex .ex-toggle img.ex-thumb')
  await expect(cardImg).toHaveCount(1)
  await imgLoaded(cardImg)

  // 建置層：圖是獨立檔案、進了 precache（離線健身房看得到），沒有被內嵌成 base64 吞進主 JS
  const scripts = await page.evaluate(() => Array.from(document.scripts).map((el) => el.src).filter(Boolean))
  expect(scripts.length).toBeGreaterThan(0)
  for (const src of scripts) {
    const text = await (await page.request.get(src)).text()
    expect(text.includes('data:image/webp'), `${src} 不該內嵌動作圖`).toBe(false)
  }
  const sw = await (await page.request.get(new URL('sw.js', page.url()).href)).text()
  const precached = new Set(sw.match(/assets\/[\w-]+\.webp/g) ?? [])
  expect(precached.size, 'service worker 的 precache 清單要列出 150 張動作圖').toBe(150)
})

test('補齊預設動作：只補缺的，改過名的預設動作不被蓋回，補完入口消失，補進來的有圖', async ({ page }) => {
  await openSeededLibrary(page)
  const fill = library(page).locator('[data-section="fill-catalog"]')
  await expect(fill).toContainText('新增 134 個')

  // 先把一個預設動作改名：補齊不能把它蓋回「腿推舉」
  await library(page).locator('.tr-row', { hasText: '腿推舉' }).click()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('我的腿推')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)
  await expect(fill, '改名後缺的還是 134 個').toContainText('新增 134 個')

  await fill.getByRole('button', { name: /補齊預設動作/ }).click()
  await expect(library(page).locator('.tr-row')).toHaveCount(150)
  // 入口不會就這樣消失（焦點會掉到 body、讀屏沒回饋）：換成「已加入 N 個」的狀態，焦點移到它
  await expect(fill.getByRole('status')).toHaveText('已加入 134 個預設動作')
  await expect(fill.getByRole('button')).toHaveCount(0)
  await expect(fill).toBeFocused()
  await expect.poll(async () => (await trainRows(page, 'exercises')).length, { timeout: 30_000 }).toBe(150)

  const rows = await trainRows(page, 'exercises')
  expect(rows.some((r) => r.name === '我的腿推'), '改過名的沒被蓋回').toBe(true)
  expect(rows.filter((r) => r.name === '腿推舉'), '預設的「腿推舉」沒有被補第二份').toHaveLength(0)
  expect(new Set(rows.map((r) => r.id)).size).toBe(150)
  const posts = (await page.evaluate(() => (window as unknown as { __writes: { table: string; method: string }[] }).__writes)).filter(
    (w) => w.table === 'exercises' && w.method === 'POST',
  )
  expect(posts, '預填 16＋補齊 134，每個 id 各送一次').toHaveLength(150)

  // 名稱要精確比對：「槓鈴臥推」是「上斜槓鈴臥推」「窄握槓鈴臥推」的子字串
  const added = library(page).locator('.tr-row').filter({ has: page.getByText('槓鈴臥推', { exact: true }) })
  await expect(added.locator('img.ex-thumb')).toHaveCount(1)
  await imgLoaded(added.locator('img.ex-thumb'))
  // 補進來的肌群歸類正確：篩「手臂」要看得到新加的
  await expect(library(page).locator('.tr-row').filter({ has: page.getByText('啞鈴二頭彎舉', { exact: true }) })).toBeVisible()
})

test('補齊預設動作：名稱與既有動作重複的不補（同名會讓兩列都存不了，而且動作不能真刪）', async ({ page }) => {
  await openSeededLibrary(page)
  // 自建一個與目錄同名的動作
  await library(page).getByRole('button', { name: '新增動作' }).click()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('槓鈴臥推')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)

  const fill = library(page).locator('[data-section="fill-catalog"]')
  await expect(fill, '134 個裡「槓鈴臥推」撞名，不補').toContainText('新增 133 個')
  await fill.getByRole('button', { name: /補齊預設動作/ }).click()
  await expect(fill.getByRole('status')).toHaveText('已加入 133 個預設動作')
  await expect(library(page).locator('.tr-row')).toHaveCount(150) // 16＋自建 1＋補 133

  await expect.poll(async () => (await trainRows(page, 'exercises')).length, { timeout: 30_000 }).toBe(150)
  const names = (await trainRows(page, 'exercises')).map((r) => String(r.name))
  expect(names.filter((n) => n === '槓鈴臥推'), '整份動作庫只有一個「槓鈴臥推」').toHaveLength(1)
  expect(new Set(names).size, '沒有任何同名動作').toBe(names.length)
  // 撞名的那一列（自建的）要能照常改要點：不會被「已經有這個動作」擋下
  await library(page).locator('.tr-row').filter({ has: page.getByText('槓鈴臥推', { exact: true }) }).click()
  await editSheet(page).getByRole('textbox', { name: '要點' }).fill('握距略寬於肩')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)
})

test('離線補齊時，伺服器上已存在的預設動作（本機底不知道）不會被蓋回預設值', async ({ page }) => {
  await openSeededLibrary(page)
  await setOffline(page, true)
  await library(page).locator('[data-section="fill-catalog"]').getByRole('button', { name: /補齊預設動作/ }).click()
  await expect(library(page).locator('.tr-row')).toHaveCount(150)

  // 離線期間「別台裝置」把槓鈴深蹲改成「我的深蹲」並封存、寫了要點。id 是 userId＋key 的 uuid v5
  // （字面值取自 Python 的 uuid.uuid5，同時鎖住 id 演算法）
  const SQUAT_ID = '54a8d7cc-c000-5491-a958-7c4747688023'
  await page.evaluate(
    (id) =>
      (window as unknown as { __trainPut: (t: string, r: Record<string, unknown> | object) => void }).__trainPut('exercises', {
        id,
        user_id: '00000000-0000-0000-0000-000000000001',
        name: '我的深蹲',
        muscle_group: 'legs',
        tips: '腳尖外開',
        archived: true,
      }),
    SQUAT_ID,
  )

  await setOffline(page, false)
  // 16 預填＋伺服器上多出的 1 列＋補齊的 134 個裡 133 個是新的（深蹲那筆被 ignore）
  await expect.poll(async () => (await trainRows(page, 'exercises')).length, { timeout: 40_000 }).toBe(150)
  const squat = (await trainRows(page, 'exercises')).find((r) => r.id === SQUAT_ID)!
  expect(squat.name, '沒有被蓋回「槓鈴深蹲」').toBe('我的深蹲')
  expect(squat.archived).toBe(true)
  expect(squat.tips).toBe('腳尖外開')
  // 補齊確實對這個 id 送過 insert（本機底不知道它），是 ignoreDuplicates 保護了它
  const posts = (await page.evaluate(() => (window as unknown as { __writes: { table: string; method: string; body: unknown }[] }).__writes)).filter(
    (w) => w.table === 'exercises' && w.method === 'POST',
  )
  expect(posts.some((w) => (Array.isArray(w.body) ? w.body[0] : (w.body as { id: string })).id === SQUAT_ID)).toBe(true)
})

test('離線補齊預設動作：畫面立刻有，回線後上傳、不重複', async ({ page }) => {
  await openSeededLibrary(page)
  await setOffline(page, true)
  await library(page).locator('[data-section="fill-catalog"]').getByRole('button', { name: /補齊預設動作/ }).click()
  await expect(library(page).locator('.tr-row')).toHaveCount(150)
  expect((await trainRows(page, 'exercises')).length, '離線時伺服器還是 16 個').toBe(16)

  await setOffline(page, false)
  await expect.poll(async () => (await trainRows(page, 'exercises')).length, { timeout: 40_000 }).toBe(150)
})

test('訓練中：ⓘ 在卡片內展開要點面板（只能看）；「編輯要點」開同一張編輯 sheet；清空顯示「還沒有要點」', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await addExercise(page, '坐姿划船')

  const legs = page.locator('.ex', { hasText: '腿推舉' })
  const row = page.locator('.ex', { hasText: '坐姿划船' })
  // 每張卡都有 ⓘ，沒寫過要點的是淡色、不隱藏（隱藏會讓箭頭、ⓘ、⋯ 對不齊）
  await expect(legs.locator('.ex-info')).toHaveCount(1)
  await expect(row.locator('.ex-info')).toHaveCount(1)
  await expect(row.locator('.ex-info')).toHaveClass(/is-empty/)
  await expect(legs.locator('.ex-info')).not.toHaveClass(/is-empty/)

  await expect(legs.locator('.ex-tips-panel')).toHaveCount(0)
  await legs.getByRole('button', { name: '腿推舉 的要點' }).click()
  const panel = legs.locator('.ex-tips-panel')
  await expect(panel).toContainText('背貼緊椅背')
  // 不能就地改：卡片上沒有可打字的要點欄
  await expect(page.locator('.ex textarea')).toHaveCount(0)

  await panel.getByRole('button', { name: '編輯要點' }).click()
  await expect(editSheet(page).getByRole('textbox', { name: '要點' })).toHaveValue('背貼緊椅背')
  await editSheet(page).getByRole('textbox', { name: '要點' }).fill('第三組吃力就降 2.5')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)
  await expect(panel).toContainText('第三組吃力就降 2.5')
  await expect
    .poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === LEG_ID)?.tips)
    .toBe('第三組吃力就降 2.5')

  // 清空＝「還沒有要點」，伺服器存 null；ⓘ 變淡色但仍在
  await panel.getByRole('button', { name: '編輯要點' }).click()
  await editSheet(page).getByRole('textbox', { name: '要點' }).fill('   ')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(panel).toContainText('還沒有要點')
  await expect(panel.getByRole('button', { name: '新增要點' })).toBeVisible()
  await expect(legs.locator('.ex-info')).toHaveClass(/is-empty/)
  await expect.poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === LEG_ID)?.tips).toBeNull()

  // 再點一下 ⓘ 收起；收合的卡也能直接點開（腿推舉在加了第二個動作後是收合的）
  await legs.getByRole('button', { name: '腿推舉 還沒有要點' }).click()
  await expect(legs.locator('.ex-tips-panel')).toHaveCount(0)
  await expect(legs.locator('.set')).toHaveCount(0)
  await legs.locator('.ex-info').click()
  await expect(legs.locator('.ex-tips-panel')).toHaveCount(1)
})

test('⋯ 選單：「加要點」開編輯 sheet；「移除這個動作」沒打勾直接移除、有打勾先確認', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '坐姿划船')
  await addExercise(page, '腿推舉')
  const row = page.locator('.ex', { hasText: '坐姿划船' })
  const legs = page.locator('.ex', { hasText: '腿推舉' })

  await row.getByRole('button', { name: '坐姿划船 的更多操作' }).click()
  await page.getByRole('menuitem', { name: '加要點' }).click()
  await expect(editSheet(page)).toBeVisible()
  await editSheet(page).getByRole('button', { name: '關閉' }).click()
  await expect(editSheet(page)).toHaveCount(0)

  // 有打勾的動作：先問（最後加的腿推舉是展開的）
  await legs.locator('.set').first().locator('.tr-check').click()
  await legs.getByRole('button', { name: '腿推舉 的更多操作' }).click()
  await page.getByRole('menuitem', { name: '移除這個動作' }).click()
  const dialog = page.getByRole('alertdialog', { name: '移除這個動作？' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '先不要' }).click()
  await expect(page.locator('.ex')).toHaveCount(2)

  // 沒打勾的動作：直接移除
  await row.getByRole('button', { name: '坐姿划船 的更多操作' }).click()
  await page.getByRole('menuitem', { name: '移除這個動作' }).click()
  await expect(page.locator('.ex')).toHaveCount(1)
  await expect.poll(async () => (await trainRows(page, 'workout_exercises')).length).toBe(1)
})

test('離線改要點：畫面立刻是新的，回線後上傳', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await setOffline(page, true)
  await openLibrary(page)

  await library(page).locator('.tr-row', { hasText: '坐姿划船' }).click()
  await editSheet(page).getByRole('textbox', { name: '要點' }).fill('離線時寫的')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(library(page).locator('.tr-row', { hasText: '坐姿划船' })).toContainText('有要點')
  expect((await trainRows(page, 'exercises')).find((r) => r.id === ROW_ID)?.tips, '離線時伺服器還沒有').toBeNull()

  await setOffline(page, false)
  await expect
    .poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === ROW_ID)?.tips, { timeout: 15_000 })
    .toBe('離線時寫的')
})

test('篩選中新增動作：成功後篩選清掉、新動作看得到；名稱欄按 Enter 就送出', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)
  await library(page).getByRole('button', { name: '胸部', exact: true }).click()
  await expect(library(page).getByText('沒有符合的動作')).toBeVisible()

  await library(page).getByRole('button', { name: '新增動作' }).click()
  await editSheet(page).getByRole('combobox', { name: '肌群' }).selectOption('core')
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('腹部滾輪')
  await editSheet(page).getByRole('textbox', { name: '名稱' }).press('Enter')
  await expect(editSheet(page)).toHaveCount(0)

  await expect(library(page).locator('.tr-row', { hasText: '腹部滾輪' })).toContainText('腹肌')
  await expect(library(page).getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('加動作 sheet：選了肌群與搜尋字之後挑一個動作，下次打開篩選是乾淨的', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  const picker = page.locator('[data-screen="exercise-picker"]')
  await picker.getByRole('button', { name: '背部', exact: true }).click()
  await picker.locator('.tr-row', { hasText: '坐姿划船' }).click()
  await expect(page.locator('.ex .set').first()).toBeVisible()
  await expect(picker).toHaveCount(0) // 收合動畫期間的點擊會被正在收的 sheet 吃掉

  await page.locator('.tr-bottom .tr-secondary').click()
  await expect(picker.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(picker.locator('.tr-row', { hasText: '腿推舉' })).toBeVisible()
})

/* ═══════════ 有氧（第 2 輪 A 段，AC 10–12、15） ═══════════ */

const cardioSheet = (page: Page) => page.locator('[data-screen="cardio-sheet"]')
const field = (page: Page, name: string) => cardioSheet(page).getByRole('textbox', { name, exact: true })
const kindBtn = (page: Page, name: string) =>
  cardioSheet(page).getByRole('group', { name: '有氧類型' }).getByRole('button', { name, exact: true })
const cardioRows = (page: Page) => page.locator('[data-screen="training"] .tr-row[data-cardio-id]')

/** 主 CTA → 開始訓練 sheet →「記一筆有氧」。 */
async function openCardio(page: Page) {
  await page.getByRole('button', { name: '開始訓練' }).click()
  await page.locator('[data-action="start-cardio"]').click()
  await expect(cardioSheet(page)).toBeVisible()
  await expect(page.locator('[data-screen="start-sheet"]'), '開始訓練 sheet 要先收起來').toHaveCount(0)
}

/** 今天已有一筆有氧拳擊。 */
const WITH_CARDIO: typeof FIX = {
  ...FIX,
  cardio_sessions: [
    {
      id: 'c-1',
      performed_on: TODAY,
      kind: 'boxing',
      minutes: 36,
      speed_kmh: null,
      incline_pct: null,
      est_kcal: 121,
      created_at: `${TODAY}T07:00:00.000Z`,
    },
  ],
}

test('記一筆有氧（走路）：類型決定欄位，存下後列在「已完成」並落到伺服器，日期有小點', async ({ page }) => {
  await openApp(page)
  await openTraining(page)
  await openCardio(page)

  await expect(kindBtn(page, '跑步機坡度健走'), '預設走路').toHaveAttribute('aria-pressed', 'true')
  // 選中態的視覺只靠白塊（v2.68 起）：整組恰一塊、掛在選中的鈕上，切過去後跟著換
  const thumbs = cardioSheet(page).getByRole('group', { name: '有氧類型' }).locator('.seg-thumb')
  await expect(thumbs, '有氧類型少了選中白塊').toHaveCount(1)
  await expect(kindBtn(page, '跑步機坡度健走').locator('.seg-thumb')).toHaveCount(1)
  await kindBtn(page, '有氧拳擊').click()
  await expect(kindBtn(page, '有氧拳擊').locator('.seg-thumb'), '切類型後白塊沒跟過去').toHaveCount(1)
  await kindBtn(page, '跑步機坡度健走').click()
  await expect(field(page, '預估熱量 kcal'), '走路沒有預估熱量欄').toHaveCount(0)
  await field(page, '分鐘').fill('30')
  await field(page, '速度 km/h').fill('5.5')
  await field(page, '坡度 %').fill('8')
  await cardioSheet(page).getByRole('button', { name: '存下這筆' }).click()
  await expect(cardioSheet(page)).toHaveCount(0)

  const row = cardioRows(page)
  await expect(row).toHaveCount(1)
  await expect(row.locator('.nm')).toHaveText('跑步機坡度健走')
  await expect(row.locator('.sub')).toHaveText('30 分 · 5.5 km/h · 坡度 8%')
  await expect(page.locator('.tr-sec', { hasText: '已完成' })).toHaveCount(1)
  await expect(page.locator('[data-screen="training"] .datectl-day.is-today')).toHaveClass(/is-marked/)

  await expect.poll(async () => (await trainRows(page, 'cardio_sessions')).length).toBe(1)
  const [saved] = await trainRows(page, 'cardio_sessions')
  expect(saved).toMatchObject({ performed_on: TODAY, kind: 'incline_walk', minutes: 30, speed_kmh: 5.5, incline_pct: 8, est_kcal: null })
})

test('有氧拳擊：切換類型換欄位；切到拳擊之前填的走路欄位不會寫進去', async ({ page }) => {
  await openApp(page)
  await openTraining(page)
  await openCardio(page)

  await field(page, '速度 km/h').fill('6')
  await kindBtn(page, '有氧拳擊').click()
  await expect(kindBtn(page, '有氧拳擊')).toHaveAttribute('aria-pressed', 'true')
  await expect(field(page, '速度 km/h')).toHaveCount(0)
  await expect(field(page, '坡度 %')).toHaveCount(0)
  await field(page, '分鐘').fill('36')
  await field(page, '預估熱量 kcal').fill('121')
  await cardioSheet(page).getByRole('button', { name: '存下這筆' }).click()

  await expect(cardioRows(page).locator('.sub')).toHaveText('36 分 · 預估 121 kcal')
  await expect.poll(async () => (await trainRows(page, 'cardio_sessions')).length).toBe(1)
  const [saved] = await trainRows(page, 'cardio_sessions')
  expect(saved, '走路欄位的殘值（速度 6）不該寫進拳擊').toMatchObject({ kind: 'boxing', minutes: 36, speed_kmh: null, est_kcal: 121 })
})

test('有氧的數值守門：範圍外與超過一位小數擋在 sheet 裡說明，不寫入、不關', async ({ page }) => {
  await openApp(page)
  await openTraining(page)
  await openCardio(page)
  const save = cardioSheet(page).getByRole('button', { name: '存下這筆' })

  await save.click()
  await expect(cardioSheet(page).getByRole('alert')).toHaveText('分鐘要填')
  await field(page, '分鐘').fill('0')
  await save.click()
  await expect(cardioSheet(page).getByRole('alert')).toHaveText('分鐘要大於 0、最多 1440')
  await field(page, '分鐘').fill('30')
  await field(page, '速度 km/h').fill('5.55')
  await save.click()
  await expect(cardioSheet(page).getByRole('alert')).toHaveText('速度最多一位小數')
  await field(page, '速度 km/h').fill('41')
  await save.click()
  await expect(cardioSheet(page).getByRole('alert')).toHaveText('速度要大於 0、最多 40 km/h')

  await expect(cardioSheet(page)).toBeVisible()
  expect(await trainRows(page, 'cardio_sessions'), '被擋下的都不該寫入').toHaveLength(0)
})

test('編輯與刪除有氧：點列開同一張 sheet 帶入原值；改完落到伺服器；刪除要確認', async ({ page }) => {
  await openApp(page, {}, WITH_CARDIO)
  await openTraining(page)
  await expect(cardioRows(page).locator('.sub')).toHaveText('36 分 · 預估 121 kcal')

  await cardioRows(page).click()
  await expect(cardioSheet(page)).toHaveAccessibleName('編輯有氧')
  await expect(kindBtn(page, '有氧拳擊')).toHaveAttribute('aria-pressed', 'true')
  await expect(field(page, '分鐘')).toHaveValue('36')
  await expect(field(page, '預估熱量 kcal')).toHaveValue('121')
  await field(page, '分鐘').fill('40')
  await cardioSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(cardioSheet(page)).toHaveCount(0)
  await expect(cardioRows(page).locator('.sub')).toHaveText('40 分 · 預估 121 kcal')
  await expect.poll(async () => (await trainRows(page, 'cardio_sessions'))[0]?.minutes).toBe(40)

  // 再打開：是剛存的值，不是上一次的草稿
  await cardioRows(page).click()
  await expect(field(page, '分鐘')).toHaveValue('40')

  await cardioSheet(page).getByRole('button', { name: '刪除這筆' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '先不要' }), '預設焦點在取消').toBeFocused()
  // Escape 只收對話框，不連 sheet 一起關（vaul 與對話框都聽 Escape）
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // sheet 被一起關的話，關閉動畫（app.css 收合用 --dur-mid 220ms）期間它仍「可見」——等動畫跑完再斷言才有鑑別力
  await page.waitForTimeout(500)
  await expect(cardioSheet(page)).toBeVisible()
  expect(await trainRows(page, 'cardio_sessions'), '取消不該刪').toHaveLength(1)

  await cardioSheet(page).getByRole('button', { name: '刪除這筆' }).click()
  await dialog.getByRole('button', { name: '刪除' }).click()
  await expect(cardioSheet(page)).toHaveCount(0)
  await expect(cardioRows(page)).toHaveCount(0)
  await expect(page.getByText('這天沒有訓練紀錄')).toBeVisible()
  await expect.poll(async () => (await trainRows(page, 'cardio_sessions')).length).toBe(0)
})

test('離線記一筆有氧（補記昨天）：畫面立刻有、記在那一天，回線後上傳', async ({ page }) => {
  await openApp(page)
  await openTraining(page)
  const yesterday = shiftIso(TODAY, -1)
  await gotoDate(page, yesterday)
  await setOffline(page, true)

  await openCardio(page)
  await expect(cardioSheet(page), '不是今天要講記在哪天').toContainText('記在')
  await field(page, '分鐘').fill('25')
  await cardioSheet(page).getByRole('button', { name: '存下這筆' }).click()
  await expect(cardioRows(page).locator('.sub')).toHaveText('25 分')
  await expect(page.locator('[data-screen="training"] .tr-status')).toContainText('筆尚未同步')
  expect(await trainRows(page, 'cardio_sessions'), '離線時伺服器還沒有').toHaveLength(0)

  await setOffline(page, false)
  await expect.poll(async () => (await trainRows(page, 'cardio_sessions')).length, { timeout: 15_000 }).toBe(1)
  expect((await trainRows(page, 'cardio_sessions'))[0]?.performed_on).toBe(yesterday)
  await expect(page.locator('[data-screen="training"] .tr-status')).toHaveCount(0, { timeout: 15_000 })
})

test('有氧連按兩次送出：只存一筆（關閉動畫期間表單還在，第二次 Enter 不該再送）', async ({ page }) => {
  await openApp(page)
  await openTraining(page)
  await openCardio(page)
  await field(page, '分鐘').fill('30')
  await field(page, '分鐘').press('Enter')
  // 第一筆寫完（列出現）時 sheet 才開始收：這段關閉動畫裡表單還在。寫入中按 Enter 不算數——
  // 送出鈕 disabled 時瀏覽器本來就不做隱式送出，所以要等寫完再按，才測得到「寫完之後 busy 有沒有放回去」
  await expect(cardioRows(page)).toHaveCount(1)
  await field(page, '分鐘').press('Enter', { timeout: 200 }).catch(() => undefined) // 已經收掉就按不到，也算過
  await expect(cardioSheet(page)).toHaveCount(0)
  await expect(cardioRows(page)).toHaveCount(1)
  await expect.poll(async () => (await trainRows(page, 'cardio_sessions')).length).toBe(1)
  await page.waitForTimeout(500) // 第二次若有送出，是在這段時間內落地
  expect(await trainRows(page, 'cardio_sessions')).toHaveLength(1)
})

test('sheet 裡的確認框：在對話框上往下拖不會拖走 sheet；點過背景再按 Escape 也只關對話框', async ({ page }) => {
  await openApp(page, {}, WITH_CARDIO)
  await openTraining(page)
  await cardioRows(page).click()
  await cardioSheet(page).getByRole('button', { name: '刪除這筆' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()

  const box = (await dialog.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 320, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await expect(cardioSheet(page), '往下拖不該把 sheet 拖走').toBeVisible()
  await expect(dialog).toBeVisible()

  // 點對話框外的背景（焦點會落到 sheet 上），再按 Escape
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 60)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(500)
  await expect(cardioSheet(page)).toBeVisible()
  expect(await trainRows(page, 'cardio_sessions')).toHaveLength(1)
})

test('不認得的有氧類型：列表原樣顯示；打開編輯直接儲存會擋下，不悄悄改成走路', async ({ page }) => {
  await openApp(page, {}, {
    ...FIX,
    cardio_sessions: [
      { id: 'c-x', performed_on: TODAY, kind: 'swim', minutes: 40, speed_kmh: null, incline_pct: null, est_kcal: 150 },
    ],
  })
  await openTraining(page)
  await expect(cardioRows(page).locator('.nm')).toHaveText('swim')
  await cardioRows(page).click()
  await expect(kindBtn(page, '跑步機坡度健走')).toHaveAttribute('aria-pressed', 'false')
  await expect(kindBtn(page, '有氧拳擊')).toHaveAttribute('aria-pressed', 'false')
  await cardioSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(cardioSheet(page).getByRole('alert')).toHaveText('請選有氧類型')
  await page.waitForTimeout(300)
  expect((await trainRows(page, 'cardio_sessions'))[0]).toMatchObject({ kind: 'swim', est_kcal: 150 })
})

/* ═══════════ 課表（第二輪 B 段） ═══════════ */

const editor = (page: Page) => page.locator('[data-screen="routine-editor"]')
const nameSheet = (page: Page) => page.locator('[data-screen="routine-name"]')
const targetSheet = (page: Page) => page.locator('[data-screen="routine-target"]')

const ROUTINE_FIX: typeof FIX = {
  ...WITH_WORKOUT,
  workouts: WITH_WORKOUT.workouts.map((w) => ({ ...w, routine_id: 'r-a' })), // 上次就是照菜單 A 做的
  routines: [{ id: 'r-a', name: '菜單 A', archived: false, created_at: '2026-10-01T00:00:00.000Z' }],
  routine_exercises: [
    { id: 're-1', routine_id: 'r-a', exercise_id: EX_ID, position: 0, target_sets: 3, target_reps: 12, created_at: '2026-10-01T00:00:01.000Z' },
  ],
}

async function newRoutine(page: Page, name: string) {
  await page.locator('[data-action="new-routine"]').click()
  await nameSheet(page).getByRole('textbox', { name: '課表名稱' }).fill(name)
  await nameSheet(page).getByRole('button', { name: '建立' }).click()
  await expect(editor(page)).toBeVisible()
}

test('新課表：先問名稱才建立（空名稱擋在 sheet 裡），建好直接進編輯頁、底部列收起', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await expect(page.locator('[data-screen="training"]')).toContainText('還沒有課表')

  await page.locator('[data-action="new-routine"]').click()
  await nameSheet(page).getByRole('button', { name: '建立' }).click()
  await expect(nameSheet(page).getByRole('alert')).toHaveText('名稱不能是空的')
  expect(await trainRows(page, 'routines'), '空名稱不該寫入').toHaveLength(0)

  await nameSheet(page).getByRole('textbox', { name: '課表名稱' }).fill('  菜單 A  ')
  await nameSheet(page).getByRole('button', { name: '建立' }).click()
  await expect(editor(page)).toBeVisible()
  await expect(editor(page).getByRole('heading', { name: '菜單 A' })).toBeVisible()
  await expect(page.locator('.bottom-bar')).toHaveCount(0)
  await expect
    .poll(async () => (await trainRows(page, 'routines'))[0])
    .toMatchObject({ name: '菜單 A', archived: false })
})

test('課表編輯：加動作、改預設組次、移除；每個修改都落到伺服器', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await newRoutine(page, '菜單 A')

  for (const name of ['腿推舉', '坐姿划船']) {
    await page.locator('[data-action="add-routine-exercise"]').click()
    await page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: name }).click()
    await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
  }
  const rows = editor(page).locator('[data-section="routine-exercises"] li.tr-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('腿推舉')
  await expect(rows.nth(0).locator('.sub')).toHaveText('沒做過時預設 3 組')
  await expect(rows.nth(1)).toContainText('坐姿划船')

  await rows.nth(0).getByRole('button', { name: /改預設組次/ }).click()
  await targetSheet(page).getByLabel('預設組數').fill('4')
  await targetSheet(page).getByLabel('預設次數').fill('10')
  await targetSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(targetSheet(page)).toHaveCount(0)
  await expect(rows.nth(0).locator('.sub')).toHaveText('沒做過時預設 4 組 × 10')

  await rows.nth(1).getByRole('button', { name: '移除坐姿划船' }).click()
  await expect(rows).toHaveCount(1)

  await expect
    .poll(async () => (await trainRows(page, 'routine_exercises')).map((r) => [r.exercise_id, r.position, r.target_sets, r.target_reps]))
    .toEqual([[LEG_ID, 0, 4, 10]])
})

test('預設組次的守門：範圍外擋在 sheet 裡說明，不寫入、不關', async ({ page }) => {
  await openApp(page, {}, ROUTINE_FIX)
  await openTraining(page)
  await page.locator('.tr-row[data-routine-id="r-a"]').click()
  await editor(page).getByRole('button', { name: /改預設組次/ }).click()

  for (const [sets, reps, msg] of [
    ['0', '', '組數要是 1–20'],
    ['21', '', '組數要是 1–20'],
    ['3', '1000', '次數要是 1–999'],
    ['3', '8.5', '次數要是 1–999'],
  ]) {
    await targetSheet(page).getByLabel('預設組數').fill(sets)
    await targetSheet(page).getByLabel('預設次數').fill(reps)
    await targetSheet(page).getByRole('button', { name: '儲存' }).click()
    await expect(targetSheet(page).getByRole('alert')).toContainText(msg)
  }
  const stored = (await trainRows(page, 'routine_exercises'))[0]
  expect([stored.target_sets, stored.target_reps], '伺服器上的值不該被動到').toEqual([3, 12])
})

test('改名：失焦才寫；改成空白放回原值並說明', async ({ page }) => {
  await openApp(page, {}, ROUTINE_FIX)
  await openTraining(page)
  await page.locator('.tr-row[data-routine-id="r-a"]').click()
  const field = editor(page).getByRole('textbox', { name: '課表名稱' })

  await field.fill('菜單 A（胸背）')
  await field.press('Enter')
  await expect(editor(page).getByRole('heading', { name: '菜單 A（胸背）' })).toBeVisible()
  await expect
    .poll(async () => (await trainRows(page, 'routines')).find((r) => r.id === 'r-a')?.name)
    .toBe('菜單 A（胸背）')

  await field.fill('   ')
  await field.press('Enter')
  await expect(editor(page)).toContainText('名稱不能是空的')
  await expect(field).toHaveValue('菜單 A（胸背）')
})

test('複製課表：進到「原名稱 複本」，動作與預設組次照搬，原本那份不動', async ({ page }) => {
  await openApp(page, {}, ROUTINE_FIX)
  await openTraining(page)
  await page.locator('.tr-row[data-routine-id="r-a"]').click()
  await editor(page).getByRole('button', { name: '複製課表' }).click()

  await expect(editor(page).getByRole('heading', { name: '菜單 A 複本' })).toBeVisible()
  const rows = editor(page).locator('[data-section="routine-exercises"] li.tr-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('腿推舉')
  await expect(rows.first().locator('.sub')).toHaveText('沒做過時預設 3 組 × 12')

  await expect.poll(async () => (await trainRows(page, 'routines')).map((r) => r.name).sort()).toEqual(['菜單 A', '菜單 A 複本'])
  // 父列先送、子列隨後：等子列到，不能在課表那筆到了的瞬間就讀一次
  await expect
    .poll(async () =>
      (await trainRows(page, 'routine_exercises'))
        .filter((r) => r.routine_id !== 'r-a')
        .map((r) => [r.exercise_id, r.position, r.target_sets, r.target_reps]),
    )
    .toEqual([[EX_ID, 0, 3, 12]])
})

test('封存課表：回清單、從開始訓練選單消失、列在「已封存的課表」；可取消封存', async ({ page }) => {
  await openApp(page, {}, ROUTINE_FIX)
  await openTraining(page)
  await page.locator('.tr-row[data-routine-id="r-a"]').click()
  await editor(page).locator('[data-action="toggle-routine-archive"]').click()

  const screen = page.locator('[data-screen="training"]')
  await expect(screen).toBeVisible()
  await expect(screen.locator('[data-section="routines"]')).toHaveCount(0)
  await expect(screen.locator('[data-section="archived-routines"] .tr-row')).toContainText('菜單 A')
  await page.getByRole('button', { name: '開始訓練' }).click()
  await expect(page.locator('[data-screen="start-sheet"] [data-routine-id]'), '封存的課表不進選單').toHaveCount(0)
  await page.getByRole('button', { name: '關閉' }).click()
  await expect(page.locator('[data-screen="start-sheet"]')).toHaveCount(0)

  await screen.locator('[data-section="archived-routines"] .tr-row').click()
  await editor(page).locator('[data-action="toggle-routine-archive"]').click()
  await expect(editor(page), '取消封存留在原頁').toBeVisible()
  await editor(page).getByRole('button', { name: '返回' }).click()
  await expect(screen.locator('[data-section="routines"] .tr-row')).toContainText('菜單 A')
  await expect
    .poll(async () => (await trainRows(page, 'routines')).find((r) => r.id === 'r-a')?.archived)
    .toBe(false)
})

test('開始訓練選課表：動作依序帶入、有歷史的取上次實際完成的值、訓練記下 routine_id', async ({ page }) => {
  await openApp(page, {}, ROUTINE_FIX)
  await openTraining(page)
  await expect(page.locator('.tr-row[data-routine-id="r-a"]')).toContainText(/1 個動作 · 上次 \d+\/\d+/)

  await page.getByRole('button', { name: '開始訓練' }).click()
  const pick = page.locator('[data-screen="start-sheet"] [data-routine-id="r-a"]')
  await expect(pick).toContainText('菜單 A')
  await pick.click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()

  // 課表預設是 3 組 × 12，但這個動作有歷史（2 組 60×12）——一律取歷史，不是課表預設
  await expect(page.locator('.ex .set')).toHaveCount(2)
  await expect(page.locator('.ex .set').first().locator('.w')).toHaveText('60')
  await expect(page.locator('.ex .set').first().locator('.r')).toHaveText('12')

  await expect
    .poll(async () => (await trainRows(page, 'workouts')).find((w) => w.id !== 'w-1')?.routine_id)
    .toBe('r-a')
})

test('沒做過的動作：用課表的預設組數與次數、重量 0', async ({ page }) => {
  const fix: typeof FIX = {
    ...ROUTINE_FIX,
    workouts: [],
    workout_exercises: [],
    workout_sets: [],
    routine_exercises: [
      { id: 're-1', routine_id: 'r-a', exercise_id: EX_ID, position: 0, target_sets: 4, target_reps: 8, created_at: '2026-10-01T00:00:01.000Z' },
    ],
  }
  await openApp(page, {}, fix)
  await openTraining(page)
  await page.getByRole('button', { name: '開始訓練' }).click()
  await page.locator('[data-screen="start-sheet"] [data-routine-id="r-a"]').click()
  await expect(page.locator('.ex .set')).toHaveCount(4)
  await expect(page.locator('.ex .set').first().locator('.w')).toHaveText('0')
  await expect(page.locator('.ex .set').first().locator('.r')).toHaveText('8')
})

test('離線建課表、加動作：畫面立刻有，回線後上傳且父列先到', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await setOffline(page, true)

  await newRoutine(page, '菜單 B')
  await page.locator('[data-action="add-routine-exercise"]').click()
  await page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: '腿推舉' }).click()
  await expect(editor(page).locator('li.tr-row', { hasText: '腿推舉' })).toBeVisible()
  expect(await trainRows(page, 'routines'), '離線時伺服器還沒收到').toHaveLength(0)

  await setOffline(page, false)
  await expect.poll(async () => (await trainRows(page, 'routines')).length, { timeout: 15_000 }).toBe(1)
  await expect.poll(async () => (await trainRows(page, 'routine_exercises')).length, { timeout: 15_000 }).toBe(1)
})

/* ═══════════ 課表排序（第二輪 B 段，拖曳） ═══════════ */

const SORT_FIX: typeof FIX = {
  ...LIBRARY_FIX,
  routines: [{ id: 'r-s', name: '菜單 S', archived: false, created_at: '2026-10-01T00:00:00.000Z' }],
  routine_exercises: [
    { id: 'rs-1', routine_id: 'r-s', exercise_id: LEG_ID, position: 0, target_sets: 3, target_reps: null, created_at: '2026-10-01T00:00:01.000Z' },
    { id: 'rs-2', routine_id: 'r-s', exercise_id: ROW_ID, position: 1, target_sets: 3, target_reps: null, created_at: '2026-10-01T00:00:02.000Z' },
    { id: 'rs-3', routine_id: 'r-s', exercise_id: OLD_ID, position: 2, target_sets: 3, target_reps: null, created_at: '2026-10-01T00:00:03.000Z' },
  ],
}

const sortRows = (page: Page) => editor(page).locator('[data-section="routine-exercises"] li.tr-row[data-routine-exercise-id]')
const storedOrder = async (page: Page) =>
  (await trainRows(page, 'routine_exercises'))
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((r) => r.id)

async function openSortRoutine(page: Page) {
  await openApp(page, {}, SORT_FIX)
  await openTraining(page)
  await page.locator('.tr-row[data-routine-id="r-s"]').click()
  await expect(sortRows(page)).toHaveCount(3)
}

test('課表排序（鍵盤）：握把聚焦後空白鍵拿起、方向鍵移動、空白鍵放下，位置落到伺服器', async ({ page }) => {
  await openSortRoutine(page)
  await expect(sortRows(page).locator('.nm')).toHaveText(['腿推舉', '坐姿划船', '舊的肩推'])

  await page.getByRole('button', { name: '拖曳排序：腿推舉' }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')

  await expect(sortRows(page).locator('.nm')).toHaveText(['坐姿划船', '舊的肩推', '腿推舉'])
  await expect.poll(() => storedOrder(page)).toEqual(['rs-2', 'rs-3', 'rs-1'])
  // 重新進來（讀的是資料不是畫面殘留）順序仍是新的
  await editor(page).getByRole('button', { name: '返回' }).click()
  await page.locator('.tr-row[data-routine-id="r-s"]').click()
  await expect(sortRows(page).locator('.nm')).toHaveText(['坐姿划船', '舊的肩推', '腿推舉'])
})

test('課表排序（Esc 取消）：不寫入、順序不變', async ({ page }) => {
  await openSortRoutine(page)
  await page.getByRole('button', { name: '拖曳排序：腿推舉' }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')

  await expect(sortRows(page).locator('.nm')).toHaveText(['腿推舉', '坐姿划船', '舊的肩推'])
  await page.waitForTimeout(500)
  expect(await storedOrder(page)).toEqual(['rs-1', 'rs-2', 'rs-3'])
})

test('課表排序（指標拖曳）：抓握把往下拖到最後一列，只有握把能拖', async ({ page }) => {
  await openSortRoutine(page)
  const grip = page.getByRole('button', { name: '拖曳排序：腿推舉' })
  const from = (await grip.boundingBox())!
  const to = (await sortRows(page).nth(2).boundingBox())!

  // 每一段之後停一下：dnd-kit 的碰撞偵測與位移都跟著 animation frame 走，滑鼠一口氣瞬移過去它來不及算
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + 20, { steps: 5 })
  await page.waitForTimeout(150)
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2 + 10, { steps: 15 })
  await page.waitForTimeout(300)
  await page.mouse.up()

  await expect(sortRows(page).locator('.nm')).toHaveText(['坐姿划船', '舊的肩推', '腿推舉'])
  await expect.poll(() => storedOrder(page)).toEqual(['rs-2', 'rs-3', 'rs-1'])
})

test('課表排序：只有握把是拖曳來源（每列一個拖曳控制；名稱區按下拖動不會排序）', async ({ page }) => {
  await openSortRoutine(page)
  // 沒登記握把時函式庫會把整列變成拖曳來源（再多出一顆同名的 button）——每列必須只有握把一個
  for (const name of ['腿推舉', '坐姿划船', '舊的肩推']) {
    await expect(page.getByRole('button', { name: `拖曳排序：${name}` })).toHaveCount(1)
  }
  const name = (await sortRows(page).nth(0).locator('.tr-row-main').boundingBox())!
  const last = (await sortRows(page).nth(2).boundingBox())!

  await page.mouse.move(name.x + 60, name.y + name.height / 2)
  await page.mouse.down()
  await page.mouse.move(name.x + 60, name.y + name.height / 2 + 20, { steps: 5 })
  await page.waitForTimeout(150)
  await page.mouse.move(name.x + 60, last.y + last.height / 2 + 10, { steps: 15 })
  await page.waitForTimeout(300)
  await page.mouse.up()

  await expect(sortRows(page).locator('.nm')).toHaveText(['腿推舉', '坐姿划船', '舊的肩推'])
  expect(await storedOrder(page)).toEqual(['rs-1', 'rs-2', 'rs-3'])
})

test('課表排序：離線排好，回線後上傳', async ({ page }) => {
  await openSortRoutine(page)
  await setOffline(page, true)
  await page.getByRole('button', { name: '拖曳排序：坐姿划船' }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Space')

  await expect(sortRows(page).locator('.nm')).toHaveText(['坐姿划船', '腿推舉', '舊的肩推'])
  expect(await storedOrder(page), '離線時伺服器還是舊順序').toEqual(['rs-1', 'rs-2', 'rs-3'])
  await setOffline(page, false)
  await expect.poll(() => storedOrder(page), { timeout: 15_000 }).toEqual(['rs-2', 'rs-1', 'rs-3'])
})

/* ═══════════ 訓練中改版：左滑刪除、全部完成、進度、新增一組、排序 ═══════════ */

/** 在某一列上用滑鼠左滑 dx px：從左側組號處起手（不壓在按鈕上）。用 harness 的 slowDrag：冷頁面上 `mouse.move({ steps })` 不足以讓 motion 的 drag 起手。 */
async function swipeLeft(page: Page, row: Locator, dx: number) {
  const box = (await row.boundingBox())!
  const from = { x: box.x + 30, y: box.y + box.height / 2 }
  await slowDrag(page, from, leg(from, { x: from.x - dx, y: from.y }))
}

test('組列左滑露出紅鈕，點紅鈕才刪；開著時點內容只關掉不觸發；只剩一組不能左滑', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const rows = page.locator('.ex .swipe-row')
  await expect(rows).toHaveCount(2)

  await swipeLeft(page, rows.nth(1), 70)
  await expect(rows.nth(1)).toHaveClass(/is-open/)
  // 同時只有一列是開的
  await swipeLeft(page, rows.nth(0), 70)
  await expect(rows.nth(0)).toHaveClass(/is-open/)
  await expect(page.locator('.ex .swipe-row.is-open')).toHaveCount(1)

  // 開著時點內容：只關掉，不觸發底下的勾或開 sheet
  await rows.nth(0).locator('.tr-check').click()
  await expect(page.locator('.ex .swipe-row.is-open')).toHaveCount(0)
  await expect(page.locator('.ex .set.done')).toHaveCount(0)
  await swipeLeft(page, rows.nth(0), 70)
  await expect(rows.nth(0)).toHaveClass(/is-open/)
  await rows.nth(0).locator('.w').click()
  await expect(page.locator('.ex .swipe-row.is-open')).toHaveCount(0)
  await expect(setSheet(page)).toHaveCount(0)

  // 垂直捲動優先：幾乎只往上下拖、帶一點左偏，不該開
  const box = (await rows.nth(1).boundingBox())!
  const from = { x: box.x + 30, y: box.y + 10 }
  await slowDrag(page, from, leg(from, { x: from.x - 6, y: from.y + 60 }))
  await expect(page.locator('.ex .swipe-row.is-open')).toHaveCount(0)

  // 左滑露出紅鈕，點了才刪（不再多跳確認框）
  await swipeLeft(page, rows.nth(1), 70)
  await page.getByRole('button', { name: '刪除第 2 組' }).click()
  await expect(page.locator('.ex .set')).toHaveCount(1)
  await expect.poll(async () => (await trainRows(page, 'workout_sets')).filter((r) => r.workout_exercise_id !== 'we-1').length).toBe(1)

  // 只剩一組：沒有紅鈕、也滑不開
  await expect(page.locator('.ex .swipe-delete')).toHaveCount(0)
  await swipeLeft(page, page.locator('.ex .swipe-row').first(), 70)
  await expect(page.locator('.ex .swipe-row.is-open')).toHaveCount(0)
})

/* ── 動效取樣：動畫是 JS 在跑，看不到 CSS 動畫，只能在 DOM 變動當下起每幀量 computed style ── */
interface Sample { t: number; o: number; x: number; y: number }
type Series = Sample[]

/** 從現在起，每個新掛進 DOM、符合 selector 的節點（含整塊新掛進來的子樹裡的後代）都各自取樣約 700ms。用 readSeries 取回。 */
async function watchAdded(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const w = window as unknown as { __series: Series[]; __observer?: MutationObserver }
    w.__observer?.disconnect() // 連續呼叫時舊的觀察器要關掉，否則同一個節點被取樣兩次
    w.__series = []
    const seen = new WeakSet<Node>() // 同一個節點可能在父層與自己的紀錄裡各報一次
    w.__observer = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const added of Array.from(m.addedNodes)) {
          if (!(added instanceof HTMLElement)) continue
          const targets = [added, ...Array.from(added.querySelectorAll<HTMLElement>(sel))].filter((n) => n.matches(sel))
          for (const n of targets) {
            if (seen.has(n)) continue
            seen.add(n)
            const out: Series = []
            const t0 = performance.now()
            const tick = () => {
              const cs = getComputedStyle(n)
              const mx = new DOMMatrix(cs.transform)
              out.push({ t: performance.now() - t0, o: Number(cs.opacity), x: mx.m41, y: mx.m42 })
              if (performance.now() - t0 < 700) requestAnimationFrame(tick)
            }
            tick()
            w.__series.push(out)
          }
        }
      }
    })
    w.__observer.observe(document.body, { childList: true, subtree: true })
  }, selector)
}
const readSeries = (page: Page) => page.evaluate(() => (window as unknown as { __series: Series[] }).__series)

/** 對一個現有的節點每幀取樣，直到它離開 DOM（最多 800ms）。先 await 這個 promise 之前就要觸發動作。 */
const sampleUntilGone = (el: Locator) =>
  el.evaluate(
    (n) =>
      new Promise<{ out: Series; gone: boolean }>((resolve) => {
        const out: Series = []
        const t0 = performance.now()
        const tick = () => {
          const cs = getComputedStyle(n)
          const mx = new DOMMatrix(cs.transform)
          out.push({ t: performance.now() - t0, o: Number(cs.opacity), x: mx.m41, y: mx.m42 })
          if (!n.isConnected || performance.now() - t0 > 800) resolve({ out, gone: !n.isConnected })
          else requestAnimationFrame(tick)
        }
        tick()
      }),
  )

test('新增一組：新列由上方 8px 淡入；卡片展開時已有的組不跑進場', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await expect(page.locator('.ex .set')).toHaveCount(2)
  await watchAdded(page, '.set-slot')
  await page.locator('.ex').first().getByRole('button', { name: '新增一組' }).click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await page.waitForTimeout(800)

  const series = await readSeries(page)
  expect(series, '只有新增的那一列跑進場').toHaveLength(1)
  const [rowSeries] = series
  expect(rowSeries[0].o, '一開始是透明').toBeLessThan(0.2)
  expect(rowSeries[0].y, '一開始在上方約 8px').toBeLessThan(-4)
  expect(rowSeries.some((s) => s.o > 0.2 && s.o < 0.95), '中間有過渡，不是瞬間跳').toBe(true)
  const last = rowSeries.at(-1)!
  expect(last.o).toBe(1)
  expect(Math.abs(last.y)).toBeLessThan(0.5)

  // 收合再展開：已有的組不該再跑進場
  await watchAdded(page, '.set-slot')
  await page.locator('.ex .ex-toggle').click()
  await expect(page.locator('.ex .set')).toHaveCount(0)
  await page.locator('.ex .ex-toggle').click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await page.waitForTimeout(500)
  const reopened = await readSeries(page)
  expect(reopened.length, '三列都有被取樣到').toBe(3)
  for (const s of reopened) expect(s[0].o, '展開時已有的組一出現就是不透明').toBe(1)
})

test('刪除一組：該列淡出並左移 12px 後離開；高度一併收掉', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const slots = page.locator('.ex .set-slot')
  await expect(slots).toHaveCount(2)

  await swipeLeft(page, page.locator('.ex .swipe-row').nth(1), 70)
  await expect(page.locator('.ex .swipe-row').nth(1)).toHaveClass(/is-open/)
  const sampling = sampleUntilGone(slots.nth(1))
  await page.getByRole('button', { name: '刪除第 2 組' }).click()
  const { out, gone } = await sampling

  expect(gone, '動畫結束後那一列離開 DOM').toBe(true)
  expect(out.some((s) => s.o > 0.05 && s.o < 0.95), '淡出有過渡').toBe(true)
  expect(Math.min(...out.map((s) => s.x)), '往左移（約 12px）').toBeLessThan(-4)
  expect(Math.min(...out.map((s) => s.x)), '不超過 12px 太多').toBeGreaterThan(-13)
  // 取樣在點擊之前就開始了，所以從「第一次開始變透明」量到離開 DOM
  const start = out.find((s) => s.o < 0.99)!
  expect(out.at(-1)!.t - start.t, '約 160ms 內收完').toBeLessThan(400)
  await expect(page.locator('.ex .set')).toHaveCount(1)
})

test('新增與刪除一組：減少動態只剩淡入淡出，沒有位移', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await watchAdded(page, '.set-slot')
  await page.locator('.ex').first().getByRole('button', { name: '新增一組' }).click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await page.waitForTimeout(500)
  const [added] = await readSeries(page)
  expect(added.every((s) => s.x === 0 && s.y === 0), '新增沒有位移').toBe(true)
  expect(added.at(-1)!.o).toBe(1)

  await swipeLeft(page, page.locator('.ex .swipe-row').nth(2), 70)
  const sampling = sampleUntilGone(page.locator('.ex .set-slot').nth(2))
  await page.getByRole('button', { name: '刪除第 3 組' }).click()
  const { out, gone } = await sampling
  expect(gone).toBe(true)
  // 位移與縮放都省掉：slot 自己沒有 x／y（swipe-slide 在它裡面，不算）
  expect(out.every((s) => s.x === 0 && s.y === 0), '刪除沒有位移').toBe(true)
})

test('組編輯 sheet 的 ± 數字翻動：變動時下移 35% 淡入，開 sheet 時不翻', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await watchAdded(page, '.flip')
  await openSetSheet(page, 0)
  await page.waitForTimeout(400)
  const opening = await readSeries(page)
  expect(opening.length, '重量與次數各一個數字').toBe(2)
  for (const s of opening) expect(s[0].o, '開 sheet 時數字一出現就是不透明、不翻').toBe(1)

  await watchAdded(page, '.flip')
  await setSheet(page).getByRole('button', { name: '重量加 2.5 公斤' }).click()
  await expect(page.locator('.ex .set').first().locator('.w')).toHaveText('62.5')
  await page.waitForTimeout(400)
  const [flip, ...rest] = await readSeries(page)
  expect(rest, '只有被改的那個數字翻').toHaveLength(0)
  expect(flip[0].o, '一開始是透明').toBeLessThan(0.3)
  expect(flip[0].y, '一開始在下方（約數字高度的 35%）').toBeGreaterThan(3)
  expect(flip.some((s) => s.o > 0.3 && s.o < 0.95), '中間有過渡').toBe(true)
  const last = flip.at(-1)!
  expect(last.o).toBe(1)
  expect(Math.abs(last.y)).toBeLessThan(0.5)
  expect(last.t, '120ms 級的短動畫，不是拖長的').toBeGreaterThan(100)
})

test('全部完成：欄頭雙勾一次打勾所有未完成的組；全勾時再按全部取消；狀態由各組推出', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const all = (name: '全部完成' | '取消全部完成') => page.locator('.ex').getByRole('button', { name, exact: true })

  await expect(all('全部完成')).toHaveAttribute('aria-pressed', 'false')
  await tick(page, 0)
  await expect(all('全部完成'), '只勾了一組：還不是全部完成').toHaveAttribute('aria-pressed', 'false')
  await all('全部完成').click()
  await expect(stat(page, 'sets')).toHaveText('2/2')
  await expect(all('取消全部完成')).toHaveAttribute('aria-pressed', 'true')

  // 手動取消一組：雙勾跟著回到未全勾
  await tick(page, 1)
  await expect(stat(page, 'sets')).toHaveText('1/2')
  await expect(all('全部完成')).toHaveAttribute('aria-pressed', 'false')

  await all('全部完成').click()
  await expect(stat(page, 'sets')).toHaveText('2/2')
  await all('取消全部完成').click()
  await expect(stat(page, 'sets')).toHaveText('0/2')
  await expect
    .poll(async () => (await trainRows(page, 'workout_sets')).filter((r) => r.workout_exercise_id !== 'we-1').map((r) => r.done))
    .toEqual([false, false])
})

test('收合時第二行看進度（圓點＋下一組），展開時看肌群；新增一組是最後一組下方的整列', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const card = page.locator('.ex').first()
  const toggle = card.locator('.ex-toggle')

  await expect(card.locator('.sub .dot'), '展開時第二行是肌群，沒有圓點').toHaveCount(0)
  await toggle.click()
  await expect(card.locator('.set')).toHaveCount(0)
  await expect(card.locator('.sub .dot')).toHaveCount(2)
  await expect(card.locator('.sub .dot.is-done')).toHaveCount(0)
  await expect(card.locator('.sub')).toContainText('下一組 60 kg × 12')
  await expect(card.locator('.sub'), '不顯示分數').not.toContainText('0/2')

  await toggle.click()
  await tick(page, 0)
  await toggle.click()
  await expect(card.locator('.sub .dot.is-done')).toHaveCount(1)
  await toggle.click()
  await tick(page, 1)
  await toggle.click()
  await expect(card.locator('.sub')).toContainText('全部完成')

  // 新增一組：最後一組下方的整列，新組沿用最後一組的值
  await toggle.click()
  const add = card.getByRole('button', { name: '新增一組' })
  await expect(card.locator('.ex-body > :last-child')).toHaveText('新增一組')
  await add.click()
  await expect(card.locator('.set')).toHaveCount(3)
  await expect(card.locator('.set').nth(2).locator('.w')).toHaveText('60')
  await expect(card.locator('.set').nth(2).locator('.r')).toHaveText('12')
  await expect(card.locator('.set').nth(2)).not.toHaveClass(/done/)
})

test('收合列：滿 8 組的圓點加上很長的「下一組」不會把箭頭與 ⓘ 擠出卡片', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const card = page.locator('.ex').first()
  for (let i = 0; i < 5; i++) await card.getByRole('button', { name: '新增一組' }).click()
  await expect(card.locator('.set')).toHaveCount(7)
  // 第 1 組改成又重又多的數字，讓「下一組 …」最長
  await openSetSheet(page, 0)
  await setSheet(page).getByRole('button', { name: '重量，點一下直接輸入' }).click()
  await setSheet(page).getByRole('textbox', { name: '重量' }).fill('187.5')
  await setSheet(page).getByRole('textbox', { name: '重量' }).press('Enter')
  await setSheet(page).getByRole('button', { name: '次數，點一下直接輸入' }).click()
  await setSheet(page).getByRole('textbox', { name: '次數' }).fill('150')
  await setSheet(page).getByRole('textbox', { name: '次數' }).press('Enter')
  await closeSetSheet(page)
  await card.getByRole('button', { name: '新增一組' }).click()
  await expect(card.locator('.set')).toHaveCount(8)

  await card.locator('.ex-toggle').click()
  await expect(card.locator('.set')).toHaveCount(0)
  await expect(card.locator('.sub .dot')).toHaveCount(8)
  const cardBox = (await card.boundingBox())!
  for (const sel of ['.ex-toggle .chev', '.ex-info', '[aria-label$="的更多操作"]']) {
    const box = (await card.locator(sel).boundingBox())!
    expect(box.x + box.width, `${sel} 要在卡片右緣之內`).toBeLessThanOrEqual(cardBox.x + cardBox.width)
  }
  const overflow = await card.locator('.ex-head').evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow, '卡片頭沒有橫向溢出').toBeLessThanOrEqual(0)
  // 不截斷的話文字會折成兩行、把卡片頭撐高（不是橫向溢出），所以也要量高度：收合卡片頭只該有一行名稱＋一行進度
  const headHeight = await card.locator('.ex-head').evaluate((el) => el.getBoundingClientRect().height)
  expect(headHeight, '進度只佔一行，卡片頭不長高').toBeLessThanOrEqual(64)
})

/* 訓練中排序：兩個動作，握把是唯一的拖曳來源；拖起時所有卡收合；範圍限制在清單區內（橡皮筋） */
async function openTwoExercises(page: Page) {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await addExercise(page, '坐姿划船')
  await expect(page.locator('.ex .nm')).toHaveText(['腿推舉', '坐姿划船'])
}
/** 握把聚焦、空白鍵拿起，並等 dnd-kit 真的進入拖曳：beforedragstart 之後它要等 React 把卡收合渲染完才開始，太快按方向鍵會被吃掉。 */
async function pickUp(page: Page, name: string) {
  await page.getByRole('button', { name: `拖曳排序：${name}` }).focus()
  await page.keyboard.press('Space')
  await expect(page.locator('[data-dnd-dragging="true"]')).toHaveCount(1)
}
const storedExerciseOrder = async (page: Page) =>
  (await trainRows(page, 'workout_exercises'))
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((r) => r.exercise_id)

test('訓練中排序（鍵盤）：握把聚焦後空白鍵拿起、方向鍵移動、空白鍵放下；拖起時所有卡收合，位置落到伺服器', async ({ page }) => {
  await openTwoExercises(page)
  await expect(page.locator('.ex .set').first()).toBeVisible() // 划船是展開的

  await pickUp(page, '腿推舉')
  await expect(page.locator('.tr-scroll.is-sorting')).toHaveCount(1)
  await expect(page.locator('.ex .set'), '拖起時所有卡收合（收合列仍看得到各自進度）').toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')

  await expect(page.locator('.ex .nm')).toHaveText(['坐姿划船', '腿推舉'])
  await expect(page.locator('.tr-scroll.is-sorting')).toHaveCount(0)
  await expect(page.locator('.ex .set').first(), '放下後恢復原本的展開').toBeVisible()
  await expect.poll(() => storedExerciseOrder(page)).toEqual([ROW_ID, LEG_ID])
})

test('訓練中排序（Esc 取消）：不寫入、順序不變、卡片恢復展開', async ({ page }) => {
  await openTwoExercises(page)
  await pickUp(page, '腿推舉')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')

  await expect(page.locator('.ex .nm')).toHaveText(['腿推舉', '坐姿划船'])
  await expect(page.locator('.tr-scroll.is-sorting')).toHaveCount(0)
  await expect(page.locator('.ex .set').first()).toBeVisible()
  await page.waitForTimeout(500)
  expect(await storedExerciseOrder(page)).toEqual([LEG_ID, ROW_ID])
})

test('訓練中排序（指標拖曳）：拉過清單上緣只露出橡皮筋的一小段、不會拖進統計區後面；放手排到最前', async ({ page }) => {
  await openTwoExercises(page)
  const list = (await page.locator('.tr-cards').boundingBox())!
  const stats = (await page.locator('.tr-stats').boundingBox())!
  const grip = (await page.getByRole('button', { name: '拖曳排序：坐姿划船' }).boundingBox())!
  const x = grip.x + grip.width / 2

  await page.mouse.move(x, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, grip.y + grip.height / 2 - 20, { steps: 5 })
  await page.waitForTimeout(150)
  // 一路拉到統計區中間（遠超過清單上緣）
  await page.mouse.move(x, stats.y + stats.height / 2, { steps: 20 })
  await page.waitForTimeout(300)

  // dnd-kit 會留一份隱藏的 placeholder（同 class），被拖的那張才有 data-dnd-dragging
  // 被拖的是展開中的划船：dnd-kit 在開始時凍結它的高度，所以要先收合再量（沒收合會是展開時的 300 多 px）。
  // 用輪詢：dnd-kit 的位置觀測是非同步的，機器忙時偶爾晚一兩幀才追上（全量 e2e 出現過一次 342px）；
  // 「根本沒收合」是永久偏高，輪詢仍會失敗
  await expect
    .poll(async () => (await page.locator('[data-dnd-dragging="true"]').boundingBox())!.height, { message: '被拖的卡是收合後的高度' })
    .toBeLessThan(100)
  const dragged = (await page.locator('[data-dnd-dragging="true"]').boundingBox())!
  expect(dragged.y, '最多露出約 14px 的橡皮筋，不會跑到統計區後面').toBeGreaterThan(list.y - 15)
  expect(dragged.y, '有露出橡皮筋的那一小段（不是硬夾在邊界）').toBeLessThan(list.y - 2)
  await page.mouse.up()

  await expect(page.locator('.ex .nm')).toHaveText(['坐姿划船', '腿推舉'])
  await expect.poll(() => storedExerciseOrder(page)).toEqual([ROW_ID, LEG_ID])
})

test('訓練中排序：只有握把是拖曳來源（名稱區按下拖動不會排序）；離線排好，回線後上傳', async ({ page }) => {
  await openTwoExercises(page)
  for (const name of ['腿推舉', '坐姿划船']) {
    await expect(page.getByRole('button', { name: `拖曳排序：${name}` })).toHaveCount(1)
  }
  const head = (await page.locator('.ex').first().locator('.ex-toggle').boundingBox())!
  const last = (await page.locator('.ex').nth(1).boundingBox())!
  await page.mouse.move(head.x + 60, head.y + head.height / 2)
  await page.mouse.down()
  await page.mouse.move(head.x + 60, head.y + head.height / 2 + 20, { steps: 5 })
  await page.waitForTimeout(150)
  await page.mouse.move(head.x + 60, last.y + last.height / 2, { steps: 15 })
  await page.waitForTimeout(300)
  await page.mouse.up()
  await expect(page.locator('.ex .nm')).toHaveText(['腿推舉', '坐姿划船'])
  expect(await storedExerciseOrder(page)).toEqual([LEG_ID, ROW_ID])

  await setOffline(page, true)
  await pickUp(page, '坐姿划船')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Space')
  await expect(page.locator('.ex .nm')).toHaveText(['坐姿划船', '腿推舉'])
  expect(await storedExerciseOrder(page), '離線時伺服器還是舊順序').toEqual([LEG_ID, ROW_ID])
  await setOffline(page, false)
  await expect.poll(() => storedExerciseOrder(page), { timeout: 15_000 }).toEqual([ROW_ID, LEG_ID])
})

/* ═══════════ 存成課表（第二輪 B 段，完成訓練 sheet） ═══════════ */

const finishSheet = (page: Page) => page.locator('[data-screen="finish-sheet"]')

test('存成課表：空白開始的訓練完成時可存；空名稱擋住；存下後不再提供第二次，課表進清單與伺服器', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await page.getByRole('button', { name: '完成訓練' }).click()

  const sheet = finishSheet(page)
  await sheet.locator('[data-action="save-as-routine"]').click()
  await sheet.getByRole('button', { name: '存成課表', exact: true }).click()
  await expect(sheet.getByText('名稱不能是空的')).toBeVisible()
  expect(await trainRows(page, 'routines'), '空名稱不該寫入').toHaveLength(0)

  await sheet.getByRole('textbox', { name: '課表名稱' }).fill('菜單 C')
  await sheet.getByRole('textbox', { name: '課表名稱' }).press('Enter')
  await expect(sheet.locator('[data-section="save-routine"]')).toContainText('已存成課表「菜單 C」')
  await expect(sheet.locator('[data-action="save-as-routine"]'), '存過就不再提供，免得連按存出兩份').toHaveCount(0)

  // 組數＝當時的組數（預填上次的 2 組）、次數＝第一組的次數；不帶重量
  await expect
    .poll(async () => (await trainRows(page, 'routine_exercises')).map((r) => [r.exercise_id, r.position, r.target_sets, r.target_reps]))
    .toEqual([[EX_ID, 0, 2, 12]])
  expect((await trainRows(page, 'routines')).map((r) => r.name)).toEqual(['菜單 C'])

  await sheet.getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
  await expect(page.locator('[data-section="routines"] .tr-row')).toContainText('菜單 C')
})

test('照課表開的訓練：完成時不提供「存成課表」（已經有課表了）', async ({ page }) => {
  await openApp(page, {}, ROUTINE_FIX)
  await openTraining(page)
  await page.getByRole('button', { name: '開始訓練' }).click()
  await page.locator('[data-screen="start-sheet"] [data-routine-id="r-a"]').click()
  await expect(page.locator('.ex .set').first()).toBeVisible()
  await page.getByRole('button', { name: '完成訓練' }).click()
  await expect(finishSheet(page)).toBeVisible()
  await expect(finishSheet(page).locator('[data-section="save-routine"]')).toHaveCount(0)
})

test('空白開始、還沒加任何動作：完成時不提供「存成課表」', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await page.getByRole('button', { name: '完成訓練' }).click()
  await expect(finishSheet(page)).toBeVisible()
  await expect(finishSheet(page).locator('[data-section="save-routine"]')).toHaveCount(0)
})

test('存成課表連按兩次 Enter：只存一份（Enter 不經過按鈕的 disabled）', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await page.getByRole('button', { name: '完成訓練' }).click()
  const sheet = finishSheet(page)
  await sheet.locator('[data-action="save-as-routine"]').click()
  const input = sheet.getByRole('textbox', { name: '課表名稱' })
  await input.fill('菜單 D')
  // 同一個 tick 內連送兩次 Enter：第二次發生時第一次的寫入還沒回來
  await input.evaluate((el) => {
    for (let i = 0; i < 2; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  await expect(sheet.locator('[data-section="save-routine"]')).toContainText('已存成課表「菜單 D」')
  await page.waitForTimeout(500)
  expect((await trainRows(page, 'routines')).map((r) => r.name)).toEqual(['菜單 D'])
})
