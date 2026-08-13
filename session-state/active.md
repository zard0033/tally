# Tally — session state

最後更新：2026-08-13（v2.38 已上線；scrim 模糊與邊框裁決兩題結案回寫 DESIGN.md v2.39；
使用者提兩個新需求，均未開工——見待決）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；2026-07-30 手術前的
> 完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯＋每日目標計算引擎＋食品庫管理
  與設定頁重構。逐版細節一律看 DESIGN.md 版本紀錄，這裡不再複述。
  **已上線＝v2.38**（`73b923f`，含雙語 README）；本機 v2.39 是純文件結案、無程式改動。
  仍在生效的兩條地基：走 vaul 的 sheet 一律 `repositionInputs={false}`、sheet 的 top 吃 `--vvtop`
  （iOS 鍵盤三題已真機驗過結案）；診斷用的 `?debug` 讀數列已整組移除，要用從 git 撿。
- **測試**：`npx vitest run` 64/64；`npm run build`／`npm run lint` 乾淨；`npm run e2e`
  **74/74 全綠**（約 1.3 分，十個 spec 檔；**條數以實跑輸出為準**——2026-08-12 又漏算一條
  被 review 抓到，改文件前先跑一次比心算快）。各檔涵蓋範圍見 CLAUDE.md。
  **測試條數（74／10 檔／64）有三份文件在寫**（CLAUDE.md、本檔、兩份 README），改條數要一次改到底；
  DESIGN.md 版號刻意不寫進 README——每輪 UI 都 bump，寫死必過期。

## 已驗證事實

- **e2e 撞牆兩層，都已從根上處理（v2.25）**：後端＝dev server OOM（改跑 `vite preview`）、
  前端＝WebKit 塞不下記憶體（`workers: 2` 守這層，**別拿掉**）。**兩層都表現成「Playwright
  壞了」，真兇兩次都不在 Playwright**——先讀 `[WebServer]` 那幾行、再量機器餘裕。
- **app icon 已結案（v2.26，全文在 DESIGN.md v2.19–v2.26）**：透明底兩種模式都被填黑。
  教訓：①「別的 app 也這樣嗎」這個對照組省掉四輪 ② 高成本驗證迴圈裡，回頭看已經觀察到
  什麼比生一個新猜測值錢。
- **抽共用元件的判準**（v2.29 `FoodFormFields`）：兩份長得像**不**構成抽出來的理由，
  「本來就該一致、且已經開始不一致」才是——那次的觸發點是已經分岔過兩次。
- **修分岔的那一輪，最容易製造新的分岔**（v2.29 三條，兩條自造）：抽共用元件時又抄了一份
  去重邏輯；`role="status"` 掛在 `<button>` 上（**顯式 role 取代隱含 role**，讀屏找不到那顆
  按鈕）；放寬 undo pill 蓋住 FAB。**共同形狀：只盯著要修的缺陷，沒重新檢查它跟周圍的關係。**
- **新測試一律做 mutation 檢查才收**（v2.24 起每輪都做）：把受測行為改回舊樣子，確認對應
  測試變紅、其餘不誤報。**綠色測試不等於有效測試。** v2.33 那次它直接推翻假設——
  **mutation 不只驗測試有沒有效，也會告訴你它守的其實是哪一道防線**。
- **版面問題要量對東西**（2026-08-05 三處真機回報）：① 圖示「沒對齊」偏的是 SVG **筆畫**
  在 viewBox 裡的位置，量元素框查不出來（用 `getBBox()`）② `select` 文字放不下不會有
  ellipsis，只是安靜切掉 ③ 全域元件搬進新容器要重驗（`.pick-bar-btn` 進 flex row 溢出
  96px）。**照肉眼改，①會改錯地方、③會整條漏掉。**
- **`backdrop-filter` 在 headless WebKit 裡靜默無效，真機是好的**（v2.38 診斷六輪，v2.39
  真機確認結案）：computed style 一切正常（值拉到 40px 照樣回報），截圖就是不糊。
  **可複用判準：computed style 正常 ＋ 截圖無效果 ＋ 對照實驗互相矛盾＝先懷疑環境，不是修法。**
  副作用：scrim 模糊**在 e2e 裡驗不到，別為它寫視覺斷言**。
- **e2e stub（`e2e/stub.ts`）不看 query 參數／filter**，只按 table+method 回同一份 fixture。
  兩個後果：食品庫的分頁資料差異測不了；`intake` 的 PATCH 不反映在後續 GET，所以**任何
  「重整後還在」的斷言都驗不到真持久化**，只驗得到 App 本地 state 與 `cacheRef`。
- **screens 新增子頁不必上 router**：Settings.tsx 自己管 `view` state，同 App.tsx 的 `tab`。
- **把 DB 上分開的兩欄在 UI 層合併成聯集型別（v2.22 `GoalMode`）**型別漂亮，但使用者覺得
  難用；事後拆要跨三處，比想像中貴。
- **RLS 已驗，此題結案**（2026-08-05 使用者實跑 `pg_policies`／`pg_class`：四張表各一條
  `owner_all`、無第二條 permissive policy、RLS 全開）。**判準（可複用）**：要驗的若是資料庫
  自己的執行行為而非我們的程式碼，把設定查完整就是充分證據；跨帳號 runtime 測試留給
  「policy 判斷式本身有條件分支」那種情況。
- **選中態語意在本專案的統一裁決（v2.30）**：互斥選一組一律 `aria-pressed`，容器不掛
  `role="tablist"`；`aria-current` 只留給底部分頁列（真的在換頁）。**沒有補成完整 tablist
  是刻意的**——APG 契約要 roving tabindex ＋方向鍵 ＋ `aria-controls`，半套會讓讀屏期待
  方向鍵可用卻沒有，比不做更糟（與 v2.24 拒絕升級 radiogroup 同一個判斷）。
- **「select 保證合法值」只涵蓋一半的路徑**（v2.30）：v2.22 拿掉自訂輸入後移除範圍檢查，
  理由是選單保證合法——但 `xTouchedRef` 沒被碰過時走的是 **DB 原值**那條分支，那個值
  沒有人驗過。新增 `clampToPresetRange()` 補上。**通則：拿「輸入源受控」當理由移除驗證前，
  先數清楚有幾條路徑通到那個變數**，受控的通常只有其中一條。
- **已升格 DESIGN.md、這裡只留指標**：真機讀數的兩個判讀陷阱（v2.36——`getBoundingClientRect()`
  相對 visual viewport／指紋要先於一切數字被檢查）、motion 不把 drag 速度交給接手的 spring（v2.38）。

## 未解失敗

- 舊的未解失敗（vitest Git Bash 炸、scrim 分區變色、改份量無 debounce）維持原狀未動，
  細節見 git log 對應 commit 訊息。**已結案、別再撿回來的**：app icon、就地編輯區的
  focus trap（inline 展開本來就不該有，那是 modal 的契約）、scrim 模糊（見上）、
  `.tabbar`／`.datectl` 邊框（維持安靜，DESIGN.md v2.39）。

## 待決問題

- **[新需求 2026-08-13 · 未開工] 預先記錄明天的飲食**：情境是「今天先安排明天吃什麼，
  看會不會超過額度、怎麼搭配」。**直接撞上一條既有決策**——`App.tsx:258`「看不了未來」
  ＋ DESIGN.md「日期切換」條的右箭頭在今天停用，e2e 也鎖了。**要問的分岔是 plan vs actual**
  （預記的算不算已攝取）；我的推薦是最懶版：解鎖未來日期、預記就是明天那天的普通 intake，
  額度預警與每日目標引擎本來就是逐日算的，「看會不會超過」零新邏輯就有。
  **屬中大型、走 dev-flow。**
- **[新需求 2026-08-13 · 未開工] 拍照讀營養標示自動填表**：使用者說 OCR，實際上該用
  多模態視覺模型讀圖回結構化 JSON（CJK 標示表格版面雜亂，傳統 OCR 不可靠）。
  **真正的成本是它需要後端**：repo 是 public、前端只有 anon key，視覺 API 金鑰只能放
  Supabase Edge Function——那會是本專案第一個後端元件，**且必須驗 Supabase JWT**，
  否則等於開放任何人白用付費 API。拍照本身不需要 PWA（`<input type="file" accept="image/*"
  capture="environment">` 在 iOS Safari 直接開相機）。與續點 1 的 PWA **無先後相依**。
- **體重趨勢完整圖表仍是佔位卡**：要過 `dataviz` 定案才能做，樣張在
  `_design-sample/food-library.html` A3 frame；e2e 刻意只驗進出不鎖內容。
  **零碎（不擋上線）**：Notion 退場收尾未完成。

## 下次續點

1. **PWA / service worker：★核可已通過，實作零進度**（2026-08-05 收工於此）。
   走完 dev-flow 前段，**規模判為「大」**（壞掉的 SW 會把舊版鎖在使用者手機上＝不可逆）。
   **範圍（使用者裁決）**：離線可讀 ＋ 冷啟動加速；更新走「下次開啟自動換」。
   **Musk 視角砍掉的兩件事，別在下一輪又長回來**：
   ① 不承諾「變快」——assets 檔名帶 hash，HTTP cache 已經蓋住重複載入，SW 只多買到
      `index.html` 那一跳，量不出來的東西不寫進 AC。
   ② **SW 不快取 Supabase API 回應**——App.tsx 已有 `cacheRef` 日期快取，兩層快取壽命
      不同必然對不上；且 SW 那層是透明的，App 拿到舊資料時不知道它舊，就無法誠實標示。
      離線資料改由 `cacheRef` 持久化到 localStorage 供給，一層快取、App 自己知道新舊。
   **AC 六條、plan 六步的全文只存在於 2026-08-05 那次對話，已經撈不回來——下一輪直接
   重跑一次 spec**（範圍與上面兩條砍除決策仍有效，不必重談）。**已定的補遺**：SW 放
   `public/` 以 `./sw.js` 註冊（scope 跟著 `base: '/tally/'`）；登出時一併清掉快照
   （掛在 App.tsx 既有的 `cacheRef.clear()` 旁）；
   **實作第一步必須先實測「離線時 supabase-js 會不會把 App 踢回登入頁」**——這是唯一可能
   推翻整個設計的未知數，探針已寫好但**還沒跑**：
   `<scratchpad>/probe-offline-auth.mjs`（跑兩種 session：未過期／已過期，因為分歧點在
   supabase-js 要不要為了 refresh 打網路；需要 `npm run preview` 起在 5501）。
   **這條有 UI**（離線指示條），實作階段照 dev-flow 鐵律 4 轉 `ui-design-flow`。

2. 上面兩個新需求要不要開工、先做哪個，等使用者定。

3. 體重趨勢完整圖表尚未開工，要先過 `dataviz` 定案。

4. **待刪（v2.38 的一次性產物，結案條件已滿足，等使用者點頭）**：
   [ios-gap-analysis.md](ios-gap-analysis.md)、`_design-sample/ios-tuning-compare.html`。
   **刪之前先 grep 這兩個檔名**——已知引用點至少三處：DESIGN.md 版本紀錄最後那條
   「對照 demo 現況」（要改）、v2.38 那條（歷史紀錄，留著）、`app.css` scrim 註解裡
   「16px 這個值的來源」那句（自行判斷要不要拿掉路徑）。

**dev-flow 申報（PWA 這條，未完成）**：規模<大> 視角<兩者：Jobs 在釐清翻出「加 PWA」是技術
描述不是使用者利益、逼出三選一的範圍題；Musk 在 spec 砍掉上述兩件事> 釐清<完成，AskUserQuestion
兩題> spec<完成，AC 六條> plan<完成，六步> ★核可<通過> 實作<未開始> 收尾<未到> 蒸餾<見下>

**蒸餾（前四條關於「停在第一個看起來對的答案」，②③ 全文已升格 DESIGN.md v2.33／v2.34）**：
① 待決清單記的位置往往只是「當時看到的那一處」，**收零碎項時要重搜一次**（`aria-current`）。
② 症狀有兩個面向時，一個原因解釋得通不代表另一個面向也被它解釋了；③ **懷疑「我寫的 CSS
沒生效」時先查有沒有第三方在寫 inline style**；④ **真機回報的因果先擱著，直接問「還有哪裡
不一樣」**（v2.35「注音會推、數字不會」其實是欄位位置）——而**症狀清單本身就是線索：追第一條
之前先看它們有沒有共同的上游**（三題最後同一個開關）。⑤ **交付形式錯了，內容再對也沒用**
（v2.38：微調類的選項給文字清單，使用者的回應是「講太多我都聽不懂的東西」——**可摸的對照
demo 才是這類決策的正確載體**，而且要我先做、不是等他要求）。⑥ **v2.39 新增：診斷六輪停手是
對的**——computed style 正常而畫面無效果、對照實驗互相矛盾，那是環境差異的形狀，繼續跑只會
得到第七個矛盾。**停手時把「真機若也沒效，從哪裡試起」寫下來，這輪才有得對帳。**

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄）。動 UI 前必讀，改完
  必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **三本全域 ledger memory**：Windows/PowerShell 坑 `windows-shell-ledger`、驗證方法坑
  `verification-ledger`（＋`ui-verify` skill）、委派坑 `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：三層（樣張核可／真機試用／deep review）
  各自抓到不同類的問題，樣張資料太乾淨，測不出真實資料才會浮現的。
