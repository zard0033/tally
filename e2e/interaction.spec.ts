/* 左滑互動的獨立路徑。每個 test 自己 openApp()，狀態互不影響，單獨跑得動：
     npx playwright test interaction -g "關鍵字"
   要探路（量而不是猜）時，在這裡寫一個暫時的 test 印 rowState() 就好，跑一條約 3 秒。
   這整個檔案的存在理由：拖曳／動畫這種要反覆試的東西，在 tally.spec.ts 那串累積狀態的
   15 條路徑裡除錯，一輪 20 秒起跳，而且斷言會建在上一條留下的狀態上。 */
import { expect, test, type Page } from '@playwright/test'
import { FIX, TODAY, TOMORROW, USER_ID, YDAY } from './fixtures'
import {
  check, currentIso, deleteViaTap, gotoDate, grabPoint, leg, must, mustText, nextDay, numFrom, openApp, prevDay, rowState,
  shiftIso, slowDrag, waitCount,
} from './harness'
import { seedFetchStub, type AuthMode } from './stub'

/** window.__intakeCalls 的型別斷言（stub.ts 掛在 window 上，e2e 這邊只讀）。 */
const intakeCalls = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __intakeCalls: string[] }).__intakeCalls)

test('拖過門檻放手 → 列打開（不是被補上的 click 又切回去）', async ({ page }) => {
  await openApp(page)
  const g = await grabPoint(page)
  await slowDrag(page, g, leg(g, { x: g.x - 100, y: g.y }, 8))
  await page.waitForTimeout(400)
  const s = await rowState(page)
  /* 這裡曾經是 false。根因是瀏覽器補的 click 比 motion 的 dragEnd 先到：click 先把列切開、
     dragEnd 再切一次，兩次抵銷成關閉，看起來像「拖曳沒生效」。擋 click 的旗標因此必須在
     dragStart 就立起，不能等 dragEnd 才記時間戳。 */
  check(s.open, `拖 100px 放手後列沒有打開（transform=${s.transform}）`)
  check(s.count === 2 && s.undoBar === 0, `不該刪到東西：count=${s.count} undoBar=${s.undoBar}`)
})

test('拖曳之後的下一次點擊不可以被吃掉', async ({ page }) => {
  await openApp(page)
  const g = await grabPoint(page)
  await slowDrag(page, g, leg(g, { x: g.x - 100, y: g.y }, 8))
  await page.waitForTimeout(400)
  check((await rowState(page)).open, '前置條件不成立：拖過門檻後列沒有打開')
  /* 擋 click 的旗標若沒有自己過期的機制，就會停在「剛拖過」的狀態，把之後每一次真正的
     點擊都吃掉（第一版的 bug，precommit review 抓到）。 */
  await page.locator('.timeline .item-content').first().click()
  await page.waitForTimeout(300)
  check(!(await rowState(page)).open, '拖曳之後的下一次點擊被吃掉了——列沒有關上')
})

test('復原提示顯示中，它兩側的空白不可以攔截底下的時間軸', async ({ page }) => {
  await openApp(page)
  const g = await grabPoint(page)
  await slowDrag(page, g, leg(g, { x: g.x - 80, y: g.y }, 8))
  await page.waitForTimeout(400)
  await page.locator('.item-delete').first().click()
  await page.waitForTimeout(400)
  /* 看得見的只有置中那顆 84px pill，但容器是滿寬 44px 的絕對定位層。v2.3 把滿寬可見條
     縮成置中 pill 時，命中區沒有跟著縮——變成一條看不見的攔截帶，5 秒內捲不動也滑不動
     （precommit deep review 抓到）。這條鎖的是「容器不吃事件、鈕自己吃」。 */
  const hit = await page.evaluate(() => {
    const bar = document.querySelector('.undo-bar') as HTMLElement
    const btn = bar.querySelector('button') as HTMLElement
    const r = bar.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    const y = r.top + r.height / 2
    const cls = (el: Element | null) => (el ? el.className.toString() : 'null')
    return {
      left: cls(document.elementFromPoint(r.left + 30, y)),
      right: cls(document.elementFromPoint(r.right - 30, y)),
      pill: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.undo-bar button') !== null,
    }
  })
  check(!hit.left.includes('undo-bar'), `復原條左側仍在攔截：命中 ${hit.left}`)
  check(!hit.right.includes('undo-bar'), `復原條右側仍在攔截：命中 ${hit.right}`)
  check(hit.pill, 'pill 本身反而點不到了（pointer-events 收得太乾淨）')
  // 鈕仍然按得動：復原後品項回到 2 筆、提示條消失
  await page.locator('.undo-bar button').click()
  await page.waitForTimeout(300)
  const s = await rowState(page)
  check(s.count === 2 && s.undoBar === 0, `復原沒生效：count=${s.count} undoBar=${s.undoBar}`)
})

test('小幅拖曳不到門檻 → 回彈關閉，且不誤刪', async ({ page }) => {
  await openApp(page)
  const g = await grabPoint(page)
  await slowDrag(page, g, leg(g, { x: g.x - 12, y: g.y }, 4))
  await page.waitForTimeout(400)
  const s = await rowState(page)
  check(!s.open, '小幅拖曳不該把列打開')
  check(s.count === 2 && s.undoBar === 0, `小幅拖曳不該刪東西：count=${s.count} undoBar=${s.undoBar}`)
})

/* undo 跨日期存活（v2.5 真機第四輪，App.tsx pendingDelete/loadDay/undoDelete）。
   四條各自獨立 openApp()，鎖住四條路徑各自的行為，缺一不可：
   1／2 鎖「換日期不結清、別天按復原不影響別天」；3 鎖「濾掉不是結清」這個容易被
   改回去的細節（濾掉與結清在這個 fixture 的表面行為很像，差別只在「切走再切回」）；
   4 鎖「切分頁仍要結清」這一半沒變，防止改 ① 時順手也把它改掉。
   fixture 補了 e2e/fixtures.ts 的 YDAY／intakeYday，stub.ts 依 eaten_on 分流。 */

test('undo 跨日期 1 — 刪一筆後切到前一天，提示條仍在（換日期不再結清）', async ({ page }) => {
  await openApp(page)
  const before = await page.locator('.timeline .item').count()
  await deleteViaTap(page)
  await waitCount(page, '.timeline .item', before - 1, '刪除沒生效，測不了跨日期 undo')
  await waitCount(page, '.undo-bar', 1, '刪除後應該有提示條')

  await prevDay(page)
  await waitCount(
    page,
    '.undo-bar',
    1,
    '切到前一天後提示條不見了——undo 窗應該跨日期存活，不能一換日期就結清',
  )
})

test('undo 跨日期 2 — 別天按復原不改別天清單，切回原本那天那筆還在', async ({ page }) => {
  await openApp(page)
  const before = await page.locator('.timeline .item').count()
  const firstName = ((await page.locator('.timeline .item .nm').first().textContent()) ?? '').trim()
  await deleteViaTap(page)
  await waitCount(page, '.timeline .item', before - 1, '刪除沒生效')

  await prevDay(page)
  await waitCount(page, '.undo-bar', 1, '提示條應該跨日期還在')
  /* ydayCount 不能用單次 count() 快照：品項列包在 AnimatePresence 裡，換日期時
     「今天剩下那筆」的退場動畫跟「前一天那筆」的進場動畫會重疊一小段時間，這段重疊
     期間 DOM 上同時看得到兩個 .item（真實計數，不是 race——重試也量得到同一個暫態值）。
     用 waitCount 等它收斂到 fixtures 裡前一天真正的筆數（intakeYday.length），
     等到的是動畫結束後的穩態，不是賭一個「應該夠久」的固定毫秒數。 */
  await waitCount(page, '.timeline .item', FIX.intakeYday.length, '前一天的品項數應收斂到穩態')
  const ydayCount = await page.locator('.timeline .item').count()
  await page.locator('.undo-bar button').click()
  await waitCount(page, '.undo-bar', 0, '按復原後提示條應該消失')
  check(
    (await page.locator('.timeline .item').count()) === ydayCount,
    '在別天按復原不該動到別天目前畫面的清單筆數——不可以把 A 日那筆插進 B 日',
  )

  await nextDay(page)
  await waitCount(
    page,
    '.timeline .item',
    before,
    `切回原本那天品項數應回到 ${before}（那筆從沒被真的送出 DELETE）`,
  )
  const nameAfter = ((await page.locator('.timeline .item .nm').first().textContent()) ?? '').trim()
  check(nameAfter === firstName, `切回原本那天後第一列品名變了：原「${firstName}」現「${nameAfter}」`)
})

test('undo 跨日期 3 — 切走再切回、不按復原 → 那一筆仍不在畫面上（濾掉，不是結清）', async ({ page }) => {
  await openApp(page)
  const before = await page.locator('.timeline .item').count()
  const firstName = ((await page.locator('.timeline .item .nm').first().textContent()) ?? '').trim()
  await deleteViaTap(page)
  await waitCount(page, '.timeline .item', before - 1, '刪除沒生效')

  await prevDay(page)
  await page.waitForTimeout(500) // 換日期要等 fetch 落地才有東西可切回去，這裡沒有立即斷言
  await nextDay(page)

  await waitCount(
    page,
    '.timeline .item',
    before - 1,
    '切回原本那天後，被刪的那筆重新出現了——loadDay 應該把待刪那筆從撈回來的 rows 濾掉',
  )
  const names = await page.locator('.timeline .item .nm').allTextContents()
  check(!names.some((n) => n.trim() === firstName), `切回後仍看得到被刪的「${firstName}」`)
  await waitCount(page, '.undo-bar', 1, '切回原本那天後提示條應該還在（還沒到 5 秒，計時器沒被切分頁動過）')
})

test('undo 跨日期 4 — 切分頁到設定，提示條消失（這一半沒變，鎖住不被順手改掉）', async ({ page }) => {
  await openApp(page)
  await deleteViaTap(page)
  await waitCount(page, '.undo-bar', 1, '刪除後應該有提示條')

  await page.locator('.tab[aria-label="設定"]').click()
  await waitCount(page, '.undo-bar', 0, '切到設定頁後復原提示條仍殘留——分頁這一路仍該結清')
})

/* 日期快取（v2.6：切日期無感）。四條各自獨立 openApp()：
   1／2 鎖「命中快取＝無感」這個功能的正反兩面（不重打 API、不進載入態）；
   3 鎖預取真的有背景發生；4 鎖快取路徑跟 fetch 路徑共用同一套待刪濾除，
   不會讓已經真的送出 DELETE 的那一筆，經由快取又復活。 */

test('日期快取 1 — 切到前一天再切回今天，今天不會有新的 intake 請求（命中快取）', async ({ page }) => {
  await openApp(page)
  // 等背景預取（今天載入成功後會預取前一天）先跑完，避免跟下面的手動切換搶那次 fetch
  await page.waitForTimeout(500)

  const calls1 = await intakeCalls(page)
  const today = calls1[0]! // 開機第一筆 fetch 就是今天，用它當比對基準，不必額外算日期字串
  const todayCountBefore = calls1.filter((d) => d === today).length

  await prevDay(page)
  await page.waitForTimeout(500) // 前一天可能命中快取也可能沒有，等它穩定（含它自己觸發的背景預取）
  await nextDay(page)
  await page.waitForTimeout(300)

  const calls2 = await intakeCalls(page)
  const todayCountAfter = calls2.filter((d) => d === today).length
  check(
    todayCountAfter === todayCountBefore,
    `切回今天不該再打 intake API：切回前 ${todayCountBefore} 次，切回後 ${todayCountAfter} 次`,
  )
})

test('日期快取 2 — 命中快取時畫面不出現「載入中…」（MutationObserver 全程監看，不是單次取樣）', async ({ page }) => {
  await openApp(page)
  await prevDay(page)
  await page.waitForTimeout(500) // 讓前一天穩定下來、今天留在快取裡

  /* click() 之前先掛好 observer：命中快取的 setRows 不是非同步的，一旦漏接就永遠補不回來，
     所以不能等 click 完才裝——那樣就退化成單次取樣，抓不到「曾經出現又消失」的閃爍。 */
  await page.evaluate(() => {
    const w = window as unknown as { __sawLoading?: boolean; __loadingObserver?: MutationObserver }
    w.__sawLoading = false
    /* 偵測範圍要收緊到 .timeline：`document.querySelector('.muted')` 只看文件裡**第一個**
       .muted，而常駐掛著的記一筆 sheet 也有一個「載入中…」的 .muted——範圍不收緊的話，
       這條斷言有假通過（或假失敗）的風險，而它自己不會告訴你（verifier 指出）。 */
    const check = () => {
      const el = document.querySelector('.timeline .muted')
      if (el?.textContent?.includes('載入中')) w.__sawLoading = true
    }
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    w.__loadingObserver = mo
    check() // 掛上的當下也查一次，防止漏掉「掛上前就已經是這個狀態」的邊界
  })

  await nextDay(page) // 切回今天：應該命中快取
  await page.waitForTimeout(300)

  const sawLoading = await page.evaluate(() => {
    const w = window as unknown as { __sawLoading?: boolean; __loadingObserver?: MutationObserver }
    w.__loadingObserver?.disconnect()
    return w.__sawLoading
  })
  check(!sawLoading, '切到已看過的日期（命中快取）時畫面出現過「載入中…」——不該進載入態')
})

test('日期快取 3 — 今天載入成功後，背景真的預取了前一天', async ({ page }) => {
  await openApp(page)
  await page.waitForTimeout(500) // 給背景預取一點時間跑完
  const calls = await intakeCalls(page)
  check(calls.includes(YDAY), `沒看到對前一天（${YDAY}）的 intake 請求——預取沒有真的發生。實際請求：${calls.join(',')}`)
})

test('日期快取 4 — 刪一筆、切到前一天再切回來（走快取路徑），那一筆仍不在畫面上', async ({ page }) => {
  await openApp(page)
  const before = await page.locator('.timeline .item').count()
  const firstName = ((await page.locator('.timeline .item .nm').first().textContent()) ?? '').trim()
  await deleteViaTap(page)
  await waitCount(page, '.timeline .item', before - 1, '刪除沒生效，測不了快取路徑的濾除')

  await prevDay(page)
  await page.waitForTimeout(500) // 讓今天的快取穩定（此時待刪仍在 5 秒窗內，還沒真的送出 DELETE）
  await nextDay(page) // 切回今天：這次要走快取命中路徑，不是 loadDay 的 fetch 路徑

  await waitCount(
    page,
    '.timeline .item',
    before - 1,
    '走快取路徑切回今天後，被刪的那筆重新出現了——快取命中的入口沒有套用跟 loadDay 一樣的待刪濾除',
  )
  const names = await page.locator('.timeline .item .nm').allTextContents()
  check(!names.some((n) => n.trim() === firstName), `走快取路徑切回後仍看得到被刪的「${firstName}」`)
})

test('日期快取 5 — 慢請求在使用者已經切回今天之後才落地，不可以蓋掉今天的畫面', async ({ page }) => {
  /* 這條是快取**帶進來**的 race，不是本來就有的：改動前每次換日都要往返、延遲量級相同，
     最後按的那天最後落地；命中快取變成同步回填之後，「先發的慢請求」會後到並整包蓋掉
     rows。verifier 實測重現的畫面是：頁首寫「今天」、主數字回到全額、品項 0 筆，
     而且不會自我修復（走快取不再打 API，伺服器沒有機會糾正它）。
     修法是 loadDay 在 await 之後比對 currentDateRef，不是當前日就只寫快取、不動畫面。 */
  await openApp(page, { intakeDelayMs: 1500 })
  await page.waitForTimeout(3000) // 今天載入完成、前一天也預取進快取

  const todayItems = await page.locator('.timeline .item').count()
  check(todayItems > 0, '前置條件不成立：今天應該有品項才測得出「被蓋掉」')

  await prevDay(page) // 命中快取，瞬間
  await page.waitForTimeout(300)
  await prevDay(page) // 前兩天沒有快取 → 開始 1.5s 的慢 fetch
  await page.waitForTimeout(200)
  await page.click('button.date-today-btn') // 在慢請求落地前回到今天（命中快取，瞬間）
  await page.waitForTimeout(3000) // 等那支慢請求確實落地

  const after = await page.locator('.timeline .item').count()
  const title = ((await page.locator('h1.date-title').textContent()) ?? '').trim()
  check(
    after === todayItems,
    `今天的畫面被較早發出的慢請求蓋掉了：頁首「${title}」但品項剩 ${after} 筆（應為 ${todayItems}）`,
  )
})

/* v2.38 四項 iOS 微調的 CSS 面迴歸鎖。手感（spring 過衝）鎖不了——桌面模擬不出真人甩動的
   速度量級，而過衝只有幾 px；但四項裡真正靜默壞掉的方式全是「值被改回去／漏改一半」，
   那些比對 computed style 就擋得住。**這條的存在理由是它抓過真的東西**：v2.38 把
   `.node-name` 改 600 卻漏了 `.todo-row .lb`，兩種餐別標題並排在同一條時間軸上字重不一致，
   截圖看過也沒看出來，是 precommit review 抓到的。 */
test('v2.38 四項微調的 CSS 沒有被改回去', async ({ page }) => {
  await openApp(page)
  const s = await page.evaluate(() => {
    const g = (sel: string, prop: string) => {
      const el = document.querySelector(sel)
      if (!el) return `NO-EL(${sel})`
      return (getComputedStyle(el) as unknown as Record<string, string>)[prop] ?? 'undef'
    }
    return {
      mealDone: g('.node-name', 'fontWeight'),
      mealTodo: g('.todo-row .lb', 'fontWeight'),
      itemName: g('.item .nm', 'fontWeight'),
      tabSelect: g('.tabbar .tab', 'webkitUserSelect'),
      nameSelect: g('.item-content .nm', 'webkitUserSelect'),
    }
  })
  // 兩種餐別標題必須同重——漏改一邊正是這條要擋的
  check(s.mealDone === s.mealTodo, `已記錄與待記錄的餐別標題字重不一致：${s.mealDone} vs ${s.mealTodo}`)
  check(s.mealDone === '600', `餐別標題字重應為 600（v2.38），實際 ${s.mealDone}`)
  // 與品項名仍要差開，否則層級塌掉
  check(s.itemName === '400', `品項名字重應維持 400，實際 ${s.itemName}`)
  // 長按只鎖控件、不鎖內容
  check(s.tabSelect === 'none', `分頁應鎖住不可選取，實際 ${s.tabSelect}`)
  check(s.nameSelect === 'text', `品名應保持可選取（使用者自己輸入的資料），實際 ${s.nameSelect}`)

  // scrim 的模糊：值可以再調，但屬性不能不見（真機確認前它是唯一的看門狗）
  await page.locator('button[aria-label="記一筆"]').click()
  await page.waitForTimeout(500)
  const bf = await page.evaluate(() => {
    const el = document.querySelector('.scrim')
    if (!el) return 'NO-SCRIM'
    const st = getComputedStyle(el)
    return st.backdropFilter || (st as unknown as Record<string, string>).webkitBackdropFilter
  })
  check(/blur\(/.test(bf), `scrim 的 backdrop-filter 不見了：${bf}`)
})

/* ── v2.47：預先記錄明天的飲食 ────────────────────────────────────────────
   這組**翻掉了一條既有決策**：`goToDate` 的「看不了未來」與右箭頭 `disabled={isToday}`。
   tally.spec.ts 那條「今天時後一天應停用」的斷言已經改成相反方向——**鎖著舊決策的測試
   必須跟著翻，不是放寬**，否則它會以「回歸失敗」的外表擋住一個刻意的改變。

   四條各鎖一件不同的事，不是同一件驗四遍：**界在哪／數字問什麼／記到哪一天／要不要等載入**。
   日期比對只取 `M/D`（h1 是「週X M/D」），不從 src 匯入 weekdayDate——e2e 跑的是 build 後的
   preview，測試檔不該跟 `@/` 別名綁在一起。 */
const monthDay = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}/${d}`
}

test('v2.47 ① 往未來只開一天：今天可以往前走，明天就是上界', async ({ page }) => {
  await openApp(page)
  /* v2.53：界從「右箭頭停用」搬到日期格上——明天可選、明天的下一天停用，月曆的「下個月」只在
     下個月第一天沒超過明天時可按。這條原本斷言「後一天停用」，鎖的是已被換掉的元件，
     所以是改成相反方向的等價規則，不是放寬也不是刪掉。 */
  await gotoDate(page, TOMORROW)
  await page.waitForTimeout(500)
  const title = ((await page.locator('h1.date-title').textContent()) ?? '').trim()
  check(
    title.endsWith(monthDay(TOMORROW)),
    `選明天後 h1 應該是明天（${monthDay(TOMORROW)}），實際是「${title}」`,
  )
  await must(page, 'button.date-today-btn', '「回今天」鈕（明天頁也要有，否則走得出去回不來）')

  const after = shiftIso(TOMORROW, 1)
  await page.locator('.datectl-title').click() // 展開月曆，停在明天所在的那個月
  const cell = page.locator(`.datectl-month [data-date="${after}"]`)
  if ((await cell.count()) > 0) {
    check(await cell.isDisabled(), `明天的下一天（${after}）必須停用——只開一天，不是開放任意未來`)
  } else {
    check(
      await page.getByRole('button', { name: '下個月' }).isDisabled(),
      `明天的下一天（${after}）在下個月，「下個月」必須停用`,
    )
  }
})

/* v2.53：原本這裡是「鍵盤按『後一天』到上界，焦點要被容器接住」——那顆鈕不存在了，焦點流失的
   風險換了個形狀：月曆收合時被點的那格會卸載。同一個要守的事（鍵盤使用者不掉回 body）。
   v2.101：選日期不再收合月曆，被點的格子不卸載、焦點留在它身上；現在只有 Escape 收合，焦點回標題。 */
test('v2.101 月曆開著時選別天不收合：連選兩天都還開著、焦點留在被點的那格；點已選的那天與 Escape 才收，焦點回標題，不是掉回 body', async ({ page }) => {
  await openApp(page)
  const title = page.locator('.datectl-title')
  await title.focus()
  await title.press('Enter')
  await expect(title).toHaveAttribute('aria-expanded', 'true')
  // 今天以外、同一個月裡點得到的兩天（今天是 1 號時只有今天與明天，所以從「今天以外」的格子裡挑）
  const cells = page.locator('.datectl-month .datectl-day:not([disabled]):not([aria-pressed="true"])')
  const first = cells.first()
  const firstIso = (await first.getAttribute('data-date'))!
  await first.focus()
  await first.press('Enter')
  await expect.poll(() => currentIso(page), '選了月曆裡的一天，日期要跟著變').toBe(firstIso)
  await expect(title, '選完日期月曆不該收').toHaveAttribute('aria-expanded', 'true')
  check(
    await page.evaluate((iso) => document.activeElement?.getAttribute('data-date') === iso, firstIso),
    '選完日期後焦點沒有留在被點的那格（月曆沒收，格子也沒卸載，焦點不該動）',
  )
  const second = page.locator('.datectl-month .datectl-day:not([disabled]):not([aria-pressed="true"])').first()
  const secondIso = (await second.getAttribute('data-date'))!
  await second.click()
  await expect.poll(() => currentIso(page)).toBe(secondIso)
  await expect(title, '連選第二天月曆仍開著').toHaveAttribute('aria-expanded', 'true')
  // 點已經選中的那天：收合（這是會發生的動作，使用者 2026-10-28 要保留），日期不變，焦點回標題
  await page.locator('.datectl-month .datectl-day[aria-pressed="true"]').click()
  await expect(title, '點已選中的日期月曆要收合').toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => currentIso(page)).toBe(secondIso)
  check(
    await page.evaluate(() => document.activeElement?.classList.contains('datectl-title') ?? false),
    '點已選中的日期收合月曆後焦點沒有回到標題',
  )

  await title.press('Enter')
  await expect(title).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(title).toHaveAttribute('aria-expanded', 'false')
  check(
    await page.evaluate(() => document.activeElement?.classList.contains('datectl-title') ?? false),
    'Escape 收合月曆後焦點沒有回到標題（掉回 body 或別處，鍵盤使用者失去位置）',
  )
})

test('v2.47 ② 明天問「還能吃」不是「攝取」——那正是這頁存在的理由', async ({ page }) => {
  await openApp(page)
  await nextDay(page)
  await page.waitForTimeout(500)
  /* 明天在 stub 裡是空的一天 ⇒ 還沒吃任何東西 ⇒ 「還能吃」＝整份目標。
     這一條同時證明**每日目標引擎在明天照常運作**（AC6）：數字不是 0、也不是「—」，
     而是今天那份目標本人。 */
  await mustText(page, '.gauge-lead', '還能吃', '明天的主數字標籤應為「還能吃」（跟今天同一個問題，只是還沒發生）')
  const remainTomorrow = await numFrom(page, '.gauge-num')
  const target = await numFrom(page, '.gauge-side .tgt')
  check(
    remainTomorrow === target,
    `明天什麼都沒記，「還能吃」應該等於整份目標 ${target}，實際 ${remainTomorrow}`,
  )

  // 對照組：過去仍然是「攝取」。**沒有這一半，把標籤全站改成「還能吃」也會是綠的。**
  await page.click('button.date-today-btn')
  await page.waitForTimeout(400)
  await prevDay(page)
  await page.waitForTimeout(500)
  await mustText(page, '.gauge-lead', '攝取', '歷史日仍應顯示「攝取」——回頭看問的是那天吃了多少')
})

test('v2.47 ③ 在明天記一筆會記到明天，今天的數字不受影響', async ({ page }) => {
  await openApp(page)
  const todayNum = await numFrom(page, '.gauge-num')

  await nextDay(page)
  await page.waitForTimeout(500)
  await page.click('button.cta')
  await page.waitForSelector('.food-row', { timeout: 3000 })
  await page.locator('.food-row').first().click()
  await page.waitForSelector('.pick-bar', { timeout: 2000 })
  /* deep review 抓到的真缺陷：`pickBarRight` 的分支原本問「是不是今天」，明天會走進
     「歷史日」那條回傳「共 N」——而**「看會不會超過」正是這個功能存在的全部理由**，
     等於在最該用的畫面上失效。第一版四條 e2e 沒有一條讀過確認列的文字，所以全綠。 */
  const remain = ((await page.locator('.pick-bar .remain').textContent()) ?? '').trim()
  check(
    remain.startsWith('剩'),
    `明天的確認列應該回答「還剩多少」（「剩 N」或超標時的 (+N)），實際是「${remain}」`,
  )
  await page.click('.pick-bar-btn')
  await page.waitForTimeout(700)

  const writes = await page.evaluate(
    () => (window as unknown as { __writes: { path: string; method: string; body: unknown }[] }).__writes,
  )
  const posted = writes.filter((w) => w.path.startsWith('intake') && w.method === 'POST')
  check(posted.length === 1, `明天按「加入」應送出一筆 intake，實際 ${posted.length} 筆`)
  const rows = posted[0].body as { eaten_on?: string }[]
  check(
    Array.isArray(rows) && rows.every((r) => r.eaten_on === TOMORROW),
    `送出的 eaten_on 應該是明天（${TOMORROW}），實際 ${JSON.stringify(rows)}`,
  )

  /* AC7：回到今天，主數字必須跟記錄之前一模一樣。**這條才是「不污染」的證據**——
     光看 POST 的日期只證明送對了，不證明畫面上今天那份沒被算進去。 */
  await page.click('button.date-today-btn')
  await page.waitForTimeout(600)
  check(
    (await numFrom(page, '.gauge-num')) === todayNum,
    `在明天記一筆之後，今天的主數字不該變（原 ${todayNum}，現 ${await numFrom(page, '.gauge-num')}）`,
  )
})

test('v2.47 ④ 一開機就預取明天：按下箭頭時資料已經在手上', async ({ page }) => {
  await openApp(page)
  await page.waitForTimeout(600)
  const calls = await intakeCalls(page)
  /* DESIGN v2.5 那條「按下箭頭時資料要已經在手上」原本對今天是**失效的**——舊的預取守衛
     寫著「今天不必預取後一天，因為看不了未來」，而那個前提正是這輪翻掉的。
     不補這條的話，最常走的一條路（從今天按 →）會變成唯一沒有預取的。 */
  check(
    calls.includes(TOMORROW),
    `開機後應已預取明天（${TOMORROW}），實際打過的日期：${JSON.stringify(calls)}`,
  )
})

/* ── v2.53：日期元件（週列＋月曆，取代 ‹ 日期 › 膠囊）。決策與被推翻的舊決定見 DESIGN.md「日期切換」。
   各鎖一件不同的事：分頁名稱／Escape／切週手勢與它的上界／小點資料來源。 */
test('v2.53 分頁「日記」改名「飲食」', async ({ page }) => {
  await openApp(page)
  check(
    (await page.locator('.tabbar .tab').first().getAttribute('aria-label')) === '飲食',
    '今日頁的分頁 aria-label 應為「飲食」（v2.53 改名）',
  )
})

test('v2.53 Escape 關閉月曆，焦點回標題', async ({ page }) => {
  await openApp(page)
  const title = page.locator('.datectl-title')
  await title.click()
  await expect(title).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(title).toHaveAttribute('aria-expanded', 'false')
  check(
    await page.evaluate(() => document.activeElement?.classList.contains('datectl-title') ?? false),
    'Escape 關月曆後焦點沒有回到標題',
  )
})

/* ═══ 日期元件展開收合動效（spec「日期元件展開收合動效」，DESIGN v2.98） ═══
   高度由 motion 逐幀寫 inline style，錯開與換月是 CSS 動畫。**不逐幀取樣**（機器忙時幀間隔會拖到 40–100ms，
   短動畫取不到中間幀）：高度用 MutationObserver 記 style 寫入，CSS 動畫讀 getAnimations() 的 delay 與 keyframes。 */

type DateWin = { __h: string[] }
/** 記下月曆外殼（含 .datectl-month 的那個 .datectl-panel）的 inline height 寫入；每次寫入都記，不取樣。 */
async function watchMonthHeights(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as DateWin
    w.__h = []
    const root = document.querySelector('.datectl')!
    new MutationObserver(() => {
      const panel = root.querySelector<HTMLElement>(':scope > .datectl-panel:has(.datectl-month)')
      if (panel) w.__h.push(panel.style.height)
    }).observe(root, { subtree: true, attributes: true, attributeFilter: ['style'], childList: true })
  })
}
const monthHeights = (page: Page) => page.evaluate(() => (window as unknown as DateWin).__h)

test('日期元件展開：月曆高度從 0 長到內容高度（寫了中間值），落定後週列不在 DOM、月曆高度 auto', async ({ page }) => {
  await openApp(page)
  await watchMonthHeights(page)
  await page.locator('.datectl-title').click()
  await expect(page.locator('.datectl > .datectl-panel')).toHaveCount(1) // 退場的週列走完才卸載
  const hs = await monthHeights(page)
  const px = hs.map((h) => parseFloat(h)).filter((n) => Number.isFinite(n))
  check(px.length >= 2, `展開時高度沒有逐步寫入（只有 ${JSON.stringify(hs)}）`)
  check(px.some((n) => n > 0), '高度從沒離開 0')
  check(hs.at(-1) === 'auto', `落定後高度應是 auto，實際 ${hs.at(-1)}`)
  await expect(page.locator('.datectl-week')).toHaveCount(0)
  const month = page.locator('.datectl-month')
  const panelH = await month.evaluate((el) => el.parentElement!.getBoundingClientRect().height)
  const innerH = await month.evaluate((el) => el.getBoundingClientRect().height)
  check(Math.abs(panelH - innerH) < 1, `落定後外殼高度（${panelH}）該等於月曆內容高度（${innerH}）`)
})

test('日期元件收合：週列長回來、月曆走完才卸載；展開途中再點能反向，最後收合，焦點在標題', async ({ page }) => {
  await openApp(page)
  const title = page.locator('.datectl-title')
  await title.focus()
  await title.press('Enter') // 展開
  await title.press('Enter') // 展開還沒走完就收：不等，直接反向
  await expect(title).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.datectl-month')).toHaveCount(0)
  await expect(page.locator('.datectl-week')).toHaveCount(1)
  await expect(page.locator('.datectl > .datectl-panel')).toHaveCount(1)
  check(
    await page.evaluate(() => document.activeElement?.classList.contains('datectl-title') ?? false),
    '來回切換之後焦點不在標題',
  )
  // 再展開收合一輪，狀態沒有殘留
  await title.press('Enter')
  await expect(page.locator('.datectl-month')).toHaveCount(1)
  await expect(page.locator('.datectl-week')).toHaveCount(0)
})

test('日期元件展開途中：退場的週列是 inert＋aria-hidden＋data-leaving，點得到的永遠是月曆；選日期不受影響', async ({ page }) => {
  await openApp(page)
  const info = await page.evaluate(async () => {
    const title = document.querySelector<HTMLElement>('.datectl-title')!
    title.click()
    await new Promise((r) => requestAnimationFrame(() => r(null))) // 等一幀：React 掛上月曆、週列轉成退場中
    const leaving = document.querySelector<HTMLElement>('.datectl > [data-leaving]')
    if (!leaving) return null
    const day = leaving.querySelector<HTMLElement>('.datectl-day')!
    const r = day.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return {
      inert: leaving.hasAttribute('inert'),
      hidden: leaving.getAttribute('aria-hidden'),
      hitInsideLeaving: hit ? leaving.contains(hit) : false,
      livePanels: document.querySelectorAll('.datectl > :not([data-leaving])').length - 1, // 扣掉標題列
    }
  })
  check(info !== null, '點標題的當下沒有退場中的週列（動畫被跳過了？）')
  check(info.inert, '退場的週列沒有 inert')
  check(info.hidden === 'true', '退場的週列沒有 aria-hidden')
  check(!info.hitInsideLeaving, '退場的週列還接得到點擊（elementFromPoint 落在它裡面）')
  check(info.livePanels === 1, `不在退場的外殼應只有月曆一份，實際 ${info.livePanels}`)
  // 走完之後 helper 照常選得到日期（currentIso／gotoDate 都排除退場那份）
  await gotoDate(page, shiftIso(TODAY, -3))
  check((await currentIso(page)) === shiftIso(TODAY, -3), '展開動畫之後選日期失敗')
})

/** 點標題展開，等一幀讓 React 掛上月曆，讀每格的 CSS 動畫（在同一個 evaluate 裡讀：播完就從 getAnimations 消失）。 */
const readCellAnimations = (p: Page) =>
  p.evaluate(async () => {
    document.querySelector<HTMLElement>('.datectl-title')!.click()
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const cells = [...document.querySelectorAll<HTMLElement>('.datectl-month .datectl-grid > [style*="--r"]')]
    return cells.map((el) => {
      const a = el.getAnimations()[0]
      const t = a?.effect?.getTiming()
      const frames = (a?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? []
      return {
        row: Number(el.style.getPropertyValue('--r')),
        delay: Number(t?.delay ?? -1),
        duration: Number(t?.duration ?? -1),
        moves: frames.some((f) => f.transform && f.transform !== 'none'),
      }
    })
  })

test('日期元件展開：月曆各格依列錯開 25ms 淡入＋由下方 6px 歸位', async ({ page }) => {
  await openApp(page)
  const cells = await readCellAnimations(page)
  check(cells.length >= 28, `月曆格子數不對（${cells.length}）`)
  const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b)
  check(rows[0] === 0 && rows.length >= 5, `列號應從 0（星期標題）起且至少 5 列，實際 ${rows}`)
  for (const c of cells) {
    check(c.delay === c.row * 25, `第 ${c.row} 列的延遲應是 ${c.row * 25}ms，實際 ${c.delay}`)
    check(c.moves, `第 ${c.row} 列沒有位移動畫`)
  }
  check(Math.max(...rows) * 25 <= 150, '總錯開超過 150ms')
})

test('日期元件展開（減少動態）：不錯開、沒有位移、也不動高度，只留 ≤120ms 的淡入', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  await watchMonthHeights(page)
  const cells = await readCellAnimations(page)
  check(cells.length >= 28, '減少動態：月曆格子數不對')
  for (const c of cells) {
    check(c.delay === 0, `減少動態不該錯開（第 ${c.row} 列延遲 ${c.delay}）`)
    check(!c.moves, '減少動態不該有位移')
    check(c.duration > 0 && c.duration <= 120, `減少動態的淡入該 ≤120ms，實際 ${c.duration}`)
  }
  await expect(page.locator('.datectl-week')).toHaveCount(0) // 退場立刻消失
  const heights = (await monthHeights(page)).filter((h) => h !== '')
  check(heights.length === 0, `減少動態不該寫高度動畫，實際寫了 ${JSON.stringify(heights)}`)
})

test('日期元件換月：格子往對應方向滑一下（下個月從右、上個月從左）', async ({ page }) => {
  await openApp(page)
  await page.locator('.datectl-title').click()
  await expect(page.locator('.datectl > .datectl-panel')).toHaveCount(1)
  const slide = (name: string) =>
    page.evaluate(async (label) => {
      document.querySelector<HTMLElement>(`.datectl-mnav[aria-label="${label}"]`)!.click()
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const grid = document.querySelector<HTMLElement>('.datectl-month .datectl-grid')!
      const a = grid.getAnimations()[0]
      const frames = (a?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? []
      return { dir: grid.dataset.anim, from: String(frames[0]?.transform ?? '') }
    }, name)
  const prev = await slide('上個月')
  check(prev.dir === 'prev' && /translate(X)?\(-12px/.test(prev.from), `上個月應從左滑入，實際 ${JSON.stringify(prev)}`)
  const next = await slide('下個月')
  check(next.dir === 'next' && /translate(X)?\(12px/.test(next.from), `下個月應從右滑入，實際 ${JSON.stringify(next)}`)
})

test('v2.53 週列左右滑切週：往右滑回前一週；往左滑超過明天則不動', async ({ page }) => {
  await openApp(page)
  const box = await page.locator('.datectl-week').boundingBox()
  check(box, '找不到週列')
  const y = box.y + box.height / 2
  const left = { x: box.x + box.width * 0.2, y }
  const right = { x: box.x + box.width * 0.8, y }

  await slowDrag(page, right, leg(right, left, 8)) // 往左滑＝下一週：今天 +7 超過明天，不該動
  await page.waitForTimeout(300)
  check((await currentIso(page)) === TODAY, '往左滑（下一週）超過明天的界，日期不該動')
  /* 被擋下的滑動不可以留下「待搬焦點」的殘影：DateStrip 的 target > max 守衛在 App 的 goToDate 之外
     是第二道，拿掉它日期照樣不動（mutation 實測：只靠日期斷言抓不到），但 refocus 旗標會停在
     'day'，下一次展開月曆時焦點被搶到選中的那格，離開標題。 */
  const title = page.locator('.datectl-title')
  await title.focus()
  await title.press('Enter')
  await expect(title).toHaveAttribute('aria-expanded', 'true')
  check(
    await page.evaluate(() => document.activeElement?.classList.contains('datectl-title') ?? false),
    '被擋下的滑動之後展開月曆，焦點被搶離了標題（refocus 旗標殘留）',
  )
  await title.press('Enter') // 收回週列，接下來的往右滑才有週列可滑
  await expect(title).toHaveAttribute('aria-expanded', 'false')
  // 月曆收合有動畫：走完才卸載。展開已經落定時，退場中的月曆會留在原位把週列擠到下面，這時用原座標滑會落在 inert 的月曆上
  await expect(page.locator('.datectl > .datectl-panel')).toHaveCount(1)

  await slowDrag(page, left, leg(left, right, 8)) // 往右滑＝前一週
  await expect.poll(() => currentIso(page), '往右滑應回到前一週同一個星期').toBe(shiftIso(TODAY, -7))
})

test('v2.53 小點：刪光今天的品項後，晚到的月份查詢不會把今天的小點加回去', async ({ page }) => {
  // stub 不看 filter：任何月份的查詢都會回這份窗口（含今天），等於「伺服器那邊今天還有紀錄」
  await openApp(page, {}, { ...FIX, kcalWindow: [{ eaten_on: TODAY, qty: 1, kcal: 100 }] })
  const n = await page.locator('.timeline .item').count()
  check(n > 0, '前提不成立：今天要有品項才能刪光')
  for (let i = 0; i < n; i++) {
    await deleteViaTap(page)
    await waitCount(page, '.timeline .item', n - i - 1, '刪除沒生效')
  }
  await page.locator('.datectl-title').click()
  const cell = page.locator(`.datectl-month [data-date="${TODAY}"]`)
  await expect(cell, '前提：刪光之後今天沒有小點').not.toHaveClass(/is-marked/)
  await page.getByRole('button', { name: '上個月' }).click() // 觸發另一個月的查詢，回來的窗口仍含今天
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '下個月' }).click()
  await expect(cell, '晚到的月份查詢把剛移掉的小點加回來了（本機已知這天沒有紀錄）').not.toHaveClass(/is-marked/)
})

test('v2.53 往未來滑夾到明天，不是整個丟掉；夾完還在同一週就不動', async ({ page }) => {
  await openApp(page)
  const from = shiftIso(TODAY, -4) // +7 天＝今天+3，一定越過明天（上界）
  await gotoDate(page, from)
  const box = await page.locator('.datectl-week').boundingBox()
  check(box, '找不到週列')
  const y = box.y + box.height / 2
  const right = { x: box.x + box.width * 0.8, y } // 起手在右側——多半是已停用的格子，滑動照樣要接得到
  const left = { x: box.x + box.width * 0.2, y }
  await slowDrag(page, right, leg(right, left, 8))
  await page.waitForTimeout(300)
  const monday = (iso: string) => shiftIso(iso, -((new Date(`${iso}T00:00:00`).getDay() + 6) % 7))
  const want = monday(from) !== monday(TOMORROW) ? TOMORROW : from
  check(
    (await currentIso(page)) === want,
    `往左滑應${want === TOMORROW ? '夾到明天' : '不動（夾完還在同一週）'}（${want}），實際 ${await currentIso(page)}`,
  )
})

test('v2.53 小點：有紀錄的日子（今天來自已載入的品項、其他天來自月份查詢）', async ({ page }) => {
  await openApp(page, {}, { ...FIX, kcalWindow: [{ eaten_on: YDAY, qty: 1, kcal: 100 }] })
  await page.locator('.datectl-title').click()
  await expect(page.locator(`.datectl-month [data-date="${TODAY}"]`), '今天有品項，該有小點').toHaveClass(/is-marked/)
  const tomorrowCell = page.locator(`.datectl-month [data-date="${TOMORROW}"]`)
  if ((await tomorrowCell.count()) > 0) {
    await expect(tomorrowCell, '明天什麼都沒記，不該有小點（否則是「每格都有」的假綠）').not.toHaveClass(/is-marked/)
  }
  if (YDAY.slice(0, 7) !== TODAY.slice(0, 7)) await page.getByRole('button', { name: '上個月' }).click()
  await expect(page.locator(`.datectl-month [data-date="${YDAY}"]`), '月份查詢回來有紀錄的日子，該有小點').toHaveClass(/is-marked/)
})

/* 後端連不上（2026-10-12 Supabase 被閒置暫停那次，v2.48；v2.51 離線開機改了這裡）。
   token 過期時 supabase-js 對 refresh 做指數退避，約 25 秒才放棄。v2.48 的決策是：開機畫面先換成
   「連線比平常慢」、放棄後停在「連不上後端」。**v2.51（階段 1 甲，spec.md AC 2）把它翻掉**：本機有
   session 時，2 秒就拿它進外殼並亮離線提示，不再等 refresh。所以下面「本機有 session」的測試改成
   相反的斷言（不是放寬、不是刪掉）；開機畫面的慢態／連不上後端現在只剩「本機沒有 session」
   （OAuth 回跳要打網路）走得到，由最後兩條守著。
   用 page.clock 快轉那段時間，不真的等。 */

/** 同 App.tsx 的 FAST_BOOT_MS。兩邊是字面複本（理由同 stub.ts 的 SUPABASE_REF）：改一邊要改另一邊。 */
const FAST_BOOT_MS = 2000

const authKeyPresent = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).some((k) => k.endsWith('-auth-token')))
const setAuthMode = (page: Page, mode: AuthMode) =>
  page.evaluate((m) => { (window as unknown as { __authMode: string }).__authMode = m }, mode)

/** 開機（本機有一份已過期的 session）並快轉到離線提示亮起。settle＝再快轉 30 秒，讓 supabase-js
 *  的 refresh 退避走完、背景的資料請求放棄——模擬「在健身房待了一陣子」。 */
async function bootOffline(page: Page, authMode: AuthMode, settle = false) {
  await page.clock.install()
  await seedFetchStub(page, FIX, TODAY, USER_ID, { authMode })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // 先等 App 掛載：計時器在掛載後才註冊，時鐘若先跳走，它就從跳完的那刻才開始算
  await expect(page.locator('.notice .muted')).toHaveText('載入中…')
  await page.clock.runFor(FAST_BOOT_MS + 500)
  await expect(page.locator('.notice .headline')).toHaveText('讀不到你的資料')
  if (settle) {
    await page.clock.runFor(30_000)
    // 背景請求放棄之後，離線提示不可以被較不精準的訊息蓋掉：還是那段診斷、還是「重新載入」鈕
    // （蓋掉的話會變成 friendlyError 的原文加「重試」，而「重試」在 60 秒冷卻內只會拿到同一個失敗）
    await expect(page.locator('.notice'), '背景請求放棄後離線提示被蓋掉了').toContainText('Resume')
    await expect(page.locator('.notice .action-btn')).toHaveText('重新載入')
  }
}

/** 後端恢復後等主數字出現（資料真的落地），並確認離線提示已經消失。 */
async function waitRecovered(page: Page) {
  for (let i = 0; i < 120 && (await page.locator('.gauge-num').count()) === 0; i++) {
    await page.clock.runFor(1000)
  }
  await expect(page.locator('.gauge-num'), '後端恢復後資料沒有落地').toHaveCount(1)
  await expect(page.locator('.notice'), '資料回來了，離線提示卻還在').toHaveCount(0)
}

test('後端連不上（本機有 session）：2 秒內進外殼並亮離線提示，不落到登入頁、不再說「連不上後端」', async ({ page }) => {
  await page.clock.install()
  await seedFetchStub(page, FIX, TODAY, USER_ID, { authMode: 'down' })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.notice .muted'), '開機第一眼應是「載入中…」').toHaveText('載入中…')

  /* 快速路徑的下界：門檻若被改成 0，只驗「2.5 秒後進了外殼」抓不到，所以先量 1 秒時還在開機畫面。
     餘裕留 1 秒不是 0.5：page.clock 裝了之後時間仍會自然流動（實測 1.5 秒的真實等待漂移約
     1.5 秒），workers: 2 的負載下斷言晚到幾百毫秒是常態。 */
  await page.clock.runFor(FAST_BOOT_MS - 1000)
  await expect(page.locator('.notice .muted'), '不到 2 秒就進外殼了').toHaveText('載入中…')
  await page.clock.runFor(1500)

  await expect(page.locator('.notice .headline')).toHaveText('讀不到你的資料')
  // 兩種原因都要講（離線與專案被閒置暫停從這裡看起來一樣），網路排前面——v2.48 寫「Resume」是兩次真事故換來的
  await expect(page.locator('.notice'), '離線提示沒先講確認網路').toContainText('先確認 Wi-Fi')
  await expect(page.locator('.notice'), '專案被閒置暫停的診斷提示不見了（v2.48）').toContainText('Resume')
  await expect(page.locator('#view-app'), '沒有進外殼').toHaveCount(1)
  check((await page.locator('#view-login').count()) === 0, '離線被當成沒登入，落到了登入頁')
  // 重新載入有用的前提：retryable 錯誤不清 session，reload 之後還能拿同一顆 refresh token 再試
  check(await authKeyPresent(page), '離線時 session 被清掉了，重新載入也救不回來')

  const blocked = await page.evaluate(() => (window as unknown as { __blocked: string[] }).__blocked)
  check(
    blocked.some((u) => u.includes('/auth/v1/token')),
    `前置條件不成立：根本沒打過 refresh（${JSON.stringify(blocked)}），測試沒走到要驗的路徑`,
  )

  // 鈕真的會重載：點了之後回到開機第一眼
  await page.click('.notice .action-btn')
  await expect(page.locator('.notice .muted'), '按「重新載入」後沒有回到開機畫面').toHaveText('載入中…')
})

test('後端連上了卻永不回應（本機有 session）：同樣 2 秒進外殼，不會卡在慢態', async ({ page }) => {
  await bootOffline(page, 'hang')
  // fetch 永不 reject，getSession 永不 settle——靠本機 session 進來，之後一直停在離線提示、不跳登入頁
  await page.clock.runFor(120_000)
  await expect(page.locator('.notice .headline')).toHaveText('讀不到你的資料')
  check((await page.locator('#view-login').count()) === 0, '永不回應被當成沒登入，落到了登入頁')
  await expect(page.locator('.notice'), '慢態文案不該出現（有本機 session 時走不到）').not.toContainText('比平常慢')
  await must(page, '.notice .action-btn', '重新載入鈕（standalone PWA 沒有網址列，沒有這顆就只能強制關閉）')

  await page.click('.notice .action-btn')
  await expect(page.locator('.notice .muted')).toHaveText('載入中…')
})

test('離線提示亮著、背景請求還在飛時後端恢復：自己接手，不必重新載入', async ({ page }) => {
  await bootOffline(page, 'down')
  await setAuthMode(page, 'ok')
  // supabase-js 的 refresh 退避還沒走完，下一次重試成功就放行被擋住的請求，資料自己落地
  await waitRecovered(page)

  // TOKEN_REFRESHED 來的時候請求還在飛：不可以當場又撈一次（不然每次恢復都多一輪重複請求）
  const profileRequests = await page.evaluate(
    () => (window as unknown as { __allFetches: string[] }).__allFetches.filter((u) => u.includes('/rest/v1/profile')).length,
  )
  expect(profileRequests, '請求還在飛時 TOKEN_REFRESHED 又重撈了一次').toBe(1)

  // 恢復之後就是正常使用：離線優先的旗標要歸零，之後的 online 事件不可以再把畫面重載
  await page.evaluate(() => {
    ;(window as unknown as { __mark: number }).__mark = 1
    window.dispatchEvent(new Event('online'))
  })
  await page.waitForTimeout(500)
  expect(
    await page.evaluate(() => (window as unknown as { __mark?: number }).__mark),
    '資料已恢復，離線優先的旗標沒有歸零，online 事件又把畫面重載了',
  ).toBe(1)
})

test('離線提示亮著、恢復落在請求逾時之後但 refresh 退避還沒走完（約 10–26 秒）：仍要自己接手', async ({ page }) => {
  await bootOffline(page, 'down')
  /* 背景請求在建構當下就掛了 8 秒的 AbortSignal.timeout（約 2 秒起算、10 秒到期），而 supabase-js 的
     refresh 退避還沒走完（約 12.6 秒有下一次重試）。在兩者之間恢復：重試成功時請求早就被作廢，
     但它們還「在飛」。v2.51 第一版的 TOKEN_REFRESHED 會因為請求還在飛而不重撈，請求隨後以
     TimeoutError 失敗，畫面卡死在離線提示（review 抓到；2.5 秒就恢復的那條測試落在窗口內，抓不到）。 */
  await page.clock.runFor(9_000)
  await setAuthMode(page, 'ok')
  await waitRecovered(page)
})

test('離線提示亮著、背景請求已放棄後後端恢復：靠 TOKEN_REFRESHED 重撈接手', async ({ page }) => {
  await bootOffline(page, 'down', true)
  await setAuthMode(page, 'ok')
  /* supabase-js 對同一顆 refresh token 的失敗有 60 秒冷卻，之後 auto-refresh 的 tick（每 30 秒）
     才會真的重試並發 TOKEN_REFRESHED；請求已經放棄，所以要 App 收到事件後自己重撈。 */
  await waitRecovered(page)
})

test('離線提示亮著時收到 online 事件：自動重新載入；沒有離線提示時不亂重載', async ({ page }) => {
  await bootOffline(page, 'down', true)
  const mark = () => page.evaluate(() => (window as unknown as { __mark?: number }).__mark)
  await page.evaluate(() => {
    ;(window as unknown as { __mark: number }).__mark = 1
    window.dispatchEvent(new Event('online'))
  })
  // 重載後 window 是全新的，標記會消失，且畫面回到開機第一眼
  await expect(page.locator('.notice .muted'), 'online 事件後沒有重新載入').toHaveText('載入中…')
  expect(await mark(), '頁面沒有真的重載（標記還在）').toBeUndefined()
})

test('token 有效但資料請求連不上：亮「重試」提示；網路回來（online 事件）原地自動重撈，不重載頁面、不必按鈕', async ({ page }) => {
  // 真機回報（2026-10-13，一小時內再開）：這條不走離線優先，原本只能手動按「重試」
  await page.clock.install()
  await seedFetchStub(page, FIX, TODAY, USER_ID, { dataDown: true })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.notice .muted')).toHaveText('載入中…')
  // postgrest-js 對 GET 的網路錯誤退避重試 1＋2＋4 秒才放棄。要分段快轉：一口氣跳的話，每一段退避的
  // 續行（promise）要等這次 tick 結束才跑，下一段計時器根本還沒排進去（waitRecovered 同理）
  for (let i = 0; i < 30 && (await page.locator('.notice .headline').count()) === 0; i++) {
    await page.clock.runFor(1000)
  }
  await expect(page.locator('.notice .headline')).toHaveText('讀不到你的資料')
  await expect(page.locator('.notice .action-btn'), '這條不是離線優先路徑，按鈕應是「重試」').toHaveText('重試')
  await expect(page.locator('.notice'), '不該出現離線優先那段診斷').not.toContainText('Resume')

  await page.evaluate(() => {
    const w = window as unknown as { __dataDown: boolean; __mark: number }
    w.__dataDown = false // 網路回來
    w.__mark = 1
    window.dispatchEvent(new Event('online'))
  })
  await waitRecovered(page)
  expect(
    await page.evaluate(() => (window as unknown as { __mark?: number }).__mark),
    '被整頁重載了（標記不見）：這條該原地重撈',
  ).toBe(1)

  // 恢復之後旗標要歸零：之後的 online 事件不可再撈（否則每次網路抖動都白打一輪）
  const settled = (await intakeCalls(page)).length
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.clock.runFor(1000)
  expect((await intakeCalls(page)).length, '已經恢復了，online 事件卻又重撈一次').toBe(settled)
})

test('資料載入沒有失敗時收到 online 事件：不重撈', async ({ page }) => {
  await openApp(page)
  const before = (await intakeCalls(page)).length
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(500)
  expect((await intakeCalls(page)).length, '沒有失敗的載入卻被 online 事件重撈了').toBe(before)
})

test('正常使用中收到 online 事件：不重新載入（只有離線提示亮著才接手）', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => {
    ;(window as unknown as { __mark: number }).__mark = 1
    window.dispatchEvent(new Event('online'))
  })
  await page.waitForTimeout(500)
  expect(
    await page.evaluate(() => (window as unknown as { __mark?: number }).__mark),
    '沒有離線提示卻被 online 事件重新載入了',
  ).toBe(1)
})

test('後端恢復但 refresh token 已被撤銷：進登入頁並說明登入過期', async ({ page }) => {
  await bootOffline(page, 'down', true)
  await setAuthMode(page, 'revoked')
  for (let i = 0; i < 120 && (await page.locator('#view-login').count()) === 0; i++) {
    await page.clock.runFor(1000)
  }
  await expect(page.locator('#view-login'), '撤銷後沒有進登入頁').toHaveCount(1)
  await expect(page.locator('.err')).toContainText('登入已過期')
})

test('主動登出：回到登入頁且不說「登入已過期」（AC 13：主動與被動分流）', async ({ page }) => {
  await openApp(page)
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.settings .signout').click()
  await expect(page.locator('#view-login'), '登出後沒有回到登入頁').toHaveCount(1)
  await expect(page.locator('.err'), '自己按的登出被告知「登入已過期」').toHaveCount(0)
})

/* 退路：本機那份 session 的格式 parseStoredSession 認不得（這裡用「缺 user 欄位」造）時，App
   退回原本的 getSession() 開機流程，由 supabase-js 自己判斷。v2.48 的兩個開機畫面（慢態／
   連不上後端）現在只有這條走得到，由下面兩條守著——它們是「格式認不得」的安全網，不是常態路徑。
   （順帶一個實測發現：OAuth 回跳時網路失敗，supabase-js 的 getSession 不回報初始化階段的錯，
   只回 session: null，所以人會直接落到登入頁、沒有任何說明。這不在本輪範圍，記在 active.md。） */

test('本機 session 格式認不得、後端連不上：退回原開機流程，停在可重載的「連不上後端」', async ({ page }) => {
  await page.clock.install()
  await seedFetchStub(page, FIX, TODAY, USER_ID, { authMode: 'down', unparseableSession: true })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.notice .muted'), '開機第一眼應是「載入中…」').toHaveText('載入中…')

  // 看門狗的下界：門檻若被改成 0.5 秒，只驗「5.5 秒後有換字」抓不到，所以先量 4 秒時還沒換
  await page.clock.runFor(4000)
  await expect(page.locator('.notice .muted'), '不到 5 秒就換字了').toHaveText('載入中…')
  await page.clock.runFor(1500)
  await expect(page.locator('.notice .muted'), '等過 5 秒畫面仍是「載入中…」').toContainText('比平常慢')
  await must(page, '.notice .action-btn', '慢態的重新載入鈕')

  await page.clock.runFor(30_000)
  await expect(page.locator('.notice .headline')).toHaveText('連不上後端')
  check((await page.locator('#view-login').count()) === 0, '連不上後端被當成沒登入，落到了登入頁')
  check(await authKeyPresent(page), '連不上後端時 session 被清掉了，重新載入也救不回來')
})

test('本機 session 格式認不得、後端連上了卻永不回應：慢態有出口', async ({ page }) => {
  await page.clock.install()
  await seedFetchStub(page, FIX, TODAY, USER_ID, { authMode: 'hang', unparseableSession: true })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.notice .muted')).toHaveText('載入中…')
  await page.clock.runFor(120_000)

  // 這個形態下 getSession 永遠不 settle，bootStatus 到不了 unreachable——畫面停在慢態
  await expect(page.locator('.notice .muted')).toContainText('比平常慢')
  check((await page.locator('.notice .headline').count()) === 0, '永不回應的情境不該出現「連不上後端」headline')
  await must(page, '.notice .action-btn', '慢態的重新載入鈕（standalone PWA 沒有網址列，沒有這顆就只能強制關閉）')
})

/* 全站精緻度 B1a：飲食頁底部列脫離版面流、浮在時間軸上，霧化帶蓋在它底下。三個會靜默壞掉的地方：
   ①容器或霧化帶攔截了點擊／捲動 ②兩顆鈕自己反而點不到（容器 none、子元素忘了 auto）
   ③時間軸沒替底部列留位置，捲到底最後一列被蓋住。視覺（blur 有沒有糊）headless 看不出，只能真機。 */
test('飲食頁底部列浮起：霧化帶與空白不攔截，兩顆鈕點得到，捲到底不被蓋住', async ({ page }) => {
  await openApp(page)
  const r = await page.evaluate(() => {
    const hit = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)
      return { inBar: !!el?.closest('.bottom-bar'), inFog: !!el?.closest('.fog'), tab: !!el?.closest('.tab'), cta: !!el?.closest('.cta') }
    }
    const center = (sel: string) => {
      const b = document.querySelector(sel)!.getBoundingClientRect()
      return [b.x + b.width / 2, b.y + b.height / 2] as const
    }
    const bar = document.querySelector('.bottom-bar')!.getBoundingClientRect()
    const tabbar = document.querySelector('.tabbar')!.getBoundingClientRect()
    const cta = document.querySelector('.cta')!.getBoundingClientRect()
    // 時間軸塞一段高內容並捲到底：最後一個孩子的下緣必須在底部列上緣之上
    const tl = document.querySelector('.timeline') as HTMLElement
    const spacer = document.createElement('div')
    spacer.style.height = '900px'
    tl.appendChild(spacer)
    tl.scrollTop = tl.scrollHeight
    return {
      isFloating: getComputedStyle(document.querySelector('.bottom-bar')!).position === 'absolute',
      gap: hit((tabbar.right + cta.left) / 2, bar.top + bar.height / 2),
      inFog: hit(196, bar.top - 40),
      tab: hit(...center('.tab[aria-label="設定"]')),
      cta: hit(...center('.cta')),
      spacerBottom: spacer.getBoundingClientRect().bottom,
      barTop: bar.top,
    }
  })
  check(r.isFloating, '飲食頁的底部列應該是浮起（absolute）的')
  check(!r.gap.inBar && !r.gap.inFog, `兩顆鈕之間的空白攔截了點擊：${JSON.stringify(r.gap)}`)
  check(!r.inFog.inBar && !r.inFog.inFog, `霧化帶攔截了點擊：${JSON.stringify(r.inFog)}`)
  check(r.tab.tab, `設定分頁的中心點不是分頁鈕（被別的東西蓋住）：${JSON.stringify(r.tab)}`)
  check(r.cta.cta, `記一筆 CTA 的中心點不是 CTA（被別的東西蓋住）：${JSON.stringify(r.cta)}`)
  check(r.spacerBottom <= r.barTop + 1, `捲到底後內容下緣 ${r.spacerBottom} 超過底部列上緣 ${r.barTop}，最後一列會被蓋住`)

  // 訓練分頁各自批次再改，底部列仍在版面流裡
  await page.locator('.tab[aria-label="訓練"]').click()
  await page.waitForSelector('[data-screen="training"]')
  const training = await page.evaluate(() => ({
    position: getComputedStyle(document.querySelector('.bottom-bar')!).position,
    fog: document.querySelectorAll('.fog').length,
  }))
  check(training.position !== 'absolute' && training.fog === 0, `訓練分頁不該套浮起與霧化：${JSON.stringify(training)}`)
})

/* review 抓到（B1a）：展開最後一列時，`scrollIntoView({ block: 'nearest' })` 對齊的是捲動區的邊緣，
   `padding-bottom` 不算進去——編輯區下緣會落在底部列底下，右側的刪除鈕剛好在 CTA 底下。
   修法是時間軸的 `scroll-padding-bottom`。不縮視窗：編輯區約 322px，393×745 的時間軸扣掉底部列還剩約 360px 放得下；
   視窗再矮，編輯區本身就大過可見範圍，量出來的是別的事。展開後內容才溢出，所以 scrollIntoView 會被觸發。 */
test('飲食頁展開最後一列：編輯區捲到浮起的底部列之上，不被蓋住', async ({ page }) => {
  await openApp(page)
  const last = page.locator('.timeline .item-row').last()
  await last.locator('.item-content').click()
  await expect(last.locator('.item-editor')).toBeVisible()
  // 展開動畫跑完才捲（smooth），所以輪詢到捲動落定；沒修好的話這個值會一直停在正數
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const rows = document.querySelectorAll('.timeline .item-row')
          const editor = rows[rows.length - 1].querySelector('.item-editor')!.getBoundingClientRect()
          return Math.round(editor.bottom - document.querySelector('.bottom-bar')!.getBoundingClientRect().top)
        }),
      { timeout: 3000, message: '編輯區下緣一直落在底部列上緣之下（被蓋住）' },
    )
    .toBeLessThanOrEqual(1)
})

/* review 抓到（B1b）：SpringSheet 的關閉是 spring、約 1.1 秒才卸載，這段時間 scrim 還鋪滿全螢幕，
   按「加入」之後馬上點別的東西會被它吃掉（vaul 是 280ms）。用 mouse.click 的座標點，不用 locator.click——
   後者會等「點得到」才出手，剛好把這個問題遮住。 */
test('記一筆送出後，sheet 還在收的時候點分頁鈕：點擊不會被 scrim 吃掉', async ({ page }) => {
  await openApp(page)
  await page.click('button.cta')
  await page.waitForSelector('.food-row')
  await page.waitForTimeout(800)
  await page.locator('.food-row').first().click()
  await page.waitForSelector('.pick-bar')
  const tab = (await page.locator('.tab[aria-label="設定"]').boundingBox())!
  await page.click('.pick-bar-btn')
  await page.waitForTimeout(300) // sheet 才收到一半，DOM 還在
  await page.mouse.click(tab.x + tab.width / 2, tab.y + tab.height / 2)
  await expect(page.locator('[data-screen="settings"]'), '收合中的點擊被 scrim 吃掉了').toBeVisible({ timeout: 1500 })
})
