# Tally — session state

最後更新：2026-07-31

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；
> 2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線——記一筆 sheet（多選／搜尋品名＋店家／新增食物）、今日頁左滑刪除
  ＋滑到底刪除＋5 秒復原窗、日期切換＋快取預取、設定頁編輯＋記體重。資料在 Supabase
  （四表＋RLS）。Notion 那邊的一次性遷移本身已出貨，但收尾（刪掉 Notion 對應頁面）看起來還沒做，
  細節見下方「Notion 退場現況」。
- **測試**：`npx vitest run` 42/42（**必須用 PowerShell 跑**，Git Bash 全炸，見下方未解）；
  `npm run e2e` ＝ 17 條，分四個檔（`tally.spec.ts` 全份回歸 ＋ `interaction.spec.ts` 互動路徑
  ＋ `vendor-autocomplete.spec.ts` ＋ `meal-exit-animation.spec.ts`）。CI 的 Linux vitest 綠。
- **樣張已全數退場**（2026-07-31）：`mockup.html`／`sample-log-entry.html` 是 07-28 vanilla
  時代的 v1.5／v1.7 樣貌，轉 React 後又走過 v2.0→v2.7，照著做會做出三版前的畫面。
  **設計規則自此以 DESIGN.md 元件規則表為唯一真相來源**，不再有「實作以某份樣張為準」的旁路。

### 本輪未 commit 的改動（2026-07-31 下午）

- **補上 PWA manifest＋192/512 icon**：使用者回報「加到主畫面/釘選後 icon 是黑底白 T」，查證
  `favicon.svg`／`apple-touch-icon.png` 從 git log 上從沒出現過黑底白字版本，一直是綠底＋米白 T——
  真正原因是**專案從沒有 `manifest.json`**，Chrome/Edge/Android 在缺 manifest 合適尺寸 icon 時會
  自己合成深色方塊＋首字母頂替。已補 `public/manifest.webmanifest`、`public/icon-192.png`／
  `icon-512.png`（用專案既有 `playwright-core` 的 webkit 現轉 SVG，零新依賴）、`index.html` 補
  `<link rel="manifest">`／`theme-color`。**使用者裝置上的舊捷徑要刪掉重加才會換新 icon**（iOS/Android
  都是加入當下快照，不會自動跟著站台更新）。
- **店家 Autocomplete 兩處微調**：排序從 `localeCompare(..., 'zh-Hant')` 明釘成
  `'zh-Hant-u-co-stroke'`——V8／WebKit 實測目前預設 collation 就是筆畫序，明釘只是把它寫進程式碼、
  不再依賴引擎預設值；**沒有改用食物數量排序**，因為 11 個店家 8 個只有一筆，數量幾乎打平。
  `.vendor-popup` 拿掉自己的 `padding: var(--s-1) 0`，兩層 padding 疊加造成的頭尾死區收掉。
  DESIGN.md 已補 v2.8。
- **修掉「某餐最後一筆刪除時退場動畫不會跑」**：這條原本記在「已知未覆蓋」，本輪用 webkit 現場
  量測（點刪除後每 30ms 採樣 opacity）證實不是「沒測到」而是**真的壞了**——刪除後 10ms 內
  `.item` 已經整個消失、`.todo-row` 已經出現，opacity 過渡完全沒有發生。根因：`Today.tsx` 原本
  `done = items.length > 0` 一格公式跟 `items` 同一個 render 一起翻假，把 `AnimatePresence` 連同
  它包著的 `<ul>` 一起卸載，退場動畫沒有機會播放。修法：拆出 `MealNode` 元件，加 `lingering`
  state，讓「翻成待記錄列」延後到 `AnimatePresence` 的 `onExitComplete` 才發生；2 筆以上互刪的
  既有路徑不受影響（`hasItems` 全程是 true）。新增 `e2e/meal-exit-animation.spec.ts` 鎖住這個行為
  （驗過會在舊程式碼上失敗，不是空鎖）。DESIGN.md 已補 v2.9。
- 驗證：`npm run build`／`npm run lint` 過，vitest 42/42，e2e 17/17（含新增的
  `meal-exit-animation.spec.ts`）；popup 截圖比對過收緊效果。**這輪沒開 verifier**（機械式小改動
  ＋一個有現場量測佐證的 bug 修復，主對話截圖＋讀碼＋量測自驗）。

## 已驗證事實

- `foods.archived` 欄已在線上 DB（`schema.sql` 已同步），**前端還沒用它**——soft delete UI 是下一輪的事。
- Base UI Autocomplete 的 portal 坑（vaul 的 `pointer-events:none` 讓 body 下的兄弟 portal 點不到）
  已解掉，細節在 DESIGN.md「店家欄位（v2.6）」，不重複貼在這裡。
- e2e 換日期那條 flaky 是真 bug（`AnimatePresence` 退場/進場重疊窗口），已修，細節見 git log。
- 數字字體選 Archivo 是硬約束（tabular-nums 對其他候選字體全部無效，實測數據見 DESIGN.md「字體」章節），不是品味決定，換字體前先重跑那個量測。

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
- **零碎（都不擋上線）**：RLS 的跨使用者 DELETE 未實測過（只驗過未登入隔離，測需要兩組真帳號撞
  正式 DB，不宜無人看管時做）；飲食紀錄有 4 筆刻意未遷移（07-23 早餐重複×2、07-25 晚餐空、
  07-27 午餐空），使用者要自己補。**訂正**：`review-findings.md` 與「CI actions 未
  pin SHA」這兩條 2026-07-31 查證已經不成立——檔案已不存在、`deploy.yml` 三個 action 全部已經是
  SHA 釘死（帶 `# vX.X.X` 註解），是這份筆記没跟上實際進度，不是待辦。
- **Notion 退場現況（2026-07-31 唯讀盤點，本輪沒有 Notion MCP 可用，只能查 repo 內文件）**：
  spec.md 明寫「Notion 健康域完全退場」是一次性遷移的終態，遷移本身已隨第一版出貨（2026-07-28）；
  卡住的不是「要不要遷」，是遷移留下的收尾——上面那 4 筆刻意跳過的髒資料，和 spec.md:49
  講的「遷完移除 Notion 對應頁面」這個刪除動作看起來還沒做。**要判斷 Notion 裡還有沒有沒搬完的
  東西，得有 Notion MCP 或使用者自己去看**，這份盤點查不到 Notion 現存內容，只能查到 repo 這邊
  文件寫了什麼。
- **復原 pill 會蓋住時間軸最後一列 5 秒**：有意識略過（補底部 padding 要吃掉 v2.3 省下空間的一半，
  而那一列還在、一捲就出來）。

## 下次續點

1. **今天這輪（icon manifest＋店家排序/間距＋刪除退場動畫修復＋兩處文件訂正）還沒 commit**——
   要不要 commit／要不要先 push 由使用者定，開場先問。範圍：`index.html`／`src/app.css`／
   `src/screens/Today.tsx`／`src/screens/LogSheet.tsx`／`DESIGN.md`／`CLAUDE.md`／
   `session-state/active.md`／新增 `public/manifest.webmanifest`、`public/icon-192.png`、
   `public/icon-512.png`、`e2e/meal-exit-animation.spec.ts`。
2. **補驗上一輪**：fresh verifier 對 `origin/main..HEAD` 的 diff 做獨立驗收（見上方待決第一條，
   指 dde8ff5 那輪，不是今天這些改動）。
3. **真機看這幾輪**：Archivo 數字、日期縮到 16px/600、qty stepper 的接縫、店家 Autocomplete
   在真手機上的下拉手感與新排序、新 icon 加到主畫面的樣子、刪除某餐最後一筆時的退場動畫
   （e2e 過不代表真機順）。
4. **實作食品庫管理＋設定頁重構**：走 `dev-flow` 的實作階段，含 UI 所以整段轉 `ui-design-flow`
   （設定頁是新的資訊架構，要出決策樣張）。決策已全部拍板，見上方待決。
   建議開新對話，這輪的 context 已經很長。
5. 額度預警提示（等使用者放行）。
6. **Notion 退場收尾要不要做**：等使用者決定要不要處理那 4 筆髒資料與刪除 Notion 頁面，
   見上方「Notion 退場現況」——這件事需要 Notion 存取，這輪環境沒有。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄 v1→v2.9）。動 UI 前必讀，改完必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑**（煙霧驗證抓不到互動 bug、量測要有對照組、「等寬」判準要用容差） → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑**（宣稱「文件已改好」要先 `git diff` 核對；agent 中斷後不能 SendMessage 恢復，要開新的帶客觀事實交接） → 全域 memory `delegation-ledger`。
- 完整的歷史病歷 → `archive-2026-07.md`。
