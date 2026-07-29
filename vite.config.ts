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
})
