/* 訓練分頁（階段 2 第一輪第 2a 段）：分頁進得去、資料從本機底讀得到、連不上伺服器時講清楚、
   第一次開時預填 16 個動作。開始訓練／記組／離線記錄在後面的段落補。
   fetch 全 stub；注意 stub 的寫入不落地（寫進去的列下一次 GET 不會出現）。 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { gotoDate, leg, openApp, shiftIso, slowDrag } from './harness'
import { FIX, TODAY } from './fixtures'
import { SEEDED_FIX } from './seeded'

/* 本檔 87 條時約 690 秒（2026-10-22 有氧併入動作後 103 條、review 修正後 105 條），佔整套 e2e 的七成。平行單位預設是「檔案」，它在檔名順序裡排得很後面，
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

test('第一次開、伺服器上沒有任何動作：預填整份目錄 152 個（含兩個有氧），且是 insert-ignore（不蓋掉改過的）', async ({ page }) => {
  await openApp(page, {}, { ...FIX, exercises: [] })
  type W = { table: string; method: string; path: string; body: Record<string, unknown> | Record<string, unknown>[] }
  const posted = async () => {
    const writes = await page.evaluate(() => (window as unknown as { __writes: W[] }).__writes)
    return writes.filter((w) => w.table === 'exercises' && w.method === 'POST')
  }
  // 16 個原始預設＋134 個常見重訓＋2 個有氧（spec「有氧併入動作」AC 1）
  await expect.poll(async () => (await posted()).length, { timeout: 40_000 }).toBeGreaterThanOrEqual(152)

  const all = await posted()
  const bodies = all.map((w) => (Array.isArray(w.body) ? w.body[0] : w.body))
  const ids = new Set(bodies.map((b) => String(b.id)))
  expect(ids.size, '152 個預設動作的 id 應互不相同').toBe(152)
  expect(all.every((w) => w.path.includes('on_conflict=id')), '預填要以 id 為衝突鍵').toBe(true)
  const names = bodies.map((b) => String(b.name))
  expect(names).toContain('腿推舉')
  expect(names).toContain('腹部捲曲機')
  expect(names).toContain('槓鈴臥推') // 新增的 134 個之一
  // 新帳號預填時一併帶 kind：有氧的兩個是各自的類型，其餘一律 strength
  const kindOf = (name: string) => bodies.find((b) => b.name === name)?.kind
  expect(kindOf('跑步機坡度健走')).toBe('incline_walk')
  expect(kindOf('有氧拳擊')).toBe('boxing')
  expect(kindOf('腿推舉')).toBe('strength')
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

/* SpringSheet 裡巢狀 ConfirmDialog 的回歸。宿主原本是有氧 sheet 的「刪除這筆」，v2.89 有氧 sheet 拿掉刪除（改走卡片 ⋯），
   換成組編輯 sheet 的「刪除這一組？」（已打勾的組才問）——同樣是 SpringSheet 子樹裡的 ConfirmDialog。 */
test('sheet 裡的確認框：在對話框上往下拖不會拖走 sheet；點過背景再按 Escape 也只關對話框', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await openSetSheet(page, 0)
  await setSheet(page).getByRole('button', { name: '刪除這一組' }).click()
  const dialog = page.getByRole('alertdialog', { name: '刪除這一組？' })
  await expect(dialog).toBeVisible()

  const box = (await dialog.boundingBox())!
  const sheetTop = (await setSheet(page).boundingBox())!.y
  await page.mouse.move(box.x + box.width / 2, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 320, { steps: 12 })
  // 手指還按著時讀一次位置：沒放手前 sheet 若被拖著走，這裡就看得到（放手後彈回原位的話，只看最後的結果會漏掉）
  expect((await setSheet(page).boundingBox())!.y, '在對話框上往下拖，sheet 不該跟著動').toBeCloseTo(sheetTop, 0)
  await page.mouse.up()
  await page.waitForTimeout(500)
  await expect(setSheet(page), '往下拖不該把 sheet 拖走').toBeVisible()
  await expect(dialog).toBeVisible()

  // 點對話框外的背景（焦點會落到 sheet 上），再按 Escape
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 60)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // sheet 被一起關的話，關閉 spring（約 1 秒）期間它仍「可見」——toBeVisible 分不出來，改看它有沒有開始往下收
  await page.waitForTimeout(500)
  await expect(setSheet(page)).toBeVisible()
  expect((await setSheet(page).boundingBox())!.y, 'Escape 只關對話框，sheet 留在原位').toBeCloseTo(sheetTop, 0)
  await expect(page.locator('.ex .set'), '取消不該刪').toHaveCount(2)
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

/** 動作庫管理在設定頁（v2.96 從訓練頁搬來，跟食品庫管理放一起）。 */
const libraryEntry = (page: Page) => page.locator('[data-action="open-exercise-library"]')
async function openSettingsTab(page: Page) {
  await page.locator('.tab[aria-label="設定"]').click()
  await expect(page.locator('[data-screen="settings"]')).toBeVisible()
}
async function openLibrary(page: Page) {
  await openSettingsTab(page)
  await libraryEntry(page).click()
  await expect(library(page)).toBeVisible()
}

test('動作庫管理：設定頁入口顯示未封存的動作數、整頁接管（底部列收起）、返回回到設定頁；訓練頁不再有動作庫入口', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await expect(page.locator('[data-action="open-library"]'), '訓練頁沒有動作庫入口了').toHaveCount(0)
  await expect(page.locator('[data-action="open-analysis"]'), '訓練分析入口還在').toBeVisible()

  await openSettingsTab(page)
  await expect(libraryEntry(page)).toContainText('動作庫管理')
  await expect(libraryEntry(page)).toContainText('2 個動作')
  // 跟食品庫管理在同一張入口列表裡，緊接在它後面
  const labels = await page.locator('.entry-row .lb').allTextContents()
  expect(labels.indexOf('動作庫管理')).toBe(labels.indexOf('食品庫管理') + 1)

  await libraryEntry(page).click()
  await expect(library(page)).toBeVisible()
  await expect(page.locator('.bottom-bar')).toHaveCount(0)
  await expect(library(page).locator('.tr-row')).toHaveCount(3)
  await expect(library(page).locator('.tr-row', { hasText: '腿推舉' })).toContainText('有要點')

  await library(page).getByRole('button', { name: '返回' }).click()
  await expect(page.locator('[data-screen="settings"]')).toBeVisible()
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

/* v2.93：封存／取消封存從編輯 sheet 搬到動作庫每一列尾端的圖示鈕（真機回饋：sheet 裡那顆位置怪）。 */
const archiveBtn = (page: Page, name: string) => library(page).getByRole('button', { name: `封存 ${name}`, exact: true })
const unarchiveBtn = (page: Page, name: string) => library(page).getByRole('button', { name: `取消封存 ${name}`, exact: true })
type ExWrite = { table: string; method: string; body: unknown }
const exercisePatches = async (page: Page) =>
  (await page.evaluate(() => (window as unknown as { __writes: ExWrite[] }).__writes))
    .filter((w) => w.table === 'exercises' && w.method === 'PATCH')
    .map((w) => w.body)

test('封存：從「加動作」的選單消失；選單也有肌群橫條', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)

  await archiveBtn(page, '腿推舉').click()
  await expect(library(page).locator('[data-section="archived"] .tr-row', { hasText: '腿推舉' })).toHaveCount(1)
  await expect.poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === LEG_ID)?.archived).toBe(true)
  expect(await exercisePatches(page), '封存只送 archived 一欄').toEqual([{ archived: true }])

  await library(page).getByRole('button', { name: '返回' }).click()
  await openTraining(page)
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  const picker = page.locator('[data-screen="exercise-picker"]')
  await expect(picker.locator('.tr-row', { hasText: '坐姿划船' })).toBeVisible()
  await expect(picker.locator('.tr-row', { hasText: '腿推舉' })).toHaveCount(0)
  await expect(picker.locator('.tr-row', { hasText: '舊的肩推' })).toHaveCount(0)

  await picker.getByRole('button', { name: '背部', exact: true }).click()
  await expect(picker.locator('[data-exercise-id]'), '只數動作列，不含清單末尾的「新增動作」').toHaveCount(1)
})

test('取消封存：回到清單與選單', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)

  await unarchiveBtn(page, '舊的肩推').click()
  await expect(library(page).locator('[data-section="archived"]')).toHaveCount(0)
  await expect(library(page).locator('.tr-row', { hasText: '舊的肩推' })).toHaveCount(1)
  await expect(archiveBtn(page, '舊的肩推'), '回到使用中後，那一列的鈕換成封存').toHaveCount(1)
  await expect.poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === OLD_ID)?.archived).toBe(false)
  expect(await exercisePatches(page), '取消封存只送 archived 一欄').toEqual([{ archived: false }])

  // 回到「加動作」的選單
  await library(page).getByRole('button', { name: '返回' }).click()
  await openTraining(page)
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  await expect(page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: '舊的肩推' })).toBeVisible()
})

test('動作庫列的封存鈕：每列一顆、名稱寫在 aria-label、觸控目標 ≥44px；點它不開編輯 sheet、點列主體仍開', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)

  // 使用中兩列各一顆「封存」、已封存那列一顆「取消封存」；圖示不寫字
  await expect(library(page).getByRole('button', { name: /^封存 / })).toHaveCount(2)
  await expect(library(page).getByRole('button', { name: /^取消封存 / })).toHaveCount(1)
  await expect(library(page).locator('[data-section="archived"]').getByRole('button', { name: '取消封存 舊的肩推', exact: true })).toHaveCount(1)
  const btn = archiveBtn(page, '腿推舉')
  await expect(btn).toHaveText('')
  const box = (await btn.boundingBox())!
  expect(box.width, '觸控目標寬').toBeGreaterThanOrEqual(44)
  expect(box.height, '觸控目標高').toBeGreaterThanOrEqual(44)

  /* 主按鈕的 ::before 撐滿整列（讓縮圖以外都算開編輯），封存鈕要疊在它上面——
     用滑鼠點按鈕中心（不是 locator.click 的 actionability 直達），點到的才是畫面上真正在最上層的那個 */
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(library(page).locator('[data-section="archived"] .tr-row', { hasText: '腿推舉' })).toHaveCount(1)
  await page.waitForTimeout(400) // 沒有事件可等的反向斷言：sheet 若會開，這段時間內已經出現
  await expect(editSheet(page), '點封存鈕不該開編輯 sheet').toHaveCount(0)

  // 列主體照舊開編輯 sheet（AC 3 同一張）
  await library(page).locator('.tr-row', { hasText: '坐姿划船' }).locator('.tr-row-main').click()
  await expect(editSheet(page)).toBeVisible()
  await expect(editSheet(page).getByRole('textbox', { name: '名稱' })).toHaveValue('坐姿划船')
})

test('編輯動作 sheet 不再有封存鈕（使用中、已封存、新增三種開法）；已封存的動作點進來仍能改名', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)
  const noArchiveInSheet = async () => {
    await expect(editSheet(page)).toBeVisible()
    await expect(editSheet(page).getByRole('button', { name: '封存這個動作' })).toHaveCount(0)
    await expect(editSheet(page).getByRole('button', { name: '取消封存這個動作' })).toHaveCount(0)
    await expect(editSheet(page).getByRole('button', { name: /封存/ }), 'sheet 裡不該有任何封存相關的鈕').toHaveCount(0)
  }

  await library(page).locator('.tr-row', { hasText: '腿推舉' }).click()
  await noArchiveInSheet()
  await page.keyboard.press('Escape')
  await expect(editSheet(page)).toHaveCount(0)

  await library(page).getByRole('button', { name: '新增動作' }).click()
  await noArchiveInSheet()
  await page.keyboard.press('Escape')
  await expect(editSheet(page)).toHaveCount(0)

  await library(page).locator('[data-section="archived"] .tr-row', { hasText: '舊的肩推' }).click()
  await noArchiveInSheet()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('舊的肩推（停用）')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page)).toHaveCount(0)
  await expect(library(page).locator('[data-section="archived"] .tr-row', { hasText: '舊的肩推（停用）' }), '改名不影響封存').toHaveCount(1)
  await expect
    .poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === OLD_ID))
    .toMatchObject({ name: '舊的肩推（停用）', archived: true })
})

test('離線封存與取消封存：列表立刻換區，回線後上傳', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await setOffline(page, true)
  await openLibrary(page)

  await archiveBtn(page, '坐姿划船').click()
  await unarchiveBtn(page, '舊的肩推').click()
  await expect(library(page).locator('[data-section="archived"] .tr-row')).toHaveText([/坐姿划船/])
  await expect(library(page).locator('.tr-card:not([data-section]) .tr-row')).toHaveText([/腿推舉/, /舊的肩推/])
  const server = async () => (await trainRows(page, 'exercises')).map((r) => [r.id, r.archived])
  expect(await server(), '離線時伺服器還是舊的').toEqual([[LEG_ID, false], [ROW_ID, false], [OLD_ID, true]])

  await setOffline(page, false)
  await expect.poll(server, { timeout: 15_000 }).toEqual([[LEG_ID, false], [ROW_ID, true], [OLD_ID, false]])
})

test('封存寫入失敗（本機儲存寫不進去）：頁上說明「這筆沒有存下來」，列留在原區，什麼都沒送', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)

  // 同有氧 sheet 那條：寫入只在「排進本機佇列」那一步會失敗，讓 IndexedDB 的 put 丟錯
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('模擬的容量已滿', 'QuotaExceededError')
    }
  })
  await archiveBtn(page, '腿推舉').click()
  const alert = library(page).getByRole('alert')
  await expect(alert).toContainText('這筆沒有存下來')
  await expect(alert, '說明要在畫面內，不是捲到看不到的地方').toBeInViewport()
  await expect(library(page).locator('[data-section="archived"] .tr-row'), '沒寫成就不該換區').toHaveText([/舊的肩推/])
  await expect(archiveBtn(page, '腿推舉')).toHaveCount(1)
  expect(await exercisePatches(page), '沒有排進佇列，什麼都沒送').toEqual([])
})

test('動作庫列：長名稱在 393 寬不溢出，名稱截斷、封存鈕完整留在列內', async ({ page }) => {
  const LONG = '史密斯機器上斜槓鈴臥推（窄握、暫停兩秒、離心三秒）'
  await openApp(page, {}, {
    ...LIBRARY_FIX,
    exercises: [{ ...LIBRARY_FIX.exercises[0], name: LONG }, ...LIBRARY_FIX.exercises.slice(1)],
  })
  await openTraining(page)
  await openLibrary(page)

  const row = library(page).locator('.tr-row', { hasText: LONG })
  const m = await row.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const btn = el.querySelector('.tr-ib')!.getBoundingClientRect()
    const nm = el.querySelector('.nm') as HTMLElement
    const card = el.closest('.tr-card')!.getBoundingClientRect()
    return {
      overflow: el.scrollWidth - el.clientWidth,
      truncated: nm.scrollWidth > nm.clientWidth,
      btnLeft: btn.left, btnRight: btn.right, btnW: btn.width,
      nmRight: nm.getBoundingClientRect().right,
      rowRight: r.right, cardRight: card.right,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(m.overflow, '列被撐出水平捲動').toBeLessThanOrEqual(0)
  expect(m.docOverflow, '整頁出現水平捲動').toBeLessThanOrEqual(0)
  expect(m.truncated, '長名稱應該被截斷（…），不是撐開列').toBe(true)
  expect(m.btnW, '封存鈕被擠窄').toBeGreaterThanOrEqual(44)
  expect(m.btnRight, '封存鈕超出卡片右緣').toBeLessThanOrEqual(m.cardRight + 0.5)
  expect(m.nmRight, '名稱壓到封存鈕上').toBeLessThanOrEqual(m.btnLeft + 0.5)
})

test('封存的動作：歷史訓練照樣顯示名稱', async ({ page }) => {
  // 腿推舉（LEG_ID＝EX_ID）今天有一次已完成的訓練
  await openApp(page, {}, { ...WITH_WORKOUT, exercises: LIBRARY_FIX.exercises })
  await openTraining(page)
  await openLibrary(page)
  await archiveBtn(page, '腿推舉').click()
  await expect(library(page).locator('[data-section="archived"] .tr-row', { hasText: '腿推舉' })).toHaveCount(1)
  await library(page).getByRole('button', { name: '返回' }).click()
  await openTraining(page)

  await page.locator('.tr-row[data-workout-id="w-1"]').click()
  await expect(page.locator('.ex .nm')).toHaveText(['腿推舉'])
})

/* v2.91：編輯動作 sheet 改成全站表單 sheet 的版型——可捲的 `.form-wrap` ＋兄弟節點 `.confirm-wrap` 釘底。
   真機回報：點要點叫出鍵盤後，儲存（原本是捲動內容的最後一個子節點）被鍵盤蓋住。
   **鍵盤桌面產不出來**，這幾條守的是版型與「`--kb` 接上之後」的結果，iOS 真實鍵盤行為只有真機能驗。
   `--kb` 設在 sheet 元素身上、不設在 documentElement：App.tsx 的 `sync()` 每次 visualViewport 事件
   都會把 root 的 `--kb` 蓋回 0px，而第三條正好要派發那個事件（理由同 food-library.spec 的 `--kb` 那條）。 */

/** 等 sheet 的開啟 spring 落定（translateY 連續兩次讀到同一個值）；JS 動畫，`getAnimations()` 看不到。 */
async function sheetSettled(sheet: Locator) {
  const ty = () => sheet.evaluate((n) => new DOMMatrix(getComputedStyle(n).transform).m42)
  await expect
    .poll(async () => {
      const a = await ty()
      await sheet.page().waitForTimeout(80)
      return Math.abs((await ty()) - a) < 0.1 ? a : NaN
    })
    .not.toBeNaN()
}

async function openLegEdit(page: Page) {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await openLibrary(page)
  await library(page).locator('.tr-row', { hasText: '腿推舉' }).click()
  await expect(editSheet(page)).toBeVisible()
  await sheetSettled(editSheet(page))
}

test('編輯動作 sheet 的版型：欄位區可捲、儲存釘在底部；要點寫很長也不必捲就點得到儲存', async ({ page }) => {
  await openLegEdit(page)
  const sheet = editSheet(page)
  const fields = sheet.locator('.form-wrap')
  const footer = sheet.locator('.confirm-wrap')
  const save = sheet.getByRole('button', { name: '儲存' })

  // 結構：欄位區與釘底列是同一個 form 底下的兄弟；儲存在釘底列（封存 v2.93 起不在這張 sheet，見動作庫那幾條）
  expect(
    await fields.evaluate((el) => {
      const f = el.parentElement!.querySelector(':scope > .confirm-wrap')
      return el.parentElement!.tagName === 'FORM' && !!f && !el.contains(f)
    }),
    '釘底列要是欄位區的兄弟節點，不能在捲動容器裡',
  ).toBe(true)
  await expect(footer.getByRole('button', { name: '儲存' })).toHaveCount(1)
  await expect(fields.getByRole('button', { name: '儲存' }), '儲存不該在捲動內容裡').toHaveCount(0)
  await expect(sheet.getByRole('button', { name: '封存這個動作' }), '封存搬到動作庫列表了（v2.93）').toHaveCount(0)

  const tips = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行：背貼緊椅背，膝蓋對腳尖`).join('\n')
  await sheet.getByRole('textbox', { name: '要點' }).fill(tips)
  const s = (await sheet.boundingBox())!
  const b = (await save.boundingBox())!
  expect(b.y, '儲存跑到 sheet 上緣之外').toBeGreaterThanOrEqual(s.y)
  expect(b.y + b.height, '儲存被擠出 sheet 了').toBeLessThanOrEqual(s.y + s.height + 1)
  expect(b.y + b.height, '儲存超出視窗').toBeLessThanOrEqual(page.viewportSize()!.height)
})

test('編輯動作 sheet 吃 --kb（模擬鍵盤 336px）：底緣上移、欄位區變矮可捲、儲存與錯誤訊息浮在鍵盤上方', async ({ page }) => {
  await openLegEdit(page)
  const sheet = editSheet(page)
  const fields = sheet.locator('.form-wrap')
  const save = sheet.getByRole('button', { name: '儲存' })
  const fieldsBefore = (await fields.boundingBox())!.height

  const KB = 336
  await sheet.evaluate((el, kb) => el.style.setProperty('--kb', `${kb}px`), KB)
  const vh = page.viewportSize()!.height
  const s = (await sheet.boundingBox())!
  expect(s.y + s.height, 'sheet 底緣沒有吃到 --kb，會落在鍵盤底下').toBeLessThanOrEqual(vh - KB + 1)

  const area = await fields.evaluate((el) => ({ h: el.getBoundingClientRect().height, sh: el.scrollHeight, ch: el.clientHeight }))
  expect(area.h, '鍵盤升起時欄位區沒有變矮').toBeLessThan(fieldsBefore)
  expect(area.sh, '欄位區變矮之後要捲得動，底下的欄位才到得了').toBeGreaterThan(area.ch)

  const b = (await save.boundingBox())!
  expect(b.y, '儲存跑到 sheet 上緣之外').toBeGreaterThanOrEqual(s.y)
  expect(b.y + b.height, '儲存被擠出 sheet（落到鍵盤底下）').toBeLessThanOrEqual(s.y + s.height + 1)
  // 捲欄位區不會帶著儲存跑：它不在捲動容器裡
  await fields.evaluate((el) => { el.scrollTop = el.scrollHeight })
  expect(Math.round((await save.boundingBox())!.y), '捲欄位區時儲存跟著動了——它還在捲動內容裡').toBe(Math.round(b.y))

  // 錯誤訊息在釘底列：鍵盤升起時也看得到（欄位區捲到哪都一樣）
  await sheet.getByRole('textbox', { name: '名稱' }).fill('')
  await save.click()
  const alert = sheet.getByRole('alert')
  await expect(alert).toContainText('名稱不能是空的')
  await fields.evaluate((el) => { el.scrollTop = 0 })
  const a = (await alert.boundingBox())!
  const s2 = (await sheet.boundingBox())!
  expect(a.y, '錯誤訊息被捲出可視範圍').toBeGreaterThanOrEqual(s2.y)
  expect(a.y + a.height, '錯誤訊息落到鍵盤底下').toBeLessThanOrEqual(s2.y + s2.height + 1)
  const b2 = (await save.boundingBox())!
  expect(b2.y + b2.height, '多了錯誤訊息之後儲存被擠出 sheet').toBeLessThanOrEqual(s2.y + s2.height + 1)
})

test('編輯動作 sheet：鍵盤在焦點之後才升起，聚焦中的要點欄會被捲回欄位區可視範圍', async ({ page }) => {
  await openLegEdit(page)
  const sheet = editSheet(page)
  const fields = sheet.locator('.form-wrap')
  const tips = sheet.getByRole('textbox', { name: '要點' })

  /* `preventScroll: true`：桌面 WebKit 的 focus() 自己會捲，不關掉就量到瀏覽器內建行為（food-library.spec 同一條理由）。
     順序模擬真機：先點要點（此時還沒鍵盤、它在框內），鍵盤升起後 sheet 縮短，它被擠到欄位區下緣之外。 */
  await tips.evaluate((el: HTMLElement) => el.focus({ preventScroll: true }))
  await sheet.evaluate((el) => el.style.setProperty('--kb', '336px'))
  await fields.evaluate((el) => { el.scrollTop = 0 })
  const visibleBottom = async () => (await fields.boundingBox())!.y + (await fields.evaluate((el) => el.clientHeight))
  const before = (await tips.boundingBox())!
  expect(before.y + before.height, '前提不成立：要點欄本來就在欄位區可視範圍內，這條測不到東西').toBeGreaterThan(await visibleBottom() + 1)

  // 鍵盤升起時 iOS 發的是 visualViewport 的 resize；桌面沒有鍵盤，直接派發這個事件驅動 hook
  await page.evaluate(() => window.visualViewport?.dispatchEvent(new Event('resize')))
  const after = (await tips.boundingBox())!
  expect(after.y + after.height, '鍵盤升起後沒有把聚焦中的要點欄捲回可視範圍').toBeLessThanOrEqual(await visibleBottom() + 1)
  expect(after.y, '捲過頭，要點欄上緣跑出欄位區').toBeGreaterThanOrEqual((await fields.boundingBox())!.y - 1)
  await expect(tips).toBeFocused()
})

/* ═══════════ 動作示意圖與自動補預設動作 ═══════════ */

/** 圖已載入且是 180 寬（Gym visual 的縮圖與動畫都是 180×180；lazy 圖要在視窗內才會載，所以用 poll）。 */
const imgLoaded = async (img: Locator) => {
  await img.scrollIntoViewIfNeeded() // loading="lazy" 的圖不在視窗內不會載
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth), { timeout: 10_000 }).toBe(180)
}

/** 動作庫裡有整份目錄 152 個動作的前置條件。直接給 fixture（`seeded.ts`），不走真的預填——
 *  152 筆 insert 逐筆上傳每條要約 15 秒。預填本身由「第一次開、伺服器上沒有任何動作」那條守。 */
async function openCatalogLibrary(page: Page) {
  await openApp(page, {}, SEEDED_FIX)
  await openSettingsTab(page)
  await expect(libraryEntry(page)).toContainText('152 個動作')
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
  await openTraining(page)
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
  // 149 個有圖的動作（v2.90 多了坡度健走）＝148 個不同的檔案（腿屈伸與單腿腿屈伸共用同一張圖，內容相同所以檔名雜湊也相同）進 precache，
  // 離線健身房看得到。動畫（gif，共約 14MB）不進：項數與體積太大時新版 SW 會偶發卡在 activating，見 vite.config.ts；
  // 這兩個斷言一起鎖住「縮圖都在、動畫都不在」
  expect(precached.size, 'service worker 的 precache 清單：縮圖').toBe(148)
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
  await openTraining(page)
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
  await openTraining(page)
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
  await openTraining(page)
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

  // 不用按任何鈕：16＋自建 1＋補 135（目錄其餘 136 個＝134 重訓＋2 有氧，裡面「槓鈴臥推」撞名不補）
  await expect.poll(async () => (await trainRows(page, 'exercises')).length, { timeout: 40_000 }).toBe(152)
  const all = await trainRows(page, 'exercises')
  expect(all.find((r) => r.id === rows[0].id), '改過名、封存、有要點的預設動作原封不動').toMatchObject({ name: '我的腿推', archived: true, tips: '背貼緊' })
  expect(all.filter((r) => r.name === '槓鈴臥推'), '整份動作庫只有一個「槓鈴臥推」').toHaveLength(1)
  expect(new Set(all.map((r) => String(r.name))).size, '沒有任何同名動作').toBe(152)
  // 既有帳號自動補的也帶 kind（AC 1）
  expect(all.find((r) => r.name === '跑步機坡度健走')?.kind).toBe('incline_walk')
  expect(all.find((r) => r.name === '有氧拳擊')?.kind).toBe('boxing')
  const posts = (await page.evaluate(() => (window as unknown as { __writes: { table: string; method: string }[] }).__writes)).filter(
    (w) => w.table === 'exercises' && w.method === 'POST',
  )
  expect(posts, '只送缺的 135 個，已有的 17 個不送').toHaveLength(135)

  // 畫面上：沒有任何要按的入口，補進來的有圖，自建的同名那列照常能改要點
  await openSettingsTab(page)
  await expect(libraryEntry(page)).toContainText('151 個動作') // 152 減 1 個封存的
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

test('沒有任何預設動作的帳號（自己從零建的庫）：開 App 不會被灌進 152 個', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openSettingsTab(page)
  await expect(libraryEntry(page)).toContainText('2 個動作')
  // 沒有事件可等的反向斷言：給自動補足夠的時間（正常情況下載入完立刻就會排進去）
  await page.waitForTimeout(2500)
  expect(await trainRows(page, 'exercises')).toHaveLength(3)
  const posts = (await page.evaluate(() => (window as unknown as { __writes: { table: string; method: string }[] }).__writes)).filter(
    (w) => w.table === 'exercises' && w.method === 'POST',
  )
  expect(posts).toHaveLength(0)
})

const exPatches = async (page: Page) =>
  (await allWrites(page)).filter((w) => w.table === 'exercises' && w.method === 'PATCH').map((w) => w.body)
const tipsStrip = (card: Locator) => card.locator('.ex-tips, .ex-tips-input')

test('要點條：展開的卡有、收合的卡沒有；沒寫過是淡色「加要點」；卡片頭沒有 ⓘ、⋯ 選單只剩移除', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await addExercise(page, '坐姿划船')

  const legs = page.locator('.ex', { hasText: '腿推舉' })
  const row = page.locator('.ex', { hasText: '坐姿划船' })
  // 最後加的坐姿划船是展開的（沒寫過要點）；腿推舉收合了（有要點但不顯示）
  await expect(tipsStrip(row)).toHaveText('加要點')
  await expect(tipsStrip(row)).toHaveClass(/is-empty/)
  await expect(tipsStrip(legs), '收合的卡沒有要點條').toHaveCount(0)

  await legs.locator('.ex-toggle').click()
  await expect(tipsStrip(legs)).toHaveText('背貼緊椅背')
  await expect(tipsStrip(legs)).not.toHaveClass(/is-empty/)
  // 要點條在卡片頭與欄頭之間
  const tipBox = (await tipsStrip(legs).boundingBox())!
  const headBox = (await legs.locator('.ex-head').boundingBox())!
  const setHeadBox = (await legs.locator('.set-head').boundingBox())!
  expect(tipBox.y).toBeGreaterThanOrEqual(headBox.y + headBox.height - 1)
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(setHeadBox.y + 1)

  await expect(page.locator('.ex-info, .ex-tips-panel')).toHaveCount(0)
  await legs.getByRole('button', { name: '腿推舉 的更多操作' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['移除這個動作'])
})

test('要點條：點一下原地變輸入框，失焦才存（只送 tips 一欄）；清空存 null；Esc 與沒改都不寫', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const legs = page.locator('.ex', { hasText: '腿推舉' })
  const strip = legs.locator('.ex-tips')
  const input = legs.locator('.ex-tips-input')
  const blur = () => stat(page, 'time').click() // 點卡片外的統計格＝失焦

  // 沒改就失焦：不寫
  await strip.click()
  await expect(input).toHaveValue('背貼緊椅背')
  await expect(input).toBeFocused()
  await blur()
  await expect(strip).toHaveText('背貼緊椅背')
  expect(await exPatches(page), '沒改不該寫').toHaveLength(0)

  // Esc：放棄這次的字，不寫
  await strip.click()
  await input.fill('不要存這句')
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(strip).toHaveText('背貼緊椅背')
  expect(await exPatches(page), 'Esc 不該寫').toHaveLength(0)

  // 改了再失焦：存。Enter 是換行、不是送出
  await strip.click()
  await input.fill('第三組吃力就降 2.5')
  await input.press('Enter')
  await input.pressSequentially('第二行')
  await expect(input).toBeFocused()
  expect(await exPatches(page), '失焦前不寫').toHaveLength(0)
  await blur()
  await expect(strip).toContainText('第二行')
  await expect.poll(async () => (await exPatches(page)).length).toBe(1)
  expect((await exPatches(page))[0], '只送 tips 這一欄').toEqual({ tips: '第三組吃力就降 2.5\n第二行' })
  await expect
    .poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === LEG_ID)?.tips)
    .toBe('第三組吃力就降 2.5\n第二行')

  // 清空＝「加要點」，伺服器存 null
  await strip.click()
  await input.fill('   ')
  await blur()
  await expect(strip).toHaveText('加要點')
  await expect(strip).toHaveClass(/is-empty/)
  await expect.poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === LEG_ID)?.tips).toBeNull()
  expect((await exPatches(page))[1]).toEqual({ tips: null })
})

test('要點條：離線也能寫，畫面立刻是新的，回線後上傳；改的是動作，另一次訓練裡同一個動作也看得到', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '坐姿划船')
  const row = page.locator('.ex', { hasText: '坐姿划船' })

  await setOffline(page, true)
  await row.locator('.ex-tips').click()
  await row.locator('.ex-tips-input').fill('離線時寫的')
  await stat(page, 'time').click()
  await expect(row.locator('.ex-tips')).toHaveText('離線時寫的')
  expect((await trainRows(page, 'exercises')).find((r) => r.id === ROW_ID)?.tips, '離線時伺服器還沒有').toBeNull()

  await setOffline(page, false)
  await expect
    .poll(async () => (await trainRows(page, 'exercises')).find((r) => r.id === ROW_ID)?.tips, { timeout: 20_000 })
    .toBe('離線時寫的')
})

test('⋯ 選單：「移除這個動作」沒打勾直接移除、有打勾先確認', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '坐姿划船')
  await addExercise(page, '腿推舉')
  const row = page.locator('.ex', { hasText: '坐姿划船' })
  const legs = page.locator('.ex', { hasText: '腿推舉' })

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

/* ═══════════ 替換動作（spec「動作替換、要點條、動作庫搬到設定」A） ═══════════
   卡片頭的替換鈕開 picker（標題「替換為…」、清單不含目前這個動作），挑定後一次寫入：刪舊的 workout_exercises 列、
   新的插在舊的 position。舊動作有打勾的組（有氧：填過的分鐘）先問再開 picker。預填的運算由 training.test.ts 守。 */

const SQUAT_ID = '44444444-4444-4444-8444-444444444444'
const SWAP_FIX: typeof FIX = {
  ...LIBRARY_FIX,
  exercises: [
    ...LIBRARY_FIX.exercises,
    { id: SQUAT_ID, name: '深蹲', muscle_group: 'legs', tips: null, archived: false, created_at: '2026-10-01T00:00:03.000Z' },
  ],
}
const picker = (page: Page) => page.locator('[data-screen="exercise-picker"]')
const exNames = (page: Page) => page.locator('.ex .ex-toggle .nm').allTextContents()
const swapBtn = (page: Page, name: string) => page.getByRole('button', { name: `${name}：替換動作` })

/** 三張卡：腿推舉、坐姿划船（最後加的，展開著）、深蹲不在裡面；用來換中間那張。 */
async function threeCards(page: Page, fix: typeof FIX = SWAP_FIX) {
  await openApp(page, {}, fix)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await addExercise(page, '坐姿划船')
  await addExercise(page, '深蹲')
  await expect(page.locator('.ex')).toHaveCount(3)
}

test('替換：沒打勾直接開 picker（標題「替換為…」、清單沒有自己）；挑定後卡片位置不動、新卡展開、伺服器是刪一列加一列', async ({ page }) => {
  await openApp(page, {}, SWAP_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await addExercise(page, '坐姿划船')
  await addExercise(page, '深蹲')
  expect(await exNames(page)).toEqual(['腿推舉', '坐姿划船', '深蹲'])

  await swapBtn(page, '坐姿划船').click()
  await expect(picker(page).getByRole('heading', { name: '替換為…' })).toBeVisible()
  await expect(picker(page).locator('.tr-row', { hasText: '坐姿划船' }), '清單不放目前這個動作').toHaveCount(0)
  await expect(picker(page).locator('.tr-row', { hasText: '腿推舉' })).toHaveCount(1)

  // 這時候「加動作」不能被污染：先取消，用 + 加動作進來標題還是「加動作」
  await picker(page).getByRole('button', { name: '關閉' }).click()
  await expect(picker(page)).toHaveCount(0)
  expect(await trainRows(page, 'workout_exercises')).toHaveLength(3)
  await page.locator('.tr-bottom .tr-secondary').click()
  await expect(picker(page).getByRole('heading', { name: '加動作' })).toBeVisible()
  await picker(page).getByRole('button', { name: '關閉' }).click()
  await expect(picker(page)).toHaveCount(0)

  const rowsBefore = await trainRows(page, 'workout_exercises')
  const oldRow = rowsBefore.find((r) => r.exercise_id === ROW_ID)!
  await swapBtn(page, '坐姿划船').click()
  await picker(page).locator('.tr-row', { hasText: '腿推舉' }).click()
  await expect(picker(page)).toHaveCount(0)

  expect(await exNames(page), '中間那張換成腿推舉，順序不變').toEqual(['腿推舉', '腿推舉', '深蹲'])
  await expect(page.locator('.ex').nth(1).locator('.set'), '新卡是展開的，組是新動作的預填').toHaveCount(3)
  await expect
    .poll(async () => {
      const rows = await trainRows(page, 'workout_exercises')
      return rows.map((r) => [r.exercise_id, r.position]).sort((a, b) => Number(a[1]) - Number(b[1]))
    })
    .toEqual([
      [LEG_ID, 0],
      [LEG_ID, 1],
      [SQUAT_ID, 2],
    ])
  const rowsAfter = await trainRows(page, 'workout_exercises')
  expect(rowsAfter.find((r) => r.id === oldRow.id), '舊的那一列真的刪掉了').toBeUndefined()
  const writes = (await allWrites(page)).filter((w) => w.table === 'workout_exercises')
  expect(writes.filter((w) => w.method === 'DELETE')).toHaveLength(1)
})

test('替換：舊動作有打勾的組先問；「先不要」什麼都不動、也不開 picker；「繼續」才開，換完打勾的組跟著消失、統計重算', async ({ page }) => {
  await threeCards(page)
  await tick(page, 0) // 只有最後加的深蹲是展開的，DOM 裡只有它的 3 組
  await expect(stat(page, 'sets')).toHaveText('1/9')

  await swapBtn(page, '深蹲').click()
  const dialog = page.getByRole('alertdialog', { name: '替換這個動作？' })
  await expect(dialog).toContainText('已經打勾的組會一起刪掉')
  await dialog.getByRole('button', { name: '先不要' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(picker(page)).toHaveCount(0)
  expect(await exNames(page)).toEqual(['腿推舉', '坐姿划船', '深蹲'])
  await expect(stat(page, 'sets')).toHaveText('1/9')

  await swapBtn(page, '深蹲').click()
  await dialog.getByRole('button', { name: '繼續' }).click()
  await expect(picker(page).getByRole('heading', { name: '替換為…' })).toBeVisible()
  await picker(page).locator('.tr-row', { hasText: '坐姿划船' }).click()
  await expect(picker(page)).toHaveCount(0)
  expect(await exNames(page)).toEqual(['腿推舉', '坐姿划船', '坐姿划船'])
  await expect(stat(page, 'sets'), '被換掉的動作那一組打勾不算了').toHaveText('0/9')
  await expect(stat(page, 'volume')).toHaveText('0')
})

test('替換：離線也照常換，畫面立刻是新的，回線後伺服器才跟上', async ({ page }) => {
  await openApp(page, {}, SWAP_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await expect.poll(async () => (await trainRows(page, 'workout_exercises')).length).toBe(1)

  await setOffline(page, true)
  await swapBtn(page, '腿推舉').click()
  await picker(page).locator('.tr-row', { hasText: '深蹲' }).click()
  await expect(picker(page)).toHaveCount(0)
  expect(await exNames(page)).toEqual(['深蹲'])
  expect((await trainRows(page, 'workout_exercises')).map((r) => r.exercise_id), '離線時伺服器還是舊的').toEqual([LEG_ID])

  await setOffline(page, false)
  await expect
    .poll(async () => (await trainRows(page, 'workout_exercises')).map((r) => r.exercise_id), { timeout: 20_000 })
    .toEqual([SQUAT_ID])
})

test('替換成有氧動作：變成一張有氧卡（沒有組、不展開）；有氧卡填過分鐘再換，也先問', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')

  await swapBtn(page, '腿推舉').click()
  await picker(page).locator('.tr-row', { hasText: '跑步機坡度健走' }).click()
  await expect(picker(page)).toHaveCount(0)
  const walk = cardioCard(page, '跑步機坡度健走')
  await expect(walk).toBeVisible()
  await expect(page.locator('.ex .set'), '換成有氧之後沒有任何組').toHaveCount(0)
  await expect(page.locator('.ex')).toHaveCount(1)

  // 填 20 分鐘後再換：先問，文案是有氧版
  await openCardioSheet(page, '跑步機坡度健走')
  await cardioField(page, '分鐘').fill('20')
  await saveCardio(page)
  await swapBtn(page, '跑步機坡度健走').click()
  const dialog = page.getByRole('alertdialog', { name: '替換這個動作？' })
  await expect(dialog).toContainText('這張卡記下的有氧會一起刪掉')
  await dialog.getByRole('button', { name: '繼續' }).click()
  await picker(page).locator('.tr-row', { hasText: '有氧拳擊' }).click()
  await expect(cardioCard(page, '有氧拳擊')).toBeVisible()
  await expect(page.locator('.ex')).toHaveCount(1)
})

/* ═══════════ Picker 的「新增動作」（spec C，與動作庫搬到設定同一節） ═══════════
   庫裡沒有要的動作時不用離開訓練：清單末尾的「新增動作」開同一張編輯動作 sheet（疊在 picker 上），
   建好就是被挑的那個。加動作、替換為…、課表編輯的加動作三處共用同一個 Picker。 */

const createBtn = (page: Page) => picker(page).locator('[data-action="create-exercise"]')
/** 在已開著的 picker 裡新增一個動作並儲存。 */
async function createFromPicker(page: Page, name: string, group = 'shoulder') {
  await createBtn(page).click()
  await expect(editSheet(page)).toBeVisible()
  await editSheet(page).getByRole('combobox', { name: '肌群' }).selectOption(group)
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill(name)
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
}

test('加動作 picker 的「新增動作」：建好直接加進這次訓練（預設組、伺服器有新動作與新的一列）；搜尋沒有結果時鈕也在', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()

  // 搜尋不到時正是最需要它的時候：鈕還在
  await picker(page).getByRole('searchbox', { name: '搜尋動作' }).fill('側平舉')
  await expect(picker(page).getByText('沒有符合的動作')).toBeVisible()
  await expect(createBtn(page)).toBeVisible()

  await createFromPicker(page, '啞鈴側平舉')
  await expect(editSheet(page)).toHaveCount(0)
  await expect(picker(page)).toHaveCount(0)
  expect(await exNames(page)).toEqual(['啞鈴側平舉'])
  await expect(page.locator('.ex .set'), '新動作沒有歷史，預設 3 組').toHaveCount(3)
  await expect(page.locator('.ex .set').first().locator('.w')).toHaveText('0')

  await expect
    .poll(async () => (await trainRows(page, 'exercises')).find((r) => r.name === '啞鈴側平舉')?.muscle_group)
    .toBe('shoulder')
  const created = (await trainRows(page, 'exercises')).find((r) => r.name === '啞鈴側平舉')!
  await expect
    .poll(async () => (await trainRows(page, 'workout_exercises')).map((r) => r.exercise_id))
    .toEqual([created.id])
  expect((await allWrites(page)).filter((w) => w.table === 'exercises' && w.method === 'POST'), '只新增一個動作').toHaveLength(1)
})

test('picker 的「新增動作」：重名擋在 sheet 裡不寫入、Esc 只關新增 sheet（picker 還在）、關掉之後什麼都沒加', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()

  await createBtn(page).click()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('腿推舉')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page).getByRole('alert')).toContainText('已經有「腿推舉」')
  await expect(picker(page)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(editSheet(page)).toHaveCount(0)
  await expect(picker(page), 'Esc 只關最內層').toBeVisible()
  await expect(page.locator('.ex')).toHaveCount(0)
  expect((await allWrites(page)).filter((w) => w.table === 'exercises' && w.method === 'POST')).toHaveLength(0)
})

test('替換為… 的「新增動作」：新動作換掉舊卡，位置不動；撞名檢查含這次被排除的那個動作', async ({ page }) => {
  await openApp(page, {}, SWAP_FIX)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await addExercise(page, '深蹲')

  await swapBtn(page, '腿推舉').click()
  await expect(picker(page).getByRole('heading', { name: '替換為…' })).toBeVisible()
  // 腿推舉不在這張清單裡（自己不能換自己），但新增時重名檢查要看得到它
  await createBtn(page).click()
  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('腿推舉')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(editSheet(page).getByRole('alert')).toContainText('已經有「腿推舉」')

  await editSheet(page).getByRole('textbox', { name: '名稱' }).fill('單腿硬舉')
  await editSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(picker(page)).toHaveCount(0)
  expect(await exNames(page)).toEqual(['單腿硬舉', '深蹲'])
  await expect
    .poll(async () => {
      const exs = await trainRows(page, 'exercises')
      const we = (await trainRows(page, 'workout_exercises')).sort((a, b) => Number(a.position) - Number(b.position))
      return we.map((r) => exs.find((e) => e.id === r.exercise_id)?.name)
    })
    .toEqual(['單腿硬舉', '深蹲'])
})

test('課表編輯的「加動作」也有「新增動作」：建好直接進課表', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await newRoutine(page, '推日')
  await page.locator('[data-action="add-routine-exercise"]').click()
  await createFromPicker(page, '繩索下壓', 'arms')
  await expect(picker(page)).toHaveCount(0)

  const rows = editor(page).locator('[data-section="routine-exercises"] li.tr-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('繩索下壓')
  const created = (await trainRows(page, 'exercises')).find((r) => r.name === '繩索下壓')!
  await expect
    .poll(async () => (await trainRows(page, 'routine_exercises')).map((r) => r.exercise_id))
    .toEqual([created.id])
})

test('離線新增動作並加進訓練：畫面立刻有，回線後新動作先到、訓練的那一列才跟上', async ({ page }) => {
  await openApp(page, {}, LIBRARY_FIX)
  await openTraining(page)
  await startBlank(page)
  await page.locator('.tr-bottom .tr-secondary').click()
  await setOffline(page, true)
  await createFromPicker(page, '離線新動作')
  await expect(picker(page)).toHaveCount(0)
  expect(await exNames(page)).toEqual(['離線新動作'])
  expect((await trainRows(page, 'exercises')).some((r) => r.name === '離線新動作'), '離線時伺服器還沒有').toBe(false)

  await setOffline(page, false)
  await expect
    .poll(async () => (await trainRows(page, 'exercises')).some((r) => r.name === '離線新動作'), { timeout: 20_000 })
    .toBe(true)
  const created = (await trainRows(page, 'exercises')).find((r) => r.name === '離線新動作')!
  await expect
    .poll(async () => (await trainRows(page, 'workout_exercises')).map((r) => r.exercise_id), { timeout: 20_000 })
    .toEqual([created.id])
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

/* ── 組列左滑放手後停在哪（v2.92，真機回報「拉到底會停在左邊、與紅鈕隔一段」）──
   預期值由 SwipeDelete 的常數手算：REVEAL＝56（露出紅鈕的位移）、OPEN_AT＝24（放手時超過才算開）、
   往左超過 -56 的部分只走 0.4（dragElastic.left）。紅鈕盒子 44px、貼列右緣內縮 --s-2（8px），
   所以列停在 -56 時列右緣與紅鈕左緣之間是 56 − 8 − 44 ＝ 4px 的設計留白，不是越拉越大的縫。 */

/** 位移層相對列的位移（px）：位移層右緣減列右緣。收合＝0，露出紅鈕＝-56。 */
const slideOffset = (row: Locator) =>
  row.evaluate((r) => r.querySelector('.swipe-slide')!.getBoundingClientRect().right - r.getBoundingClientRect().right)

/** 按住往橫向拖 dx（負＝往左）、**不放手**，讓呼叫端在拖曳中讀位置；放手由呼叫端 `page.mouse.up()`。
 *  逐點移動＋每點停 16ms 同 harness 的 slowDrag（冷頁面上 `mouse.move({ steps })` 起不了 motion 的 drag）。 */
async function holdDrag(page: Page, row: Locator, dx: number) {
  const box = (await row.boundingBox())!
  const from = { x: box.x + 30, y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (const p of leg(from, { x: from.x + dx, y: from.y })) {
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(16)
  }
}

test('組列左滑拉過頭：拖曳中有橡皮筋，放手一律彈回剛好露出紅鈕（收合時拉、開著再拉都一樣）', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const row = page.locator('.ex .swipe-row').nth(1)
  await expect(row).toBeVisible()

  // a. 收合時往左拉 140：最多拉到 -56，多出的 84 只走 0.4 → -56 − 33.6 ＝ -89.6（拖曳中）
  await holdDrag(page, row, -140)
  await expect.poll(() => slideOffset(row), { message: '拖曳中：超過露出紅鈕的部分有橡皮筋' }).toBeCloseTo(-89.6, 0)
  await page.mouse.up()
  await expect(row).toHaveClass(/is-open/)
  await expect.poll(() => slideOffset(row), { message: '放手：彈回剛好露出紅鈕，不是停在 -140 或 -112' }).toBeCloseTo(-56, 0)
  const gap = await row.evaluate(
    (r) => r.querySelector('.swipe-delete')!.getBoundingClientRect().left - r.querySelector('.swipe-slide')!.getBoundingClientRect().right,
  )
  expect(gap, '列右緣與紅鈕之間只剩設計留白 4px').toBeCloseTo(4, 0)

  // b. 已經開著再往左多拉 40（真機回報的情形）：拖曳中 -56 − 40×0.4 ＝ -72，放手回到 -56
  await holdDrag(page, row, -40)
  await expect.poll(() => slideOffset(row), { message: '開著再拉：拖曳中同樣有橡皮筋' }).toBeCloseTo(-72, 0)
  await page.mouse.up()
  await expect.poll(() => slideOffset(row), { message: '開著再拉放手：回到剛好露出紅鈕' }).toBeCloseTo(-56, 0)
  await expect(row).toHaveClass(/is-open/)
})

test('組列沒過門檻的拖動放手會吸回原位；開著往右拖到底照樣收合', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const row = page.locator('.ex .swipe-row').nth(1)
  await expect(row).toBeVisible()

  // c. 收合時往左拖 20（過了方向鎖的 10px、沒過開啟門檻 24）：拖曳中真的有動，放手吸回 0
  await holdDrag(page, row, -20)
  await expect.poll(() => slideOffset(row), { message: '拖曳中列跟著手走（確認 drag 真的起手了）' }).toBeLessThan(-15)
  await page.mouse.up()
  await expect.poll(() => slideOffset(row), { message: '沒過門檻：放手吸回收合' }).toBeCloseTo(0, 0)
  await expect(row).not.toHaveClass(/is-open/)

  // 開著時往右拖 14：-56 + 14 ＝ -42，仍超過門檻（-24），放手吸回 -56，不停在 -42
  await swipeLeft(page, row, 70)
  await expect(row).toHaveClass(/is-open/)
  await expect.poll(() => slideOffset(row)).toBeCloseTo(-56, 0)
  await holdDrag(page, row, 14)
  await expect.poll(() => slideOffset(row), { message: '拖曳中列往右跟著手走' }).toBeGreaterThan(-50)
  await page.mouse.up()
  await expect.poll(() => slideOffset(row), { message: '開著小幅往右：放手吸回剛好露出紅鈕' }).toBeCloseTo(-56, 0)
  await expect(row).toHaveClass(/is-open/)

  // d. 開著時往右拖 70（拖過 0 被夾住）：放手收合
  await holdDrag(page, row, 70)
  await page.mouse.up()
  await expect(row).not.toHaveClass(/is-open/)
  await expect.poll(() => slideOffset(row), { message: '往右拖回：收合到 0' }).toBeCloseTo(0, 0)
})

test('組列左滑：減少動態下開著再往左拉，放手直接回到露出紅鈕、沒有回彈過程', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const row = page.locator('.ex .swipe-row').nth(1)
  await swipeLeft(page, row, 70)
  await expect(row).toHaveClass(/is-open/)
  await expect.poll(() => slideOffset(row)).toBeCloseTo(-56, 0)

  await holdDrag(page, row, -40)
  await expect.poll(() => slideOffset(row), { message: '拖曳中：-56 − 40×0.4' }).toBeCloseTo(-72, 0)
  // 不逐幀取樣：MutationObserver 記下放手後位移層每一次寫入的 translateX，有沒有中間值與幀數無關
  await row.locator('.swipe-slide').evaluate((n) => {
    const w = window as unknown as { __xs: number[] }
    w.__xs = []
    new MutationObserver(() => {
      const m = /translateX\((-?[\d.]+)px\)/.exec((n as HTMLElement).style.transform)
      if (m) w.__xs.push(Number(m[1]))
    }).observe(n, { attributes: true, attributeFilter: ['style'] })
  })
  await page.mouse.up()
  await expect.poll(() => slideOffset(row)).toBeCloseTo(-56, 0)
  await page.waitForTimeout(500) // 讓可能還在跑的回彈有時間寫出中間值
  const xs = await page.evaluate(() => (window as unknown as { __xs: number[] }).__xs)
  expect(xs.at(-1), '最後一次寫入是 -56').toBeCloseTo(-56, 0)
  // motion 的放手回彈在 onDragEnd 之前已先寫了一格（≈ 拖曳中的 -72，肉眼等於沒動），所以只抓兩端之間的中間值
  expect(xs.filter((v) => v > -71.5 && v < -56.5), '沒有 -72 → -56 的中間過程').toEqual([])
})

/* ── 勾與雙勾的按下回饋（v2.92，真機回報按住沒有「被壓下去」的感覺）──
   預期值由 DESIGN.md 的 token 換算，不讀頁面算出來的值：--fill #F1E6D2、--rule #E0D3BD、--accent #1C7059、--accent-dark #155747；
   按下縮放 .88。桌面只能證明「標記會掛上、樣式吃得到標記」，iOS 真機的 :active 與手指遮蔽無法在這裡驗。 */
const RGB = {
  fill: 'rgb(241, 230, 210)',
  rule: 'rgb(224, 211, 189)',
  accent: 'rgb(28, 112, 89)',
  accentDark: 'rgb(21, 87, 71)',
}
const PRESSED_SCALE = 'matrix(0.88, 0, 0, 0.88, 0, 0)'
const look = (el: Locator) =>
  el.evaluate((n) => {
    const s = getComputedStyle(n)
    return { transform: s.transform, bg: s.backgroundColor, pressed: n.hasAttribute('data-pressed'), active: n.matches(':active') }
  })

/** 滑鼠移到元素中心按下（不放）。 */
async function pressAt(page: Page, el: Locator) {
  const box = (await el.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
}

test('勾與全部完成雙勾：按住縮小、底色深一階（未勾 → --rule、已勾 → --accent-dark），放開回復', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const check = page.locator('.ex .set').first().locator('.tr-check')
  const all = page.locator('.ex .tr-all')

  expect(await look(check)).toMatchObject({ transform: 'none', bg: RGB.fill, pressed: false })
  await pressAt(page, check)
  await expect.poll(() => look(check)).toMatchObject({ transform: PRESSED_SCALE, bg: RGB.rule, pressed: true })
  await page.mouse.up() // 放開＝點了一下：這一組打勾
  await expect.poll(() => look(check)).toMatchObject({ transform: 'none', bg: RGB.accent, pressed: false })

  await pressAt(page, check)
  await expect.poll(() => look(check), { message: '已勾的綠圓按住變深綠' }).toMatchObject({ transform: PRESSED_SCALE, bg: RGB.accentDark, pressed: true })
  await page.mouse.up()
  await expect.poll(() => look(check)).toMatchObject({ transform: 'none', bg: RGB.fill, pressed: false })

  expect(await look(all)).toMatchObject({ transform: 'none', bg: RGB.fill, pressed: false })
  await pressAt(page, all)
  await expect.poll(() => look(all)).toMatchObject({ transform: PRESSED_SCALE, bg: RGB.rule, pressed: true })
  await page.mouse.up() // 全部打勾
  await expect.poll(() => look(all)).toMatchObject({ transform: 'none', bg: RGB.accent, pressed: false })
  await pressAt(page, all)
  await expect.poll(() => look(all)).toMatchObject({ transform: PRESSED_SCALE, bg: RGB.accentDark, pressed: true })
  await page.mouse.up()
  await expect.poll(() => look(all)).toMatchObject({ transform: 'none', bg: RGB.fill, pressed: false })
})

test('勾的按下回饋不靠 :active：觸控的 pointerdown 就進入按下狀態，pointerup／pointercancel 清掉', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const releaseWith = (type: 'pointerup' | 'pointercancel') =>
    page.evaluate((t) => window.dispatchEvent(new PointerEvent(t, { pointerType: 'touch' })), type)

  for (const el of [page.locator('.ex .set').first().locator('.tr-check'), page.locator('.ex .tr-all')]) {
    await el.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 })
    await expect.poll(() => look(el), { message: '只派 pointerdown（沒有 :active）也縮小、變深' }).toMatchObject({
      transform: PRESSED_SCALE,
      bg: RGB.rule,
      pressed: true,
      active: false,
    })
    await releaseWith('pointerup')
    await expect.poll(() => look(el)).toMatchObject({ transform: 'none', bg: RGB.fill, pressed: false })

    await el.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 })
    await expect.poll(() => look(el)).toMatchObject({ pressed: true })
    await releaseWith('pointercancel') // 縱向捲動接手時瀏覽器發的
    await expect.poll(() => look(el)).toMatchObject({ transform: 'none', bg: RGB.fill, pressed: false })
  }
})

test('在組列的勾上按下後開始左滑：按下狀態在拖曳中就清掉，列照樣滑開、不打勾', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const row = page.locator('.ex .swipe-row').nth(1)
  const check = row.locator('.tr-check')
  const box = (await check.boundingBox())!
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await expect.poll(() => look(check)).toMatchObject({ pressed: true })
  for (const p of leg(from, { x: from.x - 70, y: from.y })) {
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(16)
  }
  await expect.poll(() => look(check), { message: '手指還按著、但已經在拖：不再是按下' }).toMatchObject({ pressed: false })
  await page.mouse.up()
  await expect(row, '拖曳真的發生了').toHaveClass(/is-open/)
  await expect(page.locator('.ex .set.done')).toHaveCount(0)
})

test('勾與雙勾：減少動態下按住不縮放、底色照樣變深', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  const check = page.locator('.ex .set').first().locator('.tr-check')
  const all = page.locator('.ex .tr-all')

  await check.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 })
  await expect.poll(() => look(check)).toMatchObject({ pressed: true, bg: RGB.rule })
  expect((await look(check)).transform, '標記路徑：不縮放').toBe('none')
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup')))

  await pressAt(page, all) // 滑鼠按住：:active 與標記兩條都在
  await expect.poll(() => look(all)).toMatchObject({ pressed: true, active: true, bg: RGB.rule })
  expect((await look(all)).transform, ':active 路徑：不縮放').toBe('none')
  await page.mouse.move(0, 0) // 移開再放，不觸發全部完成
  await page.mouse.up()
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
  for (const sel of ['.ex-toggle .chev', '.ex-swap', '[aria-label$="的更多操作"]']) {
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
  await openTraining(page)
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
  await openTraining(page)
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
  await openTraining(page)
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

test('補記的訓練沒有 RPE 頁尾，也沒有休息條（與休息條同一個條件）', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await gotoDate(page, shiftIso(TODAY, -1))
  await page.getByRole('button', { name: '開始訓練' }).click()
  await expect(page.locator('[data-screen="start-sheet"]')).toContainText('補記')
  await page.locator('[data-action="start-blank"]').click()
  await addExercise(page, '腿推舉')
  await tick(page, 0)
  await tick(page, 1) // 兩組都勾完：進行中的訓練這時會長出頁尾
  await expect(page.locator('.ex .set').nth(1).locator('.tr-check')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.ex [data-section="ex-rpe"]')).toHaveCount(0)
  await expect(page.locator('.tr-rest')).toHaveCount(0)
})

/* ═══════════ 有氧卡（spec「有氧併入動作」AC 3–9，DESIGN v2.89） ═══════════
   有氧是動作：動作庫裡兩個（跑步機坡度健走、有氧拳擊，`exercises.kind`），訓練中一張有氧卡＝workout_exercises 一列、沒有組，
   點卡開有氧 sheet。舊的獨立入口（開始訓練 sheet 的「記一筆有氧」、訓練頁的有氧列、cardio_sessions）已拆，這裡驗新模型。
   運算（預填、摘要、只送有變的欄位、範圍）由 training.test.ts 守，這裡驗使用者看得到的與真正送出去的；預期值全部手算。
   兩個有氧動作取目錄裡的整列（id 是預設動作的確定性 id，catalogKey 對得上——「健走有圖、拳擊是手套圖示」要用真的 id 才驗得到）。 */

const catalogRow = (name: string) => {
  const row = SEEDED_FIX.exercises.find((e) => e.name === name)
  if (!row) throw new Error(`目錄裡沒有「${name}」`)
  return row as Record<string, unknown> & { id: string }
}
const WALK = catalogRow('跑步機坡度健走')
const BOX = catalogRow('有氧拳擊')

/** 動作庫：腿推舉（fixture 自己的 id、重訓）＋兩個有氧動作。沒有 16 個原始預設動作，開 App 不會自動補（不多寫入）。 */
const CARDIO_LIB: typeof FIX = { ...FIX, exercises: [...FIX.exercises, WALK, BOX] }

/** 兩天前做過一次坡度健走：30 分、5.5 km/h、坡度 8%（預填的來源）。在兩天前，所以今天的清單是空的。 */
const HIST_DAY = shiftIso(TODAY, -2)
const WALK_HIST: typeof FIX = {
  ...CARDIO_LIB,
  workouts: [
    { id: 'w-h', performed_on: HIST_DAY, started_at: `${HIST_DAY}T08:00:00.000Z`, ended_at: `${HIST_DAY}T08:30:00.000Z`, routine_id: null },
  ],
  workout_exercises: [
    { id: 'we-h', workout_id: 'w-h', exercise_id: WALK.id, position: 0, minutes: 30, speed_kmh: 5.5, incline_pct: 8, est_kcal: null },
  ],
}

const cardioSheet = (page: Page) => page.locator('[data-screen="cardio-sheet"]')
const cardioField = (page: Page, name: string) => cardioSheet(page).getByRole('textbox', { name, exact: true })
const cardioCard = (page: Page, name: string) => page.locator('.ex.is-cardio', { hasText: name })

type Write = { table: string; method: string; path: string; body: Record<string, unknown> }
const allWrites = (page: Page) => page.evaluate(() => (window as unknown as { __writes: Write[] }).__writes)
/** workout_exercises 的 PATCH 內容（＝有氧 sheet 存檔送出的欄位），依送出順序。 */
const entryPatches = async (page: Page) =>
  (await allWrites(page)).filter((w) => w.table === 'workout_exercises' && w.method === 'PATCH').map((w) => w.body)

/** 加一個有氧動作：有氧卡沒有組，所以不能用 addExercise（它等 `.ex .set`）。 */
async function addCardio(page: Page, name: string) {
  await page.locator('.tr-bottom .tr-secondary').click()
  await page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: name }).click()
  await expect(cardioCard(page, name)).toBeVisible()
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
}

async function openCardioSheet(page: Page, name: string) {
  await cardioCard(page, name).locator('.ex-toggle').click()
  await expect(cardioSheet(page)).toBeVisible()
}

async function saveCardio(page: Page) {
  await cardioSheet(page).getByRole('button', { name: '儲存' }).click()
  await expect(cardioSheet(page)).toHaveCount(0)
}

test('加有氧動作（沒做過）：一張有氧卡、沒有任何組；卡片寫「點一下填寫」（較深較粗），名稱鈕是開 sheet 不是展開', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走')

  const card = cardioCard(page, '跑步機坡度健走')
  await expect(card.locator('.set'), '有氧卡沒有組列').toHaveCount(0)
  await expect(stat(page, 'sets'), '畫面上也沒有多出組').toHaveText('0/0')
  const missing = card.locator('.sub .is-missing')
  await expect(missing).toHaveText('點一下填寫')
  expect(await missing.evaluate((el) => getComputedStyle(el).fontWeight), '沒填時字較粗').toBe('700')
  const toggle = card.locator('.ex-toggle')
  await expect(toggle).toHaveAttribute('aria-haspopup', 'dialog')
  expect(await toggle.getAttribute('aria-expanded'), '有氧卡不展開，沒有 aria-expanded').toBeNull()

  await expect.poll(async () => (await trainRows(page, 'workout_exercises')).length).toBe(1)
  expect((await trainRows(page, 'workout_exercises'))[0]).toMatchObject({
    exercise_id: WALK.id, position: 0, minutes: null, speed_kmh: null, incline_pct: null, est_kcal: null,
  })
  // 沒有事件可等的反向斷言：組若有寫入，會緊跟在 workout_exercises 那筆後面送出
  await page.waitForTimeout(500)
  expect((await allWrites(page)).filter((w) => w.table === 'workout_sets'), '沒有任何 workout_sets 寫入').toHaveLength(0)

  // 沒做過：分鐘欄沒有「上次」可提示
  await openCardioSheet(page, '跑步機坡度健走')
  await expect(cardioField(page, '分鐘')).toHaveValue('')
  expect(await cardioField(page, '分鐘').getAttribute('placeholder'), '沒有歷史不放 placeholder').toBeNull()
})

test('加有氧動作（做過）：速度與坡度預填上次的值、分鐘留空——卡片仍是「點一下填寫」，sheet 的分鐘欄提示「上次 30」', async ({ page }) => {
  await openApp(page, {}, WALK_HIST)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走')

  // 分鐘不預填（2026-10-22 裁決）：預填了就分不出「做了」與「帶出來但沒做」，所以剛加的卡不算記錄
  const card = cardioCard(page, '跑步機坡度健走')
  await expect(card.locator('.sub .is-missing')).toHaveText('點一下填寫')
  await expect(card.locator('.cardio-sum')).toHaveCount(0)
  await expect
    .poll(async () => (await trainRows(page, 'workout_exercises')).find((r) => r.id !== 'we-h'))
    .toMatchObject({ exercise_id: WALK.id, minutes: null, speed_kmh: 5.5, incline_pct: 8, est_kcal: null })
  await openCardioSheet(page, '跑步機坡度健走')
  await expect(cardioField(page, '分鐘')).toHaveValue('')
  await expect(cardioField(page, '分鐘')).toHaveAttribute('placeholder', '上次 30')
  await expect(cardioField(page, '速度 km/h')).toHaveValue('5.5')
  await expect(cardioField(page, '坡度 %')).toHaveValue('8')

  // 這次填了 45 再打開：「上次」仍是兩天前的 30（排除這一次，不會自己提示自己）
  await cardioField(page, '分鐘').fill('45')
  await saveCardio(page)
  await expect(card.locator('.cardio-sum')).toHaveText('45 分 · 5.5 km/h · 坡度 8%')
  await openCardioSheet(page, '跑步機坡度健走')
  await expect(cardioField(page, '分鐘')).toHaveValue('45')
  await expect(cardioField(page, '分鐘')).toHaveAttribute('placeholder', '上次 30')
})

test('有氧 sheet：標題是動作名稱；欄位依動作（健走三欄、拳擊兩欄）；沒有類型切換、日期說明、刪除', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走')
  await addCardio(page, '有氧拳擊')
  const sheet = cardioSheet(page)

  await openCardioSheet(page, '跑步機坡度健走')
  await expect(sheet.getByRole('heading', { name: '跑步機坡度健走' })).toBeVisible()
  await expect(sheet.getByRole('textbox')).toHaveCount(3)
  for (const name of ['分鐘', '速度 km/h', '坡度 %']) await expect(cardioField(page, name)).toBeVisible()
  await expect(sheet.getByRole('group', { name: '有氧類型' }), '類型由動作決定，沒有切換').toHaveCount(0)
  await expect(sheet.locator('.seg')).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: /刪除/ }), '刪除走卡片 ⋯').toHaveCount(0)
  await expect(sheet, '日期由訓練決定，不講記在哪天').not.toContainText('記在')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  await openCardioSheet(page, '有氧拳擊')
  await expect(sheet.getByRole('heading', { name: '有氧拳擊' })).toBeVisible()
  await expect(sheet.getByRole('textbox')).toHaveCount(2)
  for (const name of ['分鐘', '預估熱量 kcal']) await expect(cardioField(page, name)).toBeVisible()
})

test('有氧 sheet 存檔：只送有變的欄位；再打開是剛存的值；什麼都沒改按儲存不送請求、直接關', async ({ page }) => {
  await openApp(page, {}, WALK_HIST)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走') // 預填速度 5.5、坡度 8，分鐘空白

  await openCardioSheet(page, '跑步機坡度健走')
  await cardioField(page, '分鐘').fill('40')
  await saveCardio(page)
  await expect(cardioCard(page, '跑步機坡度健走').locator('.cardio-sum')).toHaveText('40 分 · 5.5 km/h · 坡度 8%')
  await expect.poll(() => entryPatches(page), { message: '只改了分鐘，只送分鐘' }).toEqual([{ minutes: 40 }])

  await openCardioSheet(page, '跑步機坡度健走')
  await expect(cardioField(page, '分鐘')).toHaveValue('40')
  await expect(cardioField(page, '速度 km/h')).toHaveValue('5.5')
  await expect(cardioField(page, '坡度 %')).toHaveValue('8')
  await saveCardio(page)
  await page.waitForTimeout(500) // 沒有事件可等的反向斷言：若有送出，是在這段時間內
  expect(await entryPatches(page), '什麼都沒改不送').toEqual([{ minutes: 40 }])
})

/** 拿住佇列的狀態鎖：onWrite 要先排進本機佇列才算寫完，排隊要拿這把鎖（`queue.ts` 的 STATE_LOCK，
 *  crossLock 走 navigator.locks），拿著的期間 sheet 就停在「寫入中」。回傳放開的函式。
 *  呼叫前先等前面的寫入都上傳完，免得卡住的是別的寫入。鎖名寫死在 queue.ts，改名這裡要跟著改。 */
async function holdQueueLock(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(
    () =>
      new Promise<void>((held) => {
        void navigator.locks.request('tally-queue-state', () =>
          new Promise<void>((release) => {
            ;(window as unknown as { __releaseQueueLock: () => void }).__releaseQueueLock = release
            held()
          }),
        )
      }),
  )
  return () => page.evaluate(() => (window as unknown as { __releaseQueueLock: () => void }).__releaseQueueLock())
}

test('填寫空白的有氧卡、寫入完成前連按兩次 Enter：只送一次（分鐘、速度、坡度三欄），卡片換成摘要', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走')
  await expect.poll(async () => (await trainRows(page, 'workout_exercises')).length).toBe(1)
  await openCardioSheet(page, '跑步機坡度健走')
  await cardioField(page, '分鐘').fill('30')
  await cardioField(page, '速度 km/h').fill('5.5')
  await cardioField(page, '坡度 %').fill('8')

  // 第一次 Enter 之後寫入卡在排隊：第二次 Enter 一定落在寫入完成之前。擋住它的是寫入中把送出鈕 disabled——
  // 送出鈕 disabled 時瀏覽器不做隱式送出。寫完之後的那一下（關閉動畫裡）不在這裡驗：那時卡片已是新值，
  // 再送也是「沒有變更」，由上面那條「什麼都沒改不送」守
  const release = await holdQueueLock(page)
  await cardioField(page, '坡度 %').press('Enter')
  await expect(cardioSheet(page).getByRole('button', { name: '儲存' }), '寫入中').toBeDisabled()
  await cardioField(page, '坡度 %').press('Enter')
  await release()

  await expect(cardioCard(page, '跑步機坡度健走').locator('.cardio-sum')).toHaveText('30 分 · 5.5 km/h · 坡度 8%')
  await expect(cardioSheet(page)).toHaveCount(0)
  await page.waitForTimeout(500) // 第二次若有送出，是在這段時間內落地
  expect(await entryPatches(page)).toEqual([{ minutes: 30, speed_kmh: 5.5, incline_pct: 8 }])
})

test('有氧 sheet 寫入失敗：寫入中關不掉；失敗的說明留在 sheet 裡、填的值還在，什麼都沒送出', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走')
  await expect.poll(async () => (await trainRows(page, 'workout_exercises')).length).toBe(1)
  await openCardioSheet(page, '跑步機坡度健走')
  await cardioField(page, '分鐘').fill('30')
  const sheet = cardioSheet(page)
  const save = sheet.getByRole('button', { name: '儲存' })

  // 寫入只在「排進本機佇列」那一步會失敗（伺服器拒絕是之後上傳的事，sheet 早已關了）：本機儲存寫不進去
  // （容量滿、私密模式），讓 IndexedDB 的 put 丟錯
  const release = await holdQueueLock(page)
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('模擬的容量已滿', 'QuotaExceededError')
    }
  })
  await save.click()
  await expect(save, '寫入中').toBeDisabled()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400) // 沒有事件可等的反向斷言：sheet 若會關，這段時間內就開始收了
  await expect(sheet, '寫入中鎖住，Escape 關不掉——失敗的說明才有地方出現').toBeVisible()
  await release()

  await expect(sheet.getByRole('alert')).toContainText('這筆沒有存下來')
  await expect(sheet).toBeVisible()
  await expect(cardioField(page, '分鐘'), '填的值不丟').toHaveValue('30')
  await expect(save, '失敗後可以再試').toBeEnabled()
  await expect(cardioCard(page, '跑步機坡度健走').locator('.sub .is-missing')).toHaveText('點一下填寫')
  expect(await entryPatches(page), '沒有排進佇列，什麼都沒送').toEqual([])
})

test('有氧的數值守門：分鐘必填；範圍外與超過一位小數擋在 sheet 裡說明（訊息沿用），不寫入、不關', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走')
  await addCardio(page, '有氧拳擊')
  const sheet = cardioSheet(page)
  const save = sheet.getByRole('button', { name: '儲存' })
  const alert = sheet.getByRole('alert')

  await openCardioSheet(page, '跑步機坡度健走')
  await save.click()
  await expect(alert).toHaveText('分鐘要填')
  await cardioField(page, '分鐘').fill('0')
  await save.click()
  await expect(alert).toHaveText('分鐘要大於 0、最多 1440')
  await cardioField(page, '分鐘').fill('30')
  await cardioField(page, '速度 km/h').fill('5.55')
  await save.click()
  await expect(alert).toHaveText('速度最多一位小數')
  await cardioField(page, '速度 km/h').fill('41')
  await save.click()
  await expect(alert).toHaveText('速度要大於 0、最多 40 km/h')
  await cardioField(page, '速度 km/h').fill('5.5')
  await cardioField(page, '坡度 %').fill('41')
  await save.click()
  await expect(alert).toHaveText('坡度要在 0–40% 之間')
  await expect(sheet, '擋下時不關').toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  await openCardioSheet(page, '有氧拳擊')
  await cardioField(page, '分鐘').fill('36')
  await cardioField(page, '預估熱量 kcal').fill('10001')
  await save.click()
  await expect(alert).toHaveText('預估熱量要在 0–10000 kcal 之間')
  await expect(sheet).toBeVisible()
  expect(await entryPatches(page), '被擋下的都不該寫入').toEqual([])
})

test('動作的 kind 不是兩種有氧之一（不認得的值）：當重訓——有組、能展開，不會變成填不了的有氧卡', async ({ page }) => {
  // 舊模型的「不認得的有氧類型」（cardio_sessions.kind）已不存在；新模型裡類型在動作上，exerciseKind 對不認得的值一律當重訓
  const swim = { id: '44444444-4444-4444-8444-444444444444', name: '游泳', muscle_group: 'other', kind: 'swim', tips: null, archived: false, created_at: '2026-10-01T00:00:03.000Z' }
  await openApp(page, {}, { ...FIX, exercises: [...FIX.exercises, swim] })
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '游泳')

  const card = page.locator('.ex', { hasText: '游泳' })
  await expect(card).not.toHaveClass(/is-cardio/)
  await expect(card.locator('.ex-toggle')).toHaveAttribute('aria-expanded', 'true')
  // 沒做過、不是照課表開：預設 3 組、重量 0、次數 0（DEFAULT_TARGET_SETS＝3、沒有目標次數）
  await expect(card.locator('.set')).toHaveCount(3)
  await expect(card.locator('.set').first().locator('.w')).toHaveText('0')
  await expect(card.locator('.set').first().locator('.r')).toHaveText('0')
  await expect.poll(async () => (await trainRows(page, 'workout_exercises')).length).toBe(1)
  expect(Object.keys((await trainRows(page, 'workout_exercises'))[0]), '重訓的卡不帶有氧欄位').not.toContain('minutes')
})

test('離線：加有氧動作、填寫、結束訓練，畫面立刻有；回線後完整上傳（有氧那列、訓練的結束時間，沒有組）', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await setOffline(page, true)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走')
  await openCardioSheet(page, '跑步機坡度健走')
  await cardioField(page, '分鐘').fill('30')
  await cardioField(page, '速度 km/h').fill('5.5')
  await cardioField(page, '坡度 %').fill('8')
  await saveCardio(page)
  await expect(cardioCard(page, '跑步機坡度健走').locator('.cardio-sum')).toHaveText('30 分 · 5.5 km/h · 坡度 8%')

  await page.getByRole('button', { name: '完成訓練' }).click()
  await expect(finishSheet(page).locator('.tr-row', { hasText: '跑步機坡度健走' }).locator('.sub')).toHaveText('30 分 · 5.5 km/h · 坡度 8%')
  await finishSheet(page).getByRole('button', { name: '完成', exact: true }).click()

  // 離線：列表上已經有（只有一張有氧卡的訓練＝動作名稱＋摘要），伺服器還沒有
  const row = page.locator('.tr-sec:has-text("已完成") + .tr-card .tr-row')
  await expect(row.locator('.nm')).toHaveText('跑步機坡度健走')
  await expect(row.locator('.sub')).toHaveText('30 分 · 5.5 km/h · 坡度 8%')
  await expect(page.locator('[data-screen="training"] .tr-status')).toContainText('筆尚未同步')
  expect(await trainRows(page, 'workouts'), '離線時伺服器還沒有').toHaveLength(0)

  await setOffline(page, false)
  await expect
    .poll(async () => (await trainRows(page, 'workouts'))[0]?.ended_at ?? null, { timeout: 15_000 })
    .not.toBeNull()
  await expect
    .poll(async () => (await trainRows(page, 'workout_exercises'))[0], { timeout: 15_000 })
    .toMatchObject({ exercise_id: WALK.id, minutes: 30, speed_kmh: 5.5, incline_pct: 8, est_kcal: null })
  expect(await trainRows(page, 'workouts'), '不重複').toHaveLength(1)
  expect(await trainRows(page, 'workout_exercises'), '不重複').toHaveLength(1)
  expect(await trainRows(page, 'workout_sets'), '有氧沒有組').toHaveLength(0)
  await expect(page.locator('[data-screen="training"] .tr-status')).toHaveCount(0, { timeout: 15_000 })
})

test('開始訓練 sheet 沒有「記一筆有氧」；加有氧、填寫、完成整個流程沒有任何 cardio_sessions 請求', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await page.getByRole('button', { name: '開始訓練' }).click()
  const start = page.locator('[data-screen="start-sheet"]')
  await expect(start.locator('[data-action="start-blank"]')).toBeVisible()
  await expect(start.locator('[data-action="start-cardio"]')).toHaveCount(0)
  await expect(start).not.toContainText('有氧')
  await start.locator('[data-action="start-blank"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()

  await addCardio(page, '有氧拳擊')
  await openCardioSheet(page, '有氧拳擊')
  await cardioField(page, '分鐘').fill('36')
  await cardioField(page, '預估熱量 kcal').fill('121')
  await saveCardio(page)
  await expect(cardioCard(page, '有氧拳擊').locator('.cardio-sum')).toHaveText('36 分 · 預估 121 kcal')
  await page.getByRole('button', { name: '完成訓練' }).click()
  await finishSheet(page).getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
  await expect.poll(async () => (await trainRows(page, 'workouts'))[0]?.ended_at ?? null).not.toBeNull()

  const fetches = await page.evaluate(() => (window as unknown as { __allFetches: string[] }).__allFetches)
  expect(fetches.filter((u) => u.includes('cardio_sessions')), '讀寫都不再碰舊表').toEqual([])
})

/** 今天三次已結束的訓練：只有一張拳擊卡（填過）、只有一張健走卡（沒填）、腿推舉＋健走（兩個動作）。 */
const SOLO_FIX: typeof FIX = {
  ...CARDIO_LIB,
  workouts: [
    { id: 'w-box', performed_on: TODAY, started_at: `${TODAY}T01:00:00.000Z`, ended_at: `${TODAY}T01:36:00.000Z`, routine_id: null },
    { id: 'w-walk', performed_on: TODAY, started_at: `${TODAY}T02:00:00.000Z`, ended_at: `${TODAY}T02:30:00.000Z`, routine_id: null },
    { id: 'w-mix', performed_on: TODAY, started_at: `${TODAY}T03:00:00.000Z`, ended_at: `${TODAY}T03:40:00.000Z`, routine_id: null },
  ],
  workout_exercises: [
    { id: 'we-box', workout_id: 'w-box', exercise_id: BOX.id, position: 0, minutes: 36, speed_kmh: null, incline_pct: null, est_kcal: 121 },
    { id: 'we-walk', workout_id: 'w-walk', exercise_id: WALK.id, position: 0, minutes: null, speed_kmh: null, incline_pct: null, est_kcal: null },
    { id: 'we-mix-1', workout_id: 'w-mix', exercise_id: EX_ID, position: 0 },
    { id: 'we-mix-2', workout_id: 'w-mix', exercise_id: WALK.id, position: 1, minutes: 20, speed_kmh: 5, incline_pct: 6, est_kcal: null },
  ],
}

test('已完成列表：只有一張有氧卡的訓練寫動作名稱＋有氧摘要，沒填寫「還沒填」；有重訓的照舊寫動作數', async ({ page }) => {
  await openApp(page, {}, SOLO_FIX)
  await openTraining(page)
  const row = (id: string) => page.locator(`[data-screen="training"] .tr-row[data-workout-id="${id}"]`)
  await expect(row('w-box').locator('.nm')).toHaveText('有氧拳擊')
  await expect(row('w-box').locator('.sub'), '不寫「0/0 組 · 0 kg」').toHaveText('36 分 · 預估 121 kcal')
  await expect(row('w-walk').locator('.nm')).toHaveText('跑步機坡度健走')
  await expect(row('w-walk').locator('.sub')).toHaveText('還沒填')
  await expect(row('w-mix').locator('.nm'), '兩個動作（有一張是有氧）不是「只有一張有氧卡」').toHaveText('2 個動作')
  await expect(page.locator('[data-screen="training"] .datectl-day.is-today')).toHaveClass(/is-marked/)
})

test('只有一張有氧卡的訓練：點進去可編輯，存完回列表摘要跟著換', async ({ page }) => {
  await openApp(page, {}, SOLO_FIX)
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-box"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
  await expect(cardioCard(page, '有氧拳擊').locator('.cardio-sum')).toHaveText('36 分 · 預估 121 kcal')
  await openCardioSheet(page, '有氧拳擊')
  await expect(cardioField(page, '分鐘')).toHaveValue('36')
  await expect(cardioField(page, '預估熱量 kcal')).toHaveValue('121')
  await cardioField(page, '分鐘').fill('40')
  await saveCardio(page)
  await expect.poll(async () => (await trainRows(page, 'workout_exercises')).find((r) => r.id === 'we-box')?.minutes).toBe(40)

  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.locator('.tr-row[data-workout-id="w-box"] .sub')).toHaveText('40 分 · 預估 121 kcal')
})

test('只有一張有氧卡的訓練：點進去可刪除那次訓練（沿用刪除確認），卡跟著一起刪', async ({ page }) => {
  await openApp(page, {}, SOLO_FIX)
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-box"]').click()
  await page.getByRole('button', { name: '刪除這次訓練' }).click()
  const dialog = page.getByRole('alertdialog', { name: '刪除這次訓練？' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '刪除', exact: true }).click()

  await expect(page.locator('[data-screen="training"]')).toBeVisible()
  await expect(page.locator('.tr-row[data-workout-id="w-box"]')).toHaveCount(0)
  await expect(page.locator('.tr-row[data-workout-id="w-walk"]'), '別的訓練不動').toHaveCount(1)
  await expect.poll(async () => (await trainRows(page, 'workouts')).map((w) => w.id).sort()).toEqual(['w-mix', 'w-walk'])
  expect((await trainRows(page, 'workout_exercises')).find((r) => r.id === 'we-box'), '有氧那列隨訓練 cascade 刪掉').toBeUndefined()
})

test('完成訓練 sheet：有氧卡那一列寫摘要，沒填寫「還沒填」（不寫「沒有打勾的組」）', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走') // 不填
  await addCardio(page, '有氧拳擊')
  await openCardioSheet(page, '有氧拳擊')
  await cardioField(page, '分鐘').fill('36')
  await cardioField(page, '預估熱量 kcal').fill('121')
  await saveCardio(page)

  await page.getByRole('button', { name: '完成訓練' }).click()
  const sheet = finishSheet(page)
  await expect(sheet.locator('.tr-row', { hasText: '有氧拳擊' }).locator('.sub')).toHaveText('36 分 · 預估 121 kcal')
  await expect(sheet.locator('.tr-row', { hasText: '跑步機坡度健走' }).locator('.sub')).toHaveText('還沒填')
  await expect(sheet).not.toContainText('沒有打勾的組')
})

test('有氧卡也能用握把排序（鍵盤）：順序換了，位置落到伺服器', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await addCardio(page, '跑步機坡度健走')
  await expect(page.locator('.ex .nm')).toHaveText(['腿推舉', '跑步機坡度健走'])

  await pickUp(page, '跑步機坡度健走')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Space')
  await expect(page.locator('.ex .nm')).toHaveText(['跑步機坡度健走', '腿推舉'])
  await expect.poll(() => storedExerciseOrder(page)).toEqual([WALK.id, EX_ID])
})

test('移除有氧卡：分鐘填過的先問（「這張卡記下的有氧會一起刪掉。」，收起途中內文不跳），沒填的直接移除', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走') // 不填
  await addCardio(page, '有氧拳擊')
  await openCardioSheet(page, '有氧拳擊')
  await cardioField(page, '分鐘').fill('36')
  await saveCardio(page)

  await cardioCard(page, '跑步機坡度健走').getByRole('button', { name: '跑步機坡度健走 的更多操作' }).click()
  await page.getByRole('menuitem', { name: '移除這個動作' }).click()
  await expect(page.locator('.ex'), '沒填的直接移除').toHaveCount(1)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  await cardioCard(page, '有氧拳擊').getByRole('button', { name: '有氧拳擊 的更多操作' }).click()
  await page.getByRole('menuitem', { name: '移除這個動作' }).click()
  const dialog = page.getByRole('alertdialog', { name: '移除這個動作？' })
  await expect(dialog.locator('.tr-dialog-body')).toHaveText('這張卡記下的有氧會一起刪掉。')
  // 按「先不要」到對話框卸載之間，內文的每一次變動都記下來（不逐幀取樣）：問的目標一清掉，
  // 內文若照「現在要移除誰」算，會在收起途中跳成重訓的「已經打勾的組」
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { __dialogTexts: string[] }).__dialogTexts = seen
    new MutationObserver(() => {
      const body = document.querySelector('.tr-dialog-body')
      if (body) seen.push(body.textContent ?? '')
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  await dialog.getByRole('button', { name: '先不要' }).click()
  await expect(dialog).toHaveCount(0)
  const texts = await page.evaluate(() => (window as unknown as { __dialogTexts: string[] }).__dialogTexts)
  expect(texts.filter((t) => t !== '這張卡記下的有氧會一起刪掉。'), '收起途中內文不變').toEqual([])
  await expect(page.locator('.ex')).toHaveCount(1)

  await cardioCard(page, '有氧拳擊').getByRole('button', { name: '有氧拳擊 的更多操作' }).click()
  await page.getByRole('menuitem', { name: '移除這個動作' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '移除', exact: true }).click()
  await expect(page.locator('.ex')).toHaveCount(0)
  await expect.poll(async () => (await trainRows(page, 'workout_exercises')).length).toBe(0)
})

/** 拳擊手套圖示：縮圖方塊裡一個 svg、沒有字、讀屏不念（DESIGN v2.90）。 */
async function expectGloveIcon(scope: Locator, label: string) {
  const thumb = scope.locator('.ex-thumb')
  await expect(thumb, `${label}：只有一個縮圖`).toHaveCount(1)
  await expect(thumb, `${label}：是圖示方塊`).toHaveClass(/\bis-icon\b/)
  await expect(thumb.locator('svg'), `${label}：方塊裡是線稿圖示`).toHaveCount(1)
  await expect(thumb, `${label}：不是肌群單字`).toHaveText('')
  await expect(thumb).toHaveAttribute('aria-hidden', 'true')
  await expect(scope.locator('.ex-zoom'), `${label}：自繪圖示不能放大`).toHaveCount(0)
  await expect(scope.locator('img'), `${label}：沒有照片`).toHaveCount(0)
}

test('有氧動作的縮圖：拳擊是手套圖示（不能放大、不印著作權標示），坡度健走有圖、能放大、印標示；徒手深蹲照舊單字', async ({ page }) => {
  await openApp(page, {}, { ...FIX, exercises: [...FIX.exercises, WALK, BOX, catalogRow('徒手深蹲')] })
  await openTraining(page)

  // 動作庫：兩個有氧動作的列
  await openLibrary(page)
  const libRow = (name: string) => library(page).locator('.tr-row').filter({ has: page.getByText(name, { exact: true }) })
  await expectGloveIcon(libRow('有氧拳擊'), '動作庫 有氧拳擊')
  await expect(libRow('跑步機坡度健走').getByRole('button', { name: '放大跑步機坡度健走的示意圖' })).toHaveCount(1)
  await imgLoaded(libRow('跑步機坡度健走').locator('img.ex-thumb'))
  const glove = (await libRow('有氧拳擊').locator('.ex-thumb').boundingBox())!
  const walkImg = (await libRow('跑步機坡度健走').locator('img.ex-thumb').boundingBox())!
  expect([glove.width, glove.height], '圖示方塊與照片縮圖同尺寸（列表 52px）').toEqual([walkImg.width, walkImg.height])
  const svg = (await libRow('有氧拳擊').locator('.ex-thumb svg').boundingBox())!
  expect(Math.abs(svg.x + svg.width / 2 - (glove.x + glove.width / 2)), '圖示水平置中').toBeLessThan(1)
  expect(Math.abs(svg.y + svg.height / 2 - (glove.y + glove.height / 2)), '圖示垂直置中').toBeLessThan(1)
  await library(page).getByRole('button', { name: '返回' }).click()
  await openTraining(page)

  await startBlank(page)
  const session = page.locator('[data-screen="training-session"]')

  // 加動作 sheet：拳擊是圖示、健走是放大鈕
  await page.locator('.tr-bottom .tr-secondary').click()
  const pickRow = (name: string) => page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: name })
  await expectGloveIcon(pickRow('有氧拳擊'), '加動作 有氧拳擊')
  await expect(pickRow('跑步機坡度健走').locator('.ex-zoom img.ex-thumb')).toHaveCount(1)
  await pickRow('有氧拳擊').click()
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)

  // 訓練中的有氧卡：手套在名稱鈕裡（點它＝開有氧 sheet），畫面上沒有任何 Gym visual 的圖就不印標示
  const box = cardioCard(page, '有氧拳擊')
  await expect(box).toBeVisible()
  await expectGloveIcon(box, '有氧卡 有氧拳擊')
  await expect(box.locator('.ex-toggle .ex-thumb.is-icon')).toHaveCount(1)
  const cardGlove = (await box.locator('.ex-thumb').boundingBox())!
  expect([cardGlove.width, cardGlove.height], '卡片頭縮圖 40px').toEqual([40, 40])
  const cardSvg = (await box.locator('.ex-thumb svg').boundingBox())!
  expect([cardSvg.width, cardSvg.height], '圖示占方塊 60%（40px 裡 24px）').toEqual([24, 24])
  await expect(credit(session), '自繪圖示不是 Gym visual 的圖，不印').toHaveCount(0)

  // 資料集沒有對應圖的重訓預設動作：照舊是名稱鈕裡的肌群單字
  await addExercise(page, '徒手深蹲')
  const squat = page.locator('.ex', { hasText: '徒手深蹲' })
  await expect(squat.locator('.ex-thumb')).toHaveCount(1)
  await expect(squat.locator('.ex-toggle .ex-thumb.is-glyph')).toHaveText('腿')
  await expect(squat.locator('.ex-toggle .ex-thumb svg')).toHaveCount(0)
  await expect(squat.locator('.ex-zoom')).toHaveCount(0)
  await expect(credit(session)).toHaveCount(0)

  // 坡度健走：縮圖是名稱鈕外的放大鈕（只有一個縮圖，名稱鈕裡沒有第二個），著作權標示這時才出現
  await addCardio(page, '跑步機坡度健走')
  const walk = cardioCard(page, '跑步機坡度健走')
  await expect(walk.locator('.ex-thumb'), '只有一個縮圖（不是放大鈕外一個、名稱鈕裡又一個）').toHaveCount(1)
  await expect(walk.locator('.ex-head > .ex-zoom img.ex-thumb')).toHaveCount(1)
  await expect(walk.locator('.ex-toggle .ex-thumb')).toHaveCount(0)
  expect(await walk.locator('img.ex-thumb').getAttribute('src')).toMatch(/\/assets\/incline-walk-[\w-]+\.jpg$/)
  await imgLoaded(walk.locator('img.ex-thumb'))
  await expect(credit(session)).toHaveText(CREDIT)

  // 點縮圖只放大（Gym visual 的動畫），不開有氧 sheet
  const zoom = walk.getByRole('button', { name: '放大跑步機坡度健走的示意圖' })
  await zoom.click()
  await expect(viewer(page)).toBeVisible()
  await expect(cardioSheet(page), '點縮圖不該同時開有氧 sheet').toHaveCount(0)
  const gif = viewer(page).locator('img')
  expect(await gif.getAttribute('src')).toMatch(/\/assets\/incline-walk-[\w-]+\.gif$/)
  expect(await gif.getAttribute('alt')).toBe('跑步機坡度健走示意動畫')
  await expect.poll(() => gif.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth), { timeout: 10_000 }).toBe(180)
  await expect(viewer(page).locator('.ex-viewer-credit')).toHaveText(CREDIT)
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
  await expect(zoom).toBeFocused()
})

test('課表編輯的有氧動作：拳擊是手套圖示、健走的縮圖能放大', async ({ page }) => {
  await openApp(page, {}, { ...CARDIO_LIB, exercises: [WALK, BOX] })
  await openTraining(page)
  await newRoutine(page, '有氧日')
  for (const name of ['有氧拳擊', '跑步機坡度健走']) {
    await page.locator('[data-action="add-routine-exercise"]').click()
    await page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: name }).click()
    await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
  }
  const rows = editor(page).locator('[data-section="routine-exercises"] li.tr-row')
  await expect(rows).toHaveCount(2)
  await expectGloveIcon(rows.nth(0), '課表 有氧拳擊')
  await expect(credit(editor(page)), '健走有圖，標示照印').toHaveText(CREDIT)
  await rows.nth(1).getByRole('button', { name: '放大跑步機坡度健走的示意圖' }).click()
  await expect(viewer(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
  await expect(targetSheet(page)).toHaveCount(0)
})

test('只有有氧拳擊的課表：自繪圖示不算 Gym visual 的圖，課表編輯不印著作權標示', async ({ page }) => {
  await openApp(page, {}, { ...CARDIO_LIB, exercises: [BOX] })
  await openTraining(page)
  await newRoutine(page, '拳擊日')
  await page.locator('[data-action="add-routine-exercise"]').click()
  await page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: '有氧拳擊' }).click()
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
  await expectGloveIcon(editor(page).locator('[data-section="routine-exercises"] li.tr-row'), '課表 有氧拳擊')
  await expect(credit(editor(page))).toHaveCount(0)
})

test('393 寬：健走摘要放不下一行時折行、不截斷——全文都在、沒有省略號、卡片頭不橫向溢出', async ({ page }) => {
  await openApp(page, {}, WALK_HIST)
  await openTraining(page)
  await startBlank(page)
  await addCardio(page, '跑步機坡度健走')
  await openCardioSheet(page, '跑步機坡度健走') // 速度坡度已預填，分鐘要自己填
  await cardioField(page, '分鐘').fill('30')
  await saveCardio(page)
  const card = cardioCard(page, '跑步機坡度健走')
  const sum = card.locator('.cardio-sum')
  await expect(sum).toHaveText('30 分 · 5.5 km/h · 坡度 8%')

  // .cardio-sum 是 .sub（flex）的子項，有自己的寬度；它、.sub、卡片頭都不能有被藏起來的溢出
  const boxes = await sum.evaluate((el) =>
    [el, el.parentElement!, el.closest('.ex-head')!].map((n) => ({
      cls: n.className,
      hidden: n.scrollWidth - n.clientWidth,
      textOverflow: getComputedStyle(n).textOverflow,
    })),
  )
  for (const b of boxes) {
    expect(b.textOverflow, `${b.cls} 不該用省略號`).not.toBe('ellipsis')
    expect(b.hidden, `${b.cls} 沒有被截掉的寬度`).toBeLessThanOrEqual(0)
  }
  const cardBox = (await card.boundingBox())!
  for (const sel of ['.ex-toggle .chev', '.ex-swap', '[aria-label$="的更多操作"]']) {
    const box = (await card.locator(sel).boundingBox())!
    expect(box.x + box.width, `${sel} 要在卡片右緣之內`).toBeLessThanOrEqual(cardBox.x + cardBox.width)
  }
})

test('課表裡的有氧動作：編輯頁那列沒有預設組次、點了不開預設組次 sheet；target_sets 照預設存 3', async ({ page }) => {
  await openApp(page, {}, CARDIO_LIB)
  await openTraining(page)
  await newRoutine(page, '有氧日')
  for (const name of ['腿推舉', '跑步機坡度健走']) {
    await page.locator('[data-action="add-routine-exercise"]').click()
    await page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: name }).click()
    await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
  }
  const rows = editor(page).locator('[data-section="routine-exercises"] li.tr-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).locator('.sub'), '重訓照舊有預設組次').toHaveText('沒做過時預設 3 組')
  await expect(rows.nth(1)).toContainText('跑步機坡度健走')
  await expect(rows.nth(1).locator('.sub'), '有氧沒有預設組次').toHaveCount(0)
  await expect(rows.nth(1).getByRole('button', { name: /改預設組次/ })).toHaveCount(0)

  await rows.nth(1).locator('.tr-row-main').click()
  await page.waitForTimeout(500) // 沒有事件可等的反向斷言：sheet 若會開，這段時間內就開了
  await expect(targetSheet(page)).toHaveCount(0)
  await expect
    .poll(async () => (await trainRows(page, 'routine_exercises')).map((r) => [r.exercise_id, r.position, r.target_sets, r.target_reps]))
    .toEqual([
      [EX_ID, 0, 3, null],
      [WALK.id, 1, 3, null],
    ])
})

test('從課表開始訓練：有氧動作帶出有氧卡（沒有組），速度與坡度預填上次的值、分鐘留空', async ({ page }) => {
  await openApp(page, {}, {
    ...WALK_HIST,
    routines: [{ id: 'r-c', name: '有氧日', archived: false, created_at: '2026-10-01T00:00:00.000Z' }],
    routine_exercises: [
      { id: 're-c1', routine_id: 'r-c', exercise_id: EX_ID, position: 0, target_sets: 2, target_reps: 10, created_at: '2026-10-01T00:00:01.000Z' },
      { id: 're-c2', routine_id: 'r-c', exercise_id: WALK.id, position: 1, target_sets: 3, target_reps: null, created_at: '2026-10-01T00:00:02.000Z' },
    ],
  })
  await openTraining(page)
  await page.getByRole('button', { name: '開始訓練' }).click()
  await page.locator('[data-screen="start-sheet"] [data-routine-id="r-c"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()

  await expect(page.locator('.ex .nm')).toHaveText(['腿推舉', '跑步機坡度健走'])
  await expect(page.locator('.ex', { hasText: '腿推舉' }).locator('.set'), '腿推舉沒做過：課表的 2 組').toHaveCount(2)
  const walk = cardioCard(page, '跑步機坡度健走')
  await expect(walk.locator('.set')).toHaveCount(0)
  // 課表帶出來那天不一定有做：分鐘留空，沒填就不算記錄（不會留下「30 分」的假記錄）
  await expect(walk.locator('.sub .is-missing')).toHaveText('點一下填寫')

  await expect
    .poll(async () => (await trainRows(page, 'workout_exercises')).find((r) => r.exercise_id === WALK.id && r.id !== 'we-h'))
    .toMatchObject({ position: 1, minutes: null, speed_kmh: 5.5, incline_pct: 8, est_kcal: null })
  const walkEntry = (await trainRows(page, 'workout_exercises')).find((r) => r.exercise_id === WALK.id && r.id !== 'we-h')!
  await expect.poll(async () => (await trainRows(page, 'workout_sets')).length, { message: '只有腿推舉的 2 組' }).toBe(2)
  expect((await trainRows(page, 'workout_sets')).filter((s) => s.workout_exercise_id === walkEntry.id)).toHaveLength(0)

  await openCardioSheet(page, '跑步機坡度健走')
  await expect(cardioField(page, '分鐘')).toHaveValue('')
  await expect(cardioField(page, '分鐘')).toHaveAttribute('placeholder', '上次 30')
  await expect(cardioField(page, '速度 km/h')).toHaveValue('5.5')
  await expect(cardioField(page, '坡度 %')).toHaveValue('8')
})

/** 進行中的訓練裡一張「有氧動作卻有組」的卡：三組 0×0、第 1 組打過勾。兩條路徑會造出這種卡——舊版 App 把有氧當重訓加進來、
 *  照課表開訓時動作還沒載到本機底（addExerciseOps 找不到動作那列，當重訓產組）。 */
const CARDIO_WITH_SETS: typeof FIX = {
  ...CARDIO_LIB,
  workouts: [{ id: 'w-cs', performed_on: TODAY, started_at: `${TODAY}T01:00:00.000Z`, ended_at: null, routine_id: null }],
  workout_exercises: [{ id: 'we-cs', workout_id: 'w-cs', exercise_id: WALK.id, position: 0 }],
  workout_sets: [
    { id: 'cs-1', workout_exercise_id: 'we-cs', set_no: 1, weight_kg: 0, reps: 0, done: true },
    { id: 'cs-2', workout_exercise_id: 'we-cs', set_no: 2, weight_kg: 0, reps: 0, done: false },
    { id: 'cs-3', workout_exercise_id: 'we-cs', set_no: 3, weight_kg: 0, reps: 0, done: false },
  ],
}

test('有氧動作卻有組的卡：退回重訓的畫法——組看得到、刪得掉，打過勾的組移除前照樣先問', async ({ page }) => {
  await openApp(page, {}, CARDIO_WITH_SETS)
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-cs"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()

  const card = page.locator('.ex', { hasText: '跑步機坡度健走' })
  await expect(card).not.toHaveClass(/is-cardio/)
  await expect(card.locator('.ex-toggle'), '一進來就展開（第一張重訓畫法的卡）').toHaveAttribute('aria-expanded', 'true')
  await expect(card.locator('.set')).toHaveCount(3)
  await expect(stat(page, 'sets')).toHaveText('1/3')

  // 沒打勾的第 3 組：組編輯 sheet 直接刪
  await openSetSheet(page, 2)
  await setSheet(page).getByRole('button', { name: '刪除這一組' }).click()
  await expect(setSheet(page)).toHaveCount(0)
  await expect(card.locator('.set')).toHaveCount(2)
  await expect.poll(async () => (await trainRows(page, 'workout_sets')).map((s) => s.id).sort()).toEqual(['cs-1', 'cs-2'])

  // 第 1 組打過勾：移除前先問，文案是重訓的（不是「記下的有氧」）
  await card.getByRole('button', { name: '跑步機坡度健走 的更多操作' }).click()
  await page.getByRole('menuitem', { name: '移除這個動作' }).click()
  const dialog = page.getByRole('alertdialog', { name: '移除這個動作？' })
  await expect(dialog.locator('.tr-dialog-body')).toHaveText('這個動作已經打勾的組會一起刪掉。')
  await dialog.getByRole('button', { name: '先不要' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(card.locator('.set')).toHaveCount(2)
})
