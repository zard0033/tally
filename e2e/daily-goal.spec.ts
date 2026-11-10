/* 每日目標頁（spec.md「每日目標改版」）。這份鎖的是**計算引擎在 UI 上的契約**：哪個欄位影響哪個輸出、
   沒碰過的欄位不可以被悄悄改寫、算不出來時顯示什麼、回推值要按確認才生效。算法本身（斜率、門檻、
   窗口邊界、範圍判定）在 baseline.test.ts、formulas.test.ts，這裡不重複。

   fixture 的數字（e2e/fixtures.ts）：體重 75.95、身高 175、出生年 1993、男、活動 1.375、
   蛋白質 1.8 g/kg、goal=cut、rate_kg_per_week=0.5（每天差 550）、無體脂率 → 走 Mifflin-St Jeor。 */
import { test, expect, type Page } from '@playwright/test'
import { monthDay, shiftDate } from '../src/lib/dates'
import { FIX, TODAY } from './fixtures'
import { openApp } from './harness'

async function openGoal(page: Page) {
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '每日目標' }).click()
  await expect(page.locator('[data-screen="daily-goal"]')).toBeVisible()
}

const profilePatches = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __writes: { table: string; method: string; body: Record<string, unknown> }[] }).__writes.filter(
      (w) => w.table === 'profile' && w.method === 'PATCH',
    ),
  )

/** 數字區那行「蛋白 137g・脂肪 65g・碳水 163g」拆成數字，欄位沒填完時回 null。 */
async function macros(page: Page): Promise<{ protein: number; fat: number; carb: number } | null> {
  const text = ((await page.locator('.goal-hero-macros').textContent()) ?? '').trim()
  const m = /蛋白 (\d+)g・脂肪 (\d+)g・碳水 (\d+)g/.exec(text)
  return m ? { protein: Number(m[1]), fat: Number(m[2]), carb: Number(m[3]) } : null
}

const heroNum = (page: Page) => page.locator('.goal-hero .gauge-num')
const kcal = async (page: Page) => Number(((await heroNum(page).textContent()) ?? '').replace(/[^\d]/g, ''))
const src = (page: Page) => page.locator('.goal-hero-src')
const setWriteDelay = (page: Page, ms: number) =>
  page.evaluate((d) => {
    ;(window as unknown as { __writeDelayMs: number }).__writeDelayMs = d
  }, ms)

test('目標與速度各自一列；選「維持」時速度那列消失，換回減重／增肌又出現', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await expect(page.locator('#g-goal')).toHaveValue('cut')
  await expect(page.locator('#g-rate')).toBeVisible()

  await page.locator('#g-goal').selectOption('maintain')
  await expect(page.locator('#g-rate'), '維持沒有變化速度可言，那列該整個不渲染').toHaveCount(0)

  await page.locator('#g-goal').selectOption('bulk')
  await expect(page.locator('#g-rate'), '換回增肌時速度那列沒回來').toBeVisible()
})

/* v2.23 的核心裁決：脂肪是「體重 × 0.85 g/kg 固定值」，目標只能動總熱量與碳水。 */
test('脂肪＝體重固定 g/kg：換目標只動熱量與碳水，脂肪一克不變', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  const cut = await macros(page)
  const cutKcal = await kcal(page)
  expect(cut, '前提不成立：cut 狀態下算不出來').not.toBeNull()

  await page.locator('#g-goal').selectOption('maintain')
  await expect(heroNum(page)).not.toHaveText(String(cutKcal))
  const maintain = await macros(page)
  const maintainKcal = await kcal(page)
  expect(maintain).not.toBeNull()

  expect(maintain!.fat, '換目標把脂肪也改掉了——脂肪應該只跟體重有關').toBe(cut!.fat)
  expect(maintain!.protein, '蛋白質也只跟體重有關，不該隨目標變').toBe(cut!.protein)
  expect(maintainKcal, '維持的熱量沒有高於減重').toBeGreaterThan(cutKcal)
  expect(maintain!.carb, '多出來的熱量沒有落到碳水上').toBeGreaterThan(cut!.carb)

  // 75.95 kg × 0.85 = 64.56 → 65。寫死這個數字是刻意的：改了 FAT_G_PER_KG 就該來改這裡
  expect(cut!.fat).toBe(65)
})

/* 舊版的迴歸鎖（precommit-review）：DB 的 0.5 kg/週＝2.17 kg/月，超出五格上限，選單只能取近似值來畫。
   改了就存之後，保證方式變成「只送改動的欄位」，近似值根本沒機會被寫回去；畫面也不再假裝它是最接近那格。 */
test('改一列只送那一欄；沒碰過的速度顯示真實值、不被近似值覆寫', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await expect(page.locator('#g-rate'), 'DB 值對不上五格時要顯示真實值').toHaveValue('2.17')
  await expect(page.locator('.goal-pick', { hasText: '速度' }).locator('.val')).toHaveText('2.17 kg/月')

  await page.locator('#g-protein').selectOption('2')

  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  expect((await profilePatches(page))[0].body, '只該送蛋白質這一欄').toEqual({ protein_g_per_kg: 2 })
  await expect(page.locator('#g-rate')).toHaveValue('2.17')
})

test('改速度：換算成 kg/週 寫回、數字當場變、閃已儲存', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  const before = await kcal(page)

  await page.locator('#g-rate').selectOption('1')

  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  // 1 kg/月 ÷ (52/12) 週 ≈ 0.2308，資料庫是 numeric(3,2)，先捨入成 0.23
  expect((await profilePatches(page))[0].body).toEqual({ rate_kg_per_week: 0.23 })
  // 每天差從 550 變成 0.23 × 1100 ＝ 253，目標多 297
  await expect.poll(() => kcal(page)).toBe(before + 297)
  await expect(page.locator('.goal-saved')).toHaveText('已儲存')
  await expect(page.locator('.goal-saved'), '已儲存要自己消失').toHaveText('', { timeout: 3000 })
  await expect(page.getByRole('button', { name: '儲存', exact: true }), '改了就存，不該還有儲存鈕').toHaveCount(0)
})

test('連改：前一筆回來前不併發，同一欄只留最後一次', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  // 兩次選擇都要在第一筆回來前做完：機器忙時 Playwright 的來回會超過 300ms
  await setWriteDelay(page, 1500)

  await page.locator('#g-protein').selectOption('2')
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  await page.locator('#g-protein').selectOption('1.4')
  await page.locator('#g-protein').selectOption('1.6')
  expect(await profilePatches(page), '前一筆還沒回來就送了第二筆').toHaveLength(1)

  await expect.poll(async () => (await profilePatches(page)).length, { timeout: 8000 }).toBe(2)
  const bodies = (await profilePatches(page)).map((w) => w.body)
  expect(bodies).toEqual([{ protein_g_per_kg: 2 }, { protein_g_per_kg: 1.6 }])
  await expect(page.locator('.goal-saved')).toHaveText('已儲存', { timeout: 8000 })
  await expect(page.locator('#g-protein'), '落定後要是最後選的值').toHaveValue('1.6')
  // 75.95 × 1.6 = 121.5
  expect((await macros(page))!.protein).toBe(122)
})

test('存檔失敗：退回原值、顯示錯誤，數字也回來', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  const before = await kcal(page)
  await page.evaluate(() => {
    ;(window as unknown as { __failNext: { table: string; method: string } }).__failNext = { table: 'profile', method: 'PATCH' }
  })

  await page.locator('#g-goal').selectOption('maintain')

  await expect(page.locator('.goal-err')).toBeVisible()
  await expect(page.locator('#g-goal'), '失敗要退回原值').toHaveValue('cut')
  await expect(page.locator('#g-rate')).toBeVisible()
  expect(await kcal(page)).toBe(before)
  await expect(page.locator('.goal-saved')).toHaveText('')
})

/* 刻意設計：預覽只要求「能不能算」，欄位打到一半算不出來就顯示 —，不跳錯誤；擋不合理值是失焦時才做的事。 */
test('基本資料清空時顯示 — 而不跳錯誤；失焦才擋、不送任何寫入；填回來才存', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await page.locator('#g-birth-year').fill('')
  await expect(heroNum(page)).toHaveText(/—/)
  await expect(page.locator('.goal-hero-macros')).toHaveText('欄位還沒填完，先看不出目標')
  await expect(page.locator('.sheet-error'), '只是清空欄位就跳錯誤，打字打到一半會被吵').toHaveCount(0)

  await page.locator('#g-height').focus()
  await expect(page.locator('.sheet-error'), '同一組裡切下一格不算離開').toHaveCount(0)
  await page.locator('#g-height').blur()
  await expect(page.locator('.goal-err')).toContainText('出生年')
  expect(await profilePatches(page), '驗證沒過卻送出了寫入').toHaveLength(0)

  await page.locator('#g-birth-year').fill('1990')
  await expect(page.locator('.goal-err'), '開始改就收掉舊錯誤').toHaveCount(0)
  await page.locator('#g-birth-year').blur()
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  expect((await profilePatches(page))[0].body).toEqual({ birth_year: 1990 })
  await expect(heroNum(page)).toHaveText(/\d/)
})

/* v2.118：「怎麼算的」三段算式都代入自己的數字，算到最後就是頂端的每日目標。
   fixture：75.95 kg、175 cm、1993 年（年齡依跑測年份而變，從畫面讀）、男、1.375、0.5 kg/週、1.8 g/kg。 */
test('怎麼算的預設收合；打開是三段算式、代入自己的數字，最後一行等於頂端的數字', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  const how = page.locator('.goal-how')
  await expect(how.locator('.goal-calc')).toBeHidden()

  await how.locator('summary').click()
  expect(
    await how.locator('summary').evaluate((el) => getComputedStyle(el).outlineStyle),
    '滑鼠點開不該有焦點框，那是給鍵盤的',
  ).toBe('none')
  const calc = how.locator('.goal-calc')
  await expect(calc).toBeVisible()
  await expect(calc.locator('h3')).toHaveText(['① 公式推導使用中', '① 紀錄回推', '② 減重', '③ 怎麼分'])
  // fixture 沒有體脂率 ⇒ 用 Mifflin-St Jeor，男性 ＋5，代入體重與身高
  await expect(calc).toContainText('BMR（Mifflin-St Jeor）＝ 10 × 體重 75.95 ＋ 6.25 × 身高 175')
  await expect(calc).toContainText('× 活動係數 1.375')
  // 速度用資料庫存的 kg/週：0.5 × 7700 ÷ 7 ＝ 550
  await expect(calc).toContainText('每天少吃 ＝ 0.5 × 7700 ÷ 7 ＝ 550 卡')
  const target = await kcal(page)
  await expect(calc).toContainText(`＝ ${target} 卡`)
  await expect(calc).toContainText('脂肪 ＝ 0.85 g × 體重 75.95 ＝ 65 g')
})

/* 使用者回報的卡點：捲到選單時數字在畫面外約 345px，「即時預覽」等於看不到。 */
test('捲到最下面時數字區仍在可視範圍內', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await page.locator('.goal-how summary').click()

  const scroll = page.locator('.goal-scroll')
  const moved = await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    return el.scrollTop
  })
  expect(moved, '前提不成立：內容不夠長、沒捲動，這條沒驗到').toBeGreaterThan(0)
  const box = (await page.locator('.goal-hero').boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThan(745)
  await expect(page.locator('.goal-hero')).toBeInViewport({ ratio: 1 })
})

test('每一列命中區 ≥44px，整列都點得到 select', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  for (const id of ['g-goal', 'g-rate', 'g-protein', 'g-activity']) {
    const row = page.locator(`.goal-pick:has(#${id}), .goal-sub-pick:has(#${id})`)
    // 版面變長後有些列在可視範圍外，elementFromPoint 只量得到看得見的點
    await row.scrollIntoViewIfNeeded()
    const box = (await row.boundingBox())!
    expect(box.height, `${id} 那列矮於 44px`).toBeGreaterThanOrEqual(44)
    // 列的左緣、右緣點下去都要打到 select，不能只有值那一小塊有反應
    for (const x of [box.x + 4, box.x + box.width - 4]) {
      const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id, [x, box.y + box.height / 2])
      expect(hit, `${id} 那列的 x=${x} 點不到 select`).toBe(id)
    }
  }
})

test('最長的選項放得下：活動係數那列的值不折行、不撞標籤', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await page.locator('#g-activity').selectOption('1.375')

  const row = page.locator('.goal-sub-pick', { hasText: '活動係數' })
  await expect(row.locator('.val')).toHaveText('1.375輕度活動')
  const { rowHeight, overflow } = await row.evaluate((el) => ({
    rowHeight: el.getBoundingClientRect().height,
    overflow: el.scrollWidth - el.clientWidth,
  }))
  expect(rowHeight, '值折行把列撐高了').toBeLessThanOrEqual(48)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('自訂目標：四格都標必填，離開整組才存、不合法不寫；加總提示；切回自動不動到自訂值', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await page.locator('.goal-seg-wrap .seg button', { hasText: '自訂' }).click()

  await expect(page.locator('.goal-custom .req')).toHaveCount(4)
  await expect(src(page)).toContainText('填完才生效')

  await page.locator('#g-custom-kcal').fill('2000')
  await page.locator('#g-custom-protein').focus()
  await expect(page.locator('.sheet-error'), '依序填到一半切下一格不該跳紅字').toHaveCount(0)
  await page.locator('#g-custom-protein').blur()
  await expect(page.locator('.goal-err'), '離開整組還沒填完要說缺什麼').toContainText('蛋白質／脂肪／碳水')
  expect(await profilePatches(page), '沒填完不該寫').toHaveLength(0)

  await page.locator('#g-custom-protein').fill('150')
  await page.locator('#g-custom-fat').fill('60')
  await page.locator('#g-custom-carb').fill('200')
  // 150×4 + 60×9 + 200×4 ＝ 1940，比熱量少 60
  await expect(page.locator('.goal-sum')).toHaveText('三大營養素加起來 1940 卡，比熱量少 60 卡')
  await expect(page.locator('.goal-err'), '開始改就收掉舊錯誤').toHaveCount(0)
  await page.locator('#g-custom-kcal').focus()
  expect(await profilePatches(page), '還在同一組裡不該存').toHaveLength(0)
  await page.locator('#g-custom-kcal').blur()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  expect((await profilePatches(page))[0].body).toEqual({
    use_custom_targets: true,
    custom_kcal: 2000,
    custom_protein_g: 150,
    custom_fat_g: 60,
    custom_carb_g: 200,
  })
  await expect(heroNum(page)).toHaveText('2000')
  await expect(src(page)).toContainText('自己填的')

  await page.locator('#g-custom-kcal').fill('1940')
  await expect(page.locator('.goal-sum')).toHaveText('三大營養素加起來 1940 卡，和熱量一致')
  await page.locator('#g-custom-kcal').blur()
  await expect.poll(async () => (await profilePatches(page)).length, '離開要存新的熱量').toBe(2)

  await page.locator('.goal-seg-wrap .seg button', { hasText: '自動' }).click()
  await expect.poll(async () => (await profilePatches(page)).length).toBe(3)
  expect((await profilePatches(page))[2].body, '切回自動只動開關，自訂值要留著').toEqual({ use_custom_targets: false })
  await expect(src(page)).toContainText('（公式推導）')
})

test('切自動／自訂時捲動位置回頂：自訂第一格不會被捲走', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  // 矮視窗（小手機、鍵盤升起）：自訂那頁也比可視區長，切過去才不會因為內容變短就自然歸零
  await page.setViewportSize({ width: 393, height: 460 })
  const scroll = page.locator('.goal-scroll')
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  await page.locator('.goal-seg-wrap .seg button', { hasText: '自訂' }).click()
  await expect(page.locator('#g-custom-kcal')).toBeInViewport()
  expect(
    await scroll.evaluate((el) => el.scrollHeight - el.clientHeight),
    '前提不成立：自訂那頁沒有比可視區長，歸零不是 reset 造成的',
  ).toBeGreaterThan(0)
  expect(await scroll.evaluate((el) => el.scrollTop)).toBe(0)
})

/* ═══════════ 維持熱量與確認（spec.md「每日目標改版」）═══════════ */

/** 近 28 天每天吃 kcalPerDay、體重全程持平 75 kg（6 筆橫跨 26 天）⇒ 回推＝kcalPerDay。
 *  體重陣列最新在前：stub 對 getLatestWeight 與 listWeights 回同一份，rows[0] 就是「最新」。 */
function windowFix(kcalPerDay: number, weighInDays = [0, 5, 10, 15, 20, 26]): typeof FIX {
  const kcalWindow = [
    ...Array.from({ length: 28 }, (_, i) => ({ eaten_on: shiftDate(TODAY, -1 - i), qty: 1, kcal: kcalPerDay })),
    // 今天還沒記完，不進窗口：stub 不看 filter 會把這列一起回，守住的是「窗尾是昨天」
    { eaten_on: TODAY, qty: 1, kcal: 9999 },
  ]
  const weight = weighInDays.map((i) => ({
    weight_kg: 75,
    measured_on: shiftDate(TODAY, -1 - i),
    body_fat_pct: null,
  }))
  return { ...FIX, profile: [{ ...FIX.profile[0] }], kcalWindow, weight } as unknown as typeof FIX
}

const card = (page: Page) => page.locator('[data-card="maintenance"]')
const cardRow = (page: Page, label: string) => card(page).locator('.goal-row', { hasText: label }).locator('.val')
const confirm = (page: Page) => page.locator('.goal-confirm')
/** ① 維持熱量的兩種算法（公式推導／紀錄回推）那一列，與它右邊的數字。 */
const est = (page: Page, label: string) => card(page).locator('.goal-est', { hasText: label })
const estVal = (page: Page, label: string) => est(page, label).locator('.goal-est-val')
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: unknown[] }).__writes.length)

test('記錄不夠：說差什麼、有進度條、不給數字、不問', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await expect(card(page)).toContainText('記錄還差 21 天')
  await expect(card(page)).toContainText('體重還差 4 筆')
  await expect(card(page)).toContainText('就算得出來')
  await expect(estVal(page, '紀錄回推')).toHaveText('還算不出來')
  await expect(est(page, '紀錄回推'), '算不出來時那一列不能點').not.toHaveJSProperty('tagName', 'BUTTON')
  await expect(card(page).locator('.goal-meter-track')).toBeVisible()
  await expect(card(page), '不夠時不該出現「約 N 卡」').not.toContainText('約')
  await expect(confirm(page)).toHaveCount(0)
})

test('有新數字：確認卡列出前後目標、原因與依據；不按什麼都不變', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)

  const before = await kcal(page)
  const formula = Number(((await estVal(page, '公式推導').textContent()) ?? '').replace(/[^\d]/g, ''))
  await expect(estVal(page, '紀錄回推')).toHaveText('2000 卡')
  // 體重全程持平 ⇒ 平均吃多少就是多少，體重換算 0
  await expect(est(page, '紀錄回推')).toContainText('平均吃 2000 ＋ 體重換算 0')
  await expect(confirm(page)).toContainText(`紀錄回推比公式推導少 ${formula - 2000} 卡`)
  await expect(confirm(page).locator('.old')).toHaveText(String(before))
  // 2000 − 550
  await expect(confirm(page).locator('.new')).toHaveText('1450 卡')
  const weekly = (Math.abs(before - 2000) * 7) / 7700
  await expect(confirm(page)).toContainText(`照現在的目標吃，每週約瘦 ${weekly.toFixed(2)} kg`)
  await expect(confirm(page)).toContainText('你設定的是每週約瘦 0.50 kg')
  await expect(confirm(page)).toContainText('依據近 28 天：記錄 28 天、體重 6 筆')
  await expect(confirm(page)).toContainText('漏記的餐會讓這個數字偏低')
  await expect(confirm(page), '體重少於 8 筆要加註誤差').toContainText('體重只有 6 筆，誤差可能到幾百卡')
  // 1450 低於 BMR（約 1684）
  await expect(confirm(page).locator('.goal-confirm-warn')).toContainText('比基礎代謝')

  expect(await kcal(page), '還沒按改用，目標不該變').toBe(before)
  expect(await writes(page), '打開頁面不該寫任何東西').toBe(0)

  /* 查詢的日期範圍：stub 不看 filter、estimateMaintenance 又會自己再過濾一次，所以窗口寫錯在其他斷言裡看不見。
     月份小點也會打同形狀的區間查詢，卡片的窗口是 118 天，取跨度最大的那支。 */
  const req = await page.evaluate(() => {
    const span = (u: string) => {
      const from = /eaten_on=gte\.([\d-]+)/.exec(u)?.[1]
      const to = /eaten_on=lte\.([\d-]+)/.exec(u)?.[1]
      return from && to ? Date.parse(to) - Date.parse(from) : 0
    }
    return (window as unknown as { __allFetches: string[] }).__allFetches
      .map((u) => decodeURIComponent(u))
      .filter((u) => u.includes('/rest/v1/intake') && /select=[^&]*eaten_on/.test(u) && !/select=[^&]*meal/.test(u))
      .sort((a, b) => span(b) - span(a))[0]
  })
  expect(req, '沒有送出區間查詢').toBeTruthy()
  expect(req).toContain(`eaten_on=gte.${shiftDate(TODAY, -118)}`)
  expect(req).toContain(`eaten_on=lte.${shiftDate(TODAY, -1)}`)
})

test('改用：寫入兩欄、目標與來源都變、活動量消失；今日頁與設定入口用新目標', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)

  await confirm(page).locator('.goal-btn.primary').click()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  expect((await profilePatches(page))[0].body).toEqual({ measured_tdee: 2000, measured_tdee_on: TODAY })
  await expect(heroNum(page)).toHaveText('1450')
  await expect(src(page)).toContainText('維持熱量 2000（紀錄回推） − 減重 550')
  await expect(est(page, '紀錄回推')).toContainText(`${monthDay(TODAY)} 確認的數字`)
  await expect(page.locator('.goal-saved')).toHaveText('已儲存')
  await expect(confirm(page), '改用後就在範圍內，不該再問').toHaveCount(0)
  await expect(page.locator('#g-activity'), '用回推值時目標不吃活動量').toHaveCount(0)
  await expect(est(page, '紀錄回推')).toHaveClass(/\bon\b/)
  await expect(est(page, '紀錄回推').locator('.goal-tag')).toHaveText('使用中')
  await expect(estVal(page, '紀錄回推')).toHaveText('2000 卡')
  await expect(card(page).locator('.goal-sec-h .out')).toHaveText('2000 卡')
  await expect(est(page, '公式推導'), '公式推導那列變成可以點回去').toHaveJSProperty('tagName', 'BUTTON')

  await page.getByRole('button', { name: '返回設定' }).click()
  await expect(page.locator('.entry-row', { hasText: '每日目標' }).locator('.lb-sub').first()).toContainText('1450 卡')
  await page.locator('.tab').first().click()
  await expect(page.locator('.gauge-side .tgt')).toHaveText('1450')
})

test('先不要：不寫資料、確認框收起；點紀錄回推那一列再開', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)
  const before = await kcal(page)

  await confirm(page).locator('.goal-btn.quiet').click()
  await expect(confirm(page)).toHaveCount(0)
  expect(await writes(page)).toBe(0)
  expect(await kcal(page)).toBe(before)

  await est(page, '紀錄回推').click()
  await expect(confirm(page)).toBeVisible()
})

test('已改用的帳號：吃資料庫的值（numeric 字串）；改回公式清成 null，不會馬上又問', async ({ page }) => {
  const fix = windowFix(2000)
  Object.assign(fix.profile[0], { measured_tdee: '2000.0', measured_tdee_on: '2026-10-30' })
  await openApp(page, {}, fix)
  await openGoal(page)

  await expect(heroNum(page)).toHaveText('1450')
  await expect(src(page)).toContainText('維持熱量 2000（紀錄回推）')
  await expect(est(page, '紀錄回推')).toContainText('10/30 確認的數字')
  await expect(confirm(page)).toHaveCount(0)

  await est(page, '公式推導').click()
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  expect((await profilePatches(page))[0].body).toEqual({ measured_tdee: null, measured_tdee_on: null })
  await expect(heroNum(page)).not.toHaveText('1450')
  await expect(src(page)).toContainText('（公式推導）')
  await expect(page.locator('#g-activity')).toBeVisible()
  await expect(confirm(page), '剛改回公式就又跳卡片太吵').toHaveCount(0)
  await expect(est(page, '紀錄回推'), '改回之後點紀錄回推那一列可以再改用').toHaveJSProperty('tagName', 'BUTTON')
})

test('現用值在範圍內：不打擾，沒有「要更新嗎」', async ({ page }) => {
  // 公式值依年齡而變，不寫死：改用後現用值就等於回推值，一定在範圍內
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)
  await confirm(page).locator('.goal-btn.primary').click()
  await expect(confirm(page)).toHaveCount(0)
  await expect(estVal(page, '紀錄回推')).toHaveText('2000 卡')
  await expect(card(page).locator('.goal-pick', { hasText: '要更新嗎' })).toHaveCount(0)
})

test('沒有低於基礎代謝就沒有紅字；體重滿 8 筆就沒有誤差加註', async ({ page }) => {
  await openApp(page, {}, windowFix(2600, [0, 3, 6, 9, 12, 15, 20, 26]))
  await openGoal(page)

  // 2600 − 550 ＝ 2050，高於 BMR
  await expect(confirm(page).locator('.new')).toHaveText('2050 卡')
  await expect(confirm(page).locator('.goal-confirm-warn')).toHaveCount(0)
  await expect(confirm(page)).not.toContainText('誤差可能到幾百卡')
})

test('自訂目標模式：不問，但對帳跟著輸入框走', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)

  await page.locator('.goal-seg-wrap .seg button', { hasText: '自訂' }).click()
  await expect(confirm(page)).toHaveCount(0)
  await page.locator('#g-custom-kcal').fill('1500')

  await expect(cardRow(page, '紀錄回推的維持熱量')).toHaveText('約 2000 卡')
  // (1500 − 2000) × 7 ÷ 7700 ≈ −0.45
  await expect(cardRow(page, '照這個目標吃')).toHaveText('每週約瘦 0.45 kg')
  await expect(card(page).locator('.goal-est'), '自訂沒有維持熱量可切換').toHaveCount(0)
  expect(await writes(page), '打字不該寫入').toBe(0)
})

/* ═══════════ v2.118 照算式排（樣張 daily-goal-v2.html）═══════════ */

test('頂端：大數字標「每日目標」，算式膠囊的兩個數字相減剛好等於大數字', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await expect(page.locator('.goal-hero-cap')).toHaveText('每日目標')
  const eq = ((await page.locator('.goal-hero-eq').textContent()) ?? '').trim()
  const m = /^維持熱量 (\d+)（公式推導） − 減重 (\d+)$/.exec(eq)
  expect(m, `算式膠囊的格式不對：「${eq}」`).not.toBeNull()
  expect(Number(m![1]) - Number(m![2]), '算式要用畫面上的整數相減，才會剛好等於大數字').toBe(await kcal(page))
  // 段標題右邊寫這段算出來的數字，跟算式對得起來
  await expect(page.locator('.goal-sec-h', { hasText: '① 維持熱量（TDEE）' }).locator('.out')).toHaveText(`${m![1]} 卡`)
  await expect(page.locator('.goal-sec-h', { hasText: '② 減重多少' }).locator('.out')).toHaveText(`− ${m![2]} 卡／天`)
  // 公式推導那列直接寫 BMR × 活動係數，使用中
  await expect(est(page, '公式推導')).toContainText('× 活動係數 1.375')
  await expect(est(page, '公式推導').locator('.goal-tag')).toHaveText('使用中')

  await page.locator('#g-goal').selectOption('maintain')
  await expect(page.locator('.goal-hero-eq'), '維持沒有減項').toHaveText(`維持熱量 ${m![1]}（公式推導）`)
  await expect(page.locator('.goal-sec-h', { hasText: '② 目標' }).locator('.out')).toHaveText('± 0 卡')
})

test('兩種維持熱量那兩列的算式不換行：393 寬、桌機捲軸佔掉 15px 也一樣', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)
  await expect(estVal(page, '紀錄回推')).toHaveText('2000 卡')

  const lines = async () =>
    card(page).locator('.goal-est').evaluateAll((rows) =>
      rows.map((row) => {
        const sub = row.querySelector('.goal-est-sub') as HTMLElement
        return { text: sub.textContent, clipped: sub.scrollWidth > sub.clientWidth + 1, h: sub.getBoundingClientRect().height }
      }),
    )
  for (const l of await lines()) {
    expect(l.clipped, `「${l.text}」被擠到截斷`).toBe(false)
    expect(l.h, `「${l.text}」換行了`).toBeLessThan(24)
  }
  // 模擬桌機的實體捲軸：捲動區右邊多 15px
  await page.addStyleTag({ content: '.goal-scroll { padding-right: calc(var(--s-5) + 15px) !important; }' })
  for (const l of await lines()) expect(l.clipped, `有捲軸時「${l.text}」被擠到截斷`).toBe(false)
})

test('③ 怎麼分的 ⓘ：點了才出現脂肪碳水的規則，點外面、按 Esc 收起；命中區 ≥44px', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  const info = page.getByRole('button', { name: '脂肪和碳水怎麼分' })
  const pop = page.locator('.goal-pop')
  await expect(pop).toHaveCount(0)
  const hit = await info.evaluate((b) => {
    const r = b.getBoundingClientRect()
    const before = getComputedStyle(b, '::before')
    return { w: r.width - 2 * parseFloat(before.left), h: r.height - 2 * parseFloat(before.top) }
  })
  expect(hit.w).toBeGreaterThanOrEqual(44)
  expect(hit.h).toBeGreaterThanOrEqual(44)

  const m = (await macros(page))!
  await info.click()
  await expect(pop).toBeVisible()
  await expect(pop).toContainText(`脂肪固定每公斤 0.85 g（${m.fat} g），剩下的熱量都給碳水（${m.carb} g）`)
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)

  await info.click()
  await expect(pop).toBeVisible()
  await page.locator('.goal-hero').click()
  await expect(pop).toHaveCount(0)
})

test('已改用、最新回推跑出範圍外：自己展開確認框；先不要之後有「要更新嗎」那一列', async ({ page }) => {
  const fix = windowFix(2000)
  Object.assign(fix.profile[0], { measured_tdee: 2300, measured_tdee_on: '2026-10-30' })
  await openApp(page, {}, fix)
  await openGoal(page)

  await expect(estVal(page, '紀錄回推'), '使用中的是存下的數字').toHaveText('2300 卡')
  await expect(confirm(page)).toContainText('紀錄回推比現在用的少 300 卡')
  // 2300 − 550 → 2000 − 550
  await expect(confirm(page).locator('.old')).toHaveText('1750')
  await expect(confirm(page).locator('.new')).toHaveText('1450 卡')

  await confirm(page).locator('.goal-btn.quiet').click()
  await expect(confirm(page)).toHaveCount(0)
  const update = card(page).locator('.goal-pick', { hasText: '最新紀錄回推約 2000 卡，要更新嗎' })
  await update.click()
  await confirm(page).locator('.goal-btn.primary').click()
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  expect((await profilePatches(page))[0].body).toEqual({ measured_tdee: 2000, measured_tdee_on: TODAY })
  await expect(heroNum(page)).toHaveText('1450')
  await expect(update, '更新後就在範圍內').toHaveCount(0)
})

test('回推在範圍內：不自己跳確認框，但點紀錄回推那一列照樣能改用；切自訂再切回不會自己又開', async ({ page, context }) => {
  // 公式值依年齡與體重而變：先用同一份體重（windowFix 是 75 kg）讀出來，再開一頁把近 28 天每天都吃這麼多、
  // 體重持平 ⇒ 回推＝公式值，落在範圍內
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)
  const formula = Number(((await estVal(page, '公式推導').textContent()) ?? '').replace(/[^\d]/g, ''))
  expect(formula).toBeGreaterThan(1000)

  const p2 = await context.newPage()
  await openApp(p2, {}, windowFix(formula))
  await openGoal(p2)
  await expect(estVal(p2, '紀錄回推')).toHaveText(`${formula} 卡`)
  await expect(confirm(p2), '範圍內不打擾').toHaveCount(0)

  await est(p2, '紀錄回推').click()
  await expect(confirm(p2), '自己點的就要開').toBeVisible()
  await p2.locator('.goal-seg-wrap .seg button', { hasText: '自訂' }).click()
  await p2.locator('.goal-seg-wrap .seg button', { hasText: '自動' }).click()
  await expect(confirm(p2), '切模式回來不該自己又開').toHaveCount(0)

  await est(p2, '紀錄回推').click()
  await confirm(p2).locator('.goal-btn.primary').click()
  await expect.poll(async () => (await profilePatches(p2)).length).toBe(1)
  expect((await profilePatches(p2))[0].body).toEqual({ measured_tdee: formula, measured_tdee_on: TODAY })
  await expect(est(p2, '紀錄回推').locator('.goal-tag')).toHaveText('使用中')
})

test('怎麼算的：速度寫選單上的值（不是換算回來的 2.17），後面註明存成每週多少', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await page.locator('#g-rate').selectOption('1.5')
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  await page.locator('.goal-how summary').click()
  // 1.5 kg/月 存成 0.35 kg/週 ⇒ 0.35 × 7700 ÷ 7 ＝ 385
  await expect(page.locator('.goal-calc')).toContainText('速度 1.5 kg/月（存成每週 0.35 kg）')
  await expect(page.locator('.goal-calc')).toContainText('每天少吃 ＝ 0.35 × 7700 ÷ 7 ＝ 385 卡')
  await expect(page.locator('.goal-hero-eq')).toContainText('− 減重 385')
})

test('讀不到記錄：不拖垮頁面，也不問', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await page.evaluate(() => { (window as unknown as { __kcalFail: boolean }).__kcalFail = true })
  await page.locator('.tab[aria-label="設定"]').click()
  await expect(page.locator('.entry-row', { hasText: '每日目標' }).locator('.lb-new')).toHaveCount(0)
  await page.locator('.entry-row', { hasText: '每日目標' }).click()

  await expect(estVal(page, '紀錄回推')).toHaveText('讀不到紀錄')
  expect(await kcal(page)).toBeGreaterThan(0)
  await expect(confirm(page)).toHaveCount(0)
  expect(await writes(page)).toBe(0)
})

test('設定頁入口：有新數字才多一句，改用後消失', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await page.locator('.tab[aria-label="設定"]').click()
  const entry = page.locator('.entry-row', { hasText: '每日目標' })
  await expect(entry.locator('.lb-new')).toHaveText('紀錄回推出新的維持熱量')
  const colors = await entry.locator('.lb-new').evaluate((el) => ({
    own: getComputedStyle(el).color,
    accent: (() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent)'
      document.body.append(probe)
      const c = getComputedStyle(probe).color
      probe.remove()
      return c
    })(),
  }))
  expect(colors.own, '提示沒吃到強調色，被 .lb-sub 蓋掉了').toBe(colors.accent)

  await entry.click()
  await confirm(page).locator('.goal-btn.primary').click()
  await expect(heroNum(page)).toHaveText('1450')
  await page.getByRole('button', { name: '返回設定' }).click()
  await expect(entry.locator('.lb-new')).toHaveCount(0)
})

test('設定頁入口：記錄不夠時不多那一句', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  // 先等估算回來：入口的 .lb-new 在估算回來前本來就不存在，直接斷言等於沒驗
  await expect(card(page)).toContainText('記錄還差')
  await page.getByRole('button', { name: '返回設定' }).click()
  await expect(page.locator('.entry-row', { hasText: '每日目標' }).locator('.lb-new')).toHaveCount(0)
})

test('體重有雜訊：怎麼算的裡顯示估計範圍，且包住估計值', async ({ page }) => {
  const noisy: typeof FIX = {
    ...windowFix(2000),
    // 同樣 6 筆、同樣橫跨 26 天，但上下抖動——斜率的標準誤差不是 0，區間才有寬度
    weight: [75.0, 75.9, 74.4, 75.7, 74.8, 75.3].map((kg, n) => ({
      weight_kg: kg,
      measured_on: shiftDate(TODAY, -1 - [0, 5, 10, 15, 20, 26][n]),
      body_fat_pct: null,
    })),
  }
  await openApp(page, {}, noisy)
  await openGoal(page)
  await page.locator('.goal-how summary').click()

  const main = Number(((await estVal(page, '紀錄回推').textContent()) ?? '').replace(/[^\d]/g, ''))
  const m = /估計範圍約 (\d+)–(\d+) 卡/.exec((await page.locator('.goal-calc').textContent()) ?? '')
  expect(m, '有雜訊時應顯示「估計範圍約 low–high 卡」').not.toBeNull()
  expect(Number(m![1])).toBeLessThan(main)
  expect(Number(m![2])).toBeGreaterThan(main)
})

test('體重全程持平：範圍收斂成一點就不顯示那一列', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)
  await page.locator('.goal-how summary').click()
  await expect(page.locator('.goal-calc')).not.toContainText('估計範圍')
  await expect(page.locator('.goal-how')).toContainText('依據近 28 天：記錄 28 天、體重 6 筆')
})

test('一筆體重打錯（57.5 之於 75.5）：說資料有誤，不給離譜的數字，也不問', async ({ page }) => {
  const dates = [0, 5, 10, 15, 20, 26].map((i) => shiftDate(TODAY, -1 - i))
  const mistyped: typeof FIX = {
    ...windowFix(1800),
    // 最舊的一筆在窗口最前端；最新在前的順序不變。窗口最前端打錯會讓斜率變成每週 +3.6 kg
    weight: dates.map((d, n) => ({ weight_kg: n === 5 ? 57.5 : 75.5, measured_on: d, body_fat_pct: null })),
  }
  await openApp(page, {}, mistyped)
  await openGoal(page)

  await expect(estVal(page, '紀錄回推')).toHaveText('資料看起來有誤')
  await expect(card(page)).toContainText('不像真的')
  await expect(card(page), '離譜的時候不該同時顯示一個「約 N 卡」').not.toContainText('約')
  await expect(est(page, '紀錄回推'), '資料有誤時不能點那一列改用').not.toHaveJSProperty('tagName', 'BUTTON')
  await expect(confirm(page)).toHaveCount(0)
})

test('飲食記錄打錯（體重走勢正常）：叫人去查飲食記錄，不是體重', async ({ page }) => {
  // 平均 5500 卡、體重全程持平：斜率正常，維持熱量卻落在合理範圍之外
  await openApp(page, {}, windowFix(5500))
  await openGoal(page)

  await expect(estVal(page, '紀錄回推')).toHaveText('資料看起來有誤')
  await expect(card(page)).toContainText('飲食記錄')
  await expect(card(page), '真因是飲食記錄時不該叫人去查體重').not.toContainText('體重紀錄有沒有打錯')
})

test('近 28 天沒記、更早有完整一段：只當參考、明寫起訖日期，不能改用', async ({ page }) => {
  // 記錄只有「距昨天 30–57 天前」那 28 天，其後完全沒記；體重全程 75 持平（6 筆橫跨 27 天）
  const kcalWindow = Array.from({ length: 28 }, (_, i) => ({
    eaten_on: shiftDate(TODAY, -1 - (30 + i)),
    qty: 1,
    kcal: 1800,
  }))
  const weight = [30, 35, 40, 45, 50, 57].map((o) => ({
    weight_kg: 75,
    measured_on: shiftDate(TODAY, -1 - o),
    body_fat_pct: null,
  }))
  await openApp(page, {}, { ...FIX, kcalWindow, weight } as unknown as typeof FIX)
  await openGoal(page)

  const from = shiftDate(TODAY, -1 - 57)
  const end = shiftDate(TODAY, -1 - 30)
  // 日期要在**標題那一列**就出現：只放在灰色說明框的話，掃一眼的人會把舊數字當成現在的（review M4）
  const row = card(page).locator('.goal-row', { hasText: '紀錄回推（' })
  await expect(row.locator('.lb')).toContainText(`${monthDay(from)}–${monthDay(end)}`)
  await expect(row.locator('.val')).toHaveText('約 1800 卡')
  await expect(card(page)).toContainText('不是近 28 天')
  await expect(card(page)).toContainText('不能改用')
  // 同時說最新窗口缺什麼，使用者才知道怎麼讓它跟上現在
  await expect(card(page)).toContainText('記錄還差 21 天')
  await expect(card(page)).toContainText('接回記錄後')
  await expect(confirm(page), '舊的一段不能改用').toHaveCount(0)
  await expect(est(page, '紀錄回推'), '舊的一段不能點那一列改用').not.toHaveJSProperty('tagName', 'BUTTON')
  await expect(estVal(page, '紀錄回推')).toHaveText('還算不出來')
})

test('天天有記只是體重太少：說「多量幾次體重」，不說「接回記錄」', async ({ page }) => {
  // 連續 60 天都有記；近 28 天只有 1 筆體重（不足 4 筆），但整串有 5 筆、橫跨 50 天 ⇒ 回溯到整串
  const kcalWindow = Array.from({ length: 60 }, (_, i) => ({ eaten_on: shiftDate(TODAY, -1 - i), qty: 1, kcal: 1800 }))
  const weight = [5, 40, 45, 50, 55].map((o) => ({
    weight_kg: 75,
    measured_on: shiftDate(TODAY, -1 - o),
    body_fat_pct: null,
  }))
  await openApp(page, {}, { ...FIX, kcalWindow, weight } as unknown as typeof FIX)
  await openGoal(page)

  await expect(card(page).locator('.goal-row', { hasText: '紀錄回推（' }).locator('.val')).toContainText('約 1800 卡')
  await expect(card(page)).toContainText('多量幾次體重')
  await expect(card(page), '天天都有記，不該叫人去「接回記錄」').not.toContainText('接回記錄')
})

test('intake 超過一頁（2520 列）要翻頁抓完，不能只拿第一頁', async ({ page }) => {
  // 近 28 天每天 90 筆 × 20 卡 ＝ 1800 卡/天，共 2520 列；只拿第一頁（1000 列）就只剩約 11 天，會變記錄不夠
  const kcalWindow = Array.from({ length: 28 * 90 }, (_, n) => ({
    eaten_on: shiftDate(TODAY, -1 - Math.floor(n / 90)),
    qty: 1,
    kcal: 20,
  }))
  const weight = [0, 5, 10, 15, 20, 26].map((i) => ({
    weight_kg: 75,
    measured_on: shiftDate(TODAY, -1 - i),
    body_fat_pct: null,
  }))
  await openApp(page, {}, { ...FIX, kcalWindow, weight } as unknown as typeof FIX)
  await openGoal(page)

  await expect(estVal(page, '紀錄回推')).toHaveText('1800 卡')

  // 只數這張卡自己的那條（from＝今天往前 118 天）；月份小點的查詢形狀相同，不能混進來
  const offsets = await page.evaluate(
    (from) =>
      (window as unknown as { __allFetches: string[] }).__allFetches
        .filter((u) => u.includes('/rest/v1/intake') && decodeURIComponent(u).includes(`eaten_on=gte.${from}`))
        .map((u) => new URL(u).searchParams.get('offset')),
    shiftDate(TODAY, -118),
  )
  expect(offsets).toEqual(['0', '1000', '2000', '2520'])
})

/* 寫入失敗要說人話：選單與自訂目標是兩條存檔路徑。 */
const OFFLINE_TEXT = '連不上網路，請確認 Wi-Fi 或行動網路'
const dropNetwork = (page: Page) =>
  page.evaluate(() => {
    ;(window as unknown as { __dataDown: boolean }).__dataDown = true
  })

test('選單存檔時斷網：顯示看得懂的錯誤，值退回', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await dropNetwork(page)
  await page.locator('#g-protein').selectOption('2')
  await expect(page.locator('.goal-err')).toHaveText(OFFLINE_TEXT)
  await expect(page.locator('#g-protein')).toHaveValue('1.8')
})

test('自訂目標存檔時斷網：顯示看得懂的錯誤，填的值留著', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await page.locator('.goal-seg-wrap .seg button', { hasText: '自訂' }).click()
  await page.locator('#g-custom-kcal').fill('2000')
  await page.locator('#g-custom-protein').fill('150')
  await page.locator('#g-custom-fat').fill('60')
  await page.locator('#g-custom-carb').fill('200')
  await dropNetwork(page)
  await page.locator('#g-custom-carb').blur()
  await expect(page.locator('.goal-err')).toHaveText(OFFLINE_TEXT)
  await expect(page.locator('#g-custom-kcal'), '失敗要留在自訂，填的值不能不見').toHaveValue('2000')
  await expect(src(page), '沒存到不能寫「自己填的」').toContainText('未儲存')
})

test('切回自動失敗：畫面留在自訂，因為實際目標還是自訂的', async ({ page }) => {
  const custom = {
    ...FIX,
    profile: [{ ...FIX.profile[0], use_custom_targets: true, custom_kcal: 2000, custom_protein_g: 150, custom_fat_g: 60, custom_carb_g: 200 }],
  } as unknown as typeof FIX
  await openApp(page, {}, custom)
  await openGoal(page)
  await expect(src(page)).toContainText('自己填的')

  await dropNetwork(page)
  await page.locator('.goal-seg-wrap .seg button', { hasText: '自動' }).click()
  await expect(page.locator('.goal-err')).toHaveText(OFFLINE_TEXT)
  await expect(page.locator('#g-custom-kcal')).toHaveValue('2000')
  await expect(heroNum(page)).toHaveText('2000')
})

/* ═══════════ 改了就存的失敗與競態（獨立 review 抓到）═══════════ */

const customFix = () =>
  ({
    ...FIX,
    profile: [{ ...FIX.profile[0], use_custom_targets: true, custom_kcal: 2000, custom_protein_g: 150, custom_fat_g: 60, custom_carb_g: 200 }],
  }) as unknown as typeof FIX
const failNextPatch = (page: Page) =>
  page.evaluate(() => {
    ;(window as unknown as { __failNext: { table: string; method: string } }).__failNext = { table: 'profile', method: 'PATCH' }
  })
const fetchesTo = (page: Page, part: string) =>
  page.evaluate((p) => (window as unknown as { __allFetches: string[] }).__allFetches.filter((u) => u.includes(p)).length, part)

test('改完立刻返回、存檔才失敗：跳提示，不是靜默遺失；目標還是舊的', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  const entrySub = (await macros(page))!.protein
  await setWriteDelay(page, 400)
  await failNextPatch(page)

  await page.locator('#g-protein').selectOption('2')
  await page.getByRole('button', { name: '返回設定' }).click()

  await expect(page.locator('.notice .headline')).toHaveText('每日目標沒有存到')
  await page.locator('.notice button').click()
  await expect(page.locator('.notice')).toHaveCount(0)
  await expect(page.locator('.entry-row', { hasText: '每日目標' }).locator('.lb-sub').first()).toContainText(`蛋白 ${entrySub}g`)
})

test('存檔不重撈：不打 foods 與 intake，設定入口照樣更新', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  const [foods, intake] = [await fetchesTo(page, '/rest/v1/foods'), await fetchesTo(page, '/rest/v1/intake?')]

  await page.locator('#g-protein').selectOption('2')
  await expect(page.locator('.goal-saved')).toHaveText('已儲存')

  expect(await fetchesTo(page, '/rest/v1/foods'), '存檔不該重撈食品庫').toBe(foods)
  expect(await fetchesTo(page, '/rest/v1/intake?'), '存檔不該重撈記錄').toBe(intake)
  await page.getByRole('button', { name: '返回設定' }).click()
  // 75.95 × 2 ＝ 151.9
  await expect(page.locator('.entry-row', { hasText: '每日目標' }).locator('.lb-sub').first()).toContainText('蛋白 152g')
})

test('自訂改值又改回（前一筆還在路上）：第二次也要送，資料庫才會回到原值', async ({ page }) => {
  await openApp(page, {}, customFix())
  await openGoal(page)
  await setWriteDelay(page, 400)

  await page.locator('#g-custom-kcal').fill('1900')
  await page.locator('#g-custom-kcal').blur()
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  await page.locator('#g-custom-kcal').fill('2000')
  await page.locator('#g-custom-kcal').blur()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(2)
  expect((await profilePatches(page))[1].body.custom_kcal).toBe(2000)
  await expect(src(page)).toContainText('自己填的')
})

test('連按自動、自訂（前一筆還在路上）：資料庫與畫面都停在自訂', async ({ page }) => {
  await openApp(page, {}, customFix())
  await openGoal(page)
  await setWriteDelay(page, 400)

  await page.locator('.goal-seg-wrap .seg button', { hasText: '自動' }).click()
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  await page.locator('.goal-seg-wrap .seg button', { hasText: '自訂' }).click()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(2)
  expect((await profilePatches(page))[1].body.use_custom_targets).toBe(true)
  await expect(src(page)).toContainText('自己填的')
})

test('前一筆失敗、後一筆成功：畫面留後一筆的值，錯誤收掉', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await setWriteDelay(page, 300)
  await failNextPatch(page)

  await page.locator('#g-protein').selectOption('2')
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  await page.locator('#g-protein').selectOption('1.4')
  await expect(page.locator('#g-protein')).toHaveValue('1.4')

  // 第二筆發出時第一筆剛失敗：這段請求拉長，退回舊值的話只有這時候看得到，落定後就被第二筆蓋掉了
  await setWriteDelay(page, 1000)
  await expect.poll(async () => (await profilePatches(page)).length).toBe(2)
  expect(await page.locator('#g-protein').inputValue(), '前一筆失敗不該洗掉後一筆').toBe('1.4')
  await expect(page.locator('.goal-saved')).toHaveText('已儲存')
  await expect(page.locator('#g-protein')).toHaveValue('1.4')
  await expect(page.locator('.goal-err'), '同一欄補上了，錯誤要收掉').toHaveCount(0)
})

test('一欄失敗、別欄成功：錯誤留著，別欄成功不能把它洗掉', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await failNextPatch(page)

  await page.locator('#g-protein').selectOption('2')
  await expect(page.locator('.goal-err')).toBeVisible()
  await expect(page.locator('#g-protein')).toHaveValue('1.8')

  await page.locator('#g-goal').selectOption('maintain')
  await expect(page.locator('.goal-saved')).toHaveText('已儲存')
  await expect(page.locator('.goal-err'), '蛋白質沒存到，改目標成功不能洗掉提示').toBeVisible()

  await page.locator('#g-protein').selectOption('2')
  await expect(page.locator('.goal-err'), '蛋白質補上了就收掉').toHaveCount(0)
})

test('已是自訂、改值存檔失敗：標未儲存，不能寫自己填的', async ({ page }) => {
  await openApp(page, {}, customFix())
  await openGoal(page)
  await page.locator('#g-custom-kcal').fill('1900')
  await dropNetwork(page)
  await page.locator('#g-custom-kcal').blur()

  await expect(page.locator('.goal-err')).toHaveText(OFFLINE_TEXT)
  await expect(src(page)).toContainText('未儲存')
  await expect(page.locator('#g-custom-kcal')).toHaveValue('1900')
})

test('基本資料存檔失敗：標未儲存', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await page.locator('#g-height').fill('180')
  await dropNetwork(page)
  await page.locator('#g-height').blur()

  await expect(page.locator('.goal-err')).toHaveText(OFFLINE_TEXT)
  await expect(src(page)).toContainText('未儲存')
})

test('已改用回推值時清空出生年：NaN 不進畫面', async ({ page }) => {
  const fix = windowFix(2000)
  Object.assign(fix.profile[0], { measured_tdee: 2000, measured_tdee_on: '2026-10-30' })
  await openApp(page, {}, fix)
  await openGoal(page)
  await page.locator('.goal-how summary').click()

  await page.locator('#g-birth-year').fill('')

  await expect(heroNum(page), '回推值不吃出生年，目標照算').toHaveText('1450')
  await expect(page.locator('[data-screen="daily-goal"]')).not.toContainText('NaN')
  // 公式算不出來：那一列寫 —、不能點（點了改回會讓目標算不出來）
  await expect(estVal(page, '公式推導')).toHaveText('—')
  await expect(est(page, '公式推導')).not.toHaveJSProperty('tagName', 'BUTTON')
  await expect(page.locator('.goal-calc')).toContainText('年齡 —')
})

test('速度五格存完都認得回來：kg/週 兩位小數換回 kg/月 的誤差在容差內', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  for (const v of ['0.5', '0.75', '1', '1.25', '1.5']) {
    await page.locator('#g-rate').selectOption(v)
    await expect(page.locator('#g-rate'), `${v} 存完認不回來`).toHaveValue(v)
    await expect(page.locator('.goal-pick', { hasText: '速度' }).locator('.val')).toHaveText(`${v} kg/月`)
    await expect(page.locator('.goal-saved')).toHaveText('已儲存')
    await expect(page.locator('.goal-pick', { hasText: '速度' }).locator('.val')).toHaveText(`${v} kg/月`)
  }
})

test('自訂切回自動、舊資料沒有速度：一起補速度，不會算不出目標', async ({ page }) => {
  const fix = customFix()
  Object.assign(fix.profile[0], { rate_kg_per_week: null })
  await openApp(page, {}, fix)
  await openGoal(page)

  await page.locator('.goal-seg-wrap .seg button', { hasText: '自動' }).click()
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  // 0.5 kg/月 ÷ (52/12) ≈ 0.115，捨入成 0.12
  expect((await profilePatches(page))[0].body).toEqual({ use_custom_targets: false, rate_kg_per_week: 0.12 })
  await expect(heroNum(page)).toHaveText(/\d/)
  await expect(page.locator('.notice')).toHaveCount(0)
})

test('補登舊日期的體重：最新一筆沒變也要重算回推', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await page.locator('.tab[aria-label="設定"]').click()
  const from = shiftDate(TODAY, -118)
  await expect.poll(() => fetchesTo(page, `eaten_on=gte.${from}`)).toBeGreaterThan(0)
  const before = await fetchesTo(page, `eaten_on=gte.${from}`)

  await page.locator('.entry-row', { hasText: '更新身體數據' }).click()
  await page.locator('#w-date').fill(shiftDate(TODAY, -40))
  await page.locator('#w-kg').fill('75')
  await page.locator('#settings-sheet-root .pick-bar-btn').click()

  await expect.poll(() => fetchesTo(page, `eaten_on=gte.${from}`)).toBeGreaterThan(before)
})

test('舊資料沒有速度：帶速度的前一筆失敗、後一筆也要帶，不會存成有目標沒速度而卡死', async ({ page }) => {
  const fix = { ...FIX, profile: [{ ...FIX.profile[0], goal: 'maintain', rate_kg_per_week: null }] } as unknown as typeof FIX
  await openApp(page, {}, fix)
  await openGoal(page)
  await setWriteDelay(page, 300)
  await failNextPatch(page)

  await page.locator('#g-goal').selectOption('cut')
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  await page.locator('#g-goal').selectOption('bulk')

  await expect.poll(async () => (await profilePatches(page)).length).toBe(2)
  expect((await profilePatches(page))[1].body).toEqual({ goal: 'bulk', rate_kg_per_week: 0.12 })
  await expect(page.locator('.notice')).toHaveCount(0)
})

test('速度存失敗後改選維持：速度列消失，錯誤跟著收掉', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await failNextPatch(page)
  await page.locator('#g-rate').selectOption('1')
  await expect(page.locator('.goal-err')).toBeVisible()

  await page.locator('#g-goal').selectOption('maintain')
  await expect(page.locator('.goal-saved')).toHaveText('已儲存')
  await expect(page.locator('.goal-err'), '失敗的欄位都不見了，錯誤收不掉').toHaveCount(0)
})

test('切分頁會收掉失敗的錯誤，之後別欄失敗再補上也收得掉', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await failNextPatch(page)
  await page.locator('#g-rate').selectOption('1')
  await expect(page.locator('.goal-err')).toBeVisible()

  await page.locator('.goal-seg-wrap .seg button', { hasText: '自訂' }).click()
  await expect(page.locator('.goal-err')).toHaveCount(0)
  await page.locator('.goal-seg-wrap .seg button', { hasText: '自動' }).click()

  await failNextPatch(page)
  await page.locator('#g-protein').selectOption('2')
  await expect(page.locator('.goal-err')).toBeVisible()
  await page.locator('#g-protein').selectOption('2')
  await expect(page.locator('#g-protein')).toHaveValue('2')
  await expect(page.locator('.goal-err')).toHaveCount(0)
})

test('連按自動、自訂、自動，前一筆失敗：畫面停在自動', async ({ page }) => {
  await openApp(page, {}, customFix())
  await openGoal(page)
  // 三下都要在第一筆回來前按完，第二、三下才會併成一包排隊
  await setWriteDelay(page, 1500)
  await failNextPatch(page)

  await page.locator('.goal-seg-wrap .seg button', { hasText: '自動' }).click()
  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  await page.locator('.goal-seg-wrap .seg button', { hasText: '自訂' }).click()
  await page.locator('.goal-seg-wrap .seg button', { hasText: '自動' }).click()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(2)
  await expect(page.locator('#g-goal'), '最後按的是自動').toBeVisible()
  await expect(page.locator('#g-custom-kcal')).toHaveCount(0)
})

test('上一筆的已儲存還在閃時改下一欄：這筆在路上不顯示已儲存', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await page.locator('#g-protein').selectOption('2')
  await expect(page.locator('.goal-saved')).toHaveText('已儲存')

  await setWriteDelay(page, 400)
  await page.locator('#g-protein').selectOption('1.6')
  await expect(page.locator('.goal-saved')).toHaveText('')
  await expect(page.locator('.goal-saved')).toHaveText('已儲存')
})

/* iOS Safari 點按鈕不會讓輸入框失焦：這裡不呼叫 blur，直接點按鈕，模擬等不到 onBlur 的情況。
   click 之前把焦點事件關掉，桌面 WebKit 才不會因為換焦點而替我們存好。 */
const suppressBlur = (page: Page) =>
  page.evaluate(() => {
    document.addEventListener('focusout', (e) => e.stopImmediatePropagation(), true)
  })

test('自訂改到一半直接點返回（iOS 不會失焦）：值要存到', async ({ page }) => {
  await openApp(page, {}, customFix())
  await openGoal(page)
  await page.locator('#g-custom-kcal').fill('1900')
  await suppressBlur(page)
  await page.getByRole('button', { name: '返回設定' }).click()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  expect((await profilePatches(page))[0].body.custom_kcal).toBe(1900)
})

test('基本資料改到一半直接點返回：值要存到；不合法就丟棄', async ({ page }) => {
  await openApp(page)
  await openGoal(page)
  await page.locator('#g-height').fill('180')
  await suppressBlur(page)
  await page.getByRole('button', { name: '返回設定' }).click()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  expect((await profilePatches(page))[0].body).toEqual({ height_cm: 180 })

  await page.locator('.entry-row', { hasText: '每日目標' }).click()
  await page.locator('#g-height').fill('')
  await page.getByRole('button', { name: '返回設定' }).click()
  await page.waitForTimeout(200)
  expect(await profilePatches(page), '不合法的半成品不該寫').toHaveLength(1)
})

test('自訂改到一半直接切回自動：新值先存、開關也關，自訂值留著', async ({ page }) => {
  await openApp(page, {}, customFix())
  await openGoal(page)
  await page.locator('#g-custom-kcal').fill('1900')
  await suppressBlur(page)
  await page.locator('.goal-seg-wrap .seg button', { hasText: '自動' }).click()

  await expect.poll(async () => (await profilePatches(page)).length).toBeGreaterThan(0)
  await page.waitForTimeout(300)
  const merged = Object.assign({}, ...(await profilePatches(page)).map((w) => w.body))
  expect(merged.custom_kcal).toBe(1900)
  expect(merged.use_custom_targets).toBe(false)
})
