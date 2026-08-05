/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base：GitHub Pages 掛在 /tally/ 子路徑
// port 5500：Supabase OAuth redirect 白名單綁死，不可換
export default defineConfig({
  base: '/tally/',
  plugins: [react(), tailwindcss()],
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
