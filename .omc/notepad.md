# Notepad
<!-- Auto-managed by OMC. Manual edits preserved in MANUAL section. -->

## Priority Context
<!-- ALWAYS loaded. Keep under 500 chars. Critical discoveries only. -->
現況（2026-10-27）：v2.100 以前已 push：含 v2.99 動作卡細修＋設定頁分組（✕ 取代 ⋯ 選單且一律先跳確認框、右側等距對齊勾欄）、v2.100 確認列蛋白／脂／碳加「+這次」。vitest 803、build、lint 過；e2e 全量 378 條跑 376 過（2 紅：service-worker 接手偶發、recovery-foreground 原因未查的時段性偶發，單跑都過）。**真機未驗**：v2.91–v2.100、RPE、重量建議。v2.99 取捨：名稱欄約 127→103px，收合列「下一組」較易截斷。
下一步：①真機驗 ②飲食頁待辦（MANUAL 最後幾節：餐建議先寫 spec＋樣張、回饋動效、PWA 圖示）③每日應攝取熱量計算調整（新對話；先讀 MANUAL 倒數第二節）。待確認：1.25 kg 槓片、啞鈴一格 2 或 2.5。

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
- **[已裁決 2026-10-22] 減少動態以 spec AC 10 為準**：位移、縮放、無限循環關掉或改 ≤120ms 淡入；純顏色／透明度過渡不受影響，所以 `.tr-check`／`.tr-val` 的 160ms 顏色過渡不收進 app.css 清單，code 與 e2e 不動。DESIGN 第 284 行已改寫、版本紀錄 v2.88。使用者一度想整個拆掉，討論後決定繼續遵守。
- **`tally.spec.ts` 偶發紅（今日頁 `.undo-bar` 一族）**：基線 `ddb5292` 也會紅（單跑 10 次紅 2 次），使用者裁決先當已知偶發、不擋 push；原因未查。單跑重複的過濾字串用 `tally.spec`，寫 `tally` 會把整套跑進去。
- **SW「新版 SW 裝好就接手」**：2026-10-19 查到與 precache 項數有關（全進 460 項單跑只過 3/6、基線與 311 項都穩），v2.74 已改成放大圖只預快取起始姿勢，詳見下方 v2.74 一節與 wiki `lesson-sw-precache-size`；根因仍未查。該 spec 不能用 `--repeat-each`。
- **排序收合動畫**：2026-10-19 評估過，touch 起手有 250ms 按住可以做，但建議等真機看過再決定（沒有裁決）。
- 本機 scratchpad 的基線 worktree `ctl`（`ddb5292`）與 `base`（`352c306`）**已於 2026-10-20 刪除**（使用者確認後：先 `cmd /c rmdir` 拆掉 node_modules junction，再 `git worktree remove`，驗過專案的 node_modules 完好）。之後開暫存 worktree 要用同一套流程收，別直接遞迴刪。
### 2026-10-19 21:00
v2.74 點動作縮圖放大（使用者提出，spec.md 沒寫；DESIGN v2.74 有全文）
- [追加 2026-10-19] 點縮圖開放大檢視（起始＋收尾兩姿勢）；動作庫／加動作／訓練中卡片／課表編輯四處可點。放大圖 640 寬 299 張（`src/assets/exercises-large`，腳本 `build-exercise-images.mjs` 重產）。
- **離線取捨（使用者 2026-10-19 裁決方案 1）**：只有起始姿勢進 precache（311 項／4.5MB），收尾姿勢離線看不到、檢視器自動藏起來。原因：放大圖全進 precache（460 項）時新版 SW 偶發卡在 activating。要把收尾姿勢也做成離線可看，得先查清 SW 卡住的根因。
- **待辦**：①真機驗檢視器疊在加動作 sheet 上的手感與下滑關閉（巢狀 dialog 沒有自己的暗色背景層，已知）。②體重趨勢圖（含體脂）spec 已核可、未開工：折線＋7 天平均、30／90／全部、體脂另畫一張共用 X 軸與十字線、明細表。
### 2026-10-20 11:20
動作示意圖換成 Gym visual 的 3D 人形＋GIF（v2.77，**已 push 並部署**；DESIGN v2.77 與元件規則「動作示意圖與預設動作目錄」條有全文）
- 來源 https://github.com/hasaneyldrm/exercises-dataset：**MIT 只涵蓋程式與文字資料，圖與 GIF 是 Gym visual 的**（180×180，要求每次使用附 `© Gym visual — https://gymvisual.com/`，已印在設定頁底部與放大檢視、repo 根目錄 NOTICE.md）。使用者已向 Gym visual 確認「個人 app 沒問題」（口頭轉述，**信件沒存、沒確認 public repo 內放圖檔是否涵蓋**——建議存信並補問一句）。
- 150 個動作對應：148 個有圖（腿屈伸與單腿腿屈伸共用一張），徒手深蹲、箱式深蹲沒有對應（退回肌群單字，列在 `scripts/exercise-images.json` 的 `noImage`）。縮圖 jpg 進 precache（159 項／2.4MB），GIF 不進（約 14MB），離線退回靜態縮圖。
- 瘦身清單（只留初中階，33 個，程度 7／冗餘 26）擱置：使用者 2026-10-20 說「先不刪」，目錄維持 150 個。要做時：改目錄＋對使用者帳號封存被拿掉的動作（exercises 不能真刪），寫入前先列清單確認。
- 取代了上面 2026-10-15 17:30 那節的待決②（肌肉解剖圖）與 v2.71 的照片來源；**也取代下面 2026-10-19 21:00 那節的離線取捨**（放大圖改成 GIF、不進 precache，precache 只有縮圖 159 項）。
- **待使用者決定**：①存下 Gym visual 的回覆信、補問 public repo 內放圖檔是否涵蓋（圖已進 git 歷史）②~~著作權標示列表畫面沒有~~——v2.81（2026-10-20）已補（動作庫、加動作、課表編輯、訓練中各在列表底部，共用 `GymVisualCredit`）；標示放在列表底部而非每一列是我對條款的解讀，沒向 Gym visual 確認。
- 同日 push 前 review（規範軸＋意圖軸）修掉：體重趨勢離線誤報「還沒有體重紀錄」（現在說「連不上伺服器」；連線重試約 7 秒才確定，期間是骨架）、載入骨架、CLAUDE.md e2e 條數（260 條、16 個檔）。
- **OMC notepad 寫入工具（`notepad_write_priority`／`notepad_write_manual`）2026-10-20 兩次回報成功但檔案內容沒變**，原因未查；改用 Edit 直接改 `.omc/notepad.md`，改完要回讀確認。
### 2026-10-21 12:00
肌群狀態 C（v2.83）與後續（DESIGN v2.83 有全文）
- [追加 2026-10-21] 使用者指定先做 C、B 之後；查文獻（PMC11057610）後把恢復窗口改成部位×組數（下半身 48／72、其餘 24／48，n=10 為界）；n=10 與各數字是設計決定、文獻沒給。使用者同意「大抵方向可以」。
- **[已做] 加快測試速度**（使用者 2026-10-21 提出）：全量 e2e 牆鐘 981→573 秒（−42%）。①`training.spec` 檔內平行（長尾拆掉）②動作庫前置條件改用 `e2e/seeded.ts` 的現成 fixture（10 條各省約 15 秒）。**刻意不做**：離線測試的 7 秒（postgrest-js 重試，繞法會改變測到的失敗路徑）。**新發現的偶發**：`settings-nav`（體重趨勢返回）、`spring-sheet`（點一下把手落定）整套跑才偶發紅，單跑各 20 次全過，原因未查。剩下的長尾：真預填 2 條各約 18–20 秒、`rest-timer`「−15／＋15」14 秒。
- **D（RPE＋熱身標記）設計方向，使用者同意、spec 與樣張未寫**：每個動作最後一組打勾時，在休息條上問一次「還能做幾下」，四檔（3+／2／1／力竭＝RPE 7／8／9／10），單點即存、不點＝未知；組編輯 sheet 內有同樣四檔可補填；熱身組先用規則推（同動作重量低於當天最大 60%，數字是猜的）不加欄位。要動 schema（`workout_sets.rpe`）→ 影響面升級，先 spec＋plan、等點頭。RPE 進演算法只改 `recoveryWindowHours`（某肌群有任一組 RPE≥9 → 窗口 +24 小時，數字取文獻下緣）。限制：只問最後一組看不到每組趨勢；初學者自評不準。
- C 的已知限制：熱身組算進組數；沒有 RPE；頁面開著不動時剩餘小時不更新；真機未驗。
### 2026-10-22 15:00
有氧併入動作（spec.md 同名節、DESIGN v2.89；DDL ① 已執行，code 已實作、待 push）
- [追加 2026-10-22] spec 外追加：①有氧預填分鐘留空、有氧 sheet 分鐘欄 placeholder「上次 N」（push 前 review 的 HIGH，使用者裁決，理由＝有氧卡沒有勾，預填會變成假記錄）②有組的有氧卡退回重訓畫法（`isCardioCard`）③`.tr-field input::placeholder` 改 `--ink-muted`，**全站 `.tr-field` 的 placeholder 都受影響**（原為瀏覽器預設灰；對比 4.94:1）。
- **部署後待辦（還沒做）**：開一次 App 讓它自動補出兩個有氧動作 → 遷移 3 筆舊 `cardio_sessions`（健走 2、拳擊 1，10/12–10/15）成 3 次獨立訓練。遷移 SQL **還沒寫**：明寫 `user_id`、用 (user_id, kind) 找動作、started_at＝當天 12:00 台北時間、ended_at＝起點＋分鐘，寫入前先列清單給使用者確認，驗筆數與分鐘總和（55）。push 前確認 App 的未同步佇列是空的（舊版離線殘留的 `cardio_sessions` 條目新版送不出去；使用者裁決不加相容層）。舊表保留不動，真機驗過後另一輪再 drop。
- 已知小問題未修：寫入失敗訊息可能重複前綴「這筆沒有存下來：這筆沒有存下來：…」（程式推論，QueueStorageError 已含前綴）；`soloCardio` 對「有組的有氧卡」仍列成有氧摘要；只做有氧的補記要填兩次分鐘；e2e `recovery-foreground` 全量偶發紅一次（單跑 6/6 過、沒驗乾淨基線）。
- 待使用者：健走摘要折行點（「坡度」與「8%」被拆開）要不要黏住；真機驗有氧卡與有氧 sheet。
### 2026-10-22 16:50
v2.91／v2.92 push 前 review 留下的 follow-up（0 blocking；MEDIUM-1 手動吸附帶速度已改 velocity 0 並重跑左滑 5 條×3 次全過；其餘未修，等真機驗完再一起處理）
- **[MEDIUM-2]** `.tr-check:active`／`.tr-all:active` 與 `[data-pressed]` 並存：拖曳超過 10px 後標記被清掉，但 `:active` 還在（桌面一定如此），勾在左滑整段保持縮小變深，與 DESIGN 新增那條「開始左滑就清掉」不一致。修法：`:active` 只留給鍵盤（`:focus-visible:active`），觸控與滑鼠只走 `[data-pressed]`，並把 training.spec 約 1835 那條改斷 transform／背景色。
- [LOW-1] 列開著時按勾會出現按下回饋、放開卻只是關列沒打勾（`SwipeDelete` 的 onClickCapture 吞 click）→ `SetRow` 在 swipeOpen 時不掛 `checkPress`。
- [LOW-2] 從勾上起手往上捲清單，勾會先閃一下按下（pointerdown 當下就掛標記）→ 可延遲 60–80ms 掛，或接受並記在 DESIGN。
- [LOW-3] 按住時切 App／下拉控制中心／ctrl-click，沒有 pointerup 也沒有 pointercancel 會卡在按下 → 按下期間加 window blur 與 visibilitychange 清除。
- [LOW-4] 「全部完成」逐組換色期間，按下的底色變深也被 `--cascade-delay` 延後 → `.set.is-cascade .tr-check[data-pressed]` 的顏色 transition-delay 設回 0。
- [LOW-5] training.spec 約 1737 減少動態左滑那條用 `v > -71.5 && v < -56.5` 的 0.5px 數值窗，機器忙時可能假紅 → 改斷「兩端之間的寫入 ≤ 1 筆」。
- [LOW-6] `.set.done .tr-check[data-pressed]`、`.tr-all.is-on[data-pressed]`（iOS 走的路）沒有測試守，刪掉任何 e2e 都不紅 → 在「不靠 :active」那條先勾起一組與全勾再派 pointerdown，斷 accent-dark。
- [LOW-7] v2.91 T1 標題寫「要點寫很長也不必捲」但 textarea 不會長高，那段斷言驗不到東西 → 拿掉或改標題。
- [LOW-8] app.css 約 1505 註解「圈 .86→1」過時，現為 .88。
- 既有、不屬本輪：編輯動作 sheet 的 `SpringSheet` 沒傳 `locked`，寫入中仍可 Escape／點 scrim／下滑關閉；`.tr-all` 36×36 低於 44px 下限；`scale(.88)` 縮小點擊區（真機點圓的外緣可能落空，要真機才看得出）。
### 2026-10-22 17:50
v2.93（封存搬到動作庫列表）push 前 review 留下的 follow-up（0 blocking；使用者決定先推、真機看過再處理）
- **[MEDIUM-1／2，最值得先看]** 封存點下去沒有任何回饋，約 150 列的清單裡該列直接消失到最底下的已封存區；列位移後第二下會點到補上來的下一列的封存鈕（可逆但靜默）。處理方向：頂欄下方 `.tr-status`＋`role="status"` 顯示「已封存 X」，或沿用食品庫 `.undo-bar`；也可剛封存的那列先留在原位標「已封存」。
- [LOW] 移除 › 的理由已改成引課表編輯為先例；主按鈕可補 `aria-label="X，編輯"`；錯誤條只在下一次點封存才清（write 成功後也該 `setError(null)`）；錯誤那條 e2e 的 toBeInViewport 分辨不出位置（清單沒捲動）；ARCHIVE_ICON／RESTORE_ICON 在 FoodLibrary 與 ExerciseLibrary 各一份可抽到 src/components/；食品庫寫「復原 X」、動作庫寫「取消封存 X」用詞不一。
- 另：使用者之後要「調整計算每日應攝取熱量」，新對話一開場先讀 notepad 與 spec.md「每日目標計算引擎」「實測維持熱量」；2026-10-12 的裁決是不改目標、公式、資料表（TDEE 1956 vs 實測約 1760–1800），運動加成另案、等訓練記錄累積 3–4 週（現已累積約 2 週）。
### 2026-10-27 15:00
- [追加 2026-10-27] v2.99 動作卡細修＋設定頁分組（spec.md 沒寫，使用者當天提出；DESIGN v2.99 有全文與取捨）。若嫌名稱欄太窄：`.ex-head` 右內距改回 4px 可拿回 16px，代價是 ✕ 不再對齊勾那一欄。移除 ✕ 一律先跳確認框（沒打勾也問，使用者當天裁決），所以沒做 undo。
### 2026-10-27 17:30
飲食頁待辦（使用者 2026-10-27 討論，都還沒開工；建議順序 ①→②→③）
- ① 記一筆確認列加「+這次」：每格保留 after／目標，後面接淡色 +這次（蛋白 112/137 +28）；不出樣張，直接做、截 393 寬的圖看，擠就換版型。
- ② 餐建議（取代 spec.md 192 行起「複製前一餐」B 項）：建議＝某一餐的一組品項＋份量。來源 A＝上一個同類日（平日／假日）的同一餐（例：平日早餐），B＝補缺口（例：晚餐，前提是前面幾餐記得完整）。sheet 裡點了建議才勾進已選、不預設選中；今日頁待記錄列點一下直接寫入＋`.undo-bar` 復原；該餐已有紀錄不出建議。先 A 後 B。**先寫 spec 與一張建議卡樣張，核可才動碼**；B 要等每日目標算法與單餐上限定案。
- ③ [想法 2026-10-27] 新增記錄的 feedback 動效：新增訓練、記錄飲食這類「加進來」的動作目前沒有回饋；樣式未定，屬飲食頁特效雕琢的一部分。
### 2026-10-27 18:00
- [想法 2026-10-27] PWA 圖示（主畫面 icon）現在的樣子使用者覺得很醜，要重做；樣式未定，先不展開。
