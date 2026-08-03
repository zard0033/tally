/* UI 回歸：React 版走同一份路徑清單，移植自 legacy vanilla harness
   （C:\Users\Administrator\.claude\tools\tally-verify\verify.mjs）。

   紀律（跟 legacy 一致，違反就等於沒驗）：
   1. 互動一律走真實輸入裝置路徑——click / pressSequentially / keyboard。
      禁用 evaluate 內的 el.click() 與 dispatchEvent。
   2. 打字用 pressSequentially（逐鍵）不用 fill。
   3. 每個 step 自己 try/catch，fail 了繼續跑下一條，一輪拿到全部問題，
      不是撞一個修一個再跑一輪——用 test.step 包，內部吞例外自己記錄，
      最後才用 expect(fails).toEqual([]) 統一失敗，而不是讓第一個 throw 就把後面全部標成 skipped。

   10 條路徑全部在同一個瀏覽器 session 裡跑（跟 legacy 一樣是累積狀態：開 sheet → 選食物 →
   調份量 → 送出，後面的路徑假設前面的狀態還在），所以是一個 test()、十個 test.step()，
   不是十個獨立 test()。

   selector 對照 legacy → React（DOM 結構鏡像但沒有 id／data-* 屬性，逐一對過實際 DOM 才定案，
   詳細對照與裁決記在委派回報，不重複寫在這裡）。 */
import { test, expect } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import {
  check, closeFirstRow, deleteViaTap, grabPoint, leg, must, mustText, numFrom, openApp, slowDrag,
} from './harness'

const SHOTS_DIR = 'e2e/shots'

interface Fail {
  step: string
  msg: string
}

test('Tally UI 回歸', async ({ page }) => {
  const fails: Fail[] = []
  let ran = 0
  const pageErrs: string[] = []
  const consoleErrs: string[] = []
  page.on('pageerror', (e) => pageErrs.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrs.push(m.text())
  })

  await rm(SHOTS_DIR, { recursive: true, force: true })
  await mkdir(SHOTS_DIR, { recursive: true })

  await openApp(page)

  async function step(name: string, run: () => Promise<void>) {
    ran++
    const errMark = pageErrs.length
    await test.step(name, async () => {
      try {
        await run()
        const fresh = pageErrs.slice(errMark)
        if (fresh.length) throw new Error(`頁面噴出未捕捉例外：${fresh.join(' / ')}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        fails.push({ step: name, msg })
        await page.screenshot({ path: `${SHOTS_DIR}/fail-${fails.length}.png` }).catch(() => {})
        // 不 re-throw：讓後面的路徑繼續跑，一輪拿到全部問題（legacy 的核心紀律）
      }
    })
  }

  await step('今日頁載入 — 骨架契約與目標數字', async () => {
    // React 版 Today 只在 ready（profile／weight／targets 都到齊）才掛載，跟 legacy 的
    // 「骨架先渲染、資料非同步補上」不同架構——#view-app 出現不代表 Today 已掛載，
    // 得先等真正的內容節點出現，不能假設骨架元素在 fetch 完成前就存在。
    await page.waitForSelector('.gauge-num', { timeout: 5000 })
    for (const [sel, label] of [
      ['.gauge-num', '主數字'],
      ['.gauge-lead', '主數字標籤'],
      ['.gauge .bar .fill', '熱量條'],
      ['.macros .macro:nth-child(1) .fill', '蛋白質條'],
      ['.macros .macro:nth-child(2) .fill', '脂肪條'],
      ['.macros .macro:nth-child(3) .fill', '碳水條'],
      ['.timeline', '時間軸'],
      ['button.cta', '記一筆'],
      ['.tabbar .tab', '分頁按鈕'],
    ] as const) {
      await must(page, sel, label)
    }
    check((await page.locator('.tabbar .tab').count()) === 2, '分頁按鈕數：預期 2（日記／設定）')
    // v2.3：CTA 已無文字，改驗 aria-label
    check(
      (await page.locator('button.cta').getAttribute('aria-label')) === '記一筆',
      'CTA 的 aria-label 應為「記一筆」',
    )

    // 目標熱量不硬編（app 自己算），只驗畫面三個數字彼此自洽
    const cur = await numFrom(page, '.gauge-side .cur')
    const tgt = await numFrom(page, '.gauge-side .tgt')
    const lead = await numFrom(page, '.gauge-num')
    check(cur === 540, `已吃：預期 540（120+420），實際 ${cur}——sumIntake 沒把兩筆加對`)
    check(lead === tgt - cur, `主數字與「目標 − 已吃」對不上：${lead} ≠ ${tgt} − ${cur}`)
    const itemCount = await page.locator('.timeline .item').count()
    check(itemCount === 2, `時間軸品項數：預期 2，實際 ${itemCount}`)
  })

  await step('開 sheet — 進場契約', async () => {
    await page.click('button.cta')
    await page.waitForSelector('.sheet', { timeout: 3000 })
    for (const [sel, label] of [
      ['.chip-bar', 'chip 列'],
      ['.chiprow .chip', '餐別 chip'],
      ['input[aria-label="搜尋食物"]', '搜尋框'],
      ['.food-scroll', '清單捲動區'],
      ['button[aria-label="關閉"]', '關閉鈕'],
    ] as const) {
      await must(page, sel, label)
    }
    await page.waitForSelector('.food-row', { timeout: 3000 })
    // 清單屏不該有 .sheet-title（對齊 legacy v1.10 拿掉標題的決策；precommit review 抓到的
    // TypeError 就是某次改動把它加回去、chip 分支假設反轉造成的——這裡繼續守著這條契約）
    check(
      (await page.locator('.sheet .sheet-title').count()) === 0,
      '清單屏不該有 .sheet-title（v1.10 已移除；它回來會讓 chip 分支的假設反轉）',
    )
  })

  await step('切餐別 chip — precommit 抓到的 TypeError 路徑的等效驗證', async () => {
    // legacy 這條驗的是「chip 分支去改 .sheet-title、清單屏沒有它 → null.textContent
    // 炸例外」；React 版 chip 的 onClick 只呼叫 setMeal，沒有直接操作 DOM 的分支，
    // 這個特定的 bug class 在架構上不會發生了。保留這條路徑的價值在於「每顆 chip 都要點過」
    // 這個一般性原則本身——precommit review 那次教訓正是「用真實點擊驗過」但沒點過 chip，
    // 未捕捉例外的偵測交給 runner 層（每個 step 結束比對 pageErrs），這裡繼續全部點過。
    const chips = page.locator('.chiprow .chip')
    const n = await chips.count()
    check(n === 4, `餐別 chip 數：預期 4，實際 ${n}`)
    for (let i = 0; i < n; i++) {
      const chip = chips.nth(i)
      const label = (await chip.textContent()) ?? `#${i}`
      await chip.click()
      await page.waitForTimeout(120)
      check(
        (await chip.getAttribute('aria-current')) === 'true',
        `點了「${label}」後該 chip 沒有 aria-current="true"`,
      )
      check((await page.locator('.food-scroll').count()) === 1, `點「${label}」後清單捲動區消失`)
    }
  })

  await step('搜尋框逐鍵輸入 — 焦點與值不被重繪吃掉', async () => {
    const q = page.locator('input[aria-label="搜尋食物"]')
    await q.click()
    await q.pressSequentially('雞胸', { delay: 60 })
    await page.waitForTimeout(200)
    check((await q.inputValue()) === '雞胸', `搜尋框值：預期「雞胸」，實際「${await q.inputValue()}」`)
    check(
      await q.evaluate((el) => el === document.activeElement),
      '打完字後搜尋框失去焦點',
    )
    const rowCount = await page.locator('.food-row').count()
    check(rowCount >= 2, `搜尋「雞胸」預期至少 2 筆結果，實際 ${rowCount}`)
    await must(page, '.add-food-row', '新增食物入口（有輸入就該常駐清單末尾）')
  })

  await step('選食物 — 確認列長出來、數字對', async () => {
    await page.locator('.food-row').first().click()
    await page.waitForSelector('.pick-bar', { timeout: 2000 })
    await must(page, '.pick-bar .sub', '確認列小計')
    await must(page, '.pick-bar .remain', '確認列剩餘')
    await must(page, '.pick-bar-btn', '加入鈕')
    await mustText(page, '.pick-bar .sub', '1 樣', '小計樣數')
    check((await page.locator('.food-item.selected').count()) === 1, '選中的品項沒有 .selected')
  })

  await step('加減鈕 — 減到 1 停用、確認列跟著動', async () => {
    const minus = page.locator('.qty-btn').nth(0)
    const plus = page.locator('.qty-btn').nth(1)
    check(await minus.isDisabled(), '份量 1 時減號應停用（不留「按了沒事」的死路）')
    await plus.click()
    await page.waitForTimeout(120)
    check(!(await minus.isDisabled()), '份量加到 2 後減號仍停用')
    const input = page.locator('.qty-value')
    check((await input.inputValue()) === '2', `份量：預期 2，實際 ${await input.inputValue()}`)
    await minus.click()
    await page.waitForTimeout(120)
    check(await minus.isDisabled(), '減回 1 後減號沒有重新停用')
  })

  await step('填份量後直接按加入 — 失焦重繪咬 click 的坑', async () => {
    // 這條防的是 legacy app.js:1012-1017 那個坑：輸入框失焦觸發重繪 → mousedown 目標離開
    // DOM → click 不派送。React 版靠 keyed 渲染天然不會整塊換 DOM（LogSheet.tsx 檔頭註記），
    // 但這是「架構上應該沒事」不等於「驗過沒事」——順序照舊不能改：有焦點狀態下直接點加入，
    // 中間不插 blur、不插 waitForTimeout 以外的東西。
    const input = page.locator('.qty-value')
    await input.click()
    await input.press('Control+a')
    await input.pressSequentially('3', { delay: 60 })
    await page.click('.pick-bar-btn') // 不先失焦，直接點
    await page.waitForTimeout(600)
    const writes = (await page.evaluate(() => (window as unknown as { __writes: { path: string; method: string; body: unknown }[] }).__writes)) ?? []
    const posted = writes.filter((w) => w.path.startsWith('intake') && w.method === 'POST')
    check(
      posted.length === 1,
      `按「加入」沒有送出 intake（__writes 裡 POST intake 有 ${posted.length} 筆）——這正是「失焦重繪咬掉 click」的表現`,
    )
    const body = posted[0]?.body as { qty?: number }[] | undefined
    check(
      body?.[0]?.qty === 3,
      `送出的份量：預期 3，實際 ${JSON.stringify(body?.[0]?.qty)}（打字途中不正規化、失焦才做——值錯表示 normalizeQty 時機跑掉了）`,
    )
    check((await page.locator('.sheet').count()) === 0, '送出成功後 sheet 應該關閉')
  })

  /* v2.20：點擊的語意從「露出刪除鈕」換成「展開就地編輯區」，所以這一步鎖的是
     is-edit 而不是 is-open。**「自動關其他列」這條不變**——兩種活躍狀態共用同一顆
     單值 active state，互斥仍然是它的自然結果，不靠任何 closeOthers 邏輯。
     左滑露出刪除鈕那條手勢路徑沒有改動，覆蓋在 inline-edit.spec.ts 與下方的水平溢位斷言。 */
  await step('點擊品項 — 展開就地編輯與自動收合其他列（v2.20）', async () => {
    await page.waitForSelector('.timeline .item-row', { timeout: 3000 })
    const rows = page.locator('.timeline .item-row')
    const rowCount = await rows.count()
    check(rowCount >= 2, `時間軸品項不足 2 筆（實際 ${rowCount}），測不了「自動關其他列」`)
    const items = page.locator('.timeline .item-content')
    check((await items.count()) >= 2, '時間軸可點品項不足 2 個')
    const [a, b] = [rows.nth(0), rows.nth(1)]
    await items.nth(0).click()
    await page.waitForTimeout(300)
    check((await a.evaluate((el) => el.classList.contains('is-edit'))), '點第一列後沒有 .is-edit，編輯區沒展開')
    check(
      (await a.locator('.item-editor .qty-stepper').count()) === 1,
      '編輯區展開了卻沒有份量 stepper',
    )
    check(
      (await a.locator('.item-editor .seg button').count()) === 4,
      '編輯區的餐別分段控制器應該有四格',
    )
    await items.nth(1).click()
    await page.waitForTimeout(300)
    check(
      !(await a.evaluate((el) => el.classList.contains('is-edit'))),
      '開第二列後第一列沒有自動收合（單值 active state 沒生效）',
    )
    check((await b.evaluate((el) => el.classList.contains('is-edit'))), '第二列點了卻沒展開編輯區')
    // 滑開時 .item-slide 的內容會超出列寬，會計入祖先的 scrollable overflow；
    // .timeline 因 overflow-y:auto 使另一軸算成 auto，沒裁切就變成整條時間軸可橫向拖動
    // （捲軸被 scrollbar-width:none 藏起來，使用者只會看到版面莫名滑走）。
    const overflowX = await page.locator('.timeline').evaluate((el) => el.scrollWidth - el.clientWidth)
    check(overflowX === 0, `時間軸有 ${overflowX}px 水平溢位——刪除鈕收起時停在列外沒被裁切`)
  })

  await step('刪除的 undo 窗 — 樂觀移除、復原把那一列放回去（v2.1）', async () => {
    const before = await page.locator('.timeline .item').count()
    check(before >= 2, `時間軸品項不足 2 筆（實際 ${before}），測不了刪除與復原`)
    const firstName = ((await page.locator('.timeline .item .nm').first().textContent()) ?? '').trim()

    // 第二列此時編輯區是展開的（上一條路徑點開的），裡面的刪除鈕已可點
    await page.locator('.timeline .item-editor .ed-del').click()
    // ponytail: fixture 每餐只有一筆，刪掉等於整個 <ul> 隨餐次轉「待記錄」一起卸載，
    // AnimatePresence 的退場動畫其實不會跑（DOM 20ms 內就移除）。這個等待只是保險。
    // 要真的覆蓋退場動畫，fixture 得有某一餐兩筆以上——留給下次擴 fixture 時一起做。
    await page.waitForTimeout(400)
    const afterDelete = await page.locator('.timeline .item').count()
    check(afterDelete === before - 1, `刪除後品項數應為 ${before - 1}，實際 ${afterDelete}`)
    await must(page, '.undo-bar', '復原提示條')
    await mustText(page, '.undo-bar', '已刪除', '復原提示條文案')
    /* 焦點必須接到「復原」鈕上。被刪那列連同刪除鈕一起離開 DOM，焦點會掉回 body，
       鍵盤使用者等於要在 5 秒內盲摸 Tab。第一版的轉移寫在 undoOpen 轉 true 的當下、
       那時該鈕還在退場動畫裡沒卸載，判斷式永遠不成立——這條斷言就是鎖那個時機。 */
    await page.waitForTimeout(300)
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? 'NONE')
    check(
      (await page.locator('.undo-bar button:focus').count()) === 1,
      `刪除後焦點沒接到復原鈕，停在 ${focusedTag}`,
    )

    await page.locator('.undo-bar button').click()
    await page.waitForTimeout(300)
    const afterUndo = await page.locator('.timeline .item').count()
    check(afterUndo === before, `復原後品項數應回到 ${before}，實際 ${afterUndo}`)
    check((await page.locator('.undo-bar').count()) === 0, '復原後提示條應該消失')
    const nameAfter = ((await page.locator('.timeline .item .nm').first().textContent()) ?? '').trim()
    check(nameAfter === firstName, `復原後第一列品名變了：原「${firstName}」現「${nameAfter}」`)

    // 復原回來的那一列必須還能再刪一次。v2.1 第一版的 deletingIds 只加不減，
    // 復原後該列的刪除鈕永久 disabled——這條就是為了鎖住那個 bug
    await deleteViaTap(page)
    await page.waitForTimeout(400)
    const afterRedelete = await page.locator('.timeline .item').count()
    check(afterRedelete === before - 1, `復原後再刪一次應剩 ${before - 1} 筆，實際 ${afterRedelete}——那一列刪不掉了`)
    await page.locator('.undo-bar button').click()
    await page.waitForTimeout(300)
  })

  await step('滑到底直接刪除（v2.1）——同時證明底下那條縱向測試不是假通過', async () => {
    const before = await page.locator('.timeline .item').count()
    check(before >= 1, '時間軸沒有品項，測不了滑到底刪除')
    // 純橫向拖過列寬 45%：這一條必須真的刪掉。它同時是下一條（縱向不可誤刪）的對照組——
    // 若拖曳路徑根本沒被觸發，這裡會先失敗，而不是讓下一條在無事發生的情況下綠著
    const start = await grabPoint(page)
    await slowDrag(page, start, leg(start, { x: start.x - 540, y: start.y }, 14))
    await page.waitForTimeout(400)
    const after = await page.locator('.timeline .item').count()
    check(after === before - 1, `滑到底放手應刪掉一筆（${before} → ${before - 1}），實際 ${after}`)
    await must(page, '.undo-bar', '滑到底刪除後的復原提示條')
    await page.locator('.undo-bar button').click()
    await page.waitForTimeout(300)
    check((await page.locator('.timeline .item').count()) === before, '滑到底刪除後復原沒把那一筆放回來')
  })

  await step('縱向捲動帶左偏不可以刪東西（v2.1 回歸鎖）', async () => {
    const before = await page.locator('.timeline .item').count()
    check(before >= 1, '時間軸沒有品項，測不了誤刪')
    // 先往下（觸發 motion 的 dragDirectionLock 鎖在 Y 軸）再大幅左移。
    // 這一列不會有任何位移，但指標的原始 offset.x 照樣累積到刪除門檻以上——
    // 第一版就是拿 offset.x 當門檻，於是畫面毫無變化卻靜默刪掉一筆
    const start = await grabPoint(page)
    const down = { x: start.x, y: start.y + 60 }
    await slowDrag(page, start, [...leg(start, down, 8), ...leg(down, { x: start.x - 540, y: down.y }, 12)])
    await page.waitForTimeout(400)
    const after = await page.locator('.timeline .item').count()
    check(after === before, `縱向拖曳帶左偏後品項從 ${before} 變成 ${after}——被誤判成刪除`)
    check((await page.locator('.undo-bar').count()) === 0, '縱向拖曳不該觸發刪除，卻出現了復原提示條')
  })

  /* 拖曳開合的三條斷言在 interaction.spec.ts（各自獨立、單獨跑得動）。當初以為是
     「拖 70px 沒觸發拖曳」，拆開量了才知道拖曳一直是好的，壞的是放手之後——
     詳見該檔註記。 */

  await step('切分頁時待刪要結清、復原提示條不可殘留（v2.1 回歸鎖）', async () => {
    await closeFirstRow(page)
    await deleteViaTap(page)
    await page.waitForTimeout(400)
    await must(page, '.undo-bar', '刪除後的復原提示條')
    // 提示條掛在 <main> 下、與 Today／Settings 同層，且定位是照今日頁 CTA 高度算的，
    // 不結清的話它會浮在設定頁半空中（precommit review 抓到）
    await page.locator('.tabbar .tab').nth(1).click()
    await page.waitForTimeout(300)
    check((await page.locator('.undo-bar').count()) === 0, '切到設定頁後復原提示條仍殘留')
    await page.locator('.tabbar .tab').nth(0).click()
    await page.waitForTimeout(500)
  })

  await step('日期切換 — 停用態、歷史日語意、回今天焦點', async () => {
    // v2.3：今日頁 h1 就是置中的日期本身（靜態頁名「日記」已拿掉，分頁列已經寫了
    // 「日記」），格式「週X M/D」；今天時同位置不放任何東西（.date-today-label 已刪除）
    const h1TextToday = ((await page.locator('h1.date-title').first().textContent()) ?? '').trim()
    check(
      /^週[一二三四五六日] \d+\/\d+$/.test(h1TextToday),
      `今日頁 h1 應為「週X M/D」格式的日期，實際「${h1TextToday}」`,
    )
    await must(page, 'button[aria-label="前一天"]', '前一天')
    await must(page, 'button[aria-label="後一天"]', '後一天')
    check(await page.locator('button[aria-label="後一天"]').isDisabled(), '今天時「後一天」應停用（看不了未來）')
    check((await page.locator('button.date-today-btn').count()) === 0, '今天時不應出現「回今天」鈕')
    await page.click('button[aria-label="前一天"]')
    await page.waitForTimeout(500)
    check(!(await page.locator('button[aria-label="後一天"]').isDisabled()), '離開今天後「後一天」仍停用')
    await mustText(page, '.gauge-lead', '攝取', '歷史日主數字標籤應為「攝取」不是「還能吃／超出」')
    await must(page, 'button.date-today-btn', '回今天鈕（歷史日應出現）')
    await page.click('button.date-today-btn')
    await page.waitForTimeout(500)
    check((await page.locator('button.date-today-btn').count()) === 0, '點「回今天」後回今天鈕應消失')
    // review 抓到的焦點流失：「回今天」鈕自己會被卸載，焦點要接到 .datectl 容器，
    // 不能掉回 body（掉回 body 代表鍵盤使用者按完之後找不到自己在哪）
    check(
      await page.evaluate(() => document.activeElement?.classList.contains('datectl') ?? false),
      '點「回今天」後焦點沒有接到 .datectl 容器（掉回 body 或別的地方）',
    )
  })

  await step('切設定頁 — 契約與標題', async () => {
    const tabs = page.locator('.tabbar .tab')
    await tabs.nth(1).click() // 設定
    await page.waitForTimeout(400)
    await mustText(page, 'h1.today', '設定', '設定頁標題')
    await must(page, '.settings', '設定面板')
    // React 版 Today／Settings 是互斥條件渲染（App.tsx 只掛載其中一個），不是同時掛載、
    // 用 hidden 屬性藏起來——所以驗證方式跟 legacy 的 isHidden() 不同，改驗「根本不存在」
    check((await page.locator('.datectl').count()) === 0, '設定頁不該存在日期切換列（today 分頁的元件不該掛載在這裡）')
    await tabs.nth(0).click() // 日記
    await page.waitForTimeout(400)
    const h1Text = ((await page.locator('h1.date-title').first().textContent()) ?? '').trim()
    check(/^週[一二三四五六日] \d+\/\d+$/.test(h1Text), `切回日記頁 h1 應為日期格式，實際「${h1Text}」`)
  })

  // 安全紅線：零真實網路請求是可斷言的事實，不是「沒看到報錯就當作沒發生」
  const blocked = await page.evaluate(() => (window as unknown as { __blocked: string[] }).__blocked)
  const allFetches = await page.evaluate(() => (window as unknown as { __allFetches: string[] }).__allFetches)
  const nonStubSupabase = allFetches.filter((u) => u.includes('supabase.co') && !u.includes('/rest/v1/'))

  console.log(`\n${'─'.repeat(60)}`)
  if (consoleErrs.length) {
    console.log(`console 錯誤 ${consoleErrs.length} 筆：`)
    for (const e of consoleErrs.slice(0, 10)) console.log(`  · ${e}`)
  }
  // 實數，不是寫死的字串——原本這行永遠印 10/10，加了路徑也不會變，
  // 等於「全過」這個訊號本身不可信
  console.log(
    fails.length
      ? `FAIL ${fails.length}/${ran}\n` + fails.map((f) => `  · ${f.step}\n    ${f.msg}`).join('\n')
      : `PASS ${ran}/${ran}`,
  )

  expect(blocked, `擋下 ${blocked.length} 筆非 /rest/v1/ 的 Supabase 呼叫：${blocked.join(', ')}`).toEqual([])
  expect(nonStubSupabase, '零真實網路請求斷言：出現了非 stub 網域/路徑的 Supabase 呼叫').toEqual([])
  expect(consoleErrs, `console 有 ${consoleErrs.length} 筆錯誤`).toEqual([])
  expect(fails, fails.map((f) => `${f.step}: ${f.msg}`).join('\n')).toEqual([])
})
