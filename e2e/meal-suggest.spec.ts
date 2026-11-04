/* 餐建議 R 與營養素條「差 N」（spec.md C 節）。日期規則不能賭跑測當天是星期幾，
   所以開場一律用 openAppAt 釘住「今天」。預期值手算。 */
import { test, expect, type Page } from '@playwright/test'
import { FIX } from './fixtures'
import { deleteViaTap, gotoDate, openAppAt } from './harness'

/* ── 餐建議 R ── */

interface StubWindow {
  __writes: { path: string; table: string; method: string; body: unknown }[]
  __allFetches: string[]
  __intakeCalls: string[]
  __failNext: { table: string; method: string } | null
  __writeDelayMs: number
  __repeatFail: boolean
  __repeatServed: number
  __holdIntake: Set<string>
  __heldIntake: (() => void)[]
  __releaseIntake: () => void
  __failIntake: Set<string>
}

/** 來源列。food_id 一定要有：fix.intake 的列沒有這欄，落進回看區間會變成 food_id 是 undefined 的建議，
 *  所以會被回看到的 intake 列也用這支組。 */
const srcRow = (id: number, eaten_on: string, meal: string, food_id: number, qty = 1) => {
  const f = FIX.foods.find((x) => x.id === food_id)!
  return {
    id,
    eaten_on,
    meal,
    food_id,
    qty,
    kcal: f.kcal,
    protein: f.protein,
    fat: f.fat,
    carb: f.carb,
    name: null,
    created_at: `${eaten_on}T01:00:00.000Z`,
    foods: { name: f.name, vendor: f.vendor, archived: false },
  }
}

const fixWith = (repeatWindow: unknown[], intake: unknown[] = []) =>
  ({ ...FIX, intake, intakeYday: [], repeatWindow }) as unknown as typeof FIX

/* 平日的固定資料：11-02 是週一。較近的 11-01 是週日（誘餌），要跨月跳到 10-30（週五）。
   乳清 120×2 ＋ 豆漿 90 ＝ 330。 */
const MON = '2026-11-02'
const TUE = '2026-11-03'
const WEEKDAY_LABEL = '乳清（1匙） ×2・無糖豆漿'
const WEEKDAY_SRC = [
  srcRow(301, '2026-11-01', 'breakfast', 14),
  srcRow(302, '2026-10-30', 'breakfast', 13, 2),
  srcRow(303, '2026-10-30', 'breakfast', 15),
]
const WEEKDAY_POST_BODY = [
  { eaten_on: MON, meal: 'breakfast', food_id: 13, qty: 2, kcal: 120, protein: 24, fat: 1.5, carb: 2, name: null },
  { eaten_on: MON, meal: 'breakfast', food_id: 15, qty: 1, kcal: 90, protein: 8, fat: 4, carb: 5, name: null },
]

const nodeOf = (page: Page, label: string) => page.locator('.timeline .node').filter({ hasText: label })
const cardOf = (page: Page, label: string) => nodeOf(page, label).locator('.sg')
const addOf = (page: Page, label: string) => cardOf(page, label).locator('.sg-add')
const items = (page: Page) => page.locator('.timeline .item')
const undoBtn = (page: Page) => page.locator('.undo-bar button')

const intakeWrites = (page: Page, method: string) =>
  page.evaluate((m) => (window as unknown as StubWindow).__writes.filter((w) => w.table === 'intake' && w.method === m), method)

const setWriteDelay = (page: Page, ms: number) =>
  page.evaluate((v) => {
    ;(window as unknown as StubWindow).__writeDelayMs = v
  }, ms)

/** 「伺服器上」現在有哪些 id，不經過 App（intakePersist 才有意義）。 */
const serverIds = (page: Page, date: string) =>
  page.evaluate(async (d) => {
    const res = await fetch(`https://stub.supabase.co/rest/v1/intake?select=id&eaten_on=eq.${d}`)
    return ((await res.json()) as { id: number }[]).map((r) => r.id)
  }, date)

const repeatFetchCount = (page: Page, day: string) =>
  page.evaluate((d) => (window as unknown as StubWindow).__allFetches.filter((u) => u.includes(`eaten_on=gte.${d}`)).length, day)

/** 等某個方法的 intake 寫入送出（還沒回應）。請求發出才能把延遲歸零，點完立刻歸零可能排在 fetch 之前。 */
const waitWriteSent = (page: Page, method: string, n = 1) =>
  expect.poll(async () => (await intakeWrites(page, method)).length).toBeGreaterThanOrEqual(n)

const intakeListCalls = (page: Page, d: string) =>
  page.evaluate((x) => (window as unknown as StubWindow).__intakeCalls.filter((c) => c === x).length, d)

const isLocked = (locator: ReturnType<Page['locator']>) => expect(locator).toHaveAttribute('aria-disabled', 'true')
const isUnlocked = (locator: ReturnType<Page['locator']>) => expect(locator).not.toHaveAttribute('aria-disabled', 'true')

test('一鍵加入：一次寫入全部品項、欄位取自來源、品項長出、建議消失', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))

  const card = cardOf(page, '早餐')
  await expect(card.locator('.sg-src')).toHaveText('上次')
  await expect(card.locator('.sg-items')).toHaveText(WEEKDAY_LABEL)
  await expect(card.locator('.sg-kc')).toHaveText('330')
  await expect(addOf(page, '早餐')).toHaveAttribute('aria-label', `加入上次的早餐：${WEEKDAY_LABEL}，330 卡`)
  await expect(page.locator('.timeline .sg'), '只有早餐有來源，別餐不該有建議').toHaveCount(1)

  // 視覺 36px、命中區 ≥44：上下緣外 3px 還是按得到，且不會蓋到列外
  const hit = await addOf(page, '早餐').evaluate((btn) => {
    const r = btn.getBoundingClientRect()
    const x = r.left + r.width / 2
    const isBtn = (y: number) => document.elementFromPoint(x, y)?.closest('.sg-add') === btn
    return { h: r.height, w: r.width, above: isBtn(r.top - 3), below: isBtn(r.bottom + 3), row: btn.closest('.sg')!.getBoundingClientRect().height }
  })
  expect(hit).toEqual({ h: 36, w: hit.w, above: true, below: true, row: 44 })
  expect(hit.w).toBeGreaterThanOrEqual(44)
  // 有建議的那餐比沒建議的高多少（時間軸被推的量，DESIGN「今日頁的餐建議」）：列 44 ＋ 上距 --s-1
  const bodyH = (label: string) => nodeOf(page, label).locator('.node-body').evaluate((n) => n.getBoundingClientRect().height)
  expect((await bodyH('早餐')) - (await bodyH('午餐'))).toBe(48)

  // 閃爍只有 1.3 秒，機器忙時來回一趟可能就過了：在頁內記下有沒有掛上、動畫有沒有跑
  await page.evaluate(() => {
    const seen = { count: 0, names: [] as string[] }
    ;(window as unknown as { __flash: typeof seen }).__flash = seen
    new MutationObserver(() => {
      const els = document.querySelectorAll('.item-content.just-added')
      if (els.length === 0) return
      seen.count = Math.max(seen.count, els.length)
      seen.names = els[0].getAnimations({ subtree: true }).map((a) => (a as CSSAnimation).animationName)
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
  })

  await addOf(page, '早餐').click()

  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(nodeOf(page, '早餐').locator('.item .kc')).toHaveText(['240', '90'])
  await expect(page.locator('.timeline .sg'), '該餐一有紀錄，建議就消失').toHaveCount(0)
  await expect(page.locator('.gauge-side .cur')).toHaveText('330')
  expect((await intakeWrites(page, 'POST')).map((w) => w.body)).toEqual([WEEKDAY_POST_BODY])

  await expect(undoBtn(page)).toHaveAttribute('aria-label', '復原剛加入的 2 筆')
  await expect(page.locator('.undo-bar .sr-only')).toHaveText('已加入 2 筆')
  await expect(page.locator('.undo-bar'), '進場動畫要走完（page.clock 接管 rAF 時）').toHaveCSS('opacity', '1')

  // 閃爍：掛上兩列、flash 動畫有跑（page.clock 接管計時器時），之後由計時器清掉
  const flash = await page.evaluate(() => (window as unknown as { __flash: { count: number; names: string[] } }).__flash)
  expect(flash.count).toBe(2)
  expect(flash.names).toContain('flash')
  await expect(page.locator('.item-content.just-added')).toHaveCount(0)

  // 窗到期只收提示條，不打網路：列已經寫入了
  await expect(page.locator('.undo-bar')).toHaveCount(0, { timeout: 8000 })
  expect(await intakeWrites(page, 'DELETE')).toEqual([])
  await expect(items(page)).toHaveCount(2)
})

test('復原：刪掉全部剛寫入的列、建議回來、途中切走切回不畫回來、之後切走切回不復活', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)
  const ids = await serverIds(page, MON)
  expect(ids).toHaveLength(2)
  // 讓快取存下這天（已含新列），DELETE 送出中切回來才會命中快取
  await setWriteDelay(page, 4000)
  await undoBtn(page).click()
  await expect(items(page)).toHaveCount(0)
  await expect(page.locator('.undo-bar')).toHaveCount(0)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText(WEEKDAY_LABEL)

  // DELETE 還在路上：切走再切回，快取裡還有這兩筆，一幀都不可以畫回來。用 MutationObserver 記，輪詢會被成功後的濾除蓋過去
  await page.evaluate(() => {
    const w = window as unknown as { __itemPeak: number }
    w.__itemPeak = 0
    new MutationObserver(() => {
      w.__itemPeak = Math.max(w.__itemPeak, document.querySelectorAll('.timeline .item').length)
    }).observe(document.body, { subtree: true, childList: true })
  })
  await gotoDate(page, TUE)
  await gotoDate(page, MON)
  await expect(page.locator('.datectl-day[aria-pressed="true"]')).toHaveAttribute('data-date', MON)
  expect(await serverIds(page, MON), '切走切回時 DELETE 應該還沒落地，否則這段沒驗到').toHaveLength(2)
  expect(await page.evaluate(() => (window as unknown as { __itemPeak: number }).__itemPeak), '送出中被畫回來').toBe(0)

  await expect.poll(() => serverIds(page, MON), { timeout: 8000 }).toEqual([])
  const deletes = await intakeWrites(page, 'DELETE')
  expect(deletes).toHaveLength(1)
  expect(decodeURIComponent(deletes[0].path)).toContain(`id=in.(${ids.join(',')})`)

  await setWriteDelay(page, 0)
  await gotoDate(page, TUE)
  await gotoDate(page, MON)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText(WEEKDAY_LABEL)
  await expect(items(page)).toHaveCount(0)
})

test('平日：跳過較近的假日、跨月取上一個平日', async ({ page }) => {
  await openAppAt(page, MON, {}, fixWith(WEEKDAY_SRC))
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText(WEEKDAY_LABEL)
  await expect(cardOf(page, '早餐').locator('.sg-kc')).toHaveText('330')
})

test('假日：跳過較近的平日取上一個假日', async ({ page }) => {
  // 11-07 是週六。誘餌 11-06（週五）拿鐵；來源 11-01（週日）香蕉 105×2 ＝ 210
  const src = [srcRow(301, '2026-11-06', 'breakfast', 18), srcRow(302, '2026-11-01', 'breakfast', 17, 2)]
  await openAppAt(page, '2026-11-07', {}, fixWith(src))
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText('香蕉 ×2')
  await expect(cardOf(page, '早餐').locator('.sg-kc')).toHaveText('210')
})

test('該餐已有紀錄：今日頁與 sheet 都沒有建議', async ({ page }) => {
  const src = [srcRow(301, '2026-10-30', 'breakfast', 13), srcRow(302, '2026-10-30', 'lunch', 11)]
  await openAppAt(page, MON, {}, fixWith(src, [srcRow(101, MON, 'breakfast', 13)]))
  await expect(cardOf(page, '午餐'), '沒紀錄的午餐有建議，表示回看資料到了').toHaveCount(1)
  await expect(cardOf(page, '早餐')).toHaveCount(0)

  // sheet 也開得起來、關得掉（page.clock 接管計時器時 SpringSheet 的動畫要能落定）
  await nodeOf(page, '早餐').locator('.node-head').click()
  const sheet = page.locator('[data-screen="log-sheet"]')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('.sect-suggest')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('寫入失敗：就地錯誤、卡片還在、重試只成功寫入一次', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'POST' }
  })
  await addOf(page, '早餐').click()

  await expect(nodeOf(page, '早餐').locator('[role="alert"]')).toHaveText('存不進去：模擬的寫入失敗')
  await expect(addOf(page, '早餐')).toHaveText('重試')
  await expect(addOf(page, '早餐')).toHaveAttribute('aria-label', `重試加入上次的早餐：${WEEKDAY_LABEL}，330 卡`)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText(WEEKDAY_LABEL)
  await expect(page.locator('.undo-bar')).toHaveCount(0)
  await expect(items(page)).toHaveCount(0)

  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)
  await expect(nodeOf(page, '早餐').locator('[role="alert"]')).toHaveCount(0)
  expect((await intakeWrites(page, 'POST')).map((w) => w.body)).toEqual([WEEKDAY_POST_BODY, WEEKDAY_POST_BODY])
  expect(await serverIds(page, MON), '失敗那次不算，只有重試那批落地').toHaveLength(2)
})

test('連按加入只寫入一次，進行中所有建議都不能按', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith([...WEEKDAY_SRC, srcRow(304, '2026-10-30', 'lunch', 11)]))
  await setWriteDelay(page, 1500)
  // 同一個 task 連發：React 還沒 render，鎖住的樣子還沒掛上，只剩同步鎖擋得住（兩次 Playwright click 測不到這段，見 wiki lesson-flaky 第 7 條）
  await addOf(page, '早餐').evaluate((btn: HTMLElement) => {
    btn.click()
    btn.click()
  })
  await expect(addOf(page, '早餐')).toHaveText('加入中…')
  await isLocked(addOf(page, '早餐'))
  await expect(addOf(page, '午餐')).toHaveText('加入')
  await isLocked(addOf(page, '午餐'))

  await expect(items(page)).toHaveCount(2)
  await isUnlocked(addOf(page, '午餐'))
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
  expect(await serverIds(page, MON)).toHaveLength(2)
})

test('復原途中切日期：別天不被動、回原日那幾筆已消失', async ({ page }) => {
  const src = [...WEEKDAY_SRC, srcRow(401, TUE, 'lunch', 11)]
  await openAppAt(page, MON, { intakePersist: true }, fixWith(src))
  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)

  await setWriteDelay(page, 3000)
  await undoBtn(page).click()
  await gotoDate(page, TUE)
  await expect(nodeOf(page, '午餐').locator('.item .nm')).toHaveText(['雞胸餐盒'])
  expect(await serverIds(page, MON), '切過去時 DELETE 應該還沒落地，否則這段沒驗到').toHaveLength(2)

  // 成功分支會 invalidate 那天，TUE 的視窗涵蓋它所以會重抓一次：等到這次才算 App 走完成功分支
  const before = await repeatFetchCount(page, MON)
  await expect.poll(() => repeatFetchCount(page, MON), { timeout: 8000 }).toBeGreaterThan(before)
  await expect(nodeOf(page, '午餐').locator('.item .nm')).toHaveText(['雞胸餐盒'])
  await expect(items(page)).toHaveCount(1)
  await expect(page.locator('.gauge-side .cur')).toHaveText('420')

  await setWriteDelay(page, 0)
  await gotoDate(page, MON)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText(WEEKDAY_LABEL)
  await expect(items(page)).toHaveCount(0)
})

test('復原失敗：Notice、重試送同一批 id、成功後列消失且切走切回不復活', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)

  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'DELETE' }
  })
  await undoBtn(page).click()
  await expect(page.locator('.notice .headline')).toHaveText('復原不了，剛加入的還在')
  expect(await serverIds(page, MON)).toHaveLength(2)

  await page.locator('.notice .action-btn').click()
  await expect(page.locator('.notice')).toHaveCount(0)
  await expect.poll(() => serverIds(page, MON)).toEqual([])
  const deletes = await intakeWrites(page, 'DELETE')
  expect(deletes).toHaveLength(2)
  expect(deletes[1].path).toBe(deletes[0].path)
  await expect(items(page)).toHaveCount(0)

  await gotoDate(page, TUE)
  await gotoDate(page, MON)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText(WEEKDAY_LABEL)
  await expect(items(page)).toHaveCount(0)
})

test('加入窗內刪一筆：提示條轉給那筆，復原只救回它', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)
  await expect(undoBtn(page)).toHaveAttribute('aria-label', '復原剛加入的 2 筆')

  await deleteViaTap(page, 0)
  await expect(undoBtn(page)).toHaveAttribute('aria-label', '復原剛刪除的一筆')
  await expect(page.locator('.undo-bar .sr-only')).toHaveText('已刪除')
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['無糖豆漿'])

  await undoBtn(page).click()
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(page.locator('.undo-bar')).toHaveCount(0)
  expect(await intakeWrites(page, 'DELETE')).toEqual([])
  expect(await serverIds(page, MON)).toHaveLength(2)
})

test('待刪中按加入：DELETE 先於 POST', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC, [srcRow(101, MON, 'lunch', 11)]))
  await expect(cardOf(page, '早餐')).toHaveCount(1)
  await deleteViaTap(page, 0)
  await expect(undoBtn(page)).toHaveAttribute('aria-label', '復原剛刪除的一筆')

  await addOf(page, '早餐').click()
  const order = () =>
    page.evaluate(() => (window as unknown as StubWindow).__writes.filter((w) => w.table === 'intake').map((w) => w.method))
  await expect.poll(order).toEqual(['DELETE', 'POST'])
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(undoBtn(page)).toHaveAttribute('aria-label', '復原剛加入的 2 筆')
  expect((await serverIds(page, MON)).includes(101), '待刪那筆真的送出了').toBe(false)
})

test('查詢失敗：無建議、無 Notice、今日頁照常，之後換日可再試', async ({ page }) => {
  await openAppAt(page, MON, { repeatFail: true }, fixWith(WEEKDAY_SRC))
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__repeatServed)).toBeGreaterThan(0)
  // stub 回應之後到 App 收到還隔幾個 task；量不到「App 收到了」，留一段夠長的時間，否則 .notice 為 0 可能只是還沒輪到它
  await page.waitForTimeout(300)
  await expect(page.locator('.timeline .todo-row')).toHaveCount(4)
  await expect(page.locator('.timeline .sg')).toHaveCount(0)
  await expect(page.locator('.notice')).toHaveCount(0)
  await expect(page.locator('.gauge-num')).not.toHaveText('—')

  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__repeatFail = false
  })
  await gotoDate(page, TUE)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText(WEEKDAY_LABEL)
})

test('今天加入後切明天：來源是今天', async ({ page }) => {
  /* 10-19 是週一，從 MON 回看剛好第 14 天，從 TUE 回看就超界：TUE 的早餐建議只可能來自 MON。
     午餐的來源兩邊都看得到，它出現就代表回看資料到了。 */
  const src = [srcRow(301, '2026-10-19', 'breakfast', 13), srcRow(302, '2026-10-30', 'lunch', 11)]
  await openAppAt(page, MON, { intakePersist: true }, fixWith(src))
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText('乳清（1匙）')

  // 先切明天再切回：讓回看資料存下「今天＝沒紀錄」，之後沒 invalidate 就會一直用這份舊的
  await gotoDate(page, TUE)
  await expect(cardOf(page, '午餐')).toHaveCount(1)
  await expect(cardOf(page, '早餐'), '10-19 對明天已超界').toHaveCount(0)
  await gotoDate(page, MON)

  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(1)

  await gotoDate(page, TUE)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText('乳清（1匙）')
})

test('寫入中切日期再切回：不重複寫入、畫面不卡載入中', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  const callsOf = (d: string) => page.evaluate((x) => (window as unknown as StubWindow).__intakeCalls.filter((c) => c === x).length, d)
  const before = await callsOf(MON)
  await setWriteDelay(page, 1500)
  await addOf(page, '早餐').click()
  await gotoDate(page, TUE)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)

  // POST 與重撈都落地後，先在別天斷言：切回才斷言會走快取自癒、假綠
  await expect.poll(() => callsOf(MON), { timeout: 8000 }).toBeGreaterThan(before)
  await expect(page.locator('.datectl-day[aria-pressed="true"]')).toHaveAttribute('data-date', TUE)
  await expect(page.locator('.gauge-num')).not.toHaveText('—')
  await expect(page.locator('.timeline')).not.toContainText('載入中…')
  await expect(page.locator('.undo-bar'), '可跨日復原').toHaveCount(1)

  await gotoDate(page, MON)
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(cardOf(page, '早餐')).toHaveCount(0)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
  expect(await serverIds(page, MON)).toHaveLength(2)
})

test('加入途中刪別筆：提示條留給那筆，復原救回它、剛加入的列不動', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC, [srcRow(101, MON, 'lunch', 11)]))
  await setWriteDelay(page, 2500)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'POST')
  await setWriteDelay(page, 0)

  await deleteViaTap(page, 0)
  await expect(addOf(page, '早餐'), '刪的時候 POST 應該還在路上，否則這段沒驗到').toHaveText('加入中…')

  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(undoBtn(page)).toHaveAttribute('aria-label', '復原剛刪除的一筆')
  await undoBtn(page).click()

  await expect(nodeOf(page, '午餐').locator('.item .nm')).toHaveText(['雞胸餐盒'])
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(page.locator('.undo-bar')).toHaveCount(0)
  expect(await intakeWrites(page, 'DELETE')).toEqual([])
  expect(await serverIds(page, MON)).toHaveLength(3)
})

test('加入窗內切分頁：復原條收起、回到今日頁不再出現，已加入的列還在', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)
  await expect(undoBtn(page)).toHaveCount(1)

  // 窗本身 5 秒會自己到期，timeout 要比它短才驗得到是切分頁收掉的
  await page.locator('.tab[aria-label="設定"]').click()
  await expect(page.locator('.undo-bar')).toHaveCount(0, { timeout: 1000 })
  await page.locator('.tab[aria-label="飲食"]').click()
  await expect(items(page)).toHaveCount(2)
  await expect(page.locator('.undo-bar')).toHaveCount(0, { timeout: 1000 })

  expect(await intakeWrites(page, 'DELETE')).toEqual([])
  expect(await serverIds(page, MON)).toHaveLength(2)
})

/* ── sheet 的建議段 ── */

const sheetOf = (page: Page) => page.locator('[data-screen="log-sheet"]')
const sectNames = (page: Page, sect: string) => sheetOf(page).locator(`${sect} + .food-list .nm`)
const suggestNames = (page: Page) => sectNames(page, '.sect-suggest')
const pickedNames = (page: Page) => sectNames(page, '.sect-lb:has-text("已選")')

const openMealSheet = async (page: Page, label: string) => {
  await nodeOf(page, label).locator('.todo-row').click()
  await expect(sheetOf(page)).toBeVisible()
}

/* ── 同餐寫兩份、舊資料蓋回、鎖與錯誤的去向（第一輪驗證修正） ── */

test('待刪送失敗：不 POST、不開復原條，錯誤走刪除的 Notice', async ({ page }) => {
  // 刪掉該餐唯一一筆，卡片才會出現；DELETE 失敗時那筆會放回去，這時 POST 就是同餐雙份
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC, [srcRow(101, MON, 'breakfast', 11)]))
  await deleteViaTap(page, 0)
  await expect(cardOf(page, '早餐')).toHaveCount(1)
  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'DELETE' }
  })
  await addOf(page, '早餐').click()

  await expect(page.locator('.notice .headline')).toHaveText('刪不掉這一筆')
  expect(await intakeWrites(page, 'DELETE')).toHaveLength(1)
  expect(await intakeWrites(page, 'POST'), 'DELETE 失敗就不能再寫').toEqual([])
  await expect(page.locator('.undo-bar')).toHaveCount(0)

  await page.locator('.notice .action-btn').click()
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['雞胸餐盒'])
  await expect(cardOf(page, '早餐')).toHaveCount(0)
  expect(await serverIds(page, MON)).toEqual([101])
})

test('待刪的 DELETE 已在路上：按加入要等它，失敗就不 POST', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC, [srcRow(101, MON, 'breakfast', 11)]))
  await deleteViaTap(page, 0)
  await expect(cardOf(page, '早餐')).toHaveCount(1)
  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'DELETE' }
  })
  await setWriteDelay(page, 3000)
  // 復原窗 5 秒到期，計時器自己送出；這時 pendingDelete 已經空了，結果還沒回來
  await expect.poll(async () => (await intakeWrites(page, 'DELETE')).length, { timeout: 8000 }).toBe(1)

  await addOf(page, '早餐').click()
  await expect(addOf(page, '早餐'), '按的時候 DELETE 應該還在路上，否則這段沒驗到').toHaveText('加入中…')
  await expect(page.locator('.notice')).toHaveCount(0)

  await expect(page.locator('.notice .headline')).toHaveText('刪不掉這一筆', { timeout: 8000 })
  expect(await intakeWrites(page, 'POST'), 'DELETE 失敗，那筆會放回去，再寫就是同餐雙份').toEqual([])
  await page.locator('.notice .action-btn').click()
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['雞胸餐盒'])
  await expect(cardOf(page, '早餐')).toHaveCount(0)
  expect(await serverIds(page, MON)).toEqual([101])
})

test('待刪的 DELETE 已在路上、成功：等它回來才 POST', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC, [srcRow(101, MON, 'breakfast', 11)]))
  await deleteViaTap(page, 0)
  await setWriteDelay(page, 2000)
  await expect.poll(async () => (await intakeWrites(page, 'DELETE')).length, { timeout: 8000 }).toBe(1)
  await addOf(page, '早餐').click()
  await expect(addOf(page, '早餐')).toHaveText('加入中…')
  expect(await serverIds(page, MON), '按的時候 DELETE 應該還在路上，否則這段沒驗到').toContain(101)
  expect(await intakeWrites(page, 'POST'), 'DELETE 回來前不能寫').toEqual([])

  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'], { timeout: 8000 })
  expect(await serverIds(page, MON)).not.toContain(101)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
})

test('前一筆 DELETE 還在路上又結清另一筆：任一筆失敗都不 POST', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC, [srcRow(101, MON, 'breakfast', 11), srcRow(102, MON, 'lunch', 14)]))
  await nodeOf(page, '早餐').locator('.item-content').click()
  await page.locator('.timeline .item-editor .ed-del').click()
  await expect(cardOf(page, '早餐')).toHaveCount(1)
  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'DELETE' }
  })
  await setWriteDelay(page, 4000)
  await expect.poll(async () => (await intakeWrites(page, 'DELETE')).length, { timeout: 8000 }).toBe(1)

  // 第二筆進待刪，按加入時才送：這支結果會是成功，只看它的話第一筆失敗就漏了
  await deleteViaTap(page, 0)
  await expect(nodeOf(page, '午餐').locator('.item')).toHaveCount(0)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'DELETE', 2)
  await expect(page.locator('.notice .headline')).toHaveText('刪不掉這一筆', { timeout: 8000 })

  await expect.poll(() => serverIds(page, MON), { timeout: 8000 }).toEqual([101])
  await page.waitForTimeout(300) // 第二筆回來後 POST 若會送，是在這段時間內
  expect(await intakeWrites(page, 'POST')).toEqual([])
})

test('加入中打開該餐 sheet：今日頁卡片留著顯示加入中、sheet 沒有建議段，失敗後建議回來', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'POST' }
  })
  await setWriteDelay(page, 2500)
  await addOf(page, '早餐').click()
  await expect(addOf(page, '早餐')).toHaveText('加入中…')
  await expect(addOf(page, '早餐'), '進行中讀屏只念狀態').toHaveAttribute('aria-label', '正在加入…')

  await openMealSheet(page, '早餐')
  await expect(sheetOf(page).locator('.sect-lb').first(), '等 sheet 內容畫出來').toBeVisible()
  await expect(addOf(page, '早餐'), '開 sheet 時 POST 應該還在路上，否則這段沒驗到').toHaveText('加入中…')
  await expect(sheetOf(page).locator('.sect-suggest')).toHaveCount(0)

  await expect(suggestNames(page), 'POST 失敗後這餐還是空的，建議要回來').toHaveText(['乳清（1匙）', '無糖豆漿'], { timeout: 8000 })
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
})

test('舊 GET 在 POST 之後才落地：丟棄，品項不消失、卡片不復活、POST 只有一批', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await setWriteDelay(page, 5000)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'POST')
  await setWriteDelay(page, 0)

  // 這段時間從 sheet 記一筆午餐：它的 loadDay 就是那支舊 GET，快照裡沒有早餐
  await page.evaluate((d) => (window as unknown as StubWindow).__holdIntake.add(d), MON)
  await openMealSheet(page, '午餐')
  await sheetOf(page).locator('.food-row', { hasText: '地瓜' }).click()
  await sheetOf(page).locator('.pick-bar-btn').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__heldIntake.length), '舊 GET 要停住').toBe(1)
  await expect(page.locator('.timeline'), '舊 GET 停住時畫面在載入中').toContainText('載入中…')
  expect(await serverIds(page, MON), '舊 GET 的快照要早於早餐的 POST 落地，否則這段沒驗到').toHaveLength(1)

  // POST 落地，refreshDay 接手（__holdIntake 已用掉，它不會被停住）
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'], { timeout: 8000 })
  await expect(nodeOf(page, '午餐').locator('.item .nm')).toHaveText(['地瓜'])

  await page.evaluate(() => (window as unknown as StubWindow).__releaseIntake())
  // 舊 GET 回來後要有時間把畫面蓋掉；量不到「它落地了」，留一段夠長的時間。先看總量：被蓋掉的列還在退場動畫裡，看列會假綠
  await page.waitForTimeout(300)
  await expect(page.locator('.gauge-side .cur')).toHaveText(String(330 + 130))
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(cardOf(page, '早餐')).toHaveCount(0)
  const posts = await intakeWrites(page, 'POST')
  expect(posts.map((w) => (w.body as { meal: string }[])[0].meal).sort()).toEqual(['breakfast', 'lunch'])
})

test('舊預取在 POST 之後才落地：不寫進快取，切回來不會看到寫入前的那份', async ({ page }) => {
  // 開機預取明天（TUE），讓它停住：快照是空的。之後在 TUE 加入、重撈失敗（快取被刪），這支才落地
  await openAppAt(page, MON, { intakePersist: true, holdIntake: [TUE] }, fixWith(WEEKDAY_SRC))
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__heldIntake.length), '預取要停住').toBe(1)
  await gotoDate(page, TUE)
  await setWriteDelay(page, 1500)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'POST')
  await setWriteDelay(page, 0)
  await page.evaluate((d) => (window as unknown as StubWindow).__failIntake.add(d), TUE)
  await gotoDate(page, MON)

  // 重撈失敗（人在別天，不亮 Notice）後才放行預取
  const failed = () => page.evaluate((d) => !(window as unknown as StubWindow).__failIntake.has(d), TUE)
  await expect.poll(failed, { timeout: 8000 }).toBe(true)
  await page.evaluate(() => (window as unknown as StubWindow).__releaseIntake())
  await page.waitForTimeout(300)

  await gotoDate(page, TUE)
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(cardOf(page, '早餐')).toHaveCount(0)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
})

/** 按加入，讓它的 POST 成功、接著的重撈停住：停住的 GET 快照裡沒有之後才寫的東西。 */
const addWithRefreshHeld = async (page: Page, label: string, date: string) => {
  await setWriteDelay(page, 1500)
  await addOf(page, label).click()
  await waitWriteSent(page, 'POST')
  await page.evaluate((d) => (window as unknown as StubWindow).__holdIntake.add(d), date)
  await setWriteDelay(page, 0)
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__heldIntake.length), { message: '重撈要停住', timeout: 8000 }).toBe(1)
}

test('重撈的 GET 停在路上時從 sheet 記另一餐：落地後重抓，兩餐都在、卡片不復活、POST 各一批', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await addWithRefreshHeld(page, '早餐', MON)

  await openMealSheet(page, '午餐')
  await sheetOf(page).locator('.food-row', { hasText: '地瓜' }).click()
  await sheetOf(page).locator('.pick-bar-btn').click()
  await expect(nodeOf(page, '午餐').locator('.item .nm')).toHaveText(['地瓜'], { timeout: 8000 })
  await expect(page.locator('.gauge-side .cur')).toHaveText(String(330 + 130))

  const before = await intakeListCalls(page, MON)
  await page.evaluate(() => (window as unknown as StubWindow).__releaseIntake())
  await page.waitForTimeout(300)
  // 先看總量：被蓋掉的列還在退場動畫裡，看列會假綠
  await expect(page.locator('.gauge-side .cur')).toHaveText(String(330 + 130))
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(nodeOf(page, '午餐').locator('.item .nm')).toHaveText(['地瓜'])
  await expect(cardOf(page, '早餐')).toHaveCount(0)
  expect(await intakeListCalls(page, MON), '舊的那份要丟掉重抓').toBeGreaterThan(before)
  const posts = await intakeWrites(page, 'POST')
  expect(posts.map((w) => (w.body as { meal: string }[])[0].meal).sort()).toEqual(['breakfast', 'lunch'])

  await gotoDate(page, TUE)
  await gotoDate(page, MON)
  await expect(page.locator('.gauge-side .cur'), '快取也是新的那份').toHaveText(String(330 + 130))
})

test('重撈的 GET 停在路上時改份量：落地後新份量不被蓋回，快取也是', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC, [srcRow(101, MON, 'lunch', 14)]))
  await addWithRefreshHeld(page, '早餐', MON)

  await nodeOf(page, '午餐').locator('.item-content').click()
  await nodeOf(page, '午餐').locator('.qty-btn').last().click()
  await expect(nodeOf(page, '午餐').locator('.qty-value')).toHaveValue('2')
  await expect.poll(async () => (await intakeWrites(page, 'PATCH')).length).toBe(1)
  await page.waitForTimeout(100) // PATCH 的回應回到 App 還隔幾個 task
  await expect(page.locator('.gauge-side .cur'), '就地編輯馬上算進總量').toHaveText(String(130 * 2))

  await page.evaluate(() => (window as unknown as StubWindow).__releaseIntake())
  // 編輯區開著，餐別分段控制器也有「早餐」兩字，所以不用 nodeOf 找
  await expect(page.locator('.timeline .item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿', '地瓜'], { timeout: 8000 })
  await expect(page.locator('.gauge-side .cur')).toHaveText(String(330 + 130 * 2))

  await gotoDate(page, TUE)
  await gotoDate(page, MON)
  await expect(page.locator('.gauge-side .cur')).toHaveText(String(330 + 130 * 2))
})

test('清空畫面的 loadDay 在路上時 PATCH 成功：重抓補上畫面，不卡住', async ({ page }) => {
  // 造出快取沒有這天的路徑：一鍵加入的重撈失敗（快取被刪、亮 Notice），Notice 的重試就是 loadDay
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC, [srcRow(101, MON, 'lunch', 14)]))
  await page.evaluate((d) => (window as unknown as StubWindow).__failIntake.add(d), MON)
  await setWriteDelay(page, 1500)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'POST')
  // 趁 POST 還在路上按下改份量，PATCH 比 POST 晚落地
  await setWriteDelay(page, 5000)
  await nodeOf(page, '午餐').locator('.item-content').click()
  await nodeOf(page, '午餐').locator('.qty-btn').last().click()
  await waitWriteSent(page, 'PATCH')
  await setWriteDelay(page, 0)

  await expect(page.locator('.notice .headline')).toHaveText('讀不到這天的紀錄', { timeout: 8000 })
  await page.evaluate((d) => (window as unknown as StubWindow).__holdIntake.add(d), MON)
  await page.locator('.notice .action-btn').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__heldIntake.length), '重試的 GET 要停住').toBe(1)
  const qtyOnServer = () =>
    page.evaluate(async (d) => {
      const res = await fetch(`https://stub.supabase.co/rest/v1/intake?select=id&eaten_on=eq.${d}`)
      return ((await res.json()) as { id: number; qty: number }[]).find((r) => r.id === 101)?.qty
    }, MON)
  expect(await qtyOnServer(), '停住時 PATCH 應該還在路上，否則這段沒驗到').toBe(1)
  await expect.poll(qtyOnServer, { timeout: 8000 }).toBe(2)
  await page.waitForTimeout(100) // PATCH 的回應回到 App 還隔幾個 task

  await page.evaluate(() => (window as unknown as StubWindow).__releaseIntake())
  await expect(page.locator('.notice')).toHaveCount(0, { timeout: 2000 })
  await expect(page.locator('.timeline')).not.toContainText('載入中…')
  await expect(page.locator('.gauge-side .cur'), '午餐是新份量').toHaveText(String(330 + 130 * 2))
})

test('加入途中到設定頁存檔、重撈失敗：load 重抓，不留舊列與卡片（再按就是同餐兩份）', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await setWriteDelay(page, 3000)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'POST')
  await setWriteDelay(page, 0)

  await page.evaluate((d) => (window as unknown as StubWindow).__holdIntake.add(d), MON)
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '每日目標' }).click()
  await page.locator('[data-screen="daily-goal"] .pick-bar-btn').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__heldIntake.length), 'load 的 GET 要停住').toBe(1)
  expect(await serverIds(page, MON), '停住的快照要早於 POST 落地，否則這段沒驗到').toHaveLength(0)

  // POST 落地後的重撈失敗：快取被刪、亮 Notice。load 落地會把 Notice 清掉，只丟棄它那份的話畫面就剩舊列和卡片
  await page.evaluate((d) => (window as unknown as StubWindow).__failIntake.add(d), MON)
  await expect(page.locator('.notice .headline')).toHaveText('讀不到這天的紀錄', { timeout: 8000 })
  await page.evaluate(() => (window as unknown as StubWindow).__releaseIntake())
  await expect(page.locator('.notice')).toHaveCount(0)

  // Notice 取代過畫面，設定頁重掛回列表，底部列還原了，直接切分頁
  await page.locator('.tab[aria-label="飲食"]').click()
  await expect(page.locator('.timeline')).toHaveCount(1)
  await expect(cardOf(page, '早餐'), '卡片還在就會再寫一次').toHaveCount(0)
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
})

test('加入途中結清待刪：重撈讀到那筆也不畫回來、總量不含它', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC, [srcRow(101, MON, 'lunch', 11)]))
  await setWriteDelay(page, 2500)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'POST')
  await deleteViaTap(page, 0)
  await expect(addOf(page, '早餐'), '刪的時候 POST 應該還在路上，否則這段沒驗到').toHaveText('加入中…')

  // 切分頁結清：真的 DELETE 送出但遲遲不回，POST 先落地，它的重撈還讀得到那筆
  const before = await intakeListCalls(page, MON)
  await setWriteDelay(page, 6000)
  await page.locator('.tab[aria-label="設定"]').click()
  await waitWriteSent(page, 'DELETE')
  await expect.poll(() => intakeListCalls(page, MON), { timeout: 8000 }).toBeGreaterThan(before)
  expect((await serverIds(page, MON)).includes(101), '重撈時 DELETE 應該還沒落地，否則這段沒驗到').toBe(true)

  await page.locator('.tab[aria-label="飲食"]').click()
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  // 只看一次、不重試：DELETE 一落地畫面就會自己變對，重試的斷言等得到那一刻，等於沒驗
  expect(await nodeOf(page, '午餐').locator('.item').count()).toBe(0)
  expect(await page.locator('.gauge-side .cur').innerText()).toBe('330')
  expect((await serverIds(page, MON)).includes(101), '看畫面時 DELETE 應該還沒落地，否則這段沒驗到').toBe(true)

  await expect.poll(async () => (await serverIds(page, MON)).includes(101), { timeout: 10000 }).toBe(false)
  await expect(nodeOf(page, '午餐').locator('.item')).toHaveCount(0)
})

test('加入中切設定再切回：別餐的卡片鎖著、按了也不會寫，落地後只有這一餐的列', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith([...WEEKDAY_SRC, srcRow(304, '2026-10-30', 'lunch', 11)]))
  await setWriteDelay(page, 2500)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'POST')
  await setWriteDelay(page, 0)

  await page.locator('.tab[aria-label="設定"]').click()
  await expect(page.locator('.timeline')).toHaveCount(0)
  await page.locator('.tab[aria-label="飲食"]').click()

  await expect(addOf(page, '早餐'), 'Today 重掛後還知道進行中').toHaveText('加入中…')
  await isLocked(addOf(page, '午餐'))
  await addOf(page, '午餐').evaluate((btn: HTMLElement) => btn.click())

  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'], { timeout: 8000 })
  await expect(nodeOf(page, '午餐').locator('.item')).toHaveCount(0)
  await isUnlocked(addOf(page, '午餐'))
  await expect(nodeOf(page, '午餐').locator('[role="alert"]')).toHaveCount(0)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
})

test('寫入失敗的訊息：切分頁、切日再回來都還在', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'POST' }
  })
  await addOf(page, '早餐').click()
  const alert = nodeOf(page, '早餐').locator('[role="alert"]')
  await expect(alert).toHaveText('存不進去：模擬的寫入失敗')

  await page.locator('.tab[aria-label="設定"]').click()
  await expect(page.locator('.timeline')).toHaveCount(0)
  await page.locator('.tab[aria-label="飲食"]').click()
  await expect(alert).toHaveText('存不進去：模擬的寫入失敗')
  await expect(addOf(page, '早餐')).toHaveText('重試')

  await gotoDate(page, TUE)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText(WEEKDAY_LABEL)
  await expect(alert, '別天的同一餐不該掛這個錯誤').toHaveCount(0)
  await gotoDate(page, MON)
  await expect(alert).toHaveText('存不進去：模擬的寫入失敗')
})

test('復原在途：卡片回來但鎖著，按了也不會寫，完成後可按', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)

  await setWriteDelay(page, 2500)
  await undoBtn(page).click()
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText(WEEKDAY_LABEL)
  await isLocked(addOf(page, '早餐'))
  await expect(addOf(page, '早餐'), '復原不是加入，不寫加入中').toHaveText('加入')
  expect(await serverIds(page, MON), '這時 DELETE 應該還沒落地，否則這段沒驗到').toHaveLength(2)
  await addOf(page, '早餐').evaluate((btn: HTMLElement) => btn.click())

  await expect.poll(() => serverIds(page, MON), { timeout: 8000 }).toEqual([])
  await isUnlocked(addOf(page, '早餐'))
  expect(await intakeWrites(page, 'POST'), '鎖著時按的不算').toHaveLength(1)

  await setWriteDelay(page, 0)
  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)
  expect(await intakeWrites(page, 'POST')).toHaveLength(2)
})

test('復原在途：sheet 也看不到建議段，完成後才回來', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)

  await setWriteDelay(page, 2500)
  await undoBtn(page).click()
  await expect(cardOf(page, '早餐')).toBeVisible()
  await openMealSheet(page, '早餐')
  await expect(sheetOf(page).locator('.sect-suggest')).toHaveCount(0)
  expect(await serverIds(page, MON), '這時 DELETE 應該還沒落地，否則這段沒驗到').toHaveLength(2)

  await expect.poll(() => serverIds(page, MON), { timeout: 8000 }).toEqual([])
  await expect(sheetOf(page).locator('.sect-suggest')).toHaveCount(1)
})

test('加入途中到設定頁存檔：舊 GET 不蓋回，回今日頁品項還在、卡片不復活', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await setWriteDelay(page, 3000)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'POST')
  await setWriteDelay(page, 0)

  await page.evaluate((d) => (window as unknown as StubWindow).__holdIntake.add(d), MON)
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '每日目標' }).click()
  await page.locator('[data-screen="daily-goal"] .pick-bar-btn').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__heldIntake.length), '舊 GET 要停住').toBe(1)
  expect(await serverIds(page, MON), '舊 GET 的快照要早於 POST 落地，否則這段沒驗到').toHaveLength(0)

  await expect.poll(() => serverIds(page, MON), { timeout: 8000 }).toHaveLength(2)
  // refreshDay 的 GET 不會被停住（__holdIntake 已用掉）；等它落地才放舊 GET
  await page.waitForTimeout(300)
  await page.evaluate(() => (window as unknown as StubWindow).__releaseIntake())
  await page.waitForTimeout(300)

  await page.locator('[data-screen="daily-goal"] [aria-label="返回設定"]').click()
  await page.locator('.tab[aria-label="今日"], .tab[aria-label="飲食"]').first().click()
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(cardOf(page, '早餐')).toHaveCount(0)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
})

test('改從 sheet 加入成功後舊錯誤清掉：刪掉、卡片回來時按鈕是加入', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith([srcRow(301, '2026-10-30', 'breakfast', 13)]))
  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'POST' }
  })
  await addOf(page, '早餐').click()
  await expect(addOf(page, '早餐')).toHaveText('重試')

  await openMealSheet(page, '早餐')
  await sheetOf(page).locator('.sect-act').click()
  await sheetOf(page).locator('.pick-bar-btn').click()
  await expect(sheetOf(page)).toHaveCount(0)
  await expect(items(page)).toHaveCount(1)

  await deleteViaTap(page, 0)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText('乳清（1匙）')
  await expect(addOf(page, '早餐')).toHaveText('加入')
  await expect(nodeOf(page, '早餐').locator('[role="alert"]')).toHaveCount(0)
})

test('鍵盤按加入、寫入失敗：焦點留在鈕上，文字變重試', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'POST' }
  })
  await setWriteDelay(page, 800)
  await addOf(page, '早餐').focus()
  await page.keyboard.press('Enter')
  await expect(addOf(page, '早餐')).toHaveText('加入中…')
  await expect(addOf(page, '早餐'), '進行中焦點不能掉').toBeFocused()

  await expect(addOf(page, '早餐')).toHaveText('重試', { timeout: 8000 })
  await expect(addOf(page, '早餐')).toBeFocused()
})

test('POST 成功、重撈失敗：Notice，重試後品項長出、卡片不回來、不重複寫入', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await page.evaluate((d) => (window as unknown as StubWindow).__failIntake.add(d), MON)
  await addOf(page, '早餐').click()
  await expect(page.locator('.notice .headline')).toHaveText('讀不到這天的紀錄')
  expect(await serverIds(page, MON)).toHaveLength(2)

  await page.locator('.notice .action-btn').click()
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(cardOf(page, '早餐')).toHaveCount(0)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
})

test('POST 成功、人在別天時重撈失敗：不亮 Notice，切回來重新讀、看不到舊列與建議', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await setWriteDelay(page, 1500)
  await addOf(page, '早餐').click()
  await waitWriteSent(page, 'POST')
  await setWriteDelay(page, 0)
  await page.evaluate((d) => (window as unknown as StubWindow).__failIntake.add(d), MON)
  await gotoDate(page, TUE)

  const failed = () => page.evaluate((d) => !(window as unknown as StubWindow).__failIntake.has(d), MON)
  await expect.poll(failed, { timeout: 8000 }).toBe(true)
  await page.waitForTimeout(300)
  await expect(page.locator('.notice')).toHaveCount(0)

  await gotoDate(page, MON)
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(cardOf(page, '早餐')).toHaveCount(0)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
})

test('加入窗內切到背景：復原條收起，列留著、不打 DELETE', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await addOf(page, '早餐').click()
  await expect(items(page)).toHaveCount(2)
  await expect(undoBtn(page)).toHaveCount(1)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  // 窗本身 5 秒會自己到期，timeout 要比它短才驗得到是切背景收掉的
  await expect(page.locator('.undo-bar')).toHaveCount(0, { timeout: 1000 })
  await expect(items(page)).toHaveCount(2)
  expect(await intakeWrites(page, 'DELETE')).toEqual([])
})

test('sheet：不預設選中，點一項進已選並移出建議段、份量取建議量、取消後回來', async ({ page }) => {
  await openAppAt(page, MON, {}, fixWith(WEEKDAY_SRC))
  await openMealSheet(page, '早餐')
  const sheet = sheetOf(page)

  await expect(suggestNames(page)).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(sheet.locator('.sect-suggest .sect-act')).toHaveText('全選')
  await expect(pickedNames(page), '只是列出來，不能幫他勾').toHaveCount(0)
  await expect(sheet.locator('.pick-bar')).toHaveCount(0)

  await sheet.locator('.sect-suggest + .food-list .food-row', { hasText: '乳清' }).click()
  await expect(pickedNames(page)).toHaveText(['乳清（1匙）'])
  await expect(sheet.locator('.qty-value'), '常吃紀錄的份量是 1，這裡要取建議量').toHaveValue('2')
  await expect(sheet.locator('.pick-line .sub')).toHaveText('1 樣 · 240 卡')
  await expect(suggestNames(page)).toHaveText(['無糖豆漿'])

  await sheet.locator('.food-row[aria-pressed="true"]').click()
  await expect(pickedNames(page)).toHaveCount(0)
  await expect(suggestNames(page)).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(sheet.locator('.pick-bar')).toHaveCount(0)
})

test('sheet：超標預告用建議量試算，跟勾下去的份量同源', async ({ page }) => {
  // 脂肪目標 2：乳清單份 1.5 不超，建議量 ×2 是 3，超 1
  const fix = {
    ...fixWith(WEEKDAY_SRC),
    profile: [{ ...FIX.profile[0], use_custom_targets: true, custom_kcal: 2000, custom_protein_g: 100, custom_fat_g: 2, custom_carb_g: 263 }],
  } as unknown as typeof FIX
  await openAppAt(page, MON, {}, fix)
  await openMealSheet(page, '早餐')
  const row = sheetOf(page).locator('.sect-suggest + .food-list .food-row', { hasText: '乳清' })
  await expect(row.locator('.kc-delta')).toHaveText('+1g脂')
  await row.click()
  await expect(sheetOf(page).locator('.macro-line .over')).toContainText('脂 3/2')
})

test('sheet 全選：全部進已選、段消失、(+N) 正確、焦點接到已選第一列、按加入才寫入一次', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await openMealSheet(page, '早餐')
  const sheet = sheetOf(page)

  await expect(sheet.locator('.sect-act')).toHaveAttribute('aria-label', '全選建議的 2 樣')
  await sheet.locator('.sect-act').click()
  await expect(pickedNames(page)).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(sheet.locator('.qty-value').nth(0)).toHaveValue('2')
  await expect(sheet.locator('.qty-value').nth(1)).toHaveValue('1')
  await expect(sheet.locator('.sect-suggest')).toHaveCount(0)
  await expect(sheet.locator('.pick-line .sub')).toHaveText('2 樣 · 330 卡')
  // 蛋白 24×2＋8、脂 1.5×2＋4、碳 2×2＋5
  await expect(sheet.locator('.macro-line .add')).toHaveText(['(+56)', '(+7)', '(+9)'])
  await expect(sheet.locator('.food-row[aria-pressed="true"]').first(), '全選鈕消失了，焦點要接到已選第一列').toBeFocused()
  expect(await intakeWrites(page, 'POST'), '全選只是勾起來').toEqual([])

  await sheet.locator('.pick-bar-btn').click()
  await expect(sheet).toHaveCount(0)
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['乳清（1匙）', '無糖豆漿'])
  expect((await intakeWrites(page, 'POST')).map((w) => w.body)).toEqual([WEEKDAY_POST_BODY])
})

test('sheet 的段落順序：已選→建議→常吃→全部', async ({ page }) => {
  const history = [11, 12, 13].map((food_id) => ({ meal: 'breakfast', food_id, qty: 1 }))
  await openAppAt(page, MON, {}, { ...fixWith(WEEKDAY_SRC), history } as unknown as typeof FIX)
  await openMealSheet(page, '早餐')
  const sheet = sheetOf(page)
  await expect(sheet.locator('.sect-lb')).toHaveText([/^建議/, '早餐常吃', '全部食物'])

  await sheet.locator('.sect-suggest + .food-list .food-row', { hasText: '無糖豆漿' }).click()
  await expect(sheet.locator('.sect-lb')).toHaveText(['已選', /^建議/, '早餐常吃', '全部食物'])
})

test('sheet「加入」連按只寫入一次', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await openMealSheet(page, '早餐')
  await sheetOf(page).locator('.sect-act').click()
  await expect(pickedNames(page)).toHaveCount(2)
  await setWriteDelay(page, 800)
  /* 兩下之間隔一個 task，跟真的連點一樣（React 在兩次事件之間會 render，busy 與 disabled 才生效）。
     同一個 task 連發兩次 click 真人做不到，那種情況 busy 還是舊值，會寫兩次。 */
  await sheetOf(page).locator('.pick-bar-btn').evaluate(async (btn: HTMLElement) => {
    btn.click()
    await new Promise((r) => setTimeout(r))
    btn.click()
  })
  await expect(sheetOf(page)).toHaveCount(0, { timeout: 8000 })
  await expect(items(page)).toHaveCount(2)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
  expect(await serverIds(page, MON)).toHaveLength(2)
})

/** 看 pointerEvents 不看 toBeVisible：收合要 0.8 秒，開始收了也還看得見。 */
const sheetStaysOpen = async (page: Page, msg: string) => {
  await page.waitForTimeout(300) // 沒有事件可等的反向斷言：sheet 若會關，這段時間內就開始收了
  expect(await sheetOf(page).evaluate((n) => (n as HTMLElement).style.pointerEvents), msg).not.toBe('none')
}

/** 寫入中按鈕是 disabled，焦點會掉到 body、Escape 到不了 Dialog：先放回 sheet，測的才是鎖住。 */
const pressEscapeInSheet = async (page: Page) => {
  await sheetOf(page).focus()
  await page.keyboard.press('Escape')
}

test('sheet 寫入中關不掉：Escape、點 scrim、關閉鈕都不行，寫入完成才收合', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await openMealSheet(page, '早餐')
  await sheetOf(page).locator('.sect-act').click()
  await setWriteDelay(page, 3000)
  await sheetOf(page).locator('.pick-bar-btn').click()
  await waitWriteSent(page, 'POST')

  await expect(sheetOf(page).locator('.icon-btn[aria-label="關閉"]')).toBeDisabled()
  await pressEscapeInSheet(page)
  await sheetStaysOpen(page, '寫入中 Escape 把 sheet 關了')
  await page.mouse.click(200, 40) // sheet 上方露出的 scrim
  await sheetStaysOpen(page, '寫入中點 scrim 把 sheet 關了')
  expect(await serverIds(page, MON), '這時 POST 應該還在路上，否則這段沒驗到').toHaveLength(0)

  await expect(sheetOf(page)).toHaveCount(0, { timeout: 8000 })
  await expect(items(page)).toHaveCount(2)
  expect(await intakeWrites(page, 'POST')).toHaveLength(1)
})

test('sheet 寫入失敗：寫入中關不掉，失敗後 sheet、已選、錯誤都在，關閉鈕解鎖', async ({ page }) => {
  await openAppAt(page, MON, { intakePersist: true }, fixWith(WEEKDAY_SRC))
  await openMealSheet(page, '早餐')
  await sheetOf(page).locator('.sect-act').click()
  await page.evaluate(() => {
    ;(window as unknown as StubWindow).__failNext = { table: 'intake', method: 'POST' }
  })
  await setWriteDelay(page, 1500)
  await sheetOf(page).locator('.pick-bar-btn').click()
  await waitWriteSent(page, 'POST')
  await pressEscapeInSheet(page)
  await sheetStaysOpen(page, '寫入中 Escape 把 sheet 關了')

  await expect(sheetOf(page).getByRole('alert')).toHaveText('存不進去：模擬的寫入失敗', { timeout: 8000 })
  await sheetStaysOpen(page, '失敗後 sheet 自己關了')
  await expect(pickedNames(page)).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(sheetOf(page).locator('.pick-bar-btn')).toHaveText('重試')

  const close = sheetOf(page).locator('.icon-btn[aria-label="關閉"]')
  await expect(close).toBeEnabled()
  await close.click()
  await expect(sheetOf(page)).toHaveCount(0, { timeout: 2000 })
})

test('「全選」命中區 ≥44×44：鈕的四邊都點得到它，第一列中心點到的還是第一列', async ({ page }) => {
  await openAppAt(page, MON, {}, fixWith(WEEKDAY_SRC))
  await openMealSheet(page, '早餐')
  // 等 spring 到位：飛行途中鈕可能還在視窗外，elementFromPoint 量不到東西
  await expect
    .poll(() => sheetOf(page).evaluate((n) => Math.abs(new DOMMatrix(getComputedStyle(n).transform).m42) < 0.5))
    .toBe(true)
  const hit = await sheetOf(page).locator('.sect-act').evaluate((btn) => {
    const r = btn.getBoundingClientRect()
    const isBtn = (x: number, y: number) => document.elementFromPoint(x, y) === btn
    const midX = r.left + r.width / 2
    const midY = r.top + r.height / 2
    const row = btn.closest('.sect-suggest')!.nextElementSibling!.querySelector('.food-row')!
    const rr = row.getBoundingClientRect()
    return {
      w: r.width,
      h: r.height,
      edges: [isBtn(midX, r.top + 1), isBtn(midX, r.bottom - 1), isBtn(r.left + 1, midY), isBtn(r.right - 1, midY)],
      rowCenter: document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2)?.closest('.food-row') === row,
    }
  })
  expect(hit.w).toBeGreaterThanOrEqual(44)
  expect(hit.h).toBeGreaterThanOrEqual(44)
  expect(hit.edges).toEqual([true, true, true, true])
  expect(hit.rowCenter).toBe(true)
})

test('封存食物：一鍵照搬；sheet 可選、確認列計入、切餐別不消失，寫入用來源快照', async ({ page }) => {
  // 封存的不放 fix.foods（foods 查詢只回使用中的）。品名快照跟食品庫現名不同，驗顯示與寫入都取快照
  const archived = (id: number, meal: string, qty: number) => ({
    id,
    eaten_on: '2026-10-30',
    meal,
    food_id: 99,
    qty,
    kcal: 300,
    protein: 20,
    fat: 10,
    carb: 30,
    name: '舊款便當',
    created_at: '2026-10-30T01:00:00.000Z',
    foods: { name: '新款便當', vendor: '停賣店', archived: true },
  })
  const snapshot = { eaten_on: MON, food_id: 99, kcal: 300, protein: 20, fat: 10, carb: 30, name: '舊款便當' }
  await openAppAt(page, MON, { intakePersist: true }, fixWith([archived(301, 'breakfast', 1), archived(302, 'lunch', 2)]))

  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText('舊款便當')
  await addOf(page, '早餐').click()
  await expect(nodeOf(page, '早餐').locator('.item .nm')).toHaveText(['舊款便當'])
  expect((await intakeWrites(page, 'POST'))[0].body).toEqual([{ ...snapshot, meal: 'breakfast', qty: 1 }])

  await openMealSheet(page, '午餐')
  const sheet = sheetOf(page)
  await expect(suggestNames(page)).toHaveText(['舊款便當'])
  await sheet.locator('.sect-suggest + .food-list .food-row').click()
  await expect(pickedNames(page)).toHaveText(['舊款便當'])
  await expect(sheet.locator('.pick-line .sub')).toHaveText('1 樣 · 600 卡')

  await sheet.locator('.chip', { hasText: '晚餐' }).click()
  await expect(sheet.locator('.chip', { hasText: '晚餐' })).toHaveAttribute('aria-pressed', 'true')
  await expect(pickedNames(page), '切餐別後建議段換了，已選不能跟著消失').toHaveText(['舊款便當'])
  await expect(sheet.locator('.pick-line .sub')).toHaveText('1 樣 · 600 卡')

  await sheet.locator('.pick-bar-btn').click()
  await expect(sheet).toHaveCount(0)
  // 當天同名兩筆時時間軸會帶店家區分（既有規則）
  await expect(nodeOf(page, '晚餐').locator('.item .nm')).toHaveText(['舊款便當 停賣店'])
  expect((await intakeWrites(page, 'POST'))[1].body).toEqual([{ ...snapshot, meal: 'dinner', qty: 2 }])
})

test('同一食物不同時出現在建議段與常吃段；常吃先濾再取五筆；搜尋時收起建議段', async ({ page }) => {
  const history = [13, 15, 11, 12, 14, 16, 17].map((food_id) => ({ meal: 'breakfast', food_id, qty: 1 }))
  await openAppAt(page, MON, {}, { ...fixWith(WEEKDAY_SRC), history } as unknown as typeof FIX)
  await openMealSheet(page, '早餐')
  const sheet = sheetOf(page)

  await expect(suggestNames(page)).toHaveText(['乳清（1匙）', '無糖豆漿'])
  await expect(sectNames(page, '.sect-lb:has-text("早餐常吃")')).toHaveText(['雞胸餐盒', '雞胸餐盒', '地瓜', '溫泉蛋', '香蕉'])
  await expect(sectNames(page, '.sect-lb:has-text("全部食物")')).toHaveText(['拿鐵'])

  await sheet.getByLabel('搜尋食物').fill('乳清')
  await expect(sheet.locator('.sect-suggest')).toHaveCount(0)
  await expect(sectNames(page, '.sect-lb:has-text("搜尋結果")')).toHaveText(['乳清（1匙）'])

  await sheet.getByLabel('搜尋食物').fill('')
  await expect(suggestNames(page)).toHaveText(['乳清（1匙）', '無糖豆漿'])
})

test('從 sheet 加入今天的餐後切明天：來源是今天', async ({ page }) => {
  // 資料的設計同「今天加入後切明天」：10-19 對 TUE 超界，TUE 的早餐建議只可能來自 MON
  const src = [srcRow(301, '2026-10-19', 'breakfast', 13), srcRow(302, '2026-10-30', 'lunch', 11)]
  await openAppAt(page, MON, { intakePersist: true }, fixWith(src))
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText('乳清（1匙）')

  await gotoDate(page, TUE)
  await expect(cardOf(page, '午餐')).toHaveCount(1)
  await expect(cardOf(page, '早餐'), '10-19 對明天已超界').toHaveCount(0)
  await gotoDate(page, MON)
  await expect(cardOf(page, '早餐')).toHaveCount(1)

  await openMealSheet(page, '早餐')
  await sheetOf(page).locator('.sect-act').click()
  await sheetOf(page).locator('.pick-bar-btn').click()
  await expect(sheetOf(page)).toHaveCount(0)
  await expect(items(page)).toHaveCount(1)

  await gotoDate(page, TUE)
  await expect(cardOf(page, '早餐').locator('.sg-items')).toHaveText('乳清（1匙）')
})

/* ── 差 N ── */

const intakeRow = (id: number, kcal: number, protein: number, fat: number, carb: number) => ({
  id,
  meal: 'breakfast',
  qty: 1,
  kcal,
  protein,
  fat,
  carb,
  name: null,
  foods: { name: '乳清（1匙）', vendor: null },
})

/* 目標釘死（自訂目標）：不受公式與跑測年份影響。今天的三欄剛好是三種情況：
   蛋白質 100/100（N＝0）、脂肪 60/50（N＜0）、碳水 100.1/263（N＝162.9→163，最壞字寬）。 */
const GAP_FIX = {
  ...FIX,
  profile: [{ ...FIX.profile[0], use_custom_targets: true, custom_kcal: 2000, custom_protein_g: 100, custom_fat_g: 50, custom_carb_g: 263 }],
  intake: [intakeRow(101, 777, 100, 60, 100.1)],
  intakeYday: [intakeRow(201, 333, 10, 10, 10)],
} as unknown as typeof FIX

const macro = (page: Page, i: number) => page.locator('.macros .macro').nth(i)
const gapTexts = (page: Page) => page.locator('.macros .gap').allInnerTexts()

test('差 N：今天明天顯示、歷史日不顯示、N≤0 不顯示、393 寬字寬不超過欄寬', async ({ page }) => {
  await openAppAt(page, '2026-11-02', {}, GAP_FIX)

  // 今天（週一）：N＝0 與 N＜0 不顯示，只有碳水有
  await expect(page.locator('.gauge-num')).toHaveText(String(2000 - 777))
  await expect(macro(page, 0).locator('.gap'), '蛋白質 100/100，N＝0 不該顯示').toHaveCount(0)
  await expect(macro(page, 1).locator('.gap'), '脂肪 60/50，N＜0 不該顯示').toHaveCount(0)
  await expect(macro(page, 2).locator('.gap')).toHaveText('差 163')
  await expect(macro(page, 0).locator('.val')).toHaveAttribute('aria-label', '蛋白質 100.0 克，目標 100 克')
  await expect(macro(page, 1).locator('.val')).toHaveAttribute('aria-label', '脂肪 60.0 克，已超出，目標 50 克')
  await expect(macro(page, 2).locator('.val')).toHaveAttribute('aria-label', '碳水 100.1 克，目標 263 克，還差 163 克')

  // 393 寬、最壞字寬「100.1/263 差 163」：.pair 是 nowrap，「不折行」恆真，要量字寬。block 的寬度不會被內容撐開，所以用 Range 量文字
  const fit = await macro(page, 2).locator('.val').evaluate((val) => {
    const range = document.createRange()
    range.selectNodeContents(val)
    return { text: val.textContent, textWidth: range.getBoundingClientRect().width, colWidth: val.getBoundingClientRect().width }
  })
  expect(fit.text).toBe('100.1/263差 163')
  expect(fit.textWidth, `字寬 ${fit.textWidth} 超過欄寬 ${fit.colWidth}`).toBeLessThanOrEqual(fit.colWidth)
  expect(fit.textWidth, '量到的字寬太小，Range 沒量到文字').toBeGreaterThan(fit.colWidth / 2)

  // 淡色：跟目標值同色、不加粗，與累計值隔一點距離
  const style = await macro(page, 2).evaluate((m) => {
    const gap = getComputedStyle(m.querySelector('.gap')!)
    return { color: gap.color, tgtColor: getComputedStyle(m.querySelector('.tgt')!).color, weight: gap.fontWeight, marginLeft: gap.marginLeft }
  })
  expect(style).toEqual({ color: style.tgtColor, tgtColor: style.tgtColor, weight: '400', marginLeft: '4px' })

  // 明天：stub 回空清單，累計 0，N＝目標本身
  await gotoDate(page, '2026-11-03')
  await expect(page.locator('.gauge-num')).toHaveText('2000')
  await expect.poll(() => gapTexts(page)).toEqual(['差 100', '差 50', '差 263'])
  await expect(macro(page, 0).locator('.val')).toHaveAttribute('aria-label', '蛋白質 0.0 克，目標 100 克，還差 100 克')

  // 歷史日（前一週的週日）：有缺口也不顯示。等主數字變成那天的攝取才斷言，否則載入中的 0 個會假綠
  await gotoDate(page, '2026-11-01')
  await expect(page.locator('.gauge-num')).toHaveText('333')
  await expect(page.locator('.macros .gap')).toHaveCount(0)
  await expect(macro(page, 0).locator('.val')).toHaveAttribute('aria-label', '蛋白質 10.0 克，目標 100 克')
})
