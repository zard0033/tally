/* 左滑互動的獨立路徑。每個 test 自己 openApp()，狀態互不影響，單獨跑得動：
     npx playwright test interaction -g "關鍵字"
   要探路（量而不是猜）時，在這裡寫一個暫時的 test 印 rowState() 就好，跑一條約 3 秒。
   這整個檔案的存在理由：拖曳／動畫這種要反覆試的東西，在 tally.spec.ts 那串累積狀態的
   15 條路徑裡除錯，一輪 20 秒起跳，而且斷言會建在上一條留下的狀態上。 */
import { test } from '@playwright/test'
import { FIX, YDAY } from './fixtures'
import { check, deleteViaTap, grabPoint, leg, openApp, rowState, slowDrag, waitCount } from './harness'

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

  await page.click('button[aria-label="前一天"]')
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

  await page.click('button[aria-label="前一天"]')
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

  await page.click('button[aria-label="後一天"]')
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

  await page.click('button[aria-label="前一天"]')
  await page.waitForTimeout(500) // 換日期要等 fetch 落地才有東西可切回去，這裡沒有立即斷言
  await page.click('button[aria-label="後一天"]')

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

  await page.locator('.tabbar .tab').nth(1).click()
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

  await page.click('button[aria-label="前一天"]')
  await page.waitForTimeout(500) // 前一天可能命中快取也可能沒有，等它穩定（含它自己觸發的背景預取）
  await page.click('button[aria-label="後一天"]')
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
  await page.click('button[aria-label="前一天"]')
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

  await page.click('button[aria-label="後一天"]') // 切回今天：應該命中快取
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

  await page.click('button[aria-label="前一天"]')
  await page.waitForTimeout(500) // 讓今天的快取穩定（此時待刪仍在 5 秒窗內，還沒真的送出 DELETE）
  await page.click('button[aria-label="後一天"]') // 切回今天：這次要走快取命中路徑，不是 loadDay 的 fetch 路徑

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

  await page.click('button[aria-label="前一天"]') // 命中快取，瞬間
  await page.waitForTimeout(300)
  await page.click('button[aria-label="前一天"]') // 前兩天沒有快取 → 開始 1.5s 的慢 fetch
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
