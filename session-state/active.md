# Tally — session state

最後更新：2026-08-04（每日目標計算引擎再調整＋設定頁目標/速度拆欄位，v2.23；連同上輪
v2.22 食品庫重構一起，push 前 light review 已跑完，待確認 commit message 後 push）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`（v2.22/v2.23 這輪
> commit 後才會有紀錄）；2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)
>（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯＋每日目標計算引擎（v2.21→
  v2.23 三輪演進，細節見 DESIGN.md 版本紀錄，不在這裡重複展開）＋食品庫管理與設定頁重構
  （v2.22）。**這輪待 push**：v2.22（未提交）＋ v2.23（本輪）一起。
- **v2.23 改了什麼**：脂肪從「剩餘熱量固定比例」改成「體重 × 0.85 g/kg 固定值」，碳水吃
  剩餘熱量；「計算依據」拿掉收合 toggle 改常駐顯示；目標／變化速度從合併選單拆成兩個獨立
  select（`formulas.ts` 連帶移除 `GoalMode`／`goalModeFrom`／`goalFromMode`／`rateFromMode`
  整組橋接型別與函式）。完整脈絡與取捨見 DESIGN.md v2.23 版本紀錄。
- **測試**：`npx vitest run` 60/60；`npm run build`／`npm run lint` 乾淨；`npm run e2e`
  既有 31 條全綠（在拆欄位那步之後跑過一次）。`DailyGoal`／`FoodLibrary`／`WeightTrend`
  三個新畫面仍缺正式 e2e 覆蓋，只有跑完即刪的臨時 smoke test（v2.22 那輪做的）。

## Push 前 review（light，token 考量使用者指名降級，未跑 deep）

5 條 unverified-minor：修掉 2 條瑣碎的（`Settings.tsx` cleanup 註解寫錯「true」該是
「false」；`app.css` 的 `.lib-edit` 三值 padding shorthand 簡化成一值），3 條標記不修
（DailyGoal 的 effective getter 重複呼叫是風格觀察；activityFactor/proteinPerKg 送出前
範圍檢查早在 v2.22 就已改成信任 select，非本輪引入，security 維度標 minor/low；三組
touched-ref 模式重複，reviewer 自己判斷現在不必抽象）。另有一條 major（碳水夾 0 後熱量
總和可能超過 kcal）經 verifier 判定 rejected——同款夾住行為 v2.22 就已存在，脂肪與目標
熱量脫鉤是這輪使用者裁決的必然結果，不構成 regression，理由完整版見 DESIGN.md v2.23。

## 已驗證事實

- **screens 目錄下新增子頁不必上 router 套件**：Settings.tsx 自己管一個 `view` state 切換
  entry-list／DailyGoal／FoodLibrary／WeightTrend，跟 App.tsx 現有的 `tab` 分頁狀態機同一種
  「沒有 URL 的路由」慣例，專案至今沒裝 react-router。
- **e2e 的 fetch stub（`e2e/stub.ts`）完全不看 query 參數/filter**，只按 table+method 分流回
  同一份 fixture——`listFoods()`／`listArchivedFoods()` 的 `.eq('archived', ...)` 在 stub
  環境下拿到一模一樣的資料，真的要驗過濾邏輯正確性得等正式接後端或升級 stub。
- **把 DB 上本來分開的兩個欄位在 UI 層合併成一個模板字面量聯集型別（v2.22 的 `GoalMode`），
  短期內型別安全看起來漂亮，但使用者實際用起來覺得「一個選單塞兩件事」不好用**——UI 分組
  不必跟著 DB schema 硬拆，但也不該不必要地合併；這次拆回兩個欄位反而是簡化（跨 formulas.ts
  ／DailyGoal.tsx／test 三處都要動，事後拆的成本比想像中大，下次設計合併型 UI 前先想清楚）。

## 未解失敗

- **app icon 在 iOS 深色主畫面下仍顯示黑底白 T**（`dcf3cd3` 補滿版後，使用者真機複驗仍未
  解決）。下次先去對照 Gambit 專案的 icon/manifest 設定跟 Tally 的差異。已查證的天花板見
  DESIGN.md「App icon」條（web 端無法指定深色模式圖示變體），如果 Gambit 對照也解不了，
  剩下唯一槓桿是背景做透明只留 T 形狀，代價是淺色模式外觀跟著變，要使用者裁決。
- 舊的未解失敗（vitest Git Bash 炸、全量並行偶發 flaky、scrim 分區變色、就地編輯區無 focus
  trap、改份量無 debounce）維持原狀未動，細節見 git log 對應 commit 訊息。

## 待決問題

- **新畫面缺正式 e2e 覆蓋**：`DailyGoal`／`FoodLibrary`／`WeightTrend` 只驗過一次性 smoke，
  不在 `npm run e2e` 的 31 條常態回歸裡。下次評估要不要補 `daily-goal.spec.ts` 等。
- **`activityFactor`／`proteinPerKg` 送出前的範圍檢查已移除**，只信任 select 選項合法值
  （v2.22 起）。light review 標成 minor/low（單一使用者 app、攻擊面薄弱），先記著，若要補
  防禦深度就是一道輕量 clamp。
- **v2.23 沒有真機/瀏覽器截圖驗證**：兩欄位排版（目標＋條件式變化速度）跟計算依據常駐顯示
  的視覺效果都還沒看過，使用者以 token 吃緊為由指名先 push，留到下次。
- **每日目標即時預覽的驗證只在送出時擋**：欄位打到一半算不出來顯示 `—`，不跳錯誤——刻意
  設計，如果之後要加更嚴格的即時提示，這是切入點。
- **體重趨勢完整圖表本輪仍是佔位卡**：要過 `dataviz` skill 定案才能做，樣張已在
  `_design-sample/food-library.html` A3 frame。
- **PWA / service worker**：只有 manifest，沒有 SW。屬中型改動，開工先走 `dev-flow`。
- **零碎（都不擋上線）**：RLS 跨使用者 DELETE 未實測；`LogSheet.tsx` 餐別 chip 誤用
  `aria-current`（範圍外未動）；Notion 退場收尾未完成。

## 下次續點

1. **確認 commit message 後 push**（v2.22＋v2.23 一起）。
2. **app icon**：對照 Gambit 專案的 icon/manifest 設定找差異。
3. **真機/瀏覽器看一次 v2.23 的視覺效果**（兩欄位排版、計算依據常駐顯示），視需要微調。
4. 視優先度補新畫面的 e2e，或先讓使用者用一陣子看有沒有真的壞的地方再決定要不要補。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄）。動 UI 前必讀，改完
  必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑** → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑** → 全域 memory `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出只有真實
  資料才會浮現的問題；三層（樣張核可／真機試用／deep review）各自抓到不同類的問題，缺一層
  都會漏。
- 完整的歷史病歷 → `archive-2026-07.md`。
