# Tally — session state

最後更新：2026-08-03（食品庫管理與設定頁重構 v2.22 完工，precommit-review deep 跑完並修完
全部 5 條 confirmed findings，vitest/build/lint/e2e 全綠，即將 push）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；
> 2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯＋每日目標計算引擎（`c8435df`，
  已 push，backfill SQL 已補跑確認正常）＋**本輪：食品庫管理與設定頁重構**（見下方「本輪」，
  未 commit）。
- **測試**：`npx vitest run` 64/64（PowerShell 跑，Git Bash 全炸）；`npm run build`／`npm run lint`
  乾淨；`npm run e2e` 既有 31 條全綠。**新畫面另外寫過一支臨時 Playwright smoke test（跑完即刪，
  未進版控）**走過入口列表→每日目標→食品庫管理（就地編輯／已封存分頁／新增食物）→體重趨勢，
  截圖確認 token 無黑色 fallback、零 JS 例外——**這不等於正式 e2e 覆蓋**，下次接手要補。

### 本輪（2026-08-03，未 commit）：食品庫管理與設定頁重構（v2.22）

延續上輪抽出去先做的「每日目標計算引擎」，這輪把樣張（`_design-sample/food-library.html`）
剩下的呈現落地：設定頁改純入口列表、每日目標／食品庫管理／體重趨勢三個新獨立頁、「更新身體
數據」sheet 精簡成只剩體重體脂兩欄。**同一輪使用者中途追加需求 `[追加]`**：變化速度單位從
kg/週改 kg/月、五個固定選項（0.5/0.75/1/1.25/1.5），不留自訂手動輸入。

- **新檔**：`screens/DailyGoal.tsx`（每日目標，即時預覽 hero＋分組卡片＋詳細收合）、
  `screens/FoodLibrary.tsx`（搜尋／使用中·已封存／店家分組／就地編輯／範本新增／封存+5秒
  復原／FAB）、`screens/WeightTrend.tsx`（獨立頁，完整圖表本輪不畫，只有佔位卡）、
  `lib/foodForm.ts`（食物表單驗證邏輯，LogSheet／FoodLibrary 共用，去掉三處重複）。
- **改檔**：`Settings.tsx` 整個重寫成路由殼（`view: list|goal|library|trend`，沒有上 router
  套件，跟 App.tsx 的 `tab` state 同一種慣例）；`formulas.ts` 新增 `RATE_PRESETS_KG_PER_MONTH`／
  `rateWeeklyToMonthly`／`rateMonthlyToWeekly`／`rateFromMode`，`GoalMode` 改成 template
  literal 聯集型別（`` `${goal}:${preset}` ``），**DB 欄位 `rate_kg_per_week` 語意不變**（換算
  只在 UI 邊界做，`computeTargets` 沒改）；`api.ts` 加 `archived` 欄位、`listArchivedFoods`／
  `updateFood`／`listWeights`；`App.tsx` 補 `handleUpdateFood`／`handleArchiveFood`／
  `handleUnarchiveFood`；`app.css` 補 entry-list／goal-group／lib-group／lib-fab／undo-pill 等
  新元件樣式；DESIGN.md 補五條元件規則＋v2.22 版本紀錄。
- **Schema**：`foods.archived` 欄位是上上輪就加好的既有欄位（`foods.archived` 那輪），這輪只是
  第一次真正用起來（`listFoods()` 補上 `.eq('archived', false)` 過濾）——**沒有新的 migration
  要跑**。
- **封存機制的取捨**：archived 是可逆 UPDATE，樂觀＋5 秒復原刻意不比照 App.tsx 的 intake 硬刪除
  （那邊延遲真正送出是因為不可逆才需要）——這裡立刻送出、失敗才回滾，省掉一整套 pendingDelete／
  pagehide flush 機制，理由與範圍寫在 `FoodLibrary.tsx` 頂部 `ponytail:` 註解。

## precommit-review（deep，push 前）修完的 5 條 confirmed

1. **`DailyGoal.tsx` 儲存成功後 `busy` 沒重設**——存檔成功兩條分支都只在 catch 裡
   `setBusy(false)`，頁面存檔後刻意留在原畫面（不 unmount），按鈕永遠卡「儲存中…」。已在
   兩個成功分支各補一行。
2. **`FoodLibrary.tsx` 的 `hiddenIds` 誤套用到「已封存」分頁**——封存的樂觀隱藏集合原本對
   兩個分頁共用，5 秒後 id 永遠留著，剛封存那筆在「已封存」分頁也看不到、無法復原，只能
   離開頁面重進才救得回。改成 `tab !== 'active' || !hiddenIds.has(...)`，只在使用中分頁套用。
3. **`DailyGoal.tsx` 即時預覽把「欄位留空」誤算成 0**——`num('')===0` 不是 `NaN`，清空出生年
   會讓 `ageFromYear` 算出兩千多歲、清空身高讓 BMR 算出離譜負值，卻因為是「有限值」逃過
   `Number.isFinite` 守門，畫面顯示荒謬大數字而非設計要的 `—`。改用跟送出驗證同一把尺的
   `reqNum`（空字串→NaN）。
4. **`FoodLibrary.tsx` 的 `field()` 沒有 `numeric` 參數，品名輸入框被叫出小數字鍵盤**——跟
   LogSheet 的 `renderField` 各自重複實作，唯獨這份漏了條件判斷。補上 `numeric?: boolean`，
   只有熱量／三大營養素傳 `true`。
5. **既有 `rate_kg_per_week=0.5`（＝2.17 kg/月）超出新五個 preset 的上限 1.5，被夾到最接近值
   後靜默改變**——會讓 DailyGoal 的 hero 與今日頁／入口列表同時顯示兩個不同的目標熱量（差
   ~170 卡/日），且使用者只是進來看一眼按儲存，DB 裡的速度就被四捨五入掉。改成
   `goalModeTouchedRef`：只要使用者沒手動碰過「目標」選單，一律沿用 `profile.rate_kg_per_week`
   原始值（live 預覽與送出都吃這個），選單顯示的 preset 只是「最接近的近似」，不會覆寫真實值。

另外多修一條 unverified-minor：**食品庫列三顆圖示鈕被縮到 40px，低於 DESIGN.md「觸控區」
條明文的 ≥44px 不可砍底線**——雖未經 deep review 的對抗性驗證，但它直接違反本專案已寫死的
硬規則，不是品味判斷，順手改回繼承全域 `.icon-btn` 的 44×44（只縮圖示本身到 17px），截圖
確認不擠版。

修完後：重跑 `vitest`（64/64）／`build`／`lint` 全綠、`npm run e2e`（31/31）全綠，另外四支跑完
即刪的臨時 Playwright smoke test 針對性驗證（按鈕不再卡住／品名欄無 decimal inputMode／
封存後已封存分頁看得到／hero 與入口列表數字一致／44px 觸控區不擠版）皆通過。**其餘 20+ 條
unverified-minor 未逐條修**（e.g. sheet 關閉不還焦點、`role=tab` 缺 `aria-selected`、三處
floating-label 元件重複、CLAUDE.md 的 e2e 條數與版本號落後）——留給下次接手評估，理由是這些
沒經過 deep review 的對抗性驗證（只有 critical/major 進了 verify 批次），且多數是可累積處理的
readability/a11y 債，不是這輪 push 前的硬門檻。

## 已驗證事實

- **screens 目錄下新增子頁不必上 router 套件**：Settings.tsx 自己管一個 `view` state 切換
  entry-list／DailyGoal／FoodLibrary／WeightTrend，跟 App.tsx 現有的 `tab` 分頁狀態機同一種
  「沒有 URL 的路由」慣例，專案至今沒裝 react-router，這次也不必為四個子畫面破例。
- **`GoalMode` 用 TS template literal type 表達「離散字串聯集」很好用**：
  `` `${Goal}:${RatePreset}` `` 讓五個 kg/月 preset × 兩個 goal 自動長出 10 個字面量型別＋
  `maintain`，比手寫 11 個 union member 或退化成裸 `string` 兩種寫法都乾淨，且 `RATE_PRESETS_
  KG_PER_MONTH` 改動時型別自動跟著變動不必手改。
- **e2e 的 fetch stub（`e2e/stub.ts`）完全不看 query 參數/filter**，只按 table+method 分流回同
  一份 fixture——這代表 `listFoods()` 的 `.eq('archived', false)` 與 `listArchivedFoods()` 的
  `.eq('archived', true)` 在 stub 環境下會拿到一模一樣的資料，不是真的驗證了過濾邏輯，只驗證了
  畫面能不能渲染兩份清單。真的要驗封存/復原的資料正確性，得等正式接上真後端或升級 stub。

## 未解失敗

- **app icon 在 iOS 深色主畫面下仍顯示黑底白 T**（`dcf3cd3` 補滿版後，使用者 2026-08-03 真機
  複驗仍未解決）。下次要診斷先去對照 Gambit 專案的 icon/manifest 設定跟 Tally 的差異——這是
  使用者給的新線索，尚未查證。已查證的天花板見 DESIGN.md「App icon」條（web 端無法指定深色
  模式圖示變體），如果 Gambit 對照也解不了，剩下唯一槓桿是背景做透明只留 T 形狀，代價是淺色
  模式外觀跟著變，要使用者裁決。
- 舊的未解失敗（vitest Git Bash 炸、全量並行偶發 flaky、scrim 分區變色、就地編輯區無 focus
  trap、改份量無 debounce）維持原狀未動，細節見 git log 對應 commit 訊息，不在此重複展開。

## 待決問題

- **新畫面缺正式 e2e 覆蓋**：`DailyGoal`／`FoodLibrary`／`WeightTrend` 目前只驗過一次性 smoke
  （已刪，未進版控），不在 `npm run e2e` 的 31 條常態回歸裡。下次要不要照現有六個 spec 檔的
  慣例補一個 `food-library.spec.ts`／`daily-goal.spec.ts`，由使用者評估優先度。
- **每日目標即時預覽的驗證只在送出時擋**：欄位打到一半算不出來（例如刪掉出生年）hero 顯示
  `—`，不會跳錯誤——這是刻意設計（草稿態不該被規則打斷），但如果之後要加更嚴格的即時提示，
  這是切入點。
- **體重趨勢完整圖表本輪仍是佔位卡**：要過 `dataviz` skill 定案才能做（近 30/90 天切換、體脂
  要不要同框），樣張已在 `_design-sample/food-library.html` A3 frame。
- **PWA / service worker**：只有 manifest，沒有 SW。屬中型改動，開工先走 `dev-flow`。
- **零碎（都不擋上線）**：RLS 跨使用者 DELETE 未實測；`LogSheet.tsx` 餐別 chip 誤用
  `aria-current`（範圍外未動）；Notion 退場收尾未完成。

## 下次續點

1. **push 這輪**：走 CLAUDE.md Pre-Push Checklist（測試/build/lint 都已綠，DESIGN.md 已回寫），
   確認 commit message 後 push。
2. **app icon**：對照 Gambit 專案的 icon/manifest 設定找差異。
3. **視優先度補新畫面的 e2e**，或先讓使用者用一陣子看有沒有真的壞的地方再決定要不要補。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄 v1→v2.22）。動 UI 前必讀，
  改完必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑** → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑** → 全域 memory `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出只有真實資料
  才會浮現的問題；三層（樣張核可／真機試用／deep review）各自抓到不同類的問題，缺一層都會漏。
- 完整的歷史病歷 → `archive-2026-07.md`。
