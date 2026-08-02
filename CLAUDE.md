# Tally

個人營養追蹤 web app。手機為主。需求與分期見 [spec.md](spec.md)。

- **動任何 UI 之前先讀 [DESIGN.md](DESIGN.md)。** 顏色、字級、間距一律用其中的 token，不硬編。
- 開場先讀 [session-state/active.md](session-state/active.md)，session 末更新它。
- 前端 Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui（Base UI）+ vaul + supabase-js（2026-07-29 自 vanilla 轉棧，脈絡見 active.md）。GitHub Pages 託管，Actions build 後部署，base `/tally/`。不載 CDN 資源——依賴一律打進 bundle 自託管。
- 純邏輯（公式、日期、資料存取）一律放 `src/lib/`，禁沾 DOM——這層未來要原樣帶去 React Native。UI 在 `src/screens/`，mutation 走 App.tsx 下發的 props。
- 本機開發跑 `npm run dev`（Vite，釘 5500 strictPort）。**port 不能換**——Supabase 的 OAuth redirect 白名單綁死 5500，換了登入就壞；playwright 也擋 `file://`，一定要走 http。
- 測試：`npx vitest run`＝邏輯層（動公式、捨入、日期必跑）；`npm run e2e`＝UI 回歸，共 24 條，分六個檔（`tally.spec.ts` 累積狀態的全份回歸、`interaction.spec.ts` 13 條可單獨跑的互動路徑、`vendor-autocomplete.spec.ts`、`meal-exit-animation.spec.ts`、`quota-warning.spec.ts`、`qty-edit.spec.ts`；改 UI 必跑全部，fetch 全 stub 不打真後端）。單跑一條：`npx playwright test interaction -g "關鍵字"`。
- `service_role` / DB 密碼 / OAuth client secret 永不進 repo。repo 是 public，前端只用 anon key ＋ RLS。

## Pre-Push Checklist（跳過的寫理由，不留空）

- [ ] `npx vitest run` 全量綠（動公式、捨入、日期、資料存取必跑）
- [ ] `npm run build` 過（tsc -b 含在內）＋ `npm run lint` 0 error
- [ ] 改 UI → `npm run e2e` 綠（24 條，見上方六個檔）；webkit 393×745 截圖看過，token 無黑色 fallback。**本專案只有淺色一套**（DESIGN.md 明文不做暗色模式），所以沒有暗色那半邊要截
- [ ] 改 UI → 設計決策已回寫 DESIGN.md（元件規則 ＋ 版本紀錄），不只改 code
- [ ] 動 Supabase schema / 匯出格式 → 屬影響面升級，先過 spec → ★核可（見全域 dev-flow）
- [ ] spec 外追加？有 → session-state/active.md 標一行 `[追加]`
- [ ] session-state/active.md 已更新（現況/待決/續點）並 stage 進同一 commit
- [ ] 蒸餾一句：有通則寫進 active.md，沒有明講「無」
