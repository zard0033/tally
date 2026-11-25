/* 熱量看這一週（spec「熱量看這一週」，v2.165）：今日頁的「這週」卡與待記錄三餐的「沒吃／補記」。
   v2.166（spec「三個小改動」）：「沒吃」併進那一餐的標題列（.todo-ask：列本身＝補記、右邊膠囊＝沒吃、按了換「復原」），
   這週卡底下多一行「這週 N 餐沒記」。
   規則（沒記完補到目標、今天佔位、打平與 BMR 下限、紅色只看已經吃的）由 src/lib/weekBudget.test.ts 守；這裡驗畫面與寫入。
   日期釘住（openAppAt，早上 9 點）：週的切法跟星期幾有關。每日目標用自訂 1850（不受公式影響），BMR 仍照公式：
   男、1993 年生（2026 年 33 歲）、175 cm、這裡把體重設 65 kg、沒體脂 → Mifflin 10×65＋6.25×175−5×33＋5＝1583.75
   （FIX 的 75.95 kg 算出來 1693，比 AC 1 的打平 1673 還高，會被下限頂住）。 */
import { test, expect, type Page } from '@playwright/test'
import { FIX } from './fixtures'
import { currentIso, gotoDate, openAppAt } from './harness'

const BMR = 1583.75
const k = (eaten_on: string, meal: string, kcal: number) => ({ eaten_on, qty: 1, kcal, meal })
const full = (d: string, kcal: number) => [k(d, 'breakfast', Math.round(kcal * 0.25)), k(d, 'lunch', Math.round(kcal * 0.35)), k(d, 'dinner', kcal - Math.round(kcal * 0.25) - Math.round(kcal * 0.35))]
const item = (id: number, meal: string, kcal: number) => ({ id, meal, qty: 1, kcal, protein: 10, fat: 5, carb: 20, name: null, foods: { name: `測試${id}`, vendor: null } })

/** 每日目標固定 1850（自訂），其餘同 FIX。 */
const fixWith = (over: Partial<typeof FIX> & Record<string, unknown>) =>
  ({
    ...FIX,
    profile: [{ ...FIX.profile[0], use_custom_targets: true, custom_kcal: 1850, custom_protein_g: 120, custom_fat_g: 60, custom_carb_g: 200 }],
    weight: [{ weight_kg: 65, measured_on: '2026-11-20', body_fat_pct: null }],
    ...over,
  }) as unknown as typeof FIX

const total = (page: Page) => page.locator('.wkb-total')
const col = (page: Page, d: string) => page.locator(`.wkb-col[data-wk-date="${d}"]`)
const plans = (page: Page) => page.locator('.wkb-bar.is-plan em').allTextContents()

// 2026-11-26 是週四：週一 11/23 … 週日 11/29
const THU = '2026-11-26'
const TODAY_1200 = [item(301, 'breakfast', 480), item(302, 'lunch', 720)]

test('總帳、單日多吃淺藍＋「+N」、打平框寫數字；今日頁大數字照舊是今天（AC 1）', async ({ page }) => {
  await openAppAt(page, THU, {}, fixWith({
    intake: TODAY_1200,
    kcalWindow: [...full('2026-11-23', 1650), ...full('2026-11-24', 1780), ...full('2026-11-25', 2650)],
  }))
  await expect(total(page)).toHaveText('多吃 530')
  expect(await plans(page)).toEqual(['1670', '1670', '1670'])
  // 週三超出 800：超出那段是淺藍（--tree），不是紅
  await expect(col(page, '2026-11-25').locator('.wkb-tag')).toHaveText('+800')
  const above = col(page, '2026-11-25').locator('.wkb-above')
  await expect(above).toHaveCSS('background-color', 'rgb(90, 132, 176)')
  await expect(page.locator('.wkb.is-red')).toHaveCount(0)
  // 大數字不動：今天還能吃 1850 − 1200
  await expect(page.locator('.gauge-lead')).toHaveText('還能吃')
  await expect(page.locator('.gauge-num')).toHaveText('650')
  // 讀屏：一句話講完這週
  await expect(page.locator('.wkb .sr-only').first()).toHaveText('這週多吃 530 卡；週三多 800 卡；之後每天約 1670 卡')
})

test('打平低於 BMR：框停在 BMR、卡頭寫這週會多 N（AC 2）', async ({ page }) => {
  await openAppAt(page, THU, {}, fixWith({
    intake: TODAY_1200,
    kcalWindow: [...full('2026-11-23', 3850), ...full('2026-11-24', 1780), ...full('2026-11-25', 2650)],
  }))
  // 12950 − (3850＋1780＋2650＋1850) = 2820，÷ 3 = 940 < BMR
  const plan = String(Math.round(BMR / 10) * 10)
  expect(await plans(page)).toEqual([plan, plan, plan])
  // 會多＝畫面上的每天量 × 3 − 2820（取整過的，畫面上的數字自己對得起來）
  await expect(total(page)).toHaveText(`這週會多 ${Number(plan) * 3 - 2820}`)
  await expect(page.locator('.wkb.is-red')).toHaveCount(0)
})

test('已經吃的超過這週額度才紅：卡頭「這週超過 N」、打平框寫「—」（AC 3）', async ({ page }) => {
  await openAppAt(page, THU, {}, fixWith({
    intake: TODAY_1200,
    kcalWindow: [...full('2026-11-23', 5000), ...full('2026-11-24', 5000), ...full('2026-11-25', 4000)],
  }))
  await expect(page.locator('.wkb.is-red')).toHaveCount(1)
  // 5000＋5000＋4000＋今天實吃 1200 − 12950
  await expect(total(page)).toHaveText('這週超過 2250')
  await expect(total(page)).toHaveCSS('color', 'rgb(162, 62, 44)')
  expect(await plans(page)).toEqual(['—', '—', '—'])
})

/* 週三看：昨天＝週二（stub 的 intakeYday）。週二只記了早、午餐。 */
const WED = '2026-11-25'
const TUE = '2026-11-24'
const tueFix = (extra: Record<string, unknown> = {}) =>
  fixWith({
    intake: [],
    intakeYday: [item(201, 'breakfast', 400), item(202, 'lunch', 600)],
    kcalWindow: [...full('2026-11-23', 1850), k(TUE, 'breakfast', 400), k(TUE, 'lunch', 600)],
    ...extra,
  })

test('晚餐空著沒回答：週二柱子沒記完、至少算到目標；點了跳到那天（AC 4）', async ({ page }) => {
  await openAppAt(page, WED, {}, tueFix())
  await expect(col(page, TUE)).toHaveAttribute('aria-label', '週二沒記完，去看那天')
  // 沒記完標在星期字上（虛線底線），不另起一行
  await expect(page.locator('.wkb-day.is-unlogged')).toHaveText(['二'])
  await expect(page.locator('.wkb-day.is-unlogged')).toHaveCSS('text-decoration-style', 'dashed')
  // 週一 1850＋週二補到 1850＋今天佔位 1850 − 1850×3
  await expect(total(page)).toHaveText('剛好')
  await col(page, TUE).click()
  expect(await currentIso(page)).toBe(TUE)
})

test('按「沒吃」：寫一筆、這餐照實算、不再沒記完；「復原」刪掉回到沒記完（AC 5、6）', async ({ page }) => {
  await openAppAt(page, WED, {}, tueFix())
  await gotoDate(page, TUE)
  const dinner = page.locator('.todo-ask[data-meal="dinner"]')
  await expect(dinner.getByRole('button', { name: '晚餐沒吃' })).toBeVisible()
  await expect(dinner.locator('.todo-row')).toHaveText('晚餐沒記的話，這天至少照目標算')
  // 讀屏名講它是補記（v2.165 是「補記晚餐」那顆鈕）
  await expect(dinner.getByRole('button', { name: '補記晚餐，沒記的話這天至少照目標算' })).toHaveCount(1)
  // 點心不問
  await expect(page.locator('.todo-ask[data-meal="snack"]')).toHaveCount(0)

  await dinner.getByRole('button', { name: '晚餐沒吃' }).click()
  await expect(dinner.locator('.todo-row')).toHaveText('晚餐沒吃，這天照實算')
  await expect(dinner.locator('.todo-row')).toHaveAccessibleName('補記晚餐，沒吃，這天照實算')
  const skips = () => page.evaluate(() => (window as unknown as { __mealSkips: () => unknown[] }).__mealSkips())
  expect(await skips()).toEqual([{ eaten_on: TUE, meal: 'dinner' }])
  // 週二照實 1000：週一 1850＋1000＋今天佔位 1850 − 5550 → 少吃 850
  await expect(col(page, TUE)).not.toHaveClass(/is-btn/)
  await expect(total(page)).toHaveText('少吃 850')

  await dinner.getByRole('button', { name: '復原「晚餐沒吃」' }).click()
  await expect(dinner.getByRole('button', { name: '晚餐沒吃' })).toBeVisible()
  expect(await skips()).toEqual([])
  await expect(col(page, TUE)).toHaveClass(/is-btn/)
  await expect(total(page)).toHaveText('剛好')
})

test('「沒吃」存不進去：那一餐底下說存不進去、照樣是沒記完（AC 5）', async ({ page }) => {
  await openAppAt(page, WED, {}, tueFix())
  await gotoDate(page, TUE)
  await page.evaluate(() => {
    ;(window as unknown as { __failNext: { table: string; method: string } }).__failNext = { table: 'meal_skip', method: 'POST' }
  })
  await page.getByRole('button', { name: '晚餐沒吃' }).click()
  await expect(page.locator('.todo-ask + .sheet-error')).toContainText('存不進去')
  await expect(page.getByRole('button', { name: '晚餐沒吃' })).toBeVisible()
  await expect(col(page, TUE)).toHaveClass(/is-btn/)
})

test('之前按過的「沒吃」開 App 就讀得到；「補記」開那一餐的記一筆', async ({ page }) => {
  await openAppAt(page, WED, {}, tueFix({ mealSkip: [{ eaten_on: TUE, meal: 'dinner' }] }))
  await expect(col(page, TUE)).not.toHaveClass(/is-btn/)
  await gotoDate(page, TUE)
  await expect(page.locator('.todo-ask[data-meal="dinner"]')).toHaveClass(/is-skipped/)
  // 早餐、午餐有記，不問；補記：先復原再點晚餐那一列
  await expect(page.locator('.todo-ask[data-meal="breakfast"], .todo-ask[data-meal="lunch"]')).toHaveCount(0)
  await page.getByRole('button', { name: '復原「晚餐沒吃」' }).click()
  await page.locator('.todo-ask[data-meal="dinner"] .todo-row').click()
  await expect(page.locator('.chiprow .chip[aria-pressed="true"]')).toHaveText('晚餐')
})

test('今天：早餐過 11 點才問、晚餐當天不問；昨天的晚餐照問（AC 7）', async ({ page }) => {
  // 下午 3 點半開：今天早、午餐空著要問，晚餐當天不問
  await openAppAt(page, WED, {}, tueFix(), '15:30:00')
  await expect(page.locator('.todo-ask[data-meal="breakfast"]')).toHaveCount(1)
  await expect(page.locator('.todo-ask[data-meal="lunch"]')).toHaveCount(1)
  await expect(page.locator('.todo-ask[data-meal="dinner"]')).toHaveCount(0)
  await expect(page.locator('.todo-ask[data-meal="snack"]')).toHaveCount(0)
  await gotoDate(page, TUE)
  await expect(page.locator('.todo-ask[data-meal="dinner"]')).toHaveCount(1)
})

test('早上 9 點：今天三餐都空著也不問（AC 7）', async ({ page }) => {
  await openAppAt(page, WED, {}, tueFix())
  await expect(page.locator('.timeline .todo-row')).toHaveCount(4)
  await expect(page.locator('.todo-ask')).toHaveCount(0)
  // v2.166：不問的列沒有虛線節點、沒有沒吃膠囊，右邊照舊是箭頭
  await expect(page.locator('.node.is-asking, .node.is-skipped')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /沒吃$/ })).toHaveCount(0)
  await expect(page.locator('.timeline .todo-row .chev')).toHaveCount(4)
})

test('看上週：七根實心、沒有打平框；看下週（明天是下週一）：不出這張卡（AC 8）', async ({ page }) => {
  // 點進去看的那天（11/18）當日清單要跟區間資料一致：stub 的當日清單只認 intakePersist 的假表
  const rw = (id: number, meal: string, kcal: number) => ({
    id, eaten_on: '2026-11-18', meal, food_id: 14, qty: 1, kcal, protein: 1, fat: 1, carb: 1, name: null, mods: [], vendor: null,
    created_at: '2026-11-18T12:00:00Z', foods: { name: '地瓜', vendor: null, archived: false, category: '主食' },
  })
  await openAppAt(page, '2026-11-29', { intakePersist: true }, fixWith({
    intake: [],
    repeatWindow: [rw(501, 'breakfast', 450), rw(502, 'lunch', 630), rw(503, 'dinner', 720)],
    kcalWindow: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'].flatMap((d) => full(d, 1800)),
  }))
  // 今天週日：這週沒有打平的日子
  await expect(page.locator('.wkb')).toHaveCount(1)
  await expect(page.locator('.wkb-bar.is-plan')).toHaveCount(0)
  await gotoDate(page, '2026-11-18')
  await expect(page.locator('.wkb-col')).toHaveCount(7)
  await expect(page.locator('.wkb-bar.is-plan')).toHaveCount(0)
  await expect(page.locator('.wkb-col.is-btn')).toHaveCount(0)
  await expect(total(page)).toHaveText('少吃 350')
  await gotoDate(page, '2026-11-30')
  await expect(page.locator('.wkb')).toHaveCount(0)
})

test('卡頭的字照這張卡的樣式（不被體重趨勢頁同名 class 蓋掉，review S1）', async ({ page }) => {
  await openAppAt(page, THU, {}, fixWith({ intake: TODAY_1200 }))
  const title = page.locator('.wkb-title')
  await expect(title).toHaveText('這週')
  await expect(title).toHaveCSS('font-weight', '800')
  await expect(title).toHaveCSS('font-size', '12.8px')
})

test('這週還在讀：不問沒吃；讀到之後伺服器上按過的晚餐照算，本機再按早餐也不會蓋掉（review S2）', async ({ page }) => {
  await openAppAt(page, WED, { kcalHold: true }, tueFix({
    intakeYday: [item(202, 'lunch', 600)],
    kcalWindow: [...full('2026-11-23', 1850), k(TUE, 'lunch', 600)],
    mealSkip: [{ eaten_on: TUE, meal: 'dinner' }],
  }))
  await gotoDate(page, TUE)
  await expect(page.locator('.timeline .todo-row')).toHaveCount(3)
  await expect(page.locator('.todo-ask')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { __kcalRelease: () => void }).__kcalRelease())
  await expect(page.locator('.todo-ask[data-meal="dinner"]')).toHaveClass(/is-skipped/)
  await page.getByRole('button', { name: '早餐沒吃' }).click()
  await expect(page.locator('.todo-ask[data-meal="breakfast"]')).toHaveClass(/is-skipped/)
  await expect(page.locator('.todo-ask[data-meal="dinner"]')).toHaveClass(/is-skipped/)
  // 兩餐都交代了：週二照實 600，不是沒記完；週一 1850＋600＋今天佔位 1850 − 5550
  await expect(col(page, TUE)).not.toHaveClass(/is-btn/)
  await expect(total(page)).toHaveText('少吃 1250')
  // 讀屏唸結果（按下去那顆鈕已經換掉）
  await expect(page.locator('.todo-ask[data-meal="breakfast"] ~ [role="status"]').first()).toHaveText('已記下早餐沒吃')
})

test('開著不動，到 11 點自己冒出早餐的「沒吃／補記」（review N4）', async ({ page }) => {
  await openAppAt(page, WED, {}, tueFix(), '10:59:56')
  await expect(page.locator('.timeline .todo-row')).toHaveCount(4)
  await expect(page.locator('.todo-ask')).toHaveCount(0)
  await expect(page.locator('.todo-ask[data-meal="breakfast"]')).toHaveCount(1, { timeout: 10_000 })
})

/* 寫入落地（intakePersist）：當日清單與區間資料各自一份假資料，週二的早、午餐兩邊都放 */
const persistFix = () => {
  const rw = (id: number, d: string, meal: string, kcal: number) => ({
    id, eaten_on: d, meal, food_id: 14, qty: 1, kcal, protein: 1, fat: 1, carb: 1, name: null, mods: [], vendor: null,
    created_at: `${d}T12:00:00Z`, foods: { name: '地瓜', vendor: null, archived: false, category: '主食' },
  })
  return fixWith({
    intake: [],
    intakeYday: [],
    repeatWindow: [rw(601, TUE, 'breakfast', 400), rw(602, TUE, 'lunch', 600)],
    kcalWindow: [...full('2026-11-23', 1850), k(TUE, 'breakfast', 400), k(TUE, 'lunch', 600)],
  })
}
const addBanana = async (page: Page) => {
  const sheet = page.locator('[data-screen="log-sheet"]')
  await sheet.getByLabel('吃了什麼').fill('香蕉')
  await sheet.locator('.food-row', { hasText: '香蕉' }).click()
  await sheet.locator('.pick-bar-btn').click()
  await expect(sheet).toHaveCount(0)
}

test('沒吃之後又補記那一餐：照補記的實際算（review S5）', async ({ page }) => {
  await openAppAt(page, WED, { intakePersist: true }, persistFix())
  await gotoDate(page, TUE)
  await page.getByRole('button', { name: '晚餐沒吃' }).click()
  await expect(total(page)).toHaveText('少吃 850')
  // 晚餐那一列本身還是開記一筆的入口
  await page.locator('.timeline .todo-row', { hasText: '晚餐' }).click()
  await addBanana(page)
  // 週二 400＋600＋香蕉 105：週一 1850＋1105＋今天佔位 1850 − 5550
  await expect(total(page)).toHaveText('少吃 745')
  await expect(col(page, TUE)).not.toHaveClass(/is-btn/)
})

test('今天記一筆：總帳當場跟著變；明天預先記錄：打平框換成實際的柱子（review S5）', async ({ page }) => {
  await openAppAt(page, THU, { intakePersist: true }, fixWith({
    intake: [item(301, 'breakfast', 1800)],
    intakeYday: [],
    kcalWindow: [...full('2026-11-23', 1650), ...full('2026-11-24', 1780), ...full('2026-11-25', 2650)],
  }))
  // 今天 1800 → 佔位 1850：多吃 530。記一根香蕉（105）→ 1905 超過目標，照實算：多吃 585
  await expect(total(page)).toHaveText('多吃 530')
  await page.locator('.timeline .todo-row', { hasText: '晚餐' }).click()
  await addBanana(page)
  await expect(total(page)).toHaveText('多吃 585')

  // 明天預先記錄一根香蕉：那天換成實際的柱子、不是打平框
  await gotoDate(page, '2026-11-27')
  await expect(col(page, '2026-11-27').locator('.wkb-bar.is-plan')).toHaveCount(1)
  await page.locator('.timeline .todo-row', { hasText: '早餐' }).click()
  await addBanana(page)
  await expect(col(page, '2026-11-27').locator('.wkb-bar.is-pre')).toHaveCount(1)
  await expect(col(page, '2026-11-27').locator('.wkb-bar.is-plan')).toHaveCount(0)
  // 明天跟目標取大計入、打平剩兩天：12950 − (1650＋1780＋2650＋1905＋1850) = 3115 ÷ 2 = 1557.5 < 下限 1583.75 → 1580
  expect(await plans(page)).toEqual(['1580', '1580'])
})

/* ═══════════ v2.166（spec「三個小改動」）═══════════ */

test('沒吃併進那一餐的標題列：沒有另一行；虛線圈＋小字＋膠囊在同一列，膠囊不包在列的按鈕裡；按了換灰的一橫＋復原', async ({ page }) => {
  await openAppAt(page, WED, {}, tueFix())
  await gotoDate(page, TUE)
  const node = page.locator('.node', { has: page.locator('.todo-ask[data-meal="dinner"]') })
  const row = node.locator('.todo-row')
  const pill = node.getByRole('button', { name: '晚餐沒吃' })
  // 一列：膠囊跟列的按鈕並排（垂直中線對齊）、列高不超過 44
  const r = (await row.boundingBox())!
  const b = (await pill.boundingBox())!
  expect(r.height).toBeLessThanOrEqual(44.5)
  expect(Math.abs(b.y + b.height / 2 - (r.y + r.height / 2))).toBeLessThan(2)
  expect(b.x).toBeGreaterThanOrEqual(r.x + r.width)
  expect(await pill.evaluate((el) => el.closest('.todo-row')), 'button 裡不能再放 button').toBeNull()
  await expect(node.locator('.node-dot')).toHaveCSS('border-top-style', 'dashed')
  await expect(node.locator('.chev'), '問的時候右邊換成膠囊，不再有箭頭').toHaveCount(0)

  // 鍵盤按：「沒吃」與「復原」是同一顆鈕換字，焦點留在原地
  await pill.focus()
  await page.keyboard.press('Enter')
  await expect(node).toHaveClass(/is-skipped/)
  await expect(node.getByRole('button', { name: '復原「晚餐沒吃」' })).toBeFocused()
  await expect(node.locator('.node-dot svg')).toHaveCount(1)
  await expect(node.locator('.node-dot')).toHaveCSS('background-color', 'rgb(227, 231, 230)')
  await expect(node.locator('.node-dot'), '灰底圓盤要有邊（--rule-field）').toHaveCSS('border-top-color', 'rgb(110, 123, 142)')
  await expect(node.getByRole('button', { name: '復原「晚餐沒吃」' })).toHaveText('復原')
  await expect(node.locator('[role="status"]')).toHaveText('已記下晚餐沒吃')
  // 反方向：復原之後焦點也留在原地（換回「沒吃」）
  await page.keyboard.press('Enter')
  await expect(node).not.toHaveClass(/is-skipped/)
  await expect(pill).toBeFocused()
  await expect(node.locator('[role="status"]')).toHaveText('已復原，晚餐還沒記')

  // 點心不問：同一天的點心沒有虛線節點、沒有膠囊
  const snack = page.locator('.node', { has: page.locator('.todo-wrap[data-meal="snack"]') })
  await expect(snack).not.toHaveClass(/is-asking/)
  await expect(snack.getByRole('button', { name: '點心沒吃' })).toHaveCount(0)
})

test('這週讀到的那一下列變成「問」：焦點還在那一列上（不換節點）', async ({ page }) => {
  await openAppAt(page, WED, { kcalHold: true }, tueFix())
  await gotoDate(page, TUE)
  const row = page.locator('.todo-wrap[data-meal="dinner"] .todo-row')
  await expect(page.locator('.todo-ask')).toHaveCount(0)
  await row.focus()
  await expect(row).toBeFocused()
  await page.evaluate(() => (window as unknown as { __kcalRelease: () => void }).__kcalRelease())
  await expect(page.locator('.todo-ask[data-meal="dinner"]')).toHaveCount(1)
  await expect(page.locator('.todo-ask[data-meal="dinner"] .todo-row')).toBeFocused()
})

test('這週卡底下「這週 N 餐沒記」：點了跳到最早那天；都交代了就不出', async ({ page }) => {
  // 週一什麼都沒記（三餐）＋週二晚餐空著
  await openAppAt(page, WED, {}, tueFix({ kcalWindow: [k(TUE, 'breakfast', 400), k(TUE, 'lunch', 600)] }))
  const miss = page.locator('.wkb-miss')
  await expect(miss).toHaveText('這週 4 餐沒記，至少照目標算從週一看')
  await expect(miss).toHaveAccessibleName('這週 4 餐沒記，至少照目標算；從週一看')
  // 跟柱子對得起來：沒記完的那兩天（週一、週二）是可點的虛線欄
  await expect(page.locator('.wkb-col.is-btn')).toHaveCount(2)
  await miss.click()
  expect(await currentIso(page)).toBe('2026-11-23')
})

test('這週卡底下那一行：已經在最早那天，點了把那一餐的列捲進來、焦點放上去', async ({ page }) => {
  await openAppAt(page, WED, {}, tueFix())
  await gotoDate(page, TUE)
  const miss = page.locator('.wkb-miss')
  await expect(miss).toContainText('從週二看')
  // 先把列捲出畫面（捲到最底再捲回頂端，列在卡片下面、第一屏外）
  await page.locator('.timeline').evaluate((el) => { el.scrollTop = 0 })
  await miss.click()
  expect(await currentIso(page)).toBe(TUE)
  const row = page.locator('.todo-ask[data-meal="dinner"] .todo-row')
  await expect(row).toBeFocused()
  await expect(row).toBeInViewport()
})

test('這週卡底下那一行：按了沒吃就少一餐，剩 0 餐就收掉', async ({ page }) => {
  await openAppAt(page, WED, {}, tueFix())
  const miss = page.locator('.wkb-miss')
  await expect(miss).toContainText('這週 1 餐沒記，至少照目標算')
  await expect(miss).toContainText('從週二看')
  await miss.click()
  expect(await currentIso(page)).toBe(TUE)
  await page.getByRole('button', { name: '晚餐沒吃' }).click()
  await expect(miss).toHaveCount(0)
})

test('這週都記滿：底下那一行不出（AC 1 的資料）', async ({ page }) => {
  await openAppAt(page, THU, {}, fixWith({
    intake: TODAY_1200,
    kcalWindow: [...full('2026-11-23', 1650), ...full('2026-11-24', 1780), ...full('2026-11-25', 2650)],
  }))
  await expect(total(page)).toHaveText('多吃 530')
  await expect(page.locator('.wkb-miss')).toHaveCount(0)
})
