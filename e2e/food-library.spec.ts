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

/* v2.30 語意修正的迴歸鎖：兩顆篩選鈕原本是 role="tab" ＋ aria-current（tab 角色的選中態
   屬性應該是 aria-selected，而完整 tablist 契約這裡沒實作），改成 aria-pressed。
   資料差異仍測不到（見檔頭），但「選中態有沒有正確播報」跟 stub 無關，測得了。 */
test('使用中／已封存兩顆篩選鈕用 aria-pressed 表達選中態，且互斥', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const active = page.locator('.tabrow .chip', { hasText: '使用中' })
  const archived = page.locator('.tabrow .chip', { hasText: '已封存' })

  await expect(active, '預設沒有停在「使用中」').toHaveAttribute('aria-pressed', 'true')
  await expect(archived).toHaveAttribute('aria-pressed', 'false')

  await archived.click()
  await expect(archived, '點了「已封存」但選中態沒跟上').toHaveAttribute('aria-pressed', 'true')
  await expect(active, '兩顆同時是選中態').toHaveAttribute('aria-pressed', 'false')

  // 殘留的 tab 角色會讓讀屏期待方向鍵導航，而這裡沒有實作
  await expect(page.locator('.tabrow [role="tab"]'), '篩選鈕殘留 role="tab"').toHaveCount(0)
  await expect(page.locator('.tabrow[role="tablist"]'), '容器殘留 role="tablist"').toHaveCount(0)
})

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
  await expect(editor.locator('#le-name')).toHaveValue(name)

  await editor.locator('#le-kcal').fill('321')
  await editor.locator('.pick-bar-btn').click()

  await expect.poll(async () => (await foodWrites(page)).length).toBe(1)
  const w = (await foodWrites(page))[0]
  expect(w.method).toBe('PATCH')
  expect(w.body).toMatchObject({ kcal: 321 })
  await expect(first.locator('.lib-edit'), '存完了編輯區沒收起來').toHaveCount(0)
})

/* 迴歸鎖（2026-08-05 使用者真機截圖回報）：全域的 `.pick-bar-btn` 是 `width: 100%` ＋
   `flex-shrink: 0`（給底部確認列用，那裡獨佔一整列不該縮）。同一顆按鈕搬進這個 flex row
   跟 88px 的取消鈕並排時，那兩個宣告合起來變成「我要整個容器的寬度，而且不縮」——
   實測溢出 96px（＝取消鈕 88 ＋ gap 8），右緣被 .lib-group 的 overflow: clip 切掉。
   斷言「不超出容器」而不是「寬度等於某個數字」：後者換個裝置寬度就得改。 */
test('就地編輯的儲存鈕不可以溢出卡片，且與輸入框右緣切齊', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const first = rows(page).first()
  const name = ((await first.locator('.nm').textContent()) ?? '').trim()
  await first.locator(`[aria-label="編輯 ${name}"]`).click()
  await expect(first.locator('.lib-edit')).toBeVisible()

  const geo = await page.evaluate(() => {
    const edit = document.querySelector('.lib-edit')!
    const r = (el: Element) => el.getBoundingClientRect()
    const cs = getComputedStyle(edit)
    const inner = {
      l: r(edit).left + parseFloat(cs.paddingLeft),
      r: r(edit).right - parseFloat(cs.paddingRight),
    }
    return {
      innerL: +inner.l.toFixed(1),
      innerR: +inner.r.toFixed(1),
      saveR: +r(edit.querySelector('.pick-bar-btn')!).right.toFixed(1),
      cancelL: +r(edit.querySelector('.cancel-btn')!).left.toFixed(1),
      inputR: +r(edit.querySelector('#le-kcal')!).right.toFixed(1),
    }
  })

  expect(geo.saveR, '儲存鈕溢出編輯區——.pick-bar-btn 的 flex-shrink: 0 又生效了').toBeLessThanOrEqual(geo.innerR + 0.5)
  expect(geo.cancelL, '取消鈕沒有貼齊左內距').toBeGreaterThanOrEqual(geo.innerL - 0.5)
  // 儲存鈕右緣與整寬輸入框右緣切齊，才是「收在同一個欄位格線裡」
  expect(Math.abs(geo.saveR - geo.inputR), '儲存鈕右緣沒有跟輸入框對齊').toBeLessThanOrEqual(1)
})

/* 迴歸鎖（2026-08-05）：三顆圖示的 44px 觸控盒與 17px 畫布本來就等距、垂直也一致，
   但「範本新增」那顆的**筆畫**畫在 viewBox 偏上的位置（重心 y=8.5，中心應是 12），
   17px 渲染下往上偏約 2.5px，並排時看起來就是沒對齊。量 getBBox 而不是量 svg 元素——
   後者三顆完全相同，正是它讓這個問題在肉眼發現前一直躲過檢查。 */
test('三顆列操作圖示的筆畫重心都落在 viewBox 中央，並排才不會有一顆偏高', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const inks = await page.evaluate(() =>
    [...document.querySelectorAll('.lib-row-main')[0].querySelectorAll('.icon-btn svg')].map((s) => {
      const b = (s as SVGGraphicsElement).getBBox()
      return {
        label: s.parentElement!.getAttribute('aria-label') ?? '',
        cx: +(b.x + b.width / 2).toFixed(2),
        cy: +(b.y + b.height / 2).toFixed(2),
      }
    }),
  )

  expect(inks).toHaveLength(3)
  for (const i of inks) {
    expect(Math.abs(i.cy - 12), `「${i.label}」的筆畫重心 y=${i.cy}，偏離 viewBox 中央 12`).toBeLessThanOrEqual(1)
    expect(Math.abs(i.cx - 12), `「${i.label}」的筆畫重心 x=${i.cx}，偏離 viewBox 中央 12`).toBeLessThanOrEqual(1)
  }
})

/* 迴歸鎖（v2.29 precommit-review 抓到，是 v2.28 自己引入的）：pill 從「封頂半個螢幕」
   放寬成整行之後，長品名會水平覆蓋到右下角的 FAB，而 pill 的 z-index(6) 高於 FAB(5)——
   那 5 秒內想按新增會變成誤觸復原。修法沿用「編輯中隱藏 FAB」同一套語言。
   這條同時鎖住「藏起來」與「事後回得來」，只驗前者的話 FAB 一去不返也不會有人發現。 */
test('復原提示出現時隱藏 FAB：pill 放寬到整行後會蓋住它，z-index 也比它高', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  await expect(page.locator('.lib-fab')).toBeVisible()

  const first = rows(page).first()
  const name = ((await first.locator('.nm').textContent()) ?? '').trim()
  await first.locator(`[aria-label="封存 ${name}"]`).click()

  await expect(page.locator('.undo-pill')).toBeVisible()
  await expect(page.locator('.lib-fab'), '復原提示會壓在 FAB 上，那 5 秒按新增等於誤觸復原').toHaveCount(0)

  await page.locator('.undo-pill').click()
  await expect(page.locator('.undo-pill')).toHaveCount(0)
  await expect(page.locator('.lib-fab'), '復原之後 FAB 沒回來').toBeVisible()
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

/* 迴歸鎖（2026-08-05 使用者回報「封存好像沒有提示」）。提示本來就在，是四件事疊起來
   讓它實際上看不到／聽不到：① 貼底但沒補 `env(safe-area-inset-bottom)`，而這個畫面的
   底部列是收起來的、沒有東西幫它擋 home indicator ② `left: 50%` 把絕對定位元素的收縮
   寬度卡在半個螢幕（196.5px），真實品名「油雞腿飯」需要 226px，文字就在固定 44px 高的
   膠囊裡換行溢出 ③ 沒有 role="status"／aria-live，螢幕閱讀器完全不會播報 ④ 沒有進場動畫。

   **①的安全區在無頭瀏覽器下 env() 恆為 0，測不出來**——這裡誠實記帳：只鎖 ②③，
   ①靠 CSS 註解與 DESIGN.md 守著。 */
test('封存提示：長品名不會撐破膠囊，只截品名不截「復原」，且有無障礙播報', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const first = rows(page).first()
  const name = ((await first.locator('.nm').textContent()) ?? '').trim()
  await first.locator(`[aria-label="封存 ${name}"]`).click()

  const pill = page.locator('.undo-pill')
  await expect(pill).toBeVisible()
  /* role=status 必須在**外層**：掛在 button 上會取代掉按鈕的隱含 role，讀屏就找不到
     這顆唯一的復原入口了（v2.28 一度寫錯，v2.29 review 抓到）。所以這裡兩件事都要驗：
     外層有播報、內層仍然是一顆沒有被覆寫 role 的 button。 */
  const wrap = page.locator('.undo-pill-wrap')
  await expect(wrap, '封存對螢幕閱讀器沒有任何回饋').toHaveAttribute('role', 'status')
  await expect(wrap).toHaveAttribute('aria-live', 'polite')
  expect(await pill.evaluate((el) => el.tagName), '復原不是 button 了').toBe('BUTTON')
  expect(
    await pill.evaluate((el) => el.getAttribute('role')),
    'role 又被掛回 button 上，按鈕語意會被取代掉',
  ).toBeNull()

  const geo = await page.evaluate(() => {
    const p = document.querySelector('.undo-pill') as HTMLElement
    const nm = p.querySelector('.nm') as HTMLElement
    const measure = (chars: number) => {
      nm.textContent = '雞'.repeat(chars)
      const r = p.getBoundingClientRect()
      return { h: +r.height.toFixed(1), w: +r.width.toFixed(1), nmClipped: nm.scrollWidth > nm.clientWidth + 1 }
    }
    const short = measure(4)
    const long = measure(30)
    return { short, long, viewportW: window.innerWidth, hasNmSpan: !!nm }
  })

  expect(geo.hasNmSpan, '品名沒有包在 .nm 裡，過長時會把「・復原」一起截掉').toBe(true)
  // 換行的話高度會從 44 長高——這正是修之前真實品名會發生的事
  expect(geo.short.h, '一般長度的品名就把膠囊撐高了').toBe(44)
  expect(geo.long.h, '極長品名把膠囊撐高了').toBe(44)
  // 短品名時要能用超過半個螢幕的寬度（left: 50% 的寫法會把它卡在 196.5px）
  expect(geo.short.w, '寬度又被卡在半個螢幕，文字會在膠囊裡換行').toBeGreaterThan(geo.viewportW / 2)
  expect(geo.long.nmClipped, '極長品名沒有走 ellipsis').toBe(true)
  expect(geo.long.w, '膠囊超出畫面寬度').toBeLessThanOrEqual(geo.viewportW)
})

/* v2.29：新增／範本新增從整頁改成 sheet。這條鎖「是覆蓋層不是換頁」——底下的清單必須
   還在，而且三種關法都要能用。舊的整頁 marker 一併驗它消失，否則兩套並存不會有人發現。 */
test('新增走 sheet 不是換頁：底下清單還在，關閉鈕／Esc 都能關', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const listRows = await rows(page).count()
  await page.locator('.lib-fab').click()

  const sheet = page.locator('[data-screen="food-add-sheet"]')
  await expect(sheet).toBeVisible()
  await expect(page.locator('[data-screen="food-library-add"]'), '舊的整頁新增畫面還在，兩套並存了').toHaveCount(0)
  await expect(rows(page), 'sheet 是覆蓋層，底下的清單不該被換掉').toHaveCount(listRows)

  await sheet.locator('.icon-btn[aria-label="關閉"]').click()
  await expect(sheet).toHaveCount(0)

  await page.locator('.lib-fab').click()
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet, 'Esc 關不掉，鍵盤使用者會被困在 sheet 裡').toHaveCount(0)
})

/* v2.32：iOS 鍵盤彈出時 layout viewport 不變，貼死 `bottom: 0` 的 sheet 底緣會落在
   鍵盤底下，底部欄位被確認鈕壓掉（真機回報，附截圖）。修法是 App.tsx 從
   `visualViewport` 算出鍵盤高度寫進 `--kb`，sheet 的 `bottom` 吃它。

   **桌面 WebKit 產生不出鍵盤，這條驗不到 `visualViewport` 的讀數**——它守的是另一半：
   接線。CSS 變數名打錯、選擇器沒命中、被更晚的規則蓋掉，任何一種都會讓整個修法靜默
   失效而畫面看起來一切正常。所以這裡直接餵一個 `--kb` 進去，量 sheet 有沒有真的縮上來，
   順帶確認可捲區跟著變矮、確認鈕還在 sheet 裡面。讀數那半只能真機驗。

   **`--kb` 設在 sheet 元素身上，不是 `documentElement`**：App.tsx 那支 `sync()` 寫的正是
   root 的 inline style，桌面上任何一次 `visualViewport` 的 resize／scroll 都會把它蓋回
   `0px`——設在 root 上等於跟 effect 搶同一格，是個等著發作的 flaky 源（review 抓到）。
   設在元素自己身上則永遠贏過繼承來的值，與 effect 井水不犯河水。 */
test('sheet 的底緣吃 --kb（鍵盤高度）：縮上來之後可捲區變矮、確認鈕仍在框內', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)
  await page.locator('.lib-fab').click()

  const sheet = page.locator('[data-screen="food-add-sheet"]')
  await expect(sheet).toBeVisible()

  const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!
  const before = await box(sheet)
  const formBefore = await box(sheet.locator('.form-wrap'))

  const KB = 300
  await sheet.evaluate((el, kb) => el.style.setProperty('--kb', `${kb}px`), KB)

  const after = await box(sheet)
  expect(Math.round(before.height - after.height), 'sheet 沒有吃到 --kb，接線斷了').toBe(KB)

  // 可捲區吸收整段縮減（確認列是 flex-shrink:0，不該被壓）
  const formAfter = await box(sheet.locator('.form-wrap'))
  expect(Math.round(formBefore.height - formAfter.height), '縮減沒有落在可捲區身上').toBe(KB)

  // 確認鈕仍在 sheet 的可視範圍內，不是被推到框外
  const btn = await box(sheet.locator('.pick-bar-btn'))
  expect(btn.y + btn.height, '「加入食品庫」被擠出 sheet 了').toBeLessThanOrEqual(after.y + after.height + 1)
})

/* v2.35：`--vvtop` 補的是**位移**，跟上面那條 `--kb` 補的**高度**是兩件事。
   欄位落在表單下半部時，iOS 會把整個 layout viewport 往上捲去讓它露出來，而
   `position: fixed` 是釘在 layout viewport 上的，於是 sheet 整個被推出可見區——真機
   截圖：點碳水欄，「新增食物」標題貼到螢幕最頂、確認鈕掉到鍵盤底下，連 `?debug` 讀數列
   自己都被推不見了。點品名欄則 `vvTop=0`、一切正常，兩者的差別只有欄位位置。

   **兩條接線鎖都要留**：`--kb` 斷了 sheet 不會縮、`--vvtop` 斷了 sheet 不會下移，
   兩種靜默失效在桌面看起來都一模一樣（`visualViewport` 讀數恆為 0，畫面完全正常）。
   同樣把變數設在 sheet 元素身上而不是 `documentElement`，理由見上一條。 */
test('sheet 的 top 吃 --vvtop（visual viewport 位移）：整條跟著往下移', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)
  await page.locator('.lib-fab').click()

  const sheet = page.locator('[data-screen="food-add-sheet"]')
  await expect(sheet).toBeVisible()

  /* 要等 vaul 的進場動畫跑完再量——它是 translateY(100%)→0，量在途中的話基準線是浮動的
     （第一次寫這條就撞到：位移 +120 量出來是 -154）。上面那條 `--kb` 測試不受影響，因為
     它比的是 height，而 translateY 不改變 height。 */
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined))
  const before = (await sheet.boundingBox())!

  const OFFSET = 120
  await sheet.evaluate((el, v) => el.style.setProperty('--vvtop', `${v}px`), OFFSET)

  const after = (await sheet.boundingBox())!
  expect(Math.round(after.y - before.y), 'sheet 的 top 沒有吃到 --vvtop，接線斷了').toBe(OFFSET)
})

/* v2.29：食品庫的店家欄位補上 Autocomplete。在這之前它是純 text input——同一件事從
   「記一筆」進去能搜既有店家、從食品庫進去不能，是能力差異不是風格差異。

   **這條真正在守的是 portal**：vaul 的 Drawer 會把 body 設成 pointer-events:none，
   店家下拉若掛在預設的 document.body 就會**看得到、點不到**（DESIGN.md「店家欄位」條，
   LogSheet 撞過一次）。所以這裡一定要真的 click 選項並驗值，不能只驗選單出現。 */
test('新增 sheet 的店家是 Autocomplete，且下拉選項在 sheet 裡點得到', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  await page.locator('.lib-fab').click()
  await expect(page.locator('[data-screen="food-add-sheet"]')).toBeVisible()

  const vendor = page.locator('#lf-vendor')
  await vendor.click()
  await expect(page.locator('.vendor-popup'), '店家欄位沒有下拉，還是純 text input').toBeVisible()

  const option = page.locator('.vendor-item', { hasText: '減醣廚房' })
  expect(await option.count(), '「減醣廚房」選項應該只出現一次（去重）').toBe(1)
  await option.first().click()
  expect(await vendor.inputValue(), '點得到卻選不進去——portal 掛錯層的典型症狀').toBe('減醣廚房')
})

/* 補遺 3 的裁決：新增有自動完成、編輯沒有，等於用一個分岔換掉另一個。 */
test('就地編輯的店家欄位同樣是 Autocomplete', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const first = rows(page).first()
  const name = ((await first.locator('.nm').textContent()) ?? '').trim()
  await first.locator(`[aria-label="編輯 ${name}"]`).click()

  const vendor = page.locator('#le-vendor')
  await vendor.click()
  await expect(page.locator('.vendor-popup'), '就地編輯的店家還是純 text input').toBeVisible()
})

test('以現有食物為範本新增：表單預填來源的值，送出是 POST 新增而不是改到原本那筆', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  const first = rows(page).first()
  const name = ((await first.locator('.nm').textContent()) ?? '').trim()
  await first.locator(`[aria-label="以 ${name} 為範本新增"]`).click()

  const sheet = page.locator('[data-screen="food-add-sheet"]')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('.sheet-title')).toContainText(`以「${name}」為範本新增`)
  await expect(page.locator('#lf-name'), '範本沒有預填來源的品名').toHaveValue(name)

  await page.locator('#lf-name').fill(`${name}（大份）`)
  await sheet.locator('.confirm-wrap .pick-bar-btn').click()

  // 送出成功要把 sheet 關掉（清單一直都在，驗清單可見等於沒驗）
  await expect(sheet, '送出後 sheet 沒關').toHaveCount(0)
  const writes = await foodWrites(page)
  expect(writes, '不該動到原本那筆，只該新增一筆').toHaveLength(1)
  expect(writes[0].method).toBe('POST')
  expect(writes[0].body).toMatchObject({ name: `${name}（大份）` })
})

test('新增必填擋在送出前：品名留空時顯示錯誤且不送出', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)

  await page.locator('.lib-fab').click()
  await expect(page.locator('[data-screen="food-add-sheet"]')).toBeVisible()

  const sheet = page.locator('[data-screen="food-add-sheet"]')
  await page.locator('#lf-kcal').fill('200')
  await sheet.locator('.confirm-wrap .pick-bar-btn').click()

  await expect(sheet.locator('.sheet-error')).toBeVisible()
  await expect(sheet, '驗證沒過卻把 sheet 關掉了，使用者要重打一遍').toBeVisible()
  expect(await foodWrites(page), '驗證沒過卻送出了新增').toHaveLength(0)
})

/* AI 辨識輸入。辨識中**整組欄位鎖住**（使用者裁決：等辨識完再讓人操作），所以下面驗的是
   「真的鎖住了」而不是「打的字有沒有被保留」。
   元件裡合併結果時仍然讀 formRef 的最新值而不是閉包裡的 `form`——那修的是一個真的發生過的
   bug（stale closure 會把等待期間打的字整組還原，含辨識根本沒讀的店家欄）。欄位鎖住之後那條
   路走不到了，留著是保險：哪天有人放寬某個欄位，不會連帶把這個 bug 放回來。 */
const SCAN_READING = {
  name: '伯朗奶茶-減糖香濃原味(三合一)',
  basis: 'per_serving', serving_g: 17,
  kcal: 82, protein_g: 0.4, fat_g: 3.6, carb_g: 12.1,
}
const TINY_PNG = {
  name: 'label.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
}

test('辨識中整組鎖住（欄位＋關閉鈕），結束後解鎖', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)
  await page.locator('.lib-fab').click()
  const sheet = page.locator('[data-screen="food-add-sheet"]')
  await expect(sheet).toBeVisible()

  // delayMs 給我們一段「辨識中」的時間可以操作畫面——bug 只在那個窗口現形
  await page.evaluate((body) => {
    ;(window as unknown as { __scan: unknown }).__scan = { mode: 'ok', body, delayMs: 600 }
  }, SCAN_READING)

  await page.locator('[data-testid="lf-scan-input"]').setInputFiles(TINY_PNG)

  // 辨識中：按鈕與關閉鈕都該停用（誤關的代價是那張照片白拍）
  await expect(sheet.locator('.scan-btn')).toBeDisabled()
  await expect(sheet.locator('.sheet-head .icon-btn'), '辨識中關閉鈕沒鎖，誤按就得重拍').toBeDisabled()

  // 辨識中整組欄位鎖住（使用者裁決：等辨識完再讓人操作）
  await expect(page.locator('#lf-vendor'), '辨識中欄位沒鎖住').toBeDisabled()
  await expect(page.locator('#lf-name')).toBeDisabled()

  await expect(page.locator('#lf-kcal')).toHaveValue('82')
  await expect(page.locator('#lf-vendor'), '辨識結束後欄位該解鎖').toBeEnabled()
  await expect(page.locator('#lf-name')).toHaveValue('伯朗奶茶-減糖香濃原味(三合一)（每份 17g）')
  await expect(sheet.locator('.sheet-head .icon-btn'), '辨識結束後關閉鈕該解鎖').toBeEnabled()
})

/* 秒數只回答「它還活著嗎」，不是進度（真實進度拿不到，理由在元件註解）。這裡驗它**真的在走**
   ——只驗「有出現數字」的話，把 setInterval 拿掉照樣是綠的。 */
test('辨識中的秒數會往上跳，結束後消失', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)
  await page.locator('.lib-fab').click()
  const sheet = page.locator('[data-screen="food-add-sheet"]')
  await expect(sheet).toBeVisible()

  await page.evaluate((body) => {
    ;(window as unknown as { __scan: unknown }).__scan = { mode: 'ok', body, delayMs: 2400 }
  }, SCAN_READING)
  await page.locator('[data-testid="lf-scan-input"]').setInputFiles(TINY_PNG)

  // 跳到 1 就夠證明計時器在走（停在 0 = 只印了初始值）；不驗更大的數字免得跟 delayMs 賽跑
  await expect(sheet.locator('.scan-sec'), '秒數沒有往上跳').toHaveText('1')
  await expect(sheet.locator('.scan-btn'), '辨識結束後該回到原文案、不留秒數').toHaveText('AI 辨識輸入')
})

test('辨識失敗只留一行字，欄位不動、仍可手動完成新增', async ({ page }) => {
  await openApp(page)
  await openLibrary(page)
  await page.locator('.lib-fab').click()
  const sheet = page.locator('[data-screen="food-add-sheet"]')

  await page.locator('#lf-name').fill('自己打的名字')
  await page.evaluate(() => {
    ;(window as unknown as { __scan: unknown }).__scan = { mode: 'fail' }
  })
  await page.locator('[data-testid="lf-scan-input"]').setInputFiles(TINY_PNG)

  await expect(sheet.locator('.scan-error')).toHaveText('辨識失敗，請手動填寫')
  await expect(page.locator('#lf-name'), '失敗不該動到已經打好的欄位').toHaveValue('自己打的名字')
  await expect(sheet, '失敗不該把 sheet 關掉').toBeVisible()

  // 一開始打字就把錯誤訊息清掉——他已經在走手打這條路了
  await page.locator('#lf-kcal').fill('100')
  await expect(sheet.locator('.scan-error')).toHaveCount(0)
})
