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
import { SEEDED_FIX } from './seeded'

const EX_ID = '11111111-1111-4111-8111-111111111111'

/** 一次進行中的訓練（今天開始、沒結束）：一個動作、三組未完成。 */
const LIVE: typeof FIX = {
  ...FIX,
  workouts: [{ id: 'w-live', performed_on: TODAY, started_at: `${TODAY}T00:00:01.000Z`, ended_at: null, routine_id: null }],
  workout_exercises: [{ id: 'we-live', workout_id: 'w-live', exercise_id: EX_ID, position: 0 }],
  workout_sets: [1, 2, 3].map((n) => ({ id: `s-${n}`, workout_exercise_id: 'we-live', set_no: n, weight_kg: 60, reps: 12, done: false })),
}

/** 同一次進行中的訓練再多 9 個（收合的）動作：列表夠長、要捲才到最後一張卡。 */
const LONG: typeof FIX = {
  ...LIVE,
  workout_exercises: Array.from({ length: 10 }, (_, i) => ({
    id: i === 0 ? 'we-live' : `we-live-${i}`,
    workout_id: 'w-live',
    exercise_id: EX_ID,
    position: i,
  })),
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

/** 進行中的訓練整頁（fixture 的 w-live）。
 *  `freeze`（預設開）：把 `Date.now` 定在目前這一刻，之後只在 `jump` 時才動——倒數的數字是 `ceil(剩餘)`，時間照流動的話，
 *  機器一忙（全量與別的 spec 同時跑時實測過），勾組到斷言之間多過 1 秒，`1:15` 就變成 `1:14`，斷言只會越等越錯。 */
async function openLive(page: Page, freeze = true, fix: typeof FIX = LIVE) {
  await openApp(page, {}, fix)
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-live"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  if (freeze) await jump(page, 0)
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

test('只有三個動作（−15／＋15／略過），沒有時長選擇；每次開始都是 1:30，調過的不會被記住', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  await expect(barText(page)).toHaveText('1:30')
  await expect(bar(page).getByRole('button'), '倒數中只有三顆鈕').toHaveText(['−15', '＋15', '略過'])

  await btn(page, '加 15 秒').click()
  await expect(barText(page)).toHaveText('1:45')
  await btn(page, '略過休息').click()
  await tick(page, 1)
  await expect(barText(page), '調過的時長不留到下一輪').toHaveText('1:30')

  await page.reload()
  await page.locator('.tab[aria-label="訓練"]').click()
  await page.locator('.tr-row[data-workout-id="w-live"]').click()
  await expect(page.locator('.ex .set')).toHaveCount(3)
  await tick(page, 2)
  await expect(barText(page), '重新載入後也是 1:30').toHaveText(/^1:(30|29)$/)
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
  await openLive(page, false) // 這條自己用 pauseAt／setFixedTime 控時間，不先定住
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

test('倒數條浮在底部列上方的深色 pill：不佔版面（列表高度不變）、疊在列表上、不蓋住底部列；最後一張卡捲得到條的上方', async ({ page }) => {
  await prepare(page)
  await openLive(page, true, LONG)
  const scroll = page.locator('[data-screen="training-session"] .tr-scroll')
  const before = (await scroll.boundingBox())!.height
  await tick(page, 0)
  await expect(bar(page)).toBeVisible()
  await page.waitForTimeout(400) // 進場位移跑完，量到的才是落定的位置
  const s = (await scroll.boundingBox())!
  const b = (await bar(page).boundingBox())!
  const bottom = (await page.locator('.tr-bottom').boundingBox())!
  expect(s.height, '浮動：不走版面流，列表高度不變').toBe(before)
  expect(b.y, '疊在列表區域上').toBeLessThan(s.y + s.height)
  expect(b.y + b.height, '在底部列上方').toBeLessThanOrEqual(bottom.y + 1)
  expect(bottom.y - (b.y + b.height), '與底部列留一點間距').toBeGreaterThanOrEqual(6)
  const dark = await page.evaluate(() => {
    const d = document.createElement('div')
    d.style.background = 'var(--ink)'
    document.body.append(d)
    const c = getComputedStyle(d).backgroundColor
    d.remove()
    return c
  })
  expect(await bar(page).evaluate((el) => getComputedStyle(el).backgroundColor), '底色是 --ink（深色，跟動作卡分開）').toBe(dark)
  expect(await bar(page).evaluate((el) => getComputedStyle(el).boxShadow), '有陰影，浮起來').not.toBe('none')
  for (const x of await bar(page).getByRole('button').all()) {
    expect((await x.boundingBox())!.height, '觸控下限 44px').toBeGreaterThanOrEqual(44)
  }

  // 條出現時列表多留底部空間：捲到最底，最後一張卡的下緣在條的上方
  const pad = await scroll.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
  expect(pad, '底部留白 ≥ 條高＋間距').toBeGreaterThanOrEqual(b.height + 8)
  expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight), '列表真的長到要捲，下面「最後一張卡在條上方」才有意義').toBe(true)
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(200)
  const last = (await page.locator('.ex').last().boundingBox())!
  expect(last.y + last.height, '最後一張卡沒被條蓋住').toBeLessThanOrEqual(b.y + 1)
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

/* ── RPE 問題列（spec.md「階段 4 乙」）：一個動作的最後一組勾完，休息條長高成兩列 ───────────────── */
const ask = (page: Page) => page.locator('.tr-rest [data-rpe-ask]')
const chip = (page: Page, name: string) => ask(page).getByRole('button', { name, exact: true })
const rpeWrites = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __writes: { table: string; method: string; body: Record<string, unknown> }[] }).__writes
      .filter((w) => w.table === 'workout_sets' && w.method === 'PATCH' && w.body && 'rpe' in w.body)
      .map((w) => w.body.rpe),
  )

/** 只有一組的進行中訓練。 */
const ONE_SET: typeof FIX = { ...LIVE, workout_sets: [LIVE.workout_sets[0]] }

test('最後一組勾完才問：前兩組不問；問題與四顆 chip 在條上、倒數照走', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  await expect(bar(page)).toBeVisible()
  await expect(ask(page), '第 1 組不是最後一組').toHaveCount(0)
  await tick(page, 2) // 先勾第 3 組：第 2 組還沒做，所以也不是做完
  await expect(ask(page)).toHaveCount(0)
  await tick(page, 1) // 這一下做完了整個動作
  await expect(ask(page)).toBeVisible()
  await expect(ask(page)).toContainText('最後一組還能再做幾下')
  await expect(ask(page).getByRole('button')).toHaveText(['3 下以上', '2 下', '1 下', '力竭'])
  await expect(barText(page), '倒數照常').toHaveText('1:30')
  await expect(btn(page, '略過休息')).toBeVisible()
})

for (const [label, value] of [['3 下以上', 7], ['2 下', 8], ['1 下', 9], ['力竭', 10]] as const) {
  test(`點「${label}」寫入 rpe＝${value}：只寫那一組、選中的標示起來、問題列收起、倒數續跑`, async ({ page }) => {
    await prepare(page)
    await openLive(page)
    await tick(page, 0)
    await tick(page, 1)
    await tick(page, 2)
    await chip(page, label).click()
    await expect(chip(page, label)).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => rpeWrites(page)).toEqual([value])
    const patched = await page.evaluate(() =>
      (window as unknown as { __writes: { table: string; method: string; path: string; body: Record<string, unknown> }[] }).__writes.filter(
        (w) => w.method === 'PATCH' && w.body && 'rpe' in w.body,
      ).map((w) => w.path),
    )
    expect(patched[0], '寫的是剛勾完的第 3 組').toContain('s-3')
    await expect(ask(page), '約 0.6 秒後問題列收起').toHaveCount(0)
    await expect(bar(page)).toBeVisible()
    await expect(barText(page)).toHaveText('1:30')
  })
}

test('不點就不寫、不追問：條照常倒數，略過收整條；取消勾再勾回來會再問', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  await tick(page, 1)
  await tick(page, 2)
  await expect(ask(page)).toBeVisible()
  await jump(page, 20_000)
  await expect(barText(page)).toHaveText('1:10')
  await expect(ask(page), '沒點就一直留到條收起').toBeVisible()
  expect(await rpeWrites(page)).toEqual([])
  await btn(page, '略過休息').click()
  await expect(bar(page)).toHaveCount(0)

  await tick(page, 2) // 取消勾
  await tick(page, 2) // 再勾回來：RPE 仍是空的，再問一次
  await expect(ask(page)).toBeVisible()
  expect(await rpeWrites(page), '全程沒有任何 rpe 寫入').toEqual([])
})

test('問題還在時取消勾、新增一組：問題列都收掉，不會把 RPE 寫到沒做的組', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  for (const n of [0, 1, 2]) await tick(page, n)
  await expect(ask(page)).toBeVisible()
  await tick(page, 2) // 直接取消勾（不先按略過）
  await expect(ask(page)).toHaveCount(0)
  await tick(page, 2)
  await expect(ask(page)).toBeVisible()
  await page.locator('.ex').getByRole('button', { name: '新增一組' }).click()
  await expect(ask(page), '多了一組沒做的，這個動作不算做完').toHaveCount(0)
  expect(await rpeWrites(page)).toEqual([])
})

test('休息條答 9 之後，組編輯 sheet 裡 RPE 9 是高亮的', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  for (const n of [0, 1, 2]) await tick(page, n)
  await chip(page, '1 下').click()
  await expect(ask(page)).toHaveCount(0)
  await page.locator('.ex .set').nth(2).locator('.w').click()
  const sheet = page.locator('[data-screen="set-sheet"]')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'RPE 9' })).toHaveAttribute('aria-pressed', 'true')
})

test('已經有 RPE 的組重勾不再問', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await tick(page, 0)
  await tick(page, 1)
  await tick(page, 2)
  await chip(page, '1 下').click()
  await expect(ask(page)).toHaveCount(0)
  await tick(page, 2) // 取消勾
  await tick(page, 2) // 再勾回來
  await expect(bar(page)).toBeVisible()
  await expect(ask(page), '這一組已經有 RPE 9').toHaveCount(0)
})

test('全部完成不問（沒有「剛做完一組」的語意，也不開倒數）', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  await page.locator('.ex').getByRole('button', { name: '全部完成', exact: true }).click()
  await expect(page.locator('.ex').getByRole('button', { name: '取消全部完成', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(bar(page)).toHaveCount(0)
  await expect(ask(page)).toHaveCount(0)
})

test('只有一組的動作：勾完就問', async ({ page }) => {
  await prepare(page)
  await openApp(page, {}, ONE_SET)
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-live"]').click()
  await expect(page.locator('.ex .set')).toHaveCount(1)
  await jump(page, 0)
  await tick(page, 0)
  await expect(ask(page)).toBeVisible()
})

test('問題列出現時列表底部多留白：最後一張卡捲得到條的上方', async ({ page }) => {
  await prepare(page)
  await openLive(page, true, LONG)
  await tick(page, 0)
  await tick(page, 1)
  await tick(page, 2)
  await expect(ask(page)).toBeVisible()
  await page.waitForTimeout(400) // 問題列展開與列表留白的過渡都跑完再量，量到的才是落定後的值
  const gap = await page.evaluate(() => {
    const sc = document.querySelector('[data-screen="training-session"] .tr-scroll') as HTMLElement
    if (sc.scrollHeight <= sc.clientHeight) throw new Error('列表沒有長到要捲：這條沒有量到東西')
    const bar = document.querySelector('.tr-rest') as HTMLElement
    sc.scrollTop = sc.scrollHeight
    const lastCard = Array.from(sc.querySelectorAll('.ex')).at(-1) as HTMLElement
    return bar.getBoundingClientRect().top - lastCard.getBoundingClientRect().bottom
  })
  expect(gap, '捲到底時最後一張卡在條的上緣之上，不被蓋住').toBeGreaterThanOrEqual(0)
})

test('減少動態：問題列照出現、點了照寫入，收起只淡出', async ({ page }) => {
  await prepare(page, { reduced: true })
  await openLive(page)
  await tick(page, 0)
  await tick(page, 1)
  await tick(page, 2)
  await expect(ask(page)).toBeVisible()
  await chip(page, '2 下').click()
  await expect.poll(() => rpeWrites(page)).toEqual([8])
  await expect(ask(page)).toHaveCount(0)
})

test('已結束的訓練沒有 RPE 頁尾', async ({ page }) => {
  await prepare(page)
  await openApp(page, {}, FINISHED)
  await openTraining(page)
  await page.locator('.tr-row[data-workout-id="w-1"]').click()
  await expect(page.locator('[data-screen="training-session"]')).toBeVisible()
  await expect(page.locator('.ex [data-section="ex-rpe"]'), '已結束的訓練沒有頁尾').toHaveCount(0)
})

/* ── 動作卡的 RPE 頁尾（DESIGN v2.86）：每一組都打勾後固定長在卡片最底 ──────────────────────────── */
const footer = (page: Page) => page.locator('.ex [data-section="ex-rpe"]')
const fchip = (page: Page, name: string) => footer(page).getByRole('button', { name, exact: true })
const addSetTop = (page: Page) => page.locator('.ex .tr-addset').evaluate((el) => el.getBoundingClientRect().top)

test('頁尾：每一組都打勾才出現；「新增一組」的位置從頭到尾不動；沒填時狀態字是「還沒填」、四顆 chip 都沒亮', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  const top = await addSetTop(page)
  await tick(page, 0)
  await tick(page, 1)
  await expect(footer(page), '還有一組沒做').toHaveCount(0)
  await tick(page, 2)
  await expect(footer(page)).toBeVisible()
  await page.waitForTimeout(400) // 長出來的過渡跑完
  expect(await addSetTop(page), '頁尾長在「新增一組」下面，不把它往下推').toBeCloseTo(top, 0)
  await expect(footer(page).locator('.st')).toHaveText('還沒填')
  await expect(footer(page).getByRole('button')).toHaveText(['3 下以上', '2 下', '1 下', '力竭'])
  await expect(footer(page).locator('[aria-pressed="true"]')).toHaveCount(0)
})

test('頁尾點 chip：寫在最後一組、選中標起來、狀態字變 RPE 值，頁尾高度前後不變；改答案寫成新值', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  for (const n of [0, 1, 2]) await tick(page, n)
  await btn(page, '略過休息').click() // 不讓休息條的問題列干擾
  await page.waitForTimeout(400)
  const h = await footer(page).evaluate((el) => el.getBoundingClientRect().height)
  await fchip(page, '2 下').click()
  await expect(fchip(page, '2 下')).toHaveAttribute('aria-pressed', 'true')
  await expect(fchip(page, '2 下'), '視覺上的選中（淡綠底）').toHaveClass(/is-on/)
  await expect(footer(page).locator('.st')).toHaveText('RPE 8')
  await expect.poll(() => rpeWrites(page)).toEqual([8])
  const patched = await page.evaluate(() =>
    (window as unknown as { __writes: { method: string; path: string; body: Record<string, unknown> }[] }).__writes.filter((w) => w.method === 'PATCH' && w.body && 'rpe' in w.body).map((w) => w.path),
  )
  expect(patched[0], '寫的是最後一組').toContain('s-3')
  expect(await footer(page).evaluate((el) => el.getBoundingClientRect().height), '填完前後高度不變').toBeCloseTo(h, 0)
  await fchip(page, '力竭').click()
  await expect(fchip(page, '力竭')).toHaveAttribute('aria-pressed', 'true')
  await expect(fchip(page, '2 下')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => rpeWrites(page)).toEqual([8, 10])
})

test('頁尾改答案時，同動作其他組（sheet 填過的）的 RPE 一併清掉：只剩一個 RPE', async ({ page }) => {
  await prepare(page)
  const withOld: typeof FIX = { ...LIVE, workout_sets: LIVE.workout_sets.map((x, i) => (i === 0 ? { ...x, rpe: 8 } : x)) }
  await openLive(page, true, withOld)
  for (const n of [0, 1, 2]) await tick(page, n)
  await btn(page, '略過休息').click()
  await expect(footer(page).locator('.st'), '第 1 組在 sheet 填過 8，取各組最大值').toHaveText('RPE 8')
  await expect(fchip(page, '2 下')).toHaveAttribute('aria-pressed', 'true')
  await fchip(page, '1 下').click()
  await expect.poll(() => rpeWrites(page)).toEqual([null, 9]) // 先清第 1 組、再寫最後一組
  await expect(footer(page).locator('.st')).toHaveText('RPE 9')
})

test('頁尾收合時也在：收起卡片後頁尾還在、照樣能點；漏填的看得出', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  for (const n of [0, 1, 2]) await tick(page, n)
  await btn(page, '略過休息').click()
  await page.locator('.ex .ex-toggle').click()
  await expect(page.locator('.ex.collapsed')).toHaveCount(1)
  await expect(page.locator('.ex.collapsed [data-section="ex-rpe"]')).toBeVisible()
  await expect(page.locator('.ex.collapsed [data-section="ex-rpe"] .st')).toHaveText('還沒填')
  await fchip(page, '1 下').click()
  await expect.poll(() => rpeWrites(page)).toEqual([9])
  await expect(page.locator('.ex.collapsed [data-section="ex-rpe"] .st')).toHaveText('RPE 9')
})

test('頁尾：按「新增一組」就收掉（動作又不算做完了）；休息條答的值頁尾也看得到', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  for (const n of [0, 1, 2]) await tick(page, n)
  await chip(page, '1 下').click() // 休息條答 9
  await expect(fchip(page, '1 下')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.ex').getByRole('button', { name: '新增一組' }).click()
  await expect(footer(page)).toHaveCount(0)
})

test('頁尾先答：休息條上的同一題跟著收起，不會兩邊狀態不同', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  for (const n of [0, 1, 2]) await tick(page, n)
  await expect(ask(page)).toBeVisible()
  await fchip(page, '2 下').click()
  await expect(fchip(page, '2 下')).toHaveAttribute('aria-pressed', 'true')
  await expect(ask(page), '條上同一題也收了').toHaveCount(0)
  await expect(bar(page)).toBeVisible()
  await expect.poll(() => rpeWrites(page)).toEqual([8])
})

test('問題還在時：亂序勾完後取消勾別組、取消全部完成，問題列都收掉，不會寫到沒打勾的組', async ({ page }) => {
  await prepare(page)
  await openLive(page)
  for (const n of [2, 0, 1]) await tick(page, n) // 最後勾的是第 2 組，題目掛在它身上
  await expect(ask(page)).toBeVisible()
  await tick(page, 2) // 取消勾的是別組（第 3 組），動作不算做完了
  await expect(ask(page)).toHaveCount(0)
  await tick(page, 2)
  await expect(ask(page), '再勾回來又做完了，重新問').toBeVisible()
  await page.locator('.ex').getByRole('button', { name: '取消全部完成', exact: true }).click()
  await expect(ask(page)).toHaveCount(0)
  expect(await rpeWrites(page)).toEqual([])
})

/* ── 有氧卡（spec「有氧併入動作」AC 6）：沒有組，所以休息條、RPE（頁尾與條上的問題）、重量建議、全部完成、新增一組都碰不到 ── */
const WALK = (() => {
  const row = SEEDED_FIX.exercises.find((e) => e.name === '跑步機坡度健走')
  if (!row) throw new Error('目錄裡沒有「跑步機坡度健走」')
  return row as Record<string, unknown> & { id: string }
})()

/** 進行中的訓練：腿推舉三組（同 LIVE）＋一張還沒填的坡度健走卡。 */
const WITH_CARDIO: typeof FIX = {
  ...LIVE,
  exercises: [...FIX.exercises, WALK],
  workout_exercises: [
    ...LIVE.workout_exercises,
    { id: 'we-walk', workout_id: 'w-live', exercise_id: WALK.id, position: 1, minutes: null, speed_kmh: null, incline_pct: null, est_kcal: null },
  ],
}

test('有氧卡：沒有組、全部完成、新增一組、RPE 頁尾；點它開的是有氧 sheet（沒有重量建議），存檔不開休息條', async ({ page }) => {
  await prepare(page)
  await openLive(page, true, WITH_CARDIO)
  const cardio = page.locator('.ex.is-cardio')
  await expect(cardio).toHaveCount(1)
  await expect(cardio.locator('.set')).toHaveCount(0)
  await expect(cardio.getByRole('button', { name: '全部完成', exact: true })).toHaveCount(0)
  await expect(cardio.getByRole('button', { name: '新增一組' })).toHaveCount(0)
  await expect(cardio.locator('[data-section="ex-rpe"]')).toHaveCount(0)

  await cardio.locator('.ex-toggle').click()
  const sheet = page.locator('[data-screen="cardio-sheet"]')
  await expect(sheet).toBeVisible()
  await expect(page.locator('[data-screen="set-sheet"]'), '不是組編輯 sheet').toHaveCount(0)
  await expect(page.locator('[data-section="suggest"]'), '沒有重量建議').toHaveCount(0)
  await sheet.getByRole('textbox', { name: '分鐘', exact: true }).fill('30')
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(cardio.locator('.cardio-sum')).toHaveText('30 分')
  await expect(bar(page), '記了有氧不開休息條').toHaveCount(0)
  await expect(cardio.locator('[data-section="ex-rpe"]'), '填了分鐘也不問 RPE').toHaveCount(0)

  // 對照：同一頁的重訓卡勾組照常開休息條、三組勾完照常長頁尾——這頁的休息條與頁尾是活的，上面的「沒有」才有意義
  for (const n of [0, 1, 2]) await tick(page, n)
  await expect(bar(page)).toBeVisible()
  await expect(page.locator('.ex', { hasText: '腿推舉' }).locator('[data-section="ex-rpe"]')).toBeVisible()
  await expect(cardio.locator('[data-section="ex-rpe"]')).toHaveCount(0)
})
