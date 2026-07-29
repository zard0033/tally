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
