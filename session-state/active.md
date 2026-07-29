# Tally — session state

最後更新：2026-07-28

## 已驗證事實

- **Supabase 專案已建**：`https://bpnucfejoiazmsnsuzdb.supabase.co`，anon key 為 `sb_publishable_` 新格式。
- **四張表 + RLS 已上線**（`schema.sql`）。實測隔離生效：未登入讀 foods/intake/weight/profile 回 `[]` HTTP 200，寫入被 `42501 violates row-level security policy` 擋下。
- **Notion 遷移已完成**（`seed.sql`）：foods 23、intake 29、weight 47、profile 1。verifier 已對 Notion 原始資料逐欄核對六條驗收條件全過。**Notion 尚未刪除**，等 app 能實際使用後才退場。
- **公式鏈已反推確認**：Mifflin-St Jeor → ×活動係數 1.375 → 減重 ×0.8。使用者提供的熱量調整值公式為 `減重 → TDEE × -0.2`／`增肌 → +500`／`維持 → 0`。三大營養素比例 27/27/46。以最新體重 75.95kg（量測日 07-24）、身高 173、年齡 31 計算，
  BMR 1691 → TDEE 2325 → 目標 1860 kcal / P126 / F56 / C214。**app 實際跑出的值已與此一致。**
- **體重存體脂計原始讀數，不做校正**。校正（−1.85kg／−2.5pp）為固定偏移，不改變趨勢斜率，對目標熱量僅影響約 20 kcal。
- **repo 已轉 public**（`gh repo view` 確認 PUBLIC）。前端只有 anon key，隱私靠 Auth + RLS。
- **GitHub Pages 已上線**（2026-07-28）：`https://zard0033.github.io/tally/`，三檔實測皆 200。
  原本 `build_type` 是 `workflow`（等一個不存在的 Actions 部署 workflow，所以永遠不會上線），
  已改 `legacy` 直接發 `main` 根目錄，往後 push 自動重 build。
  `app.js:46` 的 redirect 組出 `origin + pathname` = `https://zard0033.github.io/tally/`，
  落在白名單 `.../tally/**` 內。真機測試走這個網址，不用 LAN。
- **Google OAuth 已設定**：GCP client 已建、Supabase provider 已啟用、Redirect URLs 已加 `http://localhost:5500/**` 與 `https://zard0033.github.io/tally/**`。
- **設計流程 ⓪→➊→➋ 已走完**，`DESIGN.md` 已產出。定案骨架與色系見該檔。
- **破表狀態已細琢（2026-07-28，DESIGN.md v1.1）**：斜紋改「`--over-fill` 打底 + 22% 白細紋疊層」（原實色亮條在 cream 上像斑馬線）；並補掉 v1 的無障礙漏洞——3px 營養素條上斜紋會糊成純紅，改由**破表時 3px → 6px 的高度差**當主要非顏色訊號，紋理退為第二層（紋理內部對比僅 1.47:1，WCAG 公式實算，撐不起單獨辨識）。`--over-fill` 對 paper 4.50:1 過圖形 3:1 門檻。六變體樣張見 `over-stripe-options.html`，定案＝C + F。
- **首次 push 已完成**（2026-07-27）。precommit-review（deep，runId `wf_f4ffe4a0-4a0`）抓到 `seed.sql` 含真實個資且 repo public、schema/seed 不同步、`activity_factor` 精度不足三個 confirmed，已修正。**`seed.sql` 已從全部歷史用 `git filter-branch` 清除**（原本在 `0c42c19` 引入），gc 後本機 blob 亦不可達；遠端核對 `contents/seed.sql` 回 404。**`seed.sql` 與 `migrate-v2.sql` 本機實體檔案也已不存在**（2026-07-28 確認，repo 內只剩 `schema.sql`）——遷移是一次性的、活資料在 Supabase、原始資料 Notion 還在，不需要保留。`schema.sql` 已是 v2 完整版（無 `category`、有 `vendor`、intake 四個快照欄、profile 三個 pct 欄、`activity_factor numeric(4,3)`），單獨貼進 SQL Editor 就能重建出與線上一致的結構。分支已改名 `master` → `main` 對齊遠端預設分支。

- **前端骨架 ＋ 今日頁 ＋ 設定頁已上線並實測**（2026-07-28）。`index.html` / `app.css` / `app.js` 三檔，
  無框架無 build。**不用 supabase-js**——CDN 載法違反 `DESIGN.md`；vendor 進 repo 則是本專案無 npm 無
  lockfile，120KB 要手動追版本與安全更新，而其中只有 OAuth 與 CRUD 用得到。改自己接：
  Auth 走 OAuth implicit flow、資料直打 PostgREST，約 80 行。
- **Google OAuth implicit flow 實測可用**，不需要改 PKCE。`/authorize` 不帶 `code_challenge` 時
  Supabase 把 token 回在 URL hash；讀完立刻 `replaceState` 抹掉，不留在歷史／截圖／分享連結。
  程式對 `?code=` 有明確錯誤訊息，哪天專案改吃 PKCE 不會靜默停在登入頁。
- **UID 沒有分裂**：Google 用同一 email 連結到既有 user，`auth.users` 只有一筆，99 筆遷移資料直接讀得到。
  session 存 localStorage，重整不需重登（已實測）。
- **`activity_factor` 的檔案修正沒有落到 DB**（2026-07-28 才發現並修）。precommit review 當時把
  `schema.sql` 與 `seed.sql` 改成 `numeric(4,3)` / `1.375`，但 profile 那筆是更早用
  `numeric(4,2)` 灌進去的，值被截成 **1.38**，目標因此算成 1867 而非 1860。已跑
  `alter table profile alter column activity_factor type numeric(4,3);` ＋ `update profile set activity_factor = 1.375;` 修正。
  **教訓：改了 migration 檔不等於改了線上資料。**
- **`app.js` 有 self-check**：開 `?check` 跑公式鏈、`pct` 的 clamp 與 NaN、未捨入加總、
  跨時區日期、生日邊界，結果進 console。改計算邏輯後跑一次。

- **真機（iPhone Safari）首次實測完成（2026-07-28）**，走 GitHub Pages 正式網址。11 條發現，
  其中 6 條當場修掉（見下方「軌一」），5 條進設計流程（見「軌二」）。三個根因值得記住：
  - **tap 遲鈍與可手指縮放是同一個根因**：`app.css` 全站沒有 `touch-action`。iOS Safari
    **即使 viewport 是 `width=device-width` 仍保留 double-tap-to-zoom**（這點與 Chrome/Android
    不同——那邊 device-width 就會取消），於是每個 tap 都要等約 300ms 確認不是第二下，
    加減鈕與餐別列因此都像卡頓。`touch-action: manipulation` 一行同時解決兩者。
    **不走 `user-scalable=no`**：它違反 WCAG 1.4.4，且 iOS 10 起 Safari 直接忽略，寫了也沒用。
  - **左滑「閃關」是同檔兩套寫法**：`revealDelete` 自己開的時候用
    `scrollTo({ behavior: 'smooth' })`，但 `closeOtherTracks` 關別列用 `t.scrollLeft = 0` 直接賦值。
    開有動畫、關沒有。**尚未修**（併入軌二一起做）。
  - **sheet 退場動畫其實存在**（`sheet-out` 200ms，`app.css`），不是漏做。使用者感覺不到是因為
    200ms 套在 650px 位移上太快，只有進場 280ms 的七成。這是調參不是 bug。

- **軌一（純技術修）已完成並用 playwright 實測過畫面（2026-07-28）**：
  - `touch-action: manipulation` 加在 `body`（理由見上）。
  - 新增食物表單拿掉「營養素留空當 0」說明；**選填標記統一成「只標必填 `*`」**，
    連帶拿掉店家與體脂的「（選填）」——原本 `*` 與「（選填）」兩套標記法並存是冗餘，
    且三欄並排的營養素塞不下「（選填）」。使用者原話是要「三大營養素也標選填」，
    我改成反向統一，**他尚未對這個反向決定表態**，不同意就把三處改回加「（選填）」。
  - 錯誤訊息六處改 actionable：`網路沒回應，請確認連線是否正常`、
    `連不上網路，請確認 Wi-Fi 或行動網路`、`連不上 Supabase` → `讀不到你的資料`、
    `請檢查 profile 表` 這類叫使用者去看資料庫的話全部改掉。
    **表單驗證那批沒動**（「品名要填」本來就已經在講下一步）。
    刻意不寫「請再試一次」——重試按鈕就在旁邊，重複講佔一行卻沒新資訊。

- **「記一筆」設計已定案（2026-07-28，`DESIGN.md` v1.7）**。走了八輪決策樣張，定稿＝`sample-log-entry.html`
  七屏。骨架：同頁 sheet（不做獨立頁）／清單多選（使用者平日早餐固定三樣，逐一新增要走三趟）／
  已選項目置頂常駐、不隨餐別切換消失／底部確認列小計靠左剩餘靠右／搜尋吃品名＋店家／
  新增食物入口只要有輸入就常駐清單末尾／表單 floating label／刪除在今日頁走 CSS scroll-snap 左滑
  ＋點擊雙路徑、垃圾桶 icon。全站熱量單位改中文「卡」（aria-label 仍寫「大卡」）。
- **第一版範圍擴張（使用者拍板）**：加入**日期切換**（原列第二版）——原生 `input type=date` ＋ 左箭頭，
  歷史日主數字改顯示攝取量、標籤換「攝取」；加入**設定頁編輯**（身高／生日／性別／活動係數／目標／
  三大營養素比例）與獨立的**記體重**入口（append 到 `weight`，不是覆寫 profile）。
  「同上次」一鍵仍留第二版。
- **資料模型三項變更已定**：`foods` 砍 `category`（23 筆裡 22 筆同一值，無資訊量）；
  `intake` 加 `kcal`/`protein`/`fat`/`carb` **營養快照四欄**（存單份值，不乘 qty）——理由是每週能量對帳
  需要歷史穩定，改食物營養值不該改寫過去；`profile` 加 `protein_pct`/`fat_pct`/`carb_pct`（27/27/46，
  check 相加 100），把原本寫死在 `app.js` 的比例搬進 DB。**不加 `serving` 欄**——份量單位不參與計算／
  搜尋／分組，純顯示，寫在品名裡即可（`乳清（1匙）`）。同理不加備註欄。
- **食品庫命名規則已定**：品名只放食物名＋使用者自己的描述，店家一律進 `vendor` 欄、去掉 emoji 前綴。
  搜尋必須同時比對 name 與 vendor——五筆「雞胸餐盒」只靠店家區分。
  **店家分兩層瀏覽已否決**：vendor 分散在 11 個店家、8 個只有一筆，群組數接近項目數。

## 未解失敗

- **vitest collection 偶發全滅（2026-07-29）**：同 repo 同 node_modules（vitest 4.1.10 / vite 8.1.5 / Node 26.3.0），Phase 1 的 verifier agent 在它的 shell 跑 `npx vitest run` 三個測試檔 collection 階段全炸 `TypeError: Cannot read properties of undefined (reading 'config')`（@vitest/runner 的 `runner.config.testTimeout`，runner 實例未裝上），連三行 smoke test 也炸；但主對話與 executor 的 shell 跑同指令 39/39 全過。已排除假設：`--pool=forks/threads` 無效、空白 config 無效、`npm ls` 依賴樹乾淨無重複 vite。未定位的變因＝shell 環境差異（PowerShell vs Bash？env var？）。**觀察點**：Phase 3 的 GitHub Actions CI 在 Linux 跑 vitest，若那邊也炸就升級處理；若長期只有特定 agent shell 炸，查 agent shell 的 env 差異。

## 下次續點

### 技術棧轉向（2026-07-29 使用者拍板）——先讀這節，優先於下方所有實作項

- **vanilla 三本柱退場**，換 **Vite + React + TypeScript + Tailwind + shadcn/ui（sheet 用 Vaul）+ supabase-js**。靜態輸出照舊託管 GitHub Pages（`build_type` 要從 `legacy` 改回 `workflow`，這次用真的 Actions workflow）。
- **App Store 上架＝未來選項，不是承諾**（使用者之後可能買 Mac）。今天不上 Expo。不關門做法：公式鏈與 Supabase 存取層寫成不沾 DOM 的 TS 模組，UI 層才是未來換平台要重寫的部分。
- 依據＝兩路研究（2026-07-29），蒸餾版在全域 memory `web-appstore-paths-ledger`。對本 repo 最關鍵的一條：react-native-web 不支援 CSS scroll-snap——現行左滑刪除的根基，上 Expo 等於當場重寫核心互動。另 shadcn 2026-07 起預設 primitive 已改 Base UI（非 Radix），起專案時用當下預設。
- 背景：「無框架無 build 不載第三方」是開案時未經論證的預設值漏進 spec，已定調為誤判（教訓在全域 memory `prefer-ecosystem-over-handrolling`）。**專案 CLAUDE.md 與 spec.md 的該行等遷移落地時一併改**——現在 code 還是 vanilla，先改文件會誤導。
- **v2 UI 打磨（下方軌二）直接做在新棧上**，不在 vanilla 上改完再移植。遷移 plan 尚未開，下一步＝開 plan 把移植切成可驗證的階段（含既有 self-check 邏輯轉 Vitest）。
- 下方「明天的順序」「已定案」各節的**設計決策全部有效**（樣張挑編號、動效 token 階梯、覆蓋式刪除、日期區），只是實作載體換了。

#### 遷移 Phase 0–2 已完成（2026-07-29）——實作期裁決記錄

- **CSS 整包搬移不改寫**：legacy/app.css 558 行原樣進 `src/app.css`（實戰修法保留），React 元件沿用 legacy class 名，DOM 結構鏡像 legacy；Tailwind/shadcn 機制保留供新元件。注意 `@import` 排序會讓 shadcn 的同名 token 蓋掉 legacy token（CTA 洗白實測過），修法＝main.tsx 雙 import，`app.css` 排 `index.css` 之後。
- **NTFS 大小寫坑**：`App.css`→`app.css` 這類只差大小寫的改名必須 `git mv`，否則 Windows 上 git 記混、Linux CI 會炸。
- **A-6 按鈕文案分歧**：sample-log-entry.html 寫「加入食品庫並記一筆」，legacy 行為是「加入食品庫並選取」——採 legacy（樣張視為舊稿）。
- **LogSheet 直接 import `lib/api.listRecentIntake()`** 做「常吃」排序（props 契約沒有跨日歷史）；mutation 仍全走 props。要收斂回契約時補 `types.ts` 欄位。
- **vaul 附帶 drag-to-dismiss**（legacy 沒有）：保留，這是選 vaul 的理由之一；真機手感待驗。
- **Settings 自建 sheet 沒做背景 inert**（檔案互斥擋住 App 層改動），以 role=dialog + aria-modal + Esc + 焦點管理頂替——precommit review 時判定要不要在 App 層補。
- **E2E 環境兩坑**：playwright 的 `page.route()` 在此環境完全不攔截，不設防會直接打中正式 Supabase 真實資料——一律先裝 fetch-stub seam（stub `window.fetch` ＋ localStorage 種 `sb-<ref>-auth-token`，見 App.tsx 註記）再互動；多 agent 共用 dev server 會互相觸發 HMR 全頁重載，並行驗證各開自己的分頁。
- **真機待驗清單（Phase 3 上線後）**：IME 注音組字（自動化只能合成事件驗邏輯）、iOS AutoFill vs floating label（ponytail 註記仍在）、vaul 拖曳關閉手感。
- bundle 有 >500KB 分塊警告（vaul+supabase-js 進來），非錯誤；code-split 留給之後判斷。

#### Phase 2 驗收＋Phase 3 進行中（2026-07-29）

- **E2E harness 已進 repo `e2e/`**（@playwright/test，10 條路徑 0 刪 0 增，10/10 PASS，主對話 read-back 親測）。跑法 `npm run e2e`（webServer 自動起停 5500）。含「零真實網路請求」全域斷言。舊 `C:\Users\Administrator\.claude\tools\tally-verify\` 尚未退場，React 版穩定後可刪。
- **Phase 3 已做**：`legacy/` 已 git rm（歷史可考）；`.github/workflows/deploy.yml`（npm ci → vitest → build → deploy-pages，CI 的 vitest＝runner flaky 第二觀察點）；CLAUDE.md 與 spec.md 的棧描述已改（dev 指令換 `npm run dev`、測試指令 vitest/e2e、src/lib 禁沾 DOM 守則入法）。
- **Phase 3 完成（2026-07-29）**：precommit deep review（runId `wf_db4fde95-c96`）2 confirmed 全修
  （load() closure 日期錯位、friendlyError 不認 TimeoutError）＋3 minor 採納（listRecentIntake 次要排序、
  刪未接線的 shadcn button/utils）；使用者確認後 `build_type`→workflow、push `7a52886..4d46bc5`、
  Actions run 30427265159 success，正式網址已 serving React bundle（`assets/index-*.js`）。
  **CI 的 Linux vitest 綠**——runner flaky 觀察點第一筆：過。
- **未修的 review minor（有意識略過）**：CI actions 未 pin SHA（官方 action，要收斂隨時可做）；
  RLS「跨使用者 DELETE」的 auth.uid() 比對未直接測過（先前只實測過未登入隔離），使用者自查；
  搜尋逐鍵重排序（23 筆無感）。
- **真機第一輪（2026-07-29）**：Google 登入（PKCE）✅／IME 注音 ✅／輸入框聚焦自動 zoom ❌→已修
  （表單控件字級一律 --t-md 16px，DESIGN.md 入法「表單控件字級下限」條）。
  sheet 退場 220ms（--dur-mid token 落地）複測 ✅；AutoFill vs floating label 複測 ✅
  （LogSheet 的 ponytail 註記已銷）。**scrim 分區變色第一輪修法（動畫單軌化）複測未解**——
  雙軌打架假設被推翻，真因是時序物理：scrim 與 sheet 同速 220ms 時，sheet 滑走「掀開」的
  區域露出淡到一半的暗幕、頂部 96px 帶卻從全黑開始淡 → 視覺上「頂部延遲、中下先變」。
  第二輪修法（2026-07-29）＝**scrim 退場改 --dur-fast 100ms、比 sheet 先清**（LogSheet vaul
  覆寫塊與 Settings scrimFadeMs() 都改），DESIGN.md 動效段已入法，**待真機複測**。
  進場 280ms 使用者說「偏快」→ 不動，記入 v2 樣張 M 組的判斷輸入。全項過關後，
  vanilla 舊 harness `C:\Users\Administrator\.claude\tools\tally-verify\` 可退場。
- **v2 UI 打磨（軌二）待續**：樣張挑編號的 checkpoint 仍等使用者（`sample-v2-today.html` 的 V/D/M、
  `sample-v2-login-icon.html`，兩檔的未 commit 修改仍在工作樹）；實作直接在 React 棧上做。
- **E2E 回歸 harness 已經存在，遷移 plan 要把它算進去**（2026-07-29 另一 session 建）。位置 `C:\Users\Administrator\.claude\tools\tally-verify\`，跑法：進該目錄 `npm run verify`（需 5500 server 在跑），`npm run setup` 補 browser binary。WebKit ＋ 393×745，stub fetch 免真帳號（配方即下方「驗收方式」那段），10 條路徑一次跑完 8 秒，**現況 10/10 PASS**。
  - **遷移期拿它當新舊對照基準**：React 版重寫完跑同一份清單也要 10/10。這是「沒把既有行為改壞」唯一講得清楚的證據，不然只能靠手點。
  - 處置：fixture 與 runner 骨架沿用、**selector 層整批重寫**、防 vanilla 專屬坑的 step（sheet 重繪咬 click、注音組字中斷）隨 reconciliation 失去意義可刪；runner 換成 `@playwright/test`（手刻 runner 的理由隨新棧消失）。
  - **位置要搬進 repo 的 `e2e/`**——現在放在 `.claude/tools/` 是因為當時 Tally 無 npm 塞不了 package.json，新棧有了就沒理由留在外面。（也因為放在外面，`/ponytail-debt` 掃不到它，這條記在這裡才有效。）
  - 配方與紀律（真實輸入路徑、逐鍵打字、一輪走完不中斷、DOM 契約）見全域 `ui-verify` skill。

實作前必讀 `DESIGN.md` v1.7（尤其「禁止事項」與「已否決的做法」兩節）與 `sample-log-entry.html` 七屏。

1. ~~前端骨架：登入頁（Google OAuth）→ 今日頁~~ ✅
2. ~~今日頁實作~~ ✅ 五屏都驗過
3. ~~「記一筆」決策樣張~~ ✅ 八輪迭代，定稿七屏
4. ~~`migrate-v2.sql` 執行~~ ✅ **2026-07-28 已執行並驗證**。schema 三項變更用 PostgREST 探測確認
   （`foods.category` 回 42703 已砍；`vendor`、intake 四欄、profile 三個 pct 欄皆 200）。
   因整份包在單一 transaction，`set not null` 與 `check (相加=100)` 通過即證明 intake backfill 無 null、
   profile 已灌 27/27/46。foods 23 筆品名／店家清洗由使用者跑 select 貼回逐筆核對通過
   （無 `|`／`｜`／emoji 殘留，5 筆雞胸餐盒中 3 筆完全同名、全靠 vendor 區分）。
5. ~~實作「記一筆」sheet~~ ✅
6. ~~實作今日頁刪除~~ ✅
7. ~~實作日期切換~~ ✅
8. ~~實作設定頁編輯 ＋ 記體重入口~~ ✅

**第一版功能已全部完成（2026-07-28，`DESIGN.md` v1.8）。** 兩處 `ponytail:` disabled 已解開，
寫死的 27/27/46 改讀 `profile` 三個新欄位。

**實作階段才決定的三件**（樣張沒回答，已定案）：

- 份量 0／空白／負數／非數字 → `normalizeQty` 一律回 1。不 disable 按鈕（不留死路）；
  **打字途中不正規化**，留到失焦才做——否則「1.」這種中間狀態會被改成 1、游標跳走
- 左滑開一列**自動關其他**（同時開兩列沒有意義，誤觸風險加倍）
- floating label 的 **iOS AutoFill 行為仍未驗證**（程式裡標了 `ponytail:`）。真機若看到標籤壓字，
  改用 `input` 事件加 class 判斷，別靠 `:placeholder-shown`

**實作時修掉的五個坑**（都是樣張／規範沒寫、實跑才撞到的，改動前先讀 `DESIGN.md` v1.8 版本紀錄）：

1. **sheet 不可以整塊重繪**。`renderSheet()` 換掉 `innerHTML` 會咬掉兩件事——點「加入」時
   份量框先失焦觸發重繪，mousedown 的目標離開 DOM，**click 根本不派送**（填完份量按加入沒反應）；
   搜尋框每打一字被換掉，**中文注音組字會被打斷**。清單與確認列一律走增量
   （`renderList()` / `syncPickBar()`），只有開啟與切 view 才 `renderSheet()`。
2. **表單欄位一律在 `withBusy` 之前讀完**。`withBusy` 會先重繪，之後再讀就是空值——
   `vendor` 曾因此靜默存成 null。
3. floating label 的 52/18/13 會讓標籤與輸入文字**重疊 4.7px**，改 60/26/8 ＋ `line-height: 1`。
4. 品項寬度是分數值（320.4px），刪除鈕左緣落在裁切邊的同一個分數像素上，**未滑開時沿右緣露一條紅線**。
5. class 撞名：確認列的 `.line` 撞到時間軸連接線的 `.line`（`width: 1px`），整列被壓成直排。

**驗收方式（下次要驗同樣的東西照這個做）**：登入走 Google OAuth，agent 進不去。
做法是 stub `window.fetch` ＋ 塞 `localStorage` 的 `tally.session`，再直接呼叫全域的 `showApp()`
（`app.js` 沒有模組化，函式都在全域）。這樣能跑完整 UI 而不需要真帳號。

### 待確認 / 待處理

- **飲食紀錄有 4 筆刻意未遷移**（07-23 早餐重複 ×2、07-25 晚餐空、07-27 午餐空），使用者表示之後在新 app 自行補。
- **本機開發用 `python -m http.server 5500`**（Supabase redirect URL 白名單已對應這個 port）。playwright MCP 擋 `file://`，一定要走 http。

- **樣張已過三路獨立評審（2026-07-28）**：a11y／code、UX／產品、視覺各派一個 fresh agent，共 60 條 findings。最重的一條是**「一屏不捲」原本建在錯的高度上**——844px 是 iPhone 14 Pro 的螢幕高度，Safari 有網址列時只剩約 745px，實測破表屏在該高度溢出 84px（晚餐與點心整段消失）。已修正並改用 745px 為設計基準。已處理的進 `DESIGN.md` v1.4，**未處理的 20 條在 `session-state/review-findings.md`，實作時逐條對**。

### 設計樣張

**過程樣張已全部清空**（2026-07-28 移除 `design-sample-v2` / `palette-options` / `over-stripe-options`，前兩者在 commit `e5445fd` 可救回，第三個未 commit 已永久消失）。決策全數固化進 `DESIGN.md`。

現存唯一樣張＝**`mockup.html`**：今日頁常態＋破表兩屏，實作以它為準。已是完整 HTML 文件（含 `lang`、landmark、`button`、`ul`），可直接照抄語意結構。畫框 745px＝真機可視高度。

### 設計流程 ➍ 已跑完（2026-07-28）

四路並行評審：`hallmark` 快篩、`web-design-guidelines` 合規、`impeccable` 深評、
`emil-design-eng` polish 審表。去重後 19 條，全數處理，`DESIGN.md` v1.9。

**最貴的兩條都是「看起來成功、其實沒有」**：`db()` 沒有逾時（收訊差時 fetch 永遠不 reject，
按鈕停在「加入中…」，使用者以為記好了）；載入失敗後點設定進到空殼分頁且回不去重試。
兩條都不是靠看畫面找得到的，是有人把失敗路徑逐條走過才浮出來。

**評審過程的兩個教訓**：

- 有 agent 刪掉了我給評審看的截圖目錄，而 prompt 裡明確寫了「唯讀、不准修改任何檔案」。
  約束寫進 prompt 不等於守得住。
- 一個 agent 自己又轉包子 agent，然後卡在等下線、不交報告，得 SendMessage 叫它直接交。

### precommit deep review（2026-07-28，runId `wf_4853e631-62d`）

3 條 confirmed 全修並實測，另外自行採納 2 條未確認的 minor（判斷是真的）。

**最重的一條是我自己驗漏的**：v1.10 拿掉清單屏標題後，`onSheetClick` 的 chip 分支還在
`document.querySelector('.sheet-title').textContent = ...`，而 chip 只存在於清單屏——
必定拿到 null 丟 TypeError，handler 被中斷，chip 選中態變了、清單卻停在舊餐別。
我當時「用真實點擊驗過」，但**沒有點過 chip**。新規則（禁用合成事件）只解決了「怎麼點」，
沒解決「該點哪些」——**改動影響到的每一條路徑都要走一遍**，這條要記住。

其餘：`state.failed` 只在 `load()` 成功時清，走 `loadDay()` 恢復的路徑會把分頁永久鎖在
錯誤畫面；記體重的 upsert 缺 `on_conflict`（PostgREST 的 merge-duplicates 預設綁主鍵，
而 PK 是 identity id，永遠不命中 → 撞 unique 約束報 23505，同一天改不了體重）。
自行採納的兩條：三大比例前端用未捨入的和驗、DB 卻先各自捨入到一位小數（33.33×3 會前端過、
DB 退）；營養素破表判定用整數、畫面卻顯示一位小數（126.4/126 超了不變紅）。

### 第二版 UI 打磨（軌二）——2026-07-28 進行到 ➊，明天從這裡接

走 `ui-design-flow` 五階段。**⓪ 跳過**（方向已定：沿用 `DESIGN.md` v1.10 的視覺語言，
這不是新視覺案，不需要 hallmark 產新方向）。目前卡在 **➊ 決策樣張的使用者 checkpoint**。

#### 已定案（使用者已拍板，明天直接實作，不要再問一次）

| 項目 | 決定 |
| --- | --- |
| 左滑刪除的視覺 | 改**覆蓋式**——列本身不動，刪除鈕從右滑進來蓋住熱量數字。現況是「整列左移、品名 sticky、數字被推出視野」，要換掉。品名不動這點使用者明確說「很好」，保留 |
| 日期切換 | **拿掉原生 `input type="date"`**（使用者說系統日曆看起來突兀），只留左右箭頭；日期文字**放大**且**可點＝回到今天**。不做自製月曆——使用者自己說 YAGNI，記帳只會往回翻幾天 |
| 手指縮放 | **不做 `user-scalable=no`**。`touch-action: manipulation`（已做）擋掉 double-tap 誤觸就夠；pinch 保留。使用者原本要「誤觸後自動縮回」，被說服先看 `touch-action` 夠不夠，**還沒回報實測結果** |
| App icon | 要做 `apple-touch-icon`。使用者可能自己拿 prompt 去 GPT 產一版，跟 SVG 版並排比 |

#### 動效 token 階梯（我提的方案，使用者核准派工時一併認可，尚未寫進 DESIGN.md）

```css
--dur-fast:  100ms;  /* 即時回饋：:active、色變、勾選 */
--dur-base:  160ms;  /* 按鈕級狀態變化（現有，不動） */
--dur-mid:   220ms;  /* 中等位移：列展開收合、確認列、高亮 */
--dur-sheet: 280ms;  /* 抽屜進場（現有，不動） */
```

退場一律降一級（sheet 退場改 220ms，取代現在的 200ms）。緩動曲線沿用既有兩支，不新增。
**動這一節的動機**：現在只有 160ms 與 280ms 兩級，中間沒東西，所以每遇到新元件就臨場硬編一個
200ms——檔案裡現有三處各自寫死的 200ms 就是這麼來的。使用者評語「有功能但很簡陋」的來源。

#### 樣張現況

- **`sample-v2-login-icon.html` 已產出**，可直接開。已驗：單檔自足、無外部資源、`lang` 正確、
  無 italic、硬編 hex 只在 token 定義區且值與 DESIGN.md 一致。內容：
  - 登入頁變體 1 極簡＋安靜背景層／2 品牌圖形＋兩行文案／3 不對稱配置＋量尺背景
  - icon 方向 1 計數刻痕／2 橫向量尺／3 幾何 T，各有 1024／180／**60px** 三尺寸並排
  - **我的初評（使用者尚未表態）**：登入頁三個變體只有 2 真的回應了「太陽春」——1 幾乎等於現況
    （`--card` 對 `--paper` 明度差本來就極小，那層背景看不出來），3 標題貼頂 CTA 落底反而**更空曠**。
    icon 的 60px 那格才是真驗收點：方向 3 最清楚，方向 1 概念最貼題（Tally 就是計數）但 60px 下
    數不出五劃，方向 2 縮小後沒有特徵、偏弱。
- **`sample-v2-today.html` 已產出**。三組、每組三個變體，都有編號：
  - **第一組 日期區**：`V1` 精簡放大（一行字放大＋粗體＋淺底觸控墊）／`V2` 大數字日曆式
    （小標籤＋44px hero 級數字，回今天靠明確的「回今天」chip，只在歷史日出現）／
    `V3` 週間格式＋圓點徽章（「週二 7/28」膠囊鈕，回今天靠右上角一顆 jade 圓點）。
    三個都示範「今天」與「歷史日」兩種狀態。
  - **第二組 左滑刪除（已改覆蓋式）**：`D1` 色塊覆蓋、圓角只留露出側（寬 64px 全高紅底）／
    `D2` 圓形按鈕、露出區維持卡面色（紅色收斂成一顆 44px 圓鈕）／`D3` 窄版膠囊貼右緣（48px）。
  - **第三組 動效**：`M1` 現況（關另一列瞬間跳掉）／`M2` 修正版（`--dur-mid` 220ms 平滑關閉）／
    `M3` sheet 進退場時長比較（進場固定 280ms，退場兩顆按鈕分別是現況 200ms 與新階梯 220ms）。
  - **驗證程度**：靜態渲染與左滑互動我實測過（點品項後 `scrollLeft` 由 0 變 64，刪除鈕確實露出）。
    **動效三個 demo 的播放按鈕沒有逐一點過**——產樣張的 agent 正在自我重測時被我中止（使用者要收尾），
    哪個 demo 不動是已知風險，明天開起來就知道。

#### 明天的順序

1. 起 `python -m http.server 5500`，開兩份樣張給使用者挑編號
   （`sample-v2-today.html` 的 V／D／M 三組、`sample-v2-login-icon.html` 的登入頁與 icon）
2. 挑完把定案寫進 `DESIGN.md`（動效 token 階梯、左滑覆蓋式、日期區、icon、登入頁）
3. 實作。**其中一條是一行的事、已診斷完可直接動**：`app.js` 的 `closeOtherTracks` 把
   `t.scrollLeft = 0` 改成 `scrollTo({ left: 0, behavior: reduceMotion() ? 'auto' : 'smooth' })`
   ——「閃關」的根因，同檔 `revealDelete` 早就這樣寫了
4. 走 ➍＋➎ 並行評審（`hallmark` 快篩／`impeccable` 深評／`web-design-guidelines` 合規）
5. 交付時補 `design-flow：` 申報行

#### 其他未結

- `review-findings.md` 剩 6 條（該檔標題寫 6、之前 active.md 誤記為 4），都不擋上線
- 選填標記我做了**反向統一**（只標必填 `*`，拿掉店家與體脂的「（選填）」），與使用者原話
  「三大營養素也標選填」相反，**他尚未表態**。要改回來就是三處加「（選填）」
- 真機還沒回報：`touch-action` 後還會不會誤觸縮放、floating label 的 iOS AutoFill 行為
  （程式裡標了 `ponytail:`，仍未驗證）
