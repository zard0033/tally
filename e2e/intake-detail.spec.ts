/* 就地編輯區的品名與營養值（v2.31）。這一組鎖的核心命題只有一句：
   **改的是那一筆 intake，不是食品庫**——所以每條都順帶斷言 foods 表零寫入。

   v2.20 的 DESIGN.md 曾把「改品名」判為做不到（intake 沒有自己的名字，品名是 join
   foods 拿的）。這輪給 intake 加了 name 快照欄，那個前提消失，判例隨之撤銷；
   `name = null` 代表沿用 foods 的品名，既有紀錄一筆都不必回填。

   **stub 的 GET intake 永遠回 fixture 原值、不反映 PATCH**（e2e/stub.ts），所以這裡
   驗不到真正的 DB 持久化——「切走再切回」那條驗的是 App.tsx `patchIntakeRow` 有沒有
   一併更新 cacheRef（走快取路徑時該顯示改過的值）。DB 那半靠 PATCH body 的斷言＋真機。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'

/** fixture：id 102 是午餐「雞胸餐盒」，qty=1，kcal=420、protein=45、fat=12、carb=30 */
const ROW = '.item[data-row="102"]'

async function expand(page: Page) {
  await page.locator(`${ROW} .item-content`).click()
  await expect(page.locator(`${ROW} .item-editor`)).toBeVisible()
}

const writes = (page: Page, table: string, method: string) =>
  page.evaluate(
    ({ table, method }) =>
      (window as unknown as { __writes: { table: string; method: string; body: unknown }[] }).__writes.filter(
        (w) => w.table === table && w.method === method,
      ),
    { table, method },
  )

/** 每條都要成立的那句話：食品庫一個字都沒被動到 */
async function foodsUntouched(page: Page) {
  for (const m of ['PATCH', 'POST', 'DELETE']) {
    expect(await writes(page, 'foods', m), `foods 表被 ${m} 動到了`).toHaveLength(0)
  }
}

/** 欄位改值＋blur（commit 綁在 blur，不是每次 keystroke） */
async function fill(page: Page, field: string, value: string) {
  const input = page.locator(`${ROW} .ed-detail input#${await editorId(page)}-${field}`)
  await input.fill(value)
  await input.blur()
}

const editorId = async (page: Page) =>
  (await page.locator(`${ROW} .item-editor`).getAttribute('id')) ?? ''

test('改熱量只動這一筆的 kcal，食品庫不受影響，列上數字立刻換新', async ({ page }) => {
  await openApp(page)
  await expand(page)

  await expect(page.locator(`${ROW} .kc`)).toHaveText('420')
  await fill(page, 'kcal', '500')

  const sent = await writes(page, 'intake', 'PATCH')
  expect(sent, '沒有送出 kcal 的 PATCH').toHaveLength(1)
  expect(sent[0].body).toEqual({ kcal: 500 })
  await expect(page.locator(`${ROW} .kc`)).toHaveText('500')
  await foodsUntouched(page)
})

test('改品名只動這一筆的 name 快照，時間軸換成新名字，食品庫仍是舊名', async ({ page }) => {
  await openApp(page)
  await expand(page)

  await fill(page, 'name', '雞胸餐盒（去皮）')

  const sent = await writes(page, 'intake', 'PATCH')
  expect(sent).toHaveLength(1)
  expect(sent[0].body).toEqual({ name: '雞胸餐盒（去皮）' })
  await expect(page.locator(`${ROW} .nm`)).toContainText('雞胸餐盒（去皮）')
  await foodsUntouched(page)
})

test('品名清空＝清掉快照，顯示退回食品庫的品名', async ({ page }) => {
  await openApp(page)
  await expand(page)

  await fill(page, 'name', '雞胸餐盒（去皮）')
  await expect(page.locator(`${ROW} .nm`)).toContainText('（去皮）')

  await fill(page, 'name', '   ') // 只有空白也算清空
  const sent = await writes(page, 'intake', 'PATCH')
  expect(sent[sent.length - 1].body, '清空要送 null，不是空字串').toEqual({ name: null })
  await expect(page.locator(`${ROW} .nm`)).toHaveText('雞胸餐盒')
})

test('數字欄填負數或空白：不送請求，該欄當場還原成原值', async ({ page }) => {
  await openApp(page)
  await expand(page)

  const id = await editorId(page)
  const fat = page.locator(`${ROW} input#${id}-fat`)

  await fat.fill('-5')
  await fat.blur()
  await expect(fat, '負數該被還原').toHaveValue('12')

  await fat.fill('')
  await fat.blur()
  await expect(fat, '空白該被還原').toHaveValue('12')

  expect(await writes(page, 'intake', 'PATCH'), '本地驗證沒過就不該送出').toHaveLength(0)
  await expect(page.locator(`${ROW} .kc`)).toHaveText('420')
})

test('展開編輯區但什麼都沒改就收合：零寫入（品名草稿是 foods 帶來的，不可白白寫成快照）', async ({ page }) => {
  await openApp(page)
  await expand(page)

  const id = await editorId(page)
  // 逐欄聚焦再離開，模擬使用者用 iOS 鍵盤上下鈕掃過整組欄位
  for (const f of ['name', 'kcal', 'protein', 'fat', 'carb']) {
    const input = page.locator(`${ROW} input#${id}-${f}`)
    await input.focus()
    await input.blur()
  }

  expect(await writes(page, 'intake', 'PATCH'), '沒改任何值卻送出了 PATCH').toHaveLength(0)
  await foodsUntouched(page)
})

test('改完切到別天再切回來（走快取）：新值還在，不會被舊快照蓋回去', async ({ page }) => {
  await openApp(page)
  await expand(page)
  await fill(page, 'name', '雞胸餐盒（去皮）')
  await fill(page, 'kcal', '500')

  await page.locator('.date-arrow').first().click() // 前一天
  await expect(page.locator(ROW)).toHaveCount(0)
  await page.locator('.date-arrow').last().click() // 回今天

  await expect(page.locator(`${ROW} .nm`)).toContainText('（去皮）')
  await expect(page.locator(`${ROW} .kc`)).toHaveText('500')
})
