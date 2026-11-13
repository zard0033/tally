/* CI 暖機（globalSetup）：正式測試前先在另一個 WebKit 開一次 App、左滑一下。
   2026-11-13 統計：每份 shard 第一條的耗時是同一條排在後面時的 2–5 倍，CI 紅過抖過的大多擠在 shard 開頭；
   改在容器裡跑後懲罰約小一半但還在。同一天 diag 先跑了一支探針（另一個 Playwright 行程）再跑正式測試，第一條就沒有懲罰——
   所以冷的是作業系統層（WebKit 執行檔、字型、磁碟快取），不是那一個瀏覽器行程，另開一個瀏覽器暖得到。
   本機預設不跑（機器是熱的，白花時間）；要試就 `E2E_WARMUP=1`。 */
import { devices, webkit, type FullConfig } from '@playwright/test'
import { grabPoint, leg, openApp, slowDrag } from './harness'

export default async function warmup(config: FullConfig): Promise<void> {
  if (!process.env.CI && !process.env.E2E_WARMUP) return
  const { baseURL, viewport } = config.projects[0].use
  const started = Date.now()
  // 暖機失敗不擋測試：globalSetup 不在重試範圍內，丟錯會讓整份 shard 一條都不跑、擋住部署——冷機器上 openApp 的 5 秒上限正是最可能撞到的地方。
  // 失敗印成 ::warning::，會出現在 Actions 的摘要頁，不是靜默吞掉
  const browser = await webkit.launch({ timeout: 30_000 })
  try {
    const context = await browser.newContext({ ...devices['iPhone 14 Pro'], viewport, baseURL, serviceWorkers: 'block' })
    const page = await context.newPage()
    await openApp(page)
    const g = await grabPoint(page)
    await slowDrag(page, g, leg(g, { x: g.x - 90, y: g.y }))
    await page.waitForTimeout(500)
    console.log(`warm-up: ${Date.now() - started}ms`)
  } catch (e) {
    console.log(`::warning::warm-up 失敗（${Date.now() - started}ms），照常跑測試：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await browser.close()
  }
}
