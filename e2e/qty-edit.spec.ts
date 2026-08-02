/* 今日頁品項編輯份量的獨立路徑。觸發是長按 item-content（跟左滑刪除是兩條互不相干的
   手勢，只在「取消對方」上耦合），驗證要用真實 pointer 事件（down → 等超過 LONG_PRESS_MS
   → up）撐出長按，不能只靠合成 click。 */
import { test, expect } from '@playwright/test'
import { openApp } from './harness'

/** page.mouse.down/up 走真的 pointer 事件（mousedown/mouseup），會被 SwipeRow 的
 *  onPointerDown/onPointerUp 收到——跟 grabPoint／slowDrag 用同一組底層 API，
 *  跟既有拖曳測試踩過的「合成事件測不出重繪」坑用同一套真實輸入方式繞開。 */
async function longPress(page: import('@playwright/test').Page, x: number, y: number, ms: number) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

test('長按品項開編輯份量 sheet，改份量存入後時間軸與小計立刻反映新值', async ({ page }) => {
  await openApp(page)

  // fixture：id 102 是午餐「雞胸餐盒」，qty=1，kcal=420（單份快照）
  const row = page.locator('.item[data-row="102"] .item-content')
  const box = await row.boundingBox()
  expect(box, '拿不到品項座標').not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  await longPress(page, cx, cy, 650)

  const sheet = page.locator('#edit-qty-sheet-root .sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveAttribute('aria-label', /編輯份量/)

  // 長按放開後緊接而來的補click 不該把左滑 reveal 打開（跟拖曳補click 是同一類問題）
  await expect(page.locator('.item[data-row="102"] .item-row')).not.toHaveClass(/is-open/)

  // qty 1 → 2：點一次增加鈕
  await page.locator('#edit-qty-sheet-root .qty-btn').last().click()
  await expect(page.locator('#edit-qty-sheet-root .qty-value')).toHaveValue('2')

  await page.locator('#edit-qty-sheet-root .pick-bar-btn').click()

  // sheet 關閉、真的送出了 PATCH
  await expect(sheet).toBeHidden({ timeout: 2000 })
  const writes = await page.evaluate(
    () => (window as unknown as { __writes: { table: string; method: string; body: unknown }[] }).__writes,
  )
  const qtyWrite = writes.find((w) => w.table === 'intake' && w.method === 'PATCH')
  expect(qtyWrite, '沒有送出 intake 的 PATCH 請求').toBeTruthy()
  expect(qtyWrite!.body).toMatchObject({ qty: 2 })

  // 畫面立刻反映新 qty，不必重整頁面：品名旁 ×2、該筆熱量變 840（420×2）
  await expect(page.locator('.item[data-row="102"] .qty')).toHaveText('×2')
  await expect(page.locator('.item[data-row="102"] .kc')).toHaveText('840')
})

/* 迴歸鎖：真機回報長按開 sheet 前會先閃一下刪除鈕（swipe reveal）。根因是舊版
   blockClickUntil 在計時器「觸發當下」就設成 now+150ms，不是在使用者「真的放手」
   那一刻才起算——上面那條測試用 650ms（500+150 剛好卡在邊界）測不出來，因為那個
   時間點還沒把窗口熬過期。真實使用者看到 sheet 彈出來才放手，反應時間普遍
   遠超過 150ms，放手時窗口早就過期，補來的 click 就會把 onToggle() 打進去。
   這裡刻意按住 1500ms（遠超過舊窗口的有效範圍）才放手，才驗得到這條路徑。 */
test('長按放手前如果拖得比較久（使用者看到 sheet 才放手），一樣不能誤開左滑 reveal', async ({ page }) => {
  await openApp(page)

  const row = page.locator('.item[data-row="102"] .item-content')
  const box = await row.boundingBox()
  expect(box, '拿不到品項座標').not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  await longPress(page, cx, cy, 1500)

  const sheet = page.locator('#edit-qty-sheet-root .sheet')
  await expect(sheet).toBeVisible()
  await expect(page.locator('.item[data-row="102"] .item-row')).not.toHaveClass(/is-open/)
})

/* 迴歸鎖：上面那個修法（放手當下才把 blockClickUntil 收斂成有限值）本身引入了新
   迴歸——sheet 一開，整片 scrim（z-index 10）蓋住這一列，button 沒有
   setPointerCapture，放手時 pointerup 落在 scrim 上、不會送到 .item-content，
   這顆按鈕自己的 onPointerUp（掛在 handlePointerUp）就永遠不會跑，blockClickUntil
   會卡在 Infinity 出不來（precommit-review 抓到）。改成 onPointerCancel／
   onPointerLeave 也一併走 handlePointerUp 後，驗法是「長按開 sheet → 關掉 sheet →
   對同一列正常點一下 → 確認滑動 reveal 還能正常開合」，不能開代表 blockClickUntil
   卡死了。 */
test('長按開過 sheet、關掉之後，同一列的正常點擊（滑動 reveal）不能被卡死', async ({ page }) => {
  await openApp(page)

  const row = page.locator('.item[data-row="102"] .item-content')
  const box = await row.boundingBox()
  expect(box, '拿不到品項座標').not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  await longPress(page, cx, cy, 650)
  const sheet = page.locator('#edit-qty-sheet-root .sheet')
  await expect(sheet).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden({ timeout: 2000 })

  await row.click()
  await expect(page.locator('.item[data-row="102"] .item-row')).toHaveClass(/is-open/)
})

/* 迴歸鎖（F1）：長按計時器沒有隨 SwipeRow unmount 清除的話，這一列在計時器還沒到的
   期間因為別的原因（換日期、刪除退場動畫跑完…）從畫面消失，計時器仍會在背景倒數，
   時間到了照樣對一筆使用者已經看不到的品項開 sheet、真的送出 PATCH——畫面卻停在
   切走前的快照，直到重整頁面才會發現資料其實被改了。用「按住不放 → 日期切換讓
   .item 整段卸載（Today.tsx 的 rows===null 分支會讓 renderTimeline 整個不渲染，
   跳過 AnimatePresence 退場，是最快、最乾淨的卸載路徑）→ 等超過 LONG_PRESS_MS」
   重現：修好前 sheet 會彈出，修好後完全不會。 */
test('長按期間該列被卸載（換日期）——計時器不能在背景照樣把 sheet 彈出來、送出 PATCH', async ({ page }) => {
  await openApp(page)

  const row = page.locator('.item[data-row="102"] .item-content')
  const box = await row.boundingBox()
  expect(box, '拿不到品項座標').not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.waitForTimeout(120) // 計時器仍在跑（LONG_PRESS_MS=500 還沒到）

  // 用真的 DOM click（不經 Playwright 自己的滑鼠追蹤，避免跟仍按著的左鍵狀態打架）
  // 觸發換日期——這是「使用者其他操作讓這一列消失」的最小重現，不代表真實的雙指手勢
  await page.evaluate(() => {
    const btn = document.querySelector('.date-arrow[aria-label="前一天"]') as HTMLButtonElement | null
    btn?.click()
  })

  // rows===null 那個 render 會讓整段 timeline（含這一列）立即卸載，不是退場動畫跑完才卸載。
  // stub 的 intake 查詢沒加人工延遲，「載入中…」那個中間態常常一個 tick 就跳過去，
  // 不拿它當斷言（會是不穩定的競態），只認最終這一列真的不在了
  await expect(page.locator('.item[data-row="102"]')).toHaveCount(0)

  await page.waitForTimeout(900) // 遠超過 LONG_PRESS_MS，讓計時器（如果沒被清掉）有機會觸發
  await page.mouse.up()

  expect(await page.locator('#edit-qty-sheet-root').count(), '這一列已經卸載，不該還彈出編輯 sheet').toBe(0)

  const writes = await page.evaluate(
    () => (window as unknown as { __writes: { table: string; method: string; body: unknown }[] }).__writes,
  )
  expect(
    writes.filter((w) => w.table === 'intake' && w.method === 'PATCH'),
    '不該送出任何 intake 的 PATCH——那一列從沒被使用者確認過',
  ).toHaveLength(0)
})

/* 迴歸鎖（F2）：跟 F1 是同一個病灶的另一個入口——這次不靠計時器的時機賭，而是
   「sheet 已經開著，但底下那一列被換掉了」。這個自建 sheet 有 aria-modal 但沒有
   focus trap（跟 Settings.tsx 的既有 sheet 一樣，這次範圍不修），背景的日期箭頭一樣
   按得到／Tab 得到，可以在 sheet 開著的狀態下把畫面切到別天，讓正在編輯的那一列
   卸載。這裡用直接呼叫 DOM click（模擬「背景控制項一樣可觸發」的效果，不必真的
   走一輪 Tab 焦點跳出 sheet 的操作序列，效果等價）。修法是寫入前在 App.tsx 的
   handleUpdateIntakeQty 統一擋（跟 F1 共用同一道檢查，不逐路徑補丁）：存檔那一刻
   如果這個 id 已經不在目前畫面的 rows 裡，直接跳過、不送 PATCH。 */
test('編輯 sheet 開著時該列因換日期離開畫面——存檔不能送出 PATCH，也不能讓畫面卡在舊值', async ({ page }) => {
  await openApp(page)

  const row = page.locator('.item[data-row="102"] .item-content')
  const box = await row.boundingBox()
  expect(box, '拿不到品項座標').not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  await longPress(page, cx, cy, 650)
  const sheet = page.locator('#edit-qty-sheet-root .sheet')
  await expect(sheet).toBeVisible()

  // sheet 開著的狀態下換到前一天——那一列（id=102）從畫面上消失。sheet 本身沒有
  // 因為外部狀態變化被強制關掉，這是**目前行為，不是刻意的 UX 設計**（沒有
  // focus trap／沒有監看外部狀態是已知缺口，見 session-state 未解失敗）——這裡
  // 只驗最後一道防線（寫入前守門）撐得住，不代表「sheet 該不該自動關」已有定論，
  // 之後如果要補「換日期時自動關閉編輯 sheet」的 UX，改的是這一段前提，不是
  // 下面的寫入斷言（precommit-review 提醒過不要把現況誤讀成規格）。
  await page.evaluate(() => {
    const btn = document.querySelector('.date-arrow[aria-label="前一天"]') as HTMLButtonElement | null
    btn?.click()
  })
  await expect(page.locator('.item[data-row="102"]')).toHaveCount(0)
  await expect(sheet).toBeVisible()

  // 改份量、按存入——這一步不該真的送出 PATCH
  await page.locator('#edit-qty-sheet-root .qty-btn').last().click()
  await page.locator('#edit-qty-sheet-root .pick-bar-btn').click()
  await expect(sheet).toBeHidden({ timeout: 2000 })

  const writes = await page.evaluate(
    () => (window as unknown as { __writes: { table: string; method: string; body: unknown }[] }).__writes,
  )
  expect(
    writes.filter((w) => w.table === 'intake' && w.method === 'PATCH'),
    '這一列已經離開畫面（換日期），不該送出 PATCH',
  ).toHaveLength(0)

  // 切回今天：畫面不能卡在被寫壞的舊值——qty 應該還是原本的 1（不顯示 ×N），
  // 熱量還是 420，不是被誤改成 2 份的 840
  await page.evaluate(() => {
    const btn = document.querySelector('.date-arrow[aria-label="後一天"]') as HTMLButtonElement | null
    btn?.click()
  })
  await expect(page.locator('.item[data-row="102"]')).toHaveCount(1)
  await expect(page.locator('.item[data-row="102"] .qty')).toHaveCount(0)
  await expect(page.locator('.item[data-row="102"] .kc')).toHaveText('420')
})
