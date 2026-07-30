/* 左滑互動的獨立路徑。每個 test 自己 openApp()，狀態互不影響，單獨跑得動：
     npx playwright test interaction -g "關鍵字"
   要探路（量而不是猜）時，在這裡寫一個暫時的 test 印 rowState() 就好，跑一條約 3 秒。
   這整個檔案的存在理由：拖曳／動畫這種要反覆試的東西，在 tally.spec.ts 那串累積狀態的
   15 條路徑裡除錯，一輪 20 秒起跳，而且斷言會建在上一條留下的狀態上。 */
import { test } from '@playwright/test'
import { check, grabPoint, leg, openApp, rowState, slowDrag } from './harness'

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
