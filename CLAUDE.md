# Tally

個人營養追蹤 web app。手機為主。需求與分期見 [spec.md](spec.md)。

- **動任何 UI 之前先讀 [DESIGN.md](DESIGN.md)。** 顏色、字級、間距一律用其中的 token，不硬編。
- **延續狀態走 OMC（2026-10-14 起，取代 session-state/active.md）**，`.omc/notepad.md` 與 `.omc/wiki/` 進 git 跨機接力：現況＋下一步在 notepad Priority Context（`notepad_write_priority`，≤500 字，開場自動注入）；待決／續點在 notepad MANUAL（`notepad_write_manual`）；已驗證事實、未解失敗、決策、蒸餾在 wiki（`wiki_add`／`wiki_query`）。開場讀 MANUAL、動某題前先 `wiki_query`；session 末更新 Priority Context。歷史快照在 `session-state/archive-*.md`，不再更新。
- 前端 Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui（Base UI）+ supabase-js（2026-07-29 自 vanilla 轉棧，脈絡見 `session-state/archive-2026-07.md`）。GitHub Pages 託管，Actions build 後部署，base `/tally/`。不載 CDN 資源——依賴一律打進 bundle 自託管。
- 純邏輯（公式、日期、資料存取）一律放 `src/lib/`，禁沾 DOM——這層未來要原樣帶去 React Native。UI 在 `src/screens/`，mutation 走 App.tsx 下發的 props。**跨畫面共用的 UI 片段放 `src/components/`**（目前有 `FoodFormFields`、`SegmentedControl`、`SpringSheet`、`DateStrip` 等；以 `src/components/` 實際內容為準）——判準是「同一組欄位/互動出現在兩個以上的 screen」，不是「看起來可以抽」；抽之前先確認兩邊真的該一致，否則只是把分岔搬進共用元件。
- 本機開發跑 `npm run dev`（Vite，釘 5500 strictPort）。**port 不能換**——Supabase 的 OAuth redirect 白名單綁死 5500，換了登入就壞；playwright 也擋 `file://`，一定要走 http。
- 測試（各 spec 涵蓋範圍、偶發紅清單、歷次跑測紀錄在 wiki `e2e-reference`，這裡只留規則；**每輪跑測紀錄寫那頁，不寫回這裡**）：
  - `npx vitest run`＝邏輯層（動公式、捨入、日期必跑）。**在 Git Bash 下跑會整批炸成「N files failed, 0 tests run」，而且會表現成 flaky（重跑就綠）——那是環境不是測試，用 PowerShell 跑**（全域 `windows-shell-ledger` 有全文；別再為它去查 vitest 設定）。
  - `npm run e2e`＝UI 回歸，fetch 全 stub 不打真後端。**e2e 條數用 `npx playwright test --list` 實測，不要用「舊數字＋本輪新增」外推**——條數就是這樣一路從 57 漂到 65。
  - **開發中只跑受影響的檔；push 前先 `npm run e2e:affected -- --dry`，印 FULL 就跑 `npm run e2e:smoke`，否則拿掉 `--dry` 實跑；全量在 push 後背景跑**——全量約 12 分鐘（2026-10-27 實測 377 條 738 秒，已排滿 2 個 worker、沒有長尾可拆，慢在條數乘每條固定開銷，所以省時間只能靠少跑）。`npm run e2e:affected` 依改動檔自動挑 spec（`-- --dry` 先預覽，npm 要兩個 `--` 才傳得到；選到全量時不加 `--dry` 會直接開跑；表上沒有的檔與 `app.css` 自動升全量，表上的訓練相關 `src/lib` 檔照表縮小）；`npm run e2e:smoke` 只跑 `e2e/smoke.json` 的 55 條核心路徑（約 1.5 分鐘，不能取代全量）。
  - **push 後的全量**：push 完立刻在背景開 `npm run e2e`，結果回來前 notepad Priority Context 標「全量 e2e 待確認」；紅了照下面的偶發紅流程判斷，真紅立刻修。push 會觸發部署、CI 不跑 e2e，所以全量抓到的問題可能已上線。全量跑的期間不要另開 e2e 或 `npm run build`，它們共用 build 產物和 port 5501。**例外：動到 service worker（`src/registerSW.ts`、`vite.config.ts`）、離線寫入佇列（`src/lib/queue.ts`、`queueStore.ts`、`sender.ts`）時，壞了難救，全量仍要在 push 前跑綠；腳本不會提醒，要自己對這份清單。schema 不在例外內：e2e 的 fetch 全 stub，全量驗不到它。**
  - 手動選檔的做法：在 `e2e/` 搜這次動到的 class、`data-screen`、aria-label 出現在哪些 spec 就跑哪些；**動到共用的東西（`SpringSheet`、`DateStrip`、`app.css` 的全域 token 或元件通用規則、`src/lib/`、`App.tsx`、`e2e/harness.ts`／`stub.ts`／`fixtures.ts`）手動選不準，改跑 `e2e:smoke`，全量留給 push 後**，因為影響面看不出來。
  - 單跑一條：`npx playwright test interaction -g "關鍵字"`。要重複單跑 `tally.spec.ts` 時，過濾字串寫 `tally.spec`——寫 `tally` 會比對到 repo 路徑而把整套都跑進去。
  - **e2e 跑的是 build 後的靜態 preview（port 5501），不是 dev server**——所以它會自己先 build 一次，也不會跟你開著的 `npm run dev`（5500）搶 port，兩邊可以同時開。
  - **`workers` 釘 2，不要拿掉**：那是這台機器在一般桌面負載下能同時開的 WebKit 數量，調高會偶發崩在 `Cannot find parent object page@…`（來龍去脈見 playwright.config.ts 註解）。
  - 整套的牆鐘由兩件事決定：平行單位預設是檔案，所以最大的檔案是長尾——`training.spec.ts` 已用 `test.describe.configure({ mode: 'parallel' })` 開檔內平行（各條都自己 openApp、不共用狀態；新檔若有 serial／beforeAll 之類共用狀態不要照抄）；需要「動作庫有 152 個動作」當前置條件的測試用 `e2e/seeded.ts` 的 `SEEDED_FIX`，不要走真的預填（逐筆上傳每條約 15 秒），預填本身只由 training.spec 的兩條守。離線測試每條約 7 秒是 postgrest-js 內建重試退避（1＋2＋4 秒，寫死在套件裡），刻意不繞：繞法（stub 丟 AbortError、動計時器）都會讓測到的不是真正斷網的路徑。
  - 寫測試：**動效斷言不要逐幀（rAF）取樣**——機器忙時幀間隔會拖到 40–100ms，短動畫取不到中間幀而假紅；改讀 `getAnimations()` 的 delay、攔 `Element.animate`、用 `MutationObserver` 記 style 寫入，見 DESIGN v2.73。**`rest-timer.spec.ts` 獨立成檔，因為 `page.clock` 會接管整頁計時器**；**跳時間用 `setFixedTime`，不要用 `fastForward`**——撥快後休息條的退場動畫退不掉，見 DESIGN v2.79。鍵盤位置桌面測不出，只能真機。
  - 紅了先對 wiki `e2e-reference` 的偶發紅清單；不在清單上的先對乾淨基線驗，別直接當偶發放過。
- `service_role` / DB 密碼 / OAuth client secret 永不進 repo。repo 是 public，前端只用 anon key ＋ RLS。

## Pre-Push Checklist（跳過的寫理由，不留空）

- [ ] `npx vitest run` 全量綠（動公式、捨入、日期、資料存取必跑）
- [ ] `npm run build` 過（tsc -b 含在內）＋ `npm run lint` 0 error
- [ ] 改 UI → `npm run e2e:affected -- --dry` 印 FULL 就跑 `npm run e2e:smoke` 綠，否則 `npm run e2e:affected` 綠；動到上面例外清單的檔則 `npm run e2e` 全量綠；其餘全量 push 後背景跑（條數用 `--list` 實測、檔案清單見 wiki `e2e-reference`，這裡不重寫第二份數字——它已經漂過一次）；webkit 393×745 截圖看過，token 無黑色 fallback。**本專案只有淺色一套**（DESIGN.md 明文不做暗色模式），所以沒有暗色那半邊要截
- [ ] 改 UI → 設計決策已回寫 DESIGN.md（元件規則 ＋ 版本紀錄），不只改 code
- [ ] 動 Supabase schema / 匯出格式 → 屬影響面升級，先給 spec＋plan、等我點頭再動實作碼（全域 CLAUDE.md「工作流程」：跨檔或不可逆的先給 spec＋plan）
- [ ] spec 外追加？有 → notepad MANUAL 加一行 `[追加]`
- [ ] notepad Priority Context 已更新（現況／下一步）並 stage 進同一 commit；待決／續點有變就更新 MANUAL
- [ ] 蒸餾一句：有通則 `wiki_add`，沒有明講「無」
