---
title: "cleanup-inventory 整體程式碼盤點（2026-11-02）"
tags: ["cleanup", "盤點", "疑似 bug", "待決"]
created: 2026-11-02T04:43:04.353Z
updated: 2026-11-02T04:43:04.353Z
sources: []
links: []
category: reference
confidence: medium
schemaVersion: 1
---

# cleanup-inventory 整體程式碼盤點（2026-11-02）

基準 commit `efc1999`，行號都以它為準，改過 code 後要重新定位。方法：`knip`、`jscpd` 一次性掃描，加五區只讀審查（`src/lib`、`src/components`、App 與三大畫面、其餘畫面、CSS）。

**進度**：B1–B6 已修（DESIGN v2.109），都先寫出會紅的 e2e 才動產品碼，修前實際重現過。B1 兩條路徑都成立。B5 比原判斷窄：只有列已開著再多拉才會卡，沒拉開就放手本來就會回彈。清理批次 1–4 已做完（2026-11-02），下面四段是原始清單，留作查對；行號都已位移。

**批次 4 刻意沒做**：`targets` 改推導、`loadRef`（價值低，又動開機流程）；`if (!profile) throw`（在 useCallback 裡，型別收窄進不去）。

**還沒處理**：其餘 15 個疑似 bug（含 B7）；`app.css:370` 的 `.ed-error` margin 被後面的 `.sheet-error` 蓋掉，上方註解也不準；`LogSheet`、`api.ts`、`Login.tsx`、`main.tsx` 還有提到 legacy 的舊註解；`training.ts`「補齊預設動作」的舊說法；`DESIGN.md` 元件規則表「店家欄位」「食物表單」還寫 vaul；`prefersReducedMotion`、`errText` 多份；`FoodFormFields` 的 `portalContainer` 是否還需要沒有實測。`src/components/` 的新檔不在 `e2e:affected` 的表上，改了會升全量，是刻意的（共用元件影響面看不出來）。

**批次 1 刪死規則時連帶消失的意圖**：掃描填入的 340ms 文字淡入（`app.css` 的 `.form-lock.scan-filled`）在減少動態下仍會跑。被刪的 reduced-motion 規則因權重輸給 `:not([id$="vendor"])` 那條，本來就沒作用，所以畫面沒變，但要關掉的話得修權重。

**要真機確認**：飲食列放手吸回（B5）、左滑手感（`swipePhysics`）、分頁指示器滑動（`TabBar`）、iOS 鍵盤（`useViewportInsets`）。

**狀態說明**：其餘 bug 都來自讀碼，沒有實際重現，修之前要先重現。標「回讀」的是主對話親自對過原始碼；其餘只有審查 agent 回讀過。基線全量見 `e2e-reference`。

## 疑似 bug：影響使用

| # | 位置 | 問題 | 狀態 |
| --- | --- | --- | --- |
| B1 | `src/App.tsx:316-338,463` | A 日刪除失敗後已切到 B 日，按「重試」走 `loadDay(A)`：先 `setRows(null)`，再因日期不符提前 return，notice 沒清，全頁卡在錯誤畫面。慢請求換日後失敗同理（catch 沒查日期）。e2e 沒測 | 回讀 |
| B2 | `src/screens/Today.tsx:556-576,715` | 份量欄 blur 沒改也送 PATCH；`handleInput` 已改 `localQty`，失敗時回滾基準是剛打的數字 | 回讀 |
| B3 | `src/screens/FoodLibrary.tsx:121,156-163,237` | 封存成功後 `hiddenIds` 沒清，從已封存復原後「使用中」仍看不到，要離開重進。e2e 的 stub 分不出兩分頁，蓋不到 | 回讀 |
| B4 | `src/screens/FoodLibrary.tsx:337` | FAB 條件 `editingId === null`，編輯中的列被封存、切分頁或搜尋濾掉後 FAB 消失，也沒有取消鈕可按 | 回讀 |
| B5 | `src/screens/Today.tsx:356-370` | 飲食列放手沒有吸回（`next === open` 時 `animate` 不重跑），`SwipeDelete.tsx:47-56` 修過同一個真機 bug；e2e 沒驗位移 | 回讀 |
| B6 | `src/screens/SetSheet.tsx:222,227,346` | `synced` 換組不重設，換開另一組仍顯示「已同步 ✓」 | 回讀 |
| B7 | `src/lib/trainingRuntime.ts:192-203` | 分頁用「不滿一頁」判結束，`api.ts:166-171`、`spec.md:154` 明文說錯。`supabase/config.toml` 的 `max_rows` 等於 pageSize，目前不觸發；線上值未查。修法每次載入多 6 個請求 | 回讀 |
| B8 | `src/screens/LogSheet.tsx:327,352`、`Today.tsx:124` | 寫入失敗顯示原始錯誤（`Failed to fetch`），`friendlyError` 只用在讀取和刪除；要先確認是否刻意 | |
| B9 | `src/screens/FoodLibrary.tsx:122` | `clearTimeout` 在 await 之前：A 的復原 pill 還在時封存 B 且失敗，pill 永不消失 | 待確認 |

## 疑似 bug：無障礙與視覺（修了畫面會變，要截圖）

- `src/app.css:1668`：`.tr-search` placeholder 沒設色，估算約 2.9:1，`.search-box` 有設（回讀）
- `src/app.css:689,1424,1540`：`.trend-skel` 無限呼吸、`.ex-head .sub` 位移、`.tr-val:active` 縮放沒進減少動態
- `src/app.css:1177`：熱量欄 `animation-delay: 90ms` 因權重輸給 `:1176` 而不生效（回讀）
- `src/app.css:1464-1466`：`.ex-zoom-badge` 的 stroke 被 `.screen svg` 蓋掉（回讀）
- `src/app.css:198,1431`：`.dot` 撞名，訓練進度點吃到 `margin-top: 5px`，推算偏低約 2.5px
- `src/app.css:556,1479`：著作權標示用 `--ink-faint`，違反 DESIGN
- `src/app.css:616,730`：`.info-popup`、`.lib-fab` 自訂陰影，違反 DESIGN
- `src/screens/LogSheet.tsx:583`：aria 文案沒同步 `Today.tsx:229-231` 的「已超出，目標」
- `src/screens/Today.tsx:190-193,227-232`：`aria-label` 掛在沒有 role 的 div
- `src/components/RestBar.tsx:37`：超時狀態沒有「略過休息」鈕，點 RPE 後焦點掉回 body
- `src/components/SpringSheet.tsx:32,190`：`locked` 時關閉鈕看起來能按、按了沒反應

## 疑似 bug：低影響

- `src/App.tsx:788-807`：登出沒清月份小點
- `src/lib/foodForm.ts:42-43`：新增食物沒有上界檢查，輸入過大會看到資料庫原文
- `src/lib/trainingRuntime.ts:294-298`：SessionMismatch 分支沒重設 `source`（待確認）
- `src/screens/ExerciseEditSheet.tsx:144`、`RoutineTargetSheet.tsx:104`：關閉動畫中重開可能沿用草稿（待確認）

## 清理批次 1：機械清理，行為不變

- **依賴**：移除 `class-variance-authority`、`clsx`、`tailwind-merge`；`package.json` 補 `@dnd-kit/abstract`。`components.json` 的 `utils` 指向不存在的檔
- **死碼**：`training.ts:651` `formatLastSets` 連測試、`training.ts:1021` `CARDIO_KIND_LABEL`、`types.ts:29` 與 `App.tsx:918` 的 `profile`、`TrainingSession.tsx:637` 守衛、`DateStrip.tsx:128`、`SpringSheet.tsx:53`、`FoodFormFields.tsx:232,235,262`、單子節點 Fragment（`LogSheet.tsx:487,656`、`TrainingSession.tsx:421,480`）、`Today.tsx:888` 內層 key、`DailyGoal.tsx:93`
- **多餘 export**：`knip` 列的 14 個常數與 5 個型別，已查：`DEFAULT_TARGET_SETS`、`REST_ON_TIME_MS`、`CARDIO_KINDS` 的外部命中都只是註解
- **CSS 死規則**：`app.css:287-288,389,408,538-545,559-562,703,992,1268-1276,1291-1292,1401`、`:699` 與 `:1279` 片段、`:91 --field-line`；`index.css:96-128` 的 `.dark`（`:16` 要先比對 build 產物）
- **token 換值**：`app.css:1430,1602,1536,1514,1547,727,1235,604`
- **過時註解**：`trainingRuntime.ts:8,74,141`、`exerciseCatalog.ts:209`、`training.ts:4-5`、指向 `legacy/` 的檔頭、`FoodFormFields.tsx:11-14,103-105,148-149`、`SegmentedControl.tsx:1`、`SwipeDelete.tsx:2`、`LogSheet.tsx:3-5,186,342,488-489`、`App.tsx:136-138,232-235,411-412,981-984,992-995`、`Today.tsx:578-580,733-736`、`types.ts:1,38,40-41`、`Settings.tsx:5-11,26`、`SyncSheet.tsx:2`、`RoutineNameSheet.tsx:5`、`StartSheet.tsx:3`、`app.css:3-8,14,311,335,352-359,431,586,860-862,872-890,915-919,1071,1228,1243-1248`、`index.css:9-14`、`DESIGN.md:154,224`

## 清理批次 2：`src/lib` 去重，vitest 能驗

`training.ts`：`allSetsDone`（:591）、`byPosition`／`bySetNo`（:378-380，`addSetOps:504` 不要併）、「上次」排序（:213-218 與 :1101-1106）、Row 轉 SetLike（:338 與 :394-396）、兩支 reorder（:624-635 與 :921-932）、`WriteOp`／`RowOp`、`seedCatalog` 多餘轉換（`trainingRuntime.ts:272-281`）、`startedMs`（`strength.ts:29-32`，會碰階段 1 的檔）、`exerciseRpe` 改名（:590,599）、`dayIndex`／`daysBetween`（日期邏輯，五個 vitest 檔全跑）、`WEIGHT_COLS`（`api.ts:273,284`）、`meal: string` 改 `MealKey`（`api.ts:133,197,215`）、`fetchTimeoutMs`／`now`（`trainingRuntime.ts:96,99`）、`copyRoutineOps` 的 `name?`

## 清理批次 3：畫面去重，e2e 把關

`TabBar`（`App.tsx:1000-1064`）、`QtyStepper`（`Today.tsx:696-727`、`LogSheet.tsx:96-127`）、`foodMatches`／`byName`、`SubPageTop`（7 處 `lib-topbar`）、Analysis 與 WeightTrend（axis、日期格式、空狀態）、`RoutineRow`（`StartSheet.tsx:39-56`、`Training.tsx:89-104`）、封存圖示、肌群 fallback 5 份、`isCardioCard`／`entryHasRecord`、`'（已刪除的動作）'`、拖曳 pending hook（`RoutineEditor`、`TrainingSession`，風險中）、手勢放手判定（`Today`、`SwipeDelete`，風險中且要真機，併 B5 處理）、`SpringSheet` 的 `label` 型別、`ExercisePicker` 的 `create` 攤平、錯誤文字 CSS 併組（`app.css:1111,1142,1655`）

## 清理批次 4：state 與結構

`failed` 可推導（`App.tsx:152`）、`loadDay` 必填參數後刪 `loadDayRef`（必驗 `undo 跨日期`）、`targets` 可推導（可不做）、`ready` 納入 `foods`、`overQuotaIds`、純邏輯搬進 lib（`LogSheet.tsx:39-48,222-231,379-412`、`SetSheet.tsx:51-61`、`FinishSheet.tsx:36-42`、`FoodLibrary.tsx:38-52`、`Settings.tsx:42-49,120-125`、`DailyGoal.tsx:217-225,258-264`、`MaintenanceCard.tsx:196-216`、`DateStrip.tsx:279-285`）、拆檔：`ExerciseCard`（`TrainingSession.tsx:97-484`）、`ItemEditor`（`Today.tsx:497-779`）、`useViewportInsets`、`useMonthMarks`、`useFoods`、`BootScreen`

## 不併、不動

- `FoodFormFields` 與 `DailyGoal` 的輸入框、`CardioSheet` 與 `RoutineTargetSheet`、`ExerciseLibrary` 與 `RoutineEditor`、`Training.tsx:276-291`：語意不同或抽了不划算
- `.screen svg` 與 `.sheet svg`：併了會改 stroke 勝負
- `App.tsx` 的開機與 intake 待刪邏輯：競態修最多次，邊界不乾淨
- `queue.ts`、`queueStore.ts`、`sender.ts`、`useTraining.ts:84`：壞了難救，沒有明確問題不動（批次 1 只拿掉 `sender.ts` 的 `SenderTable` export，型別層面，但它在 CLAUDE.md 的例外清單上，全量要在 push 前綠）
- `knip` 誤判：`scripts/build-*.mjs`、`supabase/functions/*/index.ts`
- 重複程式碼總量 0.77%（14 處、125 行），工具掃到的片段多半不值得處理

## 等使用者決定

- `Settings.tsx:142-187` 改用 `SpringSheet`：理由（id 衝突）已失效，可連帶刪約十處 CSS 與狀態，但動效和 iOS 鍵盤會變，spec 排在 B3
- `public/_probe/` 退場：spec 規定先推自我解除的 `sw.js`，等手機開過一次才刪，要使用者配合
- `index.css` 的 shadcn 模板 token：`app.css:11-12` 註明機制留給未來元件，只省幾 KB，未建議動
- `app.css:1684-1689` 的 `.tr-field select`：箭頭色寫死，改了幾何會變，要截圖
- `.action-btn` 與 `.pick-bar-btn`、`.search-box` 與 `.tr-search`：已分岔，要先定一個值才能併

