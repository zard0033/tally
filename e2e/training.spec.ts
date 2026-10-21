/* 訓練分頁（階段 2 第一輪第 2a 段）：分頁進得去、資料從本機底讀得到、連不上伺服器時講清楚、
   第一次開時預填 16 個動作。開始訓練／記組／離線記錄在後面的段落補。
   fetch 全 stub；注意 stub 的寫入不落地（寫進去的列下一次 GET 不會出現）。 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { gotoDate, leg, openApp, shiftIso, slowDrag } from './harness'
import { FIX, TODAY } from './fixtures'
import { SEEDED_FIX } from './seeded'

/* 本檔 87 條、約 690 秒，佔整套 e2e 的七成。平行單位預設是「檔案」，它在檔名順序裡排得很後面，
   前面的檔案先吃掉約 290 秒它才開始跑，最後只剩一個 worker 在做它（整套 981 秒、理想 649 秒）。
   各條都自己 openApp、不共用狀態（沒有 serial／beforeAll），所以開檔內平行讓兩個 worker 都吃得到。
   workers 仍是 2（WebKit 的記憶體上限，見 playwright.config.ts），沒有多開瀏覽器。 */
test.describe.configure({ mode: 'parallel' })

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

test('第一次開、伺服器上沒有任何動作：預填整份目錄 150 個，且是 insert-ignore（不蓋掉改過的）', async ({ page }) => {
  await openApp(page, {}, { ...FIX, exercises: [] })
  type W = { table: string; method: string; path: string; body: Record<string, unknown> | Record<string, unknown>[] }
  const posted = async () => {
    const writes = await page.evaluate(() => (window as unknown as { __writes: W[] }).__writes)
    return writes.filter((w) => w.table === 'exercises' && w.method === 'POST')
  }
  await expect.poll(async () => (await posted()).length, { timeout: 40_000 }).toBeGreaterThanOrEqual(150)

  const all = await posted()
  const ids = new Set(all.map((w) => String((Array.isArray(w.body) ? w.body[0] : w.body).id)))
  expect(ids.size, '150 個預設動作的 id 應互不相同').toBe(150)
  expect(all.every((w) => w.path.includes('on_conflict=id')), '預填要以 id 為衝突鍵').toBe(true)
  const names = all.map((w) => String((Array.isArray(w.body) ? w.body[0] : w.body).name))
  expect(names).toContain('腿推舉')
  expect(names).toContain('腹部捲曲機')
  expect(names).toContain('槓鈴臥推') // 新增的 134 個之一
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

/* ═══════════ 動作示意圖與自動補預設動作 ═══════════ */

/** 圖已載入且是 180 寬（Gym visual 的縮圖與動畫都是 180×180；lazy 圖要在視窗內才會載，所以用 poll）。 */
const imgLoaded = async (img: Locator) => {
  await img.scrollIntoViewIfNeeded() // loading="lazy" 的圖不在視窗內不會載
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth), { timeout: 10_000 }).toBe(180)
}

/** 動作庫裡有整份目錄 150 個動作的前置條件。直接給 fixture（`seeded.ts`），不走真的預填——
 *  150 筆 insert 逐筆上傳每條要約 15 秒。預填本身由「第一次開、伺服器上沒有任何動作」那條守。 */
async function openCatalogLibrary(page: Page) {
  await openApp(page, {}, SEEDED_FIX)
  await openTraining(page)
  await expect(page.locator('[data-action="open-library"]')).toContainText('150 個動作')
  await openLibrary(page)
}

test('動作示意圖：預設動作有照片、自建的動作用肌群單字；動作庫、加動作 sheet、訓練中卡片都有', async ({ page }) => {
  await openCatalogLibrary(page)
  // 自建一個動作（沒有圖）
  await library(page).getByRole('button', { name: '新增動作' }).click()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('我的自建動作')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)

  // 名稱要精確比對：「腿推舉」是新增的「窄站距腿推舉」的子字串
  const legRow = library(page).locator('.tr-row').filter({ has: page.getByText('腿推舉', { exact: true }) })
  const img = legRow.locator('img.ex-thumb')
  await expect(img).toHaveCount(1)
  expect(await img.getAttribute('src')).toMatch(/\/assets\/leg-press-[\w-]+\.jpg$/)
  expect(await img.getAttribute('alt'), '旁邊就是名稱，圖是裝飾').toBe('')
  await imgLoaded(img)

  const custom = library(page).locator('.tr-row', { hasText: '我的自建動作' })
  await expect(custom.locator('img.ex-thumb')).toHaveCount(0)
  await expect(custom.locator('.ex-thumb.is-glyph')).toHaveText('他')
  // 資料集沒有對應的預設動作（徒手深蹲、箱式深蹲）也是肌群單字、不是放大鈕
  for (const name of ['徒手深蹲', '箱式深蹲']) {
    const row = library(page).locator('.tr-row').filter({ has: page.getByText(name, { exact: true }) })
    await expect(row.locator('.ex-thumb.is-glyph'), `${name} 沒有圖，退回肌群單字`).toHaveCount(1)
    await expect(row.locator('.ex-zoom'), `${name} 沒有圖就沒有放大鈕`).toHaveCount(0)
  }
  const a = (await img.boundingBox())!
  const b = (await custom.locator('.ex-thumb').boundingBox())!
  expect([b.width, b.height], '沒有圖的縮圖與有圖的同尺寸，列不會因為有沒有圖而跳').toEqual([a.width, a.height])
  expect(await legRow.evaluate((el) => el.getBoundingClientRect().height)).toBe(await custom.evaluate((el) => el.getBoundingClientRect().height))

  // 加動作 sheet 與訓練中卡片
  await library(page).getByRole('button', { name: '返回' }).click()
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  const pickRow = page.locator('[data-screen="exercise-picker"] .tr-row').filter({ has: page.getByText('腿推舉', { exact: true }) })
  await expect(pickRow.locator('img.ex-thumb')).toHaveCount(1)
  await imgLoaded(pickRow.locator('img.ex-thumb'))
  await pickRow.click()
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
  const cardImg = page.locator('.ex .ex-head img.ex-thumb')
  await expect(cardImg).toHaveCount(1)
  await imgLoaded(cardImg)

  // 建置層：圖是獨立檔案、進了 precache（離線健身房看得到），沒有被內嵌成 base64 吞進主 JS
  const scripts = await page.evaluate(() => Array.from(document.scripts).map((el) => el.src).filter(Boolean))
  expect(scripts.length).toBeGreaterThan(0)
  for (const src of scripts) {
    const text = await (await page.request.get(src)).text()
    expect(/data:image\/(jpeg|gif)/.test(text), `${src} 不該內嵌動作圖`).toBe(false)
  }
  const sw = await (await page.request.get(new URL('sw.js', page.url()).href)).text()
  const precached = new Set(sw.match(/assets\/[\w-]+\.jpg/g) ?? [])
  // 148 個有圖的動作＝147 個不同的檔案（腿屈伸與單腿腿屈伸共用同一張圖，內容相同所以檔名雜湊也相同）進 precache，
  // 離線健身房看得到。動畫（gif，共約 14MB）不進：項數與體積太大時新版 SW 會偶發卡在 activating，見 vite.config.ts；
  // 這兩個斷言一起鎖住「縮圖都在、動畫都不在」
  expect(precached.size, 'service worker 的 precache 清單：縮圖').toBe(147)
  expect(sw.match(/\.gif/g), 'gif 動畫不該進 precache').toBeNull()
})

const viewer = (page: Page) => page.locator('[data-screen="exercise-viewer"]')

test('動作示意圖放大：點動作庫的縮圖開檢視器（一個 180×180 的示意動畫），不會誤開編輯；Esc 關、焦點回縮圖；自建動作沒有放大鈕', async ({ page }) => {
  await openCatalogLibrary(page)
  await library(page).getByRole('button', { name: '新增動作' }).click()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('我的自建動作')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)
  await expect(library(page).locator('.tr-row', { hasText: '我的自建動作' }).locator('.ex-zoom')).toHaveCount(0)

  const zoom = library(page).getByRole('button', { name: '放大腿推舉的示意圖' })
  const box = (await zoom.boundingBox())!
  expect(box.height, '觸控區 ≥ 44px').toBeGreaterThanOrEqual(44)
  await expect(zoom.locator('.ex-zoom-badge'), '縮圖角落有放大鏡角標，看得出能點').toHaveCount(1)
  expect(Math.round((await zoom.locator('img.ex-thumb').boundingBox())!.width), '列表縮圖 52px 寬').toBe(52)
  await zoom.click()
  await expect(viewer(page)).toBeVisible()
  await expect(editSheet(page), '點縮圖不該同時開編輯').toHaveCount(0)
  await expect(viewer(page).getByRole('heading', { name: '腿推舉' })).toBeVisible()
  await expect(viewer(page).locator('.ex-viewer-group'), '標題下一行是肌群').toHaveText('下半身')
  const imgs = viewer(page).locator('img')
  await expect(imgs, '一個動畫，沒有「起始／收尾」兩張').toHaveCount(1)
  expect(await imgs.getAttribute('src')).toMatch(/\/assets\/leg-press-[\w-]+\.gif$/)
  expect(await imgs.getAttribute('alt')).toBe('腿推舉示意動畫')
  await expect.poll(() => imgs.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth), { timeout: 10_000 }).toBe(180)
  await expect(viewer(page).locator('figcaption'), '動畫正常播放時沒有說明').toHaveCount(0)
  await expect(viewer(page).locator('.ex-viewer-credit'), '著作權人要求每次使用都附標示').toHaveText('© Gym visual — https://gymvisual.com/')
  const first = (await imgs.boundingBox())!
  expect(first.width, '放大後明顯比縮圖（52px）大').toBeGreaterThan(200)
  expect(Math.round(first.width), '寬高相同（正方形）').toBe(Math.round(first.height))
  const sheetH = (await viewer(page).boundingBox())!.height
  expect(sheetH, '檢視器貼合內容（圖＋標題＋標示），不是近全高留一大塊空白').toBeLessThan(first.height + 220)

  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
  await expect(zoom).toBeFocused()
})

test('動作示意圖放大：加動作 sheet 裡點縮圖只放大不選取；關掉後 sheet 還在，點名稱才選取', async ({ page }) => {
  await openCatalogLibrary(page)
  await library(page).getByRole('button', { name: '返回' }).click()
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  const picker = page.locator('[data-screen="exercise-picker"]')
  await picker.getByRole('button', { name: '放大腿推舉的示意圖' }).click()
  await expect(viewer(page)).toBeVisible()
  await expect(page.locator('.ex'), '還沒選取任何動作').toHaveCount(0)
  // 巢狀 sheet：Esc 只關最上面那張（檢視器），加動作 sheet 要留著
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
  await expect(picker, 'Esc 不該連加動作 sheet 一起關掉').toHaveCount(1)
  await picker.getByRole('button', { name: '放大腿推舉的示意圖' }).click()
  await expect(viewer(page)).toBeVisible()
  await viewer(page).getByRole('button', { name: '關閉' }).click()
  await expect(viewer(page)).toHaveCount(0)
  await expect(picker).toHaveCount(1)
  await picker.locator('[data-exercise-id]').filter({ has: page.getByText('腿推舉', { exact: true }) }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.ex')).toHaveCount(1)
})

test('動作示意圖放大：動畫載不到（離線不進 precache）就退成靜態縮圖並說明，下次開再試', async ({ page }) => {
  await openCatalogLibrary(page)
  await page.route('**/assets/*.gif', (route) => route.abort())
  const zoom = library(page).getByRole('button', { name: '放大腿推舉的示意圖' })
  await zoom.click()
  await expect(viewer(page)).toBeVisible()
  const imgs = viewer(page).locator('img')
  await expect(viewer(page).locator('figcaption'), '動畫失敗後說明原因').toHaveText('離線時只能看靜態圖，連上網路後再開就有動畫')
  await expect(imgs, '只有一張圖，沒有破圖').toHaveCount(1)
  expect(await imgs.getAttribute('src')).toMatch(/\/assets\/leg-press-[\w-]+\.jpg$/)
  expect(await imgs.getAttribute('alt')).toBe('腿推舉示意圖')
  await expect.poll(() => imgs.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth)).toBe(180)
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)

  // 網路回來：再開一次，動畫重新出現、說明消失
  await page.unroute('**/assets/*.gif')
  await zoom.click()
  await expect(viewer(page).locator('figcaption')).toHaveCount(0)
  await expect.poll(() => viewer(page).locator('img').getAttribute('src')).toMatch(/\.gif$/)
})

test('動作示意圖放大：減少動態時直接顯示靜態縮圖（GIF 沒辦法暫停）', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCatalogLibrary(page)
  let gifRequests = 0
  await page.route('**/assets/*.gif', (route) => {
    gifRequests++
    return route.continue()
  })
  await library(page).getByRole('button', { name: '放大腿推舉的示意圖' }).click()
  await expect(viewer(page)).toBeVisible()
  const imgs = viewer(page).locator('img')
  await expect(viewer(page).locator('figcaption')).toHaveText('已開啟「減少動態」，顯示靜態圖')
  expect(await imgs.getAttribute('src')).toMatch(/\.jpg$/)
  expect(gifRequests, '減少動態時不該去抓動畫').toBe(0)
})

test('動作示意圖放大：除了縮圖本身，整列都還是主按鈕（左內距、自建動作的肌群單字點了照樣開編輯）', async ({ page }) => {
  await openCatalogLibrary(page)
  await library(page).getByRole('button', { name: '新增動作' }).click()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('我的自建動作')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)

  // 預設動作：點縮圖左邊的內距（縮圖是放大鈕、這裡不是）
  const legRow = library(page).locator('.tr-row').filter({ has: page.getByText('腿推舉', { exact: true }) })
  await legRow.scrollIntoViewIfNeeded()
  const row = (await legRow.boundingBox())!
  await page.mouse.click(row.x + 6, row.y + row.height / 2)
  await expect(editSheet(page)).toBeVisible()
  await expect(viewer(page)).toHaveCount(0)
  await expect(editSheet(page).getByRole('textbox', { name: '名稱' })).toHaveValue('腿推舉')
  await page.keyboard.press('Escape')
  await expect(editSheet(page)).toHaveCount(0)

  // 自建動作：肌群單字不是按鈕，點它要落在主按鈕上
  const custom = library(page).locator('.tr-row', { hasText: '我的自建動作' })
  await custom.scrollIntoViewIfNeeded()
  const glyph = (await custom.locator('.ex-thumb.is-glyph').boundingBox())!
  await page.mouse.click(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2)
  await expect(editSheet(page)).toBeVisible()
  await expect(editSheet(page).getByRole('textbox', { name: '名稱' })).toHaveValue('我的自建動作')
})

test('動作示意圖放大：課表編輯的動作列也能點縮圖放大，不會開「改預設組次」', async ({ page }) => {
  await openCatalogLibrary(page)
  await library(page).getByRole('button', { name: '返回' }).click()
  await newRoutine(page, '菜單 A')
  await page.locator('[data-action="add-routine-exercise"]').click()
  await page.locator('[data-screen="exercise-picker"] [data-exercise-id]').filter({ has: page.getByText('腿推舉', { exact: true }) }).click()
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
  await editor(page).getByRole('button', { name: '放大腿推舉的示意圖' }).click()
  await expect(viewer(page)).toBeVisible()
  await expect(viewer(page).locator('img')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
  await expect(targetSheet(page), '點縮圖不該同時開「預設組次」').toHaveCount(0)
})

test('動作示意圖放大：訓練中卡片點縮圖只放大，卡片不收合', async ({ page }) => {
  await openCatalogLibrary(page)
  await library(page).getByRole('button', { name: '返回' }).click()
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  await page.locator('[data-screen="exercise-picker"] [data-exercise-id]').filter({ has: page.getByText('腿推舉', { exact: true }) }).click()
  const toggle = page.locator('.ex .ex-toggle')
  const before = await toggle.getAttribute('aria-expanded')
  await page.locator('.ex').getByRole('button', { name: '放大腿推舉的示意圖' }).click()
  await expect(viewer(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', before!)
})

/** App 自己預填過的帳號長的樣子：16 個原始預設動作。id 是 uuid v5(namespace, `${user_id}:exercise:${key}`)，
 *  字面值取自 Python 的 uuid.uuid5（獨立實作；e2e 不從 src 匯入，同時鎖住 id 演算法）。user_id 是 e2e 的 USER_ID。 */
const CORE_16: readonly (readonly [string, string, string])[] = [
  ['b560053d-4662-5165-9b70-01896120fc1e', '腿推舉', 'legs'],
  ['c9b81e59-2313-51db-add6-ea859a1a3cd1', '腿屈伸', 'legs'],
  ['fcc370ef-161f-5035-9dff-c5c2c8256183', '腿彎舉', 'legs'],
  ['769cad25-40d7-59b4-a3ae-d91e54aa83c7', '小腿提踵', 'legs'],
  ['d67da022-db61-5824-836c-d887e4283ce3', '髖外展', 'legs'],
  ['cdf09a62-eb19-5607-8bc0-e8ca9b1cb7d4', '髖內收', 'legs'],
  ['f89084a7-21a7-5b0a-9df5-159d11d3bf43', '滑輪下拉', 'back'],
  ['44ebaba1-ca88-5d6a-aa88-9d6ea34027cb', '坐姿划船', 'back'],
  ['1eb48a3a-b771-5c68-baf6-4b068d321e37', '背伸展機', 'back'],
  ['826da121-4cf1-5c6b-bfd9-883fea58c1f2', '坐姿胸推', 'chest'],
  ['4df2581a-a146-5d6d-84d6-8b1fce1a45e7', '蝴蝶機夾胸', 'chest'],
  ['8fd221c6-3f7a-5a9c-b6dd-b5f517edd577', '肩推', 'shoulder'],
  ['87b5a0ae-0417-56b1-8563-3c83e7dd6686', '反向蝴蝶機', 'shoulder'],
  ['3cda1acd-5920-55c8-8106-a9bbd4da51ad', '二頭彎舉（機械）', 'arms'],
  ['fd1b740d-c1d2-5059-9d05-4c9ad0cfa903', '三頭下壓（滑輪）', 'arms'],
  ['0fe71eb6-1255-5cce-87cc-aeef1b7c16c9', '腹部捲曲機', 'core'],
]
const coreRows = () =>
  CORE_16.map(([id, name, muscle_group], i) => ({
    id, user_id: '00000000-0000-0000-0000-000000000001', name, muscle_group, tips: null, archived: false,
    created_at: `2026-10-01T00:00:${String(i).padStart(2, '0')}.000Z`,
  }))

test('已經有 16 個預設動作的既有帳號：開 App 自動補其餘（不用按鈕），不蓋掉改過的、不補同名的', async ({ page }) => {
  const rows = coreRows()
  rows[0] = { ...rows[0], name: '我的腿推', archived: true, tips: '背貼緊' } // 使用者改過名、封存、寫了要點
  const custom = { id: '99999999-9999-4999-8999-999999999999', user_id: rows[0].user_id, name: '槓鈴臥推', muscle_group: 'chest', tips: null, archived: false, created_at: '2026-10-02T00:00:00.000Z' }
  await openApp(page, {}, { ...FIX, exercises: [...rows, custom] })
  await openTraining(page)

  // 不用按任何鈕：16＋自建 1＋補 133（目錄 134 個裡「槓鈴臥推」撞名不補）
  await expect.poll(async () => (await trainRows(page, 'exercises')).length, { timeout: 40_000 }).toBe(150)
  const all = await trainRows(page, 'exercises')
  expect(all.find((r) => r.id === rows[0].id), '改過名、封存、有要點的預設動作原封不動').toMatchObject({ name: '我的腿推', archived: true, tips: '背貼緊' })
  expect(all.filter((r) => r.name === '槓鈴臥推'), '整份動作庫只有一個「槓鈴臥推」').toHaveLength(1)
  expect(new Set(all.map((r) => String(r.name))).size, '沒有任何同名動作').toBe(150)
  const posts = (await page.evaluate(() => (window as unknown as { __writes: { table: string; method: string }[] }).__writes)).filter(
    (w) => w.table === 'exercises' && w.method === 'POST',
  )
  expect(posts, '只送缺的 133 個，已有的 17 個不送').toHaveLength(133)

  // 畫面上：沒有任何要按的入口，補進來的有圖，自建的同名那列照常能改要點
  await expect(page.locator('[data-action="open-library"]')).toContainText('149 個動作') // 150 減 1 個封存的
  await openLibrary(page)
  await expect(library(page).locator('[data-section="fill-catalog"]')).toHaveCount(0)
  const added = library(page).locator('.tr-row').filter({ has: page.getByText('啞鈴二頭彎舉', { exact: true }) })
  await expect(added.locator('img.ex-thumb')).toHaveCount(1)
  await imgLoaded(added.locator('img.ex-thumb'))
  await library(page).locator('.tr-row').filter({ has: page.getByText('槓鈴臥推', { exact: true }) }).click()
  await editSheet(page).getByRole('textbox', { name: '要點' }).fill('握距略寬於肩')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)
})

test('沒有任何預設動作的帳號（自己從零建的庫）：開 App 不會被灌進 150 個', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await expect(page.locator('[data-action="open-library"]')).toContainText('2 個動作')
  // 沒有事件可等的反向斷言：給自動補足夠的時間（正常情況下載入完立刻就會排進去）
  await page.waitForTimeout(2500)
  expect(await trainRows(page, 'exercises')).toHaveLength(3)
  const posts = (await page.evaluate(() => (window as unknown as { __writes: { table: string; method: string }[] }).__writes)).filter(
    (w) => w.table === 'exercises' && w.method === 'POST',
  )
  expect(posts).toHaveLength(0)
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

/* ── 動效取樣（舊量法，僅剩兩種用法還安全）：在 DOM 變動當下起每幀量 computed style ──
   ① 掛上當下的第一個樣本（同步取，起點是確定的）；② 「每一幀都符合」的斷言（幀少只會少驗、不會假紅）。
   **「中間有過渡」「最後一幀的值」「約 N ms 內收完」這類吃幀時間的斷言不要用**——機器忙時 rAF 幀間隔會拖到 40–100ms，
   短動畫取不到中間幀而假紅。要驗中間過程用下面的 watchFlips／readFlips（攔 Element.animate＋MutationObserver）。 */
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
  await watchFlips(page, '.set-slot') // 量法見 watchFlips 上方的說明：不靠逐幀取樣
  await page.locator('.ex').first().getByRole('button', { name: '新增一組' }).click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await page.waitForTimeout(800)

  const entered = await readFlips(page)
  expect(entered, '只有新增的那一列跑進場').toHaveLength(1)
  const [row] = entered
  expect(row.initialStyle, '一掛上就是透明').toContain('opacity: 0')
  expect(row.initialStyle, '一掛上就在上方 8px').toContain('translateY(-8px)')
  const fade = row.anims.find((a) => a.props.includes('opacity'))
  expect(fade, '淡入走 Web Animations').toBeTruthy()
  expect(fade!.ms, '淡入 220ms（durations.ts 的 DUR.mid）').toBe(220)
  expect(fade!.easing).toBe('ease-out')
  expect(row.finalO, '落定後不透明').toBe(1)
  expect(Math.abs(row.finalY), '落定後歸位').toBeLessThan(0.5)

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
  // 不靠逐幀取樣：全量跑機器忙時 rAF 幀間隔會拖到 50–100ms，160ms 的動畫只取到幾幀，左移最深的那幀常常沒取到
  // （2026-10-19 全量紅過一次：min x 只量到 -3.2，單跑 8 次全綠）。這裡量兩件與幀無關的事：
  // ① opacity 走 Web Animations——攔 Element.animate 記下呼叫（目標、時長、屬性）；
  // ② 位移與高度是 motion 每幀寫 inline style——MutationObserver 記每一次寫入，不管有沒有幀被 rAF 看到，
  //    最後一次寫入（-12px／0px）一定在紀錄裡。
  const watching = slots.nth(1).evaluate(
    (n) =>
      new Promise<{ anims: { props: string; ms: number }[]; xs: number[]; heights: number[]; gone: boolean }>((resolve) => {
        const anims: { props: string; ms: number }[] = []
        const xs: number[] = []
        const heights: number[] = []
        const native = Element.prototype.animate
        Element.prototype.animate = function (this: Element, kf: Keyframe[] | PropertyIndexedKeyframes | null, opts?: number | KeyframeAnimationOptions) {
          if (this === n) anims.push({ props: JSON.stringify(kf), ms: typeof opts === 'number' ? opts : Number(opts?.duration) })
          return native.call(this, kf, opts)
        }
        const style = new MutationObserver(() => {
          const el = n as HTMLElement
          const x = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform)
          if (x) xs.push(Number(x[1]))
          const h = /^([\d.]+)px$/.exec(el.style.height)
          if (h) heights.push(Number(h[1]))
        })
        style.observe(n, { attributes: true, attributeFilter: ['style'] })
        const finish = (gone: boolean) => {
          Element.prototype.animate = native
          style.disconnect()
          removal.disconnect()
          resolve({ anims, xs, heights, gone })
        }
        const removal = new MutationObserver(() => {
          if (!n.isConnected) finish(true)
        })
        removal.observe(n.parentElement!, { childList: true })
        setTimeout(() => finish(!n.isConnected), 1500)
      }),
  )
  await page.getByRole('button', { name: '刪除第 2 組' }).click()
  const { anims, xs, heights, gone } = await watching

  expect(gone, '動畫結束後那一列離開 DOM').toBe(true)
  const fade = anims.find((a) => a.props.includes('opacity'))
  expect(fade, '淡出走 Web Animations，有 opacity').toBeTruthy()
  expect(fade!.ms, '淡出 160ms（durations.ts 的 DUR.base）').toBe(160)
  expect(Math.min(...xs), '往左移到 -12px').toBeLessThan(-11.9)
  expect(Math.min(...xs), '不超過 12px').toBeGreaterThan(-12.1)
  expect(Math.max(...heights), '高度從有值開始收').toBeGreaterThan(10)
  expect(heights.at(-1), '高度最後收到 0').toBe(0)
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

/* ── 數字翻動（Flip）：不靠逐幀取樣 ──
   全量跑機器忙時 rAF 幀間隔會拖到 50–100ms，120／160ms 的動畫只取到幾幀，「中間有過渡」常常沒取到
   （2026-10-19：這條在乾淨 HEAD 單跑 8 次也紅 1 次）。改量與幀無關的三件事：
   ① 掛上當下的 inline style（確定的起點）；② Element.animate 的呼叫（淡入走 Web Animations：屬性、時長、緩動）；
   ③ 落定後的 computed 值。位移（translateY）是 motion 每幀寫 style，取不到中間值也不影響這三項。 */
interface FlipRec {
  text: string
  initialStyle: string
  anims: { props: string; ms: number; easing: string }[]
  finalO: number
  finalY: number
}

/** 從現在起記下每個新掛進 DOM、符合 selector 的 .flip。用 readFlips 取回。連續呼叫時舊的觀察器關掉、animate 的包裝不疊加。 */
async function watchFlips(page: Page, selector = '.flip') {
  await page.evaluate((sel) => {
    type Rec = { el: HTMLElement; text: string; initialStyle: string; anims: FlipRec['anims'] }
    const w = window as unknown as {
      __flips: Rec[]
      __flipObserver?: MutationObserver
      __nativeAnimate?: typeof Element.prototype.animate
    }
    w.__flipObserver?.disconnect()
    w.__flips = []
    const native = (w.__nativeAnimate ??= Element.prototype.animate)
    const recOf = (el: HTMLElement) => {
      let r = w.__flips.find((x) => x.el === el)
      if (!r) {
        r = { el, text: '', initialStyle: '', anims: [] }
        w.__flips.push(r)
      }
      return r
    }
    // animate 在 React commit 的 layout effect 裡就被呼叫，比 MutationObserver 的 microtask 早，所以兩邊各自 recOf
    Element.prototype.animate = function (this: Element, kf: Keyframe[] | PropertyIndexedKeyframes | null, opts?: number | KeyframeAnimationOptions) {
      if (this instanceof HTMLElement && this.matches(sel)) {
        recOf(this).anims.push({
          props: JSON.stringify(kf),
          ms: typeof opts === 'number' ? opts : Number(opts?.duration),
          easing: typeof opts === 'number' ? '' : String(opts?.easing ?? ''),
        })
      }
      return native.call(this, kf, opts)
    }
    w.__flipObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const added of Array.from(m.addedNodes)) {
          if (!(added instanceof HTMLElement)) continue
          for (const n of [added, ...Array.from(added.querySelectorAll<HTMLElement>(sel))].filter((x) => x.matches(sel))) {
            const r = recOf(n)
            r.text = n.textContent ?? ''
            r.initialStyle = n.getAttribute('style') ?? ''
          }
        }
      }
    })
    w.__flipObserver.observe(document.body, { childList: true, subtree: true })
  }, selector)
}

const readFlips = (page: Page): Promise<FlipRec[]> =>
  page.evaluate(() =>
    (window as unknown as { __flips: { el: HTMLElement; text: string; initialStyle: string; anims: FlipRec['anims'] }[] }).__flips.map((r) => {
      const cs = getComputedStyle(r.el)
      return { text: r.text, initialStyle: r.initialStyle, anims: r.anims, finalO: Number(cs.opacity), finalY: new DOMMatrix(cs.transform).m42 }
    }),
  )

/** 一個翻動過的 .flip 該有的樣子：起點透明且在下方 35%、淡入走 Web Animations（ms、ease-out）、落定後不透明且歸位。
 *  ms 是寫死的，對應 src/lib/durations.ts：± 數字 NUMBER_FLIP_MS＝120、統計格 DUR.base＝160（e2e 不 import src/）。 */
function expectFlipped(f: FlipRec, ms: number) {
  expect(f.initialStyle, '一掛上就是透明').toContain('opacity: 0')
  expect(f.initialStyle, '一掛上就在下方 35%').toContain('translateY(35%)')
  const fade = f.anims.find((a) => a.props.includes('opacity'))
  expect(fade, '淡入走 Web Animations，有 opacity').toBeTruthy()
  expect(fade!.ms, `淡入 ${ms}ms`).toBe(ms)
  expect(fade!.easing).toBe('ease-out')
  expect(f.finalO, '落定後不透明').toBe(1)
  expect(Math.abs(f.finalY), '落定後歸位').toBeLessThan(0.5)
}

test('組編輯 sheet 的 ± 數字翻動：變動時下移 35% 淡入，開 sheet 時不翻', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await watchFlips(page)
  await openSetSheet(page, 0)
  await page.waitForTimeout(400)
  const opening = await readFlips(page)
  expect(opening.length, '重量與次數各一個數字').toBe(2)
  for (const f of opening) {
    expect(f.anims, '開 sheet 時不翻').toHaveLength(0)
    expect(f.initialStyle, '一出現就是不透明').not.toContain('opacity: 0')
  }

  await watchFlips(page)
  await setSheet(page).getByRole('button', { name: '重量加 2.5 公斤' }).click()
  await expect(page.locator('.ex .set').first().locator('.w')).toHaveText('62.5')
  await page.waitForTimeout(500)
  const flips = await readFlips(page)
  expect(flips, '只有被改的那個數字翻').toHaveLength(1)
  expect(flips[0].text).toBe('62.5')
  expectFlipped(flips[0], 120)
})

/** 等每一組的打勾圈都開始背景色過渡（最多 1.5 秒），回傳各組那條過渡的 delay（ms，照畫面由上到下）、
 *  各組 transform 那項的 computed transition-delay（按下縮放不該被延後），以及最後一個過渡建立當下有幾列掛著 .is-cascade。
 *  用 transitionrun 事件、在事件當下讀：過渡一建立（含還在 delay 階段）就會發，不吃幀時間。早先逐幀量「第一次變色的時間」
 *  在全量跑機器忙、一幀拖過 60ms 時相鄰兩組會在同一幀才被看到，量出間隔 0（2026-10-19 全量紅過一次，單跑都綠）；
 *  後來改成每幀輪詢 getAnimations()，幀間隔超過 160ms 時第一組已經結束又會讀不到。先 await 這個 promise 之前就要觸發動作。 */
const readCheckDelays = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ delays: number[]; transformDelays: string[]; cascadeRows: number }>((resolve) => {
        const checks = Array.from(document.querySelectorAll<HTMLElement>('.ex .set .tr-check'))
        const delays: (number | null)[] = checks.map(() => null)
        const transformDelays: string[] = checks.map(() => '')
        let cascadeRows = 0
        const finish = () => {
          document.removeEventListener('transitionrun', onRun, true)
          clearTimeout(timer)
          resolve({ delays: delays.map((d) => d ?? -1), transformDelays, cascadeRows })
        }
        function onRun(e: Event) {
          const te = e as TransitionEvent
          const i = checks.indexOf(te.target as HTMLElement)
          if (i < 0 || te.propertyName !== 'background-color') return
          const tr = checks[i]
            .getAnimations()
            .find((a): a is CSSTransition => a instanceof CSSTransition && a.transitionProperty === 'background-color')
          delays[i] = Number(tr?.effect?.getTiming().delay ?? 0)
          // transition-property 清單的順序是 background-color／color／transform，transform 是第三項
          transformDelays[i] = getComputedStyle(checks[i]).transitionDelay.split(',')[2]?.trim() ?? ''
          cascadeRows = document.querySelectorAll('.ex .set.is-cascade').length
          if (delays.every((d) => d !== null)) finish()
        }
        document.addEventListener('transitionrun', onRun, true)
        const timer = setTimeout(finish, 1500)
      }),
  )

async function openThreeSets(page: Page) {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await page.locator('.ex').first().getByRole('button', { name: '新增一組' }).click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await page.waitForTimeout(400) // 新列進場跑完，免得取樣掃到它的淡入
}

test('全部完成：按下當下狀態就換，畫面由上往下逐組換色、每組晚約 60ms', async ({ page }) => {
  await openThreeSets(page)
  const all = page.locator('.ex').getByRole('button', { name: '全部完成', exact: true })
  const reading = readCheckDelays(page)
  await all.click()
  await expect(page.locator('.ex').getByRole('button', { name: '取消全部完成', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(stat(page, 'sets')).toHaveText('3/3')
  const { delays, transformDelays, cascadeRows } = await reading

  expect(delays, '三組的打勾圈依序晚 0／60／120ms 開始換色').toEqual([0, 60, 120])
  expect(transformDelays, '按下縮放（transform）不跟著延後，回饋在按下的當下發生').toEqual(['0s', '0s', '0s'])
  expect(cascadeRows, '被換的三列掛著逐組延遲的 class').toBe(3)
  await expect(page.locator('.ex .set.is-cascade'), '一輪跑完後 class 收掉').toHaveCount(0)
})

test('全部完成：減少動態不逐組錯開，三組同時換色', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openThreeSets(page)
  const reading = readCheckDelays(page)
  await page.locator('.ex').getByRole('button', { name: '全部完成', exact: true }).click()
  const { delays, cascadeRows } = await reading
  expect(delays, '三組同時換，沒有錯開').toEqual([0, 0, 0])
  expect(cascadeRows, '不掛逐組延遲的 class').toBe(0)
})

test('全部完成：逐組進行中單點一組，換色不被逐組的延遲拖慢', async ({ page }) => {
  await openThreeSets(page)
  await page.locator('.ex').getByRole('button', { name: '全部完成', exact: true }).click()
  await expect(stat(page, 'sets')).toHaveText('3/3') // 資料已落地，逐組的 class 還掛著（約 540ms 內）
  // 在頁內同一個 tick 裝監聽、直接點：Playwright 的 click() 要等 actionability，可能慢過逐組 class 的存活時間（約 540ms），
  // 那樣量到的 0 是空過（mutation 驗證時拿掉 endCascade 照樣綠）。所以同時回報點下去當下 class 還在不在，當作測試自己的前提
  const { hadClass, delay } = await page
    .locator('.ex .set')
    .nth(2)
    .locator('.tr-check')
    .evaluate(
      (el) =>
        new Promise<{ hadClass: boolean; delay: number }>((resolve) => {
          const row = el.closest('.set') as HTMLElement
          const hadClass = row.classList.contains('is-cascade')
          const timer = setTimeout(() => resolve({ hadClass, delay: -2 }), 1500)
          el.addEventListener('transitionrun', function on(e) {
            if ((e as TransitionEvent).propertyName !== 'background-color') return
            el.removeEventListener('transitionrun', on)
            clearTimeout(timer)
            const tr = el.getAnimations().find((a): a is CSSTransition => a instanceof CSSTransition && a.transitionProperty === 'background-color')
            resolve({ hadClass, delay: Number(tr?.effect?.getTiming().delay ?? -1) })
          })
          el.click()
        }),
    )
  expect(hadClass, '前提：點下去的當下，這一列還掛著逐組的 class（不然這條測試什麼都沒驗）').toBe(true)
  expect(delay, '單點第 3 組取消完成：換色立刻開始（第 3 組在逐組裡是 120ms，不該套到這次單點）').toBe(0)
})

test('全部完成：逐組進行中再按一次，從當前畫面狀態接續，最後全部回到未完成', async ({ page }) => {
  await openThreeSets(page)
  const undone = await page.locator('.ex .set .tr-check').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
  await page.locator('.ex').getByRole('button', { name: '全部完成', exact: true }).click()
  await page.waitForTimeout(80) // 第一輪才跑到一半
  await page.locator('.ex').getByRole('button', { name: '取消全部完成', exact: true }).click()
  await expect(stat(page, 'sets')).toHaveText('0/3')
  await page.waitForTimeout(900)
  const settled = await page.locator('.ex .set .tr-check').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
  expect(settled, '每一組都回到未完成的顏色，沒有卡在中途').toEqual(undone)
  await expect(page.locator('.ex .set.is-cascade')).toHaveCount(0)
})

test('統計格數字：減少動態只淡入、不位移，時長不超過 120ms', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await page.waitForTimeout(400)
  await watchFlips(page, '.tr-stats .flip')
  await tick(page, 0)
  await expect(stat(page, 'sets')).toHaveText('1/2')
  await page.waitForTimeout(500)
  const flips = await readFlips(page)
  expect(flips, '訓練量與完成組數各淡入一次').toHaveLength(2)
  for (const f of flips) {
    expect(f.initialStyle, '一掛上就是透明').toContain('opacity: 0')
    expect(f.initialStyle, '減少動態沒有位移').not.toContain('translateY(35%)')
    const fade = f.anims.find((a) => a.props.includes('opacity'))
    expect(fade, '淡入走 Web Animations').toBeTruthy()
    expect(fade!.ms, 'spec AC 10：減少動態的淡入不超過 120ms（durations.ts 的 REDUCED_FADE_MAX_MS）').toBe(120)
    expect(f.finalO).toBe(1)
  }
})

test('統計格數字：訓練量與完成組數變動時翻一下（160ms），時長跳秒不翻', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await page.waitForTimeout(400)

  await watchFlips(page, '.tr-stats .flip')
  await tick(page, 0)
  await expect(stat(page, 'sets')).toHaveText('1/2')
  await page.waitForTimeout(500)
  const flips = await readFlips(page)
  expect(flips, '訓練量與完成組數各翻一次，時長（跳秒）不翻').toHaveLength(2)
  const texts = flips.map((f) => f.text)
  expect(texts, '完成組數翻成 1/2').toContain('1/2')
  expect(texts.find((t) => t !== '1/2'), '訓練量翻成一個大於 0 的數字').toMatch(/^[1-9][\d,]*$/)
  for (const f of flips) expectFlipped(f, 160)

  // 計時器跳秒不翻：量一段時間，時長那格沒有任何新的 .flip
  await watchFlips(page, '[data-stat="time"] .flip')
  await page.waitForTimeout(2200)
  expect(await readFlips(page)).toHaveLength(0)
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

/* ═══════════ 著作權標示：列表類畫面（Gym visual 要求每次使用都附） ═══════════ */

const CREDIT = '© Gym visual — https://gymvisual.com/'
const credit = (scope: Locator) => scope.locator('[data-credit="gym-visual"]')

test('著作權標示：動作庫、加動作 sheet、訓練中畫面的列表底部都印一行', async ({ page }) => {
  await openCatalogLibrary(page)
  await expect(credit(library(page))).toHaveText(CREDIT)

  await library(page).getByRole('button', { name: '返回' }).click()
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  const picker = page.locator('[data-screen="exercise-picker"]')
  await expect(credit(picker), '加動作 sheet').toHaveText(CREDIT)
  await picker.locator('.tr-row', { has: page.locator('.nm', { hasText: /^腿推舉$/ }) }).click()
  await expect(picker).toHaveCount(0)
  await expect(credit(page.locator('[data-screen="training-session"]')), '訓練中畫面').toHaveText(CREDIT)
})

test('著作權標示：課表編輯有預設動作的圖時印一行', async ({ page }) => {
  await openCatalogLibrary(page)
  await library(page).getByRole('button', { name: '返回' }).click()
  await newRoutine(page, '菜單 A')
  await expect(credit(editor(page)), '還沒有動作，列表上沒有圖').toHaveCount(0)
  await page.locator('[data-action="add-routine-exercise"]').click()
  await page.locator('[data-screen="exercise-picker"] .tr-row', { has: page.locator('.nm', { hasText: /^腿推舉$/ }) }).click()
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
  await expect(credit(editor(page))).toHaveText(CREDIT)
})

test('著作權標示：畫面上沒有任何預設動作的圖（全是自建動作）就不印', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX) // fixture 的動作 id 都不是預設動作的 id，所以都沒有圖
  await openTraining(page)
  await openLibrary(page)
  await expect(library(page).locator('.ex-thumb').first()).toBeVisible()
  await expect(library(page).locator('img.ex-thumb'), 'fixture 確實沒有圖').toHaveCount(0)
  await expect(credit(library(page))).toHaveCount(0)

  await library(page).getByRole('button', { name: '返回' }).click()
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  await expect(page.locator('[data-screen="exercise-picker"] .tr-row').first()).toBeVisible()
  await expect(credit(page.locator('[data-screen="exercise-picker"]'))).toHaveCount(0)

  // 選一個自建動作進訓練中畫面：卡片上沒有圖，畫面底部也不印
  await page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: '腿推舉' }).click()
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
  await expect(page.locator('.ex .set').first()).toBeVisible()
  await expect(page.locator('[data-screen="training-session"] img.ex-thumb')).toHaveCount(0)
  await expect(credit(page.locator('[data-screen="training-session"]'))).toHaveCount(0)
})

/* ── 組編輯 sheet 的 RPE 區（spec.md「階段 4 乙」）──────────────────────────────────────── */
const rpeWrites = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __writes: { table: string; method: string; body: Record<string, unknown> }[] }).__writes
      .filter((w) => w.table === 'workout_sets' && w.method === 'PATCH' && w.body && 'rpe' in w.body)
      .map((w) => w.body.rpe),
  )

test('組編輯 sheet 的 RPE：只有已完成的組才有；點 8 寫 8 並高亮，換 9 高亮跟著換，清除寫 null；沒填時清除不能按', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await tick(page, 0)

  // 沒打勾的第 2 組：談不上吃力程度
  await openSetSheet(page, 1)
  await expect(setSheet(page).locator('[data-section="rpe"]')).toHaveCount(0)
  await closeSetSheet(page)

  await openSetSheet(page, 0)
  const rpe = setSheet(page).locator('[data-section="rpe"]')
  await expect(rpe.getByRole('button')).toHaveText(['6', '7', '8', '9', '10', '清除'])
  await expect(rpe.getByRole('button', { name: '清除' })).toBeDisabled()
  await expect(rpe.locator('[aria-pressed="true"]')).toHaveCount(0)

  await rpe.getByRole('button', { name: 'RPE 8' }).click()
  await expect(rpe.getByRole('button', { name: 'RPE 8' })).toHaveAttribute('aria-pressed', 'true')
  await rpe.getByRole('button', { name: 'RPE 9' }).click()
  await expect(rpe.getByRole('button', { name: 'RPE 9' })).toHaveAttribute('aria-pressed', 'true')
  await expect(rpe.getByRole('button', { name: 'RPE 8' })).toHaveAttribute('aria-pressed', 'false')
  await rpe.getByRole('button', { name: 'RPE 9' }).click() // 再點同一格不取消、不重送
  await expect.poll(() => rpeWrites(page)).toEqual([8, 9])

  await rpe.getByRole('button', { name: '清除' }).click()
  await expect(rpe.locator('[aria-pressed="true"]')).toHaveCount(0)
  await expect(rpe.getByRole('button', { name: '清除' })).toBeDisabled()
  await expect.poll(() => rpeWrites(page)).toEqual([8, 9, null])
})

test('新增的組不帶 rpe：預填（上次的組有 rpe）、按「新增一組」、勾組的寫入 payload 都沒有 rpe 這個鍵', async ({ page }) => {
  // 上次的兩組都有 RPE 9：新組若是複製舊列就會帶出來
  await openApp(page, {}, { ...WITH_WORKOUT, workout_sets: WITH_WORKOUT.workout_sets.map((s) => ({ ...s, rpe: 9 })) })
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await page.getByRole('button', { name: '新增一組' }).click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await tick(page, 0)
  await expect(stat(page, 'sets')).toHaveText('1/3')
  const setBodies = () =>
    page.evaluate(() =>
      (window as unknown as { __writes: { table: string; body: unknown }[] }).__writes.filter((w) => w.table === 'workout_sets').map((w) => JSON.stringify(w.body)),
    )
  await expect.poll(async () => (await setBodies()).some((b) => b.includes('"done":true'))).toBe(true) // 勾組的寫入已送出
  const bodies = await setBodies()
  expect(bodies.length).toBeGreaterThanOrEqual(4) // 預填的兩組＋新增一組＋勾組
  for (const b of bodies) expect(b).not.toContain('rpe')
})

test('離線時答的 RPE 進佇列，回線後送出（payload 只有 rpe）', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await setOffline(page, true)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await tick(page, 1) // 最後一組：休息條問 RPE
  await page.locator('.tr-rest [data-rpe-ask] [data-rpe="9"]').click()
  await setOffline(page, false)
  await expect
    .poll(async () => (await trainRows(page, 'workout_sets')).filter((r) => r.rpe === 9).length, { timeout: 15_000 })
    .toBe(1)
})
