/* SpringSheet（全站精緻度改版 B0）：自製 spring sheet 取代 vaul。試點是「開始訓練」（無輸入、貼合內容）
   與「新課表」（有輸入欄，驗焦點）。這裡守的是元件本身的行為——開啟落定、各種關閉方式、下滑手勢的
   三種結果（慢拖回彈／拖過門檻關／輕甩關）、背景 inert、焦點、減少動態。
   **鍵盤升起時的位置（`--kb`／`--vvtop`）桌面測不出來，只能真機驗**（DESIGN v2.34–v2.35 同一條限制）。 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import { openApp } from './harness'

const sheet = (page: Page) => page.locator('[data-screen="start-sheet"]')
const scrim = (page: Page) => page.locator('.scrim')

async function openStartSheet(page: Page) {
  await openApp(page)
  await page.locator('.tab[aria-label="訓練"]').click()
  await page.waitForSelector('[data-screen="training"]')
  await page.getByRole('button', { name: '開始訓練' }).click()
  await expect(sheet(page)).toBeVisible()
}

/** sheet 目前的 translateY（px）。 */
const ty = (el: Locator) => el.evaluate((n) => new DOMMatrix(getComputedStyle(n).transform).m42)
/** 等 spring 落定：y 連續兩次讀到同一個值。 */
async function settled(el: Locator) {
  await expect
    .poll(async () => {
      const a = await ty(el)
      await el.page().waitForTimeout(80)
      return Math.abs((await ty(el)) - a) < 0.1 ? a : NaN
    })
    .not.toBeNaN()
}

/** 在把手上按下、往下拖 dy px（分 steps 步、每步間隔 gap ms），再放開。 */
async function dragHandle(page: Page, dy: number, steps: number, gap: number) {
  const b = (await sheet(page).locator('.sheet-grab').boundingBox())!
  const x = b.x + b.width / 2
  const y0 = b.y + 8
  await page.mouse.move(x, y0)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y0 + (dy * i) / steps)
    if (gap) await page.waitForTimeout(gap)
  }
}

test('開啟：spring 進場後落定在 0，是 dialog、貼合內容高度、scrim 全亮', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  expect(Math.abs(await ty(sheet(page))), '落定後 y 應為 0').toBeLessThan(0.5)
  await expect(sheet(page)).toHaveAttribute('role', 'dialog')
  const h = (await sheet(page).boundingBox())!.height
  expect(h, `開始訓練 sheet 應貼合內容（原本近全高約 649px），實際 ${h}`).toBeLessThan(500)
  expect(Number(await scrim(page).evaluate((n) => getComputedStyle(n).opacity))).toBeGreaterThan(0.95)
})

test('開啟的瞬間不會先出現在最終位置再跳走（第一幀就在畫面下方）', async ({ page }) => {
  await openApp(page)
  await page.locator('.tab[aria-label="訓練"]').click()
  await page.waitForSelector('[data-screen="training"]')
  // 在 sheet 節點一出現就量它的 y：必須已經在下方，不是 0
  const first = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const mo = new MutationObserver(() => {
          const n = document.querySelector('[data-screen="start-sheet"]')
          if (n) {
            mo.disconnect()
            resolve(new DOMMatrix(getComputedStyle(n).transform).m42)
          }
        })
        mo.observe(document.body, { childList: true, subtree: true })
        const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '開始訓練' || b.textContent?.includes('開始訓練'))
        ;(btn as HTMLButtonElement).click()
      }),
  )
  expect(first, '節點剛掛上時 y 應該在畫面下方').toBeGreaterThan(100)
})

test('Escape 關閉：spring 收掉後節點才卸載', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toHaveCount(0)
})

test('點 scrim 關閉', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  await page.mouse.click(200, 60) // sheet 上方露出的區域
  await expect(sheet(page)).toHaveCount(0)
})

test('標題列的關閉鈕關閉', async ({ page }) => {
  await openStartSheet(page)
  await sheet(page).getByRole('button', { name: '關閉' }).click()
  await expect(sheet(page)).toHaveCount(0)
})

test('關閉後再開：仍從畫面下方進場、再落定（不殘留上一次的位置）', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toHaveCount(0)
  await page.getByRole('button', { name: '開始訓練' }).click()
  await expect(sheet(page)).toBeVisible()
  await settled(sheet(page))
  expect(Math.abs(await ty(sheet(page)))).toBeLessThan(0.5)
})

test('下滑手勢（慢拖、沒過門檻）：放手後 spring 回彈、sheet 還在', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  await dragHandle(page, 40, 8, 25) // 約 200ms 拖 40px：速度低、位移遠小於 35%
  const mid = await ty(sheet(page))
  expect(mid, '拖到一半時 sheet 應跟著手指（1:1）').toBeGreaterThan(20)
  await page.mouse.up()
  await settled(sheet(page))
  expect(Math.abs(await ty(sheet(page))), '回彈後回到 0').toBeLessThan(0.5)
  await expect(sheet(page)).toBeVisible()
})

test('下滑手勢（慢拖過門檻）：放手後關閉', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  const h = (await sheet(page).boundingBox())!.height
  await dragHandle(page, Math.round(h * 0.5), 12, 25) // 拖過 35%
  await page.mouse.up()
  await expect(sheet(page)).toHaveCount(0)
})

test('下滑手勢（輕輕一甩）：位移不大但速度快也會關', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  await dragHandle(page, 70, 5, 6) // 約 30ms 拖 70px：速度遠超 500 px/s
  await page.mouse.up()
  await expect(sheet(page)).toHaveCount(0)
})

/** 在把手上送一次沒有移動的 pointerdown＋pointerup（單純點一下）。 */
const tapGrab = (page: Page) =>
  sheet(page)
    .locator('.sheet-grab')
    .evaluate((n) => {
      const init = { bubbles: true, pointerId: 7, clientX: 200, clientY: 500, button: 0, isPrimary: true, pointerType: 'touch' }
      n.dispatchEvent(new PointerEvent('pointerdown', init))
      window.dispatchEvent(new PointerEvent('pointerup', init))
    })

test('關閉中點一下把手：sheet 仍然收完並卸載（不會卡在半路變成關不掉的 modal）', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(60) // 關閉 spring 剛跑起來
  await tapGrab(page)
  await expect(sheet(page)).toHaveCount(0, { timeout: 2000 })
  // 卸載之後還能再開、再關，證明 Dialog 沒有殘留在 modal 狀態
  await page.getByRole('button', { name: '開始訓練' }).click()
  await expect(sheet(page)).toBeVisible()
  await settled(sheet(page))
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toHaveCount(0)
})

test('開啟中點一下把手：sheet 接回去落定在 0（不會停在半路）', async ({ page }) => {
  await openStartSheet(page)
  await page.waitForTimeout(50) // 開啟 spring 還在跑
  await tapGrab(page)
  await settled(sheet(page))
  expect(Math.abs(await ty(sheet(page))), '點一下之後應落定回 0').toBeLessThan(0.5)
})

test('貼合內容的 sheet：scrim 是跟著 sheet 自己的高度淡出，落定時全亮、關到底時是 0', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  expect(Number(await scrim(page).evaluate((n) => getComputedStyle(n).opacity))).toBeGreaterThan(0.99)
  const h = (await sheet(page).boundingBox())!.height
  await dragHandle(page, Math.round(h * 0.6), 10, 25) // 不放手，停在 60% 處
  const mid = Number(await scrim(page).evaluate((n) => getComputedStyle(n).opacity))
  // 以自己的高度算：1 − 0.6 ≈ 0.4。若誤用螢幕高度的 0.6 倍（約 447px）當分母，這裡會是 0.56 上下
  expect(mid, `拖到自己高度的 60% 時 scrim 約剩 0.4，實際 ${mid}`).toBeGreaterThan(0.3)
  expect(mid).toBeLessThan(0.5)
  await page.mouse.up()
})

test('拖曳中 scrim 跟著變淡（隨位置，不是等放手）', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  const before = Number(await scrim(page).evaluate((n) => getComputedStyle(n).opacity))
  await dragHandle(page, 140, 10, 20)
  const during = Number(await scrim(page).evaluate((n) => getComputedStyle(n).opacity))
  expect(during, `拖曳中 scrim 應變淡（${before} → ${during}）`).toBeLessThan(before - 0.1)
  await page.mouse.up()
})

test('往上拖不會把 sheet 拉出頂端（y 不為負）', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  await dragHandle(page, -120, 8, 20)
  expect(await ty(sheet(page))).toBeGreaterThanOrEqual(-0.5)
  await page.mouse.up()
  await settled(sheet(page))
  await expect(sheet(page)).toBeVisible()
})

test('開著時背景對輔助技術是藏起來的、焦點留在 sheet 裡', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  const inside = await page.evaluate(() => !!document.activeElement?.closest('[data-screen="start-sheet"]'))
  expect(inside, '開啟後焦點應進到 sheet').toBe(true)
  // 連按 Tab 走完一圈還多：焦點必須一直留在 sheet 裡。Base UI 的焦點陷阱靠兩端的 guard 接力，轉移可能是非同步的，
  // 所以每按一下就輪詢到「在 sheet 裡」，並記下走過哪些元素，證明確實在 sheet 內循環（不是卡在原地）
  const seen = new Set<string>()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-screen="start-sheet"]')), { message: `第 ${i + 1} 次 Tab 後焦點應在 sheet 裡` })
      .toBe(true)
    seen.add(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('aria-label') ?? (document.activeElement as HTMLElement).textContent?.trim().slice(0, 12) ?? ''))
  }
  expect(seen.size, `6 次 Tab 應在 sheet 內的多個元素間循環，實際只走過 ${[...seen].join('、')}`).toBeGreaterThan(2)
  // Base UI 為了保留 aria-live 區域（讓讀屏仍念得出狀態變化），不會把 #root 整個藏起來，而是逐層往下藏沒有 live region 的兄弟；
  // 所以要驗的是「背景裡真正可操作的東西」（分頁按鈕）在輔助技術眼裡被藏起來，不是 #root 本身
  const bgHidden = await page.evaluate(() => {
    const tab = document.querySelector('.tab[aria-label="設定"]')
    return !!tab && !!tab.closest('[aria-hidden="true"],[inert]')
  })
  expect(bgHidden, '背景的分頁按鈕應被標成 aria-hidden 或 inert（讀屏不該掃到 sheet 後面）').toBe(true)
})

test('有輸入欄的 sheet（新課表）：開啟後焦點直接落在名稱欄', async ({ page }) => {
  await openApp(page)
  await page.locator('.tab[aria-label="訓練"]').click()
  await page.waitForSelector('[data-screen="training"]')
  await page.locator('[data-action="new-routine"]').click()
  const nameSheet = page.locator('[data-screen="routine-name"]')
  await expect(nameSheet).toBeVisible()
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label'))).toBe('課表名稱')
  await settled(nameSheet)
  expect(Math.abs(await ty(nameSheet))).toBeLessThan(0.5)
})

test('減少動態：進場與關閉改為幾乎瞬間（不跑 spring 位移）', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openStartSheet(page)
  await expect.poll(() => ty(sheet(page)), { timeout: 600 }).toBeLessThan(0.5)
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toHaveCount(0, { timeout: 1500 })
})

/* ── 記一筆 sheet（B1b 第一步：vaul → SpringSheet）用到的兩個新屬性 ──
   `locked`：AI 辨識中鎖住關閉。vaul 時代是 `dismissible={!scanBusy}`，那一條從來沒有 e2e，
   這裡補上；只擋關閉鈕沒用，Escape、點 scrim、下滑都會關，而誤關的代價是那張照片白拍。
   `initialFocus`＋`popupRef`：開啟時焦點落在 sheet 容器本身（與 vaul 版一致），不是第一顆餐別 chip。 */
const logSheet = (page: Page) => page.locator('[data-screen="log-sheet"]')

const SCAN_BODY = { name: '測試奶茶', basis: 'per_serving', serving_g: 17, kcal: 82, protein_g: 0.4, fat_g: 3.6, carb_g: 12.1 }
const PNG = {
  name: 'label.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
}

async function openLogSheet(page: Page) {
  await openApp(page)
  await page.click('button.cta')
  await expect(logSheet(page)).toBeVisible()
  await settled(logSheet(page))
}

test('記一筆 sheet 開啟：焦點落在 sheet 容器本身，不是第一顆餐別 chip', async ({ page }) => {
  await openLogSheet(page)
  const focused = await page.evaluate(() => {
    const el = document.activeElement
    return { isSheet: el?.getAttribute('data-screen') === 'log-sheet', tag: `${el?.tagName.toLowerCase()}.${[...(el?.classList ?? [])].join('.')}` }
  })
  expect(focused.isSheet, `焦點應落在 [data-screen="log-sheet"] 本身，實際在 ${focused.tag}`).toBe(true)
})

test('AI 辨識中：Escape、點 scrim、下滑都收不掉記一筆 sheet；辨識結束後 Escape 收得掉', async ({ page }) => {
  await openLogSheet(page)
  const q = page.locator('input[aria-label="搜尋食物"]')
  await q.click()
  await q.pressSequentially('測試奶茶', { delay: 30 })
  await page.locator('.add-food-row').click()
  await page.waitForSelector('#f-kcal')
  await page.evaluate((body) => {
    ;(window as unknown as { __scan: unknown }).__scan = { mode: 'ok', body, delayMs: 4500 }
  }, SCAN_BODY)
  await page.locator('[data-testid="f-scan-input"]').setInputFiles(PNG)
  await expect(page.locator('#f-vendor'), '辨識沒開始（欄位沒鎖住）').toBeDisabled()

  // 辨識中欄位全 disabled、焦點會掉到 body，Escape 到不了 Dialog；先把焦點放回 sheet，測的才是「鎖住」而不是「沒收到按鍵」
  await logSheet(page).focus()
  // 關閉是 spring（約 1 秒才卸載），所以「還在畫面上」不夠——要看它還停在 y=0，沒有開始往下收
  const stillOpen = async (msg: string) => {
    await page.waitForTimeout(400)
    expect(await ty(logSheet(page)), msg).toBeLessThan(2)
  }
  await page.keyboard.press('Escape')
  await stillOpen('辨識中 Escape 把 sheet 關了（開始往下收）')

  await page.mouse.click(200, 40) // sheet 上方露出的 scrim
  await stillOpen('辨識中點 scrim 把 sheet 關了（開始往下收）')

  const b = (await logSheet(page).locator('.sheet-grab').boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + 8)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(b.x + b.width / 2, b.y + 8 + 40 * i)
    await page.waitForTimeout(25)
  }
  expect(await ty(logSheet(page)), '辨識中拖把手，sheet 不該跟著手指走').toBeLessThan(2)
  await page.mouse.up()
  await stillOpen('辨識中下滑把 sheet 關了（開始往下收）')

  // 新增食物那頁的標題列也是下滑起手區（B1b 加的 SheetGrabZone），辨識中同樣要鎖住
  const head = (await logSheet(page).locator('.sheet-head').boundingBox())!
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2 + 40 * i)
    await page.waitForTimeout(25)
  }
  expect(await ty(logSheet(page)), '辨識中拖標題列，sheet 不該跟著手指走').toBeLessThan(2)
  await page.mouse.up()
  await stillOpen('辨識中拖標題列把 sheet 關了（開始往下收）')

  await expect(page.locator('#f-kcal')).toHaveValue('82') // 辨識結束
  await expect(page.locator('#f-vendor'), '辨識結束後欄位該解鎖').toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(logSheet(page), '辨識結束後 Escape 應該收得掉').toHaveCount(0)
})

/* 記一筆 sheet 沒有標題列，頂端把手只有約 12px 高、很難拉（真機回報）。餐別列（以及新增食物頁的標題列）
   也當下滑起手區；點 chip 仍然是切餐別，不能被當成拖曳。 */
test('記一筆 sheet：從餐別列往下拖也能關閉', async ({ page }) => {
  await openLogSheet(page)
  const bar = (await logSheet(page).locator('.chip-bar').boundingBox())!
  const x = bar.x + 60 // 落在 chip 上
  const y0 = bar.y + bar.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x, y0 + 40 * i)
    await page.waitForTimeout(25)
  }
  expect(await ty(logSheet(page)), '從餐別列起手，sheet 應該跟著手指走').toBeGreaterThan(100)
  await page.mouse.up()
  await expect(logSheet(page)).toHaveCount(0)
})

test('記一筆 sheet：點餐別 chip 仍是切換餐別，sheet 不動、不關', async ({ page }) => {
  await openLogSheet(page)
  const chip = logSheet(page).locator('.chiprow .chip').nth(2)
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(300)
  expect(Math.abs(await ty(logSheet(page))), '點 chip 後 sheet 應停在 y=0').toBeLessThan(2)
  await expect(logSheet(page)).toBeVisible()
})

/* v2.65：鍵盤升起時 sheet 頂緣收到狀態列（safe-area）下方，原本剛好貼著，使用者回報不好看，改留 12px
   （`--sheet-top-gap`，`.sheet` 的 top 與 `.sheet-fit` 的 max-height 共用）。桌面產生不出鍵盤、
   env(safe-area-inset-top) 也回 0，所以直接把 `--kb` 設在 sheet 元素身上（理由見 food-library.spec 那條）。
   沒有鍵盤時仍是 96px——只有鍵盤升起那一刻才多這 12px。 */
test('鍵盤升起時近全高 sheet 的頂緣留 12px；沒有鍵盤時仍是 96px', async ({ page }) => {
  await openLogSheet(page)
  const top = async () => Math.round((await logSheet(page).boundingBox())!.y)
  expect(await top(), '沒有鍵盤時頂緣應為 96px（今日頁主數字露在上方）').toBe(96)
  await logSheet(page).evaluate((el) => el.style.setProperty('--kb', '400px'))
  expect(await top(), '鍵盤升起時頂緣應收到 safe-area（桌面 0）＋12px，不是貼著狀態列的 0').toBe(12)
})

test('鍵盤升起時貼合內容 sheet 的最大高度也扣掉那 12px', async ({ page }) => {
  await openStartSheet(page)
  await settled(sheet(page))
  const vh = await page.evaluate(() => window.innerHeight)
  // computed 的 max-height 是 calc() 字串、讀不到數字；塞一段很高的內容讓 sheet 長到它的上限，再量實際高度
  await sheet(page).evaluate((el) => {
    const filler = document.createElement('div')
    filler.style.cssText = 'height:3000px;flex-shrink:0'
    el.appendChild(filler)
  })
  const maxH = () => sheet(page).evaluate((el) => el.getBoundingClientRect().height)
  expect(Math.round(await maxH()), '沒有鍵盤時最大高度＝視窗高扣 96px').toBe(vh - 96)
  await sheet(page).evaluate((el) => el.style.setProperty('--kb', '400px'))
  expect(Math.round(await maxH()), '鍵盤升起時最大高度＝視窗高扣 12px 扣鍵盤高').toBe(vh - 12 - 400)
})
