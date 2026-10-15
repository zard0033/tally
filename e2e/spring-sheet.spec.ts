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
