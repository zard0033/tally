# Notepad
<!-- Auto-managed by OMC. Manual edits preserved in MANUAL section. -->

## Priority Context
<!-- ALWAYS loaded. Keep under 500 chars. Critical discoveries only. -->
現況（2026-10-28）：v2.101 與 e2e 提速（`e2e:affected`／`e2e:smoke`）已 push；v2.102（日期元件點已選收合、加要點同款色塊、確認框輕遮罩）與 v2.103＋v2.104（左滑紅鈕置中、動作庫封存先問、編輯 sheet 加縮圖；RPE 拿掉清除與「上次」籤、要點清空鈕、未同步 sheet 清空自動收）**已 commit 未 push**；v2.103／v2.104 只跑 `training`／`sync-sheet` 等相關檔，push 前要走全量閘門；**RPE 擴大用途計畫（階段 0–3）已核可方向、spec 待寫**：每組 RPE 選填、組號格右上角標籤（樣張選 A 只有數字）、重量建議有填更準沒填退回次數規則、沒做過只給指引、有效組門檻 RPE ≥8；已用 CLI 還原使用者誤封存的「上斜胸推機」；要點條就地編輯時底部列不浮在鍵盤上（已裁決）、要點欄不被鍵盤蓋住（真機測過）；e2e 379 全過（v2.101 時）、vitest 803。有氧併入動作已完成（3 筆舊資料遷成 3 次訓練、舊表已 drop，線上查證過）。餐建議 spec（spec.md「C. 餐建議」）＋樣張 `_design-sample/meal-suggest.html`（第三版）**等核可才動碼**。**真機未驗**：v2.102、v2.91–v2.93、RPE、重量建議（v2.101 垃圾桶、右內距、(+N) 已驗 OK）。
下一步：①真機驗 v2.102 ②核可餐建議樣張 ③每日應攝取熱量計算與每日目標 UX（新對話；先讀 MANUAL）。待確認：1.25 kg 槓片、啞鈴一格 2 或 2.5。

## Working Memory
<!-- Session notes. Auto-pruned after 7 days. -->

## MANUAL
<!-- User content. Never auto-pruned. -->
### 2026-10-27 整理版（取代之前依日期堆的各節；舊版在 git 歷史，`git log -- .omc/notepad.md` 可還原）

**使用者已裁決（別再提案）**
- `.env.local` 的 `sb_secret` 保留（非唯讀，只跑 SELECT、寫入先列清單確認）；拍照辨識那把 key 曾出現在對話紀錄，不撤換。
- 拍太遠會讀成差一倍的數字（82 讀成 140）：不處理。
- 實測維持熱量的體重門檻維持 4（別提 6）；不改目標、公式、資料表；運動加成另案，等訓練記錄累積 3–4 週。
- 不做：每日提醒、記錄 vs 身體對照畫面。
- 離線：不承諾「變快」；SW 不快取 Supabase API 回應；登出清本機快照；舊版離線殘留的佇列條目不加相容層。
- 減少動態以 spec AC 10 為準（位移、縮放、循環關掉或 ≤120ms 淡入；純顏色過渡不受影響）。
- 動作瘦身清單（33 個）先不刪，目錄維持 150 個；要做時先列清單確認。
- 移除動作的 ✕ 一律先跳確認框（沒打勾也問），所以沒做 undo。

**待使用者決定**
- 離線冷啟動約 7.5 秒（postgrest-js 重試 1＋2＋4；真機回報約 3 秒）：縮短＝一次失敗就亮提示，慢網路會閃錯誤。設定頁要不要放「重置離線快取」（建議不加）。
- 150 個預設動作新增的 134 個繁中名稱待確認（清單在 DESIGN v2.71）。
- Gym visual：回覆信沒存，沒確認 public repo 內放圖檔是否涵蓋；列表底部標示是我對條款的解讀，沒向對方確認。
- 健走摘要折行（「坡度」與「8%」被拆開）要不要黏住。
- 排序收合動畫（touch 起手有 250ms 按住可做）：等真機看過再決定。

**真機待驗**
- 拍照辨識 v2.46（iOS 切欄位鍵盤上下箭頭會中斷）：仍會斷先分辨 (a) 箭頭按了焦點沒動＝accessory bar 分組問題，嫌疑是 v2.34 關掉的 vaul hack（app.css `.sheet`）(b) 焦點移了但看不到＝空間／捲動，下一格可收「鍵盤升起時收起 AI 辨識鈕」。全文 DESIGN v2.46。
- B2 訓練中改版清單（DESIGN v2.69）、v2.91–v2.93、RPE、重量建議、有氧卡與有氧 sheet、縮圖放大檢視器疊在加動作 sheet 上的手感。
- 同步細條 `role=status` 會不會讓 VoiceOver 每記一筆都播報「1 筆尚未同步」（Training.tsx:232）；吵就只在有失敗條目時進 live region。

**待辦（順序）**
1. 記一筆確認列加「+這次」（蛋白 112/137 +28）：不出樣張，直接做、截 393 寬看，擠就換版型。
2. 餐建議：先 A（上一個同類日的同一餐）後 B（補缺口）。補缺口依目標切優先序，證據與四項決定都在 spec.md「C. 餐建議」；增肌熱量 ≤10%、每餐蛋白質 0.25／0.4 g/kg 是設計決定、無證據。**開工 B 前讀 2026-10-13 ISSN「減重飲食」立場聲明全文核對**（DOI 10.1080/15502783.2026.2740266）。
3. 每日應攝取熱量計算調整＋設定頁「每日目標」UX（使用者說有點卡，具體哪裡卡還沒問），可跟餐建議依目標變動一起想。新對話先讀 spec.md「每日目標計算引擎」「實測維持熱量」。
4. 「用歷史推估該吃多少」journey（使用者差異化；實測維持熱量卡是它的一半）：升格前先回測（切一段當未知、預測體重變化）；前提是記錄完整度，見 5。
5. 估算一個品項（描述或拍照，擴充 `read-label`）：spec.md 同名節，等點頭；第 0 步先用 5–10 餐實測準確度。
6. 「加進來」動作的 feedback 動效（新增訓練、記錄飲食）；PWA 圖示重做。兩者樣式都未定。
7. e2e 提速餘項：全量搬 GitHub Actions 切 4 份平行（push 閘門會變成 push 後部署前，先小規模試穩）；量 openApp 各段耗時。
8. 全站精緻度 B3（設定、每日目標、身體數據、食品庫；`.scan-btn` 與食物庫篩選膠囊還是舊外框）、B4（載入／離線／錯誤狀態、登入頁）：要使用者各自核可。盤點在 `.omc/plans/polish-audit-findings.md`（本機、不進 git）。
9. 背景縮小約 95.5%（modal sheet 開著時）：結論「不需要解法」（DESIGN v2.61），縮放沒實作。

**已知問題（未修）**
- 動作庫封存點下去沒有回饋，列位移後第二下可能點到補上來的下一列（可逆但靜默）。處理方向：`.tr-status` 顯示「已封存 X」或沿用 `.undo-bar`。
- `.tr-check:active`／`.tr-all:active` 與 `[data-pressed]` 並存：左滑超過 10px 後勾還縮著。修法：`:active` 只留給鍵盤（`:focus-visible:active`）。
- 佇列格式認不得時每次操作都丟錯、沒有出路（要不要做「原樣備份、清空重來」的逃生口）。
- 寫入失敗訊息可能重複前綴「這筆沒有存下來：這筆沒有存下來：…」；sheet 關閉後焦點落到 body。
- 新版 SW 偶發卡在 activating：與 precache 項數有關（460 項會卡，311／159 項穩），根因未查；該 spec 不能用 `--repeat-each`。
- e2e 偶發紅（原因與做法看 CLAUDE.md e2e 段）：`tally.spec` 的 `.undo-bar` 一族、`settings-nav`、`spring-sheet`、`food-library` 焦點、`recovery-foreground`。
- 主 repo `npm audit` 有 1 critical／13 high（與功能無關）。
- 其餘 v2.91–v2.93 review 的 LOW 條目在 git 歷史，真機驗完再看。

**工具備忘**
- `notepad_write_priority`／`notepad_write_manual` 2026-10-20 兩次回報成功但檔案沒變；改用 Edit／Write 直接改 `.omc/notepad.md`，改完回讀。
- 開暫存 worktree 收的時候：先 `cmd /c rmdir` 拆掉 node_modules junction，再 `git worktree remove`，別遞迴刪。
