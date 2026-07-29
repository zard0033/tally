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
