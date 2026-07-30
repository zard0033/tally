# Tally — session state

最後更新：2026-07-30

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；
> 2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線——記一筆 sheet（多選／搜尋品名＋店家／新增食物）、今日頁左滑刪除
  ＋滑到底刪除＋5 秒復原窗、日期切換、設定頁編輯＋記體重。資料在 Supabase（四表＋RLS），
  Notion 原始資料還在、尚未退場。
- **測試**：`npx vitest run` 42/42（**必須用 PowerShell 跑**，Git Bash 全炸，見下方未解）；
  `npm run e2e` ＝ `tally.spec.ts` 14 條全份回歸 ＋ `interaction.spec.ts` 3 條可單獨跑
  （`npx playwright test interaction -g "關鍵字"`）。CI 的 Linux vitest 綠。

### 本輪未 commit 的改動（2026-07-30）

真機第三輪回報 → 走完 `ui-design-flow`（⓪跳過／➊兩輪決策樣張／➋DESIGN.md v2.2→v2.4／➌實作）。

- **刪除鈕圓角被截斷**：`is-armed` 的 `scale(1.18)` 讓 44px 圓長成 51.9px，被 `.item-row` 的
  `overflow: clip` 上下各切 4px。紅圓改畫在 `::before`（40px），預告改 `scale(1.1)`。
- **復原提示**：滿寬 353×62 的 `--raised` 條 → 84×44 深色 pill（`--ink` 底），置中浮在底部列上方 8px。
- **版面重排（DESIGN.md v2.3）**：底部 CTA 與分頁併成一列（分頁 pill 靠左、56px 加號圓鈕靠右，
  整列 72px，取代原本上下兩段 138px）；頂部拿掉靜態頁名「日記」，日期升為 h1 並置中。
  **時間軸 355 → 439px（＋84，約兩列品項）。**
- **主 CTA 文案規則作廢（使用者裁決）**：改純加號圓鈕，理由是這個 app 之後不只記飲食，
  「記一筆」這個文案本身會過期。
- **v2.4 三處**：日期組包成膠囊（`--card`＋1px `--rule`＋`--r-pill`）；「回今天」移到頂欄左端、
  拿掉前置 chevron；分頁選中態底色 `--raised` → `--accent-soft`（對比 1.14:1 → 4.67:1）。
- 連帶：`.cta` 只留給圓鈕，登入頁與錯誤畫面的滿寬文字鈕分家成 `.action-btn`。
- 驗證：vitest 42/42、e2e 全綠、tsc/oxlint 0；v2.3 過 fresh verifier 15/15，v2.4 由主對話
  read-back＋截圖確認（幾何與顏色可獨立複算，不另派 verifier——有意識的省略）。
- **未 commit 的樣張**：`sample-v3-frame.html`／`sample-v4-bottom.html`（決策已固化進 DESIGN.md，
  依 07-28、07-29 先例應在 commit 前刪除，**等使用者裁定**）。

## 待決問題

- **真機未驗**：v2.3／v2.4 的頂欄膠囊、底部單列、復原 pill、分頁選中態全部只在 webkit 393×745
  量過，**還沒上過手**。另有兩件從 v2 起就欠著：apple-touch-icon（加主畫面）、tabular-nums 對齊。
- **額度預警提示**（最大的一塊新功能，使用者 07-30 說「先等等」）：開 sheet 時每個食物項目提示
  「加了會不會超標」。設計時要解三個衝突：(1) DESIGN.md 禁止「綠色達標狀態」，訊號色只有
  jade＝常態/動作、`--over`＝破表，所以「綠字打勾」直接違規；(2) 判定要乘份量（可小數）且要把
  sheet 內**已選未送出**的項目暫計進剩餘額度；(3) 蛋白質「不足不是錯誤」的既有語意如何相容。
- **scrim 分區變色（iPhone 真機，兩輪修法未解，使用者裁定擱置）**：關 sheet 時頂部延遲變回底色。
  已排除：動畫雙軌打架、scrim 與 sheet 同速。剩餘嫌犯：vaul 對 overlay 的 inline opacity 覆寫、
  `viewport-fit=cover` 下頂部 safe-area 帶的成畫來源不是 scrim、iOS 對 fixed 全屏層的獨立合成。
  **下次診斷配方**：出 debug build 把各層塗對比色（scrim 紅／body 綠／sheet 藍／html 黃），
  iPhone 錄屏慢放，先確定「誰在畫那條帶」。純視覺瑕疵、不影響資料，優先級低。
- **vitest 在 Git Bash 集合階段全炸**（`Cannot read properties of undefined (reading 'config')`）：
  已定位為 MSYS 環境特有，PowerShell 與 CI 的 Linux bash 都正常。實務解＝本機一律 PowerShell 跑，
  根因未挖（兩條可用路徑都在）。
- **零碎（都不擋上線）**：CI 的 actions 未 pin SHA；RLS 的跨使用者 DELETE 未實測過（只驗過未登入
  隔離）；Notion 該評估退場了；`review-findings.md` 剩 6 條；飲食紀錄有 4 筆刻意未遷移
  （07-23 早餐重複×2、07-25 晚餐空、07-27 午餐空），使用者要自己補。
- **已知未覆蓋**：刪掉某餐**最後一筆**時整個 `<ul>` 隨餐次轉「待記錄」一起卸載，退場動畫不會跑；
  e2e fixture 每餐只有一筆，所以退場動畫從沒被測到。要覆蓋得先擴 fixture。
- **復原 pill 會蓋住時間軸最後一列 5 秒**：有意識略過（補底部 padding 要吃掉 v2.3 省下空間的一半，
  而那一列還在、一捲就出來）。

## 下次續點

1. **真機驗這一輪**（要手機，最優先）：頂欄膠囊好不好按、底部單列的拇指距離、復原 pill 的
   位置與辨識度、分頁選中態看不看得出來、滑開刪除鈕的圓角。順帶補驗 apple-touch-icon 與 tabular-nums。
2. **push**：照全域 `rules/git-push.md` 走分流 → `precommit-review` → 測試 → 確認訊息。
   本輪 diff 橫跨 DESIGN.md／CLAUDE.md／App.tsx／Today.tsx／Login.tsx／app.css／e2e，屬 deep review 級。
   **push 即部署 Pages**，真機沒驗過就 push 等於直接上線（使用者是唯一使用者，可接受，但要先說一聲）。
3. 額度預警提示（等使用者放行；要走 dev-flow ＋ ui-design-flow，建議開新對話）。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄 v1→v2.4）。動 UI 前必讀，
  改完必回寫，這條已入 CLAUDE.md 的 Pre-Push Checklist。
- **Windows/PowerShell 坑**（CJK 檔案整檔讀寫會毀檔、CJK 行數算不準、vitest 在 Git Bash 全炸）
  → 全域 memory `windows-shell-ledger`。本輪再中一次：`Measure-Object -Line` 對 570 行的
  active.md 只算出 490。
- **驗證方法坑**（煙霧驗證抓不到互動 bug、對照組會靜默退化成不觸發、「測不起來」要先懷疑產品）
  → 全域 memory `verification-ledger` ＋ 全域 `ui-verify` skill。
- **委派坑**（宣稱「文件已改好」要先 `git diff` 核對再開工——本輪 executor 撞到並提出）
  → 全域 memory `delegation-ledger`。
- 完整的歷史病歷（真機三輪、遷移四階段、每一次 review 的 findings 與回修）→ `archive-2026-07.md`。
