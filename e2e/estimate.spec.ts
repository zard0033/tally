/* 用 AI 估（v2.167 起是記一筆搜尋結果最下面的「用 AI 估『…』」，spec「記一筆重做：兩個情境」AC 5、6；主流程在 log-sheet.spec.ts）。
   這裡守估的過程與「不對？跟 AI 說」的細節：一句回好幾樣、減少動態、Esc、修正失敗、修正中加入停用、AI 回的品名對到食品庫。
   read-label 由 stub 的 __estimate／__estimateFix 控制（預設 null＝502）；寫入看 __writes。各條都自己 openApp、不共用狀態。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'

test.describe.configure({ mode: 'parallel' })

interface StubWindow {
  __writes: { path: string; table: string; method: string; body: unknown }[]
  __estimate: { mode: 'ok' | 'fail'; body?: unknown; delayMs?: number } | null
  __estimateCalls: string[]
  __estimateFix: { mode: 'ok' | 'fail'; body?: unknown; delayMs?: number } | null
  __estimateFixCalls: Record<string, unknown>[]
}

const STINKY = [
  { name: '臭豆腐', kcal: 480, kcal_low: 380, kcal_high: 600, protein_g: 22, fat_g: 30, carb_g: 28, assumption: '炸臭豆腐 6 塊、泡菜一小碟' },
  { name: '珍珠奶茶', kcal: 450, kcal_low: 350, kcal_high: 560, protein_g: 5, fat_g: 12, carb_g: 80, assumption: '中杯 500 毫升、全糖' },
]
const FIXED = { name: '臭豆腐', kcal: 400, kcal_low: 320, kcal_high: 500, protein_g: 18, fat_g: 25, carb_g: 23, assumption: '炸臭豆腐 5 塊、泡菜一小碟' }

const sheet = (page: Page) => page.locator('[data-screen="log-sheet"]')
const box = (page: Page) => sheet(page).getByLabel('找食物')
const rows = (page: Page) => sheet(page).locator('.meal-rows > li')
const addBtn = (page: Page) => sheet(page).locator('.pick-bar-btn')
const set = (page: Page, key: '__estimate' | '__estimateFix', v: StubWindow['__estimate']) =>
  page.evaluate(([k, x]) => ((window as unknown as Record<string, unknown>)[k as string] = x), [key, v] as const)
const writes = (page: Page, table: string) =>
  page.evaluate((t) => (window as unknown as StubWindow).__writes.filter((w) => w.table === t && w.method === 'POST').map((w) => w.body), table)

async function openDinner(page: Page) {
  await page.click('button.cta')
  await expect(sheet(page)).toBeVisible()
  await sheet(page).locator('.chip', { hasText: '晚餐' }).click()
}
/** 「夜市臭豆腐配珍奶」估回兩樣：第一樣自己展開。 */
async function estimateStinky(page: Page, delayMs = 0) {
  await openApp(page)
  await openDinner(page)
  await set(page, '__estimate', { mode: 'ok', body: { items: STINKY }, delayMs })
  await box(page).fill('夜市臭豆腐配珍奶')
  await sheet(page).locator('.ai-card-btn').click()
}

test('一句話回好幾樣：在原位換成兩列、第一樣展開；一次回好幾樣不學叫法（建的食物沒有別名）', async ({ page }) => {
  await estimateStinky(page)
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).locator('.mr-nm')).toHaveText(['臭豆腐', '珍珠奶茶'])
  await expect(rows(page).nth(0).locator('.mr-body')).toBeVisible()
  await expect(rows(page).nth(0).locator('.est-why')).toContainText('380–600')
  await addBtn(page).click()
  await expect.poll(async () => (await writes(page, 'foods')).length).toBe(2)
  for (const f of (await writes(page, 'foods')) as Record<string, unknown>[]) expect(f).not.toHaveProperty('aliases')
})

test('估的時候繞光、寫在等什麼；減少動態時繞光不循環、新的列只淡入', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await estimateStinky(page, 800)
  const busy = sheet(page).locator('.meal-row.est.busy')
  await expect(busy).toContainText('在看你吃了什麼…')
  const ring = await busy.locator('.ai-ring').evaluate((el) => getComputedStyle(el, '::before').animationName)
  expect(ring).toBe('none')
  await expect(rows(page)).toHaveCount(2)
  expect(await rows(page).first().evaluate((el) => getComputedStyle(el).animationName)).toBe('est-fade')
})

test('不對？跟 AI 說：Esc 只收起框、不關 sheet；修正中加入停用；失敗那一列維持原樣、說原本的估算還在', async ({ page }) => {
  await estimateStinky(page)
  const first = rows(page).nth(0)
  const fixBtn = first.getByRole('button', { name: '不對？跟 AI 說' })
  await fixBtn.click()
  const input = first.getByLabel('跟 AI 說臭豆腐哪裡不對')
  await expect(input).toBeFocused()
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await page.waitForTimeout(400)
  await expect(sheet(page)).toBeVisible()
  await expect(fixBtn).toBeFocused()
  await fixBtn.click()
  await set(page, '__estimateFix', { mode: 'fail', delayMs: 600 })
  await first.getByLabel('跟 AI 說臭豆腐哪裡不對').fill('5 塊')
  await first.getByRole('button', { name: '重估' }).click()
  await expect(addBtn(page)).toBeDisabled()
  await expect(sheet(page).locator('.pick-hint')).toHaveText('正在跟 AI 說，好了才能加入')
  await expect(first.locator('.est-fix-err')).toHaveText('修正沒成功，原本的估算還在')
  await expect(first.locator('.mr-kc')).toHaveText('480')
  await set(page, '__estimateFix', { mode: 'ok', body: { items: [FIXED] } })
  await first.getByRole('button', { name: '重試' }).click()
  await expect(first.locator('.mr-kc')).toHaveText('400')
  await expect(first.locator('.est-fixed')).toHaveText('☀ 已照「5 塊」修正')
  const sent = await page.evaluate(() => (window as unknown as StubWindow).__estimateFixCalls.at(-1))
  expect(sent).toMatchObject({ text: '夜市臭豆腐配珍奶', fix: '5 塊', item: { name: '臭豆腐', kcal: 480 } })
})

test('改一份幾卡：三大照比例縮放，寫入照改過的；份量 2 份寫 qty 2', async ({ page }) => {
  await estimateStinky(page)
  const first = rows(page).nth(0)
  await first.getByLabel('一份幾卡').fill('240')
  await first.getByLabel('一份幾卡').blur()
  await first.getByRole('button', { name: '增加 臭豆腐 的份量' }).click()
  await expect(first.locator('.mr-kc')).toHaveText('480')
  await addBtn(page).click()
  await expect.poll(async () => ((await writes(page, 'intake')) as Record<string, unknown>[][]).flat().length).toBe(2)
  const [row] = ((await writes(page, 'intake')) as Record<string, unknown>[][]).flat()
  expect([row.kcal, row.protein, row.qty]).toEqual([240, 11, 2])
})

test('AI 回的品名完全對到食品庫（沒店家的地瓜）：換成食品庫那一筆，加入不建新食物', async ({ page }) => {
  await openApp(page)
  await openDinner(page)
  await set(page, '__estimate', { mode: 'ok', body: { items: [{ name: '地瓜', kcal: 200, kcal_low: 150, kcal_high: 250, protein_g: 3, fat_g: 0, carb_g: 45, assumption: null }] } })
  await box(page).fill('烤番薯')
  await sheet(page).locator('.ai-card-btn').click()
  await expect(rows(page).first().locator('.mr-sub')).toHaveText('食品庫 · 蛋白 2g')
  await addBtn(page).click()
  await expect.poll(async () => ((await writes(page, 'intake')) as Record<string, unknown>[][]).flat().map((r) => [r.food_id, r.kcal])).toEqual([[14, 130]])
  expect(await writes(page, 'foods')).toEqual([])
  // 打的「烤番薯」不是地瓜的完全符合：加入成功後記成它的叫法
  await expect.poll(() => page.evaluate(() => (window as unknown as StubWindow).__writes.filter((w) => w.table === 'foods' && w.method === 'PATCH').map((w) => w.body))).toEqual([{ aliases: ['烤番薯'] }])
})

test('一次加入兩樣同名的估算：食品庫只建一筆，兩筆紀錄都指到它', async ({ page }) => {
  await openApp(page)
  await openDinner(page)
  const tea = { name: '冬瓜檸檬', kcal: 200, kcal_low: 160, kcal_high: 240, protein_g: 0, fat_g: 0, carb_g: 50, assumption: null }
  await set(page, '__estimate', { mode: 'ok', body: { items: [tea, { ...tea, kcal: 220, kcal_high: 260 }] } })
  await box(page).fill('兩杯冬瓜檸檬')
  await sheet(page).locator('.ai-card-btn').click()
  await expect(rows(page)).toHaveCount(2)
  await addBtn(page).click()
  await expect.poll(async () => ((await writes(page, 'intake')) as Record<string, unknown>[][]).flat().map((r) => [r.food_id, r.kcal])).toEqual([[999, 200], [999, 220]])
  expect(await writes(page, 'foods')).toHaveLength(1)
})
