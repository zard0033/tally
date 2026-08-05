# Tally — session state

最後更新：2026-08-05（v2.24 已 push；v2.25 待 push＝icon 改透明底綠 T ＋ e2e 改跑靜態 preview）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；2026-07-30 手術前的
> 完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯＋每日目標計算引擎（v2.21→
  v2.23 三輪演進）＋食品庫管理與設定頁重構（v2.22）。細節見 DESIGN.md 版本紀錄。
  **v2.24 已 push**（`f9df19a`）；**v2.25 待 push**（icon 改透明底＋`#2A9D7A` 綠 T、
  e2e 改跑 build 後的靜態 preview）。
- **測試**：`npx vitest run` 60/60；`npm run build`／`npm run lint` 乾淨；`npm run e2e`
  **49/49 全綠**（約 1.1 分；原 31 ＋ 新增 18）。長年偶發的 `meal-exit-animation` flaky
  在 worker 壓到 2 之後也穩定了——那條的根因其實是並行壓力，不是動畫時序。
- **e2e 的跑法（v2.25 改）**：webServer 跑 `npm run build && npm run preview`，站在
  **port 5501**，跟開發用的 5500 分開——所以 `npm run dev` 可以一直開著不必為了跑測試關掉。
- **新增的 e2e**（三個檔，補齊 v2.22/v2.23 新畫面）：
  - `daily-goal.spec.ts` 8 條——目標/速度兩個獨立 select、脂肪固定 g/kg、touched-ref 不覆寫
    DB 原值、動過選單就改用選單值（換算成 kg/週）、即時預覽顯示 — 不跳錯誤、計算依據常駐
    無 toggle 且有項目符號、BMR 說明 popover、自訂目標繞過公式
  - `food-library.spec.ts` 7 條——搜尋比對品名＋店家、空狀態、就地編輯、編輯中隱藏 FAB、
    封存＋復原、範本新增、必填擋送出
  - `settings-nav.spec.ts` 3 條——三入口導覽往返、底部列收起與還原、入口熱量與目標頁一致

## 已驗證事實

- **e2e 的 worker 數會跟著 spec 檔數長，第 9 個檔就撞牆——而且連撞兩層**（2026-08-05）：
  `fullyParallel: false` 下平行單位是**檔案**，加到 9 檔就是 9 個 worker。
  **第一層（後端）**：9 個 worker 同時要求模組轉換，Vite dev server 自己
  `FATAL ERROR: Zone Allocation failed - process out of memory` 死掉；瀏覽器端看到的卻是
  `Could not connect to server`，**症狀在前端、死因在後端**。
  **第二層（前端）**：壓到 4 之後 server 活了，換 WebKit 自己倒——
  `Cannot find parent object page@…`、`browserContext.newPage: … has been closed`。
  量了才知道原因：機器 31.7 GB 但當下**只剩 5.0 GB 可用**（VS Code 2.2G、Figma 三支 2.6G、
  dwm 1.3G、vmmem 0.9G），4 個 WebKit 實例塞不下。**`workers: 2` 後 49/49 綠。**
  **教訓**：兩層都表現成「Playwright 壞了」，但兩次的真兇都不在 Playwright——
  先讀 `[WebServer]` 那幾行、再量機器餘裕，比改測試碼快得多。
  **兩層都已從根上處理（v2.25）**：後端改跑 build 後的 `vite preview`（沒有現場轉譯就沒有
  OOM），port 分到 5501（e2e 不走 OAuth，不受 5500 白名單約束），因此 `reuseExistingServer`
  得以改成 `false`——孤兒 server 的陷阱從「靠 CLAUDE.md 一句人工提醒」變成機械上不可能發生。
  `workers: 2` 保留，它守的是瀏覽器端容量，跟 server 怎麼跑無關。
- **app icon 黑底白 T 已結案：是 iOS 系統行為，不是 Tally 的缺陷**（2026-08-05）。
  使用者的主畫面「圖示外觀」設定是**深色**——那個模式下 iOS 把**全機每一顆圖示**都染深。
  原生 app 能用 Xcode asset catalog 交深色變體讓系統改用，**web clip 沒有這個機制**
  （`prefers-color-scheme` 對 icon 無效，只對 splash screen 有效），iOS 只能自動生成。
  **沒有 web 端的開關可以退出。別再開第五輪。**
  追過並排除的四條假設，都是在找「我們做錯什麼」，而答案是「什麼都沒做錯」：
  ① 透明像素（v2.19 修過）② 檔案沒部署（sha256 三檔全 MATCH、Content-Type 正確）
  ③ SpringBoard 快取（使用者移除重加後仍舊）④ alpha 通道（本輪改的，不是解答）。
  **教訓**：症狀出現在單一 app 上，不代表原因在那個 app——問一句「別的 app 也這樣嗎」
  可以省掉四輪。這題從頭到尾缺的就是那個對照組。
- **新測試做過 mutation 檢查才收**：把 `effectiveRateKgPerWeek` 改成永遠讀選單值、把
  `FAT_G_PER_KG` 改回「剩餘熱量固定比例」，對應那兩條各自變紅、其餘 5 條不誤報。
  綠色測試不等於有效測試，這一步值得每次補測試都做一次。
- **e2e 的 fetch stub（`e2e/stub.ts`）完全不看 query 參數/filter**，只按 table+method 分流回
  同一份 fixture——所以 `food-library.spec.ts` 全部斷言只用「使用中」分頁，兩個分頁的
  資料差異在 stub 升級前測不了（測了只會鎖住 stub 的行為）。
- **screens 目錄下新增子頁不必上 router 套件**：Settings.tsx 自己管一個 `view` state 切換
  entry-list／DailyGoal／FoodLibrary／WeightTrend，跟 App.tsx 的 `tab` 同一種「沒有 URL 的路由」。
  代價是 `Settings.tsx` 那行 unmount cleanup（`onSubViewChange(false)`）目前 **UI 走不到**
  ——底部列已收起、分頁鈕點不到、也沒有 URL 可繞，所以刻意沒為它寫測試。
- **把 DB 上分開的兩個欄位在 UI 層合併成模板字面量聯集型別（v2.22 的 `GoalMode`）**短期型別
  安全漂亮，但使用者實際用起來覺得「一個選單塞兩件事」不好用；拆回兩欄位要跨 formulas.ts
  ／DailyGoal.tsx／test 三處，事後拆比想像中貴。設計合併型 UI 前先想清楚。

## 未解失敗

- **app icon 已結案，移出未解失敗**（見上方「已驗證事實」）。
- 其餘舊的未解失敗（vitest Git Bash 炸、scrim 分區變色、就地編輯區無 focus trap、
  改份量無 debounce）維持原狀未動，細節見 git log 對應 commit 訊息。

## 待決問題

- **變化速度：使用者裁決保留原本五檔（0.5／0.75／1／1.25／1.5 kg/月），選單不動。**
  但他 DB 裡的 `rate_kg_per_week = 0.5`（≈2.17 kg/月）仍不在這五檔上，所以畫面顯示
  近似後的 1.5、實際計算用真實的 2.17（touched-ref 保護正確，1778 卡是對的）。
  **要讓兩者一致，使用者得自己在每日目標頁選一檔再存一次**——而那會真的改掉目標：
  選最快的 1.5 kg/月 → 每日熱量 1778 → **1947 卡**、碳水 163 → **205 g**、
  減重速度 0.5 → 0.346 kg/週。**尚未執行，等他決定要不要接受這個變化。**
  （參考：1.5 kg/月 ＝ 體重的 0.46%/週，低於一般建議的 0.5–1%/週區間下緣；
  他原本的 0.5 kg/週 ＝ 0.66%/週 落在區間中段。這是選單窄、不是他的值激進。）
- **`activityFactor`／`proteinPerKg` 送出前的範圍檢查已移除**，只信任 select 選項合法值
  （v2.22 起）。light review 標 minor/low，要補防禦深度就是一道輕量 clamp。
- **體重趨勢完整圖表仍是佔位卡**：要過 `dataviz` skill 定案才能做，樣張在
  `_design-sample/food-library.html` A3 frame。e2e 刻意只驗進出不鎖內容。
- **PWA / service worker**：只有 manifest，沒有 SW。屬中型改動，開工先走 `dev-flow`。
- **零碎（都不擋上線）**：RLS 跨使用者 DELETE 未實測；`LogSheet.tsx` 餐別 chip 誤用
  `aria-current`（範圍外未動）；Notion 退場收尾未完成。

## 下次續點

1. **push v2.25 後請使用者在實機重加一次主畫面圖示**，看透明底＋綠 T 在深色主畫面的
   實際效果。**這是本輪唯一還沒被驗證的假設**：iOS 會把透明底填成黑還是白，現有資料
   互相矛盾；深色模式下會不會再對它做一次處理也不知道。選 `#2A9D7A` 就是為了兩種都撐得住，
   但實機看過才算數。若結果仍不理想，下一步不是再猜——是請他截圖，看實際被填成什麼色。
2. **變化速度**：使用者說他自己處理了，下次確認一下 DB 值是否已落在選單五檔上。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄）。動 UI 前必讀，改完
  必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑** → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑** → 全域 memory `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出只有真實
  資料才會浮現的問題；三層（樣張核可／真機試用／deep review）各自抓到不同類的問題。
- 完整的歷史病歷 → `archive-2026-07.md`。
