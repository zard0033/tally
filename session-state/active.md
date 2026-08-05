# Tally — session state

最後更新：2026-08-05（v2.24–v2.27 已 push；v2.28／v2.29 待 push＝封存提示修復、食品庫新增改 sheet ＋ 食物表單合併共用元件）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；2026-07-30 手術前的
> 完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯＋每日目標計算引擎（v2.21→
  v2.23 三輪演進）＋食品庫管理與設定頁重構（v2.22）。細節見 DESIGN.md 版本紀錄。
  **v2.24–v2.27 已 push**（`fcf4270`）；**v2.28／v2.29 待 push**＝封存提示的四個缺陷修復、
  食品庫新增改 sheet ＋ 三處食物表單合併成 `src/components/FoodFormFields.tsx`。
- **測試**：`npx vitest run` 60/60；`npm run build`／`npm run lint` 乾淨；`npm run e2e`
  **58/58 全綠**（約 1.5 分；原 31 ＋ v2.24 新增 18 ＋ v2.27 新增 4 ＋ v2.28 新增 1 ＋ v2.29 新增 4）。長年偶發的
  `meal-exit-animation` flaky 在 worker 壓到 2 之後也穩定了——根因是並行壓力，不是動畫時序。
- **e2e 的跑法（v2.25 改）**：webServer 跑 `npm run build && npm run preview`，站在
  **port 5501**，跟開發用的 5500 分開——所以 `npm run dev` 可以一直開著不必為了跑測試關掉。
- **新增的 e2e**：
  - `daily-goal.spec.ts` 10 條——目標/速度兩個獨立 select、脂肪固定 g/kg、touched-ref 不覆寫
    DB 原值、動過選單就改用選單值、即時預覽顯示 — 不跳錯誤、計算依據常駐無 toggle 且有項目
    符號、BMR 說明 popover、自訂目標繞過公式、**select 有箭頭而 input 沒有**、
    **每個選單的最長選項都放得下**
  - `food-library.spec.ts` 14 條——搜尋比對品名＋店家、空狀態、就地編輯、編輯中隱藏 FAB、
    封存＋復原、範本新增、必填擋送出、儲存鈕不溢出卡片、三顆圖示筆畫重心置中、
    **封存提示長品名不撐破膠囊＋無障礙播報**、**新增走 sheet 不換頁**、
    **新增 sheet 的店家下拉點得到**、**就地編輯的店家也是 Autocomplete**
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
- **iOS 深色主畫面對 web clip 的處理是「換掉背景、保留前景的顏色」**（2026-08-05 兩輪實測定論）：
  原圖「綠底＋米白 T」在深色模式變成「黑底＋米白 T」，米白原封不動。
  **透明底不是解法**：實測 iOS 把透明區填黑，而且**淺色模式也填黑**——v2.25 試過，
  兩種模式都變黑底，淺色模式比原本更差，一輪即退回。（先前查到的「iOS 18 改填白」
  說法在實機上不成立，別再引用。）
  **正解＝不透明淺色底**：淺色模式看到米白底綠 T，深色模式由 iOS 換底、綠 T 留著。
  **v2.26 已由使用者實機確認無誤，此題結案**——「換底留前景」不再是推論，是實測定論。
  **方法論**：這題連五輪都在「對 iOS 行為做假設 → 部署 → 手機重加驗證」，每輪成本很高；
  真正縮短路徑的兩次都是**回頭看已經觀察到什麼**——先是「別的 app 也這樣嗎」定位到系統設定，
  再是「原圖在深色模式怎麼變的」推出換底留前景。**手上的觀察比新的猜測值錢。**
- **app icon 黑底白 T 的根因：是 iOS 系統行為，不是 Tally 的缺陷**（2026-08-05）。
  使用者的主畫面「圖示外觀」設定是**深色**——那個模式下 iOS 把**全機每一顆圖示**都染深。
  原生 app 能用 Xcode asset catalog 交深色變體讓系統改用，**web clip 沒有這個機制**
  （`prefers-color-scheme` 對 icon 無效，只對 splash screen 有效），iOS 只能自動生成。
  **沒有 web 端的開關可以退出**——所以只能選一組在兩種模式下都可接受的配色（見上一條）。
  排除過的四條假設，都是在找「我們做錯什麼」，而答案是「什麼都沒做錯」：
  ① 透明像素（v2.19 修過）② 檔案沒部署（sha256 三檔全 MATCH、Content-Type 正確）
  ③ SpringBoard 快取（移除重加後仍舊）④ alpha 通道（改 RGB 後仍舊）。**別再重試這四條。**
  **教訓**：症狀出現在單一 app 上，不代表原因在那個 app——問一句「別的 app 也這樣嗎」
  可以省掉四輪。這題從頭到尾缺的就是那個對照組。
- **食物表單三處共用一份 JSX（v2.29）**：`src/components/FoodFormFields.tsx`。抽出來的
  觸發點不是「看起來重複」，是**已經分岔過兩次**——品名欄漏 `inputMode`（手機打不出中文）、
  食品庫那份沒有店家 Autocomplete。純邏輯早在 `src/lib/foodForm.ts` 共用，UI 那半拖到現在。
  **判準記著**：兩份長得像不構成抽出來的理由，「兩邊本來就該一致、而且已經開始不一致」才是。
- **修分岔的那一輪，最容易製造新的分岔**（v2.29 deep review 抓到三條，兩條是本輪自造）：
  ① 一邊把表單 JSX 抽成共用元件，一邊在食品庫照抄了一份跟 LogSheet 逐字相同的
  `vendorOptions` 去重邏輯——已改走 `src/lib/foodForm.ts` 的 `vendorOptionsOf()`。
  ② 修無障礙時把 `role="status"` 直接掛在 `<button>` 上，**顯式 role 會取代隱含 role**，
  讀屏反而找不到那顆按鈕——正確結構是外層帶播報、內層留乾淨的 button（今日頁一直是這樣）。
  ③ 把 undo pill 放寬成整行，長品名就水平蓋住 FAB 且 z-index 更高，5 秒內按新增變誤觸。
  **共同形狀：改動的當下只盯著要修的那個缺陷，沒有重新檢查它跟周圍元件的關係。**
- **新測試做過 mutation 檢查才收**（兩輪都做）：v2.24 那輪把 `effectiveRateKgPerWeek` 改成
  永遠讀選單值、`FAT_G_PER_KG` 改回舊比例；v2.27 那輪把儲存鈕的 flex 覆寫、範本圖示座標、
  select 箭頭選擇器三處各自改回舊行為——每次都是對應測試變紅、其餘不誤報。
  綠色測試不等於有效測試，這一步值得每次補測試都做一次。
- **版面問題要量對東西**（2026-08-05 三處真機回報的共同教訓）：
  ① 圖示「看起來沒對齊」時，量元素框永遠查不出來——三顆 `.icon-btn` 的 44px 盒與 17px 畫布
  完全一致，偏的是 SVG **筆畫**在 viewBox 裡的位置（`getBBox()` 重心 y=8.5 而非 12）。
  ② `select` 文字放不下時**不會有 ellipsis，只是安靜切掉**，肉眼 review 抓不到，只能量
  「最長選項需要多寬」對「欄位給多寬」。③ 全域元件搬進新容器要重驗：`.pick-bar-btn` 的
  `width: 100%` ＋ `flex-shrink: 0` 在底部確認列是對的，進到 flex row 就溢出 96px。
  **這三題若照肉眼判斷去改，第①題會改錯地方（調 CSS 對齊而不是修 SVG 座標），
  第③題會漏掉活動量截斷這個附帶災情。**
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

- **`activityFactor`／`proteinPerKg` 送出前的範圍檢查已移除**，只信任 select 選項合法值
  （v2.22 起）。light review 標 minor/low，要補防禦深度就是一道輕量 clamp。
- **體重趨勢完整圖表仍是佔位卡**：要過 `dataviz` skill 定案才能做，樣張在
  `_design-sample/food-library.html` A3 frame。e2e 刻意只驗進出不鎖內容。
- **PWA / service worker**：只有 manifest，沒有 SW。屬中型改動，開工先走 `dev-flow`。
- **零碎（都不擋上線）**：RLS 跨使用者 DELETE 未實測；`LogSheet.tsx` 餐別 chip 誤用
  `aria-current`（範圍外未動）；Notion 退場收尾未完成。

## 下次續點

1. **push v2.28／v2.29**（v2.28 已本地 commit；v2.29 未提交）。push 前照全域
   `rules/git-push.md` 走 review。
2. 沒有進行中的任務。下一輪可以挑「待決問題」裡的任一項開工（體重趨勢圖表要先過
   `dataviz`；PWA/SW 屬中型，先走 `dev-flow`）。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄）。動 UI 前必讀，改完
  必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑** → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑** → 全域 memory `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出只有真實
  資料才會浮現的問題；三層（樣張核可／真機試用／deep review）各自抓到不同類的問題。
- 完整的歷史病歷 → `archive-2026-07.md`。
