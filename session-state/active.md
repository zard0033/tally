# Tally — session state

最後更新：2026-08-12（v2.31–v2.33 全數已 push；四項待真機驗，見續點 1）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；2026-07-30 手術前的
> 完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯＋每日目標計算引擎（v2.21→
  v2.23 三輪演進）＋食品庫管理與設定頁重構（v2.22）。細節見 DESIGN.md 版本紀錄。
  **已上線＝v2.33**（`90d82fd`）＝就地編輯區加品名與營養值（schema 加 `intake.name`）、
  控件邊界統一 `--rule-field`、iOS 鍵盤兩題（sheet 吃 `--kb` ＋ 多欄輸入包 `<form>`）。
- **測試**：`npx vitest run` 64/64；`npm run build`／`npm run lint` 乾淨；`npm run e2e`
  **72/72 全綠**（約 1.5 分，十個 spec 檔；**條數以實跑輸出為準**——2026-08-12 又漏算一條
  被 review 抓到，改文件前先跑一次比心算快）。各檔涵蓋範圍見 CLAUDE.md。
- **e2e 的跑法（v2.25 改）**：webServer 跑 `npm run build && npm run preview`，站在
  **port 5501**，跟開發用的 5500 分開——所以 `npm run dev` 可以一直開著不必為了跑測試關掉。

## 已驗證事實

- **e2e 撞牆兩層，都已從根上處理（v2.25）**：後端＝dev server OOM（改跑 `vite preview`）；
  前端＝WebKit 實例塞不下記憶體（`workers: 2` 守這層，**別拿掉**）。**教訓**：兩層都表現成
  「Playwright 壞了」，真兇兩次都不在 Playwright——先讀 `[WebServer]` 那幾行、再量機器餘裕。
- **app icon 已結案（v2.26）**：根因是 iOS 深色圖示設定染全機；正解＝不透明淺色底，
  **透明底兩種模式都被填黑，別再試**。全文見 DESIGN.md v2.19–v2.26。**兩個可複用教訓**：
  ① 症狀只出現在單一 app 不代表原因在那個 app——「別的 app 也這樣嗎」這個對照組省掉四輪。
  ② 高成本驗證迴圈裡，**回頭看已經觀察到什麼比生一個新猜測值錢**。
- **抽共用元件的判準**（v2.29 `FoodFormFields`）：兩份長得像**不**構成抽出來的理由，
  「本來就該一致、且已經開始不一致」才是——那次的觸發點是已經分岔過兩次。
- **修分岔的那一輪，最容易製造新的分岔**（v2.29 三條，兩條自造）：抽共用元件時又抄了一份
  去重邏輯；`role="status"` 掛在 `<button>` 上（**顯式 role 取代隱含 role**，讀屏找不到那顆
  按鈕）；放寬 undo pill 蓋住 FAB。**共同形狀：只盯著要修的缺陷，沒重新檢查它跟周圍的關係。**
- **新測試一律做 mutation 檢查才收**（v2.24 起每輪都做）：把受測行為改回舊樣子，確認對應
  測試變紅、其餘不誤報。**綠色測試不等於有效測試。** v2.33 有一次它直接推翻了假設：新加的
  「Enter 不會送出」鎖，塞一顆漏標 `type` 的按鈕照樣綠，要連 `preventDefault` 一起拿掉才紅
  ——**mutation 不只驗測試有沒有效，也會告訴你它守的其實是哪一道防線**（那條現況恆綠，
  留著的理由寫在測試註解裡，沒有假裝它在守別的東西）。
- **版面問題要量對東西**（2026-08-05 三處真機回報）：① 圖示「沒對齊」量元素框查不出來，
  偏的是 SVG **筆畫**在 viewBox 裡的位置（`getBBox()` 量重心）。② `select` 文字放不下
  **不會有 ellipsis，只是安靜切掉**。③ 全域元件搬進新容器要重驗（`.pick-bar-btn` 在底部
  確認列對、進 flex row 溢出 96px）。**照肉眼改，①會改錯地方、③會整條漏掉。**
- **e2e stub（`e2e/stub.ts`）不看 query 參數／filter**，只按 table+method 回同一份 fixture。
  兩個後果：食品庫的分頁資料差異測不了；`intake` 的 PATCH 不反映在後續 GET，所以**任何
  「重整後還在」的斷言都驗不到真持久化**，只驗得到 App 本地 state 與 `cacheRef`。
- **screens 新增子頁不必上 router**：Settings.tsx 自己管 `view` state，同 App.tsx 的 `tab`。
- **把 DB 上分開的兩欄在 UI 層合併成聯集型別（v2.22 `GoalMode`）**型別漂亮，但使用者覺得
  「一個選單塞兩件事」難用；拆回去要跨三處，事後拆比想像中貴。先想清楚再合併。
- **RLS 已驗，此題結案**（2026-08-05，使用者在 SQL Editor 實跑 `pg_policies` 與 `pg_class`）：
  四張表各一條 `owner_all`（`cmd = ALL`、`qual`／`with_check` 皆 `auth.uid() = user_id`），
  無第二條 permissive policy，RLS 全開。**判準（可複用）**：要驗的若是**資料庫自己的執行
  行為**而非我們的程式碼，把設定查完整（policy 全集 ＋ RLS 開關）就是充分證據；再跑一次
  runtime DELETE 只是重新確認 Postgres 是 Postgres。跨帳號 runtime 測試留給「policy
  判斷式本身有條件分支」那種情況——這裡沒有。
- **選中態語意在本專案的統一裁決（v2.30）**：互斥選一組一律 `aria-pressed`，容器不掛
  `role="tablist"`；`aria-current` 只留給底部分頁列（真的在換頁）。**沒有補成完整 tablist
  是刻意的**——APG 契約要 roving tabindex ＋方向鍵 ＋ `aria-controls`，半套會讓讀屏期待
  方向鍵可用卻沒有，比不做更糟（與 v2.24 拒絕升級 radiogroup 同一個判斷）。
- **「select 保證合法值」只涵蓋一半的路徑**（v2.30）：v2.22 拿掉自訂輸入後移除範圍檢查，
  理由是選單保證合法——但 `xTouchedRef` 沒被碰過時走的是 **DB 原值**那條分支，那個值
  沒有人驗過。新增 `clampToPresetRange()` 補上。**通則：拿「輸入源受控」當理由移除驗證前，
  先數清楚有幾條路徑通到那個變數**，受控的通常只有其中一條。

## 未解失敗

- 舊的未解失敗（vitest Git Bash 炸、scrim 分區變色、改份量無 debounce）維持原狀未動，
  細節見 git log 對應 commit 訊息。（app icon 已結案，見上方。）
- **「就地編輯區無 focus trap」2026-08-12 重新評估後結案：不做**。原始動機（v2.14 長按
  sheet 時背景可換日期→寫到錯的那一筆）已被 `App.tsx` 寫入前守門與 v2.20 的 inline 結構
  補過兩次；而 **inline 展開本來就不該有 focus trap**，那是 modal 的契約。留著只會讓後來
  的人以為還有洞沒補。

## 待決問題

- **體重趨勢完整圖表仍是佔位卡**：要過 `dataviz` skill 定案才能做，樣張在
  `_design-sample/food-library.html` A3 frame。e2e 刻意只驗進出不鎖內容。
- **零碎（不擋上線）**：Notion 退場收尾未完成。
- **`.tabbar` 與 `.datectl` 的邊框要不要比照 v2.32 加深？**（2026-08-12 review 提出）兩者
  仍是 `--rule`，對 `--paper` 只有 1.37:1。但它們是**導覽類容器**不是資料輸入控件，而且
  v2.4 明訂日期膠囊「是安靜的，不與 44px 主數字搶重量」——加深會直接撞掉那個決策。
  **這是取捨題不是 bug**，要你裁決：維持安靜、或讓它過 3:1 但變顯眼。在裁決之前
  DESIGN.md 那條規則已刻意限縮成「資料輸入控件」，不寫「一律」。
- **iOS 表單兩題，修法都已寫、都待真機驗**（v2.32／v2.33，**兩題是獨立的**，一開始被我
  誤判成同一個）：① sheet 被鍵盤蓋住 → `.sheet` 的 `bottom` 改吃 `--kb`（`visualViewport`）；
  ② 上下箭頭切到一半斷掉 → 多欄輸入包 `<form>`。**桌面兩題都重現不了**：沒有鍵盤、沒有
  accessory bar，e2e 只守得住「CSS 接線沒斷」與「結構有包 form」。驗法：開新增食物 →
  點品名 → 一路按「下一個」，要能一路走到碳水；同時底部欄位看得見或捲得到、「加入食品庫」
  浮在鍵盤上方。**②若仍然斷**，次一個嫌疑是店家 Autocomplete 的 `openOnInputClick`
  （聚焦即開下拉，Portal 掛載時機可能打斷 Safari 的欄位分組）。

## 下次續點

1. **下一次開手機一口氣驗四件事**（v2.31–v2.33 全數已 push 於 `d3ab439`）：
   ① `intake.name` 在線上 DB 存不存在（今日頁載不出來就是它）；② 編輯區四排框線同色；
   ③ 新增食物表單底部欄位不再被鍵盤壓掉；④ 上下箭頭從品名一路走到碳水不斷。
   ③④ 驗法見待決那條。四件都只能真機驗，刻意併成同一次部署。

2. **「做起來更有 iOS app 質感」——已談定範圍，尚未開工**（2026-08-12 使用者提出）。
   範圍是**五個面向全部**：彈簧物理的滑動手感、半透明材質與模糊、大標題摺疊、觸覺回饋
   節奏、圖示與字重細節。**下一步是盤點差距清單，不是動手改**——每項寫「現在長怎樣／
   iOS 原生怎麼做／改哪裡／值不值得」，使用者挑完才進 `ui-design-flow` 出樣張。
   **不要直接叫 `apple-design` 或 `emil-design-eng`**：那兩支是 ui-design-flow ➌ 的參考
   工具，單獨叫只會得到一堆通用建議，然後照著改一輪、看到成品才發現方向不對（這是
   2026-08-12 當場否決過的做法）。整體感覺要換的任務走 ui-design-flow 全套，第一關就是
   給樣張再動工。**➍ 至今從未執行過**，這輪會是第一次真的跑它。

3. **PWA / service worker：★核可已通過，實作零進度**（2026-08-05 收工於此）。
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

4. 體重趨勢完整圖表尚未開工，要先過 `dataviz` 定案。

**dev-flow 申報（PWA 這條，未完成）**：規模<大> 視角<兩者：Jobs 在釐清翻出「加 PWA」是技術
描述不是使用者利益、逼出三選一的範圍題；Musk 在 spec 砍掉上述兩件事> 釐清<完成，AskUserQuestion
兩題> spec<完成，AC 六條> plan<完成，六步> ★核可<通過> 實作<未開始> 收尾<未到> 蒸餾<見下>

**蒸餾（兩條，都關於「停在第一個看起來對的答案」）**：
① 待決清單記的位置往往只是「當時看到的那一處」——`aria-current` 筆記只記了 LogSheet，
實際上食品庫也有。**收零碎項時要重搜一次，不要照著筆記逐條修完就當收完。**
② **症狀有兩個面向時，一個原因解釋得通不代表另一個面向也被它解釋了**（v2.32→v2.33）：
使用者說「被鍵盤蓋住 ＋ 上下箭頭不順」，我找到 `visualViewport` 能解釋前者，就把後者也
歸進同一個因並寫進 DESIGN.md，直到他給出「起點不同結果不同」的對照才發現是兩個獨立問題。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄）。動 UI 前必讀，改完
  必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑** → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑** → 全域 memory `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出只有真實
  資料才會浮現的問題；三層（樣張核可／真機試用／deep review）各自抓到不同類的問題。
- 完整的歷史病歷 → `archive-2026-07.md`。
