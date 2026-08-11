# Tally — session state

最後更新：2026-08-11（v2.30 已 push；v2.31 就地編輯品名／營養值待 push）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；2026-07-30 手術前的
> 完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯＋每日目標計算引擎（v2.21→
  v2.23 三輪演進）＋食品庫管理與設定頁重構（v2.22）。細節見 DESIGN.md 版本紀錄。
  **已上線＝v2.30**（`a7ddb26`）；**v2.31 待 push**＝今日頁就地編輯區加品名與四個營養數字
  （只動那一筆 intake，不動 foods），含 schema 變更 `intake.name`。
- **測試**：`npx vitest run` 64/64；`npm run build`／`npm run lint` 乾淨；`npm run e2e`
  **65/65 全綠**（約 1.5 分，十個 spec 檔）。長年偶發的 `meal-exit-animation` flaky 在
  worker 壓到 2 之後穩定了——根因是並行壓力，不是動畫時序。各檔涵蓋範圍見 CLAUDE.md。
- **e2e 的跑法（v2.25 改）**：webServer 跑 `npm run build && npm run preview`，站在
  **port 5501**，跟開發用的 5500 分開——所以 `npm run dev` 可以一直開著不必為了跑測試關掉。

## 已驗證事實

- **e2e 撞牆兩層，兩層都已從根上處理（v2.25）**：`fullyParallel: false` 下平行單位是**檔案**，
  加到第 9 個 spec 檔就是 9 個 worker。**後端**——Vite dev server 自己 OOM 死掉，但瀏覽器端
  看到的是 `Could not connect to server`（**症狀在前端、死因在後端**）；已改跑 build 後的
  `vite preview`（沒有現場轉譯就沒有 OOM），port 分到 5501，因此 `reuseExistingServer` 得以
  改成 `false`，孤兒 server 的陷阱從人工提醒變成機械上不可能。**前端**——WebKit 自己倒
  （`Cannot find parent object page@…`），量了才知道機器當下只剩 5.0 GB 可用塞不下 4 個實例；
  `workers: 2` 守的是這層，跟 server 怎麼跑無關，**別拿掉**。
  **教訓**：兩層都表現成「Playwright 壞了」，真兇兩次都不在 Playwright——先讀 `[WebServer]`
  那幾行、再量機器餘裕，比改測試碼快得多。
- **app icon 已結案（v2.26 實機確認）**：黑底白 T 的根因是 iOS 系統的深色圖示設定會染全機
  每一顆圖示，**不是 Tally 的缺陷**，web clip 沒有任何退出機制。iOS 對 web clip 的行為是
  **換掉背景、保留前景顏色**，所以正解＝不透明淺色底（淺色見米白底綠 T，深色由 iOS 換底、
  綠 T 留著）。**透明底反而更糟**（兩種模式都被填黑），別再試。已排除且不必重試的四條假設：
  透明像素／檔案沒部署／SpringBoard 快取／alpha 通道。細節見 v2.19–v2.26 commit 訊息。
  **兩個可複用的教訓**：① 症狀只出現在單一 app 不代表原因在那個 app——「別的 app 也這樣嗎」
  這個對照組省得掉四輪。② 高成本驗證迴圈（每輪要部署＋真機重加）裡，**回頭看已經觀察到什麼
  比生一個新猜測值錢**——兩次縮短路徑的都是重讀舊觀察。
- **食物表單三處共用一份 JSX（v2.29）**：`src/components/FoodFormFields.tsx`。抽出來的觸發點
  不是「看起來重複」，是**已經分岔過兩次**（品名欄漏 `inputMode`、食品庫那份沒有店家
  Autocomplete）。**判準**：兩份長得像不構成抽出來的理由，「本來就該一致、且已經開始不一致」才是。
- **修分岔的那一輪，最容易製造新的分岔**（v2.29 deep review 抓到三條，兩條是本輪自造）：
  抽共用元件的同時又照抄一份去重邏輯；修無障礙時把 `role="status"` 掛在 `<button>` 上
  （**顯式 role 取代隱含 role**，讀屏反而找不到那顆按鈕）；放寬 undo pill 導致蓋住 FAB。
  **共同形狀：改動的當下只盯著要修的那個缺陷，沒有重新檢查它跟周圍元件的關係。**
- **新測試一律做 mutation 檢查才收**（v2.24／v2.27／v2.30 三輪都做）：把受測行為改回舊樣子，
  確認對應測試變紅、其餘不誤報。**綠色測試不等於有效測試**，每次補測試都值得做這一步。
- **版面問題要量對東西**（2026-08-05 三處真機回報的共同教訓）：① 圖示「看起來沒對齊」時量
  元素框永遠查不出來，偏的是 SVG **筆畫**在 viewBox 裡的位置（用 `getBBox()` 量重心）。
  ② `select` 文字放不下**不會有 ellipsis，只是安靜切掉**，肉眼 review 抓不到，只能量
  「最長選項需要多寬」對「欄位給多寬」。③ 全域元件搬進新容器要重驗（`.pick-bar-btn` 在
  底部確認列對、進 flex row 溢出 96px）。**照肉眼判斷去改，①會改錯地方、③會整條漏掉。**
- **e2e 的 fetch stub（`e2e/stub.ts`）完全不看 query 參數/filter**，只按 table+method 分流回同一份
  fixture——所以 `food-library.spec.ts` 的資料斷言只用「使用中」分頁，兩個分頁的資料差異在
  stub 升級前測不了（測了只會鎖住 stub 的行為）。
- **screens 目錄下新增子頁不必上 router 套件**：Settings.tsx 自己管一個 `view` state，跟 App.tsx
  的 `tab` 同一種「沒有 URL 的路由」。代價是那行 unmount cleanup（`onSubViewChange(false)`）
  目前 **UI 走不到**（底部列已收起、也沒有 URL 可繞），所以刻意沒為它寫測試。
- **把 DB 上分開的兩個欄位在 UI 層合併成模板字面量聯集型別（v2.22 的 `GoalMode`）**短期型別
  安全漂亮，但使用者實際用起來覺得「一個選單塞兩件事」不好用；拆回兩欄位要跨 formulas.ts
  ／DailyGoal.tsx／test 三處，事後拆比想像中貴。設計合併型 UI 前先想清楚。

- **RLS 已驗，此題結案**（2026-08-05，使用者在 Supabase SQL Editor 實跑）：`pg_policies`
  查出 `public` schema 底下**總共只有四條 policy**（foods／intake／weight／profile 各一條
  `owner_all`），每條都是 `cmd = ALL`、`qual` 與 `with_check` 皆為 `auth.uid() = user_id`，
  與 `schema.sql` 逐字一致；`pg_class.relrowsecurity` 四張表皆 `true`。
  **`ALL` 涵蓋 DELETE，`qual` 就是 DELETE 走的判斷式**，而且沒有第二條 permissive policy
  可以繞過去——設定面完整，原本記的「跨使用者 DELETE 未實測」不再是缺口。
  **判準（可複用）**：要驗的東西如果是**資料庫自己的執行行為**而不是我們的程式碼，
  把設定查完整（policy 全集 ＋ RLS 開關）就是充分證據；再跑一次 runtime DELETE 只是
  重新確認 Postgres 是 Postgres。跨帳號 runtime 測試留給「policy 判斷式本身有條件分支」
  那種情況——這裡沒有。
- **選中態語意在本專案的統一裁決（v2.30）**：互斥選一組一律 `aria-pressed`，容器不掛
  `role="tablist"`；`aria-current` 只留給底部分頁列（真的在換頁）。**沒有補成完整 tablist
  是刻意的**——APG 契約要 roving tabindex ＋方向鍵 ＋ `aria-controls`，半套會讓讀屏期待
  方向鍵可用卻沒有，比不做更糟（與 v2.24 拒絕升級 radiogroup 同一個判斷）。
  **附帶發現**：筆記只記了 LogSheet 一處，實際上食品庫的使用中／已封存也是同樣的錯——
  **待決清單記的位置往往是「當時看到的那一處」，不是全部，收的時候要重搜一次**。
- **「select 保證合法值」只涵蓋一半的路徑**（v2.30）：v2.22 拿掉自訂輸入後移除範圍檢查，
  理由是選單保證合法——但 `xTouchedRef` 沒被碰過時走的是 **DB 原值**那條分支，那個值
  沒有人驗過。新增 `clampToPresetRange()` 補上。**通則：拿「輸入源受控」當理由移除驗證前，
  先數清楚有幾條路徑通到那個變數**，受控的通常只有其中一條。

## 未解失敗

- 舊的未解失敗（vitest Git Bash 炸、scrim 分區變色、就地編輯區無 focus trap、改份量無
  debounce）維持原狀未動，細節見 git log 對應 commit 訊息。（app icon 已結案，見上方。）

## 待決問題

- **體重趨勢完整圖表仍是佔位卡**：要過 `dataviz` skill 定案才能做，樣張在
  `_design-sample/food-library.html` A3 frame。e2e 刻意只驗進出不鎖內容。
- **零碎（不擋上線）**：Notion 退場收尾未完成。
- **食物表單在 iOS 被鍵盤蓋住（2026-08-11 真機回報）**：新增食物 sheet 鍵盤彈出後，
  蛋白質／脂肪／碳水那排被「加入食品庫」按鈕壓掉——**sheet 高度沒吃 `visualViewport` 縮減**。
  iOS 表單列上下箭頭「跳得不順」是同一病灶的表徵：DOM 順序已核對正確（品名→店家→熱量→蛋白
  →脂肪→碳水），跳過去了但看不到；次要嫌疑是店家 Autocomplete `openOnInputClick`。
  **桌面 WebKit 模擬不出 `visualViewport`，playwright 看到的是假的，只能真機驗**。影響共用
  `FoodFormFields` 的三處。刻意與 intake 就地編輯拆開（位置不同、驗證節奏不同）。

## 下次續點

1. **v2.31 實作與測試已完成，待走 push 流程**（review → push）。今日頁就地編輯區加
   品名／熱量／蛋白質／脂肪／碳水，只 PATCH 那一筆 intake、foods 零寫入。
   **schema 已由使用者實跑**：`alter table intake add column name text;`（`null` ＝沿用
   `foods.name`，既有資料零回填）。vitest 64/64、e2e 65/65、build／lint 乾淨；新增的 6 條
   e2e 做過兩輪 mutation 檢查。設計決策與撤銷的 v2.20 判例已寫進 DESIGN.md v2.31。
   **實作偏離 AC 一處要申報**：AC 原寫「數字欄填錯顯示『存不進去』」，實作改成**當場還原
   該欄＋sr-only 播報**——「存不進去」是 PATCH 失敗專用句，借來說「你打錯了」會讓兩種
   完全不同的狀況長得一樣。

2. **PWA / service worker：★核可已通過，實作零進度**（2026-08-05 收工於此）。
   走完 dev-flow 前段，**規模判為「大」**（壞掉的 SW 會把舊版鎖在使用者手機上＝不可逆）。
   **範圍（使用者裁決）**：離線可讀 ＋ 冷啟動加速；更新走「下次開啟自動換」。
   **Musk 視角砍掉的兩件事，別在下一輪又長回來**：
   ① 不承諾「變快」——assets 檔名帶 hash，HTTP cache 已經蓋住重複載入，SW 只多買到
      `index.html` 那一跳，量不出來的東西不寫進 AC。
   ② **SW 不快取 Supabase API 回應**——App.tsx 已有 `cacheRef` 日期快取，兩層快取壽命
      不同必然對不上；且 SW 那層是透明的，App 拿到舊資料時不知道它舊，就無法誠實標示。
      離線資料改由 `cacheRef` 持久化到 localStorage 供給，一層快取、App 自己知道新舊。
   **AC 六條、plan 六步、補遺三條的全文在本次對話**，沒有落成檔案——下一輪要嘛從對話撈，
   要嘛重跑一次 spec。**已定的三條補遺**：SW 放 `public/` 以 `./sw.js` 註冊（scope 跟著
   `base: '/tally/'`）；登出時一併清掉快照（掛在 App.tsx:557 既有的 `cacheRef.clear()` 旁）；
   **實作第一步必須先實測「離線時 supabase-js 會不會把 App 踢回登入頁」**——這是唯一可能
   推翻整個設計的未知數，探針已寫好但**還沒跑**：
   `<scratchpad>/probe-offline-auth.mjs`（跑兩種 session：未過期／已過期，因為分歧點在
   supabase-js 要不要為了 refresh 打網路；需要 `npm run preview` 起在 5501）。
   **這條有 UI**（離線指示條），實作階段照 dev-flow 鐵律 4 轉 `ui-design-flow`。

3. 體重趨勢完整圖表尚未開工，要先過 `dataviz` 定案。

**dev-flow 申報（PWA 這條，未完成）**：規模<大> 視角<兩者：Jobs 在釐清翻出「加 PWA」是技術
描述不是使用者利益、逼出三選一的範圍題；Musk 在 spec 砍掉上述兩件事> 釐清<完成，AskUserQuestion
兩題> spec<完成，AC 六條> plan<完成，六步> ★核可<通過> 實作<未開始> 收尾<未到> 蒸餾<見下>

**本輪蒸餾**：待決清單記的位置往往只是「當時看到的那一處」——`aria-current` 筆記只記了
LogSheet，實際上食品庫也有；**收零碎項時要重搜一次，不要照著筆記逐條修完就當收完**。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄）。動 UI 前必讀，改完
  必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑** → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑** → 全域 memory `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出只有真實
  資料才會浮現的問題；三層（樣張核可／真機試用／deep review）各自抓到不同類的問題。
- 完整的歷史病歷 → `archive-2026-07.md`。
