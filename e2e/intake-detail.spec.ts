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

test('編輯區改的是單份值，列上顯示的是 ×qty 總值；小數捨到 DB 的兩位', async ({ page }) => {
  await openApp(page)
  await expand(page)

  await page.locator(`${ROW} .qty-btn`).last().click() // qty 1 → 2
  await expect(page.locator(`${ROW} .kc`)).toHaveText('840')

  // 編輯區填的是「一份」的熱量，列上要顯示 300×2
  await fill(page, 'kcal', '300')
  await expect(page.locator(`${ROW} .kc`)).toHaveText('600')

  /* DB 那四欄是 numeric(_,2)，送出前就捨到兩位——否則本地留 12.345、DB 存 12.35，
     兩邊要等下一次真的 fetch 才對齊。 */
  await fill(page, 'fat', '12.345')
  const sent = await writes(page, 'intake', 'PATCH')
  expect(sent[sent.length - 1].body).toEqual({ fat: 12.35 })
  await expect(page.locator(`${ROW} input#${await editorId(page)}-fat`)).toHaveValue('12.35')
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

  /* 播報要唸「還原成食品庫的**雞胸餐盒**」，不是剛被清掉的那個改名。參照點是 foods 的
     品名，不是有效品名——後者在上一次改名成功後就已經被換成新快照（review 抓到）。 */
  await expect(page.locator(`${ROW} .item-editor [role="status"]`)).toHaveText('品名已還原成食品庫的 雞胸餐盒')
  // 欄位本身也要同步回去，不能停在空字串
  await expect(page.locator(`${ROW} input#${await editorId(page)}-name`)).toHaveValue('雞胸餐盒')
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

/* 下面三條是 v2.31 push 前 review 抓到的 no-op 與殘值路徑。共同的病灶都是
   「草稿預填的是有效品名／使用者打的原始字面」與「DB 實際存的值」不是同一個東西。 */
test('從沒改過名的列直接清空品名：不送空包彈（DB 本來就是 null）', async ({ page }) => {
  await openApp(page)
  await expand(page)

  await fill(page, 'name', '') // 欄位預填的是 foods 的品名，清掉它語意上沒有變化
  expect(await writes(page, 'intake', 'PATCH'), 'name 本來就是 null，不該送 PATCH').toHaveLength(0)

  // 把原本的品名一字不差打回去，同樣是 no-op
  await fill(page, 'name', '雞胸餐盒')
  expect(await writes(page, 'intake', 'PATCH'), '打回 foods 原名等於沿用，不該送').toHaveLength(0)
})

test('數字打成與現值等價的字面（420.00）：不送請求，但欄位正規化回 420', async ({ page }) => {
  await openApp(page)
  await expand(page)

  const id = await editorId(page)
  await fill(page, 'kcal', '420.00')
  expect(await writes(page, 'intake', 'PATCH'), '值沒變不該送').toHaveLength(0)
  await expect(page.locator(`${ROW} input#${id}-kcal`), '欄位該正規化，不留 420.00').toHaveValue('420')
})

test('數字超過 DB 上界（numeric 6,2）：本地擋下，不讓 Postgres 回原始錯誤訊息', async ({ page }) => {
  await openApp(page)
  await expand(page)

  const id = await editorId(page)
  const kcal = page.locator(`${ROW} input#${id}-kcal`)
  await kcal.fill('99999')
  await kcal.blur()

  await expect(kcal, '超界該當場還原').toHaveValue('420')
  expect(await writes(page, 'intake', 'PATCH'), '超界不該送出去讓 DB 拒絕').toHaveLength(0)
  await expect(page.locator(`${ROW} .ed-error`), '走的是還原路徑，不該出現「存不進去」').toHaveCount(0)
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
