/* 今日頁品項的就地編輯（v2.20）。觸發是點按 item-content 展開，不再是長按開 sheet——
   長按整套（500ms 計時器、位移備援門檻、與 drag 手勢的互相取消）連同 sheet 一起移除，
   因此原本三條長按專屬的迴歸鎖（放手時機決定 blockClickUntil 的收斂點、sheet scrim 吃掉
   pointerup 導致窗口卡在 Infinity、長按計時器沒隨 unmount 清）也一併退場：它們鎖的
   程式碼已經不存在，留著會變成鎖著空氣的測試。

   保留下來的是**與觸發方式無關**的那條——「編輯區開著時那一列離開畫面，寫入前要被
   守門擋下」。它鎖的是 App.tsx 的 patchIntakeRow，而那道防線這輪還從單一 mutation
   擴成份量與餐別共用，所以改成兩條路徑各驗一次。 */
import { test, expect, type Page } from '@playwright/test'
import { openApp } from './harness'

/** fixture：id 102 是午餐「雞胸餐盒」，qty=1，kcal=420（單份快照） */
const ROW = '.item[data-row="102"]'

async function expand(page: Page, sel = ROW) {
  await page.locator(`${sel} .item-content`).click()
  await expect(page.locator(`${sel} .item-editor`)).toBeVisible()
}

const patches = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __writes: { table: string; method: string; body: unknown }[] }).__writes.filter(
      (w) => w.table === 'intake' && w.method === 'PATCH',
    ),
  )

test('點按品項就地展開編輯區，改份量後時間軸與小計立刻反映新值', async ({ page }) => {
  await openApp(page)
  await expand(page)

  // 展開的是編輯區，不是左滑 reveal——兩者共用同一顆 active state，不能互相污染
  await expect(page.locator(`${ROW} .item-row`)).toHaveClass(/is-edit/)
  await expect(page.locator(`${ROW} .item-row`)).not.toHaveClass(/is-open/)
  await expect(page.locator(`${ROW} .item-content`)).toHaveAttribute('aria-expanded', 'true')

  // qty 1 → 2：按一次增加鈕，不需要「存入」——就地編輯沒有送出鈕
  await page.locator(`${ROW} .qty-btn`).last().click()
  await expect(page.locator(`${ROW} .qty-value`)).toHaveValue('2')

  await expect
    .poll(async () => (await patches(page)).length, { message: '沒有送出 intake 的 PATCH' })
    .toBeGreaterThan(0)
  expect((await patches(page))[0].body).toMatchObject({ qty: 2 })

  // 畫面立刻反映新 qty，不必重整：品名旁 ×2、該筆熱量 840（420×2）
  await expect(page.locator(`${ROW} .qty`)).toHaveText('×2')
  await expect(page.locator(`${ROW} .kc`)).toHaveText('840')
})

test('再點一次品項收合編輯區；點另一列則接手，同時只有一列展開', async ({ page }) => {
  await openApp(page)
  await expand(page)

  await page.locator(`${ROW} .item-content`).click()
  await expect(page.locator(`${ROW} .item-editor`)).toHaveCount(0)

  // 展開 102 之後改點 101（早餐乳清）——單值 active state 天生只能有一列是活躍的
  await expand(page)
  await expand(page, '.item[data-row="101"]')
  await expect(page.locator(`${ROW} .item-editor`)).toHaveCount(0)
  await expect(page.locator('.timeline .item-editor')).toHaveCount(1)
})

test('按餐別分段控制器把午餐那筆改成晚餐：換區段、編輯區收合、只送 meal 一欄', async ({ page }) => {
  await openApp(page)
  await expand(page)

  const lunchNode = page.locator('.node', { has: page.locator('.node-name', { hasText: '午餐' }) })
  await expect(lunchNode.locator(ROW)).toHaveCount(1)

  await page.locator(`${ROW} .seg button`, { hasText: '晚餐' }).click()

  /* 收合。**不是靠 FLIP 動畫**——那一筆進到另一個 MealNode 的 <ul>，React 卸載重掛，
     裸 layout 跨不過去（實測：+80ms 時同一筆存在兩份、來源餐別顯示 0）。「看得到去向」
     實際上靠 handleChangeMeal 成功後對新位置 scrollIntoView ＋ 把焦點帶過去。 */
  await expect(page.locator('.timeline .item-editor')).toHaveCount(0)

  const sent = await patches(page)
  expect(sent, '沒有送出 meal 的 PATCH').toHaveLength(1)
  expect(sent[0].body).toEqual({ meal: 'dinner' })

  // 那一筆現在掛在晚餐底下，午餐翻回待記錄
  const dinnerNode = page.locator('.node', { has: page.locator('.node-name', { hasText: '晚餐' }) })
  await expect(dinnerNode.locator(ROW)).toHaveCount(1)
  await expect(page.locator('.todo-row', { hasText: '午餐' })).toHaveCount(1)
})

test('編輯區裡的刪除鈕走既有的 5 秒復原流程，與左滑刪除同一條路徑', async ({ page }) => {
  await openApp(page)
  await expand(page)

  await page.locator(`${ROW} .ed-del`).click()

  // 樂觀移除 ＋ 浮出復原 pill；此時還沒真的送 DELETE
  await expect(page.locator(ROW)).toHaveCount(0)
  await expect(page.locator('.undo-bar')).toHaveCount(1)
  const dels = await page.evaluate(() =>
    (window as unknown as { __writes: { table: string; method: string }[] }).__writes.filter(
      (w) => w.table === 'intake' && w.method === 'DELETE',
    ),
  )
  expect(dels, '5 秒窗口內不該已經送出 DELETE').toHaveLength(0)
})

/* 迴歸鎖（v2.20 ➍ 評審回修）：Escape 原本掛在編輯區上，但展開後焦點停在 .item-content
   ——它是編輯區的**兄弟**不是祖先，事件只往上冒泡不會橫向傳，於是「展開後直接按 Esc」
   完全沒反應（實測確認）。修法是把 onKeyDown 上移到 .item-row 那層。 */
test('鍵盤路徑：Enter 展開後直接按 Escape 就能收合，不必先 Tab 進 stepper', async ({ page }) => {
  await openApp(page)
  /* 走鍵盤而不是滑鼠：webkit 點擊 button 不保留焦點（macOS 原生行為），焦點會留在 body，
     keyboard.press 就打不到 .item-row。而 Escape 本來就只服務鍵盤使用者，用鍵盤路徑驗
     才對得上真實情境。 */
  await page.locator(`${ROW} .item-content`).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator(`${ROW} .item-editor`)).toBeVisible()
  await expect(page.locator(`${ROW} .item-content`)).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.locator('.timeline .item-editor'), 'Esc 沒收合——onKeyDown 可能又被搬回編輯區上').toHaveCount(0)
  await expect(page.locator(`${ROW} .item-content`), '收合後焦點沒回到品名列').toBeFocused()
})

/* 迴歸鎖（v2.20 ➍ 評審回修）：×N 原本是會 ellipsis 的 .nm 的最後一個子節點，長品名
   一截斷第一個被吃掉的就是它——而它是這輪核心功能唯一的畫面回饋。這條鎖 DOM 結構
   （份量必須在 .nm 外面）＋ 實際可見寬度，兩者缺一都可能被「順手搬回去」破壞。 */
test('份量標記不在會截斷的 .nm 裡，長品名也吃不掉它', async ({ page }) => {
  await openApp(page)
  await expand(page)
  await page.locator(`${ROW} .qty-btn`).last().click()
  await expect(page.locator(`${ROW} .qty`)).toHaveText('×2')

  const geo = await page.evaluate(() => {
    const row = document.querySelector('.item[data-row="102"]')!
    const qty = row.querySelector('.qty')!
    const nm = row.querySelector('.nm')!
    return {
      qtyInsideNm: nm.contains(qty),
      qtyWidth: Math.round(qty.getBoundingClientRect().width),
      qtyRight: Math.round(qty.getBoundingClientRect().right),
      kcLeft: Math.round(row.querySelector('.kc')!.getBoundingClientRect().left),
    }
  })
  expect(geo.qtyInsideNm, '份量又被搬回 .nm 裡了，長品名會把它截掉').toBe(false)
  expect(geo.qtyWidth, '份量寬度為 0，等於看不到').toBeGreaterThan(0)
  expect(geo.qtyRight, '份量與熱量重疊').toBeLessThanOrEqual(geo.kcLeft)
})

/* 迴歸鎖（v2.20 ➍ 評審回修，使用者裁決）：蛋白質吃超過目標不轉破表色。
   減脂情境下蛋白質吃足是好事，染紅等於告訴使用者「你做錯了」；DESIGN.md 的
   「三大營養素判定」一直只列舉脂肪與碳水，是實作對三項一視同仁。 */
test('蛋白質超過目標不轉破表，脂肪碳水的判定不受影響', async ({ page }) => {
  await openApp(page)
  await expand(page)
  // fixture 蛋白質 69/126；把午餐那筆拉到 2.5 份 → 45×2.5+24 = 136.5 > 126
  await page.locator(`${ROW} .qty-value`).fill('2.5')
  await page.locator(`${ROW} .qty-value`).blur()
  await expect(page.locator(`${ROW} .qty`)).toHaveText('×2.5')

  const macros = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.macros .macro')).map((m) => ({
      label: m.querySelector('.lbl')?.textContent?.trim(),
      value: m.querySelector('.cur')?.textContent?.trim(),
      over: m.classList.contains('over'),
    })),
  )
  const protein = macros.find((m) => m.label === '蛋白質')!
  expect(Number(protein.value), '前提不成立：蛋白質沒有超過目標 126，測不到這條').toBeGreaterThan(126)
  expect(protein.over, '蛋白質超標被染成破表色').toBe(false)
})

/* 迴歸鎖（precommit review 抓到的 confirmed，本輪自己引入的迴歸）：失敗訊息提到 Today 層
   之後，v2.14 的 sheet 每次開啟都會 setEditErr(null) 這件事沒被帶過來——收合再展開同一列，
   上一次的「存不進去」會在使用者還沒做任何操作前就重現，誤導他以為這次也失敗了。 */
test('改份量失敗顯示錯誤；收合再展開同一列，舊的失敗訊息不可以殘留', async ({ page }) => {
  await openApp(page)
  await expand(page)

  await page.evaluate(() => {
    ;(window as unknown as { __failNext: { table: string; method: string } | null }).__failNext = {
      table: 'intake',
      method: 'PATCH',
    }
  })
  await page.locator(`${ROW} .qty-btn`).last().click()

  const err = page.locator(`${ROW} .ed-error`)
  await expect(err, '寫入失敗卻沒有就地顯示訊息').toBeVisible()
  await expect(err).toContainText('存不進去')
  // 樂觀值要回滾：畫面不能停在使用者以為存好的 2
  await expect(page.locator(`${ROW} .qty`), '失敗了卻沒回滾，畫面停在假的新值').toHaveCount(0)

  // 收合再展開——這裡是迴歸點
  await page.locator(`${ROW} .item-content`).click()
  await expect(page.locator('.timeline .item-editor')).toHaveCount(0)
  await expand(page)
  await expect(page.locator(`${ROW} .ed-error`), '上一次的失敗訊息殘留到這一次').toHaveCount(0)
})

test('左滑仍露出刪除鈕，且不會順手展開編輯區', async ({ page }) => {
  await openApp(page)

  const box = await page.locator(`${ROW} .item-content`).boundingBox()
  expect(box, '拿不到品項座標').not.toBeNull()
  const y = box!.y + box!.height / 2
  const from = { x: box!.x + box!.width - 20, y }

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x - i * 8, y)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()

  await expect(page.locator(`${ROW} .item-row`)).toHaveClass(/is-open/)
  await expect(page.locator(`${ROW} .item-editor`)).toHaveCount(0)
})

/* v2.14 時代有兩條迴歸鎖在驗「編輯 sheet 還開著、底下那一列卻被換掉了」——那是自建
   覆蓋層才有的狀態：sheet 掛在 Today 根節點下，那一列卸載它照樣開著，於是要靠 App.tsx
   寫入前的守門當最後一道防線。

   就地編輯**結構上消滅了那個狀態**：編輯區是 .item-row 的子節點，那一列卸載它必然
   一起走，按不到 stepper 也按不到分段控制器（改寫這兩條時實際撞到——舊寫法在新架構下
   會 timeout 在「找不到 .qty-btn」，等於前提不成立）。所以這裡改成鎖那個結構性保證，
   不是鎖守門的行為。

   **App.tsx 的守門仍然留著**，但誠實記帳：它在就地編輯下已經不是主要防線，而是廉價的
   深度防禦——真正擋住這類問題的是「編輯 UI 跟著資料列一起生滅」這個結構。留它的理由是
   下一個編輯入口未必還有這個結構（session-state 記過同一個教訓：v2.14 那道守門當時只
   服務一個 mutation，這輪新增改餐別時就得回頭補）。 */
test('換日期時編輯區隨那一列一起卸載，且不留下任何 PATCH', async ({ page }) => {
  await openApp(page)
  await expand(page)

  await page.evaluate(() => {
    const btn = document.querySelector('.date-arrow[aria-label="前一天"]') as HTMLButtonElement | null
    btn?.click()
  })

  await expect(page.locator(ROW)).toHaveCount(0)
  await expect(page.locator('.timeline .item-editor'), '那一列走了，編輯區不該還留在畫面上').toHaveCount(0)
  expect(await patches(page), '只是換個日期，不該送出任何 PATCH').toHaveLength(0)

  // 切回今天：值沒被寫壞——qty 還是 1（不顯示 ×N）、熱量還是 420
  await page.evaluate(() => {
    const btn = document.querySelector('.date-arrow[aria-label="後一天"]') as HTMLButtonElement | null
    btn?.click()
  })
  await expect(page.locator(ROW)).toHaveCount(1)
  await expect(page.locator(`${ROW} .qty`)).toHaveCount(0)
  await expect(page.locator(`${ROW} .kc`)).toHaveText('420')
})
