/* 組間休息計時器（spec.md「階段 3 甲：組間休息計時器」；運算在 src/lib/restTimer.test.ts）。
   這支獨立成檔：`page.clock` 會接管整頁的 setInterval／setTimeout／Date，放在 training.spec.ts 裡會干擾那邊對時間敏感的動效測試。
   時鐘一律 `install({ time: 現在 })` 讓時間照常流動（app 的「今天」、stub 的逾時才不會錯亂）。
   **要跳時間用 `setFixedTime`（見 `jump`），不要用 `fastForward`**：fastForward 會連 `performance.now` 一起撥快，motion 的
   WAAPI 動畫拿它當起點、而文件時間軸是真的時間，起點落在未來，條的退場動畫要等到那個時間才開始（實測撥 90 秒就退不掉）。
   setFixedTime 只改 `Date.now`／`new Date()`，計時器照跑，app 的 250ms 重畫會在下一格讀到新時間。
   提示音：stub 掉 `HTMLMediaElement.play`，只記錄呼叫（muted＝無聲解鎖那一下、非 muted＝真的響）。
   fetch 全 stub；寫入不落地，所以要重新載入還在的訓練用 fixture 的「進行中」那筆。 */
import { test, expect, type Page } from '@playwright/test'
import { FIX, TODAY } from './fixtures'
import { openApp } from './harness'

const EX_ID = '11111111-1111-4111-8111-111111111111'

/** 一次進行中的訓練（今天開始、沒結束）：一個動作、三組未完成。 */
const LIVE: typeof FIX = {
  ...FIX,
  workouts: [{ id: 'w-live', performed_on: TODAY, started_at: `${TODAY}T00:00:01.000Z`, ended_at: null, routine_id: null }],
  workout_exercises: [{ id: 'we-live', workout_id: 'w-live', exercise_id: EX_ID, position: 0 }],
  workout_sets: [1, 2, 3].map((n) => ({ id: `s-${n}`, workout_exercise_id: 'we-live', set_no: n, weight_kg: 60, reps: 12, done: false })),
}

/** 今天有一次已結束的訓練（2 組、都已完成）。 */
const FINISHED: typeof FIX = {
  ...FIX,
  workouts: [{ id: 'w-1', performed_on: TODAY, started_at: `${TODAY}T08:00:00.000Z`, ended_at: `${TODAY}T08:36:00.000Z`, routine_id: null }],
  workout_exercises: [{ id: 'we-1', workout_id: 'w-1', exercise_id: EX_ID, position: 0 }],
  workout_sets: [
    { id: 's-1', workout_exercise_id: 'we-1', set_no: 1, weight_kg: 60, reps: 12, done: true },
    { id: 's-2', workout_exercise_id: 'we-1', set_no: 2, weight_kg: 60, reps: 12, done: true },
  ],
}

interface Play {
  muted: boolean
  src: string
}
type W = { __plays: Play[] }

/** 時鐘照常流動；提示音只記錄不真的播。要在第一次導覽之前裝。 */
async function prepare(page: Page, opts: { reduced?: boolean } = {}) {
  await page.clock.install({ time: Date.now() })
  await page.addInitScript(() => {
    ;(window as unknown as W).__plays = []
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      ;(window as unknown as W).__plays.push({ muted: this.muted, src: this.currentSrc || this.src })
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = () => undefined
  })
  if (opts.reduced) await page.emulateMedia({ reducedMotion: 'reduce' })
}

/** 把頁面的「現在」往後撥 ms 毫秒（之後 Date.now 固定在那個值，直到下一次撥）。 */
async function jump(page: Page, ms: number) {
  const p = await page.evaluate(() => Date.now())
  await page.clock.setFixedTime(p + ms)
}

const plays = (page: Page) => page.evaluate(() => (window as unknown as W).__plays)
const chimes = async (page: Page) => (await plays(page)).filter((p) => !p.muted && p.src.includes('rest-chime'))

const bar = (page: Page) => page.locator('.tr-rest')
const barText = (page: Page) => page.locator('.tr-rest [data-rest-text]')
const tick = (page: Page, n: number) => page.locator('.ex .set').nth(n).locator('.tr-check').click()
const btn = (page: Page, name: string) => bar(page).getByRole('button', { name })

async function openTraining(page: Page) {
  await page.locator('.tab[aria-label="訓練"]').click()
  await expect(page.locator('[data-screen="training"]')).toBeVisible()
}

/** 進行中的訓練整頁（fixture 的 w-live）。 */
async function openLive(page: Page) {
  await openApp(page, {}, LIVE)
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-live"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
  await expect(page.locator('.ex .set')).toHaveCount(3)
}

test('單點把一組勾成完成才開始倒數：預設 1:30；略過收起；取消勾、全部完成都不開始', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await expect(bar(page), '還沒勾組，不顯示').toHaveCount(0)

  await tick(page, 0)
  await expect(bar(page)).toBeVisible()
  await expect(barText(page)).toHaveText('1:30')

  await btn(page, '略過休息').click()
  await expect(bar(page)).toHaveCount(0)

  await tick(page, 0) // 取消勾
  await expect(page.locator('.ex .set').nth(0).locator('.tr-check')).toHaveAttribute('aria-pressed', 'false')
  await expect(bar(page), '取消勾不開始').toHaveCount(0)

  await page.locator('.ex').getByRole('button', { name: '全部完成', exact: true }).click()
  await expect(page.locator('.ex').getByRole('button', { name: '取消全部完成', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(bar(page), '全部完成不開始').toHaveCount(0)
})

test('已結束的訓練裡勾組不開始倒數', async ({ page }) => {
  await prepare(page)
  await openApp(page, {}, FINISHED)
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-1"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
  await tick(page, 0) // 取消
  await tick(page, 0) // 再勾成完成：進行中的訓練這一下會開始倒數
  await expect(page.locator('.ex .set').nth(0).locator('.tr-check')).toHaveAttribute('aria-pressed', 'true')
  await expect(bar(page)).toHaveCount(0)
})

test('倒數由「結束時間點 − 現在」算：撥時鐘 30 秒顯示 1:00；再勾另一組重新起算；撥過結束點顯示已過多久、不補響', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  await expect(barText(page)).toHaveText('1:30')

  await jump(page, 30_000)
  await expect(barText(page)).toHaveText('1:00')

  await tick(page, 1)
  await expect(barText(page), '倒數中再勾一組：重新起算').toHaveText('1:30')

  // 一口氣跳過結束點 23 秒（等於鎖屏過了結束點才回來）：沒有準時看到，所以只顯示已過多久、不響
  await jump(page, 113_000)
  await expect(bar(page)).toHaveAttribute('data-rest', 'over')
  await expect(barText(page)).toHaveText('休息結束 · 已過 0:23')
  expect(await chimes(page), '回前景時已超時，不補響').toHaveLength(0)
  await btn(page, '收起').click()
  await expect(bar(page)).toHaveCount(0)
})

test('−15／＋15：各調整 15 秒；＋15 最多到 10:00；−15 減到 0 就是結束（響一聲、約 3 秒後自動收起）', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  await expect(barText(page)).toHaveText('1:30')

  await btn(page, '加 15 秒').click()
  await expect(barText(page)).toHaveText('1:45')
  await btn(page, '減 15 秒').click()
  await btn(page, '減 15 秒').click()
  await expect(barText(page)).toHaveText('1:15')

  for (let i = 0; i < 40; i++) await btn(page, '加 15 秒').click()
  await expect(barText(page), '上限 10 分鐘').toHaveText('10:00')

  await btn(page, '略過休息').click()
  await tick(page, 1)
  await expect(barText(page)).toHaveText('1:30')
  for (let i = 0; i < 6; i++) await btn(page, '減 15 秒').click()
  await expect(bar(page)).toHaveAttribute('data-rest', 'over')
  await expect(barText(page)).toHaveText('休息結束')
  await expect.poll(async () => (await chimes(page)).length, '準時歸零：響一聲').toBe(1)

  await jump(page, 3_000)
  await expect(bar(page), '準時看到的歸零，約 3 秒後自動收起').toHaveCount(0)
})

test('時長循環 60→90→120→180→60，換的是下一次開始用的時長；重新載入後維持', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  const preset = btn(page, /下一次休息/)
  await expect(preset).toHaveText('90 秒')
  await preset.click()
  await expect(preset).toHaveText('120 秒')
  await expect(barText(page), '換時長不動目前這一輪').toHaveText('1:30')
  await preset.click()
  await expect(preset).toHaveText('180 秒')
  await preset.click()
  await expect(preset).toHaveText('60 秒')
  await preset.click()
  await expect(preset).toHaveText('90 秒')
  await preset.click()
  await expect(preset).toHaveText('120 秒')
  expect(await page.evaluate(() => localStorage.getItem('tally.rest.preset'))).toBe('120')

  await btn(page, '略過休息').click()
  await tick(page, 1)
  await expect(barText(page), '下一次勾組以新時長起算').toHaveText('2:00')

  await page.reload()
  await page.locator('.tab[aria-label="訓練"]').click()
  await page.locator('.tr-row[data-workout-id="w-live"]').click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await tick(page, 2)
  await expect(barText(page), '重新載入後時長偏好還在').toHaveText('2:00')
})

test('重新載入：倒數中續算；已過期的不復活', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  await expect(barText(page)).toHaveText('1:30')
  const key = 'tally.rest.end.w-live'
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key), '結束時間點存在 sessionStorage').not.toBeNull()

  await page.reload()
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-live"]').click()
  await expect(bar(page), '重新載入後續算').toBeVisible()
  const t = await barText(page).innerText()
  const m = /^1:(\d\d)$/.exec(t) ?? /^0:(\d\d)$/.exec(t)
  expect(m, `續算的剩餘時間 ${t}`).not.toBeNull()

  // 過期的結束時間點（5 秒前）：不復活
  await page.evaluate((k) => sessionStorage.setItem(k, String(Date.now() - 5_000)), key)
  await page.reload()
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-live"]').click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await expect(bar(page)).toHaveCount(0)
})

test('歸零且畫面在前景：響一聲（第一次勾組那下先無聲解鎖）、條換色、約 3 秒後自動收起', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  await expect(barText(page)).toHaveText('1:30')
  const unlock = await plays(page)
  expect(unlock.length, '勾組當下無聲解鎖一次').toBe(1)
  expect(unlock[0].muted).toBe(true)
  expect(await chimes(page)).toHaveLength(0)

  await jump(page, 90_000)
  await expect(bar(page)).toHaveAttribute('data-rest', 'over')
  await expect.poll(async () => (await chimes(page)).length).toBe(1)
  await expect(barText(page)).toHaveText('休息結束')
  await expect(page.locator('.tr-rest.is-over')).toHaveCount(1)

  await jump(page, 3_000)
  await expect(bar(page)).toHaveCount(0)
  expect(await chimes(page), '只響一次').toHaveLength(1)
})

test('回前景（visibilitychange）立刻重算：計時器全凍結時只靠這個事件，數字仍追上', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  await expect(barText(page)).toHaveText('1:30')
  // 凍結所有計時器（等於 JS 被暫停），再把「現在」直接改成 30 秒後
  const p = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(p + 1_000)
  await page.clock.setFixedTime(p + 30_000)
  await page.waitForTimeout(600) // 給真實時間：若還有 interval 在跑，這段會讓它重畫
  await expect(barText(page), '還沒有事件觸發重算，畫面是舊的').not.toHaveText('1:00')
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(barText(page)).toHaveText('1:00')
})

test('倒數條與列表、底部列各自佔位：條出現時列表縮短，不蓋住最後一列也不蓋住底部列', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  const scroll = page.locator('[data-screen="training-session"] .tr-scroll')
  const before = (await scroll.boundingBox())!.height
  await tick(page, 0)
  await expect(bar(page)).toBeVisible()
  await expect.poll(async () => (await scroll.boundingBox())!.height, '列表讓出條的高度').toBeLessThan(before - 40)
  const s = (await scroll.boundingBox())!
  const b = (await bar(page).boundingBox())!
  const bottom = (await page.locator('.tr-bottom').boundingBox())!
  expect(s.y + s.height, '列表在條的上方').toBeLessThanOrEqual(b.y + 1)
  expect(b.y + b.height, '條在底部列的上方').toBeLessThanOrEqual(bottom.y + 1)
  const btns = await bar(page).getByRole('button').all()
  for (const x of btns) expect((await x.boundingBox())!.height, '觸控下限 44px').toBeGreaterThanOrEqual(44)
})

/** 條「進場」那一刻的 inline style（motion 掛上去的起點）；減少動態時不該有位移。 */
async function watchEntrance(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __rest: string[] }
    w.__rest = []
    const seen = (el: Element) => w.__rest.push(el.getAttribute('style') ?? '')
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'attributes' && (r.target as Element).classList?.contains('tr-rest')) seen(r.target as Element)
        for (const n of Array.from(r.addedNodes)) {
          if (n instanceof Element && n.classList.contains('tr-rest')) seen(n)
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
  })
}
const entranceStyles = (page: Page) => page.evaluate(() => (window as unknown as { __rest: string[] }).__rest)

test('進場：一般是淡入＋上移，減少動態只淡入、不位移', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await watchEntrance(page)
  await tick(page, 0)
  await expect(bar(page)).toBeVisible()
  await page.waitForTimeout(400)
  expect((await entranceStyles(page)).some((s) => /translate/.test(s)), '一般：有上移的起點').toBe(true)
})

test('進場（減少動態）：只淡入，沒有任何位移', async ({ page }) => {
  await prepare(page, { reduced: true })
  await openLive(page)
  await watchEntrance(page)
  await tick(page, 0)
  await expect(bar(page)).toBeVisible()
  await page.waitForTimeout(400)
  const styles = await entranceStyles(page)
  expect(styles.length, '有觀察到進場').toBeGreaterThan(0)
  expect(styles.some((s) => /translate/.test(s)), `減少動態不該位移：${styles.join(' | ')}`).toBe(false)
})

test('建置層：提示音是獨立檔案、進了 precache（離線健身房也響）', async ({ page }) => {
  await prepare(page)
  await openApp(page)
  const sw = await (await page.request.get(new URL('sw.js', page.url()).href)).text()
  expect(sw.match(/assets\/rest-chime-[\w-]+\.wav/g), 'precache 清單有提示音').toHaveLength(1)
})
