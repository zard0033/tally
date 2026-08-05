/* 食品庫管理頁（v2.22）。鎖的是四條真的會壞的路徑：搜尋過濾、就地編輯寫回、
   封存的樂觀＋復原、以現有食物為範本新增。

   **這裡驗不到的**：使用中／已封存兩個分頁的資料差異。e2e/stub.ts 完全不看 query
   參數，listFoods() 與 listArchivedFoods() 的 .eq('archived', ...) 拿到同一份 fixture
   （session-state 已驗證事實）。所以下面所有斷言都只用「使用中」分頁，分頁切換本身
   留白——在 stub 升級之前，那條測起來只會鎖住 stub 的行為，不是產品的行為。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'

async function openLibrary(page: Page) {
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '食品庫管理' }).click()
  await expect(page.locator('[data-screen="food-library"]')).toBeVisible()
  /* 等清單真的到齊再交還控制權。openApp 只等 profile/weight/targets（`.gauge-num`），
     foods 是另一支查詢——沒有這道守門，下面用一次性 count() 取基準值的測試會在 foods
     還沒回來時讀到 0，然後失敗訊息指向「找不到某個 aria-label」，跟真正的原因無關
     （precommit-review 抓到）。集中在這裡一份，每條測試共用同一個到齊條件。 */
  await expect(page.locator('.lib-row').first()).toBeVisible()
}

const foodWrites = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __writes: { table: string; method: string; path: string; body: Record<string, unknown> }[] }).__writes.filter(
      (w) => w.table === 'foods',
    ),
  )

const rows = (page: Page) => page.locator('.lib-row')

test('搜尋同時比對品名與店家，清空後全部回來', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const total = await rows(page).count()
  expect(total, '前提不成立：食品庫是空的').toBeGreaterThan(1)

  const search = page.locator('.search-box input')

  // 品名比對
  await search.fill('乳清')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).locator('.nm')).toContainText('乳清')

  /* 店家比對：搜尋字串完全不出現在任何品名裡，命中只可能來自 vendor 欄位——
     這是 foodMatches 兩個欄位都比對的證據，只搜品名的實作在這裡會回 0 筆。 */
  await search.fill('全家')
  const byVendor = await rows(page).count()
  expect(byVendor, '搜尋沒有比對店家欄位').toBeGreaterThan(0)
  await expect(page.locator('.lib-group-title', { hasText: '全家' })).toHaveCount(1)
  for (const nm of await rows(page).locator('.nm').allTextContents()) {
    expect(nm, '這筆是靠品名命中的，測不到店家比對').not.toContain('全家')
  }

  await search.fill('')
  await expect(rows(page)).toHaveCount(total)
})

test('找不到時顯示帶搜尋字串的空狀態，而不是空白畫面', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  await page.locator('.search-box input').fill('不存在的食物zzz')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('.muted')).toContainText('找不到「不存在的食物zzz」')
})

test('就地編輯：展開表單改熱量後儲存，只送出一筆 PATCH 且表單收合', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const first = rows(page).first()
  const name = ((await first.locator('.nm').textContent()) ?? '').trim()
  await first.locator(`[aria-label="編輯 ${name}"]`).click()

  const editor = first.locator('.lib-edit')
  await expect(editor).toBeVisible()
  await expect(editor.locator('#lf-name')).toHaveValue(name)

  await editor.locator('#lf-kcal').fill('321')
  await editor.locator('.pick-bar-btn').click()

  await expect.poll(async () => (await foodWrites(page)).length).toBe(1)
  const w = (await foodWrites(page))[0]
  expect(w.method).toBe('PATCH')
  expect(w.body).toMatchObject({ kcal: 321 })
  await expect(first.locator('.lib-edit'), '存完了編輯區沒收起來').toHaveCount(0)
})

test('編輯中隱藏 FAB：展開的表單一長，fixed 定位的新增鈕會蓋住儲存鈕（真機回報）', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  await expect(page.locator('.lib-fab')).toBeVisible()

  const first = rows(page).first()
  const name = ((await first.locator('.nm').textContent()) ?? '').trim()
  await first.locator(`[aria-label="編輯 ${name}"]`).click()
  await expect(page.locator('.lib-fab'), 'FAB 又會壓到編輯區的儲存鈕了').toHaveCount(0)

  await first.locator('.cancel-btn').click()
  await expect(page.locator('.lib-fab'), '取消編輯後 FAB 沒回來').toBeVisible()
})

test('封存：該列樂觀消失並浮出復原 pill，按復原就回到清單', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const total = await rows(page).count()
  const first = rows(page).first()
  const name = ((await first.locator('.nm').textContent()) ?? '').trim()

  await first.locator(`[aria-label="封存 ${name}"]`).click()

  await expect(rows(page)).toHaveCount(total - 1)
  const pill = page.locator('.undo-pill')
  await expect(pill).toBeVisible()
  await expect(pill).toContainText(name)

  await pill.click()
  await expect(rows(page), '按了復原卻沒回到清單').toHaveCount(total)
  await expect(page.locator('.undo-pill')).toHaveCount(0)

  /* 封存走的是可逆的 UPDATE，所以是「立刻送出、按復原再送一次解封存」，
     不是 intake 刪除那套「延遲 5 秒才真的送」（FoodLibrary.tsx 檔頭的裁決）。

     用 expect.poll 不用一次性讀取（precommit-review 抓到）：`undoArchive()` 先同步
     把畫面恢復，**之後**才 await 那支 PATCH——所以 undo pill 消失的當下第二筆寫入
     可能還沒送出，直接讀會偶發只拿到一筆。同檔其他寫入斷言都是這個寫法，這條原本漏了。 */
  await expect.poll(async () => (await foodWrites(page)).length, { message: '封存／復原沒有各送一次 PATCH' }).toBe(2)
  const writes = await foodWrites(page)
  expect(writes.map((w) => w.method)).toEqual(['PATCH', 'PATCH'])
})

test('以現有食物為範本新增：表單預填來源的值，送出是 POST 新增而不是改到原本那筆', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const first = rows(page).first()
  const name = ((await first.locator('.nm').textContent()) ?? '').trim()
  await first.locator(`[aria-label="以 ${name} 為範本新增"]`).click()

  await expect(page.locator('[data-screen="food-library-add"]')).toBeVisible()
  await expect(page.locator('.lib-topbar h1')).toContainText(`以「${name}」為範本新增`)
  await expect(page.locator('#lf-name'), '範本沒有預填來源的品名').toHaveValue(name)

  await page.locator('#lf-name').fill(`${name}（大份）`)
  await page.locator('.confirm-wrap .pick-bar-btn').click()

  await expect(page.locator('[data-screen="food-library"]')).toBeVisible()
  const writes = await foodWrites(page)
  expect(writes, '不該動到原本那筆，只該新增一筆').toHaveLength(1)
  expect(writes[0].method).toBe('POST')
  expect(writes[0].body).toMatchObject({ name: `${name}（大份）` })
})

test('新增必填擋在送出前：品名留空時顯示錯誤且不送出', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  await page.locator('.lib-fab').click()
  await expect(page.locator('[data-screen="food-library-add"]')).toBeVisible()

  await page.locator('#lf-kcal').fill('200')
  await page.locator('.confirm-wrap .pick-bar-btn').click()

  await expect(page.locator('.sheet-error')).toBeVisible()
  expect(await foodWrites(page), '驗證沒過卻送出了新增').toHaveLength(0)
})
