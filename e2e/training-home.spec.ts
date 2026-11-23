/* 訓練分頁改版 v2.160（spec.md「訓練分頁改版」節末 AC）：天空大字四態、首頁只放這天（課表／分析搬進子頁）、開始選項的建議與排序、
   結束確認 sheet、完成畫面、卡頭 1RM、「訓練中」小條、飲食頂端提示。休息倒數相關的小條跳時間放 rest-timer.spec（page.clock）。
   fetch 全 stub；寫入不落地（畫面讀的是疊在佇列上的本機資料），要驗「有沒有寫」讀 window.__writes。
   恢復狀態跟著真實時間算：開始選項那幾條的訓練日期用 TODAY 往回推，不用固定日期；完成畫面的「本週第 N 次」要固定星期，走 openAppAt。 */
import { test, expect, type Page } from '@playwright/test'
import { gotoDate, openApp, openAppAt, shiftIso } from './harness'
import { FIX, TODAY } from './fixtures'

test.describe.configure({ mode: 'parallel' })

const CHEST = '11111111-1111-4111-8111-111111111111'
const BACK = '22222222-2222-4222-8222-222222222222'
const LEGS = '33333333-3333-4333-8333-333333333333'
const ex = (id: string, name: string, muscle_group: string) => ({ id, name, muscle_group, tips: null, archived: false, created_at: '2026-10-01T00:00:00.000Z' })
const EXERCISES = [ex(CHEST, '槓鈴臥推', 'chest'), ex(BACK, '滑輪下拉', 'back'), ex(LEGS, '腿推舉', 'legs')]
const routine = (id: string, name: string, n: number) => ({ id, name, archived: false, created_at: `2026-10-0${n}T00:00:00.000Z` })
const routineEx = (id: string, routineId: string, exerciseId: string) => ({
  id,
  routine_id: routineId,
  exercise_id: exerciseId,
  position: 0,
  target_sets: 3,
  target_reps: 10,
  created_at: '2026-10-01T00:00:01.000Z',
})

/** 一次已結束的訓練：一個動作、sets 組 weight×reps（都打勾）。 */
function done(id: string, date: string, exerciseId: string, routineId: string | null, sets = 1, weight = 50, reps = 10) {
  return {
    workout: { id, performed_on: date, started_at: `${date}T02:00:00.000Z`, ended_at: `${date}T03:00:00.000Z`, routine_id: routineId },
    entry: { id: `${id}-e`, workout_id: id, exercise_id: exerciseId, position: 0 },
    sets: Array.from({ length: sets }, (_, i) => ({ id: `${id}-s${i}`, workout_exercise_id: `${id}-e`, set_no: i + 1, weight_kg: weight, reps, done: true })),
  }
}
function build(parts: ReturnType<typeof done>[], extra: Partial<typeof FIX> = {}): typeof FIX {
  return {
    ...FIX,
    exercises: EXERCISES,
    workouts: parts.map((p) => p.workout),
    workout_exercises: parts.map((p) => p.entry),
    workout_sets: parts.flatMap((p) => p.sets),
    ...extra,
  }
}

type Write = { table: string; method: string; body: unknown }
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: Write[] }).__writes)
/** 寫進 workouts 的 ended_at（不論 insert 或 update）。 */
const endedWrites = async (page: Page) =>
  (await writes(page)).filter((w) => w.table === 'workouts' && [w.body].flat().some((b) => (b as Record<string, unknown>)?.ended_at != null)).length

const hero = (page: Page) => page.locator('[data-screen="training"] .tr-hero')

async function openTraining(page: Page) {
  await page.locator('.tab[aria-label="訓練"]').click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
}

/* ═══════════ ① 天空大字四態 ═══════════ */

/** 今天有一次進行中的訓練（照「推日」開）：一個動作、三組都沒勾。 */
const LIVE: typeof FIX = {
  ...FIX,
  exercises: EXERCISES,
  routines: [routine('r-push', '推日', 1)],
  routine_exercises: [routineEx('re-p', 'r-push', CHEST)],
  workouts: [{ id: 'w-live', performed_on: TODAY, started_at: `${TODAY}T00:00:01.000Z`, ended_at: null, routine_id: 'r-push' }],
  workout_exercises: [{ id: 'we-live', workout_id: 'w-live', exercise_id: CHEST, position: 0 }],
  workout_sets: [1, 2, 3].map((n) => ({ id: `s-${n}`, workout_exercise_id: 'we-live', set_no: n, weight_kg: 60, reps: 10, done: false })),
}

test('天空大字・進行中：「訓練中」＋計時＋「繼續」，點了開回那次訓練整頁', async ({ page }) => {
  await openApp(page, {}, LIVE)
  await openTraining(page)
  await expect(hero(page)).toHaveAttribute('data-hero', 'live')
  await expect(hero(page).locator('.gauge-lead')).toHaveText('訓練中')
  await expect(hero(page).locator('.gauge-num')).toHaveText(/^\d+:\d{2}$/)
  await hero(page).locator('[data-action="resume"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toHaveAttribute('data-workout-id', 'w-live')
})

const DONE_A = done('w-a', TODAY, CHEST, null, 2, 60, 12) // 1,440 kg，60 分
const DONE_B = (() => {
  const b = done('w-b', TODAY, BACK, null, 1, 45, 10) // 450 kg，30 分
  b.workout.started_at = `${TODAY}T04:00:00.000Z`
  b.workout.ended_at = `${TODAY}T04:30:00.000Z`
  return b
})()

test('天空大字・練過：「練了 N kg」＋時長、組數', async ({ page }) => {
  await openApp(page, {}, build([DONE_A]))
  await openTraining(page)
  await expect(hero(page)).toHaveAttribute('data-hero', 'done')
  await expect(hero(page).locator('.gauge-lead')).toHaveText('練了')
  await expect(hero(page).locator('.gauge-num')).toHaveText('1,440')
  await expect(hero(page).locator('.gauge-side')).toHaveText('60 分 · 2 組')
})

test('天空大字・練過：一天兩次加總重量、時長、組數，並寫次數', async ({ page }) => {
  await openApp(page, {}, build([DONE_A, DONE_B]))
  await openTraining(page)
  await expect(hero(page).locator('.gauge-num')).toHaveText('1,890')
  await expect(hero(page).locator('.gauge-side')).toHaveText('90 分 · 3 組 · 2 次')
})

test('天空大字・今天沒練：適合練的肌群（最久沒練的排前、最多兩個）＋最快恢復的那個還要幾天', async ({ page }) => {
  await openApp(page, {}, START_FIX)
  await openTraining(page)
  await expect(hero(page)).toHaveAttribute('data-hero', 'idle-today')
  await expect(hero(page).locator('.gauge-lead')).toHaveText('今天適合練')
  await expect(hero(page).locator('.tr-hero-title')).toHaveText('胸部、背部')
  await expect(hero(page).locator('.gauge-side')).toHaveText(/^下半身還要約 [12] 天$/)
})

test('天空大字・今天沒練、從沒練過：「今天還沒練」', async ({ page }) => {
  await openApp(page)
  await openTraining(page)
  await expect(hero(page)).toHaveAttribute('data-hero', 'idle-today')
  await expect(hero(page).locator('.tr-hero-title')).toHaveText('今天還沒練')
  await expect(hero(page).locator('.gauge-lead')).toHaveCount(0)
})

test('天空大字・今天沒練、全在恢復：「今天休息一下」', async ({ page }) => {
  await openApp(page, {}, TIRED_FIX)
  await openTraining(page)
  await expect(hero(page).locator('.tr-hero-title')).toHaveText('今天休息一下')
  await expect(hero(page).locator('.gauge-lead'), '沒有適合練的就不寫「今天適合練」').toHaveCount(0)
})

test('天空大字・其他沒練的日子：「這天沒練」，下面不出開始選項', async ({ page }) => {
  await openApp(page, {}, START_FIX)
  await openTraining(page)
  await expect(page.locator('[data-section="start-options"]')).toBeVisible()
  await gotoDate(page, shiftIso(TODAY, -2))
  await expect(hero(page)).toHaveAttribute('data-hero', 'idle-other')
  await expect(hero(page).locator('.tr-hero-title')).toHaveText('這天沒練')
  await expect(page.locator('[data-section="start-options"]'), '開始選項只在今天').toHaveCount(0)
})

/* ═══════════ ② 首頁只放這天，課表／分析進子頁 ═══════════ */

test('首頁沒有課表清單、新課表與分析卡；天空右上「課表」「分析」各進子頁，返回回首頁', async ({ page }) => {
  await openApp(page, {}, START_FIX)
  await openTraining(page)
  const home = page.locator('[data-screen="training"]')
  await expect(home.locator('[data-section="routines"]')).toHaveCount(0)
  await expect(home.locator('[data-action="new-routine"]')).toHaveCount(0)
  await expect(home.locator('.tr-row[data-action="open-analysis"]'), '分析不是首頁的一列').toHaveCount(0)

  await page.getByRole('button', { name: '課表', exact: true }).click()
  const routines = page.locator('[data-screen="routines"]')
  await expect(routines).toBeVisible()
  await expect(page.locator('.bottom-bar'), '子頁接管畫面').toHaveCount(0)
  await expect(routines.locator('[data-action="new-routine"]')).toBeVisible()
  await expect(routines.locator('[data-section="routines"] .tr-row')).toHaveCount(3)
  await routines.getByRole('button', { name: '返回訓練' }).click()
  await expect(home).toBeVisible()

  await page.getByRole('button', { name: '訓練分析', exact: true }).click()
  await expect(page.locator('[data-screen="analysis"]')).toBeVisible()
  await page.getByRole('button', { name: '返回訓練' }).click()
  await expect(home).toBeVisible()
})

/* ═══════════ ③ 開始選項：建議與排序 ═══════════ */

/** 三份課表（建立順序：腿日、拉日、推日），各自上次在：推日 5 天前（胸部已恢復）、拉日 3 天前（背部已恢復）、腿日昨天（下半身還在恢復）。
 *  建議＝都恢復了的裡面最久沒做的＝推日；排第一，其餘照建立順序。 */
const START_FIX: typeof FIX = build(
  [
    done('w-c', shiftIso(TODAY, -5), CHEST, 'r-push'),
    done('w-b', shiftIso(TODAY, -3), BACK, 'r-pull'),
    done('w-l', shiftIso(TODAY, -1), LEGS, 'r-legs'),
  ],
  {
    routines: [routine('r-legs', '腿日', 1), routine('r-pull', '拉日', 2), routine('r-push', '推日', 3)],
    routine_exercises: [routineEx('re-l', 'r-legs', LEGS), routineEx('re-b', 'r-pull', BACK), routineEx('re-c', 'r-push', CHEST)],
  },
)

/** 全都在恢復：胸、背昨天各 10 組（窗口 48 小時）、腿前天 10 組（72 小時）。最久沒做的是腿日，照樣排第一但不標建議。 */
const TIRED_FIX: typeof FIX = build(
  [
    done('w-c', shiftIso(TODAY, -1), CHEST, 'r-push', 10),
    done('w-b', shiftIso(TODAY, -1), BACK, 'r-pull', 10),
    done('w-l', shiftIso(TODAY, -2), LEGS, 'r-legs', 10),
  ],
  {
    routines: [routine('r-push', '推日', 1), routine('r-pull', '拉日', 2), routine('r-legs', '腿日', 3)],
    routine_exercises: [routineEx('re-c', 'r-push', CHEST), routineEx('re-b', 'r-pull', BACK), routineEx('re-l', 'r-legs', LEGS)],
  },
)

const rowIds = (scope: ReturnType<Page['locator']>) => scope.locator('[data-routine-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-routine-id')))

test('今天沒練：首頁列課表當開始選項，建議的排第一、標「建議」，還在恢復的寫原因；開始 sheet 同一份排序與標註', async ({ page }) => {
  await openApp(page, {}, START_FIX)
  await openTraining(page)
  const opts = page.locator('[data-section="start-options"]')
  await expect(opts.locator('[data-routine-id]')).toHaveCount(3)
  expect(await rowIds(opts)).toEqual(['r-push', 'r-legs', 'r-pull'])
  await expect(opts.locator('[data-suggested]')).toHaveCount(1)
  await expect(opts.locator('[data-routine-id="r-push"]')).toHaveAttribute('data-suggested', 'true')
  await expect(opts.locator('[data-routine-id="r-push"] .tr-suggest')).toHaveText('建議')
  await expect(opts.locator('[data-routine-id="r-push"] .sub')).toHaveText(/^胸部 · 上次 \d+\/\d+$/)
  await expect(opts.locator('[data-routine-id="r-legs"] .sub')).toHaveText(/^下半身還要約 [12] 天 · 上次 \d+\/\d+$/)
  await expect(opts.locator('.tr-row.is-start')).toHaveCount(3)
  await expect(opts.locator('[data-action="start-blank-home"]')).toBeVisible()

  await page.getByRole('button', { name: '開始訓練' }).click()
  const sheet = page.locator('[data-screen="start-sheet"]')
  await expect(sheet).toBeVisible()
  expect(await rowIds(sheet)).toEqual(['r-push', 'r-legs', 'r-pull'])
  await expect(sheet.locator('[data-suggested]')).toHaveCount(1)
  await expect(sheet.locator('[data-routine-id="r-push"]')).toHaveAttribute('data-suggested', 'true')
})

test('全都在恢復：最久沒做的照樣排第一，但不標「建議」（首頁與開始 sheet 都一樣）', async ({ page }) => {
  await openApp(page, {}, TIRED_FIX)
  await openTraining(page)
  const opts = page.locator('[data-section="start-options"]')
  await expect(opts.locator('[data-routine-id]')).toHaveCount(3)
  expect(await rowIds(opts)).toEqual(['r-legs', 'r-push', 'r-pull'])
  await expect(opts.locator('[data-suggested]')).toHaveCount(0)

  await page.getByRole('button', { name: '開始訓練' }).click()
  const sheet = page.locator('[data-screen="start-sheet"]')
  await expect(sheet).toBeVisible()
  expect(await rowIds(sheet)).toEqual(['r-legs', 'r-push', 'r-pull'])
  await expect(sheet.locator('[data-suggested]')).toHaveCount(0)
})

test('點首頁的開始選項：照那份課表開一次訓練（訓練記下 routine_id）；空白開始那列開空白的', async ({ page }) => {
  await openApp(page, {}, START_FIX)
  await openTraining(page)
  await page.locator('[data-section="start-options"] [data-routine-id="r-push"]').click()
  const session = page.locator('[data-screen="training-session"]')
  await expect(session).toBeVisible()
  await expect(session.locator('.ex .nm')).toHaveText(['槓鈴臥推'])
  await expect
    .poll(async () => (await writes(page)).filter((w) => w.table === 'workouts' && w.method === 'POST').map((w) => [w.body].flat()[0]))
    .toEqual([expect.objectContaining({ routine_id: 'r-push', performed_on: TODAY })])

  await session.getByRole('button', { name: '刪除這次訓練' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '刪除', exact: true }).click()
  await page.locator('[data-action="start-blank-home"]').click()
  await expect(session).toBeVisible()
  await expect(session.locator('.ex')).toHaveCount(0)
})

/* ═══════════ ④ 結束確認 sheet ═══════════ */

test('結束確認：講還有幾組沒勾；「繼續練」不寫入、留在訓練中；「結束」才寫 ended_at、進完成畫面，「好」回訓練頁', async ({ page }) => {
  await openApp(page, {}, LIVE)
  await openTraining(page)
  await hero(page).locator('[data-action="resume"]').click()
  const check = (n: number) => page.locator('.ex .set').nth(n).locator('.tr-check')
  await check(0).click()
  await expect(check(0)).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '完成訓練' }).click()
  const sheet = page.locator('[data-screen="finish-sheet"]')
  await expect(sheet.getByRole('heading', { name: '結束這次訓練？' })).toBeVisible()
  await expect(sheet.getByTestId('finish-undone')).toHaveText('還有 2 組沒勾，沒勾的不算進紀錄')
  await sheet.getByRole('button', { name: '繼續練' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()

  // 再勾一組當屏障：佇列依序送，這筆落地時「繼續練」若有寫入也早該到了
  const setWrites = async () => (await writes(page)).filter((w) => w.table === 'workout_sets').length
  const before = await setWrites()
  await check(1).click()
  await expect.poll(setWrites).toBeGreaterThan(before)
  expect(await endedWrites(page), '「繼續練」不寫 ended_at').toBe(0)

  await page.getByRole('button', { name: '完成訓練' }).click()
  await expect(sheet.getByTestId('finish-undone')).toHaveText('還有 1 組沒勾，沒勾的不算進紀錄')
  await sheet.getByRole('button', { name: '結束', exact: true }).click()
  await expect(page.locator('[data-screen="finish"]')).toBeVisible()
  await expect.poll(() => endedWrites(page)).toBe(1)

  await page.locator('[data-action="finish-done"]').click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
  await expect(hero(page)).toHaveAttribute('data-hero', 'done')
})

/* ═══════════ ⑤ 完成畫面、⑥ 卡頭 1RM（固定在週四 2026-11-19，「本週」才算得準） ═══════════ */

const DAY = '2026-11-19'
const localIso = (date: string, hm: string) => new Date(`${date}T${hm}:00`).toISOString()
/** 推日：上週四與本週二各練一次臥推 60×10（e1RM 80）；今天照推日開了一次，臥推 65×8（e1RM 82.3）與第一次做的滑輪下拉 45×10，都還沒勾。 */
const WEEK_FIX: typeof FIX = {
  ...FIX,
  exercises: EXERCISES,
  routines: [routine('r-push', '推日', 1)],
  routine_exercises: [routineEx('re-p', 'r-push', CHEST)],
  workouts: [
    { id: 'w-old', performed_on: '2026-11-12', started_at: localIso('2026-11-12', '10:00'), ended_at: localIso('2026-11-12', '11:00'), routine_id: 'r-push' },
    { id: 'w-prev', performed_on: '2026-11-17', started_at: localIso('2026-11-17', '10:00'), ended_at: localIso('2026-11-17', '11:00'), routine_id: 'r-push' },
    { id: 'w-now', performed_on: DAY, started_at: localIso(DAY, '08:30'), ended_at: null, routine_id: 'r-push' },
  ],
  workout_exercises: [
    { id: 'we-old', workout_id: 'w-old', exercise_id: CHEST, position: 0 },
    { id: 'we-prev', workout_id: 'w-prev', exercise_id: CHEST, position: 0 },
    { id: 'we-c', workout_id: 'w-now', exercise_id: CHEST, position: 0 },
    { id: 'we-b', workout_id: 'w-now', exercise_id: BACK, position: 1 },
  ],
  workout_sets: [
    { id: 'old-1', workout_exercise_id: 'we-old', set_no: 1, weight_kg: 60, reps: 10, done: true },
    { id: 'prev-1', workout_exercise_id: 'we-prev', set_no: 1, weight_kg: 60, reps: 10, done: true },
    { id: 'c-1', workout_exercise_id: 'we-c', set_no: 1, weight_kg: 65, reps: 8, done: false },
    { id: 'b-1', workout_exercise_id: 'we-b', set_no: 1, weight_kg: 45, reps: 10, done: false },
  ],
}

async function openWeekSession(page: Page, fix: typeof FIX = WEEK_FIX, id = 'w-now') {
  await openAppAt(page, DAY, {}, fix)
  await openTraining(page)
  await page.locator(`.tr-row[data-workout-id="${id}"]`).click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
}
const tickSet = async (page: Page, setId: string) => {
  const check = page.locator(`[data-set-id="${setId}"] .tr-check`)
  const was = await check.getAttribute('aria-pressed')
  await check.click()
  await expect(check).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true')
}

test('完成畫面：總重量數到最終值、時長／組數／本週第 N 次、亮點依序三種（新紀錄 → 比上次同課表 → 第一次做）、練到的肌群', async ({ page }) => {
  await openWeekSession(page)
  await tickSet(page, 'c-1')
  await page.locator('.ex', { hasText: '滑輪下拉' }).locator('.ex-toggle').click()
  await tickSet(page, 'b-1')
  await page.getByRole('button', { name: '完成訓練' }).click()
  await page.locator('[data-screen="finish-sheet"]').getByRole('button', { name: '結束', exact: true }).click()

  const fc = page.locator('[data-screen="finish"]')
  await expect(fc).toBeVisible()
  await expect(fc.locator('.fc-title')).toHaveText('推日 · 練完了')
  await expect(fc.getByTestId('finish-volume')).toHaveText('970') // 65×8 ＋ 45×10
  await expect(fc.locator('.fc-stats > div').nth(1)).toHaveText('2組')
  await expect(fc.locator('.fc-stats > div').nth(2)).toHaveText('第 2 次本週') // 本週二那次＋這次；上週四的不算

  const rows = fc.locator('[data-section="highlights"] .fc-hl-row')
  await expect(rows).toHaveCount(3)
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).toEqual(['record', 'vsLast', 'first'])
  await expect(rows.nth(0).locator('.grow')).toHaveText('槓鈴臥推 推估極限 82 kg')
  await expect(rows.nth(0).locator('.fc-hl-tag')).toHaveText('新高 +2.3')
  await expect(rows.nth(1).locator('.grow')).toHaveText('比上次推日多 62%') // 970 vs 600
  await expect(rows.nth(2).locator('.grow')).toHaveText('第一次做 滑輪下拉')
  await expect(fc.locator('.fc-group')).toHaveText(['胸部', '背部'])
  await expect(fc.locator('[data-section="save-routine"]'), '照課表開的不提供存成課表').toHaveCount(0)
})

test('完成畫面：沒有新紀錄、沒有課表、沒有第一次做的動作 → 不出「這次的亮點」那段', async ({ page }) => {
  const fix: typeof FIX = {
    ...WEEK_FIX,
    workouts: [...WEEK_FIX.workouts.filter((w) => w.id !== 'w-now'), { id: 'w-plain', performed_on: DAY, started_at: localIso(DAY, '08:30'), ended_at: null, routine_id: null }],
    workout_exercises: [...WEEK_FIX.workout_exercises.filter((we) => we.workout_id !== 'w-now'), { id: 'we-p', workout_id: 'w-plain', exercise_id: CHEST, position: 0 }],
    workout_sets: [
      ...WEEK_FIX.workout_sets.filter((s) => s.workout_exercise_id === 'we-old' || s.workout_exercise_id === 'we-prev'),
      { id: 'p-1', workout_exercise_id: 'we-p', set_no: 1, weight_kg: 50, reps: 10, done: false }, // e1RM 66.7 < 80
    ],
  }
  await openWeekSession(page, fix, 'w-plain')
  await tickSet(page, 'p-1')
  await page.getByRole('button', { name: '完成訓練' }).click()
  await page.locator('[data-screen="finish-sheet"]').getByRole('button', { name: '結束', exact: true }).click()
  const fc = page.locator('[data-screen="finish"]')
  await expect(fc.getByTestId('finish-volume')).toHaveText('500')
  await expect(fc.locator('.fc-group')).toHaveText(['胸部'])
  await expect(fc.locator('[data-section="highlights"]')).toHaveCount(0)
  await expect(fc).not.toContainText('這次的亮點')
})

test('卡頭第二行：「1RM N kg」，勾的組破紀錄換成「N kg +D kg」、取消勾收回；之前沒做過的動作不算新紀錄', async ({ page }) => {
  await openWeekSession(page)
  const chest = page.locator('.ex', { hasText: '槓鈴臥推' })
  const sub = chest.locator('.ex-toggle .sub')
  await expect(sub).toHaveText('1RM 80 kg')
  await expect(sub.locator('.ex-rm-up')).toHaveCount(0)

  await tickSet(page, 'c-1')
  await expect(sub.locator('.ex-rm')).toHaveText('82 kg')
  await expect(sub.locator('.ex-rm-up')).toHaveText('+2.3 kg')
  await expect(sub).toHaveClass(/is-record/)

  await tickSet(page, 'c-1')
  await expect(sub).toHaveText('1RM 80 kg')
  await expect(sub.locator('.ex-rm-up')).toHaveCount(0)

  // 滑輪下拉從沒做過：沒勾之前沒有可講的數字（退回肌群），勾了只寫 1RM、沒有「+」
  const back = page.locator('.ex', { hasText: '滑輪下拉' })
  await back.locator('.ex-toggle').click()
  const backSub = back.locator('.ex-toggle .sub')
  await expect(backSub).toHaveText('背部')
  await tickSet(page, 'b-1')
  await expect(backSub).toHaveText('1RM 60 kg') // 45 × (1 + 10/30)
  await expect(backSub.locator('.ex-rm-up')).toHaveCount(0)
})

/* ═══════════ ⑦ 「訓練中」小條 ═══════════ */

test('訓練中小條：飲食、設定分頁有；點了開回訓練中整頁；訓練分頁看那一天不出、看別天會出', async ({ page }) => {
  await openApp(page, {}, LIVE)
  const bar = page.locator('.live-bar')
  await expect(bar).toBeVisible()
  await expect(bar).toHaveAttribute('data-live-workout', 'w-live')
  await expect(bar.locator('.live-nm')).toHaveText('推日')
  await expect(bar.locator('.live-time')).toHaveText(/^\d+:\d{2}$/)

  await page.locator('.tab[aria-label="設定"]').click()
  await expect(page.locator('[data-screen="settings"]')).toBeVisible()
  await expect(bar).toBeVisible()

  await bar.click()
  await expect(page.locator('[data-screen="training-session"]')).toHaveAttribute('data-workout-id', 'w-live')
  await expect(page.locator('.tab[aria-current="page"]')).toHaveCount(0) // 整頁接管、底部列收起，小條也跟著不在
  await expect(bar).toHaveCount(0)

  await page.getByRole('button', { name: '返回（訓練繼續進行）' }).click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
  await expect(page.locator('.tab[aria-current="page"]')).toHaveAttribute('aria-label', '訓練')
  await expect(bar, '訓練分頁正看著那一天：天空那行已經在講').toHaveCount(0)
  await gotoDate(page, shiftIso(TODAY, -1))
  await expect(bar).toBeVisible()
})

test('訓練中小條：空白開始的寫「N 個動作」；訓練結束後就不出', async ({ page }) => {
  await openApp(page, {}, { ...LIVE, workouts: LIVE.workouts.map((w) => ({ ...w, routine_id: null })) })
  const bar = page.locator('.live-bar')
  await expect(bar.locator('.live-nm')).toHaveText('1 個動作')
  await bar.click()
  await page.getByRole('button', { name: '完成訓練' }).click()
  await page.locator('[data-screen="finish-sheet"]').getByRole('button', { name: '結束', exact: true }).click()
  await page.locator('[data-action="finish-done"]').click()
  await page.locator('.tab[aria-label="飲食"]').click()
  await expect(page.locator('[data-screen="today"]')).toBeVisible()
  await expect(bar).toHaveCount(0)
})

/* ═══════════ ⑧ 飲食頂端提示（intakePersist：寫入才會落地、重撈得到） ═══════════ */

const MEAL_DAY = '2026-12-10'
/** 這個月記過的日子由月份小點的查詢（kcalWindow）給：12/01、12/08、12/09，加上今天＝4 天；11/30 是上個月、12/12 在今天之後，都不算。 */
const MARKS: typeof FIX['kcalWindow'] = ['2026-11-30', '2026-12-01', '2026-12-08', '2026-12-09', '2026-12-12'].map((d) => ({ eaten_on: d, qty: 1, kcal: 500, meal: 'lunch' }))
const toast = (page: Page) => page.getByTestId('log-toast')

async function addTo(page: Page, meal: string, food: string) {
  await page.locator('button.cta').click()
  const sheet = page.locator('[data-screen="log-sheet"]')
  await expect(sheet).toBeVisible()
  await sheet.locator('.chip', { hasText: meal }).click()
  await sheet.locator('.food-row', { hasText: food }).first().click()
  await sheet.locator('.pick-bar-btn').click()
  await expect(sheet).toHaveCount(0)
}
const mealItems = (page: Page, meal: string) => page.locator('.timeline .node').filter({ hasText: meal }).locator('.item .nm')

test('飲食提示：一餐從沒記變記了 →「晚餐記好了 · 還能吃 N 卡」約 2 秒後收掉；同一餐再加一樣不再提示', async ({ page }) => {
  await openAppAt(page, MEAL_DAY, { intakePersist: true }, { ...FIX, intake: FIX.intake.filter((r) => r.meal === 'breakfast'), kcalWindow: MARKS })
  await addTo(page, '晚餐', '地瓜')
  await expect(mealItems(page, '晚餐')).toHaveText(['地瓜'])
  const left = (await page.locator('.gauge-num').textContent())?.trim()
  await expect(toast(page)).toHaveText(`晚餐記好了 · 還能吃 ${left} 卡`)
  await expect(toast(page)).toHaveCount(0, { timeout: 5000 })

  // 「沒出現」沒有自然的等待點：記下之後每一次掛上的提示，再記一筆空著的點心當屏障——點心的提示出來時，
  // 前一筆（晚餐第二樣）的判斷一定已經做完了，紀錄裡只該有點心那一句
  await page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] }
    w.__toasts = []
    new MutationObserver((recs) => {
      for (const r of recs)
        for (const n of r.addedNodes)
          if (n instanceof HTMLElement && n.matches('[data-testid="log-toast"]')) w.__toasts.push(n.textContent ?? '')
    }).observe(document.body, { childList: true, subtree: true })
  })
  await addTo(page, '晚餐', '香蕉')
  await expect(mealItems(page, '晚餐')).toHaveText(['地瓜', '香蕉'])
  await addTo(page, '點心', '乳清')
  await expect(toast(page)).toHaveText(/^點心記好了 · 還能吃 \d+ 卡$/)
  expect(await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts), '晚餐本來就記了，第二樣不提示').toEqual([
    await toast(page).textContent(),
  ])
})

test('飲食提示：今天三餐因此記齊 →「三餐都記了 · 這個月記了 N 天」', async ({ page }) => {
  await openAppAt(page, MEAL_DAY, { intakePersist: true }, { ...FIX, kcalWindow: MARKS }) // 早、午餐已記
  await expect(page.locator('.datectl-day[data-date="2026-12-09"]'), '月份小點載完').toHaveClass(/is-marked/)
  await addTo(page, '晚餐', '地瓜')
  await expect(mealItems(page, '晚餐')).toHaveText(['地瓜'])
  await expect(toast(page)).toHaveText('三餐都記了 · 這個月記了 4 天')
})
