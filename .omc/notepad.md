# Notepad
<!-- Auto-managed by OMC. Manual edits preserved in MANUAL section. -->

## Priority Context
<!-- ALWAYS loaded. Keep under 500 chars. Critical discoveries only. -->
現況（2026-10-17）：B2＋動效補完＋動作示意圖（150 個預設動作，各一張 webp）本機做完，**尚未 push／尚有未 commit 改動**；使用者今天下午要去健身房用。vitest 643、e2e 237（236 過、1 紅＝既有「慢態有出口」）、三位審查已處理。細節與真機待驗清單在 DESIGN.md v2.69–v2.71。
下一步：commit → push 閘門（已 review、測試已跑）→「準備 push」確認 → 真機：App 全關重開兩次讓新 SW 接手，動作庫頁首按「補齊預設動作」。待決：既有帳號是否自動補（現為按鈕版）、中文名待確認清單（DESIGN v2.71）、照片上游來源不明。

## Working Memory
<!-- Session notes. Auto-pruned after 7 days. -->

## MANUAL
<!-- User content. Never auto-pruned. -->
### 2026-10-14 06:26
待決問題（2026-10-14 自 active.md 搬入）

- **拍照辨識**（需求／AC／選型／已否決路徑全文在 [spec.md](spec.md)）：進度見續點 2。
- **體重趨勢完整圖表仍是佔位卡**：要過 `dataviz` 定案，樣張在 `_design-sample/food-library.html` A3 frame；e2e 刻意只驗進出不鎖內容。
  資料門檻已過（2026-10-12 同步上線、Tally 94 列），可開工。**零碎（不擋上線）**：Notion 退場收尾未完成。
- [想法 2026-10-14] **肌肉恢復度**（類似 Gymwork）：依各肌群最近的訓練量看恢復程度，用來安排下一個訓練日的日程與項目。資料來源是階段 2 的 `workout_sets`＋`exercises.muscle_group`（七類），算法與呈現尚未定；屬階段 4（分析）。
### 2026-10-14 06:26
下次續點（2026-10-14 自 active.md 搬入；編號沿用，1 已併入 4）

0. **體重自動同步：已完成**。`.env.local` 的 `sb_secret` **使用者裁決保留**（非唯讀，只跑 SELECT、寫入先列清單確認，別再提議刪）。**已決不做**：每日提醒、記錄 vs 身體對照畫面。

2. **拍照辨識：v2.42–v2.44 均已上線**（函式 version 7）。加速三條路全數實測否決、思考維持開啟，全文與數據在 DESIGN.md v2.43。
   **「iOS 上下箭頭已結案」那句下早了**——2026-09-08 使用者回報仍會中斷。**剩下的**：
   ① 型別檢查已由 `tsconfig.functions.json` 涵蓋 ② **拍太遠會得到看起來合理、實際差一倍的數字**（82 讀成 140）、app 察覺不到——
   **使用者 2026-09-08 裁決不處理，別再提案** ③ **v2.46 已修掉兩半，等真機驗證**（全文與數據在 DESIGN.md v2.46）：切欄位時鍵盤高度沒變
   ⇒ `visualViewport` 只發 `scroll` 不發 `resize`，而 iOS 靠捲 layout viewport 露出欄位、正是 `--vvtop` 在補償的 ⇒ **iOS 的幫忙被我們
   依設計抵銷**。補了 FoodFormFields 的 listener（含 `scroll`）；sheet 頂部 96px 空隙在鍵盤升起時收回。
   **真機若仍會斷，先分辨**：（a）箭頭按了焦點沒移動 ⇒ accessory bar 分組問題，嫌疑是 v2.34 一併關掉的 vaul hack（app.css `.sheet`）；
   （b）焦點移了但看不到 ⇒ 空間／捲動，下一格可收「鍵盤升起時收起 AI 辨識鈕」（60px，會讓內容跳動，先看值不值得）。
   探針 `scan-probe.local.mjs` 在 repo 根（`*.local.mjs` 已 gitignore）；`.env.local` 放 key，**那把 key 曾出現在對話紀錄裡，使用者裁決不撤換——別再提案。**

4. **訓練記錄＋離線（取代 Gymwork）**：階段 0、1 甲、2 已上線（v2.53–v2.59：訓練分頁、動作庫、課表、有氧、離線佇列與同步 sheet）。計畫、研究、探針與各階段 spec／AC 全在 spec.md「訓練記錄與離線」「階段 1 甲 spec」「階段 2 spec」（2026-10-12 使用者裁決自建，主因健身房網路差）。階段 2 出口＝與 Gymwork 並行 1–2 週後仍夠用才停用 Gymwork。階段 3（週期排程、組間計時器）、階段 4（分析、運動×飲食並排）未動。
   **原決定仍有效**：不承諾「變快」；SW **不快取** Supabase API 回應；登出時清掉本機快照。
   **甲的未結項**：①有效 token 離線冷啟動約 7.5 秒（postgrest-js GET 重試 1＋2＋4；真機回報約 3 秒，原因未查）——縮短＝一次失敗就亮提示、背景繼續重試，慢網路會閃錯誤，**待使用者裁決** ②Q3 設定頁要不要放「重置離線快取」入口（建議不加）③2 秒門檻在慢網路會閃含「專案被閒置暫停」的提示（DESIGN v2.51 取捨）④救援演練手機端（選做；headless 已測）⑤主 repo `npm audit` 有 1 critical／13 high（與本案無關）。

5. **實測維持熱量（spec.md 同名節；流程 A；v2.49 卡片＋v2.50 回溯，兩輪 review 都處理；體重門檻**使用者裁決維持 4**，別再提 6）**：
   每日目標頁最下方的唯讀卡片對帳公式上限（2026-10-12：TDEE 1956、實測約 1760–1800，目標 1637 只有 ≈0.13 kg/週赤字），**不改目標、公式、資料表**；
   **真資料實跑：回溯顯示 7/22–9/8 那一串（約 1738，範圍 1683–1793）並標明日期**，近 28 天仍缺記錄。**運動加成另案**，等訓練記錄（續點 4）累積 3–4 週。

6. **估算一個品項＋複製前一餐（spec.md 同名節已寫、★等點頭才動碼）**：痛點＝沒標示的餐要離開 App 問 AI、於是整餐不記。A 估算（描述或拍照，擴充 `read-label` 雙模式，結果必落一列 foods 並立即封存）先、B 複製後；**第 0 步先用 5–10 餐實際吃過的餐量準確度**，再決定值不值得做。
7. **「用歷史推估該吃多少」的 user journey（使用者 2026-10-13 提出的差異化，別漏）**：多數 App 靠自訂運動係數推測；Tally 要用過往實際吃的熱量＋體重趨勢反推（類似股票回測）。**實測維持熱量卡（續點 5）已是它的一半**，缺的是從對帳卡片升格為「目標的依據」的流程與 UX；前提＝記錄完整度（續點 6 的估算一個品項）；升格前要做回測（切一段當未知、預測體重變化）。**順序：階段 2 先（產生資料）→ 累積 3–4 週 → 專門設計這條 journey**，使用者同意。
### 2026-10-14 08:27
佇列 review 後待決（review #1–#9 與 D 段追加項已修並出貨；以下兩條未查是否已處理）
- 佇列格式認不得時每次操作都丟錯、沒有出路——要不要做「原樣備份到另一個 key、清空重來」的逃生口（產品決定）。
- queueStore 的 isEntry 沒交叉檢查 op 與 payload（insert 帶 null payload 會只 upsert {id}），低風險。
- 視覺待辦：sheet 內確認框偏低，上緣露出被壓暗的儲存鈕。
### 2026-10-14 10:08
A 段（有氧）push 前 review 沒修的 LOW（2026-10-14，之後再說；2026-10-17 B2 後 sheet 全是 SpringSheet，含「vaul」字樣的項未重新驗證是否仍成立）
- input 的 aria-label 蓋掉 label 裡的「選填」，讀屏念不到（拿掉 aria-label 要連 e2e 的 getByRole name 一起改）；錯誤沒有 aria-invalid／aria-describedby 綁到欄位。
- sheet 關閉後焦點落到 body（從開始訓練 sheet 串過來、或刪掉了觸發那一列），可能所有串接的 vaul sheet 都有；修法是 onCloseAutoFocus 指到主 CTA 或清單。
- 320px 寬時走路三欄的「速度 km/h 選填」約 92px 放不下 85px 欄（目標機 393 沒事）。
- cardioTarget 是開 sheet 當下的快照：編輯中同步改了那一列，diff 以舊的為準（逐欄後寫贏）。
- 「1,210」千分位、逗號小數、「。」不接受（只會擋下說明，不會存錯）。
- ExerciseEditSheet 有同一個「成功後 busy 放回去」的寫法，連按兩次會送兩次 update（update 是冪等的，新增動作才會多一筆）。
### 2026-10-15 15:40
D 段 push 前 review（opus code-reviewer，0 blocking）留下的 non-blocking，不修的理由＝不動剛驗完的程式、等真機一起看（2026-10-15；2026-10-17 B2 後 SyncSheet 已是 SpringSheet，焦點與下滑兩條 vaul 相關項未重新驗證）
- **[MEDIUM] 外層固定 role=status 後，線上每記一筆「1 筆尚未同步」閃現可能被讀屏播報**（Training.tsx:232）。真機開 VoiceOver 驗吵不吵；吵就只在 source≠server 或有失敗條目時讓內容進 live region，或細條延遲約 1 秒才顯示。
- [LOW] sheet 開著時佇列清空（立即重試成功），觸發的細條按鈕被卸載，sheet 關閉後焦點落到 body。修法：SyncSheet 的 Drawer.Content 加 onCloseAutoFocus，觸發鈕不在時改放 `.tr-status-wrap`（tabIndex=-1）。
- [LOW] busy 期間下滑放手，vaul 只 setIsOpen(false) 不重設 transform，sheet 卡在半拖位置（busy 只有本機 IndexedDB 數毫秒）。照 LogSheet／FoodLibrary 補 `dismissible={!busy}`。
- [LOW] 確認框「另有 N 筆」開框當下算一次；背景 sync 讓被拒絕的 insert 變 5xx（maybeApplied）後，放棄實際不帶走子孫，與框上寫的不符（保守方向，不丟資料）。可在 confirmDiscard 前重算，或 failure 變了就收框。
- [LOW] useTraining.discard 成功後刷新 view 失敗，會顯示成「沒辦法放棄這筆」但其實已放棄；把刷新分開 try、失敗只 setError 不 rethrow。
- 可簡化：SyncSheet labelOf 的 O(n²) filter、trainingRuntime.ts:356 多餘的 sort、SyncSheet:172 與 :128 重複的標籤取得。
### 2026-10-15 17:30
訓練中改版與全站精緻度現況（2026-10-17 B2 完成後改寫）
- **B2 本機完成、未 commit／未 push**（使用者要最後統一真機驗）：訓練中改版（組編輯 sheet、左滑刪除、卡片頭／ⓘ／⋯、全部完成、新增一組整列、訓練中排序）＋訓練六張 sheet 換 SpringSheet、vaul 依賴移除。細節、與 spec 的差異、真機待驗清單全在 DESIGN.md v2.69；spec 在 spec.md「訓練中畫面改版」。
- **動效**：v2.70 補上新增／刪除一組的淡入淡出與 ± 數字翻動；**還沒做**：統計格數字變動翻一下（160ms）；排序時收合與恢復是瞬間的（dnd-kit 限制，見 v2.69）。真機看了覺得缺再補。
- **[追加 2026-10-17] 動作示意圖＋動作庫填滿（autopilot 無人值守做完，未 commit）**：150 個預設動作（原 16＋新 134，繁中名、七類肌群）各一張 webp（free-exercise-db，Unlicense；照片上游來源不明，見 DESIGN v2.71）；縮圖在動作庫、加動作 sheet、訓練中卡片名稱鈕左側；自建動作用肌群單字。**新帳號首次預填仍是 16 個；其餘 134 個走動作庫頁首「補齊預設動作」入口（按了才寫）**。細節、實測數字、待確認清單全在 DESIGN.md v2.71 與「動作示意圖與預設動作目錄」條。
- **待使用者決定（`.omc/autopilot/decisions-pending.md` 本機、不進 git，內容摘要在此）**：①既有帳號要不要「自動」補進新預設動作（現況是按鈕版；自動版一次對真實資料庫寫約 134 筆，`exercises` 無法真刪，不想要的得逐個封存；改自動只要改 `trainingRuntime.seedIfEmpty`）②134 個新動作的中文名稱待確認（清單在 DESIGN v2.71）③沒有圖的動作要不要換成肌肉解剖圖（需素材與授權）。
- 第 1 點「有氧併入動作」（肌群＝其他，不再是獨立入口）推翻 2026-10-13 的有氧獨立模型（cardio_sessions 表＋開始訓練 sheet 進入）；牽涉 schema，另案先 spec＋plan。
- 全站精緻度：B3（設定、每日目標、身體數據、食品庫、體重趨勢含 prototype 殘留清除；`.scan-btn` 與食物庫篩選膠囊還是舊外框）、B4（載入／離線／錯誤狀態、登入頁）要使用者各自核可。盤點發現與根因在 `.omc/plans/polish-audit-findings.md`（本機、不進 git，spec.md「全站基礎」節有指路）；Gymwork 對照截圖使用者未提供，提案沒對照 Gymwork 校準。
- 背景縮小約 95.5%（modal sheet 開著時）：0 號實驗結論「不需要解法」（DESIGN v2.61），但**縮放本身沒實作**；要做時只在掛在 body 的 SpringSheet 開著時啟用、原點 `50% 0`，真機驗 iOS 工具列收合與動畫掉幀。
