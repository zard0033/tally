/* 未同步 sheet（D 段）：點同步細條開，講清楚卡在哪一種原因、能做什麼。
   原因分四種（離線／被拒絕／等父列／登入失效）加上別的帳號的殘留，各一條；放棄走確認框，數的是「列」不是條目。
   fetch 全 stub；4xx 用 stub 的 `__rejectWrite`（持久拒絕），離線用 `__dataDown`。
   佇列的內容直接讀 IndexedDB（tally／kv／QUEUE_STORAGE_KEY）——畫面說「沒了」不等於真的沒了，要看儲存層。
   文案只斷言關鍵字（計數＋原因詞）：整句釘死的話，改一個標點就要同步改一排測試；完整文案只留一條。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'
import { FIX, TODAY, USER_ID } from './fixtures'
import { QUEUE_STORAGE_KEY } from '../src/lib/queueStore'

const EX_ID = '11111111-1111-4111-8111-111111111111'

/** 今天有一次已結束的訓練（2 組）：加同一個動作時預填 2 組，開出來的新訓練＝1 訓練＋1 動作＋2 組。 */
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

type SyncWindow = {
  __dataDown: boolean
  __rejectWrite: Record<string, number> | null
  __writes: { table: string; method: string }[]
  __trainRows: (table: string) => Record<string, unknown>[]
}

const trainRows = (page: Page, table: string) =>
  page.evaluate((t) => (window as unknown as SyncWindow).__trainRows(t), table)
const rejectWrites = (page: Page, map: Record<string, number> | null) =>
  page.evaluate((m) => {
    ;(window as unknown as SyncWindow).__rejectWrite = m
  }, map)
const postsTo = (page: Page, table: string) =>
  page.evaluate(
    (t) => (window as unknown as SyncWindow).__writes.filter((w) => w.table === t && w.method === 'POST').length,
    table,
  )
/** 只翻旗標、不送 online 事件：留給測試自己決定回線後是「按立即重試」還是「等自動同步」。 */
const dataDown = (page: Page, down: boolean) =>
  page.evaluate((d) => {
    ;(window as unknown as SyncWindow).__dataDown = d
  }, down)
const fireOnline = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')))

/* ── 佇列的儲存層（idb-keyval：資料庫 tally、store kv、key＝QUEUE_STORAGE_KEY） ── */

interface StoredEntry {
  seq: number
  op: string
  userId: string
  table: string
  rowId: string
  failure: string | null
}

const queueEntries = (page: Page) =>
  page.evaluate(
    (key) =>
      new Promise<StoredEntry[]>((resolve, reject) => {
        const open = indexedDB.open('tally')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const get = db.transaction('kv').objectStore('kv').get(key)
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            db.close()
            resolve((get.result?.entries ?? []) as StoredEntry[])
          }
        }
      }),
    QUEUE_STORAGE_KEY,
  )

/** 直接塞一份佇列進儲存層。App 的佇列開了跨分頁鎖，每次操作都重讀儲存，所以塞完下一輪同步就讀得到。 */
const seedQueue = (page: Page, snapshot: unknown) =>
  page.evaluate(
    ([snap, key]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('tally')
        // 比照 idb-keyval：App 若還沒建過這個庫，這裡建出來的形狀要跟它一樣（store 名 kv、無 keyPath）
        open.onupgradeneeded = () => open.result.createObjectStore('kv')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('kv', 'readwrite')
          tx.objectStore('kv').put(snap, key)
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    [snapshot, QUEUE_STORAGE_KEY] as const,
  )

/* ── 畫面 ── */

const statusBar = (page: Page) => page.locator('[data-screen="training"] .tr-status')
const sheet = (page: Page) => page.locator('[data-screen="sync-sheet"]')
const lines = (page: Page) => sheet(page).locator('.sync-line')
const rejectedRows = (page: Page) => sheet(page).locator('[data-section="sync-rejected"] .tr-row')

async function openTraining(page: Page) {
  await page.locator('.tab[aria-label="訓練"]').click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
}

async function startBlank(page: Page) {
  await page.getByRole('button', { name: '開始訓練' }).click()
  await page.locator('[data-action="start-blank"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
}

async function addExercise(page: Page, name: string) {
  await page.locator('.tr-bottom .tr-secondary').click()
  await page.locator('[data-screen="exercise-picker"] .tr-row', { hasText: name }).click()
  await expect(page.locator('.ex .set').first()).toBeVisible()
  await expect(page.locator('[data-screen="exercise-picker"]')).toHaveCount(0)
}

const backToList = (page: Page) => page.getByRole('button', { name: '返回（訓練繼續進行）' }).click()

async function openSheet(page: Page) {
  await statusBar(page).click()
  await expect(sheet(page)).toBeVisible()
}

/** 離線開一次空白訓練（佇列 1 條 insert），回到清單。 */
async function recordOffline(page: Page) {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await dataDown(page, true)
  await startBlank(page)
  await backToList(page)
  await expect(statusBar(page)).toContainText('1 筆尚未同步')
}

/** 伺服器一律拒絕新增訓練（409）：開空白訓練、加腿推舉（預填 2 組）。佇列＝訓練 insert（rejected）
 *  ＋動作 insert＋2 組 insert（都在等訓練）。`tickFirst`：再打勾第一組，多一條 update——
 *  條目 5 條、但列只有 4 列（1 訓練＋1 動作＋2 組），用來區分「數列」與「數條目」。 */
async function rejectedWorkout(page: Page, tickFirst = false) {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await rejectWrites(page, { workouts: 409 })
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await expect(page.locator('.ex .set')).toHaveCount(2)
  if (tickFirst) await page.locator('.ex .set').first().locator('.tr-check').click()
  await backToList(page)
  // 訓練的 insert 真的被送出並被拒絕之後，佇列才有「被拒絕」的條目；等儲存層而不是等時間
  await expect.poll(async () => (await queueEntries(page)).filter((e) => e.failure === 'rejected').length).toBe(1)
  await expect(statusBar(page)).toContainText(`${tickFirst ? 5 : 4} 筆尚未同步`)
}

/* ═══════════ 1. 離線 ═══════════ */

test('離線記一筆：細條可點，sheet 講離線並給「立即重試」；回線後按立即重試，細條消失、sheet 自己收起來（v2.104）', async ({
  page,
}) => {
  await recordOffline(page)
  await expect(statusBar(page)).toHaveClass(/is-action/)

  /* role=status 必須在**外層**（照 food-library 封存提示的前例）：掛在 button 上會取代按鈕的隱含 role，
     讀屏就找不到入口。外層固定、內層是沒被覆寫 role 的 button，名稱就是可見文字（沒有 aria-label 蓋掉內文）。 */
  const wrap = page.locator('[data-screen="training"] .tr-status-wrap')
  await expect(wrap, '細條對螢幕閱讀器沒有播報').toHaveAttribute('role', 'status')
  await expect(wrap).toHaveAttribute('aria-live', 'polite')
  expect(await statusBar(page).evaluate((el) => el.tagName), '細條不是 button 了').toBe('BUTTON')
  expect(await statusBar(page).evaluate((el) => el.getAttribute('role')), 'role 又掛回 button 上').toBeNull()
  expect(await statusBar(page).evaluate((el) => el.getAttribute('aria-label')), 'aria-label 會蓋掉可見內文').toBeNull()
  await expect(wrap.getByRole('button', { name: /1 筆尚未同步/ })).toBeVisible()
  await expect(statusBar(page)).toHaveAccessibleDescription('查看詳情')

  await openSheet(page)
  await expect(lines(page).filter({ hasText: '因為離線還沒上傳' })).toHaveText('1 筆因為離線還沒上傳，回到網路後會自動上傳。')
  await expect(sheet(page).getByRole('button', { name: '立即重試' })).toBeVisible()
  await expect(sheet(page).getByText('全部都已同步')).toHaveCount(0)
  expect(await trainRows(page, 'workouts'), '離線時伺服器還沒收到').toHaveLength(1)

  // 只翻旗標、不送 online：確認「立即重試」自己就夠，不是靠自動同步撿回來的
  await dataDown(page, false)
  await sheet(page).getByRole('button', { name: '立即重試' }).click()
  await expect(sheet(page), '同步完 sheet 自己收起來，不用再按 ✕（v2.104）').toHaveCount(0)
  await expect(statusBar(page)).toHaveCount(0)
  expect(await trainRows(page, 'workouts'), '落地、不重複：fixture 1 ＋ 新的 1').toHaveLength(2)
  expect(await queueEntries(page)).toHaveLength(0)
})

test('離線記一筆：sheet 開著時網路回來，自動同步後 sheet 自己收起來、細條消失', async ({ page }) => {
  await recordOffline(page)
  await openSheet(page)
  await expect(lines(page).filter({ hasText: '因為離線還沒上傳' })).toHaveCount(1)

  await dataDown(page, false)
  await fireOnline(page)
  await expect(sheet(page)).toHaveCount(0, { timeout: 15_000 })
  await expect(statusBar(page)).toHaveCount(0)
  expect(await trainRows(page, 'workouts')).toHaveLength(2)
})

/* ═══════════ 2. 被拒絕 ═══════════ */

test('被拒絕：逐條列出白話標籤與「放棄這筆」，文案不叫人丟掉', async ({ page }) => {
  await rejectedWorkout(page)
  await openSheet(page)

  await expect(rejectedRows(page)).toHaveCount(1)
  await expect(rejectedRows(page).locator('.nm')).toHaveText('新增訓練')
  await expect(rejectedRows(page).getByRole('button', { name: '放棄這筆：新增訓練' })).toHaveText('放棄這筆')
  const rejectedLine = lines(page).filter({ hasText: '被伺服器拒絕' })
  await expect(rejectedLine).toContainText('1 筆被伺服器拒絕')
  await expect(rejectedLine, '不承諾計時重試').not.toContainText('每次同步都會')
  await expect(rejectedLine).toContainText('下次同步')
  await expect(sheet(page).getByText(/丟|刪掉|捨棄/), '文案不能叫人丟掉').toHaveCount(0)
})

test('放棄被拒絕的訓練：確認框說另有幾「列」一起消失（不是幾條）；先不要不動；放棄後該條與連帶條目都消失', async ({
  page,
}) => {
  await rejectedWorkout(page, true)
  expect(await queueEntries(page), '前提：5 條（訓練＋動作＋2 組的 insert，再加一組的打勾 update）').toHaveLength(5)
  await openSheet(page)
  await rejectedRows(page).getByRole('button', { name: '放棄這筆：新增訓練' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('放棄這筆變更？')
  await expect(dialog).toContainText('「新增訓練」不會再上傳，放棄後找不回來。')
  // 連帶的是 1 動作＋2 組＝3 列；條目有 4 條（被打勾那組多一條 update）。數到 4 就是數錯了單位
  await expect(dialog).toContainText('另有 3 筆會一起消失。')

  await dialog.getByRole('button', { name: '先不要' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(sheet(page), '按「先不要」不該關 sheet').toBeVisible()
  await expect(rejectedRows(page)).toHaveCount(1)
  expect(await queueEntries(page), '按「先不要」佇列原樣').toHaveLength(5)

  await rejectedRows(page).getByRole('button', { name: '放棄這筆：新增訓練' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '放棄', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(sheet(page), '放棄到佇列清空：sheet 自己收起來').toHaveCount(0)
  await expect(rejectedRows(page)).toHaveCount(0)
  await expect(statusBar(page), '細條跟著更新：沒有未同步的了').toHaveCount(0)
  expect(await queueEntries(page), '連帶的動作、組與打勾的 update 一起消失').toHaveLength(0)
  expect(await trainRows(page, 'workouts'), '放棄不會動到伺服器').toHaveLength(1)
})

test('放棄沒有連帶子列的那一條：確認框不提「另有」，其他被拒絕的條目不受影響', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await rejectWrites(page, { workout_sets: 409 }) // 訓練與動作送得上去，兩組被拒；組底下沒有子列
  await startBlank(page)
  await addExercise(page, '腿推舉')
  await backToList(page)
  await expect.poll(async () => (await queueEntries(page)).filter((e) => e.failure === 'rejected').length).toBe(2)

  await openSheet(page)
  await expect(rejectedRows(page)).toHaveCount(2)
  // 兩個都叫「記一組」：列上加「第 N 個」，放棄鈕的名稱才分得出是哪一個
  await expect(rejectedRows(page).locator('.nm')).toHaveText(['記一組（第 1 個）', '記一組（第 2 個）'])
  await rejectedRows(page).getByRole('button', { name: '放棄這筆：記一組（第 1 個）' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('「記一組（第 1 個）」不會再上傳')
  await expect(dialog).not.toContainText('另有')
  await dialog.getByRole('button', { name: '放棄', exact: true }).click()
  await expect(rejectedRows(page)).toHaveCount(1)
  expect((await queueEntries(page)).filter((e) => e.table === 'workout_sets')).toHaveLength(1)
  // 剩下的那個不再有同標籤的夥伴：序號後綴跟著消失
  await expect(rejectedRows(page).locator('.nm')).toHaveText(['記一組'])
})

test('被拒絕的訓練又按了完成訓練：放棄新增訓練時，那條 update 一起走，佇列清空、細條消失、不會變成新的被拒絕', async ({
  page,
}) => {
  await rejectedWorkout(page)
  // 回到進行中的那次訓練、完成它：workouts 多一條 update（排在被拒絕的 insert 後面，同一列，送不出去）
  await page.locator('.tr-sec:has-text("進行中") + .tr-card .tr-row').click()
  await page.getByRole('button', { name: '完成訓練' }).click()
  await page.locator('[data-screen="finish-sheet"]').getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
  await expect
    .poll(async () => (await queueEntries(page)).filter((e) => e.table === 'workouts').map((e) => e.op))
    .toEqual(['insert', 'update'])

  await openSheet(page)
  await rejectedRows(page).getByRole('button', { name: '放棄這筆：新增訓練' }).click()
  const dialog = page.getByRole('alertdialog')
  // 連帶的是 1 動作＋2 組＝3 列；同一列的 update 不算「另有」
  await expect(dialog).toContainText('另有 3 筆會一起消失')
  await dialog.getByRole('button', { name: '放棄', exact: true }).click()

  await expect(sheet(page)).toHaveCount(0)
  await expect(statusBar(page)).toHaveCount(0)
  await page.waitForTimeout(500) // 放棄之後會馬上跑一輪送出；殘留的 update 若沒走，這段時間內會被送出並被拒絕
  expect(await queueEntries(page), '連 update 都不剩').toHaveLength(0)
  const patches = await page.evaluate(
    () => (window as unknown as SyncWindow).__writes.filter((w) => w.table === 'workouts' && w.method === 'PATCH').length,
  )
  expect(patches, '那條 update 從頭到尾沒送出過，也就不會變成新的被拒絕').toBe(0)
  await expect(rejectedRows(page)).toHaveCount(0)
})

/* ═══════════ 3. 等父列 ═══════════ */

test('父列被拒絕時，底下的動作與組在 sheet 顯示「在等前面那筆送出去」的計數，且不列進被拒絕的清單', async ({ page }) => {
  await rejectedWorkout(page)
  await openSheet(page)
  await expect(lines(page).filter({ hasText: '在等前面那筆' })).toContainText('3 筆在等前面那筆')
  await expect(rejectedRows(page), '子列沒有自己的錯誤，不該被列成「被拒絕」').toHaveCount(1)
  await expect(sheet(page).getByText(/筆等著上傳/), '等父列的不算「等著上傳」').toHaveCount(0)
  expect(await postsTo(page, 'workout_exercises'), '父列沒到，子列一條都沒送').toBe(0)
  expect(await postsTo(page, 'workout_sets')).toBe(0)
})

/* ═══════════ 4. 登入失效 ═══════════ */

test('伺服器回 401：sheet 說登入已失效、資料都還在；沒有登入按鈕，佇列沒被清掉', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await rejectWrites(page, { workouts: 401 })
  await startBlank(page)
  await backToList(page)
  await expect.poll(async () => (await queueEntries(page)).filter((e) => e.failure === 'auth').length).toBe(1)

  await openSheet(page)
  await expect(lines(page).filter({ hasText: '登入已失效' })).toContainText('1 筆因為登入已失效')
  await expect(lines(page).filter({ hasText: '登入已失效' })).toContainText('重新登入後')
  await expect(sheet(page).getByRole('button', { name: /登入/ }), '只給文字，不放登入鈕').toHaveCount(0)
  await expect(sheet(page).getByRole('link', { name: /登入/ })).toHaveCount(0)
  await expect(rejectedRows(page), '401 不是「被拒絕」，不給放棄鈕').toHaveCount(0)
  await expect(sheet(page).getByRole('button', { name: '立即重試' })).toBeVisible()
  expect(await queueEntries(page), '佇列還在').toHaveLength(1)
  await expect(statusBar(page)).toContainText('1 筆尚未同步')
})

test('401 且另有還沒送的條目：不說「會自動送出」，語意併進「重新登入後會繼續上傳」', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await rejectWrites(page, { workouts: 401 })
  const entry = (seq: number, rowId: string) => ({
    seq,
    op: 'insert',
    table: 'workouts',
    rowId,
    payload: { performed_on: TODAY, started_at: `${TODAY}T07:00:00.000Z`, ended_at: null, routine_id: null },
    userId: USER_ID,
    createdAt: seq,
    attempts: 0,
    lastError: null,
    failure: null,
  })
  // 兩條互不相干的新增：第一條 401 後整輪中止，第二條沒被試過（pending）
  await seedQueue(page, { nextSeq: 3, entries: [entry(1, 'w-a'), entry(2, 'w-b')] })
  await fireOnline(page)
  await expect.poll(async () => (await queueEntries(page)).filter((e) => e.failure === 'auth').length).toBe(1)

  await openSheet(page)
  await expect(lines(page).filter({ hasText: '登入已失效' })).toContainText('1 筆因為登入已失效')
  await expect(sheet(page).getByText('會自動送出'), '登入沒好之前不會自動送出').toHaveCount(0)
  await expect(sheet(page).getByText(/筆等著上傳/)).toHaveCount(0)
})

/* ═══════════ 5. 確認框的 Escape 與連點 ═══════════ */

test('立即重試進行中：只鎖重試鈕（顯示重試中…），不擋關閉 sheet', async ({ page }) => {
  await recordOffline(page)
  await openSheet(page)
  const retry = sheet(page).getByRole('button', { name: '立即重試' })
  // 只讓出 microtask（React 在那時更新畫面）就讀鈕、送 Escape：重試要走佇列的鎖與 IndexedDB（都是 macrotask），一定還沒結束
  const during = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('[data-screen="sync-sheet"] button')].find(
      (b) => b.textContent === '立即重試',
    ) as HTMLButtonElement
    btn.click()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    const state = { disabled: btn.disabled, text: btn.textContent }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return state
  })
  expect(during).toEqual({ disabled: true, text: '重試中…' })
  await expect(sheet(page), '重試中也可以關閉').toHaveCount(0)
  await expect(retry).toHaveCount(0)
})

test('立即重試進行中：放棄鈕也鎖住（重送途中算出的連帶數會過時）', async ({ page }) => {
  await rejectedWorkout(page)
  await openSheet(page)
  const discardDisabled = await page.evaluate(async () => {
    const find = (name: string) =>
      [...document.querySelectorAll('[data-screen="sync-sheet"] button')].find(
        (b) => b.textContent === name || b.getAttribute('aria-label') === name,
      ) as HTMLButtonElement
    find('立即重試').click()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    return find('放棄這筆：新增訓練').disabled
  })
  expect(discardDisabled).toBe(true)
})

test('放棄確認框開著按 Escape：只關確認框，sheet 還在，佇列不動', async ({ page }) => {
  await rejectedWorkout(page)
  await openSheet(page)
  await rejectedRows(page).getByRole('button', { name: '放棄這筆：新增訓練' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(500) // sheet 若被連帶關掉，是在這段關閉動畫內消失
  await expect(sheet(page), 'Escape 只該關確認框').toBeVisible()
  await expect(rejectedRows(page)).toHaveCount(1)
  expect(await queueEntries(page)).toHaveLength(4)

  // 再按一次（這回沒有確認框）才是關 sheet
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toHaveCount(0)
})

test('在確認框上連點「放棄」：只放棄那一條、沒有錯誤訊息（v2.104 起佇列清空 sheet 會自己收，連點穿透關 sheet 的檢查失去鑑別力，拿掉）', async ({ page }) => {
  await rejectedWorkout(page)
  await openSheet(page)
  await rejectedRows(page).getByRole('button', { name: '放棄這筆：新增訓練' }).click()
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: '放棄', exact: true })
  await expect(confirm).toBeVisible()

  await confirm.click({ clickCount: 2, delay: 0 })
  await expect(sheet(page)).toHaveCount(0)
  await page.waitForTimeout(500)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await queueEntries(page)).toHaveLength(0)
})

/* ═══════════ 6. 別的帳號 ═══════════ */

test('佇列裡有別的帳號的條目：細條說另有幾筆屬於別的帳號，sheet 有對應一句；不上傳、不被動到', async ({ page }) => {
  await openApp(page, {}, WITH_WORKOUT)
  await openTraining(page)
  await expect(statusBar(page)).toHaveCount(0)

  await seedQueue(page, {
    nextSeq: 2,
    entries: [
      {
        seq: 1,
        op: 'insert',
        table: 'workouts',
        rowId: 'w-other',
        payload: { performed_on: TODAY, started_at: `${TODAY}T07:00:00.000Z`, ended_at: null, routine_id: null },
        userId: '99999999-9999-4999-8999-999999999999',
        createdAt: 1,
        attempts: 0,
        lastError: null,
        failure: null,
      },
    ],
  })
  await fireOnline(page) // 觸發一輪同步，畫面重讀佇列

  await expect(statusBar(page)).toHaveText('另有 1 筆屬於別的帳號')
  await expect(statusBar(page), '只有別人的條目也可點').toHaveClass(/is-action/)
  await openSheet(page)
  await expect(lines(page)).toContainText(['另有 1 筆屬於別的帳號'])
  await expect(sheet(page).getByRole('button', { name: '立即重試' }), '沒有自己的條目，不給重試').toHaveCount(0)
  await expect(rejectedRows(page)).toHaveCount(0)

  await page.waitForTimeout(500)
  expect(await postsTo(page, 'workouts'), '別人的條目不該被這個帳號送出').toBe(0)
  expect(await queueEntries(page), '也不該被清掉').toHaveLength(1)
})
