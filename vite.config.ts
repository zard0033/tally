/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/* 救援路徑①的 sw.js（`SW_SELF_DESTROY=1 npm run build`，CI 走 deploy.yml 的手動觸發選項）。
   刻意不用 vite-plugin-pwa 的 `selfDestroying`：它的樣板會 `caches.keys()` 全刪，而 Cache Storage
   是整個 origin 共用——zard0033.github.io 上還有 Gambit（/gambit/，約 16MB 的 runtime cache），
   樣板會把它們一起清掉；樣板的清快取也不在 waitUntil 內，worker 可能在刪完前被終止。
   這支只刪名稱含自己 scope 的快取（workbox precache 名稱形如 `workbox-precache-v2-<scope>`）。 */
const KILL_SW = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const scope = self.registration.scope
    for (const name of await caches.keys()) {
      if (name.includes(scope)) await caches.delete(name)
    }
    await self.registration.unregister()
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      client.navigate(client.url)
    }
  })())
})
`

function selfDestroyingSw(): Plugin {
  return {
    name: 'tally-self-destroying-sw',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: KILL_SW })
    },
  }
}

// base：GitHub Pages 掛在 /tally/ 子路徑
// port 5500：Supabase OAuth redirect 白名單綁死，不可換
export default defineConfig({
  base: '/tally/',
  plugins: [
    react(),
    tailwindcss(),
    /* service worker（階段 1 甲；設計與實測見 spec.md「SW 工具」）。
       - registerType 'autoUpdate'＋skipWaiting／clientsClaim 皆 true（2026-10-17 推翻原本的 prompt／false）：
         新版裝好就接手，接手時 registerSW 會把頁面重新載入一次。原設計是「等舊頁面都關了才接手」，
         但 iOS 的 Safari 與主畫面 App 不會真的把頁面關掉，「全部舊頁面關閉」等於永遠不發生——
         使用者的手機兩邊都停在好幾版之前（spec AC 6 當初把這個代價列為「已知、接受」，實測不能接受）。
         原本怕的「舊頁面活著時 SW 換手、它要的舊雜湊 lazy chunk 404」由接手即重載縮到最小。
       - injectRegister false：註冊由 src/registerSW.ts 自己呼叫，dev 與 e2e 不註冊。
       - manifest false：沿用 public/manifest.webmanifest。
       - 只 precache 同源外殼，沒有 runtime route，Supabase 請求不被攔。
       - woff2 要列進來，否則離線掉字型；jpg 是動作示意縮圖（148 張約 1MB，離線健身房要看得到）；_probe 是拋棄式探針頁，不進快取。
       - **gif（動作示意動畫，148 個共約 14MB）刻意不在 globPatterns 裡、不進 precache**：項數與體積太大時新版 SW 會偶發卡在
         activating（2026-10-19 實測：460 項／7.1MB 單跑 6 次只過 3 次，311 項／4.5MB 單跑 5/5 過）。離線時檢視器退回靜態縮圖（ExerciseViewer）。
       - wav 只有一個：組間休息的提示音（src/assets/rest-chime.wav，約 15KB），離線健身房也要響，所以進 precache。
       - reset.html（救援頁）要「不進 precache」**且**「列入 denylist」，缺一不可：不進 precache 才走
         網路；不在 denylist 的導覽會被 navigateFallback 吞成 App 首頁。
       - denylist 的比對對象是 pathname＋search，所以救援頁的規則允許帶 query、也允許無 .html 的網址
         （`/tally/reset.html?from=…`、`/tally/reset`），否則會被它要救的那支 SW 吞成 App 首頁。
       - ignoreURLParametersMatching 加 `v`：index.html 以 `?v=6` 引用 favicon／manifest／apple-touch-icon，
         precache 條目不帶 query，不加的話離線時這三個請求會落到網路而失敗。
       - 救援路徑①：`SW_SELF_DESTROY=1`（見上方 KILL_SW）產出自我解除版 sw.js，推上去後手機下次
         開 App 就會把壞掉的 SW 換掉。 */
    process.env.SW_SELF_DESTROY === '1'
      ? selfDestroyingSw()
      : VitePWA({
          registerType: 'autoUpdate',
          injectRegister: false,
          manifest: false,
          workbox: {
            globPatterns: ['**/*.{js,css,html,svg,png,jpg,wav,webmanifest,woff2}'],
            globIgnores: ['_probe/**', 'reset.html'],
            navigateFallback: 'index.html',
            navigateFallbackDenylist: [/\/_probe\//, /\/reset(\.html)?(\?|$)/],
            ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
            cleanupOutdatedCaches: true,
            skipWaiting: true,
            clientsClaim: true,
          },
        }),
  ],
  build: {
    // 動作示意圖（src/assets/exercises 縮圖 4–11KB、src/assets/exercise-gifs 動畫 46–227KB）一律不內嵌：Vite 預設把 < 4KB 的資產
    // 轉 base64 塞進 JS，會被吞進主 bundle，還不會被當成獨立檔案 precache。其餘資產維持預設行為。
    // 比對的是路徑前綴 `/assets/exercise`，同時涵蓋 exercises 與 exercise-gifs 兩個目錄。
    assetsInlineLimit: (file) => (file.includes('/assets/exercise') ? false : undefined),
  },
  server: {
    port: 5500,
    strictPort: true,
  },
  /* e2e 專用的靜態預覽站，**刻意跟 dev server 分開 port**。
     5500 綁死 OAuth 白名單的限制對 e2e 不適用——測試從頭到尾不走 OAuth（session 直接
     種進 localStorage、fetch 全部 stub、打到 supabase.co 的非 REST 請求一律擋下），
     所以它想用哪個 port 都行。分開之後兩件事同時解決：dev server 可以一直開著不必為了
     跑測試關掉，playwright 也不會再接手一個來路不明的既有 server（2026-08-05 的坑）。 */
  preview: {
    port: 5501,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // e2e/*.spec.ts 是 Playwright 測試，不是 vitest 測試——vitest 預設 include
    // 會吃掉 *.spec.ts，兩邊都用 spec 檔名才會撞在一起，排除掉避免 vitest 誤跑它
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
})
