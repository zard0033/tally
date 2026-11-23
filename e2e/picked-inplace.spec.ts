/* 記一筆：勾了留在原位＋搜尋框下的「已選」膠囊列（v2.158，樣張 _design-sample/picked-inplace.html C），
   以及建議段勾的也出份量微調（沒動照搬來源快照、動了從食品庫重算）。各條都自己 openApp、不共用狀態。 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { openApp, openAppAt } from './harness'
import { FIX } from './fixtures'

test.describe.configure({ mode: 'parallel' })

/* 清單要夠長才捲得動：多 16 樣配菜／點心 */
const EXTRA = Array.from({ length: 16 }, (_, i) => ({
  id: 60 + i,
  name: i % 2 ? `小菜${i}號` : `餅乾${i}號`,
  vendor: null,
  kcal: 50 + i,
  protein: 1,
  fat: 1,
  carb: 5,
  category: i % 2 ? '配菜' : '點心',
  category_manual: false,
}))
const LONG_FIX = { ...FIX, foods: [...FIX.foods, ...EXTRA] } as unknown as typeof FIX

interface W {
  __writes: { table: string; method: string; body: unknown }[]
}
const intakePosts = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__writes.filter((w) => w.table === 'intake' && w.method === 'POST').map((w) => w.body))

const sheetOf = (page: Page) => page.locator('[data-screen="log-sheet"]')
const scrollerOf = (page: Page) => sheetOf(page).locator('.food-scroll')
/** 品名完全一樣的那一列（`小菜1號` 不能吃到 `小菜11號`） */
const rowOf = (page: Page, name: string) =>
  sheetOf(page).locator('.food-item', { has: page.locator('.nm', { hasText: new RegExp(`^${name.replace(/[()（）]/g, '\\$&')}$`) }) })

async function openBreakfast(page: Page) {
  await page.click('button.cta')
  await expect(sheetOf(page)).toBeVisible()
  await sheetOf(page).locator('.chip', { hasText: '早餐' }).click()
  await expect(sheetOf(page).locator('.chip', { hasText: '早餐' })).toHaveAttribute('aria-pressed', 'true')
}

/** 那一列整個落在捲動區看得到的範圍裡 */
async function inView(scroller: Locator, row: Locator) {
  const s = await scroller.boundingBox()
  const r = await row.boundingBox()
  if (!s || !r) return false
  return r.y >= s.y - 1 && r.y + r.height <= s.y + s.height + 1
}

test('勾了留在原位：同一組、同一個位置、不重複出現；沒有「已選」段；焦點留在那一列', async ({ page }) => {
  await openApp(page, {}, LONG_FIX)
  await openBreakfast(page)
  const sheet = sheetOf(page)
  const row = rowOf(page, '小菜5號')
  await row.scrollIntoViewIfNeeded()
  const indexOf = () => sheet.locator('.food-scroll .food-item').evaluateAll((els) => els.findIndex((e) => e.querySelector('.nm')?.textContent === '小菜5號'))
  const before = await indexOf()
  expect(before).toBeGreaterThan(0)

  // 用鍵盤勾：WebKit 點按鈕不會把焦點放上去，焦點接手只有鍵盤使用者碰得到
  await row.locator('.food-row').focus()
  await page.keyboard.press('Enter')
  await expect(row).toHaveClass(/selected/)
  await expect(row.locator('.food-row')).toHaveAttribute('aria-pressed', 'true')
  expect(await indexOf(), '勾了之後換了位置').toBe(before)
  await expect(sheet.locator('.grp', { has: page.locator('.gn', { hasText: '配菜' }) }).locator('.nm', { hasText: /^小菜5號$/ }), '那一組還在、它還在組裡').toHaveCount(1)
  await expect(rowOf(page, '小菜5號'), '同一樣只能出現一次').toHaveCount(1)
  await expect(sheet.locator('.sect-lb', { hasText: /^已選$/ })).toHaveCount(0)
  await expect(row.locator('.food-row'), '按下去那顆鈕換掉了，焦點要接回同一列').toBeFocused()

  // 取消勾也在原位，焦點一樣接回來
  await page.keyboard.press('Enter')
  await expect(row).not.toHaveClass(/selected/)
  await expect(row.locator('.food-row')).toBeFocused()
  expect(await indexOf()).toBe(before)
  await expect(sheet.locator('.pick-pin')).toHaveCount(0)
})

test('膠囊列：有勾才出現、最近勾的描邊；點膠囊捲到那一列並閃一下', async ({ page }) => {
  await openApp(page, {}, LONG_FIX)
  await openBreakfast(page)
  const sheet = sheetOf(page)
  const scroller = scrollerOf(page)
  await expect(sheet.locator('.pick-pin')).toHaveCount(0)

  await sheet.locator('.food-row', { hasText: '乳清' }).click()
  const pin = sheet.getByRole('group', { name: '已選的食物' })
  await expect(pin).toBeVisible()
  await expect(pin.locator('.pick-chip')).toHaveText(['乳清（1匙）'])

  const far = rowOf(page, '小菜15號')
  await far.scrollIntoViewIfNeeded()
  await far.locator('.food-row').click()
  await expect(pin.locator('.pick-chip')).toHaveText(['乳清（1匙）', '小菜15號'])
  await expect(pin.getByRole('button', { name: '捲到 小菜15號' })).toHaveClass(/is-new/)
  await expect(pin.getByRole('button', { name: '捲到 乳清（1匙）' })).not.toHaveClass(/is-new/)

  // 捲回最上面，小菜15號不在畫面裡
  await scroller.evaluate((el) => (el.scrollTop = 0))
  await expect.poll(() => inView(scroller, far)).toBe(false)
  // 記下閃一下的那層有沒有長出來（動畫 700ms 後就拔掉，不賭斷言跑得夠快）
  await sheet.evaluate((root) => {
    const w = window as unknown as { __flashed: string[] }
    w.__flashed = []
    new MutationObserver((ms) => {
      for (const m of ms)
        for (const n of m.addedNodes)
          if (n instanceof HTMLElement && n.classList.contains('row-flash')) w.__flashed.push(n.parentElement?.querySelector('.nm')?.textContent ?? '')
    }).observe(root, { childList: true, subtree: true })
  })
  await pin.getByRole('button', { name: '捲到 小菜15號' }).click()
  await expect.poll(() => inView(scroller, far), { message: '點膠囊要把那一列捲進畫面' }).toBe(true)
  expect(await page.evaluate(() => (window as unknown as { __flashed: string[] }).__flashed)).toEqual(['小菜15號'])
  await expect(far.locator('.food-row'), '焦點要跟著到捲過去的那一列').toBeFocused()
  // 閃完（animationend）那一層要拔掉，不留在 DOM 裡
  await expect(far.locator('.row-flash')).toHaveCount(0)
})

test('膠囊命中區：28px 高的膠囊，上下緣外 6px 點到的還是它（命中區撐到 44px）', async ({ page }) => {
  await openApp(page, {}, LONG_FIX)
  await openBreakfast(page)
  const sheet = sheetOf(page)
  await sheet.locator('.food-row', { hasText: '乳清' }).click()
  const chip = sheet.getByRole('button', { name: '捲到 乳清（1匙）' })
  await expect(chip).toBeVisible()
  // 等 spring 到位：飛行途中量到的位置會偏
  await expect
    .poll(() => sheet.evaluate((n) => Math.abs(new DOMMatrix(getComputedStyle(n).transform).m42) < 0.5))
    .toBe(true)
  const hit = await chip.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const at = (y: number) => document.elementFromPoint(x, y)?.closest('.pick-chip') === el
    return { h: r.height, above: at(r.top - 6), below: at(r.bottom + 6) }
  })
  expect(hit.h).toBeLessThan(32)
  expect([hit.above, hit.below], '膠囊外 6px 點不到它，命中區被裁掉了').toEqual([true, true])
})

test('膠囊捲到看不到的列：被搜尋濾掉就清掉搜尋、在收合的「其他餐的」就展開', async ({ page }) => {
  await openApp(page, {}, LONG_FIX)
  await openBreakfast(page)
  const sheet = sheetOf(page)
  const scroller = scrollerOf(page)
  const search = sheet.getByLabel('搜尋食物')

  // 健康餐盒只在午餐吃過 → 早餐清單裡收在「其他餐的」
  await search.fill('健康盒')
  await sheet.locator('.food-row', { hasText: '健康盒' }).click()
  await search.fill('')
  await expect(sheet.locator('.grp-more')).toHaveAttribute('aria-expanded', 'false')
  await expect(sheet.locator('.food-item.selected')).toHaveCount(0)
  await sheet.getByRole('button', { name: '捲到 雞胸餐盒' }).click()
  await expect(sheet.locator('.grp-more')).toHaveAttribute('aria-expanded', 'true')
  const box = sheet.locator('.food-item.selected', { has: page.locator('.sub', { hasText: '健康盒' }) })
  await expect.poll(() => inView(scroller, box)).toBe(true)

  // 搜尋別的東西，勾著的雞胸餐盒被濾掉；點膠囊清掉搜尋再捲過去
  await search.fill('香蕉')
  await expect(box).toHaveCount(0)
  await sheet.getByRole('button', { name: '捲到 雞胸餐盒' }).click()
  await expect(search).toHaveValue('')
  await expect.poll(() => inView(scroller, box)).toBe(true)
})

test('第一次勾、膠囊列出現：手指底下那一列不動（補 scrollTop）；取消到一樣都沒勾、膠囊列消失也不動', async ({ page }) => {
  await openApp(page, {}, LONG_FIX)
  await openBreakfast(page)
  const sheet = sheetOf(page)
  const scroller = scrollerOf(page)
  await scroller.evaluate((el) => (el.scrollTop = 300))
  const row = rowOf(page, '小菜3號')
  await expect.poll(() => inView(scroller, row)).toBe(true)
  const y0 = (await row.boundingBox())!.y

  await row.locator('.food-row').click()
  await expect(sheet.locator('.pick-pin')).toBeVisible()
  const pinH = (await sheet.locator('.pick-pin').boundingBox())!.height
  expect(pinH, '膠囊列要真的佔一行，這條才驗得到補償').toBeGreaterThan(30)
  expect(Math.abs((await row.boundingBox())!.y - y0), '膠囊列出現把那一列推走了').toBeLessThan(1)

  await row.locator('.food-row').click()
  await expect(sheet.locator('.pick-pin')).toHaveCount(0)
  expect(Math.abs((await row.boundingBox())!.y - y0), '膠囊列消失把那一列拉走了').toBeLessThan(1)
})

/** 估一筆選一個檔位、帶回清單：回來時膠囊列已經有一顆草稿 */
async function bringBackTier(page: Page) {
  await sheetOf(page).locator('.est-entry').click()
  await sheetOf(page).locator('.est-tier', { hasText: '一般正餐' }).click()
  await sheetOf(page).locator('.pick-bar-btn', { hasText: '帶回清單' }).click()
  await expect(sheetOf(page).locator('.pick-pin .pick-chip')).toHaveCount(1)
}

test('補 scrollTop 只在膠囊列出現／消失那一刻：從估一筆回來不補（新的捲動區從頂端開始）、已有草稿時再勾也不補', async ({ page }) => {
  await openApp(page, {}, LONG_FIX)
  await openBreakfast(page)
  const sheet = sheetOf(page)
  const scroller = scrollerOf(page)
  await bringBackTier(page)
  expect(await scroller.evaluate((el) => el.scrollTop), '從估一筆回來的捲動區被往下捲了').toBe(0)

  const row = rowOf(page, '小菜3號')
  await row.scrollIntoViewIfNeeded()
  await expect.poll(() => inView(scroller, row)).toBe(true)
  const top0 = await scroller.evaluate((el) => el.scrollTop)
  const y0 = (await row.boundingBox())!.y
  await row.locator('.food-row').click()
  await expect(sheet.locator('.pick-pin .pick-chip')).toHaveCount(2)
  expect(await scroller.evaluate((el) => el.scrollTop), '膠囊列本來就在，不該再補').toBe(top0)
  expect(Math.abs((await row.boundingBox())!.y - y0)).toBeLessThan(1)
})

/* ── 建議段的份量微調 ── */

const MON = '2026-11-02'
const TEA = { id: 40, name: '手搖飲（無糖純茶＋珍珠，大杯）', vendor: null, kcal: 165, protein: 0, fat: 0, carb: 41, category: '飲料', category_manual: false, verified: true, aliases: [] }
/* 來源那一筆是中杯：快照 120 卡故意不等於食品庫現值算出來的 165×0.7＝115.5，才分得出寫的是快照還是重算 */
const TEA_SRC = {
  id: 301,
  eaten_on: '2026-10-30',
  meal: 'breakfast',
  food_id: 40,
  qty: 1,
  kcal: 120,
  protein: 0,
  fat: 0,
  carb: 30,
  name: null,
  mods: ['cup:m'],
  created_at: '2026-10-30T01:00:00.000Z',
  foods: { name: TEA.name, vendor: null, archived: false, category: '飲料' },
}
const SUGGEST_FIX = { ...FIX, foods: [...FIX.foods, TEA], intake: [], intakeYday: [], repeatWindow: [TEA_SRC] } as unknown as typeof FIX

async function openSuggestBreakfast(page: Page) {
  await openAppAt(page, MON, {}, SUGGEST_FIX)
  await page.locator('.timeline .node').filter({ hasText: '早餐' }).locator('.todo-row').click()
  await expect(sheetOf(page)).toBeVisible()
  const row = sheetOf(page).locator('.sect-suggest + .food-list .food-item')
  await expect(row.locator('.nm')).toHaveText(`${TEA.name}（中杯）`)
  await row.locator('.food-row').click()
  return row
}

test('建議段勾的出份量微調、帶來源那一筆的「中杯 · 照上次」；沒動就照寫來源快照與 mods', async ({ page }) => {
  const row = await openSuggestBreakfast(page)
  await expect(row).toHaveClass(/selected/)
  // 勾起來後品名不接「（中杯）」：狀態寫在微調那一行
  await expect(row.locator('.nm')).toHaveText(TEA.name)
  await expect(row.locator('.pmods-sum')).toHaveText(/中杯・無糖/)
  await expect(row.locator('.pmods-last')).toHaveText('· 照上次')
  await expect(sheetOf(page).locator('.pick-line .sub')).toHaveText('1 樣 · 120 卡')
  // 展開後不出算式（那是食品庫現值 165 × 0.7，跟要記的 120 對不上），改寫一句說明
  await row.locator('.pmods-sum').click()
  await expect(row.locator('.pmods-calc')).toHaveText(['沒改就照上次記的每份 120 卡；改了用食品庫現在的數字重算'])
  await sheetOf(page).locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect.poll(async () => (await intakePosts(page)).length).toBe(1)
  expect(await intakePosts(page)).toEqual([[SNAP_POST]])
})

const SNAP_POST = { eaten_on: MON, meal: 'breakfast', food_id: 40, qty: 1, kcal: 120, protein: 0, fat: 0, carb: 30, name: null, mods: ['cup:m'] }

test('建議段勾的改了微調再改回原樣：「照上次」與說明回來，寫的還是來源快照', async ({ page }) => {
  const row = await openSuggestBreakfast(page)
  await row.locator('.pmods-sum').click()
  await row.locator('.seg[aria-label^="甜度"] button', { hasText: '微' }).click()
  await expect(row.locator('.pmods-last')).toHaveCount(0)
  await row.locator('.seg[aria-label^="甜度"] button', { hasText: '無' }).click()
  await expect(row.locator('.pmods-last')).toHaveText('· 照上次')
  await expect(row.locator('.pmods-calc')).toHaveText(['沒改就照上次記的每份 120 卡；改了用食品庫現在的數字重算'])
  await expect(sheetOf(page).locator('.pick-line .sub')).toHaveText('1 樣 · 120 卡')
  await sheetOf(page).locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect.poll(async () => (await intakePosts(page)).length).toBe(1)
  expect(await intakePosts(page)).toEqual([[SNAP_POST]])
})

test('建議段有的食物從搜尋結果勾：跟從建議段勾一樣，記來源快照', async ({ page }) => {
  await openAppAt(page, MON, {}, SUGGEST_FIX)
  await page.locator('.timeline .node').filter({ hasText: '早餐' }).locator('.todo-row').click()
  const sheet = sheetOf(page)
  await expect(sheet.locator('.sect-suggest')).toBeVisible()
  await sheet.getByLabel('搜尋食物').fill('手搖')
  await sheet.locator('.food-row', { hasText: '手搖飲' }).click()
  await expect(sheet.locator('.food-item.selected .pmods-last')).toHaveText('· 照上次')
  await expect(sheet.locator('.pick-line .sub')).toHaveText('1 樣 · 120 卡')
  await sheet.locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect.poll(async () => (await intakePosts(page)).length).toBe(1)
  expect(await intakePosts(page)).toEqual([[SNAP_POST]])
})

test('建議段勾的改了微調：從食品庫現值重算，不用來源快照', async ({ page }) => {
  const row = await openSuggestBreakfast(page)
  await row.locator('.pmods-sum').click()
  await row.locator('.seg[aria-label^="甜度"] button', { hasText: '微' }).click()
  await expect(row.locator('.pmods-last')).toHaveCount(0)
  await expect(row.locator('.pmods-calc')).toHaveText(['165 × 0.7 ＋ 微糖 11 g ＝ 160 卡'])
  await expect(sheetOf(page).locator('.pick-line .sub')).toHaveText('1 樣 · 160 卡')
  await sheetOf(page).locator('.pick-bar-btn', { hasText: '加入' }).click()
  await expect.poll(async () => (await intakePosts(page)).length).toBe(1)
  expect(await intakePosts(page)).toEqual([[{ eaten_on: MON, meal: 'breakfast', food_id: 40, qty: 1, kcal: 159.6, protein: 0, fat: 0, carb: 39.7, name: null, mods: ['cup:m', 'sweet:slight'] }]])
})

/* ── 焦點接手 ── */

const srcOf = (id: number, food_id: number, f: { name: string; vendor: string | null; kcal: number; protein: number; fat: number; carb: number }, meal = 'breakfast', archived = false) => ({
  id,
  eaten_on: '2026-10-30',
  meal,
  food_id,
  qty: 1,
  kcal: f.kcal,
  protein: f.protein,
  fat: f.fat,
  carb: f.carb,
  name: null,
  created_at: `2026-10-30T01:0${id % 10}:00.000Z`,
  foods: { name: f.name, vendor: f.vendor, archived },
})

test('全選之後別的路徑改了勾選：焦點不會被搶到建議段最後一列', async ({ page }) => {
  const [whey, soy] = [13, 15].map((id) => FIX.foods.find((f) => f.id === id)!)
  const fix = { ...FIX, intake: [], intakeYday: [], repeatWindow: [srcOf(301, 13, whey), srcOf(302, 15, soy)] } as unknown as typeof FIX
  await openAppAt(page, MON, {}, fix)
  await page.locator('.timeline .node').filter({ hasText: '早餐' }).locator('.todo-row').click()
  const sheet = sheetOf(page)
  const rows = sheet.locator('.sect-suggest + .food-list .food-item')
  await expect(rows).toHaveCount(2)
  await sheet.locator('.sect-act').click()
  await expect(rows.first().locator('.food-row')).toBeFocused()

  // 之後別的路徑改了勾選、焦點又掉到 body（新增食物查重擋下按「改用那筆」：表單整頁卸載、回清單）
  await sheet.getByLabel('搜尋食物').fill('香蕉')
  await sheet.locator('.add-food-row').click()
  // 用鍵盤按：WebKit 用滑鼠點按鈕不會把焦點放上去（焦點留在 sheet 上），鍵盤按的鈕卸載了焦點才會掉到 body
  await sheet.locator('.dup-block .row-pill', { hasText: '改用那筆' }).focus()
  await page.keyboard.press('Enter')
  await expect(sheet.getByRole('button', { name: '捲到 香蕉' })).toBeVisible()
  await page.waitForTimeout(100) // 沒有事件可等的反向斷言：effect 若會搶焦點，這一輪 render 後就搶了
  const focusedId = await page.evaluate(() => (document.activeElement?.closest('.food-item') as HTMLElement | null)?.dataset.foodId ?? null)
  expect(focusedId, '全選那一輪留下的焦點接手把焦點搶走了').toBeNull()
})

/* 封存食物從點心的建議段勾、切到晚餐：它只剩「別的餐勾的」那一段，取消勾就整列不見 */
const OLD = { name: '舊款便當', vendor: '停賣店', kcal: 300, protein: 20, fat: 10, carb: 30 }
const STRAY_FIX = { ...FIX, intake: [], intakeYday: [], repeatWindow: [srcOf(301, 99, OLD, 'snack', true)] } as unknown as typeof FIX

async function strayInDinner(page: Page) {
  await openAppAt(page, MON, {}, STRAY_FIX)
  await page.locator('.timeline .node').filter({ hasText: '點心' }).locator('.todo-row').click()
  const sheet = sheetOf(page)
  await sheet.locator('.sect-suggest + .food-list .food-row', { hasText: '舊款便當' }).click()
  await sheet.locator('.chip', { hasText: '晚餐' }).click()
  const stray = sheet.locator('.sect-lb:has-text("別的餐勾的") + .food-list .food-row')
  await expect(stray).toHaveText(/舊款便當/)
  return stray
}

test('取消勾之後那一列不見了：焦點退回膠囊列第一顆', async ({ page }) => {
  const stray = await strayInDinner(page)
  const sheet = sheetOf(page)
  await sheet.locator('.food-row', { hasText: '香蕉' }).click()
  await stray.focus()
  await page.keyboard.press('Enter')
  await expect(sheet.locator('.sect-lb:has-text("別的餐勾的")')).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: '捲到 香蕉' })).toBeFocused()
})

test('取消勾之後那一列不見、膠囊列也收了：焦點回搜尋框', async ({ page }) => {
  const stray = await strayInDinner(page)
  const sheet = sheetOf(page)
  await stray.focus()
  await page.keyboard.press('Enter')
  await expect(sheet.locator('.pick-pin')).toHaveCount(0)
  await expect(sheet.getByLabel('搜尋食物')).toBeFocused()
})
