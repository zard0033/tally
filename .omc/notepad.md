# Notepad
<!-- Auto-managed by OMC. Manual edits preserved in MANUAL section. -->

## Priority Context
<!-- ALWAYS loaded. Keep under 500 chars. Critical discoveries only. -->
現況（2026-10-19）：v2.74 點動作縮圖放大已 push（79b056d）；vitest 652、e2e 249 全過、lint／build 過；真機未驗 v2.72–v2.74。放大圖只有起始姿勢進 precache（311 項）；全進（460 項）SW 會卡 activating，見 MANUAL 2026-10-19。
下一步：手機驗 v2.72–v2.74（尤其更新後 SW 有沒有卡住）；體重趨勢圖（含體脂，spec 已核可未開工）。scratchpad 的 base／ctl worktree 待清（刪前列清單）。

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
訓練中改版與全站精緻度的未結項（2026-10-20 清掉已出貨的：B2 與動效已 push；自動補預設動作 v2.72；統計格數字翻動 v2.73）
- 訓練中改版（B2）的真機待驗清單在 DESIGN.md v2.69；spec 在 spec.md「訓練中畫面改版」。
- **待使用者決定**：①150 個預設動作裡新增的 134 個繁中名稱待確認（清單在 DESIGN v2.71）②沒有圖的動作現在用肌群單字，要不要換成肌肉解剖圖（需素材與授權）。圖源 free-exercise-db 是 Unlicense，但照片上游來源不明，見 DESIGN v2.71。
- 「有氧併入動作」（肌群＝其他，不再是獨立入口）推翻 2026-10-13 的有氧獨立模型（cardio_sessions 表＋開始訓練 sheet 進入）；牽涉 schema，另案先 spec＋plan，未開工。
- 全站精緻度：B3（設定、每日目標、身體數據、食品庫、體重趨勢含 prototype 殘留清除；`.scan-btn` 與食物庫篩選膠囊還是舊外框）、B4（載入／離線／錯誤狀態、登入頁）要使用者各自核可。盤點發現與根因在 `.omc/plans/polish-audit-findings.md`（本機、不進 git，spec.md「全站基礎」節有指路）；Gymwork 對照截圖使用者未提供，提案沒對照 Gymwork 校準。
- 背景縮小約 95.5%（modal sheet 開著時）：0 號實驗結論「不需要解法」（DESIGN v2.61），但**縮放本身沒實作**；要做時只在掛在 body 的 SpringSheet 開著時啟用、原點 `50% 0`，真機驗 iOS 工具列收合與動畫掉幀。
### 2026-10-19 17:30
v2.73 push 前 review 後的待決與已知狀況（全文在 DESIGN.md v2.73「已知限制」）
- **減少動態下 `.tr-check`／`.tr-val` 的顏色過渡要不要降到 0.01ms**：DESIGN「互動與動效」寫「全部降到 0.01ms」、spec AC 10 寫「位移與縮放改 ≤120ms 淡入淡出」，兩份文件互相不一致，需要裁決以哪份為準；收進 app.css 的 reduced-motion 清單會連帶動到「減少動態不錯開」那條 e2e（它讀 background-color 過渡的 delay）。`.tr-check` 是舊缺口，`.tr-val` 是本輪新加的 160ms 顏色過渡。
- **`tally.spec.ts` 偶發紅（今日頁 `.undo-bar` 一族）**：基線 `ddb5292` 也會紅（單跑 10 次紅 2 次），使用者裁決先當已知偶發、不擋 push；原因未查。單跑重複的過濾字串用 `tally.spec`，寫 `tally` 會把整套跑進去。
- **SW「新版 SW 裝好就接手」**：2026-10-19 查到與 precache 項數有關（全進 460 項單跑只過 3/6、基線與 311 項都穩），v2.74 已改成放大圖只預快取起始姿勢，詳見下方 v2.74 一節與 wiki `lesson-sw-precache-size`；根因仍未查。該 spec 不能用 `--repeat-each`。
- **排序收合動畫**：2026-10-19 評估過，touch 起手有 250ms 按住可以做，但建議等真機看過再決定（沒有裁決）。
- 本機 scratchpad 有基線 worktree `…\scratchpad\ctl`（指到 `ddb5292`、node_modules 是 junction）用完要清；**刪除前先列清單給使用者確認**。另一個 `…\6f6a523b-…\scratchpad\base`（指到 `352c306`，2026-10-19 SW 對照用）同樣待清。
### 2026-10-19 21:00
v2.74 點動作縮圖放大（使用者提出，spec.md 沒寫；DESIGN v2.74 有全文）
- [追加 2026-10-19] 點縮圖開放大檢視（起始＋收尾兩姿勢）；動作庫／加動作／訓練中卡片／課表編輯四處可點。放大圖 640 寬 299 張（`src/assets/exercises-large`，腳本 `build-exercise-images.mjs` 重產）。
- **離線取捨（使用者 2026-10-19 裁決方案 1）**：只有起始姿勢進 precache（311 項／4.5MB），收尾姿勢離線看不到、檢視器自動藏起來。原因：放大圖全進 precache（460 項）時新版 SW 偶發卡在 activating。要把收尾姿勢也做成離線可看，得先查清 SW 卡住的根因。
- **待辦**：①真機驗檢視器疊在加動作 sheet 上的手感與下滑關閉（巢狀 dialog 沒有自己的暗色背景層，已知）。②體重趨勢圖（含體脂）spec 已核可、未開工：折線＋7 天平均、30／90／全部、體脂另畫一張共用 X 軸與十字線、明細表。
