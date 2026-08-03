# Tally — session state

最後更新：2026-08-03（今日頁品項改就地編輯，已 push `823d929`，等真機驗收）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；
> 2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯。記一筆 sheet（多選／搜尋品名＋店家／
  新增食物／逐筆超標預警）、今日頁左滑刪除＋滑到底刪除＋5 秒復原窗＋點按展開改份量/餐別、
  日期切換＋快取預取、設定頁編輯＋記體重。資料在 Supabase（四表＋RLS）。
- **測試**：`npx vitest run` 59/59（**必須用 PowerShell 跑**，Git Bash 全炸，見下方未解）；
  `npm run e2e` 27 條分六檔（`tally` 全份回歸 ＋ `interaction`／`inline-edit`／`vendor-autocomplete`／
  `quota-warning`／`meal-exit-animation` 各自獨立可單跑）。

### 本輪（2026-08-03，`823d929`）：今日頁品項就地編輯，DESIGN.md → v2.20

點按品項就地展開編輯區（長按 sheet 整套移除）＋ 修 app icon 透明角（`dcf3cd3`）。走完
dev-flow ＋ ui-design-flow ➊➋➌➍ ＋ precommit-review light；決策、被否決方案（含「長按改
拖曳換餐別」）、兩道 review 的處置明細全在 DESIGN.md v2.20。一個還用得到的結論：**需求追到
底才發現問法是錯的**——使用者要的「編輯品名與熱量」在資料模型下走不通（品名是 join `foods`
來的），真正的解是「以現有食物為範本新增食物」，已併進食品庫管理那輪。

## 已驗證事實

- **修不好的 bug 先問「這個功能還需要以這種形式存在嗎」**：長按誤閃 reveal 修了 v2.18 兩輪、
  真機仍重現，這輪改成點按後 bug 隨程式碼一起消失——根因是長按與 `drag="x"` 共用 pointerdown
  的手勢仲裁，換掉觸發方式就沒有仲裁了。**拆掉比修好便宜**，不是修不動才繞路。
- **把編輯 UI 掛在資料列的 DOM 子樹下，結構上消滅一整類 bug**：就地編輯區是 `.item-row` 的
  子節點，那一列卸載它必然一起走，「編輯開著但那筆資料不在了」這個狀態構造不出來（改寫 e2e
  時實測到：舊的重現手法現在停在「找不到 stepper」）。比在寫入前守門更根本——守門是補救，
  結構是預防。`App.tsx` 的守門因此降級成深度防禦，但留著（成本一行，下個入口未必有這結構），
  同時從單一 handler 抽成共用的 `patchIntakeRow`。
- **帶框元素與無框圖示的對齊基準不同**：帶框的要內距才不貼壁，無框圖示要懸出負 margin 才對齊
  文字欄。硬要兩者同線就得二選一放棄呼吸或放棄對齊（細節在 DESIGN.md v2.20）。
- **`opacity` 是相對於背景的，同一個值在不同 surface token 上是兩件事**：`.qty-btn:disabled`
  的 `.35` 在記一筆 sheet 的 `--card` 底上是「這顆按不得」，搬到編輯區更深的 `--raised` 底上
  就變成「這格沒渲染出來」。**把既有元件搬到新的 surface 時，disabled／降權／淡出三種態都要
  重新截圖看過，不能只驗預設態**。
- **純程式碼推演的焦點問題一律要實測**：➍ 的 a11y reviewer 推論出兩條焦點競速（編輯區刪除
  vs 復原提示條、改餐別後 ref 指向已卸載節點），實測全部是誤報。反過來它推論的 `aria-current`
  誤用與缺 live region 則成立——差別在前者依賴執行期時序、後者只看靜態語意。
- **文件宣稱要跟實作對得上，尤其是「動畫會怎樣」這種寫了就沒人再驗的句子**：我在 DESIGN.md
  寫「FLIP 動畫帶著它飛到新餐別」，實測是卸載重掛（裸 `layout` 跨不了 `<ul>`，能跨的只有
  `layoutId`），中間 80ms 同一筆存在兩份、來源餐別顯示「0」。而那句錯的宣稱正是另一個決策
  （改完就收合）的唯一依據——**依據錯了，決策要重估，不是把錯的話留著**。
- **全站圓角是有邏輯的混用，不要為了一致統一掉**：導覽/狀態類 `--r-pill`、內容/輸入類 `--r-tab`。
  突兀感來自「把兩個家族塞進相鄰兩行」，不是混用本身。
- `foods.archived` 欄已在線上 DB（`schema.sql` 已同步），**前端還沒用它**——soft delete UI 是下一輪。
- Base UI Autocomplete 的 portal 坑已解掉，細節在 DESIGN.md「店家欄位（v2.6）」。
- 數字字體選 Archivo 是硬約束（實測數據見 DESIGN.md「字體」章節），不是品味決定。
- `pickTotals` 之類綁著 screen-specific 型別的純函式，不要為了「照規矩放 src/lib/」硬搬——
  先查循環匯入風險（`api.ts` 已匯入 `formulas.ts` 的 `Profile`，反向搬會 circular）。
- **判定精度與顯示精度要對齊**：`rowOverage` 用 0.1 級判超標、顯示用整數捨入，0.1~0.4 會顯示
  「+0」——兩層精度不一致的坑，兩支數字都要設。

## 未解失敗

- **app icon 在 iOS 深色主畫面下顯示黑底白 T**（使用者確認他刻意用深色模式，要的就是深色下也正確）。
  進度：**伺服器端全部排除**（部署 success、線上檔與 repo md5 一致、圖檔本身是綠底白 T）。
  **2026-08-03 逐像素檢查抓到一個實作違規並已修**：`icon-192.png`／`icon-512.png` 的角落是
  `A0` 全透明（預先切了圓角），違反 DESIGN.md v2.5 自己寫的「PNG 一律方形滿版、不預先切圓角
  ——透明角在暗色桌面上被合成成暗色」；只有 `apple-touch-icon.png` 合規。已把透明區合成到
  `--accent` 底補成滿版，版本參數 bump `?v=3`。**等真機再驗**（要移除主畫面圖示 →
  「設定 › Safari › 清除瀏覽記錄與網站資料」→ 重加，缺一步都可能沒換）。
  **已查證的天花板**：web 端**無法**為 PWA 指定深色模式圖示變體——`prefers-color-scheme` 對
  icon 無效（只對 splash screen 有效），iOS 18 的深色／色調圖示是原生 app 用 Xcode asset
  catalog 提供的，web clip 沒有對應機制，也沒有退出系統處理的開關。所以「深色下跟淺色長一樣、
  不要翻轉」在 web 端做不到。**若補滿版後仍不理想，剩下唯一的槓桿是把背景做成透明、只留 T 的
  形狀**（讓系統填深色底 → 深底綠 T），代價是淺色模式的外觀也會跟著變成淺底綠 T，要使用者裁決。
- **vitest 在 Git Bash 集合階段全炸**：已定位 MSYS 環境特有，實務解＝本機一律 PowerShell 跑。
- **全量並行跑（5 workers）時偶發 flaky**：`tally.spec.ts` 撞過「刪除後焦點沒接到復原鈕」，
  `vendor-autocomplete.spec.ts` 撞過「打新店家送出」（2026-08-03）。兩者單獨跑都穩定過，
  判斷是既有的 CPU 搶佔計時問題（harness.ts 有相關註解），非改動造成。**撞到時先單獨重跑
  該檔確認，不要直接當成迴歸去追**。
- **scrim 分區變色（iPhone 真機，使用者裁定擱置）**：關 sheet 時頂部延遲變回底色。純視覺瑕疵，
  診斷配方見 archive。
- **就地編輯區沒有 focus trap，也不監看外部狀態**：換日期時它會隨那一列一起卸載（結構保證，
  已有 e2e 鎖），但這是「一起消失」不是「優雅收合」，沒有任何提示。優先級低。
- **改份量每按一次 +/− 就送一次 PATCH，沒有 debounce**（`ponytail:` 標記在 `ItemEditor`）。
  每個請求都是完整覆寫、同連線下順序即發送順序，實務上安全；真出現畫面與 DB 對不上再加
  300ms debounce ＋ 收合時 flush。刻意不加的理由：這個元件已在 timer 生命週期上翻船兩次。

## 待決問題

- **食品庫管理與設定頁重構（已走完 dev-flow 前段＋★核可，等 ui-design-flow ➊ 出樣張）**：
  決策已拍板（設定頁改純入口列表、食品庫 soft delete＋「封存」、店家管理頁延後不取消、
  不建 vendors 表、食物搜尋維持手刻）。**本輪新增一項併進這輪範圍：「以現有食物為範本新增食物」**
  ——預填原食物欄位開新增表單，改名字改熱量存成新食物並自動選中，用 `createFood` 現成 API、
  不動 schema。它是使用者真正的痛點（拿相似食物改成另一個），食品庫會因此變胖，剛好由同一輪的
  封存功能接住。
- **PWA / service worker**：只有 manifest，沒有 SW——離線不能用、部署更新沒有主動接手機制。
  Gambit 已用 `vite-plugin-pwa`（Workbox `generateSW`）做過，設計記在該 repo
  `docs/architecture/adr-0016-pwa-caching-strategy.md`，可直接照搬：`registerType: 'autoUpdate'`
  （鐵律）、app shell 快取、**Supabase 請求刻意排除在快取規則外**（否則會「別台改了、這台看舊資料」）。
  屬中型改動（新依賴＋新 build 設定），開工先走 `dev-flow`。
- **`LogSheet.tsx` 的餐別 chip 也誤用 `aria-current`**（`LogSheet.tsx:595` 附近）：跟今日頁
  編輯區同一個問題——`aria-current` 的規範語意是「目前所在位置」，用在按下去會改變資料的
  控制項上不對。今日頁那組已於 v2.20 改成 `aria-pressed`，sheet 這組屬範圍外沒動。下次碰
  LogSheet 時一併改，CSS 選擇器要同步（`.chip[aria-current="true"]`）。
- **零碎（都不擋上線）**：RLS 跨使用者 DELETE 未實測（需兩組真帳號撞正式 DB）；飲食紀錄 4 筆
  刻意未遷移，使用者要自己補；21 條 precommit-review 的 unverified-minor 未逐條處理。
- **➍ 提出但未採納的密度相關觀察，要在真機看一眼**：一餐 3–5 筆時，(a) 在展開中的列上起手
  左滑，下面幾列會在手勢進行中整批往上跳；(b) 展開較下方的列會觸發 `scrollIntoView`，使用者
  若「往同一個位置再點一下想收合」，第二下可能落進編輯區右側那一欄（＝刪除鈕），有 5 秒
  復原兜底但仍值得確認 `block:'nearest'` 在編輯區已完整可見時確實不捲動。
- **Notion 退場現況**：遷移已出貨，卡住的是收尾（刪 Notion 頁面＋補髒資料）。
- **復原 pill 會蓋住時間軸最後一列 5 秒**：有意識略過。

## 下次續點

1. **【下一輪，已有使用者裁決】拿掉左滑刪除、刪除統一收進編輯區 ＋ 編輯區版面重排**
   （2026-08-03 真機回饋，三件事是同一個問題的兩面，一起做）：
   - **點按時左滑刪除鈕仍會閃出來**。根因不是邏輯 bug（e2e 全綠）：手指按下時的微小橫向
     位移就會被 framer 的 drag 判定攔截（門檻約 3px），列跟著移一點露出紅圓——**兩種手勢
     共用同一次觸摸的必然結果**。使用者裁決：**整套左滑拿掉**（含滑到底 45% 直接刪除），
     刪除只留編輯區那一顆。連帶可拆：`REVEAL`/`OPEN_AT`/`FULL_AT`、`armed`、
     `blockClickUntil` 那套三版血淚的補 click 防呆、`.item-slide` 的 motion drag 整層、
     `active` 的 `swipe` mode（單值 state 會退化成單純的 editingId）。
     **動工前先盤點**：DESIGN.md 有多條左滑規則要一起退場（「今日頁品項刪除手勢」「滑到底
     刪除」「刪除鈕樣式」「刪除的鍵盤路徑」），e2e 也有多條左滑斷言（`interaction.spec.ts`
     的拖曳三條、`meal-exit-animation.spec.ts` 用 slowDrag 起手、`inline-edit.spec.ts` 的
     左滑那條、`tally.spec.ts` 的水平溢位斷言）。
   - **編輯區「看起來亂」，希望份量與餐別併成一排**。注意 393px 下卡片內寬只有 323px，
     stepper 130 ＋ 四格分段器 ＋ 刪除 44 塞不進同一排，要重新設計而不是硬擠——這是
     ui-design-flow ➊ 該出樣張的題目；拿掉左滑後空間分配可以整個重來。
   - **➍ 當時未採納的兩條密度觀察會因此失效或改變**：左滑時下面幾列塌陷（左滑拿掉後自動
     消失）、展開下方列後再點同位置可能誤觸刪除（刪除鈕位置會變，要重評）。
2. **等真機驗收 app icon**（已 push `dcf3cd3`；要移除主畫面圖示 ＋ 清 Safari 網站資料再重加
   才看得到）。若補滿版後仍是黑底白 T，下一步的選項與代價寫在「未解失敗」該條。
3. **換餐別的移動特效**（使用者列為未來優化，不擋上線）：期望「來源餐別那筆左滑消失、目的
   餐別右滑插入」。現況是卸載重掛、憑空出現（見「已驗證事實」）。motion 的 `initial`/`exit`
   給不同方向即可，比現況誠實；等第 1 項動這塊時一起做。
4. **食品庫管理＋設定頁重構＋範本複製新增食物**：決策已拍板，下一步是 ui-design-flow ➊。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄 v1→v2.20）。動 UI 前必讀，
  改完必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑** → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑** → 全域 memory `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出只有真實資料
  才會浮現的問題；三層（樣張核可／真機試用／deep review）各自抓到不同類的問題，缺一層都會漏。
- 完整的歷史病歷 → `archive-2026-07.md`。
