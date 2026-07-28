# Tally — session state

最後更新：2026-07-28

## 已驗證事實

- **Supabase 專案已建**：`https://bpnucfejoiazmsnsuzdb.supabase.co`，anon key 為 `sb_publishable_` 新格式。
- **四張表 + RLS 已上線**（`schema.sql`）。實測隔離生效：未登入讀 foods/intake/weight/profile 回 `[]` HTTP 200，寫入被 `42501 violates row-level security policy` 擋下。
- **Notion 遷移已完成**（`seed.sql`）：foods 23、intake 29、weight 47、profile 1。verifier 已對 Notion 原始資料逐欄核對六條驗收條件全過。**Notion 尚未刪除**，等 app 能實際使用後才退場。
- **公式鏈已反推確認**：Mifflin-St Jeor → ×活動係數 1.375 → 減重 ×0.8。使用者提供的熱量調整值公式為 `減重 → TDEE × -0.2`／`增肌 → +500`／`維持 → 0`。三大營養素比例 27/27/46。以最新體重 75.95kg 計算，目標為 1860 kcal / P126 / F56 / C214。
- **體重存體脂計原始讀數，不做校正**。校正（−1.85kg／−2.5pp）為固定偏移，不改變趨勢斜率，對目標熱量僅影響約 20 kcal。
- **repo 已轉 public**（`gh repo view` 確認 PUBLIC）。前端只有 anon key，隱私靠 Auth + RLS。
- **Google OAuth 已設定**：GCP client 已建、Supabase provider 已啟用、Redirect URLs 已加 `http://localhost:5500/**` 與 `https://zard0033.github.io/tally/**`。
- **設計流程 ⓪→➊→➋ 已走完**，`DESIGN.md` 已產出。定案骨架與色系見該檔。
- **破表狀態已細琢（2026-07-28，DESIGN.md v1.1）**：斜紋改「`--over-fill` 打底 + 22% 白細紋疊層」（原實色亮條在 cream 上像斑馬線）；並補掉 v1 的無障礙漏洞——3px 營養素條上斜紋會糊成純紅，改由**破表時 3px → 6px 的高度差**當主要非顏色訊號，紋理退為第二層（紋理內部對比僅 1.47:1，WCAG 公式實算，撐不起單獨辨識）。`--over-fill` 對 paper 4.50:1 過圖形 3:1 門檻。六變體樣張見 `over-stripe-options.html`，定案＝C + F。
- **首次 push 已完成**（2026-07-27）。precommit-review（deep，runId `wf_f4ffe4a0-4a0`）抓到 `seed.sql` 含真實個資且 repo public、schema/seed 不同步、`activity_factor` 精度不足三個 confirmed，已修正。**`seed.sql` 已從全部歷史用 `git filter-branch` 清除**（原本在 `0c42c19` 引入），gc 後本機 blob 亦不可達；遠端核對 `contents/seed.sql` 回 404。`seed.sql` 實體檔案留在本機、`.gitignore` 排除，是遷移唯一副本，**不要再次 `git add`**。分支已改名 `master` → `main` 對齊遠端預設分支。

## 未解失敗

尚未有。

## 下次續點

**下一步是實作，尚未開始寫任何前端 code。**

實作前必讀 `DESIGN.md`（尤其「禁止事項」與「已否決的做法」兩節）。

順序：

1. 前端骨架：登入頁（Google OAuth）→ 今日頁
2. 今日頁實作（骨架與色票已定案，照 `DESIGN.md`）
3. 「記一筆」流程 — **樣張還沒設計**，要先走 ➊ 決策樣張再實作：選餐別 → 搜尋食物 → 填份量 → 找不到則新增食物
4. 刪除當天某筆
5. 設定頁 — 樣張也還沒設計

### 待確認 / 待處理

- **Google 登入後要檢查 `auth.users` 筆數。** 目前有一個用 email/password 建的 user（`21f733f4-122f-4192-9674-f48c006a714e`），seed 的 99 筆資料掛在它名下。若 Google 用同一 email 且已 confirmed，Supabase 會連結成同一個 UID；若變成兩筆 user，需跑一行 UPDATE 把資料搬到新 UID 再刪舊的。
- **飲食紀錄有 4 筆刻意未遷移**（07-23 早餐重複 ×2、07-25 晚餐空、07-27 午餐空），使用者表示之後在新 app 自行補。
- **本機開發用 `python -m http.server 5500`**（Supabase redirect URL 白名單已對應這個 port）。playwright MCP 擋 `file://`，一定要走 http。

- **樣張已過三路獨立評審（2026-07-28）**：a11y／code、UX／產品、視覺各派一個 fresh agent，共 60 條 findings。最重的一條是**「一屏不捲」原本建在錯的高度上**——844px 是 iPhone 14 Pro 的螢幕高度，Safari 有網址列時只剩約 745px，實測破表屏在該高度溢出 84px（晚餐與點心整段消失）。已修正並改用 745px 為設計基準。已處理的進 `DESIGN.md` v1.4，**未處理的 20 條在 `session-state/review-findings.md`，實作時逐條對**。

### 設計樣張

**過程樣張已全部清空**（2026-07-28 移除 `design-sample-v2` / `palette-options` / `over-stripe-options`，前兩者在 commit `e5445fd` 可救回，第三個未 commit 已永久消失）。決策全數固化進 `DESIGN.md`。

現存唯一樣張＝**`mockup.html`**：今日頁常態＋破表兩屏，實作以它為準。已是完整 HTML 文件（含 `lang`、landmark、`button`、`ul`），可直接照抄語意結構。畫框 745px＝真機可視高度。

### 下次續點的修正

1. **實作前必讀 `session-state/review-findings.md`**（20 條未處理 findings，分 A–E 五類）
2. 第一版**不做**歷史檢視（照 `spec.md` 第二版範圍），日期箭頭已從樣張移除
3. 「記一筆」流程與設定頁的樣張仍未設計，動工前要先走決策樣張
