# Tally — session state

最後更新：2026-07-31

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；
> 2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線——記一筆 sheet（多選／搜尋品名＋店家／新增食物）、今日頁左滑刪除
  ＋滑到底刪除＋5 秒復原窗、日期切換＋快取預取、設定頁編輯＋記體重。資料在 Supabase
  （四表＋RLS），Notion 原始資料還在、尚未退場。
- **測試**：`npx vitest run` 42/42（**必須用 PowerShell 跑**，Git Bash 全炸，見下方未解）；
  `npm run e2e` ＝ 16 條（`tally.spec.ts` 全份回歸 ＋ `interaction.spec.ts` 互動路徑
  ＋ `vendor-autocomplete.spec.ts`）。CI 的 Linux vitest 綠。
- **樣張已全數退場**（2026-07-31）：`mockup.html`／`sample-log-entry.html` 是 07-28 vanilla
  時代的 v1.5／v1.7 樣貌，轉 React 後又走過 v2.0→v2.7，照著做會做出三版前的畫面。
  **設計規則自此以 DESIGN.md 元件規則表為唯一真相來源**，不再有「實作以某份樣張為準」的旁路。

## 已驗證事實

- **`foods.archived` 欄已在線上 DB**（使用者 07-31 於 Supabase SQL Editor 執行
  `alter table foods add column archived boolean not null default false;`），`schema.sql` 已同步。
  **前端還沒用它**——soft delete 的 UI 是下一輪的事。
- **Base UI 首次引入**（`@base-ui/react` 本來就在 package.json 但零 import）。踩到的坑已寫進
  DESIGN.md「店家欄位（v2.6）」：vaul 底層是 Radix Dialog，開啟時把 `body` 設 `pointer-events: none`
  只豁免自己的 Content 子樹，**任何掛在 body 下的兄弟 portal 都是「看得到、點不到」**。
  解法＝`Autocomplete.Portal` 的 `container` 指到 `Drawer.Content` 的 ref。純讀程式碼驗不出來。
- **e2e 那條 flaky 是真 bug，不是並行負載**（推翻前一輪 verifier 的歸因）。`AnimatePresence`
  （`Today.tsx:360`）換日期時退場與進場動畫有重疊窗口，DOM 上會同時存在兩個 `.item`；
  單次 `count()` 快照會撞到這個暫態。鑑別特徵：`--workers=1` 隔離跑照樣重現。
  修法＝輪詢等它收斂到穩態筆數（`harness.ts` 的 `waitCount`）。
- **字體選 Archivo 是硬約束下的唯一解**，不是品味決定。實測十個數字的最大寬度差：
  Archivo 0.09px（天生 tabular figures）、Outfit 12.89、Space Grotesk 8.88、Manrope 9.68、
  Sora 14.56，且對後者套 `font-variant-numeric: tabular-nums` **完全無效**（Google Fonts 的
  靜態實例不帶那個 feature）。DESIGN.md 規定數字要對齊，所以只有 Archivo 過關。
  日後想換字體，先跑這個量測再說。

## 未解失敗

- **scrim 分區變色（iPhone 真機，兩輪修法未解，使用者裁定擱置）**：關 sheet 時頂部延遲變回底色。
  已排除：動畫雙軌打架、scrim 與 sheet 同速。剩餘嫌犯：vaul 對 overlay 的 inline opacity 覆寫、
  `viewport-fit=cover` 下頂部 safe-area 帶的成畫來源不是 scrim、iOS 對 fixed 全屏層的獨立合成。
  **下次診斷配方**：出 debug build 把各層塗對比色（scrim 紅／body 綠／sheet 藍／html 黃），
  iPhone 錄屏慢放，先確定「誰在畫那條帶」。純視覺瑕疵、不影響資料，優先級低。
- **vitest 在 Git Bash 集合階段全炸**（`Cannot read properties of undefined (reading 'config')`）：
  已定位為 MSYS 環境特有，PowerShell 與 CI 的 Linux bash 都正常。實務解＝本機一律 PowerShell 跑，
  根因未挖（兩條可用路徑都在）。

## 待決問題

- **Archivo 只嵌了 600 一個字重，套 `--font-num` 卻沒寫 `font-weight` 的元素會被拉去用 600**
  （precommit review `wf_6d2664f7-60e` 抓到，主對話已實測證實：同一段文字在 `font-weight` 400／600／700
  下渲染寬度都是 92.16px，系統字體對照組是 88.98px）。受影響：`.pair .sep`／`.pair .tgt`／
  `.item .qty`／`.food-row .kc`／`.qty-value`——本來該看起來輕的次要數字現在跟主要數字一樣重，
  視覺層級只剩顏色在區分。**不是壞掉，是層級變平**，所以沒有擋 push。
  三種修法各有代價，**要看實際畫面決定**：(a) 補嵌一個 400 字重（多約 13KB）；
  (b) 那些元素不套 `--font-num`（但同一行內會出現兩種字體，更糟）；
  (c) 接受全部 600、明確寫進 CSS 並靠顏色分層。下次連同真機驗收一起看。
- **本輪未派 verifier**（使用者趕下班）。executor 申報五件事全過並附了證據
  （`document.fonts.check` true、420 與 128 右緣差 0.013px、e2e 連跑 7 輪 16/16），
  主對話只親自跑過 vitest 42/42。**下次開場先補一支 fresh verifier 複驗這輪的 diff**。
- **食品庫管理與設定頁重構（已走完 dev-flow 前段，等實作）**。決策全部拍板：
  - 設定頁改**純入口列表**（iOS 設定那種），每項點進獨立子頁。這會推翻 `DESIGN.md:141-142`
    的「編輯與記體重走同一套 sheet、不另做頁面」，實作時要明確改寫規則並在版本紀錄註明。
  - 食品庫管理：soft delete，UI 用詞叫**「封存」**，且**必須主動告訴使用者歷史紀錄不會消失**
    （使用者原話：「可以讓他放心封存」）。預設隱藏已封存、可切換顯示並復原。
    列表只要品名＋店家＋熱量，**使用頻率統計已砍**（Jobs persona 那輪的裁決）。
  - **店家管理頁延後、不是取消**：改用「食品庫逐筆編輯的店家欄位也用 Autocomplete」達成合併，
    能力沒少只是操作方式不同。等某個店家的食物多到逐筆改很煩，再加批次改名。
  - **不建 vendors 表**：vendor 是 `foods` 上的字串，去重就是清單；改名＝一句 `UPDATE`，
    而 intake 的店家是 join 來的，改 foods 就等於改了歷史顯示。
  - 食物搜尋**維持手刻不換 Autocomplete**：它是多選過濾器不是 autocomplete，語意對不上
    （選了不收合、結果就地取代清單、新增入口與結果並存、IME 雙 state）。
- **額度預警提示**（最大的一塊新功能，使用者 07-30 說「先等等」）：開 sheet 時每個食物項目提示
  「加了會不會超標」。三個衝突要解：(1) DESIGN.md 禁「綠色達標狀態」，訊號色只有 jade＝常態/動作、
  `--over`＝破表，「綠字打勾」直接違規；(2) 判定要乘份量（可小數）且要把 sheet 內**已選未送出**
  的項目暫計進剩餘額度；(3) 蛋白質「不足不是錯誤」的既有語意如何相容。
- **零碎（都不擋上線）**：RLS 的跨使用者 DELETE 未實測過（只驗過未登入隔離）；Notion 該評估退場了；
  `review-findings.md` 剩 6 條；飲食紀錄有 4 筆刻意未遷移（07-23 早餐重複×2、07-25 晚餐空、
  07-27 午餐空），使用者要自己補。
- **已知未覆蓋**：刪掉某餐**最後一筆**時整個 `<ul>` 隨餐次轉「待記錄」一起卸載，退場動畫不會跑；
  e2e fixture 每餐只有一筆，所以退場動畫從沒被測到。要覆蓋得先擴 fixture。
- **復原 pill 會蓋住時間軸最後一列 5 秒**：有意識略過（補底部 padding 要吃掉 v2.3 省下空間的一半，
  而那一列還在、一捲就出來）。

## 下次續點

1. **補驗這輪**：fresh verifier 對 `origin/main..HEAD` 的 diff 做獨立驗收（見上方待決第一條）。
2. **真機看這輪**：Archivo 數字、日期縮到 16px/600、qty stepper 的接縫、店家 Autocomplete
   在真手機上的下拉手感（e2e 過不代表真機順）。
3. **實作食品庫管理＋設定頁重構**：走 `dev-flow` 的實作階段，含 UI 所以整段轉 `ui-design-flow`
   （設定頁是新的資訊架構，要出決策樣張）。決策已全部拍板，見上方待決。
   建議開新對話，這輪的 context 已經很長。
4. 額度預警提示（等使用者放行）。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄 v1→v2.7）。動 UI 前必讀，
  改完必回寫，這條已入 CLAUDE.md 的 Pre-Push Checklist。
- **Windows/PowerShell 坑**（CJK 檔案整檔讀寫會毀檔、CJK 行數算不準、vitest 在 Git Bash 全炸）
  → 全域 memory `windows-shell-ledger`。
- **驗證方法坑**（煙霧驗證抓不到互動 bug、對照組會靜默退化成不觸發、「測不起來」要先懷疑產品）
  → 全域 memory `verification-ledger` ＋ 全域 `ui-verify` skill。本輪再添兩條：
  **量測要有對照組**（測字體是否載入，沒有對照組就分不出「字體生效」與「靜默 fallback」，
  我第一輪就是這樣測出假結論）；**「等寬」這種判準要用容差不要用完全相等**
  （0.04px 的差異被判成不等寬，差點誤殺可用的字體）。
- **委派坑**（宣稱「文件已改好」要先 `git diff` 核對再開工）→ 全域 memory `delegation-ledger`。
  本輪再添一條：**agent 被中斷後不能用 SendMessage 恢復**，要開新的並在 prompt 裡
  用 `git status`／`git diff` 的客觀事實交接，不要靠描述。
- 完整的歷史病歷（真機三輪、遷移四階段、每一次 review 的 findings 與回修）→ `archive-2026-07.md`。
