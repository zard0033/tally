# Tally — session state

最後更新：2026-08-02

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；
> 2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示（本輪新增）。記一筆 sheet（多選／搜尋品名＋店家／
  新增食物／逐筆超標預警）、今日頁左滑刪除＋滑到底刪除＋5 秒復原窗、日期切換＋快取預取、
  設定頁編輯＋記體重。資料在 Supabase（四表＋RLS）。Notion 一次性遷移已出貨，收尾（刪 Notion
  頁面）還沒做，細節見「待決問題」。
- **測試**：`npx vitest run` 59/59（**必須用 PowerShell 跑**，Git Bash 全炸，見下方未解）；
  `npm run e2e` ＝ 18 條，分五個檔（`tally.spec.ts` 全份回歸 ＋ `interaction.spec.ts` 互動路徑
  ＋ `vendor-autocomplete.spec.ts` ＋ `meal-exit-animation.spec.ts` ＋ `quota-warning.spec.ts`）。
- **`ui-design-flow` 規則本身改版**（使用者 2026-08-01 直接改的，非本輪施工）：五階段
  `⓪➊➋➌➍➎` 精簡成四階段 `➊➋➌➍`，依據是 15 天實測稽核（⓪ 兩次都跳過、➍➎ 從沒真的跑過）。

### 本輪改動（2026-08-01～02，已 push：`ef650d6`，`f6a7926..ef650d6` 都已上線）

- **額度預警提示上線，兩個各自成立的機制，完全不用碰顏色系統**：
  1. **逐筆超標預警**：記一筆清單每一列未勾選的食物，用 `defaultQty`（該食物在這一餐上次吃的
     份量，不是固定 1）即時試算「加了會不會讓熱量/脂肪/碳水超標」。kc 數字變 `--over` 只反映
     熱量本身；下面小字**只列脂肪／碳水**（`+26g脂`），熱量不重複顯示——kc 變色與底部確認列的
     `(+N)` 已經講過。**不含蛋白質**，它的語意是「達標」不是「超標」。
  2. **底部確認列**：超標時「超出」讓位給緊跟小計數字的 `(+40)`；新增蛋白/脂/碳三個數字
     （`82/126`），**判定跟今日頁三大營養素條同一條規則**（脂肪／碳水各自 >100% 轉
     `--over`，蛋白質不足不轉紅）——不是「三個都不判色」，v2.10 文件曾誤寫成這樣，v2.11 訂正。
  - 純邏輯搬進 `src/lib/formulas.ts`（`rowOverage`／`pickBarRight`／`formatOverDelta`／
    `formatOverAria`），`pickTotals` 留在 `LogSheet.tsx`（綁 `Food` 型別，搬去 `formulas.ts`
    會跟 `api.ts→formulas.ts` 既有匯入方向形成循環）。
  - **走完 `ui-design-flow` 四階段**（➊ 樣張迭代兩輪核可、➋ DESIGN.md v2.10、➌ 實作、
    ➍ hallmark audit＋web-design-guidelines 並派——➍ 有紀錄以來第一次真的執行，抓到並修掉一個
    aria-label 缺口，`--over` 對 `--card` 對比度 6.21:1 過 WCAG）。
  - **真機拿真實資料試用後兩輪回修**（demo 樣張資料量太小測不出來）：v2.11 拿掉逐筆 delta 裡
    重複的熱量文字、訂正誤寫的顏色判定規則。
  - **push 前 `precommit-review`（deep）又抓到 6 個確認成立的問題，全修（v2.12）**：
    aria-label 在「只有熱量超標」時整段消失（閘門誤判 `delta` 而非 `formatOverAria` 本身）、
    超標 0.1~0.4 顯示「+0g脂」（判定與顯示精度沒對齊）、`.pick-line`／`.macro-line` 缺
    `role="group"`（generic `<div>` 靠 `aria-label` 命名是 ARIA 禁止模式）、逐筆預警份量
    改用 `defaultQty`、`MealNode` 換日期時 key 併上 `date`（修掉「切到快取住且那餐剛好是空的
    日期」被誤判成「剛刪除」而誤放退場動畫——這條其實是上一輪 f6a7926 的既有 bug，這輪才抓到）。
    零碎：拿掉 `.pick-bar` 沒有 CSS 依賴的 `is-over` class、`pickTotals` 兩段 `.map()` 合一。
  - `design-flow：➋v2.12 ➍hallmark 0/0/0，web-design-guidelines 抓到 1 個 a11y 缺口已修＋
    對比度 6.21:1 過`
- 驗證：build／lint 過，vitest 59/59（新增 +0g 精度邊界測試），e2e 18/18。真機截圖確認過視覺
  （webkit 393 寬）。deep precommit-review 全部 confirmed findings 修完，21 條 unverified-minor
  多數是可留的技術債（效能熱路徑、PWA manifest 未寫進 DESIGN.md 等），沒有逐條處理，見「零碎」。

## 已驗證事實

- `foods.archived` 欄已在線上 DB（`schema.sql` 已同步），**前端還沒用它**——soft delete UI 是下一輪的事。
- Base UI Autocomplete 的 portal 坑已解掉，細節在 DESIGN.md「店家欄位（v2.6）」。
- 數字字體選 Archivo 是硬約束（實測數據見 DESIGN.md「字體」章節），不是品味決定。
- `pickTotals` 之類綁著 screen-specific 型別（如 `Food`）的純函式，不要為了「照規矩放 src/lib/」
  硬搬——要先查有沒有循環匯入風險（`api.ts` 已經匯入 `formulas.ts` 的 `Profile`，反向搬會 circular）。
- **判定精度與顯示精度要對齊**：`rowOverage` 用 0.1 級精度判「有沒有超標」，顯示卻用整數捨入，
  0.1~0.4 的超標量會顯示成「+0」——這種兩層精度不一致的坑，兩支數字都要設，不能只設其中一支。

## 未解失敗

- **scrim 分區變色（iPhone 真機，使用者裁定擱置）**：關 sheet 時頂部延遲變回底色。純視覺瑕疵、
  不影響資料，優先級低，診斷配方見 archive。
- **vitest 在 Git Bash 集合階段全炸**：已定位 MSYS 環境特有，實務解＝本機一律 PowerShell 跑。

## 待決問題

- **Archivo 只嵌 600 字重，視覺層級變平**：三種修法要看實際畫面決定，下次連同真機驗收一起看。
- **食品庫管理與設定頁重構（已走完 dev-flow 前段＋★核可，等 ui-design-flow ➊ 出樣張）**：
  決策全部拍板（設定頁改純入口列表、食品庫 soft delete＋「封存」、店家管理頁延後不取消、
  不建 vendors 表、食物搜尋維持手刻），細節見 `git log` 該輪討論。**這輪先做了額度預警提示
  （使用者現場改變優先序），還沒動工。**
- **零碎（都不擋上線）**：RLS 跨使用者 DELETE 未實測（需兩組真帳號撞正式 DB）；飲食紀錄 4 筆
  刻意未遷移，使用者要自己補；21 條 precommit-review 的 unverified-minor 未逐條處理（效能熱
  路徑、PWA manifest 決策未寫進 DESIGN.md、macro-line 三種精度並存等，見該輪 runId 記錄）。
- **Notion 退場現況**：遷移已出貨，卡住的是收尾（刪 Notion 頁面＋補髒資料），判斷現存內容需要
  Notion MCP 或使用者自己看。
- **復原 pill 會蓋住時間軸最後一列 5 秒**：有意識略過。

## 下次續點

1. **真機看這幾輪已上線的東西**：Archivo 數字、日期字級、qty stepper 接縫、店家 Autocomplete、
   新 icon、刪除退場動畫、額度預警提示的逐筆訊號與底部確認列（e2e 過不代表真機順）。
2. **實作食品庫管理＋設定頁重構**：決策已拍板，下一步是 `ui-design-flow` ➊ 出決策樣張。
   建議開新對話，這輪 context 已經很長。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄 v1→v2.12）。動 UI 前必讀，
  改完必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑**（煙霧驗證抓不到互動 bug、量測要有對照組、「等寬」判準要用容差、判定精度要與
  顯示精度對齊） → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑**（宣稱「文件已改好」要先 `git diff` 核對；agent 中斷後不能 SendMessage 恢復） →
  全域 memory `delegation-ledger`。
- **ezycopy 對純文字 raw markdown URL 會把反引號跳脫壞掉**——那個工具設計來把 HTML 轉
  markdown，餵它已經是 markdown 的原始檔反而會壞。下次這類 URL 改用 curl 或 WebFetch 的
  `EZYCOPY_FALLBACK` bypass。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出「熱量資訊
  重複」「顏色判定漏掉」這類只有真實資料量與真實數值才會浮現的問題，deep code review 也再抓到
  一批（aria 閘門條件、精度對齊、日期切換誤判）——三層（樣張核可／真機試用／deep review）各自
  抓到不同類的問題，缺一層都會漏。
- 完整的歷史病歷 → `archive-2026-07.md`。
