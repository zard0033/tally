/* 記一筆重做第一段「主畫面重排」（spec「記一筆重做：兩個情境」AC 1–10，v2.167；樣張 _design-sample/logsheet-c3/c4/c5.html、learn-stories.html）。
   時間釘在 2026-11-25（週三）：整組「上一個同類日」要找得到 11/24（週二）那一組。
   read-label 由 stub 的 __estimate 控制（預設 null＝502）；寫入看 __writes。各條都自己開 app、不共用狀態。 */
import { test, expect, type Page } from '@playwright/test'
import { openAppAt } from './harness'
import { FIX } from './fixtures'

test.describe.configure({ mode: 'parallel' })

const DAY = '2026-11-25'

interface StubWindow {
  __writes: { path: string; table: string; method: string; body: unknown }[]
  __estimate: { mode: 'ok' | 'fail'; body?: unknown; delayMs?: number } | null
  __estimateCalls: string[]
  __estimateFix: { mode: 'ok' | 'fail'; body?: unknown } | null
  __estimateFixCalls: Record<string, unknown>[]
  __failNext: { table: string; method: string } | null
}

const food = (id: number, name: string, vendor: string | null, kcal: number, protein: number, category: string, aliases: string[] = []) => ({
  id, name, vendor, kcal, protein, fat: 2, carb: 20, category, category_manual: false, aliases,
})
const FOODS = [
  food(11, '雞胸餐盒', '減醣廚房', 380, 40, '健康餐盒'),
  food(15, '無糖豆漿', '全家', 90, 8, '飲料'),
  food(17, '香蕉', null, 105, 1, '點心'),
  food(21, '冬瓜檸檬', '清心', 170, 0, '飲料'),
  food(22, '冬瓜茶', null, 130, 0, '飲料'),
  food(23, '檸檬綠茶', '清心', 150, 0, '飲料'),
  food(24, '炸排骨便當', null, 820, 30, '便當'),
  food(25, '茶葉蛋', null, 70, 7, '配菜'),
  food(26, '厚乳拿鐵', '7-11', 180, 8, '飲料'),
  food(18, '拿鐵', '全家', 150, 8, '飲料'),
]
const rec = (eaten_on: string, meal: string, food_id: number, extra: Record<string, unknown> = {}) => ({ eaten_on, meal, food_id, qty: 1, mods: [], name: null, vendor: null, ...extra })
/* 晚餐：11/24（週二）雞胸餐盒＋無糖豆漿＝上一個同類日的整組；雞胸餐盒常跟豆漿、香蕉一起吃（搭配卡） */
const HISTORY = [
  rec('2026-11-24', 'dinner', 15),
  rec('2026-11-24', 'dinner', 11),
  rec('2026-11-22', 'dinner', 24),
  rec('2026-11-20', 'dinner', 17),
  rec('2026-11-20', 'dinner', 11),
  rec('2026-11-19', 'dinner', 15),
  rec('2026-11-19', 'dinner', 11),
]
const FIXTURE = { ...FIX, foods: FOODS, history: HISTORY } as unknown as typeof FIX
/** 故事三：食品庫沒有冬瓜檸檬 */
const NO_WINTER = { ...FIXTURE, foods: FOODS.filter((f) => f.id !== 21) } as unknown as typeof FIX

const sheet = (page: Page) => page.locator('[data-screen="log-sheet"]')
const box = (page: Page) => sheet(page).getByLabel('找食物')
const meal = (page: Page) => sheet(page).locator('.meal-rows > li')
/** 找東西的列（不含整組那一列：它的名字裡有其他列的品名） */
const findRow = (page: Page, name: string | RegExp) => sheet(page).locator('.find-row:not([data-key="combo"])', { hasText: name })
const addBtn = (page: Page) => sheet(page).locator('.pick-bar-btn')
const aiBtn = (page: Page) => sheet(page).locator('.ai-card-btn')
const writes = (page: Page, table: string, method = 'POST') =>
  page.evaluate(([t, m]) => (window as unknown as StubWindow).__writes.filter((w) => w.table === t && w.method === m).map((w) => w.body), [table, method] as const)
const intakeRows = async (page: Page) => (await writes(page, 'intake')).flat() as Record<string, unknown>[]
const setEstimate = (page: Page, v: StubWindow['__estimate']) => page.evaluate((x) => ((window as unknown as StubWindow).__estimate = x), v)
const estimateCalls = (page: Page) => page.evaluate(() => (window as unknown as StubWindow).__estimateCalls)
const est = (name: string, kcal: number, protein = 0) => ({ items: [{ name, kcal, kcal_low: kcal - 40, kcal_high: kcal + 40, protein_g: protein, fat_g: 0, carb_g: 40, assumption: '大杯全糖' }] })

async function open(page: Page, fix: typeof FIX = FIXTURE, opts: Parameters<typeof openAppAt>[2] = {}) {
  await openAppAt(page, DAY, opts, fix, '19:30:00')
  await page.click('button.cta')
  await expect(sheet(page)).toBeVisible()
  await sheet(page).locator('.chip', { hasText: '晚餐' }).click()
}
/** 加入（sheet 收起）之後再開一次晚餐 */
async function reopen(page: Page) {
  await expect(sheet(page)).toHaveCount(0)
  await page.click('button.cta')
  await sheet(page).locator('.chip', { hasText: '晚餐' }).click()
}

test('剛打開：餐別、框、工具列；框空著是「晚餐常吃」，第一列是整組，＋一下整組加進這一餐、它就收掉（AC 1）', async ({ page }) => {
  await open(page)
  await expect(box(page)).toHaveAttribute('placeholder', '找食物：打品名或店家')
  await expect(sheet(page).locator('.log-tool')).toHaveText(['食品庫', '只記熱量'])
  await expect(sheet(page).locator('h3.sect-lb').first()).toHaveText('晚餐常吃')
  const first = sheet(page).locator('.find-list .find-row').first()
  await expect(first).toContainText('整組')
  await expect(first).toContainText('上次晚餐：雞胸餐盒、無糖豆漿')
  await expect(first).toContainText('週二 11/24')
  // 拿掉的：已選膠囊列、剛加的、別的餐勾的、建議段、全部食物分組、新店卡、新增「X」列、存進食品庫方格
  for (const t of ['剛加的', '別的餐勾的', '建議', '全部食物', '通用（說不出哪家）', '存進食品庫']) await expect(sheet(page).getByText(t, { exact: true })).toHaveCount(0)
  await expect(sheet(page).locator('.pick-pin, .shop-card, .add-food-row, .grp-more, .sect-suggest')).toHaveCount(0)
  await first.click()
  await expect(meal(page)).toHaveCount(2)
  await expect(meal(page).locator('.mr-nm')).toHaveText([/雞胸餐盒/, /無糖豆漿/])
  await expect(sheet(page).locator('.find-row', { hasText: '整組' })).toHaveCount(0)
  await addBtn(page).click()
  const rows = await intakeRows(page)
  expect(rows.map((r) => [r.food_id, r.meal])).toEqual([[11, 'dinner'], [15, 'dinner']])
})

test('常吃的 ＋ 按了變 ✓、那一樣出現在這一餐；再按一次 ✓ 從這一餐拿掉（AC 2）', async ({ page }) => {
  await open(page)
  const banana = findRow(page, '香蕉')
  await expect(banana).toHaveAttribute('aria-pressed', 'false')
  await banana.click()
  await expect(banana).toHaveAttribute('aria-pressed', 'true')
  await expect(meal(page)).toHaveCount(1)
  await expect(meal(page).first()).toContainText('香蕉')
  await banana.click()
  await expect(banana).toHaveAttribute('aria-pressed', 'false')
  await expect(sheet(page).locator('.meal-sect')).toHaveCount(0)
})

test('搜尋：一張清單、完全符合排前面、對到的字粗體；不自動勾、不叫 AI；最下面永遠有「用 AI 估」（AC 3）', async ({ page }) => {
  await open(page)
  await box(page).fill('冬檸')
  await expect(findRow(page, '冬瓜檸檬')).toHaveCount(1)
  await expect(findRow(page, '冬瓜檸檬').locator('b.hl')).toHaveText(['冬', '檸'])
  await expect(aiBtn(page)).toHaveText('用 AI 估「冬檸」')
  await box(page).fill('排骨飯')
  await expect(findRow(page, '炸排骨便當')).toHaveCount(1)
  await expect(findRow(page, '炸排骨便當').locator('b.hl')).toHaveText('排骨')
  await box(page).fill('711')
  await expect(findRow(page, '厚乳拿鐵')).toHaveCount(1)
  await box(page).fill('冬瓜檸檬')
  const rows = sheet(page).locator('.find-row')
  await expect(rows.first()).toContainText('冬瓜檸檬')
  // 完全符合＝整串粗；名字有對到的（冬瓜茶、檸檬綠茶）接在後面，不分段、不另寫段名
  await expect(rows.first().locator('b.hl')).toHaveText('冬瓜檸檬')
  await expect(rows.nth(1)).toContainText('冬瓜茶')
  await expect(sheet(page).locator('h3.sect-lb')).toHaveCount(0)
  await expect(sheet(page).locator('.ai-card')).toBeVisible()
  expect(await estimateCalls(page)).toEqual([])
  await expect(sheet(page).locator('.meal-sect')).toHaveCount(0)
})

test('故事一：打「冬檸」勾冬瓜檸檬、加入 → 冬瓜檸檬多一個別名「冬檸」，畫面上沒有提示；再打「冬檸」它排第一、整串粗；打「拿鐵」勾拿鐵、打「冬瓜」勾冬瓜茶不加別名（AC 4）', async ({ page }) => {
  await open(page, FIXTURE, { intakePersist: true })
  await box(page).fill('冬檸')
  await findRow(page, '冬瓜檸檬').click()
  await expect(sheet(page).getByText(/記住|叫法|別名/)).toHaveCount(0)
  await box(page).fill('拿鐵')
  await findRow(page, /^拿鐵/).click()
  // 「冬瓜」本來就是冬瓜茶名字的一段、找得到：不學叫法（使用者核可的例子）
  await box(page).fill('冬瓜')
  await findRow(page, /^冬瓜茶/).click()
  await addBtn(page).click()
  await expect.poll(() => writes(page, 'foods', 'PATCH')).toEqual([{ aliases: ['冬檸'] }])
  const patch = await page.evaluate(() => (window as unknown as StubWindow).__writes.find((w) => w.table === 'foods' && w.method === 'PATCH')?.path)
  expect(patch).toContain('id=eq.21')
  const rows = await intakeRows(page)
  expect(rows.map((r) => [r.food_id, r.name])).toEqual([[21, null], [18, null], [22, null]])
  await reopen(page)
  await box(page).fill('冬檸')
  const first = sheet(page).locator('.find-row').first()
  await expect(first).toContainText('冬瓜檸檬')
  await expect(first.locator('b.hl')).toHaveText('冬瓜檸檬')
})

test('故事二：打「全家 茶葉蛋」勾茶葉蛋 → 紀錄店家＝全家、食品庫沒變；打「全家」有「茶葉蛋 · 全家 上次…」；再用「7-11 茶葉蛋」記之後打「711」也有它（AC 4a）', async ({ page }) => {
  await open(page, FIXTURE, { intakePersist: true })
  await box(page).fill('全家 茶葉蛋')
  await findRow(page, '茶葉蛋').click()
  await addBtn(page).click()
  await expect.poll(async () => (await intakeRows(page)).map((r) => [r.food_id, r.vendor, r.name])).toEqual([[25, '全家', null]])
  await reopen(page)
  await box(page).fill('全家')
  await expect(sheet(page).locator('h3.sect-lb', { hasText: '你在全家吃過的' })).toBeVisible()
  const egg = findRow(page, '茶葉蛋')
  await expect(egg.locator('.fr-tag')).toHaveText('全家')
  await expect(egg.locator('.fr-sub')).toHaveText('上次 今天')
  await box(page).fill('7-11 茶葉蛋')
  await findRow(page, '茶葉蛋').first().click()
  await addBtn(page).click()
  await expect.poll(async () => (await intakeRows(page)).map((r) => r.vendor)).toEqual(['全家', '7-11'])
  await reopen(page)
  await box(page).fill('711')
  await expect(sheet(page).locator('h3.sect-lb', { hasText: '你在7-11吃過的' })).toBeVisible()
  await expect(findRow(page, '茶葉蛋').locator('.fr-tag')).toHaveText('7-11')
  // 食品庫始終只有一筆茶葉蛋：沒有新建、沒有改
  expect(await writes(page, 'foods')).toEqual([])
  expect(await writes(page, 'foods', 'PATCH')).toEqual([])
})

test('故事三：打「春陽 冬瓜檸檬」勾冬瓜茶代替 → 紀錄品名＝冬瓜檸檬、店家＝春陽、熱量照冬瓜茶，不加別名；之後打「春陽」有「冬瓜檸檬 · 春陽」（AC 4b）', async ({ page }) => {
  await open(page, NO_WINTER, { intakePersist: true })
  await box(page).fill('春陽 冬瓜檸檬')
  await expect(aiBtn(page)).toHaveText('用 AI 估「冬瓜檸檬」')
  await findRow(page, '冬瓜茶').click()
  await expect(meal(page).first()).toContainText('冬瓜檸檬')
  await expect(meal(page).first()).toContainText('照冬瓜茶算')
  await addBtn(page).click()
  await expect.poll(async () => (await intakeRows(page)).map((r) => [r.food_id, r.name, r.vendor, r.kcal])).toEqual([[22, '冬瓜檸檬', '春陽', 130]])
  expect(await writes(page, 'foods', 'PATCH')).toEqual([])
  await reopen(page)
  await box(page).fill('春陽')
  const row = findRow(page, '冬瓜檸檬')
  await expect(row.locator('.fr-tag')).toHaveText('春陽')
  await expect(row.locator('.fr-sub')).toContainText('照冬瓜茶算')
})

test('代替記的品名再打一次浮在最上面：打「排骨飯」勾炸排骨便當代替 → 下次打「排骨飯」第一列就是它（照炸排骨便當算），點了照上次記、不加別名', async ({ page }) => {
  await open(page, FIXTURE, { intakePersist: true })
  await box(page).fill('排骨飯')
  await findRow(page, '炸排骨便當').click()
  await addBtn(page).click()
  await expect.poll(async () => (await intakeRows(page)).map((r) => [r.food_id, r.name, r.kcal])).toEqual([[24, '排骨飯', 820]])
  await reopen(page)
  await box(page).fill('排骨飯')
  const first = sheet(page).locator('.find-row').first()
  await expect(first.locator('.fr-name')).toHaveText('排骨飯')
  await expect(first.locator('b.hl')).toHaveText('排骨飯')
  await expect(first.locator('.fr-sub')).toHaveText('上次 今天 · 照炸排骨便當算')
  await first.click()
  const row = meal(page).first()
  await expect(row.locator('.mr-nm')).toHaveText('排骨飯')
  await expect(row.locator('.mr-kc')).toHaveText('820')
  await expect(row.locator('.mr-sub')).toContainText('照炸排骨便當算')
  await addBtn(page).click()
  await expect.poll(async () => (await intakeRows(page)).map((r) => [r.food_id, r.name, r.kcal])).toEqual([[24, '排骨飯', 820], [24, '排骨飯', 820]])
  expect(await writes(page, 'foods', 'PATCH')).toEqual([])
})

test('框裡第一段被當成店名時，框下看得到「在 大杯 買」；按掉（不是店名）就整串當品名，勾拿鐵不記店家大杯', async ({ page }) => {
  await open(page)
  await box(page).fill('大杯 拿鐵')
  const chip = sheet(page).locator('.store-chip')
  await expect(chip).toContainText('在 大杯 買')
  await expect(aiBtn(page)).toHaveText('用 AI 估「拿鐵」')
  await chip.getByRole('button', { name: '不是店名：大杯' }).click()
  await expect(chip).toHaveCount(0)
  await expect(aiBtn(page)).toHaveText('用 AI 估「大杯 拿鐵」')
  await expect(box(page)).toBeFocused()
  await findRow(page, /^拿鐵/).click()
  await addBtn(page).click()
  const [row] = await intakeRows(page)
  expect(row.food_id).toBe(18)
  expect(row).not.toHaveProperty('vendor')
})

test('只打店名（「全家」）：列你在那家記過的與店家對到的，沒有「用 AI 估『全家』」', async ({ page }) => {
  await open(page)
  await box(page).fill('全家')
  await expect(findRow(page, '無糖豆漿')).toHaveCount(1)
  await expect(sheet(page).locator('.ai-card')).toHaveCount(0)
})

test('整組裡有一樣已經在這一餐：按整組只加還沒有的那幾樣，不重複', async ({ page }) => {
  await open(page)
  await findRow(page, '雞胸餐盒').click()
  await sheet(page).locator('.find-row[data-key="combo"]').click()
  await expect(meal(page).locator('.mr-nm')).toHaveText([/雞胸餐盒/, /無糖豆漿/])
  await expect(sheet(page).locator('.find-row[data-key="combo"]')).toHaveCount(0)
  // 整組那列收掉了：焦點接到剛加的那一列
  await expect(meal(page).nth(1).locator('.mr-head')).toBeFocused()
})

test('焦點接手：只記熱量選了一檔（面板收起）→ 剛多的那一列；進食品庫 → 返回鈕；回來 → 工具列的「食品庫」', async ({ page }) => {
  await open(page)
  await sheet(page).locator('.log-tool', { hasText: '只記熱量' }).click()
  await sheet(page).locator('.kcal-panel .est-tier', { hasText: '吃得簡單' }).click()
  await expect(meal(page).first().locator('.mr-head')).toBeFocused()
  await sheet(page).locator('.log-tool', { hasText: '食品庫' }).click()
  await expect(sheet(page).locator('.libp-head .back-btn')).toBeFocused()
  await sheet(page).locator('.libp-head .back-btn').click()
  await expect(sheet(page).locator('.log-tool', { hasText: '食品庫' })).toBeFocused()
})

test('食品庫頁：從搜尋記了店名的那一樣也是 ✓，不重複加；按 ✓ 拿掉', async ({ page }) => {
  await open(page)
  await box(page).fill('全家 茶葉蛋')
  await findRow(page, '茶葉蛋').click()
  await sheet(page).locator('.log-tool', { hasText: '食品庫' }).click()
  const egg = findRow(page, '茶葉蛋')
  await expect(egg).toHaveAttribute('aria-pressed', 'true')
  await egg.click()
  await expect(egg).toHaveAttribute('aria-pressed', 'false')
  await sheet(page).locator('.libp-head .back-btn').click()
  await expect(sheet(page).locator('.meal-sect')).toHaveCount(0)
})

test('按「用 AI 估」才送、送的是去掉店名的那段；估好那一列同一種長相、小字「AI 估 · 蛋白」；加入後食品庫多一筆（粗估、沒封存），打的跟 AI 名不同時是別名，店名只在紀錄上（AC 5）', async ({ page }) => {
  await open(page, NO_WINTER)
  await setEstimate(page, { mode: 'ok', body: est('冬瓜檸檬', 210, 1), delayMs: 400 })
  await box(page).fill('春陽 冬檸')
  await aiBtn(page).click()
  await expect(box(page)).toHaveValue('')
  await expect(sheet(page).locator('.meal-row.est.busy')).toContainText('冬檸')
  await expect(addBtn(page)).toBeDisabled()
  expect(await estimateCalls(page)).toEqual(['冬檸'])
  const row = meal(page).first()
  await expect(row.locator('.mr-sub')).toHaveText('AI 估 · 蛋白 1g')
  await expect(row.locator('.mr-nm')).toContainText('冬瓜檸檬')
  await expect(row.locator('.mr-vd')).toHaveText('春陽')
  // 一句話只回一樣：自己展開
  await expect(row.locator('.mr-body')).toBeVisible()
  await addBtn(page).click()
  await expect.poll(() => writes(page, 'foods')).toEqual([{ name: '冬瓜檸檬', vendor: null, kcal: 210, protein: 1, fat: 0, carb: 40, verified: false, aliases: ['冬檸'] }])
  const rows = await intakeRows(page)
  expect(rows.map((r) => [r.food_id, r.vendor, r.name, r.kcal])).toEqual([[999, '春陽', null, 210]])
})

test('AI 估：食品庫已有同名的不另建，照 AI 數字記、打的叫法加到那一筆（AC 5）', async ({ page }) => {
  await open(page)
  // 食品庫的冬瓜檸檬是清心的、這次沒打店名：AI 回的同名不自動換（v2.154 H1），存的時候照同名不另建
  await setEstimate(page, { mode: 'ok', body: est('冬瓜檸檬', 200) })
  await box(page).fill('冬瓜檸檬大杯')
  await aiBtn(page).click()
  await expect(meal(page).first().locator('.mr-sub')).toHaveText('AI 估 · 蛋白 0g')
  await expect(meal(page).first().locator('.mr-near')).toContainText('食品庫有「清心 冬瓜檸檬」170 卡')
  await addBtn(page).click()
  await expect.poll(async () => (await intakeRows(page)).map((r) => [r.food_id, r.kcal])).toEqual([[21, 200]])
  expect(await writes(page, 'foods')).toEqual([])
  await expect.poll(() => writes(page, 'foods', 'PATCH')).toEqual([{ aliases: ['冬瓜檸檬大杯'] }])
})

test('估不出來：那列寫原因＋重試；加入停用、底部寫「還有 1 樣沒估好」；重試成功就能加入（AC 6）', async ({ page }) => {
  await open(page)
  await setEstimate(page, { mode: 'fail' })
  await box(page).fill('鹽酥雞')
  await aiBtn(page).click()
  const row = sheet(page).locator('.meal-row.est')
  await expect(row.locator('[role="alert"]')).toHaveText('AI 沒回應，估不出來')
  await expect(sheet(page).locator('.pick-hint')).toHaveText('還有 1 樣沒估好')
  await expect(addBtn(page)).toBeDisabled()
  await setEstimate(page, { mode: 'ok', body: est('鹽酥雞', 500, 20) })
  await row.getByRole('button', { name: '重試估鹽酥雞' }).click()
  await expect(meal(page).first().locator('.mr-sub')).toHaveText('AI 估 · 蛋白 20g')
  await expect(sheet(page).locator('.pick-hint')).toHaveCount(0)
  await expect(addBtn(page)).toBeEnabled()
})

test('這一餐每一列點了原地展開，一次只開一列；最下面「拿掉」（AC 7）', async ({ page }) => {
  await open(page)
  await findRow(page, '香蕉').click()
  await findRow(page, '雞胸餐盒').click()
  const [a, b] = [meal(page).nth(0), meal(page).nth(1)]
  await a.locator('.mr-head').click()
  await expect(a.locator('.mr-body')).toBeVisible()
  await b.locator('.mr-head').click()
  await expect(b.locator('.mr-body')).toBeVisible()
  await expect(a.locator('.mr-body')).toHaveCount(0)
  await expect(sheet(page).locator('.mr-body')).toHaveCount(1)
  // 份量改 2：列上熱量跟著變
  await b.getByRole('button', { name: '增加 雞胸餐盒 的份量' }).click()
  await expect(b.locator('.mr-kc')).toHaveText('760')
  await b.getByRole('button', { name: '拿掉雞胸餐盒' }).click()
  await expect(meal(page)).toHaveCount(1)
  await expect(findRow(page, '雞胸餐盒')).toHaveAttribute('aria-pressed', 'false')
})

test('這一餐的食品庫列點開有份量微調（飲料中杯），寫入調整後的單份與 mods', async ({ page }) => {
  await open(page)
  await findRow(page, '無糖豆漿').click()
  await meal(page).first().locator('.mr-head').click()
  await meal(page).first().getByRole('button', { name: '中杯' }).click()
  await expect(meal(page).first().locator('.mr-sub')).toContainText('中杯')
  await addBtn(page).click()
  const [row] = await intakeRows(page)
  expect(row.mods).toEqual(['cup:m'])
  expect(Number(row.kcal)).toBeLessThan(90)
})

test('只記熱量：工具列那格原地展開三檔＋自己打，選了這一餐多一列、面板收起（AC 8）', async ({ page }) => {
  await open(page)
  const tool = sheet(page).locator('.log-tool', { hasText: '只記熱量' })
  await tool.click()
  await expect(tool).toHaveAttribute('aria-expanded', 'true')
  const panel = sheet(page).locator('.kcal-panel')
  await expect(panel.locator('.est-tier')).toHaveText([/吃得簡單.*約 400.*麵包、飯糰/, /一般正餐.*約 700.*便當、麵/, /吃很多.*約 1000.*聚餐、吃到飽/])
  await panel.locator('.est-tier', { hasText: '一般正餐' }).click()
  await expect(panel).toHaveCount(0)
  await expect(meal(page).first()).toContainText('晚餐（一般正餐）')
  await expect(meal(page).first().locator('.mr-sub')).toContainText('只記熱量')
  await tool.click()
  await sheet(page).getByLabel('自己打').fill('450')
  await sheet(page).getByRole('button', { name: '記這個' }).click()
  await expect(meal(page)).toHaveCount(2)
  await expect(meal(page).nth(1).locator('.mr-kc')).toHaveText('450')
  await addBtn(page).click()
  // 只記熱量的不存進食品庫（建立即封存）
  await expect.poll(async () => (await writes(page, 'foods')).length).toBe(2)
  expect(((await writes(page, 'foods')) as Record<string, unknown>[]).every((f) => f.archived === true)).toBe(true)
})

test('食品庫頁：照類型分組、可搜尋、＋ 勾；底部「加 N 樣，回到晚餐」回來那幾樣在這一餐；最上面新增食物打開原本的表單（AC 9）', async ({ page }) => {
  await open(page)
  await sheet(page).locator('.log-tool', { hasText: '食品庫' }).click()
  await expect(sheet(page).locator('.sheet-title')).toHaveText('食品庫')
  await expect(sheet(page).locator('h3.sect-lb')).toContainText(['便當', '健康餐盒', '飲料'])
  await findRow(page, '炸排骨便當').click()
  await sheet(page).getByLabel('找食品庫').fill('茶葉')
  await expect(sheet(page).locator('.find-row')).toHaveCount(1)
  await findRow(page, '茶葉蛋').click()
  await expect(sheet(page).locator('.pick-bar-btn')).toHaveText('加 2 樣，回到晚餐')
  await sheet(page).locator('.pick-bar-btn').click()
  await expect(meal(page).locator('.mr-nm')).toHaveText([/炸排骨便當/, /茶葉蛋/])
  await sheet(page).locator('.log-tool', { hasText: '食品庫' }).click()
  await sheet(page).getByRole('button', { name: '新增食物（自己填營養標示）' }).click()
  await expect(sheet(page).locator('.sheet-title')).toHaveText('新增食物')
  await expect(sheet(page).locator('#f-name')).toBeVisible()
})

test('搭配卡：這一餐有正餐類、沒有飲料時出，列一起吃過、放得進剩下額度的飲料點心；加了飲料後不出（AC 10）', async ({ page }) => {
  await open(page)
  await expect(sheet(page).locator('.pair-card')).toHaveCount(0)
  await findRow(page, '雞胸餐盒').click()
  const card = sheet(page).locator('.pair-card')
  await expect(card.locator('.pair-head')).toContainText('要不要來杯飲料、點心？')
  await expect(card.locator('.pair-room')).toHaveText(/^還剩 \d+ 卡$/)
  await expect(card.locator('.pair-chip')).toHaveText([/無糖豆漿 · 全家\s*90/, /香蕉\s*105/])
  await card.locator('.pair-chip', { hasText: '無糖豆漿' }).click()
  await expect(meal(page)).toHaveCount(2)
  await expect(card).toHaveCount(0)
})

test('不對？跟 AI 說：送那一段＋目前的估算＋修正字，只換那一列；加入失敗按重試，已經存好的食物不再存一次', async ({ page }) => {
  await open(page, NO_WINTER)
  await setEstimate(page, { mode: 'ok', body: est('冬瓜檸檬', 210) })
  await box(page).fill('冬瓜檸檬')
  await aiBtn(page).click()
  const row = meal(page).first()
  await row.getByRole('button', { name: '不對？跟 AI 說' }).click()
  await page.evaluate(() => ((window as unknown as StubWindow).__estimateFix = { mode: 'ok', body: { items: [{ name: '冬瓜檸檬', kcal: 150, kcal_low: 120, kcal_high: 180, protein_g: 0, fat_g: 0, carb_g: 37, assumption: '微糖' }] } }))
  await row.getByLabel('跟 AI 說冬瓜檸檬哪裡不對').fill('微糖')
  await row.getByRole('button', { name: '重估' }).click()
  await expect(row.locator('.mr-kc')).toHaveText('150')
  const sent = await page.evaluate(() => (window as unknown as StubWindow).__estimateFixCalls[0])
  expect(sent).toMatchObject({ mode: 'estimate-fix', text: '冬瓜檸檬', fix: '微糖' })
  await page.evaluate(() => ((window as unknown as StubWindow).__failNext = { table: 'intake', method: 'POST' }))
  await addBtn(page).click()
  await expect(sheet(page).locator('.sheet-error')).toContainText('存不進去')
  await expect(addBtn(page)).toHaveText('重試')
  await addBtn(page).click()
  await expect(sheet(page)).toHaveCount(0)
  expect((await writes(page, 'foods')).length).toBe(1)
  expect((await writes(page, 'intake')).length).toBe(2)
})
