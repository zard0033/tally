# Tally — 專案規格 (spec)

> 個人生活儀表板 web app。手機為主。第一階段「營養追蹤」，第二階段納入「財務」。
> 這份文件是需求訪談的產出，供開發階段接續。

## 這是什麼

取代原本在 Notion 內做每日營養加總的做法（Notion 公式欄不能 view 加總、跨列運算要 relation、自動化不穩等結構性限制，撞遍了）。改成自己的 web app：計算與呈現在前端，資料存 Supabase。

## 為什麼自己做（不用 MyFitnessPal）

- 使用者**已有天天記錄習慣**（Notion 飲食紀錄實證），不需要先驗證。
- 要 **AI 助理（Neve）深度參與**：每週能量對帳、反推真實 TDEE、估食物營養、營養師客製建議 — 現成 app 給不了（資料進不去）。
- 要**資料自己掌控**（Supabase，Neve 能讀）。
- MFP 唯一優勢是省開發，但換不到上述兩件；需求剛好卡在現成 app 的死角。

## 架構

- **前端**：GitHub Pages（Actions build 部署），Vite + React + TypeScript + Tailwind + shadcn/ui + vaul + supabase-js。手機優先 RWD。UI 要有質感（走設計流程、先 demo 再實作，不端平庸貨）。視覺一律以 `DESIGN.md` 為準。（2026-07-29 改版：原「純 HTML/CSS/JS 無框架無 build」是開案時未經論證的預設值，檢討與研究脈絡見 session-state/active.md「技術棧轉向」節。）
- **後端**：Supabase 免費版 — Auth（登入）＋ Edge Function（保管 secret、代理需 service key 的操作）。
- **資料庫**：Supabase Postgres（唯一來源）。
- **計算**：全在前端 JS（繞開 Notion 公式限制）；目標動態（依最新體重／TDEE）。
- **登入**：Supabase Auth ＋ Google OAuth，session 存 localStorage，平常不重登。（訪談時原訂 email magic link，實作改用 Google——省掉每次收信的往返。）

## 安全（不可妥協）

- `service_role` key 只待後端（Edge Function 環境變數）＋使用者本機，**永不進前端、永不進 repo**。
- 前端只用 `anon` key ＋ RLS（Row Level Security）。
- Neve 分析：平常用**唯讀 key**；**key 絕不進 repo**（放本機 env 或需要時臨時提供）。
- **repo 為 public**（2026-07-27 轉），GitHub Pages 網站當然也公開。隱私全靠 Auth ＋ RLS：前端只有 publishable key，未登入讀任何一張表都回 `[]`（已實測）。

## 資料模型（Supabase，初版四表；細節開發時定）

- `foods`（食品庫）：品名、熱量、蛋白、脂、碳（per 份）、店家(選填)、分類(選填)
- `intake`（飲食紀錄）：日期、餐別(早/午/晚/點心)、food_id、份量(可小數)
- `weight`（體重）：日期、體重、(體脂/圍度選填)
- `profile`（身體參數）：年齡、身高、活動水平、目標(增肌/維持/減重) — 目標計算輸入

## 目標計算

- 前端算：BMR → TDEE(活動係數) → 目標熱量 → 三大營養素。
- **公式鏈要從使用者 Notion 身體指標取得**（Neve 讀不到 formulaCode，需使用者手動提供公式）。
- 已知參數：活動係數 1.375、比例 27/27/46。訪談時抄下的 Notion 快照是 1868 kcal／蛋白 126／脂 56／碳 215；app 以最新體重 75.95kg 實算為 **1860／126／56／214**，差異來自快照當時體重較重。

## Notion 遷移（一次性）

- Notion 健康域**完全退場**。
- 遷移：食品庫 ＋ 身體參數 ＋ 體重歷史 ＋ 飲食歷史 → Supabase。
- 遷完移除 Notion 對應頁面。
- 由 Neve 執行（Neve 有 Notion MCP 能讀，寫入 Supabase）。

## 記錄流程（核心）

加餐 → 選餐別 → 選食物(撈 Supabase 食品庫，可搜尋) → 沒有就**新增食物**(營養必填、店家分類選填，寫回食品庫，之後即可選) → 填份量(可小數) → 存。
即時：前端算今日已吃／目標／還能吃，橫向量尺＋三大營養素條呈現。
（原訂「環圈」已在 `DESIGN.md` 禁止事項第一條否決——環圈的隱喻是「填滿＝達成」，吃東西相反。）

## 從 MyFitnessPal 借鏡

**要偷**：餐別分類、⭐「常吃/最近吃」一鍵記錄(省時關鍵)、食物搜尋、⭐複製前一天/複製一餐(對應使用者原 Excel duplicate 習慣)、三大＋熱量每日進度、體重趨勢圖(第二版)。
**不做**：掃條碼(店家品項無條碼)、食譜(使用者是 per-item 記法非食材料理)、體態照片、運動、喝水、群眾食物庫。

## 拍照讀營養標示（2026-08-13 追加，開案 spec 外的新需求）

**動機**：食品庫已蓋住重複品項，這功能的獨特價值只在「第一次吃的新品項」那一次——省下手打七個欄位。使用者接受這個範圍，並認為搭建過程本身有價值。

**選定**：`qwen/qwen3.7-flash`，走使用者既有的 OpenRouter 帳號（另開的獨立 key）。$0.030／$0.130 per MTok ≒ **NT$0.07／月**（以 30 次計）。三輪實測依據見 session-state/active.md。

### AC（＝將來的測試）

1. 新增食物 sheet 上有一顆相機鈕，`accept="image/*" capture="environment"`；它在 `<form>` 內必須標 `type="button"`（沒標的 button 預設是 submit，見 DESIGN.md「多欄輸入一律包 `<form>`」）。
2. 選圖後前端壓縮：長邊 ≤1200px、JPEG q0.75，送出 payload <400KB。單元測試餵一張 4000px 的圖，斷言輸出長邊與位元組數。
3. Edge Function **無有效 JWT 一律回 401 且不呼叫 OpenRouter**（用 `SUPABASE_JWKS` 驗，該環境變數 Edge Function 預設就有）。亂寫 token 與過期 token 各一條測試。
4. 函式成功回 `{basis, serving_g, kcal, protein_g, fat_g, carb_g}` 固定形狀；失敗回 `{error}`，**不洩漏 OpenRouter 的錯誤原文或 key**。
5. 結果填進表單欄位，**品名附加括號標籤**：`per_serving` 無公克數→`（每份）`／有公克數→`（每份 123g）`／`per_100g`→`（每100克）`。
6. **結果一律是草稿，表單不自動送出**；辨識失敗時表單維持可手打，不出現阻斷式提示。斷言辨識後 `foods` 無新列、且 stub 回 500 時仍能手動完成新增。
7. 既有 e2e／vitest 全綠、`npm run lint` 0 error。

### 明確不做（Musk 視角砍除，別在下一輪長回來）

- **4/9/4 反算驗證**：選定模型三輪零錯，沒有證據需要它；且標示熱量與 4/9/4 本來就對不上（DESIGN.md 已記），這個檢查會**誤報**，而誤報的警示等於沒有警示。真正的防線是「使用者按新增前一定看得到數字」——那道免費且已經存在。**真實拍攝若測出錯誤再加回來**（這是刻意留的加回候選）。
- **`servings_per_pack`**：使用者明講份量自己換算。
- **重試／fallback 模型／降級流程**：失敗的路已經存在且免費——手打。
- **存圖／辨識歷史／log**：沒有人提出需求。
- 掃條碼與純前端 OCR：見「不做」節與 session-state 的否決紀錄。

### 未量的接縫（實作要量，不是假設）

- **1200px 是猜的**：壓縮強度 vs 辨識率沒驗過。**實作第一步就是拿真實手機照片（反光／彎曲／傾斜）測這條**。
- 品名加括號會改變 DESIGN.md 的同名判斷（決定要不要補店家第二行）——**接受**：不同份量本來就該視為不同品項。

**成本**：辨識 NT$0.07／月；Edge Function 免費額度 500k／月（用 30 次＝0.006%）；egress 只有一包小 JSON。實質為零。**唯一的成本風險是 OpenRouter key 還沒設花費上限**——列為實作第 0 步。

## 分階段

**第一版（能天天用的最小集，2026-07-28 已全數出貨）**：登入 ／ Notion 資料遷移 ／ 加餐(選餐別/食物/份量/新增食物) ／ 前端算＋橫向量尺看今日還能吃 ／ 刪除當天某筆。
設計階段追加進第一版（`DESIGN.md` v1.7 拍板，本節原列在第二版）：**日期切換**（補記過去的日子）／**app 內記體重**／**設定頁編輯身體參數**／**該餐別常吃排序**（記錄流程的省時關鍵，成本低所以提前）。
**第二版**：編輯(非刪重記) ／ 趨勢分析 ／「複製前一天」／ 刪除的復原 ／ 食品庫本地快取。

## Neve 的持續角色

- 每週能量對帳（體重斜率 vs 攝取、反推真實 TDEE、蛋白達成率）。
- 估新食物營養、必要時補食品庫。
- 體重階段變化時更新目標。
- 透過 Supabase key（唯讀為主）讀資料。

## 財務模組（第二階段，擱置）

- 動工前**單獨做一輪需求訪談**（現有本機 dashboard 不好用＝需求未釐清，別直接搬）。
- 已知：手機看本月現金流（取代 Excel 手拉＋每月 duplicate sheet）。
- 財務資料上雲（Supabase），使用者已接受。

## Kickoff 待辦

- [ ] 使用者：建 Supabase 免費專案，提供 URL ＋ keys（anon 給前端、service 給 Edge Function、唯讀給 Neve）
- [ ] 使用者：提供身體指標的公式鏈（BMR／TDEE／目標，Neve 讀不到 formulaCode）
- [ ] Neve：出實作計畫（schema DDL、Edge Function、前端骨架、Notion→Supabase 遷移腳本）
- [x] 環境：repo 已建 github.com/zard0033/tally（clone 於 d:/Personal/tally）
