/* 重量建議（訓練分析 B；spec.md「階段 4 甲」口徑 3、AC 8）：組編輯 sheet 重量欄上方一行「建議 X kg · 理由」＋「套用」。
   運算本身由 src/lib/strength.test.ts（規則）與 exerciseCatalog.test.ts（加重幅度歸類）守，這裡驗使用者看得到的：
   不同器材的加重幅度、理由字樣、套用、徒手不出現、資料不足的說明、課表目標次數、離線照常顯示。
   預期值全部從固定資料手算。fixture 是「進行中的訓練」＋每個動作兩次歷史訓練。 */
import { test, expect, type Page } from '@playwright/test'
import { FIX, TODAY, USER_ID } from './fixtures'
import { openApp, shiftIso } from './harness'
import { SEEDED_FIX } from './seeded'

const CUSTOM = 'cccccccc-0000-4000-8000-000000000001'

/** 名稱 → 動作列（取預設目錄裡的整列，id 才對得上 catalogKey）。 */
const byName = (name: string) => {
  const row = SEEDED_FIX.exercises.find((e) => e.name === name)
  if (!row) throw new Error(`目錄裡沒有「${name}」`)
  return row as Record<string, unknown> & { id: string }
}

type Hist = [number, number][] // 一次訓練裡的各組 [重量, 次數]，全部已打勾
interface Plan { name: string; sessions: [Hist, Hist] }

/** 每個動作兩次歷史訓練（-10、-3 天）＋進行中的訓練 w-live（各動作一組、沒打勾，位置依 plans 順序）。 */
function build(plans: Plan[], opts: { routine?: { id: string; reps: number | null } } = {}): typeof FIX {
  const exercises = [...SEEDED_FIX.exercises, { id: CUSTOM, user_id: USER_ID, name: '我的動作', muscle_group: 'chest', tips: null, archived: false }]
  const idOf = (name: string) => (name === '我的動作' ? CUSTOM : byName(name).id)
  const workouts: Record<string, unknown>[] = []
  const entries: Record<string, unknown>[] = []
  const sets: Record<string, unknown>[] = []
  const day = (off: number) => shiftIso(TODAY, off)

  plans.forEach((p, pi) => {
    p.sessions.forEach((hist, si) => {
      const wid = `h-${pi}-${si}`
      const d = day(si === 0 ? -10 : -3)
      workouts.push({ id: wid, performed_on: d, started_at: `${d}T08:00:00.000Z`, ended_at: `${d}T09:00:00.000Z`, routine_id: null })
      entries.push({ id: `${wid}-e`, workout_id: wid, exercise_id: idOf(p.name), position: 0 })
      hist.forEach(([w, r], i) =>
        sets.push({ id: `${wid}-s${i}`, workout_exercise_id: `${wid}-e`, set_no: i + 1, weight_kg: w, reps: r, done: true }),
      )
    })
    entries.push({ id: `live-e${pi}`, workout_id: 'w-live', exercise_id: idOf(p.name), position: pi })
    sets.push({ id: `live-s${pi}`, workout_exercise_id: `live-e${pi}`, set_no: 1, weight_kg: 0, reps: 0, done: false })
  })
  workouts.push({
    id: 'w-live', performed_on: TODAY, started_at: `${TODAY}T09:00:00.000Z`, ended_at: null, routine_id: opts.routine?.id ?? null,
  })

  return {
    ...FIX,
    exercises: exercises as typeof FIX.exercises,
    workouts,
    workout_exercises: entries,
    workout_sets: sets,
    routines: opts.routine ? [{ id: opts.routine.id, name: '課表', archived: false, created_at: '2026-10-01T00:00:00.000Z' }] : [],
    routine_exercises: opts.routine
      ? plans.map((p, i) => ({
          id: `re-${i}`, routine_id: opts.routine!.id, exercise_id: idOf(p.name), position: i, target_sets: 3, target_reps: opts.routine!.reps,
        }))
      : [],
  }
}

async function openLive(page: Page, fix: typeof FIX) {
  await openApp(page, {}, fix)
  await page.locator('.tab[aria-label="訓練"]').click()
  await page.locator('[data-screen="training"] .tr-row[data-workout-id="w-live"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
}

const setSheet = (page: Page) => page.locator('[data-screen="set-sheet"]')
const suggest = (page: Page) => setSheet(page).locator('[data-section="suggest"]')

/** 開第 n 張動作卡（0 起算）唯一那一組的組編輯 sheet；卡是收合的就先點開。 */
async function openSet(page: Page, exIndex: number) {
  const card = page.locator('.ex').nth(exIndex)
  await expect(card).toBeVisible()
  if ((await card.locator('.set').count()) === 0) await card.locator('.ex-toggle').click()
  await card.locator('.set').first().locator('.w').click()
  await expect(setSheet(page)).toBeVisible()
}
async function closeSheet(page: Page) {
  await setSheet(page).getByRole('button', { name: '完成', exact: true }).click()
  await expect(setSheet(page)).toHaveCount(0)
}

const PLANS: Plan[] = [
  { name: '槓鈴深蹲', sessions: [[[100, 12]], [[100, 12], [100, 12], [100, 12]]] }, // 做到 → +5（槓鈴）
  { name: '啞鈴臥推', sessions: [[[20, 12]], [[20, 12], [20, 12]]] }, // 做到 → +2.5（啞鈴）
  { name: '腿推舉', sessions: [[[60, 12]], [[60, 12], [60, 11], [60, 10]]] }, // 有一組沒做到 → 維持
  { name: '我的動作', sessions: [[[10, 12]], [[10, 12]]] }, // 自建 → +2.5
]

test('不同器材的加重幅度與理由：槓鈴 +5、啞鈴 +2.5、器械維持、自建 +2.5', async ({ page }) => {
  await openLive(page, build(PLANS))

  await openSet(page, 0)
  await expect(suggest(page)).toContainText('建議 105 kg · 上次三組都做到 12 下') // 100＋5
  await closeSheet(page)

  await openSet(page, 1)
  await expect(suggest(page)).toContainText('建議 22.5 kg · 上次兩組都做到 12 下') // 20＋2.5
  await closeSheet(page)

  await openSet(page, 2)
  await expect(suggest(page)).toContainText('建議 60 kg · 再做到 12 下') // 沒有「降重」，也沒有加重
  await closeSheet(page)

  await openSet(page, 3)
  await expect(suggest(page)).toContainText('建議 12.5 kg · 上次那組做到 12 下') // 自建動作固定 2.5
})

test('套用：把重量欄填成建議值、鈕變灰「已套用」；之後手動改掉，鈕回到「套用」', async ({ page }) => {
  await openLive(page, build(PLANS))
  await openSet(page, 0)
  const apply = suggest(page).getByRole('button')
  await expect(apply).toHaveText('套用')
  await expect(apply).toHaveAccessibleName('套用建議重量 105 公斤')

  await apply.click()
  await expect(page.locator('.ex .set').first().locator('.w'), '背景頁該列同步更新').toHaveText('105')
  await expect(apply).toHaveText('已套用')
  await expect(apply, '讀屏念的名稱也要跟著變，不能還是「套用建議重量」').toHaveAccessibleName('已套用')
  await expect(apply).toBeDisabled()

  await setSheet(page).getByRole('button', { name: '重量加 2.5 公斤' }).click()
  await expect(apply).toHaveText('套用')
  await expect(apply).toBeEnabled()
})

test('徒手動作不給建議（整行不出現）；紀錄只有一次的動作說「還沒有足夠紀錄」', async ({ page }) => {
  const plans: Plan[] = [
    { name: '引體向上', sessions: [[[0, 8]], [[0, 8]]] },
    { name: '槓鈴臥推', sessions: [[], [[60, 12]]] },
  ]
  await openLive(page, build(plans))

  await openSet(page, 0)
  await expect(suggest(page), '引體向上有兩次紀錄也不建議（沒有重量可加）').toHaveCount(0)
  await closeSheet(page)

  await openSet(page, 1)
  await expect(suggest(page)).toHaveText('建議：還沒有足夠紀錄（至少 2 次）')
  await expect(suggest(page).getByRole('button')).toHaveCount(0)
})

test('進行中的這一次不算歷史：只有一次歷史＋今天這次，仍然不足', async ({ page }) => {
  const fix = build([{ name: '槓鈴深蹲', sessions: [[], [[100, 12]]] }])
  // 把今天這次的那組也打勾：它是進行中的訓練，不能把自己算成第二次
  fix.workout_sets = fix.workout_sets.map((s) => (s.id === 'live-s0' ? { ...s, weight_kg: 100, reps: 12, done: true } : s))
  await openLive(page, fix)
  await openSet(page, 0)
  await expect(suggest(page)).toHaveText('建議：還沒有足夠紀錄（至少 2 次）')
})

test('門檻取課表的目標次數：目標 8、上次 60×8 兩組 → 建議 +5、理由寫 8 下；沒設目標才用 12', async ({ page }) => {
  const plans: Plan[] = [{ name: '槓鈴深蹲', sessions: [[[60, 8]], [[60, 8], [60, 8]]] }]
  await openLive(page, build(plans, { routine: { id: 'r-1', reps: 8 } }))
  await openSet(page, 0)
  await expect(suggest(page)).toContainText('建議 65 kg · 上次兩組都做到 8 下')
})

test('課表沒設目標次數：同樣的紀錄用 12 判斷 → 沒做到，維持 60、再做到 12 下', async ({ page }) => {
  const plans: Plan[] = [{ name: '槓鈴深蹲', sessions: [[[60, 8]], [[60, 8], [60, 8]]] }]
  await openLive(page, build(plans, { routine: { id: 'r-1', reps: null } }))
  await openSet(page, 0)
  await expect(suggest(page)).toContainText('建議 60 kg · 再做到 12 下')
})

test('離線照常顯示：資料來自本機底，不需要網路', async ({ page }) => {
  await openLive(page, build(PLANS))
  await page.evaluate(() => {
    ;(window as unknown as { __dataDown: boolean }).__dataDown = true
  })
  await openSet(page, 0)
  await expect(suggest(page)).toContainText('建議 105 kg · 上次三組都做到 12 下')
})
