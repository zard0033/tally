# Tally — session state

最後更新：2026-07-28

## 已驗證事實

- **Supabase 專案已建**：`https://bpnucfejoiazmsnsuzdb.supabase.co`，anon key 為 `sb_publishable_` 新格式。
- **四張表 + RLS 已上線**（`schema.sql`）。實測隔離生效：未登入讀 foods/intake/weight/profile 回 `[]` HTTP 200，寫入被 `42501 violates row-level security policy` 擋下。
- **Notion 遷移已完成**（`seed.sql`）：foods 23、intake 29、weight 47、profile 1。verifier 已對 Notion 原始資料逐欄核對六條驗收條件全過。**Notion 尚未刪除**，等 app 能實際使用後才退場。
- **公式鏈已反推確認**：Mifflin-St Jeor → ×活動係數 1.375 → 減重 ×0.8。使用者提供的熱量調整值公式為 `減重 → TDEE × -0.2`／`增肌 → +500`／`維持 → 0`。三大營養素比例 27/27/46。以最新體重 75.95kg（量測日 07-24）、身高 173、年齡 31 計算，
  BMR 1691 → TDEE 2325 → 目標 1860 kcal / P126 / F56 / C214。**app 實際跑出的值已與此一致。**
- **體重存體脂計原始讀數，不做校正**。校正（−1.85kg／−2.5pp）為固定偏移，不改變趨勢斜率，對目標熱量僅影響約 20 kcal。
- **repo 已轉 public**（`gh repo view` 確認 PUBLIC）。前端只有 anon key，隱私靠 Auth + RLS。
- **Google OAuth 已設定**：GCP client 已建、Supabase provider 已啟用、Redirect URLs 已加 `http://localhost:5500/**` 與 `https://zard0033.github.io/tally/**`。
- **設計流程 ⓪→➊→➋ 已走完**，`DESIGN.md` 已產出。定案骨架與色系見該檔。
- **破表狀態已細琢（2026-07-28，DESIGN.md v1.1）**：斜紋改「`--over-fill` 打底 + 22% 白細紋疊層」（原實色亮條在 cream 上像斑馬線）；並補掉 v1 的無障礙漏洞——3px 營養素條上斜紋會糊成純紅，改由**破表時 3px → 6px 的高度差**當主要非顏色訊號，紋理退為第二層（紋理內部對比僅 1.47:1，WCAG 公式實算，撐不起單獨辨識）。`--over-fill` 對 paper 4.50:1 過圖形 3:1 門檻。六變體樣張見 `over-stripe-options.html`，定案＝C + F。
- **首次 push 已完成**（2026-07-27）。precommit-review（deep，runId `wf_f4ffe4a0-4a0`）抓到 `seed.sql` 含真實個資且 repo public、schema/seed 不同步、`activity_factor` 精度不足三個 confirmed，已修正。**`seed.sql` 已從全部歷史用 `git filter-branch` 清除**（原本在 `0c42c19` 引入），gc 後本機 blob 亦不可達；遠端核對 `contents/seed.sql` 回 404。`seed.sql` 實體檔案留在本機、`.gitignore` 排除，是遷移唯一副本，**不要再次 `git add`**。分支已改名 `master` → `main` 對齊遠端預設分支。

- **前端骨架 ＋ 今日頁 ＋ 設定頁已上線並實測**（2026-07-28）。`index.html` / `app.css` / `app.js` 三檔，
  無框架無 build。**不用 supabase-js**——CDN 載法違反 `DESIGN.md`；vendor 進 repo 則是本專案無 npm 無
  lockfile，120KB 要手動追版本與安全更新，而其中只有 OAuth 與 CRUD 用得到。改自己接：
  Auth 走 OAuth implicit flow、資料直打 PostgREST，約 80 行。
- **Google OAuth implicit flow 實測可用**，不需要改 PKCE。`/authorize` 不帶 `code_challenge` 時
  Supabase 把 token 回在 URL hash；讀完立刻 `replaceState` 抹掉，不留在歷史／截圖／分享連結。
  程式對 `?code=` 有明確錯誤訊息，哪天專案改吃 PKCE 不會靜默停在登入頁。
- **UID 沒有分裂**：Google 用同一 email 連結到既有 user，`auth.users` 只有一筆，99 筆遷移資料直接讀得到。
  session 存 localStorage，重整不需重登（已實測）。
- **`activity_factor` 的檔案修正沒有落到 DB**（2026-07-28 才發現並修）。precommit review 當時把
  `schema.sql` 與 `seed.sql` 改成 `numeric(4,3)` / `1.375`，但 profile 那筆是更早用
  `numeric(4,2)` 灌進去的，值被截成 **1.38**，目標因此算成 1867 而非 1860。已跑
  `alter table profile alter column activity_factor type numeric(4,3);` ＋ `update profile set activity_factor = 1.375;` 修正。
  **教訓：改了 migration 檔不等於改了線上資料。**
- **`app.js` 有 self-check**：開 `?check` 跑公式鏈、`pct` 的 clamp 與 NaN、未捨入加總、
  跨時區日期、生日邊界，結果進 console。改計算邏輯後跑一次。

- **「記一筆」設計已定案（2026-07-28，`DESIGN.md` v1.7）**。走了八輪決策樣張，定稿＝`sample-log-entry.html`
  七屏。骨架：同頁 sheet（不做獨立頁）／清單多選（使用者平日早餐固定三樣，逐一新增要走三趟）／
  已選項目置頂常駐、不隨餐別切換消失／底部確認列小計靠左剩餘靠右／搜尋吃品名＋店家／
  新增食物入口只要有輸入就常駐清單末尾／表單 floating label／刪除在今日頁走 CSS scroll-snap 左滑
  ＋點擊雙路徑、垃圾桶 icon。全站熱量單位改中文「卡」（aria-label 仍寫「大卡」）。
- **第一版範圍擴張（使用者拍板）**：加入**日期切換**（原列第二版）——原生 `input type=date` ＋ 左箭頭，
  歷史日主數字改顯示攝取量、標籤換「攝取」；加入**設定頁編輯**（身高／生日／性別／活動係數／目標／
  三大營養素比例）與獨立的**記體重**入口（append 到 `weight`，不是覆寫 profile）。
  「同上次」一鍵仍留第二版。
- **資料模型三項變更已定**：`foods` 砍 `category`（23 筆裡 22 筆同一值，無資訊量）；
  `intake` 加 `kcal`/`protein`/`fat`/`carb` **營養快照四欄**（存單份值，不乘 qty）——理由是每週能量對帳
  需要歷史穩定，改食物營養值不該改寫過去；`profile` 加 `protein_pct`/`fat_pct`/`carb_pct`（27/27/46，
  check 相加 100），把原本寫死在 `app.js` 的比例搬進 DB。**不加 `serving` 欄**——份量單位不參與計算／
  搜尋／分組，純顯示，寫在品名裡即可（`乳清（1匙）`）。同理不加備註欄。
- **食品庫命名規則已定**：品名只放食物名＋使用者自己的描述，店家一律進 `vendor` 欄、去掉 emoji 前綴。
  搜尋必須同時比對 name 與 vendor——五筆「雞胸餐盒」只靠店家區分。
  **店家分兩層瀏覽已否決**：vendor 分散在 11 個店家、8 個只有一筆，群組數接近項目數。

## 未解失敗

尚未有。

**待處理（非阻塞）**：`seed.sql` 與變更後的 `schema.sql` 已不相容——seed 的 foods insert 仍列 `category`、
intake insert 缺四個 not null 新欄。從零重建 DB 的流程實質斷掉。seed 是一次性歷史文件、真要重建時
補跑 `migrate-v2.sql` 即可，優先度低，但別以為那組合還跑得起來。

## 下次續點

實作前必讀 `DESIGN.md` v1.7（尤其「禁止事項」與「已否決的做法」兩節）與 `sample-log-entry.html` 七屏。

1. ~~前端骨架：登入頁（Google OAuth）→ 今日頁~~ ✅
2. ~~今日頁實作~~ ✅ 五屏都驗過
3. ~~「記一筆」決策樣張~~ ✅ 八輪迭代，定稿七屏
4. ~~`migrate-v2.sql` 執行~~ ✅ **2026-07-28 已執行並驗證**。schema 三項變更用 PostgREST 探測確認
   （`foods.category` 回 42703 已砍；`vendor`、intake 四欄、profile 三個 pct 欄皆 200）。
   因整份包在單一 transaction，`set not null` 與 `check (相加=100)` 通過即證明 intake backfill 無 null、
   profile 已灌 27/27/46。foods 23 筆品名／店家清洗由使用者跑 select 貼回逐筆核對通過
   （無 `|`／`｜`／emoji 殘留，5 筆雞胸餐盒中 3 筆完全同名、全靠 vendor 區分）。
5. ~~實作「記一筆」sheet~~ ✅
6. ~~實作今日頁刪除~~ ✅
7. ~~實作日期切換~~ ✅
8. ~~實作設定頁編輯 ＋ 記體重入口~~ ✅

**第一版功能已全部完成（2026-07-28，`DESIGN.md` v1.8）。** 兩處 `ponytail:` disabled 已解開，
寫死的 27/27/46 改讀 `profile` 三個新欄位。

**實作階段才決定的三件**（樣張沒回答，已定案）：

- 份量 0／空白／負數／非數字 → `normalizeQty` 一律回 1。不 disable 按鈕（不留死路）；
  **打字途中不正規化**，留到失焦才做——否則「1.」這種中間狀態會被改成 1、游標跳走
- 左滑開一列**自動關其他**（同時開兩列沒有意義，誤觸風險加倍）
- floating label 的 **iOS AutoFill 行為仍未驗證**（程式裡標了 `ponytail:`）。真機若看到標籤壓字，
  改用 `input` 事件加 class 判斷，別靠 `:placeholder-shown`

**實作時修掉的五個坑**（都是樣張／規範沒寫、實跑才撞到的，改動前先讀 `DESIGN.md` v1.8 版本紀錄）：

1. **sheet 不可以整塊重繪**。`renderSheet()` 換掉 `innerHTML` 會咬掉兩件事——點「加入」時
   份量框先失焦觸發重繪，mousedown 的目標離開 DOM，**click 根本不派送**（填完份量按加入沒反應）；
   搜尋框每打一字被換掉，**中文注音組字會被打斷**。清單與確認列一律走增量
   （`renderList()` / `syncPickBar()`），只有開啟與切 view 才 `renderSheet()`。
2. **表單欄位一律在 `withBusy` 之前讀完**。`withBusy` 會先重繪，之後再讀就是空值——
   `vendor` 曾因此靜默存成 null。
3. floating label 的 52/18/13 會讓標籤與輸入文字**重疊 4.7px**，改 60/26/8 ＋ `line-height: 1`。
4. 品項寬度是分數值（320.4px），刪除鈕左緣落在裁切邊的同一個分數像素上，**未滑開時沿右緣露一條紅線**。
5. class 撞名：確認列的 `.line` 撞到時間軸連接線的 `.line`（`width: 1px`），整列被壓成直排。

**驗收方式（下次要驗同樣的東西照這個做）**：登入走 Google OAuth，agent 進不去。
做法是 stub `window.fetch` ＋ 塞 `localStorage` 的 `tally.session`，再直接呼叫全域的 `showApp()`
（`app.js` 沒有模組化，函式都在全域）。這樣能跑完整 UI 而不需要真帳號。

### 待確認 / 待處理

- **飲食紀錄有 4 筆刻意未遷移**（07-23 早餐重複 ×2、07-25 晚餐空、07-27 午餐空），使用者表示之後在新 app 自行補。
- **本機開發用 `python -m http.server 5500`**（Supabase redirect URL 白名單已對應這個 port）。playwright MCP 擋 `file://`，一定要走 http。

- **樣張已過三路獨立評審（2026-07-28）**：a11y／code、UX／產品、視覺各派一個 fresh agent，共 60 條 findings。最重的一條是**「一屏不捲」原本建在錯的高度上**——844px 是 iPhone 14 Pro 的螢幕高度，Safari 有網址列時只剩約 745px，實測破表屏在該高度溢出 84px（晚餐與點心整段消失）。已修正並改用 745px 為設計基準。已處理的進 `DESIGN.md` v1.4，**未處理的 20 條在 `session-state/review-findings.md`，實作時逐條對**。

### 設計樣張

**過程樣張已全部清空**（2026-07-28 移除 `design-sample-v2` / `palette-options` / `over-stripe-options`，前兩者在 commit `e5445fd` 可救回，第三個未 commit 已永久消失）。決策全數固化進 `DESIGN.md`。

現存唯一樣張＝**`mockup.html`**：今日頁常態＋破表兩屏，實作以它為準。已是完整 HTML 文件（含 `lang`、landmark、`button`、`ul`），可直接照抄語意結構。畫框 745px＝真機可視高度。

### 真正的下次續點（2026-07-28 收工時）

第一版功能齊了，但**沒在真機跑過**，也**沒跑過設計流程 ➍ 精修**。建議順序：

1. 跑 ➍ 精修（`emil-design-eng`／`impeccable` polish／`hallmark` audit）審新的 sheet 與三張表單
   ——這是全新的互動介面，從樣張直接落地，沒經過任何 polish 審視
2. 真機（iPhone Safari）走一遍完整流程：floating label 的 AutoFill、左滑手感、
   `100dvh` 在有網址列時的表現
3. `review-findings.md` 剩 5 條未處理
4. 第二版才做的：編輯（非刪重記）、趨勢分析、「常吃一鍵」「複製前一天」
