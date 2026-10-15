# Notepad
<!-- Auto-managed by OMC. Manual edits preserved in MANUAL section. -->

## Priority Context
<!-- ALWAYS loaded. Keep under 500 chars. Critical discoveries only. -->
現況（2026-10-15）：B 段課表已 push（origin/main=31916db）。D 段（同步指示完整版：細條可點＋未同步 sheet，DESIGN v2.59）本機 commit、未 push；review 兩輪，vitest 589／e2e 187（push 前全跑 187 綠）；「格式認不得…慢態有出口」時紅時綠（5 次全跑 4 紅 1 綠，原因未查）。
下一步：①D 段 push gate（CLAUDE.md e2e 檔案清單加 sync-sheet.spec.ts、條數照實測）②iOS 觸控握把拖曳真機驗、離線記錄真機試用 ③C 歷史、E 飲食↔訓練互揭。
未修 LOW／待決在 MANUAL（有氧 a11y、sheet 收合動畫點擊落空、佇列逃生口、transient 條目無放棄出口）。push 前走全域 git-push gate。

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
下次續點（2026-10-14 自 active.md 搬入；編號沿用）

0. **體重自動同步：已完成**（部署、線上驗證、捷徑自動觸發、回填全過，Tally 94 列與 Health 零差異）。`.env.local` 的 `sb_secret` **使用者裁決保留**
   （非唯讀，只跑 SELECT、寫入先列清單確認，別再提議刪）；iCloud 的 `輸出.zip` 與備忘錄裡的 token 由使用者自行刪。**已決不做**：每日提醒、記錄 vs 身體對照畫面。

1. **PWA / service worker**：已併入續點 4（階段 1 甲 spec 已核可）。**原決定仍有效**：不承諾「變快」；SW **不快取** Supabase API 回應；登出時清掉本機快照。

2. **拍照辨識：v2.42–v2.44 均已上線**（函式 version 7）。加速三條路全數實測否決、思考維持開啟，全文與數據在 DESIGN.md v2.43。
   **「iOS 上下箭頭已結案」那句下早了**——2026-09-08 使用者回報仍會中斷。**剩下的**：
   ① 型別檢查已由 `tsconfig.functions.json` 涵蓋 ② **拍太遠會得到看起來合理、實際差一倍的數字**（82 讀成 140）、app 察覺不到——
   **使用者 2026-09-08 裁決不處理，別再提案** ③ **v2.46 已修掉兩半，等真機驗證**（全文與數據在 DESIGN.md v2.46）：切欄位時鍵盤高度沒變
   ⇒ `visualViewport` 只發 `scroll` 不發 `resize`，而 iOS 靠捲 layout viewport 露出欄位、正是 `--vvtop` 在補償的 ⇒ **iOS 的幫忙被我們
   依設計抵銷**。補了 FoodFormFields 的 listener（含 `scroll`）；sheet 頂部 96px 空隙在鍵盤升起時收回。
   **真機若仍會斷，先分辨**：（a）箭頭按了焦點沒移動 ⇒ accessory bar 分組問題，嫌疑是 v2.34 一併關掉的 vaul hack（app.css `.sheet`）；
   （b）焦點移了但看不到 ⇒ 空間／捲動，下一格可收「鍵盤升起時收起 AI 辨識鈕」（60px，會讓內容跳動，先看值不值得）。
   探針 `scan-probe.local.mjs` 在 repo 根（`*.local.mjs` 已 gitignore）；`.env.local` 放 key，**那把 key 曾出現在對話紀錄裡，使用者裁決不撤換——別再提案。**

4. **訓練記錄＋離線（取代 Gymwork）**：計畫、研究、探針 1／2／3 實測全在 spec.md「訓練記錄與離線」節（2026-10-12 使用者裁決自建，主因健身房網路差；
   **推翻先前「建議不自建」與 spec「不做：運動」**）。五階段：0 離線實測→1 PWA 離線讀寫→2 訓練記錄最小版（與 Gymwork 並行 1–2 週後停用）→3 課表／計時器→4 分析與運動×飲食並排。
   **階段 0、1 甲已完成**（2026-10-13；決策與 AC 在 spec.md「階段 1 甲 spec」，施工細節看 git log）：SW 外殼快取（vite-plugin-pwa）＋救援路徑、離線開機快速路徑（過期 token 實測約 2.6 秒，舊 26 秒）、恢復（DESIGN v2.51／v2.52）、登出分流、佇列核心 `src/lib/queue.ts`（純邏輯，`QueueStore`／`Sender` 注入）。vitest 296／e2e 116；真機測 1／2／4 通過。**刻意沒做、留給階段 2**（與先前寫的「登出時清佇列接在 userSignOutRef 上」不同）：IndexedDB adapter、真正的 Supabase sender、`App.tsx` 的佇列實例與登出接線——甲裡沒有呼叫者，現在驗不到。**接線要守的契約**在 `queue.ts` 的 `Sender` 註解：2xx 但 0 列要判失敗（delete 例外）、insert 用 upsert、update／delete 不用 `.single()`、signal 要傳給 fetch；`rejected` 不等於「該放棄」（跨列外鍵 409 下輪會自癒）；同一份儲存只能有一個實例。**push 前走全域 git-push gate。**
   **甲的未結項**：①有效 token 離線冷啟動約 7.5 秒（postgrest-js GET 重試 1＋2＋4；真機回報約 3 秒，原因未查）——縮短＝一次失敗就亮提示、背景繼續重試，慢網路會閃錯誤，**待使用者裁決** ②Q3 設定頁要不要放「重置離線快取」入口（建議不加）③2 秒門檻在慢網路會閃含「專案被閒置暫停」的提示（DESIGN v2.51 取捨）④救援演練手機端（選做；headless 已測）⑤主 repo `npm audit` 有 1 critical／13 high（與本案無關）。
   **階段 2（2026-10-13 訪談結果；spec 草案寫在 spec.md「階段 2 spec」，★待核可，核可前不動碼、不動 schema）**：有氧要記**速度、坡度**（選填）＋**機器／遊戲顯示的熱量欄（使用者自填，只存不算，留給未來推估）**；有氧＝跑步機坡度健走、Switch 2 有氧拳擊（在家）。RPE 不做（備註夠用）。動作庫先預填 16 個（清單見 spec），每個動作加「**要點**」欄（在器材前看，取代 GIF 指南；GIF 不做、無所謂）。**課表從階段 3 提前到階段 2**（使用者菜單 A、B 輪替，開始訓練可空白新增或選課表；原案「複製上次」作廢）；**肌群七類沿用 Gymwork**（胸部／背部／下半身／肩膀／手臂／腹肌／其他）。歷史紀錄階段 2、1RM／趨勢階段 4。**使用者已核可 spec（2026-10-13）**：uuid 主鍵、確定性預填 id、佇列加父列依賴、課表提前、肌群七類；另要求開始訓練時**組數／次數／重量一律預填上次實際完成的值**，並要有複製（存成課表＋複製課表）。**設計樣張已出：`_design-sample/training.html`（九個畫面，打勾可點，已用 WebKit 渲染與實點驗證），待使用者核可**，核可後才碰 schema 與碼。**樣張回饋已裁決（2026-10-13）**：主 CTA 開 sheet；重量調整鈕 ±2.5／±5 kg、次數 ±1／±5（點輸入框在該組下方展開，仍可直接打數字）；課表排序拖曳（用現成函式庫，只有握把能拖）；**備註欄全部拿掉，動作只留一個「要點」文字欄**（訓練中直接顯示但只能看，點筆圖示開「編輯動作」sheet 才能改，與動作庫同一張；肌群用下拉、儲存獨佔一行）；**分頁「日記」改名「飲食」、圖示換刀叉**（e2e 與 App.tsx 只有一處 aria-label 與幾行註解提到，成本低）；飲食頁的訓練入口在**熱量條右上角**（零額外高度；時間軸只留四餐）：有訓練＝「36 分」pill 點了到訓練分頁同一天，沒訓練＝「休息日」＋「開始訓練」按鈕（點了直接開選課表 sheet）；過去的日子沒訓練顯示「補記訓練」，明天不顯示；動作庫入口從右上角小書本改成訓練頁課表下方一整列「動作庫」；訓練頁與日記頁**共用日期元件：週列、點標題展開月曆、小點標有紀錄的日子**，取代 `‹ 日期 ›` 膠囊——**這推翻 DESIGN.md「日期切換」條的三個決定**（不做月曆、不做橫條、日期文字不當按鈕；原因：前提「只回看幾天」被訓練補記與月覽打破），v2.53 要寫回 DESIGN.md、並把鎖著舊決定的 e2e（日期相關約 91 處）改成相反斷言；頂部會高約 60px。兩頁互相揭露：訓練頁顯示當日飲食、日記頁顯示當日訓練（沒訓練不出現）。**第二輪回饋已裁決並寫進 spec.md（DDL 草案已改，需使用者重新核可）**：有氧依類型決定欄位（走路＝分鐘／速度／坡度；拳擊＝分鐘／預估熱量 `est_kcal`；都沒備註、不做新類型入口）；補記過去日子不跑計時、完成時手填時長（AC 8a）；刪 `workouts.note`、`workout_exercises.note`、`cardio_sessions.note`；**容器原則**：短、單一目的、要回到原頁的用 sheet（有氧、完成摘要、動作編輯、未同步、開始訓練），長清單／多步驟／要有自己導覽的用整頁（訓練中、課表編輯、動作庫）；動作庫改搜尋＋肌群橫條＋平面列表。樣張 13 畫面，待使用者看第三版。注意：新 sheet 含輸入欄位要守「`repositionInputs={false}`＋`--vvtop`」（DESIGN v2.32–v2.35）。運動熱量不進任何計算、訓練不寫進 Apple 健康（使用者已接受）。

5. **實測維持熱量（spec.md 同名節；流程 A；v2.49 卡片＋v2.50 回溯，兩輪 review 都處理；體重門檻**使用者裁決維持 4**，別再提 6）**：
   每日目標頁最下方的唯讀卡片對帳公式上限（2026-10-12：TDEE 1956、實測約 1760–1800，目標 1637 只有 ≈0.13 kg/週赤字），**不改目標、公式、資料表**；
   **真資料實跑：回溯顯示 7/22–9/8 那一串（約 1738，範圍 1683–1793）並標明日期**，近 28 天仍缺記錄。**運動加成另案**，等訓練記錄（續點 4）累積 3–4 週。

6. **估算一個品項＋複製前一餐（spec.md 同名節已寫、★等點頭才動碼）**：痛點＝沒標示的餐要離開 App 問 AI、於是整餐不記。A 估算（描述或拍照，擴充 `read-label` 雙模式，結果必落一列 foods 並立即封存）先、B 複製後；**第 0 步先用 5–10 餐實際吃過的餐量準確度**，再決定值不值得做。
7. **「用歷史推估該吃多少」的 user journey（使用者 2026-10-13 提出的差異化，別漏）**：多數 App 靠自訂運動係數推測；Tally 要用過往實際吃的熱量＋體重趨勢反推（類似股票回測）。**實測維持熱量卡（續點 5）已是它的一半**，缺的是從對帳卡片升格為「目標的依據」的流程與 UX；前提＝記錄完整度（續點 6 的估算一個品項）；升格前要做回測（切一段當未知、預測體重變化）。**順序：階段 2 先（產生資料）→ 累積 3–4 週 → 專門設計這條 journey**，使用者同意。
### 2026-10-14 08:27
review 修正清單（2026-10-14，code-reviewer 審 aa722c0/3dce105/2f8b4ae/a37ec6c；使用者核可全修）
- #1 CRITICAL：parentRefs/descendantKeys 不分外鍵種類。set null（workouts.routine_id）：父列被放棄→子列改 routine_id=null 保留；restrict（exercise_id）：放棄前列出連帶會消失的筆數確認；flush 時非 cascade 父列被拒不該讓子列永遠卡 pending。
- #2 HIGH：沒有 live session 時 supabase-js 改送 anon key → delete 被當成功、load 回空把本機底蓋空並重新預填。修：send/fetchAll 前要求 session.user.id === entry.userId，否則當 auth。也涵蓋 #8。
- #3 HIGH：多分頁互蓋佇列 → queueStore 讀改寫包 navigator.locks（使用者選此案）。
- #4 MEDIUM：applyQueue 與 send 後合併沒認 ignoreDuplicates，預填蓋掉改過名／封存的動作。
- #5 MEDIUM：多條 op 寫入不是原子的（enqueueMany 一次 commit）。
- LOW：#6 父列 update 失敗也擋子列 insert；#7 neverApplied 只看最後一次嘗試；#8 登出中途 sync 會在 clearAll 後回填；#9 useTraining request 在迴圈結束與 finally 之間被吞。
- 另記：e2e 全跑一次「訓練中：要點只能看…」紅（toHaveValue），單跑 ×3 綠，失敗訊息被覆蓋；下次全跑 *> 檔案 存輸出。視覺待辦：sheet 內確認框偏低，上緣露出被壓暗的儲存鈕。
### 2026-10-14 08:47
review 修正後留給 D 段（同步指示完整版）與待決（2026-10-14）
- D 範圍追加：①被拒絕父列底下的子列仍是 attempts 0／failure null，summarize 看起來跟「還沒送」一樣——D 要從條目推出「等父列」並顯示（AC 17 的另一半）②discardImpact 數的是條目不是列（同一列後來的 update 也算），確認文案用「N 筆變更」或改成數列，寫文案前先定③failure 'auth' 現在只代表「有網路但沒有有效 session」（網路類 refresh 失敗已改標 offline，61fcdd6），UI 可以直接說要重新登入。
- 待決（review 的 open questions，未在核可範圍內）：①佇列格式認不得時每次操作都丟錯、沒有出路——要不要做「原樣備份到另一個 key、清空重來」的逃生口（產品決定）②queueStore 的 isEntry 沒交叉檢查 op 與 payload（insert 帶 null payload 會只 upsert {id}），低風險。
- 環境：Web Locks 只在 secure context 有；localhost:5500 與 GitHub Pages https 都是，真機一律走部署網址，不會用到區網 http。
### 2026-10-14 10:08
A 段（有氧）push 前 review 沒修的 LOW（2026-10-14，之後再說）
- input 的 aria-label 蓋掉 label 裡的「選填」，讀屏念不到（拿掉 aria-label 要連 e2e 的 getByRole name 一起改）；錯誤沒有 aria-invalid／aria-describedby 綁到欄位。
- sheet 關閉後焦點落到 body（從開始訓練 sheet 串過來、或刪掉了觸發那一列），可能所有串接的 vaul sheet 都有；修法是 onCloseAutoFocus 指到主 CTA 或清單。
- 320px 寬時走路三欄的「速度 km/h 選填」約 92px 放不下 85px 欄（目標機 393 沒事）。
- cardioTarget 是開 sheet 當下的快照：編輯中同步改了那一列，diff 以舊的為準（逐欄後寫贏）。
- 「1,210」千分位、逗號小數、「。」不接受（只會擋下說明，不會存錯）。
- ExerciseEditSheet 有同一個「成功後 busy 放回去」的寫法，連按兩次會送兩次 update（update 是冪等的，新增動作才會多一筆）。
### 2026-10-14 10:59
sheet 收合動畫期間的點擊會落空（2026-10-14 e2e 診斷，既有問題）：vaul sheet 關閉的約 0.5 秒內點下面的按鈕，pointerdown 在按鈕、pointerup 落在正在收的 sheet 上，click 跑到 body。訓練中「挑完動作馬上點加動作／打勾」會吃掉那一下。跨分頁鎖讓寫入時主執行緒較忙、動畫拉長，機率變高（e2e 已改成等 sheet 收完）。要修的話：收合中讓 sheet 不吃 pointer（pointer-events: none on closing），或縮短收合時間；先看真機有沒有感覺。同類：vaul 收合中再打開會被延遲的 close 再關一次（advisor 指出，未驗證）。

### 2026-10-15 15:40
D 段 push 前 review（opus code-reviewer，0 blocking）留下的 non-blocking，不修的理由＝不動剛驗完的程式、等真機一起看（2026-10-15）
- **[MEDIUM] 外層固定 role=status 後，線上每記一筆「1 筆尚未同步」閃現可能被讀屏播報**（Training.tsx:232）。真機開 VoiceOver 驗吵不吵；吵就只在 source≠server 或有失敗條目時讓內容進 live region，或細條延遲約 1 秒才顯示。
- [LOW] sheet 開著時佇列清空（立即重試成功），觸發的細條按鈕被卸載，sheet 關閉後焦點落到 body。修法：SyncSheet 的 Drawer.Content 加 onCloseAutoFocus，觸發鈕不在時改放 `.tr-status-wrap`（tabIndex=-1）。
- [LOW] busy 期間下滑放手，vaul 只 setIsOpen(false) 不重設 transform，sheet 卡在半拖位置（busy 只有本機 IndexedDB 數毫秒）。照 LogSheet／FoodLibrary 補 `dismissible={!busy}`。
- [LOW] 確認框「另有 N 筆」開框當下算一次；背景 sync 讓被拒絕的 insert 變 5xx（maybeApplied）後，放棄實際不帶走子孫，與框上寫的不符（保守方向，不丟資料）。可在 confirmDiscard 前重算，或 failure 變了就收框。
- [LOW] useTraining.discard 成功後刷新 view 失敗，會顯示成「沒辦法放棄這筆」但其實已放棄；把刷新分開 try、失敗只 setError 不 rethrow。
- 可簡化：SyncSheet labelOf 的 O(n²) filter、trainingRuntime.ts:356 多餘的 sort、SyncSheet:172 與 :128 重複的標籤取得。
