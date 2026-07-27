# Tally — session state

最後更新：2026-07-27

## 已驗證事實

- **Supabase 專案已建**：`https://bpnucfejoiazmsnsuzdb.supabase.co`，anon key 為 `sb_publishable_` 新格式。
- **四張表 + RLS 已上線**（`schema.sql`）。實測隔離生效：未登入讀 foods/intake/weight/profile 回 `[]` HTTP 200，寫入被 `42501 violates row-level security policy` 擋下。
- **Notion 遷移已完成**（`seed.sql`）：foods 23、intake 29、weight 47、profile 1。verifier 已對 Notion 原始資料逐欄核對六條驗收條件全過。**Notion 尚未刪除**，等 app 能實際使用後才退場。
- **公式鏈已反推確認**：Mifflin-St Jeor → ×活動係數 1.375 → 減重 ×0.8。使用者提供的熱量調整值公式為 `減重 → TDEE × -0.2`／`增肌 → +500`／`維持 → 0`。三大營養素比例 27/27/46。以最新體重 75.95kg 計算，目標為 1860 kcal / P126 / F56 / C214。
- **體重存體脂計原始讀數，不做校正**。校正（−1.85kg／−2.5pp）為固定偏移，不改變趨勢斜率，對目標熱量僅影響約 20 kcal。
- **repo 已轉 public**（`gh repo view` 確認 PUBLIC）。前端只有 anon key，隱私靠 Auth + RLS。
- **Google OAuth 已設定**：GCP client 已建、Supabase provider 已啟用、Redirect URLs 已加 `http://localhost:5500/**` 與 `https://zard0033.github.io/tally/**`。
- **設計流程 ⓪→➊→➋ 已走完**，`DESIGN.md` 已產出。定案骨架與色系見該檔。
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

### 設計過程檔案（現存，決策已固化進 DESIGN.md）

過程樣張已清過一輪（`mockup-today` / `concept-today` / `concept-layout` / `design-sample` v1 已刪，見 commit `e850506`）。剩：

| 檔案 | 狀態 |
| --- | --- |
| `design-sample-v2.html` | ➊ v2 — 階層／狀態色／共用額度定案，破表狀態參考 |
| `palette-options.html` | 配色定案，**E 欄（Gambit cream+jade）勝出** |
