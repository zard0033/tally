# Tally — session state

最後更新：2026-08-03（每日目標計算引擎重新設計，precommit-review deep 跑完並修完 confirmed
findings，等補一行 SQL backfill 後即可 push）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；
> 2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯。**本輪新增：每日目標計算引擎
  重新設計**（見下方「本輪」），尚未 push——`precommit-review`（deep）已跑完並修完全部
  confirmed findings（1 critical＋4 major＋多條 minor），**唯一剩下的是使用者要補跑一行
  SQL**（見下方「未解失敗」的 migration 條），跑完就能走 CLAUDE.md Pre-Push Checklist 收尾。
- **測試**：`npx vitest run` 60/60（**必須用 PowerShell 跑**，Git Bash 全炸）；
  `npm run e2e` 27 條全綠（`quota-warning.spec.ts` 因目標公式改變已重新校準且改用自訂目標
  釘死數值，不再受年份影響，見下方已驗證事實）；`meal-exit-animation.spec.ts` 全量 5-worker
  並行時偶發 flaky（既有問題，單獨重跑必過，跟這輪改動無關，見下方未解失敗）。

### 本輪（2026-08-03，未 commit）：每日目標計算引擎重新設計

走完整套 dev-flow（Jobs 視角先問「這功能為誰做」——app 只有使用者一個人）＋ grilling 逐題收斂
＋ ui-design-flow ➊（`_design-sample/food-library.html`，十餘輪樣張迭代）。**不照抄參考 app
（小資算熱量）的三個並列 tab**——改成一個表單＋體脂率選填（有沒有值反推該用哪條公式）＋一個
正交的自訂目標開關。

**範圍刻意收斂為「只接計算引擎」**（使用者明確選擇，見下方待決問題）：只換 `formulas.ts`／
`schema.sql`／`api.ts`／`Settings.tsx` 的計算與表單邏輯，**維持現有單頁＋sheet 架構**，
不做「每日目標」獨立入口頁、不做即時預覽——樣張裡設計的 hero 即時計算、身體資料分組卡片、
詳細收合等呈現細節**尚未落地**，留給「設定頁改入口列表」那輪大任務一起做。

- **Schema**（`schema.sql` 已改，DB 尚未真的跑 migration——上面留了完整 `alter table` 註解）：
  `profile.birth_date` → `birth_year`；移除 `protein_pct`/`fat_pct`/`carb_pct`；新增
  `rate_kg_per_week`/`protein_g_per_kg`/`use_custom_targets`/`custom_kcal`/`custom_protein_g`/
  `custom_fat_g`/`custom_carb_g`。
- **公式**（`formulas.ts` 全面改寫）：`weight` 表最新一筆有體脂率用 Katch-McArdle，沒有退回
  Mifflin-St Jeor（不找更舊的體脂率值）；TDEE×活動係數；減重/增肌依變化速度換算的每日熱量
  差額（7700 卡/公斤）加減，維持=TDEE；蛋白質=體重×g/kg；脂肪/碳水依目標對照表分剩餘熱量
  （減重 35/65、維持 40/60、增肌 30/70，**寫死在程式碼不進 DB，不開放調整**）；自訂模式完全
  繞過公式。`Targets.bmr`/`tdee` 改 `number | null`（自訂模式沒有這兩個值）。
- **Settings.tsx**：編輯身體參數 sheet 加 `.seg` 二選一（公式估算/自訂目標）；出生年取代生日；
  目標＋變化速度合併成一個選單（維持/減重標準/減重自訂/增肌標準/增肌自訂）；活動量五選一
  選單（選項**直接顯示數字**，如「輕度（1.375）」）＋自訂逃生口；攝取蛋白質 g/kg（建議
  1.6–2.2）；自訂模式四個克數欄位。DESIGN.md 已補「目標計算方式」條與 v2.21 版本紀錄。

## 已驗證事實

- **公式變了，e2e 的「軟性排序」測試會跟著壞，不是迴歸**：`quota-warning.spec.ts` 用固定
  fixture 算好的 eaten 基準值卡在目標的邊緣（測「哪些食物加下去會超標」），公式改變後目標
  數字必然不同，且原本用公式估算模式的話，目標還會隨 `computeTargets` 內部用 `new Date()`
  算的年齡逐年跳動（precommit-review 抓到：舊校準的餘裕只剩 5.2 卡，2027 年就會紅）——
  **最終改用自訂目標模式把 fixture 的目標數字直接釘死**，完全繞過公式與年齡計算，測試才
  不再受執行日期影響。**用一支臨時 vitest 檔（跑完即刪）印出精確值最快，不要憑手算猜**，
  手算在這種多步公式鏈上容易出小數點誤差。
- **schema.sql 是「貼到 Supabase SQL Editor 手動跑」的慣例，不是自動 migration**：改表結構時
  同時更新 `create table` 本體（給新環境）＋留一段 `alter table` 註解（給既有資料庫），這是
  `foods.archived` 那輪就定下的既有慣例，這輪 `profile` 表照抄。**migration 註解裡的每個
  新欄位都要想清楚「既有資料列要不要補值」**——這輪漏了 `rate_kg_per_week` 的 backfill，
  push 前 precommit-review 才抓到：沒補值的既有使用者會讓減重/增肌悄悄變成維持態的熱量，
  且使用者已經先跑了沒有這行的舊版 migration，需要事後再補一次 `update`。
- **改動輸入模型時，先問「這是為誰做的」能砍掉一整條不必要的岔路**：使用者一開始想照抄參考
  app 的三個並列 tab（有體脂機/只有體重機/自訂），套 Jobs persona 直接問「你自己屬於哪一種」
  後發現他兩個都要——但這一問本身就先過濾掉了「純粹因為看到別人有就想抄」的假設，逼著把
  「一個欄位有沒有值」跟「使用者手動宣告模式」這兩件事分開想，最後做出比參考 app 更精簡的
  設計（少一個 UI 狀態、少一個 DB 欄位）。
- **UI 決策卡在「有點難想像」時，直接生一份用真實 CSS token 的 HTML 樣張比繼續用文字描述
  快得多**：這輪來回十餘次修樣張（`_design-sample/food-library.html`），每次改完直接
  `start` 開瀏覽器，使用者當場給出「這裡還是不對」的具體回饋，比純文字方案討論收斂快非常多。
- **改動一個欄位的語意（「純紀錄」變成「餵進公式」）時，驗證要跟著升級，不能沿用舊欄位的
  寬鬆檢查**：體脂率原本只是存起來的紀錄值，這輪起變成 Katch-McArdle 的計算輸入，但表單
  驗證沒跟著收緊，0／負數／>100 全部照收，會讓 BMR 算出離譜的值卻只有「Katch-McArdle」
  五個字當唯一線索——push 前 precommit-review 抓到，已補範圍檢查（3–70）。
- 舊的教訓指標（設計決策、Windows 坑、驗證方法、委派坑）見下方「教訓指標」段，不重複列。

## 未解失敗

- **app icon 在 iOS 深色主畫面下仍顯示黑底白 T**（`dcf3cd3` 補滿版後，使用者 2026-08-03
  真機複驗仍未解決）。**新線索，未查證**：使用者提到 Gambit 專案的 icon 在同樣情境下沒有
  這個問題——下次要診斷先去對照 Gambit 的 manifest／icon 設定跟 Tally 的差異，這是目前唯一
  的新方向。已查證的天花板見 archive／DESIGN.md「App icon」條（web 端無法指定深色模式圖示
  變體），如果 Gambit 對照也解不了，剩下唯一槓桿是背景做透明只留 T 形狀，代價是淺色模式外觀
  跟著變，要使用者裁決。
- **每日目標畫面尚未套用樣張的呈現設計**（hero 即時計算、身體資料卡、詳細收合）——這輪只換了
  計算引擎，UI 還是舊的唯讀 dl + 兩顆 link-btn 骨架，只是欄位內容換成新公式的欄位。樣張本身
  （`_design-sample/food-library.html`）保留著，下次做「設定頁改入口列表」時直接照樣張做。
- **`profile` 表的 DB migration 已經跑了一次，但少一行 backfill，需要再補一次**——使用者已把
  第一版 migration 貼到 Supabase 執行，但那版少了 `update profile set rate_kg_per_week = 0.5
  where goal <> 'maintain'`（precommit-review 抓到的 critical finding：既有 cut/bulk 使用者
  的 `rate_kg_per_week` 會是 null，讓減重/增肌悄悄變成維持態的熱量，設定頁還會顯示
  「NaN kg/週」）。`schema.sql` 的遷移註解已經補上這行＋幾條範圍 check，**下次要先貼這行
  SQL 到 Supabase 補跑，才能 push**：`update profile set rate_kg_per_week = 0.5 where goal
  <> 'maintain';`（幾條新的 check constraint 是否要一併補到既有 DB 上由使用者自行決定，不像
  這行 update 是正確性必須，schema.sql 裡都留著完整 SQL）。
- 舊的未解失敗（vitest Git Bash 炸、全量並行偶發 flaky、scrim 分區變色、就地編輯區無 focus
  trap、改份量無 debounce）維持原狀未動，細節見 git log 對應 commit 訊息，不在此重複展開。

## 待決問題

- **食品庫管理與設定頁重構**（已走完 dev-flow 前段＋★核可，ui-design-flow ➊ 樣張已核可，
  **完全未實作**）：設定頁改純入口列表、食品庫 soft delete＋封存（點列進就地編輯，右側兩顆
  純圖示「以此為範本新增」/「封存」，店家分組預設收合）、以現有食物為範本新增食物、體重趨勢
  頁（sparkline＋獨立完整圖表，圖表本身要過 `dataviz` skill 才能定案）。**這輪的每日目標計算
  引擎是這個大任務底下先抽出來單獨做完的一塊**（因為它動 schema，需要先過 dev-flow）。下次
  接手先讀 `_design-sample/food-library.html`（樣張仍保留，還沒到「定稿後清掉」的時機）。
- **每日目標即時預覽**：樣張設計了「改欄位當場看到 hero 數字變」，這輪範圍收斂時明確跳過，
  留到補完整入口頁 UI 時一起做（需要把表單從 uncontrolled ref 部分轉成也維護一份 local
  computeTargets 預覽 state）。
- **PWA / service worker**：只有 manifest，沒有 SW。屬中型改動，開工先走 `dev-flow`。
- **零碎（都不擋上線）**：RLS 跨使用者 DELETE 未實測；`LogSheet.tsx` 餐別 chip 誤用
  `aria-current`（範圍外未動）；Notion 退場收尾未完成。

## 下次續點

1. **補跑 `rate_kg_per_week` 的 backfill SQL**（見上方未解失敗），確認後才能 push 這輪。
2. **app icon**：先去對照 Gambit 專案的 icon/manifest 設定找差異，這是使用者本輪給的新線索。
3. **食品庫管理＋設定頁入口列表＋體重趨勢頁＋每日目標即時預覽 UI**：樣張都在
   `_design-sample/food-library.html`（已進版控），直接照樣張的 ui-design-flow ➋➌➍ 往下做。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄 v1→v2.21）。動 UI 前必讀，
  改完必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑** → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑** → 全域 memory `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出只有真實資料
  才會浮現的問題；三層（樣張核可／真機試用／deep review）各自抓到不同類的問題，缺一層都會漏。
- 完整的歷史病歷 → `archive-2026-07.md`。
