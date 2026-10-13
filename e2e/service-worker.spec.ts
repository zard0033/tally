import { test, expect, type Page } from '@playwright/test'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* service worker 專用 spec（階段 1 甲，AC 1／5／6／7；設計與實測見 spec.md「SW 工具」）。
 *
 * 跟其餘十一個 spec 的三個不同：
 * 1. playwright.config 預設 `serviceWorkers: 'block'`，這裡自己打開——要測的就是 SW 本身。
 * 2. 不用 stub.ts：不種 session，App 走登入頁，不會有任何 Supabase 請求。
 * 3. **自己起 preview（5502），不用 5501 那台**：「離線」要真的把伺服器關掉
 *    （Playwright 的 setOffline 在 WebKit 重載時會丟內部錯誤，見 spec.md 探針 2），關掉 5501
 *    會讓同一輪的其他 spec 全死。伺服器吃的是 dist 的拋棄式副本，這樣才能改 sw.js 模擬「發佈新版」。
 *    dist 由 playwright webServer 的 `npm run build` 先建好。 */
test.use({ serviceWorkers: 'allow' })
test.setTimeout(90_000)

const PORT = 5502
const ORIGIN = `http://localhost:${PORT}`
const VITE = path.join('node_modules', 'vite', 'bin', 'vite.js')

/* 同 origin 上別的 App（Gambit）的快取：救援路徑只能清 Tally 自己 scope 的，這個要原封不動活下來。
   Cache Storage 是 per-origin 共用，名稱不含 /tally/ 的都不是我們的。 */
const FOREIGN_CACHE = 'gambit-foreign-cache'

let servedDir = ''
let server: ChildProcess | null = null
const scratch: string[] = []

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-sw-'))
  scratch.push(d)
  return d
}

const isUp = () =>
  fetch(`${ORIGIN}/tally/`, { signal: AbortSignal.timeout(2_000) }).then(
    () => true,
    () => false,
  )

async function startServer(): Promise<void> {
  // 先確認埠是空的：殘留的孤兒 preview 會讓 --strictPort 的新行程直接退出，而輪詢卻打到孤兒、
  // 照樣回 ok，之後「關掉伺服器」其實殺不到它，離線斷言就變成走網路（綠色但沒驗到）
  if (await isUp()) throw new Error(`${PORT} 已有行程在聽（上一輪殘留的 preview？）請先關掉再跑`)
  const proc = spawn(process.execPath, [VITE, 'preview', '--outDir', servedDir, '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  })
  server = proc
  for (let i = 0; i < 75; i++) {
    if (proc.exitCode !== null) throw new Error(`preview 提前結束（exit ${proc.exitCode}）`)
    if (await isUp()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview ${PORT} 沒有在 15 秒內起來`)
}

/** 等行程真的結束才回來——否則下一條測試的 beforeEach 會撞到還沒釋放的埠、rmSync 會撞到被占用的檔。 */
function stopServer(): Promise<void> {
  const proc = server
  server = null
  if (!proc || proc.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    proc.once('exit', () => resolve())
    proc.kill()
  })
}

function buildSelfDestroying(outDir: string): void {
  try {
    execFileSync(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir'], {
      env: { ...process.env, SW_SELF_DESTROY: '1' },
      stdio: 'pipe',
    })
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer }
    throw new Error(`自我解除版 build 失敗：\n${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`)
  }
}

test.beforeEach(async () => {
  servedDir = tmpDir()
  fs.cpSync('dist', servedDir, { recursive: true })
  await startServer()
})

test.afterEach(async () => {
  await stopServer()
  for (const d of scratch.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

/** 開頁 → 等 App 自己的 registerSW 註冊完成 → 再導覽一次讓頁面被 SW 接管。 */
async function installAndControl(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/tally/`)
  // ready 在沒有任何註冊時永遠不會 resolve；給 10 秒界線，失敗訊息才指得出「註冊沒發生」
  const registered = await page.evaluate(async () => {
    const timeout = new Promise<false>((r) => setTimeout(() => r(false), 10_000))
    return Promise.race([navigator.serviceWorker.ready.then(() => true as const), timeout])
  })
  expect(registered, 'App 的 registerSW 沒有在 10 秒內完成註冊').toBe(true)
  await page.goto(`${ORIGIN}/tally/`)
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
}

const cachedPaths = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = []
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname)
    }
    return out
  })

const seedForeignCache = (page: Page) =>
  page.evaluate(async (name) => {
    await (await caches.open(name)).put('/gambit/x.txt', new Response('x'))
  }, FOREIGN_CACHE)

test('首次安裝後，伺服器關掉也能開 App；快取只含同源外殼（AC 1、5）', async ({ page }) => {
  await installAndControl(page)

  const urls = await cachedPaths(page)
  expect(urls.length).toBeGreaterThan(0)
  expect(urls.every((u) => u.startsWith('/tally/'))).toBe(true)
  expect(urls.some((u) => u.endsWith('.woff2'))).toBe(true) // 字型要在，否則離線掉字
  expect(urls.some((u) => u.includes('_probe') || u.endsWith('reset.html'))).toBe(false)

  await stopServer()
  // 伺服器真的連不上了，之後的成功才算是 SW 供應的
  expect(await isUp()).toBe(false)
  await page.reload({ waitUntil: 'load' })
  await expect(page.getByText('用 Google 登入')).toBeVisible()

  // index.html 以 ?v=6 引用的三個檔也要離線可取（precache 條目不帶 query，要靠 ignoreURLParametersMatching）
  const assetsOk = await page.evaluate(async () => {
    const urlsWithQuery = ['/tally/favicon.svg?v=6', '/tally/manifest.webmanifest?v=6', '/tally/apple-touch-icon.png?v=6']
    return Promise.all(urlsWithQuery.map((u) => fetch(u).then((r) => r.ok, () => false)))
  })
  expect(assetsOk).toEqual([true, true, true])
})

/* 這條驗的是「新版裝好後不自動接手」（skipWaiting: false）。它**沒有**覆蓋 spec 說的另一個風險——
   新 SW 啟用時清掉舊 precache、舊頁面要的舊雜湊檔就沒了：這裡新舊版的 precache 清單相同，
   清理不會動到任何條目。那一半由 workbox 的 cleanupOutdatedCaches 語意保證（舊快取留到新版啟用才清），
   因此守住「不自動接手」就是守住那個風險的前提。 */
test('新版 SW 裝好後等待，不自動接手（AC 6）', async ({ page }) => {
  await installAndControl(page)

  // 模擬發佈新版：sw.js 位元組變了，瀏覽器就會當成新版本去安裝
  fs.appendFileSync(path.join(servedDir, 'sw.js'), '\n// v2\n')
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/tally/')
    if (!reg) return { waiting: null, active: null }
    await reg.update()
    for (let i = 0; i < 50 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 100))
    return { waiting: reg.waiting?.state ?? null, active: reg.active?.state ?? null }
  })
  expect(state).toEqual({ waiting: 'installed', active: 'activated' })

  // 重新導覽（舊頁面仍開著）新版仍在等，沒有被偷偷換上
  await page.goto(`${ORIGIN}/tally/`)
  const after = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/tally/')
    return { waiting: reg?.waiting?.state ?? null, active: reg?.active?.state ?? null }
  })
  expect(after).toEqual({ waiting: 'installed', active: 'activated' })
})

test('救援頁不被 SW 吞掉；按「重置」只清 Tally 的 SW 與快取（AC 7 ②）', async ({ page }) => {
  await installAndControl(page)
  await seedForeignCache(page)

  await page.goto(`${ORIGIN}/tally/reset.html`)
  await expect(page.getByRole('heading', { name: '重置離線快取' })).toBeVisible()
  await page.getByRole('button', { name: '重置' }).click()
  await expect(page.getByRole('status')).toContainText('已重置')

  const left = await page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    caches: await caches.keys(),
  }))
  // 註冊清光；快取只剩同 origin 別的 App 的那一個
  expect(left).toEqual({ registrations: 0, caches: [FOREIGN_CACHE] })
})

test('救援頁網址帶 query 也不被 SW 吞成 App 首頁（AC 7 ②）', async ({ page }) => {
  await installAndControl(page)

  await page.goto(`${ORIGIN}/tally/reset.html?from=sms`)
  await expect(page.getByRole('heading', { name: '重置離線快取' })).toBeVisible()
})

test('推上自我解除版 sw.js 後，舊 SW 與 Tally 的快取自動清掉、別人的不動（AC 7 ①）', async ({ page }) => {
  await installAndControl(page)
  await seedForeignCache(page)
  expect((await cachedPaths(page)).length).toBeGreaterThan(0)

  // 建一份 SW_SELF_DESTROY=1 的產物，把它的 sw.js 換進伺服器正在供應的目錄
  const killDir = tmpDir()
  buildSelfDestroying(killDir)
  fs.copyFileSync(path.join(killDir, 'sw.js'), path.join(servedDir, 'sw.js'))

  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/tally/')
    await reg?.update()
  })
  // 自我解除版清完會自己把頁面重新導覽一次（設計如此），輪詢要容忍那一下 context 被銷毀
  const remaining = () =>
    page
      .evaluate(async () => ({
        registrations: (await navigator.serviceWorker.getRegistrations()).length,
        caches: await caches.keys(),
      }))
      .catch(() => null)
  await expect.poll(remaining, { timeout: 15_000 }).toEqual({ registrations: 0, caches: [FOREIGN_CACHE] })
})
