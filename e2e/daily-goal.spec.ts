/* 每日目標頁（v2.21→v2.23 三輪演進）。這份鎖的是**計算引擎在 UI 上的契約**，不是版面：
   哪個欄位影響哪個輸出、沒碰過的欄位不可以被悄悄改寫、算不出來時顯示什麼。

   為什麼值得單獨一份：v2.22 把目標與速度合併成一個 GoalMode 選單，v2.23 又拆回兩個
   獨立欄位——同一塊 UI 兩輪內反覆，而每次都跨 formulas.ts／DailyGoal.tsx 兩處。
   下一輪不管往哪個方向動，這幾條都該還是綠的；綠不了就表示動到的是行為不是形狀。

   fixture 的數字（e2e/fixtures.ts）：體重 75.95、身高 175、出生年 1993、男、活動 1.375、
   蛋白質 1.8 g/kg、goal=cut、rate_kg_per_week=0.5、無體脂率 → 走 Mifflin-St Jeor。 */
import { test, expect, type Page } from '@playwright/test'
import { shiftDate } from '../src/lib/dates'
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

/** hero 那行「蛋白 137g・脂肪 65g・碳水 163g」拆成數字，欄位沒填完時回 null。 */
async function macros(page: Page): Promise<{ protein: number; fat: number; carb: number } | null> {
  const text = ((await page.locator('.goal-hero-macros').textContent()) ?? '').trim()
  const m = /蛋白 (\d+)g・脂肪 (\d+)g・碳水 (\d+)g/.exec(text)
  return m ? { protein: Number(m[1]), fat: Number(m[2]), carb: Number(m[3]) } : null
}

const kcal = async (page: Page) =>
  Number(((await page.locator('.goal-hero .gauge-num').textContent()) ?? '').replace(/[^\d]/g, ''))

test('目標與變化速度是兩個獨立 select；選「維持」時速度整格消失，換回減重／增肌又出現', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  // v2.23 拆欄位前這裡是一顆合併選單（GoalMode），拆回來之後兩個 id 各自存在
  await expect(page.locator('#g-goal')).toHaveValue('cut')
  await expect(page.locator('#g-rate')).toBeVisible()

  await page.locator('#g-goal').selectOption('maintain')
  await expect(page.locator('#g-rate'), '維持沒有變化速度可言，欄位該整格不渲染').toHaveCount(0)

  await page.locator('#g-goal').selectOption('bulk')
  await expect(page.locator('#g-rate'), '換回增肌時速度欄位沒回來').toBeVisible()
})

/* v2.23 的核心裁決：脂肪從「剩餘熱量固定比例」改成「體重 × 0.85 g/kg 固定值」。
   之前的算法下換目標會連帶改脂肪；現在目標只能動總熱量與碳水。這條就是那個裁決本身。 */
test('脂肪＝體重固定 g/kg：換目標只動熱量與碳水，脂肪一克不變', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  const cut = await macros(page)
  const cutKcal = await kcal(page)
  expect(cut, '前提不成立：cut 狀態下 hero 就算不出來').not.toBeNull()

  await page.locator('#g-goal').selectOption('maintain')
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

/* 迴歸鎖（precommit-review 抓到，v2.22 引入）：DB 的 rate_kg_per_week=0.5 換算成 2.17 kg/月，
   超出選單上限 1.5，draftFrom 只能拿 nearestPreset 取 1.5 來顯示。使用者什麼都沒改、
   只是進來看一眼就按儲存，那個「為了畫選單而取的近似值」不可以變成寫進 DB 的真實值。 */
test('沒碰過選單就按儲存：速度／活動量／蛋白質一律沿用 DB 原值，不被選單的近似值覆寫', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  // 前提：選單顯示的是近似值，跟 DB 存的不是同一個數
  await expect(page.locator('#g-rate'), '前提不成立：選單沒有顯示近似後的 1.5').toHaveValue('1.5')

  await page.locator('.confirm-wrap .pick-bar-btn').click()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  const body = (await profilePatches(page))[0].body
  expect(body.rate_kg_per_week, '選單的 1.5 kg/月被當成真實值寫回去了').toBe(0.5)
  expect(body.activity_factor).toBe(1.375)
  expect(body.protein_g_per_kg).toBe(1.8)
})

test('動過速度選單就改用選單值，換算成 kg/週 寫回', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await page.locator('#g-rate').selectOption('1')
  await page.locator('.confirm-wrap .pick-bar-btn').click()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  const body = (await profilePatches(page))[0].body
  // 1 kg/月 ÷ (52/12) 週 = 0.2308 kg/週
  expect(body.rate_kg_per_week as number).toBeCloseTo(12 / 52, 6)
})

/* 刻意設計（DailyGoal.tsx 檔頭）：即時預覽只要求「能不能算」，欄位打到一半算不出來就
   顯示 —，不跳錯誤；擋不合理值是送出時才做的事。這條把「預覽不吵」跟「送出會擋」
   兩件事鎖在一起——只鎖其中一邊，另一邊被改掉不會有人發現。 */
test('欄位清空時預覽顯示 — 而不跳錯誤；但按儲存要擋下來且不送出任何寫入', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await page.locator('#g-birth-year').fill('')

  await expect(page.locator('.goal-hero .gauge-num')).toHaveText(/—/)
  await expect(page.locator('.goal-hero-macros')).toHaveText('欄位還沒填完，先看不出目標')
  await expect(page.locator('.sheet-error'), '只是清空欄位就跳錯誤，打字打到一半會被吵').toHaveCount(0)

  await page.locator('.confirm-wrap .pick-bar-btn').click()
  await expect(page.locator('.sheet-error')).toContainText('出生年')
  expect(await profilePatches(page), '驗證沒過卻送出了寫入').toHaveLength(0)

  // 填回合理值：錯誤退場、預覽恢復
  await page.locator('#g-birth-year').fill('1993')
  await expect(page.locator('.goal-hero .gauge-num')).toHaveText(/\d/)
})

/* v2.23：「計算依據」拿掉收合 toggle 改常駐顯示。鎖「沒有可按的收合鈕」而不只是
   「看得到」——只鎖可見性的話，把它改回預設展開的 <details> 一樣會綠。 */
test('計算依據常駐顯示，四條依據都在，且沒有收合控制項', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  const src = page.locator('.goal-src')
  await expect(src).toBeVisible()
  await expect(src.locator('li')).toHaveCount(4)
  await expect(src.locator('button, summary'), '計算依據又被收起來了').toHaveCount(0)
  await expect(src).toContainText('0.85 g/kg')

  /* 有可見的項目符號。Tailwind 的 preflight 把 ul 的 list-style 清成 none，只留
     padding-left 會變成一個空的縮排、四條黏成一片文字牆（2026-08-05 截圖抓到）。
     斷言算出來的樣式而不是「看得到文字」——後者在沒有 marker 時照樣綠。

     **讀 li 不讀 ul**（precommit-review 抓到）：list-style-type 會繼承，所以在 ul 上讀
     到 disc 不代表 li 真的畫得出 marker——`li { list-style: none }`、把 ul 改成
     display:flex/grid（marker 不渲染）這些回歸全都會讓 ul 那層照樣回報 disc。連 marker
     的顏色一起驗：`::marker { color: transparent }` 是另一條驗不到的溜法。 */
  const marker = await src.locator('li').first().evaluate((el) => ({
    type: getComputedStyle(el).listStyleType,
    display: getComputedStyle(el.parentElement!).display,
    color: getComputedStyle(el, '::marker').color,
  }))
  expect(marker.type, '項目符號又被清掉了').not.toBe('none')
  expect(marker.display, 'ul 改成 flex/grid 之後 marker 不會渲染').toBe('block')
  expect(marker.color, 'marker 被調成透明，等於看不到').not.toMatch(/rgba?\([^)]*,\s*0\)$/)

  /* 第一條只陳述規則，不講「目前用哪個」——原本寫死前綴「有填體脂率」但公式名隨狀態變，
     沒填體脂率時整句自相矛盾。現在是哪個公式由 BMR 那顆 ⓘ 負責講。 */
  const first = src.locator('li').first()
  await expect(first).toContainText('Katch-McArdle')
  await expect(first).toContainText('Mifflin-St Jeor')
  await expect(first, '第一條又寫死了「有填體脂率」，但這個 fixture 沒有體脂率').not.toContainText('有填體脂率')
})

/* BMR 的公式說明從常駐的 .goal-hint 收進 popover（2026-08-05）。**是 popover 不是 tooltip**
   ——tooltip 靠 hover/focus 觸發，手機沒有 hover 就永遠打不開，這個 app 是手機為主。
   這條同時鎖「預設收著」與「點得開」：只驗其中一邊，另一邊壞了不會有人發現。 */
test('BMR 說明收在 popover 裡：預設不佔版面，點 ⓘ 才展開，Esc 收合', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await expect(page.locator('.goal-hint'), '公式說明又變回常駐一段，會把身體數據卡撐高').toHaveCount(0)
  await expect(page.locator('.info-popup')).toHaveCount(0)

  const trigger = page.locator('.info-btn')
  await expect(trigger).toBeVisible()

  // 命中區要有 44px，視覺只有 16px 圖示——手機上點得到才算數
  const box = await trigger.boundingBox()
  expect(box!.width, 'ⓘ 的命中區小於 44px').toBeGreaterThanOrEqual(44)
  expect(box!.height, 'ⓘ 的命中區小於 44px').toBeGreaterThanOrEqual(44)

  await trigger.click()
  const popup = page.locator('.info-popup')
  await expect(popup).toBeVisible()
  // fixture 沒有體脂率 → 說明要講現在用的 Mifflin-St Jeor，以及補了體脂率會怎樣
  await expect(popup).toContainText('Mifflin-St Jeor')
  await expect(popup).toContainText('Katch-McArdle')

  await page.keyboard.press('Escape')
  await expect(popup, 'Esc 關不掉，鍵盤使用者會被困住').toHaveCount(0)
})

/* 全站的 select 都被 `-webkit-appearance: none` 拿掉原生下拉箭頭（為了跟輸入框共用同一套
   外觀），結果選單跟純文字輸入框長得一模一樣，點下去才知道會展開（使用者 2026-08-05 回報）。
   補了 `.field-float:has(select)::after` 的箭頭。這條鎖「select 有、input 沒有」兩邊——
   只驗前者的話，哪天箭頭被誤套到所有欄位上也不會有人發現。 */
test('選單看得出是選單：每個 select 都有下拉箭頭，文字輸入框都沒有', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  const marks = await page.evaluate(() =>
    [...document.querySelectorAll('.field-float')].map((f) => ({
      id: (f.querySelector('input, select') as HTMLElement | null)?.id ?? '',
      isSelect: !!f.querySelector('select'),
      // ::after 沒被宣告時 content 是 'none'
      hasArrow: getComputedStyle(f, '::after').content !== 'none',
    })),
  )
  expect(marks.length, '前提不成立：畫面上找不到欄位').toBeGreaterThan(2)
  for (const m of marks) {
    expect(m.hasArrow, `${m.id}：${m.isSelect ? 'select 少了下拉箭頭' : '文字輸入框不該有下拉箭頭'}`).toBe(m.isSelect)
  }
})

/* 迴歸鎖（2026-08-05 量測抓到）：活動量最長的選項「輕度活動（1.375）」需要 136px，
   而它原本擠在半寬欄位裡只有 103.5px 可用——加箭頭之前就已經短 8.5px、只是看不太出來。
   改成整行後有 269px。這條直接比對「文字要多寬」與「欄位給多寬」，不是看有沒有 ellipsis
   （select 被截斷時不會有 ellipsis，只是安靜切掉）。 */
test('每個選單的最長選項都放得下，不會被切掉', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  const tight = await page.evaluate(() => {
    const out: { id: string; longest: string; avail: number; needs: number }[] = []
    for (const el of [...document.querySelectorAll('select')] as HTMLSelectElement[]) {
      const cs = getComputedStyle(el)
      // box-sizing 是 border-box，所以可用文字寬 = 外框寬 − 左右內距 − 左右框線
      const avail = el.getBoundingClientRect().width
        - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
      const span = document.createElement('span')
      span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`
      document.body.appendChild(span)
      let needs = 0
      let longest = ''
      for (const o of [...el.options]) {
        span.textContent = o.text
        const w = span.getBoundingClientRect().width
        if (w > needs) { needs = w; longest = o.text }
      }
      span.remove()
      out.push({ id: el.id, longest, avail: +avail.toFixed(1), needs: +needs.toFixed(1) })
    }
    return out
  })

  expect(tight.length, '前提不成立：畫面上沒有 select').toBeGreaterThan(2)
  for (const t of tight) {
    expect(t.needs, `${t.id} 的「${t.longest}」需要 ${t.needs}px，欄位只有 ${t.avail}px`).toBeLessThanOrEqual(t.avail)
  }
})

test('自訂目標分頁完全繞過公式：送出四個數字並帶上 use_custom_targets', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await page.locator('.goal-seg-wrap .seg button', { hasText: '自訂目標' }).click()
  await expect(page.locator('.goal-hero'), '自訂模式不該還顯示公式算出來的預覽').toHaveCount(0)

  await page.locator('#g-custom-kcal').fill('2000')
  await page.locator('#g-custom-protein').fill('150')
  await page.locator('#g-custom-fat').fill('60')
  await page.locator('#g-custom-carb').fill('200')
  await page.locator('.confirm-wrap .pick-bar-btn').click()

  await expect.poll(async () => (await profilePatches(page)).length).toBe(1)
  expect((await profilePatches(page))[0].body).toMatchObject({
    use_custom_targets: true,
    custom_kcal: 2000,
    custom_protein_g: 150,
    custom_fat_g: 60,
    custom_carb_g: 200,
  })
})

/* ═══════════ 實測維持熱量卡（v2.49，spec.md「實測維持熱量」）═══════════
   **唯讀對帳**：這幾條鎖的是「它說了什麼」與「它沒動什麼」。算法本身（斜率、門檻、窗口邊界）
   在 src/lib/baseline.test.ts 有單元測試，這裡不重複；e2e 守的是接線：資料有沒有進得來、
   兩種模式都顯示、讀不到時不拖垮頁面、以及它**不寫任何東西**。 */

/** 近 28 天每天吃 kcalPerDay、體重全程持平 75 kg（6 筆橫跨 26 天）⇒ 實測維持＝kcalPerDay。
 *  體重陣列最新在前：stub 對 getLatestWeight 與 listWeights 回同一份，rows[0] 就是「最新」。 */
function windowFix(kcalPerDay: number): typeof FIX {
  const kcalWindow = [
    ...Array.from({ length: 28 }, (_, i) => ({ eaten_on: shiftDate(TODAY, -1 - i), qty: 1, kcal: kcalPerDay })),
    // 今天還沒記完，不進窗口：stub 不看 filter 會把這列一起回，守住的是「窗尾是昨天」
    { eaten_on: TODAY, qty: 1, kcal: 9999 },
  ]
  const weight = [0, 5, 10, 15, 20, 26].map((i) => ({
    weight_kg: 75,
    measured_on: shiftDate(TODAY, -1 - i),
    body_fat_pct: null,
  }))
  return { ...FIX, kcalWindow, weight }
}

const card = (page: Page) => page.locator('[data-card="maintenance"]')
const cardRow = (page: Page, label: string) => card(page).locator('.goal-row', { hasText: label }).locator('.val')
const writes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __writes: unknown[] }).__writes.length)

test('實測維持熱量：記錄不夠時說缺什麼、不給數字', async ({ page }) => {
  await openApp(page)
  await openGoal(page)

  await expect(card(page)).toBeVisible()
  await expect(cardRow(page, '依你的記錄推算')).toHaveText('資料不足')
  await expect(card(page)).toContainText('記錄還差 21 天')
  await expect(card(page)).toContainText('體重還差 4 筆')
  // 不給數字：資料不足時不該出現「約 N 卡」
  await expect(card(page)).not.toContainText('約')
})

test('實測維持熱量：資料夠時給數字，與畫面上的目前上限並列、說預期每週變化', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)

  await expect(cardRow(page, '依你的記錄推算')).toHaveText('約 2000 卡')
  await expect(
    card(page).locator('.goal-row', { hasText: '估計範圍' }),
    '體重全程持平＝沒有雜訊，區間收斂到一點，不該顯示「2000–2000」',
  ).toHaveCount(0)
  await expect(card(page)).toContainText('近 28 天記錄 28 天、體重 6 筆')
  // 體重少於 8 筆時，依據行要多說一句誤差可能很大
  await expect(card(page)).toContainText('體重只有 6 筆，誤差可能到幾百卡')

  /* 查詢的日期範圍：stub 不看 filter、estimateMaintenance 又會自己再過濾一次，所以窗口寫錯
     （例如 from 少算、to 傳成今天）在其他斷言裡完全看不見。這裡直接讀送出去的請求。 */
  const req = await page.evaluate(() =>
    (window as unknown as { __allFetches: string[] }).__allFetches
      .map((u) => decodeURIComponent(u))
      .find((u) => u.includes('/rest/v1/intake') && /select=[^&]*eaten_on/.test(u) && !/select=[^&]*meal/.test(u)),
  )
  expect(req, '卡片沒有送出區間查詢').toBeTruthy()
  expect(req).toContain(`eaten_on=gte.${shiftDate(TODAY, -28)}`)
  expect(req).toContain(`eaten_on=lte.${shiftDate(TODAY, -1)}`)
  expect(await writes(page), '實測維持熱量卡不該送出任何寫入').toBe(0)

  // 「目前上限」必須就是上方 hero 那個數，不是另算一份
  const hero = await kcal(page)
  await expect(cardRow(page, '畫面上的上限')).toHaveText(`${hero} 卡`)
  // fixture 的上限低於 2000 ⇒ 預期在瘦；你設定的是減重 0.5 kg/週
  expect(hero, '前提不成立：fixture 的上限不低於 2000，下面「瘦」的斷言沒有意義').toBeLessThan(2000)
  await expect(cardRow(page, '照這個上限吃')).toHaveText(/^每週約瘦 \d\.\d\d kg$/)
  await expect(cardRow(page, '你設定的')).toHaveText('每週約瘦 0.50 kg')
})

test('實測維持熱量：自訂目標模式也顯示，目前上限跟著輸入框走；沒有「你設定的」那列', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await openGoal(page)

  await page.getByRole('button', { name: '自訂目標' }).click()
  await page.locator('#g-custom-kcal').fill('1500')

  await expect(card(page)).toBeVisible()
  await expect(cardRow(page, '畫面上的上限')).toHaveText('1500 卡')
  // (1500 − 2000) × 7 ÷ 7700 ≈ −0.45
  await expect(cardRow(page, '照這個上限吃')).toHaveText('每週約瘦 0.45 kg')
  await expect(card(page).locator('.goal-row', { hasText: '你設定的' })).toHaveCount(0)
  expect(await writes(page), '實測維持熱量卡不該送出任何寫入').toBe(0)
})

test('實測維持熱量：唯讀且讀不到時不拖垮頁面', async ({ page }) => {
  await openApp(page, {}, windowFix(2000))
  await page.evaluate(() => { (window as unknown as { __kcalFail: boolean }).__kcalFail = true })
  await openGoal(page)

  await expect(card(page)).toContainText('讀不到記錄')
  // 頁面其餘部分照常：hero 有數字、儲存鈕在
  expect(await kcal(page)).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: '儲存' })).toBeVisible()
  // 唯讀：打開頁面並看完卡片，沒有任何寫入請求
  expect(await writes(page), '實測維持熱量卡不該送出任何寫入').toBe(0)
})

test('實測維持熱量：體重有雜訊時顯示估計範圍，且包住估計值', async ({ page }) => {
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

  const main = Number(((await cardRow(page, '依你的記錄推算').textContent()) ?? '').replace(/[^\d]/g, ''))
  const m = /^(\d+)–(\d+) 卡$/.exec(((await cardRow(page, '估計範圍').textContent()) ?? '').trim())
  expect(m, '有雜訊時應顯示「low–high 卡」').not.toBeNull()
  const [low, high] = [Number(m![1]), Number(m![2])]
  expect(low).toBeLessThan(main)
  expect(high).toBeGreaterThan(main)
  expect(await writes(page), '實測維持熱量卡不該送出任何寫入').toBe(0)
})

test('實測維持熱量：一筆體重打錯（57.5 之於 75.5）時說資料有誤，不給離譜的數字', async ({ page }) => {
  const dates = [0, 5, 10, 15, 20, 26].map((i) => shiftDate(TODAY, -1 - i))
  const mistyped: typeof FIX = {
    ...windowFix(1800),
    // 最舊的一筆在窗口最前端；最新在前的順序不變。窗口最前端打錯會讓斜率變成每週 +3.6 kg
    weight: dates.map((d, n) => ({ weight_kg: n === 5 ? 57.5 : 75.5, measured_on: d, body_fat_pct: null })),
  }
  await openApp(page, {}, mistyped)
  await openGoal(page)

  await expect(cardRow(page, '依你的記錄推算')).toHaveText('資料看起來有誤')
  await expect(card(page)).toContainText('不像真的')
  await expect(card(page), '離譜的時候不該同時顯示一個「約 N 卡」').not.toContainText('約')
})
