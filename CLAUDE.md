# Tally

個人營養追蹤 web app。手機為主。需求與分期見 [spec.md](spec.md)。

- **動任何 UI 之前先讀 [DESIGN.md](DESIGN.md)。** 顏色、字級、間距一律用其中的 token，不硬編。
- 開場先讀 [session-state/active.md](session-state/active.md)，session 末更新它。
- 前端 Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui（Base UI）+ vaul + supabase-js（2026-07-29 自 vanilla 轉棧，脈絡見 active.md）。GitHub Pages 託管，Actions build 後部署，base `/tally/`。不載 CDN 資源——依賴一律打進 bundle 自託管。
- 純邏輯（公式、日期、資料存取）一律放 `src/lib/`，禁沾 DOM——這層未來要原樣帶去 React Native。UI 在 `src/screens/`，mutation 走 App.tsx 下發的 props。
- 本機開發跑 `npm run dev`（Vite，釘 5500 strictPort）。**port 不能換**——Supabase 的 OAuth redirect 白名單綁死 5500，換了登入就壞；playwright 也擋 `file://`，一定要走 http。
- 測試：`npx vitest run`＝邏輯層（動公式、捨入、日期必跑）；`npm run e2e`＝10 條 UI 回歸路徑（改 UI 必跑，fetch 全 stub 不打真後端）。
- `service_role` / DB 密碼 / OAuth client secret 永不進 repo。repo 是 public，前端只用 anon key ＋ RLS。
