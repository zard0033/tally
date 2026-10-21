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

- **前端**：GitHub Pages（Actions build 部署），Vite + React + TypeScript + Tailwind + shadcn/ui + vaul + supabase-js。手機優先 RWD。UI 要有質感（走設計流程、先 demo 再實作，不端平庸貨）。視覺一律以 `DESIGN.md` 為準。（2026-07-29 改版：原「純 HTML/CSS/JS 無框架無 build」是開案時未經論證的預設值，檢討與研究脈絡見 session-state/archive-2026-07.md「技術棧轉向」節。）
- **後端**：Supabase 免費版 — Auth（登入）＋ Edge Function（保管 secret、代理需 service key 的操作）。
- **資料庫**：Supabase Postgres（唯一來源）。
- **計算**：全在前端 JS（繞開 Notion 公式限制）；目標動態（依最新體重／TDEE）。
- **登入**：Supabase Auth ＋ Google OAuth，session 存 localStorage，平常不重登。（訪談時原訂 email magic link，實作改用 Google——省掉每次收信的往返。）

## 安全（不可妥協）

- `service_role` key 只待後端（Edge Function 環境變數）＋使用者本機，**永不進前端、永不進 repo**。
- 前端只用 `anon` key ＋ RLS（Row Level Security）。
- Neve 分析：平常用**唯讀 key**；**key 絕不進 repo**（放本機 env 或需要時臨時提供）。
- **repo 為 public**（2026-07-27 轉），GitHub Pages 網站當然也公開。隱私全靠 Auth ＋ RLS：前端只有 publishable key，未登入讀任何一張表都回 `[]`（已實測）。
- **這是單人 app：Supabase 的「Allow new users to sign up」必須維持關閉**（2026-08-13 立，precommit review 指出）。**這條不只保護資料，還是 `read-label` Edge Function 唯一的成本防線**——那支函式驗完 JWT 就代打付費的 OpenRouter，沒有 per-user 配額，所以「只有一個帳號拿得到 token」就是它的速率限制。官方文件原話：`If this config is disabled, only existing users can sign in`（通用設定，Google OAuth 同樣受管）。**把註冊打開會無聲地重開這個洞**：不會有測試變紅、不會有任何提示，站點 URL 與 anon key 都在 public bundle 裡，任何人登入一次就能把額度打光（花費上限已設，所以最壞是功能停擺不是帳單）。真的需要開放註冊時，**必須同時**在函式內加 per-user 配額或把呼叫者限縮到特定 `sub`。

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
**不做**：掃條碼(店家品項無條碼)、食譜(使用者是 per-item 記法非食材料理)、體態照片、喝水、群眾食物庫。（**運動**：2026-10-12 起改為要做，見「訓練記錄與離線」節。）

## 拍照讀營養標示（2026-08-13 追加，開案 spec 外的新需求）

**動機**：食品庫已蓋住重複品項，這功能的獨特價值只在「第一次吃的新品項」那一次——省下手打七個欄位。使用者接受這個範圍，並認為搭建過程本身有價值。

**選定**：`qwen/qwen3.7-flash`，走使用者既有的 OpenRouter 帳號（另開的獨立 key）。$0.030／$0.130 per MTok ≒ **NT$0.07／月**（以 30 次計）。三輪實測依據已不在現存檔案裡（active.md 2026-10-14 退役前就已覆寫掉），要查走 git 歷史：`git log -S qwen -- session-state/active.md`。

### AC（＝將來的測試）

1. 新增食物 sheet 上有一顆相機鈕，`accept="image/*" capture="environment"`；它在 `<form>` 內必須標 `type="button"`（沒標的 button 預設是 submit，見 DESIGN.md「多欄輸入一律包 `<form>`」）。
2. 選圖後前端壓縮：**長邊 ≤1200px、JPEG q0.85**。**payload 實測約 560KB（base64 752,775 字元，真機 iOS Safari）**——原本 AC 寫「<400KB」是拿本機 Pillow 的輸出推的，而瀏覽器的 canvas 沒有 Pillow 的 optimize，同樣像素大三倍，上線第一天就撞到後端上限。**這一條的教訓是方法不是數字：不要拿 A 工具的量測去設 B 工具的門檻。** 重設時也**不再拿任何一張照片去推**（換張照片推是同一個壞形狀）：改用專案既有的 WebKit（跟 iOS Safari 同一家引擎）量**這個格式的上界**——1200×1200 純亂數＝JPEG 壓不動的理論最壞，實測 1,368,887 字元，任何真實照片都到不了；門檻取它的 1.46 倍，餘裕留給「桌面 WebKit 終究不是 iPhone 上那份編碼器」。**尺寸換算**由 `src/lib/image.ts` 的 `fitWithin()` 承擔並有六條單元測試（含 mutation 檢查）；**位元組上界的真正 gate 在後端**——Edge Function 的 `MAX_IMAGE_CHARS` 會擋掉過大的 payload 並回 400，那條有測試。前端不另外斷言位元組數：要驗得有意義就得在瀏覽器裡真的產一張 4000px 的圖再壓，成本遠高於它擋到的風險（真正的上界已經在後端）。（**兩個旋鈕的成本不對稱**：token 由像素數決定 ── Qwen3.7 每 32×32 px 一個 token，1200px≈780 tokens／2048px≈2300 ──，而 **JPEG quality 完全不進 token 公式，只影響上傳位元組**。所以尺寸要省、品質不必省；原訂 q0.75 是把「省」用錯地方，q0.85 對小字多留一點餘裕而 token 成本不變。）
3. Edge Function **無有效 JWT 一律回 401 且不呼叫 OpenRouter**（用 `SUPABASE_JWKS` 驗，該環境變數 Edge Function 預設就有）。亂寫 token 與過期 token 各一條測試。
4. 函式成功回 `{name, basis, serving_g, kcal, protein_g, fat_g, carb_g}` 固定形狀；失敗回 `{error}`，**不洩漏 OpenRouter 的錯誤原文或 key**。`name` 是包裝上的**正式完整品名**（如「伯朗奶茶-減糖香濃原味(三合一)」），不是商標大字——同品牌常有多種口味，只取品牌名會讓不同營養的品項在食品庫裡同名。**`name` 是唯一讀不到也不算失敗的欄位**（讀不到回 `null`）：數字才是難的部分，品名使用者自己打很快，為了它丟掉六個正確的數字是本末倒置。
5. 結果填進表單欄位，**品名欄＝讀到的品名＋括號標籤**：`per_serving` 無公克數→`（每份）`／有公克數→`（每份 17g）`／`per_100g`→`（每100克）`。**`name` 為 null 時品名欄只填括號**（例如 `（每份 17g）`），使用者在前面補打名字即可——括號已經在那裡，比整欄留白好用。品名偏長是刻意的：結果一律是草稿，**刪短比從頭打字容易**，所以寧可給多不給少。
6. **結果一律是草稿，表單不自動送出**；辨識失敗時表單維持可手打，不出現阻斷式提示。斷言辨識後 `foods` 無新列、且 stub 回 500 時仍能手動完成新增。
7. 既有 e2e／vitest 全綠、`npm run lint` 0 error。

### 明確不做（Musk 視角砍除，別在下一輪長回來）

- **4/9/4 反算驗證**：選定模型三輪零錯，沒有證據需要它；且標示熱量與 4/9/4 本來就對不上（DESIGN.md 已記），這個檢查會**誤報**，而誤報的警示等於沒有警示。真正的防線是「使用者按新增前一定看得到數字」——那道免費且已經存在。**真實拍攝若測出錯誤再加回來**（這是刻意留的加回候選）。
- **`servings_per_pack`**：使用者明講份量自己換算。
- **重試／fallback 模型／降級流程**：失敗的路已經存在且免費——手打。
- **存圖／辨識歷史／log**：沒有人提出需求。
- 掃條碼與純前端 OCR：見「不做」節與 session-state/archive 的否決紀錄。

### 接縫（一條已量、一條已裁決）

- **壓縮強度：1200px 已實測通過**（2026-08-13，`IMG_5610.jpg` 伯朗奶茶隨身包——反光蓋住整片表格、塑膠袋彎曲、手持傾斜、標示僅佔畫面約 15%）。1200／1600／2048／原尺寸四組**全部六欄全中**，含標示小字「每一份量 17 公克」。原本的擔心「壓完表格只剩 270px 見方、數字 12px 高會讀不到」**不成立**。
  **四組結果一致不是因為被伺服端拉平**（我一度如此推測，查證後推翻）：Qwen3.7 的 `max_pixels` 預設約 **2,621,440 px**，四組裡只有原尺寸 2268×4032 超標被縮，1200／1600／2048 三組**都在上限以下、是三種真的不同大小**卻都讀對——所以正確解釋是**這個任務在遠低於上限處就已飽和**，我們手上是真餘裕不是量測假象。
  **上限（失敗邊界）仍未找到**：往下掃的實驗未跑。若哪天某張照片讀錯，第一個要調的就是長邊（一行改動）。**但下限只能當量尺，不能拿來當設定值**——設在臨界點等於每張照片都在賭。
- 品名加括號會改變 DESIGN.md 的同名判斷（決定要不要補店家第二行）——**接受**：不同份量本來就該視為不同品項。

**成本**：辨識 NT$0.07／月；Edge Function 免費額度 500k／月（用 30 次＝0.006%）；egress 只有一包小 JSON。實質為零。**唯一的成本風險是 OpenRouter key 還沒設花費上限**——列為實作第 0 步。

## 體重自動同步（2026-10-12 追加，開案 spec 外的新需求）

**動機**：體重／體脂手動謄寫（使用者自述「一個月記一筆」）造成資料稀疏且日期不準。2026-10-12 對照 Apple 健康匯出：90 天內 Health 13 筆、Tally 7 筆，其中 2 筆日期是錯的（08-01、09-01 實為 08-21、09-25 的讀值，月初當日期、填最近讀值）。**方向**：Health 是身體數據的預設來源，手動輸入保留（同日衝突以 Health 覆蓋，使用者裁決）。

**資料流**：體脂計（香山／MovingLife）→ Apple 健康 → iOS 捷徑（個人自動化）→ `ingest-weight` Edge Function → `weight` 表。網頁讀不到 HealthKit，捷徑是不必做原生 app 的唯一路徑。**已真機實測**：捷徑「尋找健康樣本」讀得到體重與體脂（2026-10-12，10/09 的 77.35kg／24.6%）。**尚未實測**：自動化能否「立即執行」不彈確認、鎖屏時會不會跑——觸發時機（關閉 MovingLife 時／每晚固定時間）等這兩點實測後才定。

**範圍**：只有體重與體脂。MovingLife 另寫的 BMI、去脂體重可由這兩者與身高推得，不另存。**不改資料表、不改 UI**，既有手動輸入入口原樣保留。

### AC（體重同步，＝將來的測試）

1. 沒帶 `Authorization`、scheme 不是 Bearer、或 token 不符 → 回 401，**`weight` 完全不被寫入**。三種失敗回同一句固定訊息。
2. 合法 payload（兩筆、不同日期）→ 回 200 `{written: 2}`，寫入列的日期、體重、體脂與 payload 一致，`user_id` 一律是 `OWNER_USER_ID`（**不取自請求**）。
3. 同一份 payload 重送 → 寫入列完全相同（以 `user_id,measured_on` upsert，冪等）。
4. **任一筆**不合法 → 回 400，**整批都不寫入**。不合法＝體重不在 30–250、體脂（換算後）不在 2–70、日期不是真實日曆日期、日期晚於「明天」（台北時區）或早於 2015-01-01、缺體重。
5. 單次最多 60 筆、body 最多 20,000 字元，超過回 400。
6. 只寫 `weight`；回應只含 `{written: n}` 或固定錯誤字串，**不回傳任何既有資料、不洩漏 token**。
7. 體脂 ≤ 1 視為小數並換算成百分比（0.246 → 24.6）；數值接受 number 或帶單位的字串（`"24.6%"`、`"77.35 kg"`），因為捷徑常把欄位序列化成文字。
8. 同一批內同一天出現多筆，取時間字串最大者（無時間則取最後一筆）。
9. `INGEST_TOKEN` 未設或短於 32 字元、`OWNER_USER_ID` 不是 UUID → 回 500（fail closed），**不回 401**，401 只有「驗證失敗」一個成因。token 比對用常數時間。
10. 只收 POST；不加 CORS（呼叫者是捷徑，不是瀏覽器）。

### 決定與限制

- **身分驗證是共用祕密，不是使用者 JWT**——捷徑無法登入。token 存在手機上，洩漏的最壞後果是有人能往 `weight` 寫假資料；**讀不到任何東西**，且冪等、可由 Health 重新覆蓋。token 不進 repo、不進對話，由使用者在 Dashboard 設成函式 secret（名稱不能以 `SUPABASE_` 開頭，故用 `INGEST_TOKEN`、`OWNER_USER_ID`）。
- **token 遺失或洩漏＝重新產生**，同時更新函式 secret 與捷徑兩處，不需要找回舊值。本機若要留備份，只放 `.env.local`（`.gitignore` 的 `.env.*` 已涵蓋）；**repo 是 public，任何會被追蹤的檔案都不放**。
- **部署旗標**：沿用 read-label 的 `--use-api --no-verify-jwt`（捷徑沒有 JWT，閘門在函式內）。
- **寫入用 `SUPABASE_SECRET_KEYS`（預設注入）**，不另設 DB 密碼。有體脂與沒體脂的列分兩次 upsert，沒體脂的列不碰既有的 `body_fat_pct`（兩次請求非原子，部分失敗留下的是「較舊但合法」的資料，重送即補齊）。
- **刻意不做**：多使用者、讀取端點、per-request 速率限制（單人、冪等、寫入量有界）、活動量／運動紀錄同步（另案，見訓練紀錄診斷）。
- **一次性工作（不屬於函式）**：回填 Health 2025-03 起的歷史、更正 08-01／09-01 兩列。**寫入前列出新增／修改／刪除清單，使用者確認才執行。**

## 實測維持熱量（2026-10-12 追加，開案 spec 外的新需求）

**動機**：使用者目標是「確認記錄飲食時的上限，符合自己的消耗量」。現行目標是**純正向公式**（BMR×活動係數→TDEE→上限），輸入只有最新體重／體脂／身高／年齡／手選的活動量，**飲食記錄與體重走勢完全沒有參與**。2026-10-12 用現有資料唯讀對帳：記錄完整的 7 週（07-20～09-06）平均攝取約 1760 卡、體重 75.95→75.70 持平 ⇒ 實測維持約 1760–1800，引擎 TDEE 1956（係數已是最低的 1.2）、目標 1637，只有約 140 卡赤字（≈0.13 kg/週，設定是 0.29）。**公式在這個人身上偏高，而活動係數往上跳只會更高。**

**做什麼**：每日目標頁加一張**唯讀**卡片，用「近 28 天吃了多少＋體重怎麼變」算出實測維持熱量，與目前上限並列，並直接說「照這個上限吃，預期每週約 ±N kg（設定 ±M）」。**不改目標、不改公式、不寫任何資料。**

| | 現在 | 加上之後 |
| --- | --- | --- |
| 上限的依據 | 公式猜（體重／體脂／身高／年齡／手選活動量） | 不變 |
| 飲食記錄、體重走勢 | 不參與 | 參與**對帳**（不參與計算） |
| 使用者能知道上限準不準嗎 | 不能，只能憑感覺 | 能：卡片給實測值、區間與預期週速度 |

**算法**（純函式，`src/lib/baseline.ts`，禁沾 DOM）：窗口＝昨天往前 28 天（今天還沒記完不算）；平均攝取＝有記天數的每日合計平均（`kcal×qty` 加總；單日合計 < 1000 卡視為沒記完，不算有記）；體重變化＝窗口內體重對日期的線性迴歸斜率（kg/天），不用首尾兩點；**實測維持＝平均攝取 − 斜率×7700**（7700 沿用引擎既有常數）；區間＝斜率 ±1 個標準誤差換算；預期週變化＝(目前上限 − 實測維持)×7÷7700（負＝瘦，正＝增加）。**生理上不可能的結果不給數字**（見 AC 9）。

### AC（＝將來的測試）

1. 窗口不含今天；窗口外的資料完全不影響結果。
2. 有記天數 < 21，**或**體重 < 4 筆，**或**體重橫跨 < 14 天 ⇒ **這個窗口**不給數字，顯示「資料不足」與缺什麼（還差 N 天記錄／N 筆體重）。**回溯（2026-10-12 使用者核可）**：最新窗口不足時，往回找**記錄最多的一連串**顯示（見 AC 11；**不是「最近一個合格的 28 天窗口」**）；找不到才整張卡只剩「資料不足」。
3. 體重持平、平均攝取 X ⇒ 實測維持 ≈ X（±1）。
4. 體重每週 −0.3 kg、平均攝取 X ⇒ 實測維持 ≈ X + 330（±2）；每週 +0.3 kg 則 ≈ X − 330。
5. 單日合計 < 1000 卡的天不進平均攝取，也不計入「有記天數」。
6. 顯示實測值、區間、目前上限、預期週速度；公式模式與自訂目標模式都顯示（自訂目標沒有 TDEE，只與自訂熱量比）。
7. **唯讀**：不呼叫任何寫入 API、不改 `computeTargets` 的輸出、不改 profile。
8. 資料取得失敗 ⇒ 卡片顯示「讀不到記錄」，不影響頁面其餘部分。
9. 算出**生理上不可能**的結果（體重斜率超過每週 ±1.5 kg、維持熱量低於 800 或高於 5000、或非有限數）⇒ 不給數字，顯示「資料看起來有誤」與算出的斜率，請使用者檢查體重紀錄。**只抓不可能的，不抓所有打錯的**：離群值放在窗口中間時槓桿小，只會把結果推到「看起來合理但錯」的地方，這個方法本身抓不到。（review 發現：一筆 57.5 打成最後一筆可算出 5760 卡。）
10. 區間標示為「約六成把握」（±1 個標準誤差，不是 95%）；體重少於 8 筆時依據行加註「誤差可能到幾百卡」。
11. **回溯到一連串記錄**：最新窗口（窗尾＝昨天）狀態為「資料不足」時，在抓回來的範圍（最新窗口再往前 90 天）裡找**有記天數最多的一連串記錄**——有記的日子（單日合計 ≥ 1000 卡）之間漏記不超過 2 天算同一串——用**整段**（第一個有記的日子到最後一個有記的日子）與其中所有體重去估；同分取較近的；該串需滿足 AC 2 的三道門檻。顯示它的數字，並**明寫起訖日期與「不是近 28 天」——標題那一列就要帶日期**，不能只放在說明框；同時保留最新窗口缺什麼。回溯時說明不能再寫「約要 3–4 週才跟上」（那只在最新窗口成立），要寫「接回記錄後會更新」。最新窗口是「資料有誤」時**不回溯**（要讓人看見錯誤，不用一段乾淨的舊資料蓋過去）。回溯不到 ⇒ 只顯示「資料不足」。**為什麼是整段、不是滑動 28 天窗口**（兩次踩到）：①取最近一個合格的 28 天窗口——停止記錄後的前幾天窗口仍 ≥ 21 天有記，但體重已開始上升，把數字拉低（2026-10-12 真資料：最近 28 天直接算出 1412，記錄完整那段約 1740–1780）；②滑動窗口再「同分取區間最窄」——每窗只有約 4 筆體重時，估計在 1552–1787 之間亂跳，最窄的只是剛好擬合得緊（贏家詛咒），且它的窄範圍連 1780 都沒包到。整段讓窗尾落在最後有記的那天，又用上整段所有體重，兩個洞一起補。
12. 抓資料的範圍＝最新窗口往前再加 90 天；查詢要分頁到抓完（PostgREST 單次上限 1000 列，窗口拉長後不能再靠「應該不會超過」）。**停在空頁，不停在「不滿一頁」**：伺服器的 max_rows 若低於一頁，用「不滿一頁」判結束會靜默砍掉最新的幾天；offset 跟著實際拿到的列數走。

**體重門檻（2026-10-12 使用者裁決）：維持 4 筆。** 已知代價：4 筆時 p90 誤差約 250–480 卡（Monte Carlo，日常波動 σ≈0.4 kg），而要對帳的赤字常只有一兩百卡；體重自動同步上線後資料變稠密，此誤差會自然縮小，AC 10 的「少於 8 筆加註誤差」照舊。

### 決定與限制

- **為什麼只對帳不接管目標**：現在沒有足夠資料（9/7 起 5 週只記 1 天），先讓使用者看到數字與誤差，再決定「要不要改用實測值」。**自動改寫目標**是下一步，要看過真實結果再談，不在本案。
- **口徑就是記錄口徑**：漏記的油與飲料會讓實測維持偏低；但上限本來就是套在「記下來的熱量」上，只要記錄習慣一致這把尺就是對的。**這個值會隨記錄習慣改變而漂移**，卡片要寫明依據的天數。
- **滯後是這個方法的本質**：活動量改變後約 3–4 週才反映。**運動加成（依每週訓練次數即時補差額）另案**，等訓練記錄（見「訓練記錄與離線」節）累積 3–4 週、知道頻率穩不穩再決定；它需要讀取訓練資料，**不在本案**。
- **誤差來源**：每週僅 1 筆體重時，斜率誤差約 ±100 卡/天（2026-10-12 估）；水分與肝醣的短期波動；7700 卡/公斤是粗估。體重自動同步上線後資料會變稠密。
- **刻意不做**：窗口長度可調、通知／提醒、把結果放上今日頁、歷史走勢圖、依實測值自動改活動係數。
- **不動**：資料表 schema、Edge Function、`formulas.ts`、既有手動輸入入口。

**實作範圍**：新增 `src/lib/baseline.ts`＋單元測試；`src/lib/api.ts` 加一支只撈 `eaten_on,qty,kcal` 的區間查詢；`DailyGoal.tsx` 加卡片；`e2e/stub.ts` 補區間查詢的回應；DESIGN.md 元件規則＋版本紀錄。UI 先出截圖給使用者調，再收。

## 體重趨勢圖（獨立頁；內容於 2026-10-19 前核可，之前只存在 notepad 摘要，2026-10-20 補寫進來；同日使用者選定用圖表套件）

設定頁「體重趨勢」進去的獨立頁，取代佔位卡（資料門檻已過：2026-10-12 體重同步上線）。屬全站精緻度 B3 的「prototype 殘留清除」，但體重趨勢本身另案走 `dataviz`。

### AC

1. 範圍切換：30 天／90 天／全部（分段控制，用現有 `SegmentedControl`）；範圍以「今天往前數」算，不是以最後一筆往前。**預設 90 天**（補的決定：樣本約 94 筆，30 天太短看不出趨勢）。
2. 體重圖（單位 kg）：每筆原始量測畫成淡色小點，**7 日平均**畫成 2px 主色折線；兩個系列所以有圖例（點＝每次量測、線＝7 日平均）。折線末端標最新一筆的 7 日平均值，其他點不標數字。
3. **7 日平均口徑**：某天的值＝該天往前 7 個日曆日（含當天）內所有量測的平均，不是「最近 7 筆」（記錄不是每天都有）；從第一筆起就有值（早期窗口內筆數少，等於貼近原始值）。
4. 體脂圖（單位 %）：**另畫一張**，不與體重同軸（dataviz 規則：兩種量不同尺度不做雙軸）。只畫有填體脂的量測，單一系列所以不要圖例（標題就是名稱）。範圍內一筆體脂都沒有時，這張卡不畫，改一行說明「這段期間沒有體脂紀錄」。
5. 兩張圖**共用 X 軸與十字線**：指標在任一張圖上移動，兩張的十字線同步停在同一天；tooltip 列出該天的體重、7 日平均、體脂（沒填的寫「—」）。鍵盤可聚焦圖表看同樣的內容。
6. 明細表：圖下方列出範圍內每一筆（日期／體重／體脂），新到舊；這是圖的表格視圖，也是不靠 tooltip 讀數的出口。
7. 狀態：載入中＝保留版面的骨架（分段控制與卡片高度不跳）；0 筆＝「還沒有體重紀錄」；**連不上伺服器、手上又沒有資料可退回＝「連不上伺服器，載不到體重紀錄」**（不能把離線說成沒有紀錄；自己的請求還沒回來時先骨架，不先下結論）；1 筆＝只畫點、不畫線；範圍內 0 筆但全部有資料＝說明「這段期間沒有紀錄」並提供切到「全部」。**佔位卡與開發備註不得再出現在畫面上。**
8. 顏色全部走 DESIGN token（主色 `--accent` 畫 7 日平均，`--ink-faint` 畫原始點，體脂線用 `--ink-muted`），格線與軸為 hairline、不虛線；減少動態時圖表不做繪製動畫（一律關閉）。
9. 資料：`listWeights` 的 90 筆上限不夠「全部」，趨勢頁自己撈完整歷史（上限放寬到 1000，Supabase 單次回應上限）；設定頁的 sparkline 與 `MaintenanceCard` 的用量不變。連不上時退回設定頁傳進來的那份。

### 決定與限制

- **用圖表套件，不手畫 SVG**（使用者 2026-10-20 選定：「有套件就用套件，比較漂亮」）：recharts 3.x（peer 含 React 19）。代價＝bundle 變大；**用 `React.lazy` 把趨勢頁切成獨立 chunk**，不進主 bundle，precache 只多 1–2 個檔案（SW 曾因項數卡 activating，要重跑 `service-worker.spec`）。
- 純運算（7 日平均、範圍切片、軸範圍）放 `src/lib/weightTrend.ts`，不沾 DOM，附 vitest。
- **刻意不做**：目標體重線、縮放／平移、與熱量並排（階段 4 才做）、把圖放上今日頁。
- 手畫的 `sparklinePoints`（設定頁入口那條）不動。

## 估算一個品項與複製前一餐（2026-10-12 追加，開案 spec 外的新需求）

**動機**：使用者自述少記的原因是「不知道怎麼記」——去女友家吃爸媽做的炒飯、水果這類**沒有標示、每次不同**的餐，現在要離開 Tally → 問 AI 要三大營養素 → 回來手 key，嫌麻煩就整餐甚至整天不記（2026-09-07 起 5 週只記 1 天）。「實測維持熱量」那張卡要近 28 天有記 ≥ 21 天才算得出來，**記錄頻率就是它的瓶頸**。

**兩項，各自獨立 AC、可分開上線**。優先序：A 估算（解痛點）先，B 複製（便宜）後。**複製解不了炒飯那一類**——它省的是重複的餐，不是沒有標示的餐。

### A. 描述或拍照，估算一個品項

**輸入**：文字描述、食物照片，**擇一或兩者都給**（照片加一句補充最準，例如「媽媽炒飯一碗」）。
**流程**：記一筆 sheet 的新增食物表單上，緊鄰既有的「AI 辨識輸入」再加一顆「AI 估算」→ 描述／拍照 → 函式回估算 → 填進表單欄位**當草稿** → 使用者確認或改 → 新增並記入。
**資料**：`intake` 需要 `food_id`，所以估算結果**必然落成一列 `foods`**（先前口頭說「預設不進食品庫」不成立，在此更正）。零 schema 變動的做法：建立後立即 `archived: true`——不出現在選單、仍可在食品庫管理的「已封存」找回；表單上一個勾選「存進食品庫」，勾了就不封存。
**後端**：擴充 `read-label` 為雙模式（請求帶 `mode: 'estimate'`），**不另開一支**：JWT 驗證、CORS、診斷、固定錯誤字串這層安全外殼只留一份；複製一份就是「同一條規則兩處各維護」。代價是函式名稱與用途脫節。模型沿用 `qwen/qwen3.7-flash`。**提示詞要求**：台灣常見份量、**把假設寫出來**（例如「一碗飯約 200g、用油約 1 湯匙」）、給熱量範圍。

#### AC（＝將來的測試）

1. 認證同 `read-label`：無有效 JWT 回 401 且**不呼叫 OpenRouter**（沿用既有三條測試的形狀）。
2. 請求至少要有 `description`（trim 後 1–300 字）或 `image`（既有 data URI 驗證與 2,000,000 字元上界）其中之一，否則 400；兩者皆合法時一併送模型。
3. 成功回固定形狀 `{name, kcal, kcal_low, kcal_high, protein_g, fat_g, carb_g, assumption}`；數值逐欄驗（有限數、kcal 0–3000、三大營養素 0–300 g、`kcal_low ≤ kcal ≤ kcal_high`），**任一不合法整組當失敗**；`name`、`assumption` 讀不到是 `null`、不算失敗。
4. 失敗只回固定字串，不洩漏上游原文或 key；上游逾時（45 秒）必須小於前端逾時（55 秒），同 `read-label`「誰先放棄」那條規則。
5. 填入表單後 `name` 末尾帶「（估算）」；畫面顯示範圍「約 480（400–560）」與 `assumption` 一行。
6. **結果一律是草稿**，不自動送出；失敗時表單維持可手打，不出現阻斷式提示。
7. 勾「存進食品庫」→ 新列 `archived=false`；不勾 → 新列 `archived=true`，**且今日頁時間軸仍顯示該筆**（驗證 intake 對已封存食物的顯示，這是實作前要先驗的假設）。
8. 只有文字、只有照片、兩者皆有，各一條 e2e（fetch 全 stub）；既有 e2e／vitest 全綠。

#### 明確不做

- 多品項拆解（一次一個品項，要拆就描述兩次）。
- 營養資料庫比對、掃條碼、歷史與存圖。
- **4/9/4 反算驗證**：模型錯的時候是自洽地錯，拿它自己的輸出交叉驗算是假守門員（見 DESIGN.md v2.43）。
- 重試與 fallback 模型（失敗的路已經存在且免費：手打）。
- 實測維持熱量卡不區分估算值與標示值。

#### 已知風險（開工前先量，不先下結論）

- **準確度未知**：目前沒有任何一餐家常菜的實測。**第 0 步**：用使用者實際吃過、事後對得上的 5–10 餐跑一輪，看範圍包不包得住實際值，再決定值不值得做。
- **延遲未知**：標示辨識實測 13–22 秒（思考開啟）；純文字應較快，但**沒量過**。
- **偏誤方向未知**：模型若系統性低估家常菜，實測維持熱量會跟著偏低。

### B. 複製前一天的某一餐

**範圍**：記一筆 sheet 已選好餐別時，若「檢視日的前一天」同餐別有紀錄，顯示「複製昨天的{餐別}」入口：列出那幾筆與合計熱量，按確認一次寫入檢視日的同餐別。來源是既有 `listIntake(前一天)`，App 已預取該日（命中快取）。

#### AC（＝將來的測試）

1. 前一天同餐別無紀錄 ⇒ 不顯示入口。
2. 寫入的列：`food_id`、`qty` 與營養快照欄一律取自來源列；`eaten_on` 與 `meal` 取自檢視日與餐別；**不覆蓋、不去重**（同日已有的照舊保留）。
3. 寫入失敗 ⇒ 沿用既有失敗呈現與重試，來源不受影響。
4. 在「明天」（v2.47）也可用；來源永遠是「檢視日的前一天」。
5. 食物之後被封存或改名 ⇒ 以來源列的快照為準。
6. e2e 兩條：成功路徑、無來源不顯示。

**明確不做**：複製整天、任意日期之間複製、「昨天吃一樣」的自動帶入、排程。

### 決定與限制

- **不改 schema、不新增資料表**（A、B 皆然）。部署旗標沿用 `--use-api --no-verify-jwt`。
- **成本**：沿用同一把 OpenRouter key 與它的花費上限；估算的呼叫頻率比標示辨識高，**用量未量**，上線後看一週實際呼叫數再說。
- **隱私**：食物照片送 OpenRouter，與標示辨識相同；不存圖。
- **與實測維持熱量的關係**：兩項都在補那張卡的瓶頸（記錄頻率），**不改那張卡本身**。
- **實作範圍**：`supabase/functions/read-label/handler.ts`（加模式與測試）、`src/lib/api.ts`（`estimateMeal`）、`FoodFormFields.tsx`（加鈕與輸入）、`LogSheet.tsx`（複製入口）、`e2e/stub.ts`（`__scan` 擴充）、DESIGN.md。

## 訓練記錄與離線（2026-10-12 追加，取代 Gymwork）

**動機**：使用者 2026-10-12 試用 Gymwork 後決定自建並取代它。兩個理由，**主因是第一個**：① 健身房網路不穩，要看今天做哪些動作、動作圖都載不動（App 本身不支援離線）；② 個人化分析（肌群訓練量以外的 1RM、恢復狀態、週比較）綁 PRO。**這推翻兩個先前的決定**：本檔「不做：運動」，以及 session-state「建議不自建」（當時的理由只有「Gymwork 已會寫入 Apple 健康」，不含離線與費用）。**使用者接受的代價**：Tally 的訓練不會出現在 Apple 健康（網頁沒有 HealthKit 寫入 API）；Apple 健康只少一筆運動時長，體重同步（健康→Tally）不受影響。

**盤點依據**：2026-10-12 的 Gymwork 螢幕錄影（四個分頁：運動／分析／課表／個人檔案）＋ App Store 頁面。使用者實際用法很簡單：菜單 A 全是機械、3 組×12 次，重量由上次預填，做完一組打一個勾；有在用**每個動作的備註**（例：「沒辦法做完全程 就降重」）。**訓練量＝已完成各組 重量×次數 的總和**（錄影驗算：腿推舉 60×12×3＝2160、坐姿胸推 35×12×3＝1260，與畫面一致）。Gymwork 自估的 105 kcal（4380kg、44 分）明顯偏低，印證「運動熱量不進任何計算」。

### 階段（每階段出口條件達成才開下一階段；階段 1 起，開工前先寫該階段的 AC 並等★核可）

| 階段 | 做什麼 | 出口條件 |
| --- | --- | --- |
| 0 離線可行性實測 | 拋棄式探針，**不寫產品碼、不受★核可管**。見下方「階段 0 要量的三件事」 | 三個答案寫進本節；若推翻階段 1 設計，先改設計再往下 |
| 1 甲 PWA 離線地基 | 離線能開 App；離線寫入佇列（機制與測試，**尚無呼叫者**）；離線指示；SW 救援路徑 | 真機飛航模式能開、離線指示正確；佇列通過 vitest＋mutation（**2026-10-13 使用者定 (a)**：「能記、連線後同步正確」改由階段 2 的出口驗，見下） |
| 2 訓練記錄最小版 | 動作庫（名稱＋肌群）；一次訓練＝動作＋組數表（kg×次）＋打勾＋**每動作備註**；**開始訓練時每組自動帶出該動作上次完成的重量與次數**，備註一併帶出；頂部顯示時長／總訓練量／組數 | 在健身房用 Tally 完整記完一次（**含真機飛航模式離線記錄、回線後同步正確——佇列的第一次真實呼叫與真機驗證，從階段 1 移到這裡**），並與 Gymwork 並行 1–2 週後仍夠用，才停用 Gymwork |
| 3 常用輔助 | 課表（如「菜單 A」）、複製上次訓練、組間休息計時器、單位與最小槓片 | 使用後再決定是否做 |
| 4 分析 | 各肌群每週訓練量與組數目標、1RM（e1RM）紀錄與進步曲線；**運動×飲食並排**：訓練量、攝取、體重放同一時間軸 | 先過 `dataviz`；並排只呈現、不下因果結論 |

### 階段 0 要量的三件事（結果會決定階段 1 怎麼做）

1. **離線時 supabase-js 會不會把 App 踢回登入頁**（refresh token 失敗、`onAuthStateChange` 發 `SIGNED_OUT`？）——唯一可能推翻整個設計的未知數。要分兩種情況量：token 還有效、token 已過期。
2. **service worker 在 `base: '/tally/'` 下能不能快取外殼並離線開啟**——用 build 後的 `vite preview`、**測到一半把伺服器關掉**來量（Playwright 的 `setOffline` 在 WebKit 重載時會丟內部錯誤，不能用，見探針 2），再用真機飛航模式驗（headless WebKit 與 iOS 不完全等價，**以真機為準**）。
3. **iOS 上本機寫入佇列的存活**：從主畫面開啟的網頁 App 與一般 Safari 分頁對儲存空間的清除規則不同（Safari 對久未互動的網站有清除上限，**我印象是主畫面 App 不在此列，但未查證**——階段 0 要先查文件再下結論）。佇列只存在手機上，**上傳前資料就是唯一一份**。

### 階段 0 研究結果（2026-10-12，`ecc:search-first`；**只是查資料，上面三件事的實測仍待做**）

| 問題 | 查到的 | 依據 | 對設計的影響 |
| --- | --- | --- | --- |
| 離線時 supabase-js 會不會把人登出 | **不會**。refresh 遇到網路錯誤時不移除 session、不發 `SIGNED_OUT`；但 access token 已過期時 `getSession()` 先指數退避約 30 秒，才回 `{session:null, error}`，且 60 秒內同一顆 token 直接回快取的失敗 | 專案 `node_modules` 內 auth-js 原始碼（`GoTrueClient.ts` 的 `__loadSession`、`_callRefreshToken`） | 真正的阻礙不是被踢出，而是 **離線開機卡約 30 秒、然後停在「連不上後端」**（`App.tsx` 開機流程）。access token 預設 1 小時（**本專案設定未驗證**），隔夜到健身房離線開 App 必中。階段 1 要設計「離線開機」：本機仍存有 session 時不等 refresh，直接以本機 session 進入離線模式 |
| iOS 儲存會不會被清 | Safari 分頁：七天沒互動會清掉 script 可寫的儲存（IndexedDB、localStorage、SW 註冊）。**從主畫面開啟的網頁 App 有獨立計數、不受這七天上限**，WebKit 官方明文「We do not expect the first-party in such a web application to have its website data deleted」 | WebKit 部落格 2020-03-24。**這是 2020 年的聲明，之後有無變動沒查到**；有二手文章稱 iOS 17.4 歐盟地區把主畫面 App 改成書籤（未證實，台灣不適用） | 前提：**Tally 必須「加到主畫面」使用**，在 Safari 分頁裡用離線佇列不可靠。仍要真機驗 |
| SW 工具 | vite-plugin-pwa **2.0.0**（2026-10-03 釋出，peer 含 `vite ^8`，與本專案相容），底層 workbox-build 7.4.1 | npm registry | 傾向 adopt，但它是剛出的大版本。`/tally/` 子路徑下的 scope／`start_url` 行為**只讀到二手討論（issue），沒讀到官方文件**，階段 0 探針要實測 `sw.js` 的實際位置與 scope。備案：手寫 runtime-cache SW（約 30 行，不需 precache 清單） |
| 離線寫入佇列 | 專案現無 TanStack Query／Dexie。候選 idb-keyval 6.3.0（極小）、Dexie 4.4.6；TanStack Query 的 mutation 失敗預設回滾後遺失（要另加 persist／pause 設定）；RxDB、PowerSync 是整套本地資料庫加複製，對單人單機過重。**這段比較多半來自 RxDB／TanStack DB 自家文章，有利益偏向** | WebSearch、npm registry | 傾向：idb-keyval 存放 ＋ 自寫約 50 行佇列（客戶端 UUID ＋ Supabase upsert 冪等）。不引入 Query／RxDB |
| Supabase 官方離線立場 | 沒查到官方離線支援說明 | — | 當作「supabase-js 不提供離線同步」處理，**未經官方文件證實** |

未涵蓋：context7（官方文件庫）需授權，這次沒用。

### 探針 1 實測結果（2026-10-12，headless WebKit 393×745、build 後的 preview；用假 session 注入 localStorage，Supabase 網域請求全部中斷）

| 情境 | 結果 |
| --- | --- |
| A：access token 已過期（隔夜） | 約 **25.8 秒**才停在「連不上後端」（5.4 秒時先出現「連線比平常慢」）；session **仍留在 localStorage**、沒被登出；console 只有 `AuthRetryableFetchError` 警告。**與上面讀原始碼的推論一致** |
| B：access token 仍有效 | 約 2 秒進入 App 框架，但資料請求失敗，**停在「讀不到你的資料／連不上網路／重試」**——App 進得去、卻沒有任何資料可看 |

**結論**：離線時兩條路都走不到「看今天的課表」。A 要等 26 秒再被擋；B 進得去但沒有快取。階段 1 的最小目標因此明確：**① 本機有 session 就立刻進離線模式，不等 refresh；② App 要有本機持久化的資料（課表、動作庫、最近訓練），離線時從它讀。** **限制**：這是模擬「後端連不上」，不是真的斷網；SW 外殼快取與真機行為（探針 2、3）尚未測。

### 探針 2 本機實測結果（2026-10-12，`public/_probe/` 暫時頁面，SW scope 只在 `/tally/_probe/`）

headless WebKit，**把預覽伺服器真的關掉**（網路確實沒了）後：

- SW 註冊成功、`clients.claim()` 後接手控制；伺服器已死時**頁面仍能從 SW 快取重載**。
- 離線寫入 IndexedDB 2 筆，重載後仍是 2 筆。
- 對自己源站的 `ping.txt` 回「網路不可達」，**可用它分辨真的連不到**。
- **`navigator.onLine` 在後端已死時仍回「線上」**——它只反映有沒有網卡連線，不代表伺服器連得到。**離線判斷不能靠它**，要靠實際請求失敗。
- Playwright 的 `setOffline(true)` 在 WebKit 重載時會丟內部錯誤，**不能拿來驗離線**；以後一律用「關掉伺服器」。

**限制**：這是桌面 WebKit，不是 iOS；「加到主畫面」「飛航模式」「儲存是否被清」要靠探針頁部署後用真機驗（探針 3）。**儲存讀數是整個源站（`zard0033.github.io`）共用的**，會被同源其他頁面干擾，所以探針每筆寫入都記錄「主畫面或分頁」，分開數。

**探針頁收尾順序（別直接刪資料夾）**：直接刪會讓手機留下孤兒 SW 與快取，且頁面沒了就按不到「解除 SW」。正確順序：① 推一個會自我解除並清空快取的 `sw.js`（手機下次開探針頁時瀏覽器會自動換上它）② 等使用者在手機開過一次 ③ 才刪 `public/_probe/`。

### 探針 3 真機實測結果（2026-10-12，iPhone，iOS 27.2；使用者回報）

| 步驟 | 結果 |
| --- | --- |
| Safari 分頁按「要求持久儲存」 | `persist()` 回 **false**（沒授予持久儲存） |
| 加到主畫面後開啟 | 主畫面模式＝是；**Safari 分頁寫的 2 筆在主畫面 App 裡看不到**——兩邊儲存互不相通 |
| 飛航模式＋冷啟動主畫面 App | **能開、能寫，重開後筆數還在** |
| 關閉飛航模式後「檢查網路」 | 網路可達 |

**結論與影響**：

- **階段 1 的核心風險排除**：iOS 主畫面 App 能離線冷啟動（SW 外殼快取有效），離線寫入 IndexedDB 能存活到重開。
- **Safari 分頁與主畫面 App 的儲存互不相通**：Tally 的 session、快取、離線佇列都只存在「實際使用的那個容器」。**必須固定從主畫面使用，且要在主畫面 App 內登入**；從 Safari 分頁開會看到另一份空的狀態。Google OAuth 在 standalone 模式下的登入流程**尚未驗證**，階段 1 要實測。
- **`persist()＝false` 是在 Safari 分頁量的**，主畫面容器的值沒記錄；不能據此假設資料不會被清，離線佇列仍要有「未同步」警示。
- **尚未驗證**：① 七天存活：Safari 分頁那 2 筆 **2026-10-19 起看是否還在**（驗 Safari 的七天規則）。**主畫面 App 的「久沒開」情境要另外放 8 天不開才測得到**——使用者每週都會去健身房開 App，此情境對實際風險低，列為可選 ② SW 放在 `/tally/` 根的 scope（vite-plugin-pwa 產物，階段 1 本機 build 驗）③ OAuth 在 standalone：**部分已測**，見下一段。

**OAuth 在主畫面 App（使用者實測，2026-10-12，iOS 27.2）**：Google 登入**能完成**。但登入途中若遇到 Google 的信箱二次驗證，兩種「離開再回來」的方式結果不同：**底部左右滑切換 app → 回來能正常登入；上滑回首頁 → 開信箱點連結 → 點桌面圖示回來 → 登入失敗、要重登**。**原因未查，不要先猜**：Safari 分頁走同一流程不會觸發二次驗證，**無法拿來對照**，不能由此判定問題出在主畫面模式；失敗時回到登入頁，**畫面上那句話還沒確認**——登入頁可能的三種：沒有任何訊息（登入流程被中斷）／「登入已過期，請重新登入」（SIGNED_OUT 事件）／auth-js 的 `PKCE code verifier not found in storage…`（回跳時找不到驗證碼，指向「起點與終點是不同儲存容器」），三者指向不同原因。**2026-10-12 使用者對照後回報「好像都不是」，症狀未能辨識，暫停追查**（只在該容器首次登入才碰到，影響小）；階段 1 實作到登入時，請使用者在失敗當下**截圖**再查。**這件事只在「該容器首次登入」或 Google session 過期時才會碰到**，之後 Supabase 的 refresh token 會續命。**和階段 1 的關聯**：若離線期間 refresh token 過期，回線時就得重新登入——登入本身要網路、還可能卡在這條脆弱的路上，所以佇列必須撐過重新登入（見上方必答題 ②）。

### 階段 1 的設計約束（已定，別在實作時重新發明）

- SW 放 `public/`，以 `./sw.js` 註冊（**若採 vite-plugin-pwa，這句作廢，SW 由它產生，見上表**）；**只快取 App 外殼，不快取 Supabase API 回應**（App 已有 `cacheRef`，兩層快取壽命必然對不上，且 SW 那層透明、App 無法誠實標示資料新舊）。離線資料由 App 自己持久化。
- **離線寫入**：客戶端自己產 UUID 當主鍵，上傳用 upsert（同一筆重送結果相同）；上傳失敗保留在佇列、不丟；畫面要看得到「N 筆尚未同步」。這是原 PWA 核可（2026-08-05）**沒有涵蓋的範圍**——原核可只有「離線可讀」，並明文砍掉離線寫入，**那份核可對這裡不成立，要重新核可**。
- **階段 1 的 spec 必須回答（2026-10-12 review 提出）**：① **編輯與刪除怎麼表示**——只靠客戶端 UUID 的 upsert 表達不了刪除；離線刪掉後重放舊的 upsert 會讓那筆復活，順序錯會蓋掉較新的編輯 ② **回線時 refresh token 可能已失效**（離線開機不等 refresh，所以斷網期間可能放到過期）：上傳會 401，佇列卡住，而佇列是那筆資料**唯一的一份**——要定義卡住時的畫面與出路（至少是重新登入後繼續送，且不丟佇列）③ 佇列卡住或上傳部分失敗時，「N 筆尚未同步」要能讓人看出是哪一種。
- **現狀（2026-10-12 查證）**：`public/manifest.webmanifest` **已經是 `display: standalone`、有圖示**，`index.html` 也已掛上，所以 Tally 現在就能加到主畫面當 App 開；**缺的只有 service worker**。使用者至今都從 Safari 分頁開（以為「沒有 PWA 就不能加主畫面」），改用主畫面時會是全新容器、要重新登入一次，資料在 Supabase 不受影響。
- **容器隔離（探針 3 實測）**：離線資料只存在主畫面 App 的容器，**2026-10-13 已定：兩邊都能用、不擋、甲不加提示（見甲 spec Q2）**；主畫面內 Google 登入流程是否可行（先實測再設計）。
- 更新走「下次開啟自動換」；登出時清掉本機快取與佇列。
- **壞掉的 SW 會把舊版鎖在手機上（不可逆）**：階段 1 的 spec 必須回答「如何救回」（至少一條能讓 SW 自己解除註冊的路），並在真機演練過才出貨。
- 這條有 UI（未同步提示、離線指示），實作階段先出設計樣張。

### 階段 1 甲 spec（2026-10-13 起草，**★ 待核可**；使用者 2026-10-13 選定範圍甲）

**範圍**：SW 外殼快取、離線開機、離線寫入佇列（地基）、離線／未同步指示、SW 救援路徑。**不含**：飲食頁離線可讀可寫（乙）、任何訓練功能、動 schema。

**起草時發現（影響範圍讀法，先看這段）**：甲的四項裡兩項在「飲食頁不動」下**沒有內容可放**——
- **本機快取**：離線開機後 Today 要的 profile／targets／weight 全從網路來（探針 1 情境 B：進得去、無資料）。不動飲食頁，就沒有任何東西要快取；supabase-js 自己已把 session 存在 localStorage。
- **寫入佇列**：現有寫入裡，只有 `upsertWeight`（`api.ts:291`，`onConflict: user_id,measured_on`）天然冪等；`createIntake` 靠伺服器 identity id（`api.ts:213` 回 `{id:number}`），`foods`／`profile` 同樣沒有客戶端 id。weight 的入口在 **設定頁**（`Settings.tsx:125` → `App.tsx:587`），不是飲食頁。

所以**甲出貨後，人在健身房：App 打得開、看得到離線指示，但沒有任何資料可看**。它是地基，不是可用功能；可用要等階段 2 帶來訓練資料。

#### 待決（一次問完）

| # | 問題 | 選項與取捨 |
| --- | --- | --- |
| Q0 | **【已定 (a)，2026-10-13：為了未來記運動項目先鋪底】** 佇列在甲裡接誰？（決定出口條件） | **(a)** 佇列只當 `src/lib/` 模組＋vitest＋mutation，第一個真實呼叫者是階段 2。甲的出口＝「能開、離線指示對、佇列有測試」。省工；代價是佇列針對「沒有呼叫者」設計，ordering／刪除的真問題要到階段 2 才露，可能要重寫，且「連線後同步正確」沒有真機驗過。**選 (a) 就要把上方階段表第 1 列的出口條件「能開、能記、連線後同步正確」改寫**，否則表與本節互相矛盾。 **(b)** 把 weight 接上當唯一端到端證明（設定頁離線記體重→入佇列→回線上傳）。真機能驗必答②③（401 卡住、重新登入後續送、未同步指示）；**驗不到必答①**（weight 沒有刪除與編輯順序，只靠 vitest）。**真實成本不只一塊 UI**：`App.tsx:690` 的 `ready = profile && targets && weight` 擋住整個 App，離線時顯示「載入中…」，設定頁**根本進不去**。要做 (b) 必須二選一：**(i)** 新增「部分就緒」開機狀態，讓設定頁在沒有 profile／targets／weight 時也能渲染，且 `App.tsx:590` 的 `user_id` 改取 `session.user.id`（不再來自 `profile.user_id`）；**(ii)** 本機快取那三筆資料——與下方「明確不做：本機快取任何資料表」衝突，等於把範圍推向乙。 **(c)** 連飲食頁一起離線＝乙，不是甲。 |
| Q1 | **【已定：先確認，2026-10-13】** 主動登出時佇列非空怎麼辦？（甲裡尚無呼叫者，佇列恆為空，對話框靠 vitest 守，真正出現要等階段 2） | 直接清（登出＝明確意圖，且 spec 原寫「登出清佇列」）／**先確認並顯示「N 筆尚未同步將遺失」（建議）**：佇列是那幾筆資料唯一的一份，一次誤觸不可逆。 |
| Q2 | **【已定：兩邊都能用，不擋、甲不加提示，2026-10-13】** Safari 分頁與主畫面 App 儲存互不相通，要不要偵測非 standalone 並擋下或提示「請從主畫面開啟」？ | 兩邊連同一份 Supabase 雲端資料，**只有登入狀態與離線暫存各存一份**；離線暫存在甲沒有呼叫者，不相通在甲不傷任何資料。硬擋會斷 Safari 這條登入備援（主畫面遇 Google 二次驗證會失敗）、且 100 條 e2e 的 iPhone 規格瀏覽器全被當成非 standalone，代價大於收益。階段 2 有離線暫存後，再看是否在畫面註明「N 筆待上傳（只存在該容器）」。 |
| Q3 | **【code review 發現，待答】救援頁在主畫面 App 進不去，要不要在設定頁頁尾加一條入口連結？** | 現況：iOS 主畫面沒有網址列，`reset.html` 只能從 Safari 分頁開，而那清的是 Safari 容器（見 AC 7）。**不加（建議）**：主畫面 App 的救援靠 AC 7 ①（deploy 手動觸發，使用者只需開一次 App），不新增 UI，甲維持零新元件。**加**：設定頁頁尾放一條「重置離線快取」連結（約 20 行 UI，要過 DESIGN.md），但必須與第一版 SW 同一個 release 出貨——更早出貨的 SW 沒有這條連結；且 App 卡住時設定頁多半也進不去，實際可救的情境很窄。 |

（SW 工具已 spike 定案，見下方「SW 工具」。）

#### AC（＝將來的測試；Q0 已定 (a)，**16 不做**）

**離線開機與 SW**

1. **首次安裝也能離線開**：在主畫面 App 線上開一次後，**立刻**飛航冷啟動可開。（陷阱：首次造訪時的 JS／CSS 是在 SW 接手前載入的，runtime cache 裡沒有它們；探針頁沒有雜湊資源所以沒遇到。要有 precache 清單或等價機制。）
2. 本機有 session 時，**≤ 2 秒**進入離線模式，不等 refresh（現況約 26 秒）；refresh 退到背景。離線判斷靠實際請求失敗，**不用 `navigator.onLine`**（探針 2）。
3. 離線時的畫面＝**現有的** notice 元件（探針 1 情境 B 實測即此；**甲不新增任何畫面元件**），headline「讀不到你的資料」不變。**實作時修正兩處（見 DESIGN.md v2.51）**：detail 改成兩種原因都講、網路排前面——「連不上後端：先確認 Wi-Fi 或行動網路；網路正常的話，可能是 Supabase 專案被閒置暫停（到 dashboard 按 Resume）」，因為只寫「確認 Wi-Fi」會讓 v2.48 為兩次真實事故寫下的診斷消失；按鈕是「重新載入」不是「重試」（supabase-js 對同一顆 refresh token 有 60 秒冷卻，再撈只會拿到同一個失敗）。AC 2 的快速路徑讓「有本機 session 的離線開機」不再經過開機畫面那句「連不上後端…到 dashboard 按 Resume」，所以不會在健身房給出錯的建議。（2026-10-13 評估：原寫「明確的離線指示」，在 (a) 之下無處可放，不另做元件。）
4. 回線後不需手動重載即恢復（走 supabase-js 既有的 `TOKEN_REFRESHED` 路徑）。
5. SW **只快取同源外殼**，不快取 Supabase REST／Edge Function 回應（既定）。
6. **更新＝新版裝好就接手，接手時頁面重新載入一次**（2026-10-17 推翻原決定「不呼叫 `skipWaiting`、等舊頁面都關了才接手」）：原設計的理由是新 SW 啟用時會清掉舊 precache，舊頁面活著時它要的舊雜湊 lazy chunk 既不在快取、GitHub Pages 上也已 404。當時把「主畫面 App 常駐背景、不一定每天冷啟動，新版可能晚才生效」列為已知代價並接受；**實測不能接受**：iOS 的 Safari 與主畫面 App 都不會真的關掉頁面，「全部舊頁面關閉」等於永遠不發生，使用者的手機兩邊都停在好幾版之前（B1、B2 的介面都看不到）。現在：`skipWaiting: true`、`clientsClaim: true`、`registerType: 'autoUpdate'`，`registerSW.ts` 在 `controllerchange` 時重新載入（僅限註冊當下已有 SW 控制＝更新，第一次安裝不重載），並在回到前景時主動 `reg.update()`。重載的代價：開著的 sheet 與打到一半的字會沒，進行中的訓練與離線佇列在 IndexedDB 不受影響。舊頁面 404 的風險縮到「SW 換手到頁面重載」那一瞬間。
7. **救援路徑（不可逆風險，必須真機演練才出貨）**：① 自我解除版 `sw.js`（`SW_SELF_DESTROY=1`；**deploy.yml 手動觸發勾「self_destroy_sw」即可部署，不必改碼**）。**只清名稱含自己 scope 的快取**——同 origin 的 Gambit 有約 16MB runtime cache，Cache Storage 是 per-origin 共用，vite-plugin-pwa 的 `selfDestroying` 樣板會 `caches.keys()` 全刪，所以自寫（2026-10-13 code review 發現）。② 一個不進 precache、網路優先的 `reset.html`，同樣只清 Tally 的 SW 與快取。**② 在 iOS 主畫面容器沒有入口**（無網址列；從 Safari 分頁開它清的是 Safari 容器的 SW，與主畫面儲存互不相通）：對主畫面 App，真正的救援是 ①（使用者開 App，瀏覽器自己去抓新的 sw.js），② 只對 Safari 分頁／桌面有用，見 Q3。演練＝故意推一版壞 SW，確認手機能靠 ① 救回。
8. **dev server（5500）不註冊 SW**；e2e 的 context 預設 `serviceWorkers: 'block'`（Playwright 1.62 型別已確認有此選項），SW 行為另開專用 spec 用 `allow`，避免快取污染既有 100 條。

**寫入佇列**（`src/lib/`，禁沾 DOM；儲存走介面，IndexedDB adapter 在邊緣）

9. 條目含：操作類型（insert／update／delete）、目標表與鍵、**客戶端產生的 id**、建立時間、所屬 `user_id`、嘗試次數、最後錯誤。
10. **重送冪等**：同一條目送 N 次，結果等於送一次。
11. **卡住要分類並讓人看得出是哪一種**（必答③）：離線中／登入已失效需重新登入／伺服器拒絕（4xx 非 401）／暫時失敗會重試。（甲裡佇列無呼叫者：**分類邏輯在 `src/lib/`、由 vitest 守；畫面呈現移到階段 2**，那時才有真實流程能觸發。）
12. **token 失效不丟佇列**（必答②）：回線時 401 → 佇列保留 → 重新登入後繼續送。
13. **登出分流**：`handleSignOut`（使用者主動）→ 清佇列與本機快取（依 Q1）；`App.tsx:622` 那條非主動的 `SIGNED_OUT` → **保留佇列**，登入頁顯示「N 筆尚未同步」。現行程式把兩者當同一條，要先拆。不同 `user_id` 登入 → 不上傳、不覆寫，提示。
14. **同一目標的條目依建立順序重放；刪除是 tombstone**，排在它之後的舊 upsert 不得讓那筆復活（必答①）。選 (b) 時只靠 vitest 守，真機驗不到——見 Q0。
15. 只在 App 在前景（開啟或回到前景）時送，**不依賴 Background Sync**（Safari 是否支援這輪沒查證，設計上不用）。
16. （(b) 才有）離線時設定頁**進得去**（需要「部分就緒」開機狀態，見 Q0(b)），離線記體重：畫面立即反映、顯示未同步；回線上傳後 Supabase 該日只有一列、值是最後一次輸入。`user_id` 取自 `session.user.id`。

#### SW 工具（spike 已完成 2026-10-13，**採用 vite-plugin-pwa 2.0.0**）

探針 SW（`public/_probe/sw.js`）是 runtime cache，**解不了 AC 1**（首次造訪的資源在 SW 接手前就載入了）；所以要 precache 清單。spike 在脫離分支的 worktree 做，主 repo 的 `package.json` 未動。**實測（headless WebKit、build 後的 preview、真的關掉伺服器）**：

| 項目 | 結果 |
| --- | --- |
| scope／落點 | `dist/sw.js` 在根目錄；以 `/tally/sw.js` 註冊、不帶 scope 選項，得 scope `…/tally/`。precache 的 URL 為相對路徑，不受 `base` 影響 |
| AC 1 首次安裝後離線開 | 註冊→再導覽被接管→關伺服器→重載，App 正常開機（顯示登入頁）。precache 在 install 階段一次抓齊 |
| 預設行為的三個坑（設定已修） | ① 預設 glob 不含 `.woff2`，離線會掉字型→加進 `globPatterns` ② 預設會把 `public/_probe/` 吃進 precache→`globIgnores` ③ 預設把**所有導覽**回 `index.html`：不在 precache 的頁面會被吞成 App。對照組實測：救援頁 `reset.html` 不進 precache 時，無排除清單回「Tally」、加 `navigateFallbackDenylist` 後回真頁面；`_probe/` 同理。**救援頁必須同時「不進 precache」與「列入 denylist」，缺一不可** |
| AC 6 更新（2026-10-17 改） | 新版 `installed` 後立刻 `activated` 並接手；接手時頁面自己重新載入成新版（舊頁面記憶體裡的東西消失）；只剩一個 precache 名稱；第一次安裝接手不重載。設定：`registerType: 'autoUpdate'`、`skipWaiting: true`、`clientsClaim: true`。原 AC（停在 waiting、只有 `SKIP_WAITING` 訊息才換）作廢 |
| AC 5 | 無 runtime route，Supabase 請求不被攔 |
| 依賴成本 | 頂層 `node_modules` 317→462；`npm audit` 20 筆→20 筆（完全相同）。全是 build-time，不進產物；產物多 `sw.js`（約 1.6 KB）與一個 `workbox-*.js` |

**落地設定**：`registerType: 'autoUpdate'`、`injectRegister: false`（註冊由 App 自己呼叫，dev 與 e2e 不註冊）、`manifest: false`（沿用 `public/manifest.webmanifest`）、`globPatterns` 含 `woff2`、`globIgnores: ['_probe/**']`、`navigateFallbackDenylist: [/\/_probe\//, /\/reset(\.html)?(\?|$)/]`（比對對象是 pathname＋search，帶 query 或無 `.html` 的網址都要擋，否則救援頁被它要救的 SW 吞成 App 首頁）、`ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/]`（index.html 以 `?v=6` 引用 favicon／manifest／apple-touch-icon，不加的話離線時這三個請求落到網路而失敗）、`cleanupOutdatedCaches: true`、`skipWaiting: true`、`clientsClaim: true`。**不用插件的 `selfDestroying`**，改自寫 `KILL_SW`（原因見 AC 7 ①）。**已知限制**：`maximumFileSizeToCacheInBytes` 預設 2 MiB，主 bundle 目前約 823 KB；超過時 workbox 只警告並略過該檔、離線開機會白屏（e2e 第 1 條會抓到）。AC 6 的 e2e 只守「新版不自動接手」，新舊 precache 清單相同，**沒有**覆蓋「新版啟用時清掉舊雜湊檔」那一半，該風險由 workbox 的舊快取留到新版啟用才清的語意保證。

**採用理由**：SW 屬不可逆風險區，清理舊版與版本管理自己重造不划算；手寫方案這輪沒實作比較。

**仍未驗**：① **真機（iOS）**上 precache 行為是否與 headless 一致——AC 1、7 的真機演練照舊要做 ② `_probe/` 自己的窄 scope SW 與根 SW 並存沒實測（探針 2026-10-19 後退役，不另測）；`public/_probe/` 在 **2026-10-19 之前不動**。

#### 驗證方式

- **vitest**：佇列核心 AC 9–14，**照專案慣例做 mutation**（冪等、重放順序、tombstone 各改回去要紅）。
- **e2e**：新增 SW 專用 spec。離線＝**真的關掉 preview server**（`setOffline` 在 WebKit 會丟內部錯誤）。**限制**：現有 stub 是 `page.addInitScript` 覆寫 `window.fetch`（`e2e/stub.ts`），Supabase 請求不出頁面，所以要新增一個「後端連不上」的 stub 模式才能走真正的失敗路徑；這個 spec 驗外殼與離線開機，**驗不到真實 Supabase 的失敗**。
- **真機**：飛航演練腳本（開、記、關飛航、對 Supabase 筆數）＋救援演練（AC 7）。headless WebKit 不等於 iOS，**以真機為準**。

#### 明確不做（甲）

- 飲食頁離線讀寫（乙）；本機快取任何資料表；訓練表與任何 schema 變動（動 schema＝先核可）；背景同步；為 SW 做版本橫幅／強制更新 UI。

#### ★ 核可後的順序

1. ✔ SW 工具 spike（2026-10-13 完成，結果見上）
2. ~~設計樣張~~（2026-10-13 評估後免做：(a) 之後甲沒有新元件。離線指示、「N 筆未同步」、卡住四種文案的樣張**移到階段 2 spec**，並須同時改寫 DESIGN.md「寫入失敗（記一筆）」那列的「不做離線佇列（YAGNI）」——階段 2 佇列接上就推翻它，照通則 ⑫ 明文改，不留矛盾）
3. SW＋救援頁＋e2e 的 `serviceWorkers: 'block'` 設定
4. ✔ 離線開機快速路徑（AC 2–4）、登出分流旗標（AC 13 的訊息分流；佇列的保留／清除在步驟 5 接上）——2026-10-13 完成，見 DESIGN.md v2.51
5. ✔ 佇列核心＋vitest＋mutation——2026-10-13 完成，`src/lib/queue.ts`＋`queue.test.ts`（70 條）。**刻意不在這步**：IndexedDB adapter、真正的 Supabase sender、`App.tsx` 的實例與登出接線（`signOutPlan`／`clear` 已備好）——甲裡沒有呼叫者，現在寫只是一份驗不到的碼，留給階段 2 第一個呼叫者；sender 的契約已寫在 `queue.ts` 的 `Sender` 註解
6. ~~weight 接線與設定頁指示~~（Q0 已定 (a)，不做）
7. 真機演練（含壞 SW 救援）
8. 回寫 notepad Priority Context、四份測試條數文件（甲無 UI 變動，DESIGN.md 不動）

### 階段 2 spec（2026-10-13 起草，**★ 待核可**；核可前不動碼、不動 schema）

**範圍**：重訓記錄、課表、有氧記錄、動作庫（預填＋要點）、歷史、離線寫入與離線可讀（**接上階段 1 甲的佇列，第一個真實呼叫者**）、同步狀態指示。**不含**：組間計時器、RPE、GIF／動作圖庫、1RM／趨勢圖（階段 4）、任何熱量計算、課表的週期排程。

**使用者裁決（2026-10-13 訪談）**：① 有氧**依類型決定欄位**（2026-10-13 第二輪回饋修正）：跑步機坡度健走記分鐘、速度、坡度；有氧拳擊記分鐘、**預估熱量**（使用者自填，只存不算、留給未來推估）；**兩種都沒有備註** ② 有氧種類＝跑步機坡度健走、Switch 2 有氧拳擊（在家做，不在健身房）；現在只有這兩種，不做「新類型」入口 ③ RPE 不做、**也不做任何「備註」欄**——動作只有一個「要點」文字欄，要寫要領或當備忘都用它 ④ 動作庫先預填，另加「要點」欄（在器材前看的提示，取代 Gymwork 的 GIF 指南；GIF 無所謂） ⑤ 歷史紀錄階段 2、1RM／趨勢階段 4 ⑥ 「用歷史推估該吃多少」是**另一條獨立的 journey**（notepad MANUAL 續點 7），階段 2 先做、產生資料。⑦ **課表要做**（Gymwork 的用法：開始訓練時可空白一個個加動作，或選預先建好的課表；使用者有菜單 A、B 輪替，所以「複製上次」會帶出另一份、不夠用，原案作廢，課表從階段 3 提前） ⑧ **肌群分七類，沿用 Gymwork**：胸部、背部、下半身、肩膀、手臂、腹肌、其他。⑨ **開始訓練時組數、次數、重量一律預填上次實際完成的值**，再依當次表現加減；課表只在「沒做過」時提供預設。⑩ **複製要有**：訓練存成課表、複製課表，都不用重頭一個個輸入。

#### 資料表（**動 schema＝先核可**；DDL 草案，核可後由使用者在 Supabase Dashboard SQL Editor 執行，我提供回滾 SQL）

```sql
-- 階段 2：訓練記錄。主鍵 uuid 由客戶端產生、不給 default（離線寫入冪等的前提）；
-- 與既有四表的 identity id 不同，是刻意的。
create table exercises (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  muscle_group text not null check (muscle_group in
                 ('chest','back','legs','shoulder','arms','core','other')),   -- 胸部／背部／下半身／肩膀／手臂／腹肌／其他（沿用 Gymwork）
  tips         text,                                   -- 動作要點：唯一的文字欄（沒有「每次訓練的備註」），訓練中可直接改
  archived     boolean not null default false,         -- 同 foods：不真刪，歷史才不爛
  created_at   timestamptz not null default now()
);

create table routines (                                  -- 課表（菜單 A、B…）
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  archived   boolean not null default false,             -- 同 exercises：不真刪
  created_at timestamptz not null default now()
);

create table routine_exercises (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id  uuid not null references routines(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete restrict,
  position    smallint not null check (position >= 0),
  target_sets smallint not null default 3 check (target_sets between 1 and 20),   -- 只在該動作沒有歷史時才用
  target_reps smallint check (target_reps is null or (target_reps between 1 and 999)),  -- 同上
  created_at  timestamptz not null default now()
);
create index routine_exercises_routine_idx on routine_exercises (routine_id);

create table workouts (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  performed_on date not null,                          -- 本機日期（同 eaten_on）；跨午夜算開始那天
  started_at   timestamptz not null,
  ended_at     timestamptz,                            -- null＝進行中
  routine_id   uuid references routines(id) on delete set null,   -- 這次照哪份課表做的；空白開始為 null
  created_at   timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index workouts_user_date_idx on workouts (user_id, performed_on);

create table workout_exercises (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_id  uuid not null references workouts(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete restrict,
  position    smallint not null check (position >= 0),
  created_at  timestamptz not null default now()
);
create index workout_exercises_workout_idx  on workout_exercises (workout_id);
create index workout_exercises_exercise_idx on workout_exercises (exercise_id);

create table workout_sets (
  id                  uuid primary key,
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_exercise_id uuid not null references workout_exercises(id) on delete cascade,
  set_no              smallint not null check (set_no >= 1),
  weight_kg           numeric(6,2) not null check (weight_kg >= 0 and weight_kg <= 1000),
  reps                smallint not null check (reps >= 0 and reps <= 999),
  done                boolean not null default false,
  created_at          timestamptz not null default now()
);
create index workout_sets_we_idx on workout_sets (workout_exercise_id);

create table cardio_sessions (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  performed_on date not null,
  kind         text not null check (length(btrim(kind)) > 0),     -- 現有兩種：跑步機坡度健走／有氧拳擊；畫面依 kind 決定顯示哪些欄位（設定放客戶端，不另開表）
  minutes      numeric(5,1) not null check (minutes > 0 and minutes <= 1440),
  speed_kmh    numeric(4,1) check (speed_kmh is null or (speed_kmh > 0 and speed_kmh <= 40)),      -- 只有走路類型填
  incline_pct  numeric(3,1) check (incline_pct is null or (incline_pct >= 0 and incline_pct <= 40)), -- 只有走路類型填
  est_kcal     numeric(6,1) check (est_kcal is null or (est_kcal >= 0 and est_kcal <= 10000)),       -- 只有拳擊類型填；使用者自填的預估，只存不算
  created_at   timestamptz not null default now()
);
create index cardio_user_date_idx on cardio_sessions (user_id, performed_on);

alter table exercises         enable row level security;
alter table workouts          enable row level security;
alter table workout_exercises enable row level security;
alter table workout_sets      enable row level security;
alter table cardio_sessions   enable row level security;
alter table routines          enable row level security;
alter table routine_exercises enable row level security;
create policy owner_all on routines          for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on routine_exercises for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on exercises         for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on workouts          for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on workout_exercises for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on workout_sets      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on cardio_sessions   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

**設計說明**：① 客戶端產 uuid、不給 default，離線寫入才能用 upsert 冪等。② **預填動作用確定性 id**（由 user_id＋動作 key 雜湊產生）：Safari 分頁與主畫面兩個容器各自預填，也只會 upsert 到同一列，不會出現兩份。③ `exercises` 用 `on delete restrict`＋`archived`，同 `foods`。④ `workouts` 刪除會 cascade 子列；離線時只排一條 delete，畫面要連帶隱藏子項。⑤ 刻意不加 `unique (workout_exercise_id, set_no)`：離線編輯／重排會短暫撞號，排序用 `set_no`、`created_at`。⑥ `est_kcal`（畫面稱「預估熱量」）只存不算，欄名刻意不叫 `burned`／`calories_burned`，避免日後被當成可信的消耗量。⑦ 有氧自成一張表，不併入 sets：欄位性質不同（沒有組、沒有重量）。⑧ 課表（`routines`／`routine_exercises`）與 `exercises` 一樣用 `archived` 不真刪；`workouts.routine_id` 記這次照哪份課表做的，之後才看得到「菜單 A 的歷史」，課表被刪時設為 null；課表只存「動作、順序、預設組數與次數」，**不存重量**——重量永遠取自該動作上次實際完成的值。

**預填動作（16 個，名稱＋肌群；搜尋確認的核心 6 個＋一般健身房配置）**：

- 下半身（legs）：腿推舉、腿屈伸、腿彎舉、小腿提踵、髖外展、髖內收
- 背部（back）：滑輪下拉、坐姿划船、背伸展機
- 胸部（chest）：坐姿胸推、蝴蝶機夾胸
- 肩膀（shoulder）：肩推、反向蝴蝶機
- 手臂（arms）：二頭彎舉（機械）、三頭下壓（滑輪）
- 腹肌（core）：腹部捲曲機
- 其他（other）：（無）

預填**不含課表**：菜單 A、B 由你自己建（或訓練後「存成課表」），我不替你猜你的菜單內容。`要點` 欄一律留空由使用者自己寫（我不替你寫動作要領，寫錯的建議比沒有更糟）。

#### AC（＝將來的測試）

**動作庫**

1. 該帳號沒有任何動作時預填上列 16 個；確定性 id，兩個容器各自預填不重複。
2. 可新增、改名、改肌群、封存／取消封存；封存的動作不進選單，但歷史仍顯示它的名稱；不提供真刪。
3. 每個動作有「要點」欄（純文字），是動作**唯一**的文字欄、沒有「每次訓練的備註」；**訓練中只能閱讀**，點要點塊的筆圖示開「編輯動作」sheet（與動作庫同一張）才能改，不在卡片上就地編輯；兩處改的是同一欄（跟著動作走，下次訓練一樣看得到）。

**重訓**

4. 開始一次訓練有兩個入口：**空白開始**（一個個加動作，可調順序、可移除），或**選一份課表開始**（帶入該課表的動作與順序；每個動作的組數、次數、重量都預填該動作**上次實際完成**的數值，沒有歷史才用課表設定的預設；不帶打勾）。開始後可依當次表現加減組數與數值。**[追加]**：課表原排在階段 3，提前理由見下。
4a. 課表：可建立（名稱＋依序加入動作，每個動作可設「沒有歷史時」的預設組數與次數）、改名、增刪動作、調順序、封存／取消封存。**兩種複製**：①**把一次已完成的訓練「存成課表」**（帶入動作、順序與當時的組數與次數）；②**複製課表**（名稱預設「原名稱 複本」，帶入動作、順序與預設值）。複製只複製結構，**不複製重量**。
4b. 訓練記下它照哪份課表做的（`routine_id`）；之後可依課表看歷史。
5. 每個動作的每一組：重量（kg，可小數，步進 0.5）、次數、打勾。開始訓練時，**組數、次數、重量一律預填該動作上次實際完成的數值**（不論空白開始或從課表開始），使用者再依當次表現加減；沒有歷史才用課表的預設組數與次數。新增一組時同樣預填上一組的值。課表本身**不存重量**。
6. （已刪：不做「該次備註」，要點欄一個就夠；2026-10-13 使用者裁決。編號保留。）
7. 頂部顯示：時長、**總訓練量＝已打勾各組 重量×次數 的總和**、已完成組數（驗算：腿推舉 60×12×3＝2160）。
8. 結束訓練＝寫 `ended_at`；已結束的可重新打開編輯；可刪除整次訓練（需確認）。
8a. **補記過去日子**：日期元件選到過去的日子再開始訓練＝記在那一天，**不跑計時**；完成時手填「時長（分鐘）」，可略過。存法：`started_at`＝該日 12:00（本機時間）、`ended_at`＝`started_at`＋填的分鐘（略過則等於 `started_at`）；`performed_on`＝選的那天。（原案是補記也跑計時，使用者裁決改手填。）
9. 一天可以有多次訓練；進行中（`ended_at` 為空）的訓練在 App 重開後仍在，畫面提示可繼續。

**有氧**

10. 新增一筆（**sheet**，記在目前選的那天）：類型二選一，**類型決定欄位**——跑步機坡度健走＝分鐘（必填）＋速度 km/h＋坡度 %（選填）；有氧拳擊＝分鐘（必填）＋預估熱量 kcal（選填）。**沒有備註欄**，也不放「新類型」入口。可編輯、刪除。
11. **預估熱量只存不算**：不進目標、剩餘熱量、實測維持熱量的任何計算；畫面標籤是「預估熱量」，不稱「消耗」。
12. 數值守門：分鐘 >0 且 ≤1440、速度 0–40、坡度 0–40、預估熱量 0–10000；範圍外要擋並說明，不靜默截斷。

**歷史**

13. 每個動作可看過往每次：日期、各組 重量×次數（只含已打勾），由新到舊。
14. 訓練與有氧依日期列出，點進可編輯。

**離線與同步**（接階段 1 甲佇列；契約見 `queue.ts` 的 `Sender` 註解）

15. 飛航模式下完整做完一次：開 App → 開始訓練 → 記組、打勾 → 結束 → 記一筆有氧；動作庫、要點、上次的值來自本機快取，不依賴網路。
16. 回線後自動上傳（前景、`online`、`TOKEN_REFRESHED` 觸發）；Supabase 上的列與離線記的一致、不重複；**子列不得先於父列上傳，也不得因父列尚未到而被標成「被拒絕」**（需對佇列核心加「父列依賴」）。
17. 畫面看得到「N 筆尚未同步」並分辨原因：離線中／登入已失效需重新登入／被伺服器拒絕／暫時失敗會重試；被拒絕的有「放棄這筆」出路。
18. 讀取時以伺服器資料為底、疊上佇列中尚未同步的變更（剛記的馬上看得到，重開也不消失）；被刪的列與其子列不出現。
19. 主動登出時佇列非空先確認並顯示筆數（`signOutPlan`）；被動掉線保留佇列、重新登入後續送；不同帳號登入不上傳也不覆寫，並提示有別的帳號的未同步資料。
20. 本機寫入失敗（容量、隱私模式）要明確告知「這筆沒有存下來」，不靜默吞掉。

**驗證**

21. 純邏輯在 `src/lib/`、禁沾 DOM：總訓練量、預填上次值、疊加未同步變更、確定性 id、父列依賴；vitest＋mutation。
22. Sender 契約以契約測試守：insert／update 0 列判失敗、delete 0 列算成功、insert 為 upsert、signal 傳給 fetch。
23. e2e：真的關掉伺服器記完一次、回線後上傳；真機：飛航記一次、回線後對 Supabase 筆數與內容。

#### 與原計畫的差異（請確認）

- **課表從階段 3 提前到階段 2**（取代原案「以上次訓練為範本」）。理由：使用者實際用法是菜單 A、B 輪替，開始訓練時選預先建好的課表（Gymwork 就是這樣）；「複製上次」會帶出另一份、不夠用。階段 2 的出口條件是「並行 1–2 週後仍夠用」，沒有課表過不了。**仍留在階段 3 的**：課表的週期排程、組間計時器。（複製課表原也排階段 3，使用者說「複製感覺不錯、不用一個個 KEY」，一併提前。）
- 多兩張表（`routines`、`routine_exercises`），`workouts` 多一欄 `routine_id`。
- 有氧自成一張表，不放進 sets。
- 預填走**客戶端確定性 id**，不做伺服器端 seed。
- 主鍵用 uuid、不給 default，與既有四表的 identity 不同。

#### 明確不做（階段 2）

RPE；GIF 與動作圖庫；組間計時器；課表的週期排程；1RM 與趨勢圖；任何熱量計算；寫入 Apple 健康；多裝置同時編輯的衝突解決（單人使用，伺服器資料為底＋疊上本機未同步變更，不做合併 UI）。

#### 已知風險

- **佇列核心要改**（父列依賴，AC 16）：`queue.ts` 有 mutation 測試保護，改完要重跑整組。
- **兩個容器各有一份「尚未上傳」的離線資料**（Safari 分頁與主畫面，Q2 已定不擋）：**連線時任何入口都直接寫進同一個資料庫，沒有差別**；風險只在離線、還沒上傳那段時間——那些資料只存在記錄當下那個入口，另一個入口看不到，要回到原入口（且在線上）才會補傳。Safari 分頁久沒互動（七天）網站資料可能被 iOS 清掉，主畫面 App 不受此限，所以**離線記錄建議用主畫面 App**。預填用確定性 id 避免重複。不做擋人機制。
- **iOS 儲存是否被清**：主畫面 App 不受七天規則（WebKit 2020 年的聲明，之後有無變動沒再查證）；佇列的「未同步」警示是保險。
- **錄影沒拍到的細節**（單位是否只有 kg、有沒有單邊重量或自重動作）：階段 2 先只做 kg 與總重量。
- **UI 範圍大**：訓練頁、課表、有氧、動作庫、同步指示至少五個畫面，且要改底部導覽；先出樣張再核可，不直接寫。

#### ★ 核可後的順序

1. 核可本 spec（含 DDL）
2. 設計樣張（訓練頁／課表／有氧／動作庫／同步指示，與 DESIGN.md 對齊）核可
3. 使用者在 Dashboard 執行 DDL；回滾 SQL 一併提供
4. `src/lib/` 純邏輯＋佇列「父列依賴」＋vitest／mutation
5. IndexedDB adapter、Supabase sender（契約測試）、佇列實例與 `App.tsx` 登出接線
6. UI（照樣張）
7. e2e＋全量
8. 真機：飛航記一次、回線對帳
9. 回寫 DESIGN.md（含改寫「不做離線佇列（YAGNI）」那列）、條數文件、notepad Priority Context
10. 與 Gymwork 並行 1–2 週 → 停用

### 訓練中畫面改版（2026-10-15 使用後回報；**2026-10-17 使用者核可，併入 B2 實作**）

**來源**：使用者實際用過 v2.59 之後的回報（notepad MANUAL 第 2、3、5、6、7 點，以及 2026-10-15 的第二輪回饋：收合列資訊、勾的邏輯、新增／刪組、要點位置）。**樣張**：曾有可操作的 `training-session-v2.html`（打勾、全部完成、組編輯 sheet、同步、排序、⋯ 選單；WebKit 實點驗證 33 項全過），**2026-10-16 已刪（從未進 git，無法撿回）**；決定都已寫在本節，實作時以本節為準。
**範圍**：訓練中整頁（`TrainingSession`）的組編輯方式、動作卡版面（卡片頭資訊、勾的邏輯、新增／刪組）、動作排序，以及這頁的動效。**不含**：第 1 點（有氧併入動作；牽涉 schema 與 `cardio_sessions` 資料遷移，另案先給 spec）。**不動 schema**：排序寫既有的 `workout_exercises.position`，其餘都是既有欄位的 update。

#### 與原決定的差異（請確認）

- **推翻 2026-10-13 樣張回饋「點輸入框在該組下方展開調整列」**：改成點重量／次數開「組編輯 sheet」。使用者回報原地展開把整頁撐很長。依容器原則（短、單一目的、做完回原頁＝sheet）本來就該是 sheet。
- **推翻「要點一律整塊顯示、筆圖示開編輯」**：要點改放卡片頭名稱正下方（展開時，最多兩行），不再另占一個色塊；編輯入口移進卡片頭的 ⋯ 選單。AC 3（訓練中只能看、改要點要開編輯 sheet）**仍成立**。
- **推翻 v2.54 卡片頭的「上次 60 kg × 12 × 3」**：上次做多少只在組編輯 sheet 裡看（設定這一組時才需要對照）。收合時的卡片頭改看**進度與下一組**。
- **推翻「勾＝空心圈變實心圈」**：圈裡一直有勾（未勾淡灰、已勾綠實心）；「全部完成」是同一種勾的雙勾版本，放在「完成」欄欄頭。
- **卡片底部整列拿掉**：「新增一組」變成接在最後一組下方的整列；「移除這個動作」收進 ⋯。
- **新增**：同步到後面的組（AC 3）、全部完成（AC 4）、新增與刪除一組（AC 6、7）、訓練中排序（AC 8）。

#### AC（＝將來的測試）

1. **組編輯 sheet**：點某一組的重量或次數，開 sheet（標題「動作名 · 第 N 組」；**標題下面不放「還沒完成／已完成」之類的狀態字**，使用者 2026-10-15 嫌多餘）。最上面是**「上次」**：最近一次做這個動作的各組（`lastCompletedSets`）顯示成一排籤（重量 × 次數），**每一顆都能點，點了就把那組的重量與次數一起套到目前這一組**（寫入沿用 `workout_sets` 的 update，一筆）；目前這一組對到的那顆標綠；沒有紀錄就寫「沒有紀錄」。下面重量與次數各一排 ±（重量 −5／−2.5／＋2.5／＋5，次數 −5／−1／＋1／＋5，沿用現值），**點中間的大數字才叫出鍵盤**（使用者 2026-10-15 裁定）；每次 ± 或打字**立即寫入**，背景頁該列同步更新，沒有「儲存」鈕。不合法的輸入放回原值。含輸入欄位，守 `repositionInputs={false}`＋`--vvtop`（DESIGN v2.32–v2.35）。
2. **關閉與焦點**：X、「完成」、下滑、Escape、點 scrim 都能關；關閉後焦點回到被點的那顆重量／次數鈕。
3. **同步剩餘組數**：sheet 底部一列**全部左右並排**（與全站「次要在左、主要在右」一致）：🗑 刪除（只有圖示的紅色方鈕，最左）、「同步剩餘 N 組」（次要鈕）、「完成」（主要鈕，關 sheet）。「同步剩餘 N 組」把**目前這一組的重量與次數**套到同一個動作**後面所有還沒打勾的組**，已打勾的不動；N＝這些組的數量，沒有剩餘組時 disabled 並寫「沒有剩餘組」。一次 `enqueueMany`。按下後鈕上顯示「已同步 ✓」、背景頁被改的列淡綠閃一下。**用詞統一用「剩餘組數」。**
4. **勾的邏輯**：每組的圈裡**一直有勾符號**（未勾＝淡灰、已勾＝綠實心）。**「全部完成」是同一種勾、換成雙勾符號，放在「完成」欄的欄頭**，狀態由各組推出來（全部勾了才綠實心）。按下：未全勾→把所有未完成的組打勾（一次 `enqueueMany`）；全勾→全部取消。按下當下鈕就換狀態，逐組由上往下跑（間隔 60ms）；進行中再按從當前狀態接續。`aria-pressed` 與名稱（「全部完成」／「取消全部完成」）隨狀態切換。（只在動作卡展開時有，使用者 2026-10-15 同意。）
5. **卡片頭固定四件事、每張卡一模一樣**：左握把、名稱、**ⓘ 要點鈕（每張卡都有，沒寫過要點的是淡色，不隱藏）**、⋯ 選單；右側的箭頭、ⓘ、⋯ 在所有卡上**左右位置必須一致、上下對齊**（隱藏 ⓘ 會讓欄位對不齊，使用者 2026-10-15 明講）。名稱下面一行：**展開時＝肌群；收合時＝進度**——小圓點一組一顆（做完的實心）加「下一組 W kg × R」，全部做完顯示「全部完成」；**不顯示分數**，只有組數超過 8、圓點省略時才補「d/n 組」。**卡片頭不再出現「上次」。** **點 ⓘ 在卡片頭下方展開要點面板**（柔和底色塊、完整要點、右下「編輯要點」；沒寫過的顯示「還沒有要點」與「新增要點」；收合的卡也能直接點開；高度走 spring；再點收起）。浮在內容上面的彈出卡已被使用者否決（太醜）。排序開始時所有卡與面板一併收起。
6. **新增一組**：接在最後一組下方的整列（虛線框、全寬），新組沿用最後一組的重量與次數（沿用 `addSetOps`）；新列由上方淡入。
7. **刪除一組**：**主要路徑是在那一組的列上左滑，露出紅色圓鈕，點了才刪**（與飲食頁品項同一套手勢與同一顆紅圓鈕：`motion` drag 手刻、方向鎖、橡皮筋、放手用速度投射決定開或關、吸附走 spring）。**只露出、不做「滑到底直接刪」**（飲食頁的滑到底是配 undo 才敢做，這邊沒有 undo）；左滑＋點紅鈕已是兩個動作，**不再多跳確認框**（DESIGN 既有決定：「左滑露出再點刪除本來就是兩個動作，彈窗只是多包一層」）。列開著時點一下＝關掉，不觸發底下的勾或開 sheet；同時只有一列是開的；垂直捲動優先（方向鎖）。排序只能從卡片頭握把拖，組列不可拖，所以兩個手勢不衝突。**備用路徑（沒有手勢的人）**：組編輯 sheet 底部最左的 🗑（見 AC 3）——DESIGN 的原則是手勢對鍵盤與讀屏是死路，刪除一定要有非手勢入口；因為它一下就刪，**已完成的組要先確認**（現有 `ConfirmDialog`，兩顆鈕左右並排）。只剩一組時兩條路都不能刪（要拿掉整個動作用 ⋯ → 移除）。寫入是單筆 `delete`；**不重排 `set_no`**（畫面的組號本來就用序號、`workout_sets` 對 `set_no` 沒有唯一約束，`addSetOps` 取 max+1）。離線可刪，回線上傳。
8. **訓練中排序**：卡片頭左側握把是唯一的拖曳來源（同課表編輯頁 v2.57：`@dnd-kit/react`，握把是 button，鍵盤聚焦後可排序並有朗讀）；拖起時**其他卡收合**（收合列仍看得到各自進度）、被拖卡放大 2%＋陰影；放手寫回 `position`——**只寫位置真的變了的那幾筆**，一次 `enqueueMany`。**拖曳範圍必須限制在清單區內**：不能拖進上方的時長統計區後面、也不會掉到底部列下；拉到邊界之外有橡皮筋阻力（最多露出約 14px，排序時捲動區不裁切，露出的部分畫在統計區上面），放手回到範圍內。**這條是使用者 2026-10-15 試樣張時發現的：之前可以拖到統計區後面。實作時用 context7 查 `@dnd-kit/react` 的 modifiers（限制在容器內），不憑印象。**離線可排，回線上傳。進行中與已完成的訓練都能排。
9. **⋯ 選單**：含「編輯要點」（沒寫過要點時寫「加要點」）、「移除這個動作」（沿用現有確認：已有打勾的組才問）。
10. **動效**：照下表；沒列到的不加動畫。尊重 `prefers-reduced-motion`（位移與縮放改 ≤120ms 淡入淡出）。
11. **不退步**：離線佇列、未同步 sheet、預填上次值、完成訓練、補記流程的既有行為與 e2e 全數維持。

#### 動效規格

| 時刻 | 做什麼 | 時長／曲線 |
| --- | --- | --- |
| 按任何按鈕 | 按下當下 `scale(.97)`；打勾圈 `.9` | 100ms ease-out（`--dur-fast`） |
| 組打勾 | 圈裡的勾由淡灰變白、圈填成綠實心、數字由淡變深；圈 `.86→1`，**不彈跳** | 顏色 160ms；圈 200ms `cubic-bezier(.23,1,.32,1)` |
| 全部完成（欄頭雙勾） | 按下當下鈕就換狀態，再由上往下逐組，間隔 60ms | 每組同上；鈕本身 200ms 落定 |
| 新增／刪除一組 | 新增：新列由上方 8px 淡入；刪除：該列淡出並左移 12px | 新增 220ms ease-out；刪除 160ms ease-in |
| 卡片頭第二行換內容 | 展開／收合或進度改變時，文字下移 35% 淡入 | 160ms ease-out |
| 動作卡收合／展開、要點面板 | 高度走 spring（ζ .9、response ≈ .35：stiffness 322／damping 32.3）＋內容淡出入、箭頭旋轉 | spring；淡出 160ms；箭頭 160ms |
| 組編輯 sheet 開／關 | 開：spring（ζ .8、response .3：stiffness 439／damping 33.5，有一點回彈）；關：臨界阻尼（stiffness 300／damping 34.6）；scrim 隨位置淡入淡出 | 下滑手勢同一套：1:1 跟手、往上拉有阻力、放手用速度投射決定關或回 |
| ± 數字 | 翻動（下移 35%→歸位、淡入） | 120ms ease-out |
| 同步到後面的組 | 鈕換「已同步 ✓」；被改的列淡綠閃 | 鈕 160ms；列 700ms，間隔 50ms |
| 排序 | 其他卡收合 160ms；讓位 220ms；放手吸入 | 讓位 `--ease-sheet` |
| ⋯ 選單 | 從按鈕位置縮放長出（`scale(.95)`，永不從 0 開始） | 開 160ms／關 100ms |
| 統計格數字 | 變動時翻一下 | 160ms |
| **刻意不加** | 輸入框打字、計時器跳秒、分頁切換、鍵盤操作、列表捲動 | — |

**使用者試樣張的回饋（2026-10-15）**：**只有拖曳排序有 iOS 感；sheet 開關、動作卡展開收合、新增一組原本「還好」（固定時長曲線）。試過 spring 對照版後，使用者選定 spring**（「感覺很不錯」）。結論：**手勢與開關類一律 spring，不用固定曲線**；高頻的小回饋（按下縮放、顏色）維持短曲線。**這牽動 sheet 的實作**：vaul 的開關是 CSS 過渡，做不出 spring，所以**組編輯 sheet 要自製（用現有的 `motion`，仿樣張的開／關／下滑手勢）**；其他 vaul sheet 先不動，但「全站精緻度盤點」要把所有 sheet 收斂成同一個 spring sheet 元件，否則兩種手感並存。

**限制與誠實的取捨**：
- **自製 spring sheet 要自己處理 iOS 鍵盤**：vaul 的 `repositionInputs`／`usePositionFixed` 這套（DESIGN v2.32–v2.35 反覆修過）換掉之後得自己接 `visualViewport`。**先例**：Settings 的手刻 sheet 已經用 `--kb`／`--vvtop`（見 `app.css` 的 `.sheet`）。含輸入欄位的 sheet 必須真機驗。
- **觸覺回饋不做**：iOS Safari 沒有標準震動 API（`navigator.vibrate` 在 iPhone 無效）；唯一手法是非標準的 `<input type="checkbox" switch>`，社群資料指出 iOS 17.4 起可用、**有資料說 iOS 26.5 被封（未查到 Apple／WebKit 原文）**。視覺回饋是唯一依賴；真機確認 iOS 版本後再決定要不要當選配。
- **收合動畫用 CSS grid 列高（`1fr↔0fr`）**，不是 transform／opacity；在動作卡數量少（個位數）時成本可忽略，若真機掉幀再改 `motion` 的 height 動畫。
- **Gymwork 的實際行為我查不到官方說明**，同步功能依使用者描述設計；使用者試過覺得手感不同再調。

#### 純邏輯（`src/lib/training.ts`，禁沾 DOM，vitest＋mutation）

- `syncSetsForwardOps(detail, setId)`：回傳要 update 的列（只含後面未完成、且值真的不同的）。
- `completeAllOps(detail, workoutExerciseId)`／反向：回傳要 update `done` 的列。
- `removeSetOps(detail, setId)`：單筆 `delete`；只剩一組時回空（呼叫端另外擋）。
- `reorderExerciseOps(detail, fromIndex, toIndex)`：重算 `position`，只回傳位置變了的列。
- `exerciseProgress(sets)`：回傳 `{ done, total, next: { weight, reps } | null }`，給收合列的進度文字用。
- 寫入的都過 `enqueueMany`，不新增佇列語意。

#### 要改的檔

`TrainingSession.tsx`（卡片頭兩行、欄頭雙勾、新增一組整列、⋯ 選單、排序）、新增 `SetSheet.tsx`（含「上次」「同步」「刪除這一組」；**自製 spring sheet，不用 vaul**）、`app.css`（動效 token 已有，補樣張 `.v2` 區塊的實際規則）、`training.ts`＋測試、`e2e/training.spec.ts`（改寫鎖著舊行為的測試：調整列、要點筆圖示；凡是對組列 input 打字的測試要逐一盤點，因為重量／次數從 input 變成按鈕）、`DESIGN.md`（容器原則表、組編輯、要點、動效表、版本紀錄 v2.60；並把 v2.54 的調整列與要點規則標為被取代）。

#### 風險

- **改變輸入路徑**：點數字進 sheet 比原本「點輸入框直接打字」多一步；使用者已裁定只在 sheet 裡點大數字才叫鍵盤，不保留快速路徑。實測嫌慢再重議。
- **iOS 鍵盤與 sheet 內輸入**：同上，這是反覆修過的區域；自製 sheet 的鍵盤處理是本改版最大的實作風險，排在 SetSheet 一開始就做、真機驗過再往下。
- **排序時收合其他卡**（使用者 2026-10-15 同意）；備案是維持展開、靠自動捲動。
- **要點放卡片頭**：點要點文字會收合整張卡、無法就地展開全文（完整內容在 ⋯ → 編輯要點）；使用者若覺得不順，改回獨立的要點區塊。

#### ★ 核可後的順序

1. 使用者看樣張、回答「待決」後核可本 spec
2. `training.ts` 純邏輯＋vitest／mutation
3. `SetSheet`＋組列改版＋e2e 改寫
4. 動作卡版面（要點、⋯、底部列）＋全部完成
5. 排序
6. 動效鋪上（最後做，才不會被前面的結構改動反覆重調）
7. e2e 全量、WebKit 393×745 截圖
8. 真機驗（iPhone 主畫面 App）
9. 回寫 DESIGN.md、notepad

### 全站基礎：精緻度改版（2026-10-16 使用者核可；B0／B1 已依此開工，使用者 2026-10-16 逐批點頭；B2 之後各批仍獨立核可）

**來源**：使用者回報「整個 Tally 像 prototype、不精緻」→ 全站盤點（40 張 WebKit 截圖、逐頁診斷，發現清單在 `.omc/plans/polish-audit-findings.md`）→ 全局基礎提案樣張 `foundations-v1.html`（五個可切換對照，WebKit 16 項檢查全過；**2026-10-16 已刪，從未進 git**）→ 使用者逐項裁決，結論都在本節。**不動資料、不動行為、不動資訊架構、不改色票、不做暗色**；只動視覺語言與動效。

#### 已定（使用者 2026-10-16）

| # | 項目 | 決定 |
| --- | --- | --- |
| 1 | 欄位邊界 | **「A＋底線」**：欄位填色、無外框、圓角 12；**底部一條 2px `--rule-field` 底線**維持邊界辨識（對 cream 3.53:1、對填色 3.00:1，兩邊都過 3:1）。填色單獨對 cream 只有 1.18:1，達不到 3:1。使用者偏好 A 的和諧感。 |
| 2 | 陰影 | **鬆綁「不用陰影」**：暖棕色、三級為限（見 token）。 |
| 3 | 分頁列 | **維持圖示膠囊、不加文字標籤**；浮起（`shadow-2`）、無邊框；內容經過底部時**霧化**（漸進模糊淡出，不硬切）。使用者原話：「不要硬切，但到那個區塊的項目可以變模糊，有點霧化」。 |
| 4 | sheet 高度 | 含鍵盤的 sheet（記一筆、新增食物、身體數據）維持近全高；其餘短 sheet 貼合內容。 |
| 5 | 大標題 | 只用在分頁根頁，二級頁維持返回＋標題。**我的解讀（待確認）**：飲食與訓練的根頁頂部已經是日期標題（「週四 10/15 ⌄」），不加 large title；**只有設定頁改 large title**。 |

#### 新 token（採用後進 `app.css`，並回寫 DESIGN.md）

- `--shadow-1`（卡片，貼地）：`0 1px 2px rgba(61,34,16,.07), 0 0 0 1px rgba(61,34,16,.04)`——**取代卡片的邊框**。
- `--shadow-2`（分頁列、FAB、選單、彈出元件，浮起）：`0 4px 14px rgba(61,34,16,.12), 0 1px 3px rgba(61,34,16,.08)`。
- `--shadow-3`（sheet，最上層）：`0 -8px 32px rgba(61,34,16,.16)`，上緣再加 1px 高光 `inset 0 1px 0 rgba(255,255,255,.6)`。
- `--fill`（欄位填色）：`#F1E6D2`（比 `--raised` 稍深；對 cream 約 1.18:1）。
- `--field-line`：2px `--rule-field`（欄位底線）。
- `--fog-h`：霧化帶高度 168px；`--fog-blur`：9px（樣張實測效果含蓄，可調到 12–14px，實作時看真機）。
- spring 預設值進 `src/lib/durations.ts`：`SPRING_SHEET_OPEN`（stiffness 439／damping 33.5）、`SPRING_SHEET_CLOSE`（300／34.6）、`SPRING_CARD`（322／32.3），與訓練中改版 spec 同一組。

#### 規則

1. **控件語言**（取代全站 1.5px 粗邊空心框）：
   - 文字欄位／搜尋框：`--fill` 底、圓角 12、**底線 2px**、標籤固定在框上方（一律收成這一套，消除「標籤在框內／框上」兩套並存）；聚焦＝底線變 jade、整欄換 `--card` 底並加 3px jade 光暈。
   - 步進器：填色膠囊＋兩顆浮起的圓鈕（`shadow-1`），無分隔線。
   - 分段控制：填色軌道＋會滑動的白塊（spring 驅動，`shadow-1`）。
   - 單選清單：未選不畫圈、選中＝右側 jade 勾（iOS 清單慣例）；金額靠右、勾在最右。
   - 篩選膠囊：選中＝實心 `--accent-soft`、不描邊。
2. **層次**：卡片改 `shadow-1` 不用邊框；分頁列與 FAB `shadow-2`；sheet `shadow-3`；**modal sheet 開啟時背景縮小到約 95.5%**（樣張驗證過；**實作前要先實驗**：`#root` 一旦被 `transform`，裡面所有 `position: fixed`——分頁列、FAB——會改以 `#root` 為定位基準，B0 沒做，留給 B1）。scrim 的背景模糊 production 本來就有 16px（v2.38），不必另加（樣張的 3px 是樣張自己的簡化）。
3. **霧化邊緣（scroll-edge）**：所有有固定底列或浮動分頁列的頁面，捲動區底部加一條霧化帶——`backdrop-filter: blur` 搭 `mask-image` 漸層遮罩，漸層由透明到頁面底色，`pointer-events: none`（不擋點擊）。固定底部 CTA（儲存、加入）的頁面同樣套用。
4. **sheet**：自製 spring sheet 元件（已在訓練中改版 spec 定案）成為全站唯一的 sheet 實作，依內容量高度；含輸入欄位者撐到上限（近全高）。**vaul 全面退場**——這牽動所有現有 sheet 與 iOS 鍵盤處理（v2.32–v2.35 的坑），見風險。
5. **設定頁**：large title（34px、`letter-spacing -.02em`），捲動時收進頂欄中央，頂欄用模糊底；設定列加 jade 單色小圖示（30px 圓角方塊，不用多色）；群組卡改 `shadow-1`。「登出」改破壞性語意色（`--over`），不用 jade。
6. **一致性清單（使用者在意，逐頁驗收）**：同類元件位置一致（食物庫三種左緣統一成同一條；主數字版型統一）；同一種搜尋框一種底色；按鈕排列方向規則全站一致（左右並排、次要在左、主要在右）；用詞統一；文字不可被選取（輸入框除外）；FAB 不遮擋最後一列。
7. **prototype 殘留清除**：體重趨勢頁的佔位卡與開發備註（「〔完整圖表區域〕」「留到圖表定案時再決定」）不得出現在畫面上——該頁要嘛做出真的圖表（資料門檻已過，另案走 `dataviz`），要嘛先收起入口。**載入狀態**改骨架／保留版面（不再只有一行「載入中…」，且分頁列與 FAB 要同時在）。
8. **保留**：破表斜紋條與紅字、空狀態的空心圓點＋虛線、左滑刪除、完成 sheet 的大數字層次、品名／店家／熱量的資訊分層。

#### 與 DESIGN.md 衝突、實作時必須回寫的條目

「圓角與層次：不用陰影」與「禁止事項：不用陰影分層」（改為三級暖棕陰影）；「控件邊界 `--rule-field` 3:1」那段（改為「邊界＝底線，3:1」並記下填色對底色只有 1.18:1 的實測與取捨）；「元件規則」裡欄位、分段、步進器、單選、膠囊、分頁列、FAB、sheet 各條；「互動與動效」四級階梯補上 spring 一級（手勢與開關類用 spring，小回饋用曲線）；版本紀錄 v2.60 起逐批寫。

#### 推廣順序（每批獨立：需要時出樣張 → 使用者核可 → 實作 → e2e 全量 → WebKit 393×745 截圖 → 真機 → 回寫 DESIGN.md）

| 批 | 內容 | 為什麼這個順序 |
| --- | --- | --- |
| B0 | token、spring sheet 元件、欄位／分段／步進器／單選／膠囊元件、霧化邊緣元件；DESIGN.md 回寫 | 全局基礎先立，之後每頁只是「套用」，避免半新半舊 |
| B1 | 飲食頁＋記一筆 sheet＋新增食物表單 | 使用頻率最高，使用者感受最強 |
| B2 | 訓練（與「訓練中畫面改版」spec 合併做，不分兩次改同一批檔案） | 已有樣張與 spec |
| B3 | 設定、每日目標、身體數據、食物庫、體重趨勢（含 prototype 殘留清除） | 低頻頁 |
| B4 | 載入／離線／錯誤狀態、登入頁（T 字標接縫） | 收尾 |

#### 風險

- **自製 sheet ＋ iOS 鍵盤**是最大的實作風險：vaul 的 `repositionInputs`／`usePositionFixed` 換掉後得自己接 `visualViewport`（先例：Settings 手刻 sheet 的 `--kb`／`--vvtop`）。B0 一開始就做、**真機驗過再往下**。
- **e2e 187 條多半鎖著現有 DOM／class**（欄位、sheet、分頁列）；B0 與每批都要預留改寫成本，不降低斷言強度。
- **`backdrop-filter` 在 iOS 的成本**：霧化帶與 sheet 的背景模糊要真機看掉幀；備案是縮小模糊半徑或只留漸層遮罩。霧化帶必須 `pointer-events: none`，不能擋到底下的點擊。
- **欄位底線是否完全滿足 WCAG 1.4.11 沒有正式裁決**：W3C 原文讀不到（Cloudflare 擋機器人），只有二手資料與 2018 年郵件列表對 Material 填色欄位底線（3.28:1）的評論。這條 3:1 本來就是 DESIGN.md 的**內規**，不是法規；單人使用，風險低，但回寫 DESIGN.md 時要如實記下這個不確定。
- **大標題與飲食／訓練的日期標題**：兩頁根頁頂部已是日期標題，我解讀為不加 large title；使用者若想三頁統一，要另外設計日期元件與 large title 的關係。
- **改動面積大**：`Today.tsx` 934 行、`LogSheet.tsx` 673 行、`app.css` 1483 行；每批只動該批範圍。

### 階段 3 甲：組間休息計時器（2026-10-20 起草；**使用者同日核可（預設 90 秒、要提示音、全部完成不啟動）並已實作＝v2.79**，與下面「要改的檔」不同處：測試在獨立的 `e2e/rest-timer.spec.ts`，另新增 `src/components/useRestTimer.ts`、`scripts/build-rest-chime.mjs`、`src/assets/rest-chime.wav`）

**範圍（使用者 2026-10-20 選定）**：畫面內倒數＋回前景補算。**不做鎖屏通知**：網頁在 iOS 鎖屏或切到背景時 JS 會被暫停，沒有「排程本機通知」的網頁 API，要鎖屏會響只剩伺服器推 Web Push（Edge Function＋VAPID 金鑰＋訂閱表，屬 schema＋secret 影響面，要另案）。iOS Safari 也沒有 `navigator.vibrate`。以上來自社群回報與 WebKit bug 單，**沒找到 iOS 26／27 的官方確認**，真機要驗。

**行為**
- 在訓練中畫面把一組由未完成勾成完成（單點那顆勾）→ 開始倒數。倒數中再勾另一組＝重新起算。**不觸發**：取消勾、「全部完成」（一次勾多組，沒有「剛做完一組」的語意）、補記的訓練、已結束的訓練。
- **時長固定 1:30（90 秒），沒有時長選擇**（使用者 2026-10-20 真機後裁決，取代原本的 60／90／120／180 循環）；倒數條上只有三個動作：−15、＋15、略過。
- 位置（**v2.80 改版**）：**浮在底部列（加動作／完成訓練）上方的深色 pill**，絕對定位、不佔版面，疊在動作卡上面，一眼不會跟動作混在一起（同「刪除的復原提示」的語言）；顯示 `休息 1:23`；沒在倒數就不顯示。條出現時列表多留底部空間，最後一張卡捲得到條的上方。
- **用結束時間點而非每秒遞減**：存 `endAt`（`Date.now() + 時長`），每秒只是重算 `endAt - now`；鎖屏再亮起或 `visibilitychange` 回前景時立即重算，數字一定準。回前景時若已超時：顯示「休息結束 · 已過 0:23」，不補響。
- 倒數歸零且畫面在前景：條變強調色、播一聲短提示音、約 3 秒後自動收起；超時狀態點一下收起。音效走 `<audio>` 元素（WebKit 回報 Web Audio 在回前景後可能靜音），第一次勾組那下（使用者手勢）順便解鎖。
- 減少動態：不做條的進退場位移，只淡入淡出（≤120ms）。
- 狀態不進資料庫、不進離線佇列；重新載入頁面（含 SW 換版重載）時 `endAt` 存在 sessionStorage，載入後照 `endAt` 續算（已過期就直接不顯示）。

#### AC（＝將來的測試）
1. 單點把一組勾成完成：出現倒數條，顯示預設 1:30；取消勾、全部完成、已結束／補記的訓練都不出現。
2. 倒數中再勾另一組：重新從 1:30 起算（調過的 ±15 不留）。
3. 數字由 `endAt − now` 算：測試把時鐘往前撥 30 秒（不等真實時間），畫面顯示 1:00；撥過 `endAt` 顯示「休息結束 · 已過 …」。
4. −15／＋15 各調整 `endAt`；＋15 不超過 10 分鐘，−15 到 0 即結束；略過立刻收起。
5. （v2.80 改）只有三顆鈕（−15／＋15／略過）；每次開始都是 1:30，調過的不留到下一輪，重新載入後也一樣。
6. 歸零且在前景：條變色並有提示音被呼叫（stub `HTMLMediaElement.play`）；約 3 秒後自動收起。
7. `visibilitychange` 回前景時重算，不靠 interval 累積（測試把 interval 凍結後只觸發事件，數字仍更新）。
8. 重新載入：倒數中重載仍續算；已過期重載不顯示。
9. 減少動態：進退場不位移。
10. （v2.80 改）條是浮在底部列上方的深色 pill：不佔版面（列表高度不變）、疊在列表上、不蓋住底部列、有陰影；條出現時列表多留底部空間，捲到最底時最後一張卡在條的上方。

#### 純邏輯（`src/lib/restTimer.ts`，禁沾 DOM，vitest＋mutation）
`startRest(now, seconds)`、`remainingMs(endAt, now)`、`adjustEnd(endAt, deltaSec, now)`（含 0 與 10 分鐘夾限）、`formatRest(ms)`（`m:ss`；超時另有格式）、`REST_SEC`（固定 90）。（`nextPreset`／`parsePreset` 已於 v2.80 隨時長選擇一併拿掉。）

#### 要改的檔
新增 `src/lib/restTimer.ts`＋測試、`src/components/RestBar.tsx`；改 `TrainingSession.tsx`（`onToggleSet` 在 done 由 false→true 時開始）、`app.css`（細條樣式，用既有 token）、`e2e/training.spec.ts`（用 `page.clock` 撥時鐘）、DESIGN.md（元件規則＋版本紀錄）。**不動 schema、不動 `workout_sets`、不動離線佇列。**

#### 明確不做
鎖屏通知與 Web Push、震動、每個動作各自的休息時長、自動依「重量／組數」推時長、全部完成時啟動、時長選擇（v2.80 起固定 1:30）、設定頁入口、計時器歷史紀錄。

#### 風險
- 提示音在 iOS 要先有使用者手勢解鎖；勾組那一下就是手勢。**「靜音開關」打開時照樣會響**（使用者 2026-10-20 真機實測；原本我寫「`<audio>` 也會被靜音」是推測，錯的）。
- 細條與底部列、鍵盤、組編輯 sheet 的疊放順序要真機看；sheet 開著時條在 sheet 後面、倒數照走。
- 假時鐘（`page.clock`）與既有動效 e2e 的量法不互相干擾：新測試只用在自己的 spec 檔段落。

#### ★ 核可後的順序
① `restTimer.ts`＋unit（含 mutation）→ ② `RestBar` ＋接線 → ③ e2e → ④ 全量 vitest／build／lint／e2e → ⑤ DESIGN.md 回寫 → ⑥ 真機驗（鎖屏回前景數字、提示音、靜音開關）。

### 階段 4 甲：訓練分析——1RM 估算、重量建議、肌群狀態（2026-10-20 起草；**使用者同日核可 A→B→C 一次核可、分三次上線，待決①＝12 下、②＝要「套用」鈕、③加重幅度＝每個預設動作內建、不給旋鈕（待確認啞鈴與器械的實際跳格，只影響 B，A 可先開工）**；不動 schema、D（RPE）不在核可範圍）

**來源**：使用者 2026-10-20 看過 Gymwork 後提出三件事：肌肉恢復度（哪些肌群還在恢復，用來安排下一個訓練日）、1RM 與 RPE（「訓練真正有價值的東西」）、**依自己的數據建議這次的重量（「不然像盲試」）**。順序由我建議、使用者同意：**A 1RM → B 重量建議 → C 肌群狀態 → D RPE（另案，需使用者先表態願不願意填）**。

**與既有決定的衝突（請確認）**
- **RPE**：2026-10-13 訪談已定案「不做」（見「階段 2 spec」待決）。使用者現在想要，但每組多一個要填的欄位、需要動 schema；**所以 D 不在本節的核可範圍**，A–C 完成、使用一兩週後再問填寫意願。
- **「不動 schema」**：A、B、C 全部用現有 `workout_sets`（重量、次數、done）、`workout_exercises`、`workouts`、`exercises.muscle_group`、`routine_exercises.target_reps` 算，**不新增欄位**。
- **原階段 4 規劃的「每肌群每週訓練量與組數目標」**：本節的 C 只做「現在恢復到哪」，不做週目標。

**不是 AI**：全部是本機算的規則，離線可用（健身房網路差，是自建的主因）、看得懂為什麼、你可以不聽。呼叫 LLM 在「沒有比這份資料更多資訊」的前提下只是把同一條規則換句話說，還要網路與費用。

#### 口徑（純邏輯 `src/lib/strength.ts`、`src/lib/recovery.ts`，禁沾 DOM；**以下數字與公式都是設計決定，不是科學定論**）
1. **e1RM（估算 1RM）**＝Epley：`重量 × (1 + 次數 / 30)`；**次數 1 直接等於重量**（公式在 1 下會多算 3%）；**只收次數 1–10 且重量 > 0 的已打勾組**（次數越高估算越不準，常見做法是只信 10 下以內；0 kg 的徒手動作不算）。結果取小數一位。
2. **一次訓練的 e1RM**＝該動作那次所有已打勾組 e1RM 的最大值（所以熱身組不影響——`workout_sets` 沒有熱身標記）。**最佳值**＝歷來最大。
3. **重量建議（雙重進階的簡化版）**：需要同一動作**至少 2 次有已打勾組的訓練**，否則不給（顯示「還沒有足夠紀錄（至少 2 次）」）。取最近一次（`lastCompletedSets`，既有函式）的**最高重量 w**；看**重量等於 w 的各組是否都做到目標次數 T**：都做到 → 建議 `w + 加重幅度`；有一組沒做到 → 建議 `w`（理由「再做到 T 下」）。**T**＝該動作在這次訓練所屬課表的 `target_reps`（非空時）；否則用預設 12（**待決①**）。**加重幅度**＝**每個預設動作內建一個值，使用者不調旋鈕**（使用者 2026-10-20 裁決：「大部分 APP 都是先定義好每個動作的加重幅度，沒有可以自己調的旋鈕」，取代我原本提的全域「最小加重」設定）。存在程式裡、不進資料庫：`exerciseCatalog.ts` 的 `weightStep(key)`，依器材與部位歸類（見下表）；**使用者自建的動作沒有 key，一律用預設 2.5 kg**；徒手動作（伏地挺身、引體向上、棒式…）不給重量建議。**只顯示不覆蓋**；沒有「降重」規則（連續做不到的處理留作後續）。

**加重幅度歸類（起點；是我依常見做法的假設，要請使用者確認自己健身房的實際跳格）**

| 類別 | 動作例 | 加重幅度 |
| --- | --- | --- |
| 槓鈴、EZ 槓、史密斯（兩邊各加一片） | 深蹲、硬舉、臥推、划船、肩推、彎舉、臀推、史密斯各式 | **5 kg**（兩邊各加最小的 2.5 kg 槓片；**待確認：你的健身房有沒有 1.25 kg 的小槓片？有的話上肢動作可改 2.5**；使用者 2026-10-20 記得圓槓片有 5、10、15，不確定有沒有更小的） |
| 啞鈴 | 啞鈴臥推、側平舉、彎舉、肩推 | **2.5 kg**（網路上的公斤制啞鈴架範例是 2.5 kg 一格；**待確認：走到你的啞鈴架看標示是 10、12.5、15… 還是 10、12、14…**） |
| 器械與滑輪（插銷配重片） | 腿推舉、坐姿划船、下拉、滑輪夾胸、推胸機 | **2.5 kg**（使用者 2026-10-20：一片 5 kg、有一個小調片可再加 2.5 kg；滑輪是否同樣有小調片未確認） |
| 壺鈴 | 壺鈴擺盪 | 4 kg |
| 徒手 | 伏地挺身、引體向上、雙槓撐體、棒式、仰臥起坐、捲腹 | 不給重量建議 |
| 自建動作 | 使用者自己新增的 | 2.5 kg |
4. **肌群狀態**：六類（胸／背／腿／肩／臂／腹；「其他」含有氧，不算）。每類取**最近一次有已打勾組的訓練**，算那次該肌群的已打勾組數 n 與距今小時數 h（以該次訓練結束時間；沒有結束時間用開始時間）。**恢復窗口（2026-10-21 查文獻後改，取代起草時的 36／48／72 共用窗口）**：依部位×組數——下半身 n < 10 → 48 小時、n ≥ 10 → 72 小時；其餘五類 n < 10 → 24 小時、n ≥ 10 → 48 小時（依據：2024 年回顧 PMC11057610，下半身 48–72 小時、上半身 24 小時內，量大更久；**n = 10 的界與各數字是設計決定**）。n 不限次數與重量（徒手與高次數也算）。進行中的訓練也計入。h < 窗口＝「恢復中」（顯示還剩約幾小時），否則「可再練」；從沒練過＝「沒有紀錄」。**這組窗口是起點，沒有公認標準**，使用者用了之後覺得不準再調；畫面不寫百分比、不假裝精確。**熱身組會讓 n 偏大**（沒有熱身標記），已知限制。

#### 畫面
- **入口**：訓練頁在「動作庫」旁多一列「訓練分析」，進整頁（圖表、清單屬「長、多步驟」，依容器原則用整頁）。整頁頂部 `.seg` 兩段：**動作進度｜肌群狀態**。
- **動作進度**：列出「有已打勾組」的動作（依最近練的排序）→ 點進單一動作：最佳 e1RM、最近一次、**e1RM 隨時間的折線**（recharts，與體重趨勢同一套：30／90／全部、十字線與讀數、無資料與單點的空狀態）、每次訓練一列的明細（日期、最重一組、e1RM）。**圖表先過 `dataviz` 定案、出樣張給使用者看**，再實作。
- **肌群狀態**：六列，每列＝肌群名、狀態（恢復中／可再練／沒有紀錄）、「X 天前 · N 組」。不做週目標、不做建議菜單。
- **重量建議**：在**組編輯 sheet**（`SetSheet`）欄位上方一行：`建議 62.5 kg · 上次三組都做到 12 下`，旁邊一顆「套用」把重量欄填成建議值（**待決②**：要不要有這顆）。資料不足時顯示灰色說明、不給數字。
- **沒有設定頁項目**：加重幅度內建、不提供調整（見口徑 3）。

#### AC（＝將來的測試；預期值全部手算、不呼叫被測函式）
1. e1RM：60×10→80.0；100×5→116.7；100×1→100.0；50×12、0 kg、0 次→不算（null）。
2. 一次訓練取最大：同一動作 60×10（80.0）與 70×5（81.7）→ 81.7。
3. 最佳值取歷來最大；沒有任何有效組→null。
4. 建議：兩次訓練、最近一次 60×12 三組、T=12、加重 2.5→建議 62.5，理由含「三組都做到 12 下」；最近一次 60×12、60×11、60×10→建議 60，理由「再做到 12 下」；只有 1 次訓練→不給建議；沒有任何歷史→不給。
5. 建議的 T：課表 `target_reps`＝8 時以 8 判斷；空時用 12。
6. 肌群狀態（2026-10-21 改依新窗口）：腿 10 組、距今 48 小時→恢復中（窗口 72，剩約 24 小時）；腿 9 組 47 小時→恢復中、48 小時整→可再練；胸 6 組、距今 49 小時→可再練（窗口 24）、23 小時→恢復中、24 小時整→可再練；背 10 組 47 小時→恢復中（窗口 48）；沒做過的→沒有紀錄；「其他」不出現在清單。
7. 只算已打勾的組；沒打勾、被刪除的訓練不算。
8. 畫面（e2e）：入口列在訓練頁、整頁、兩段切換；動作進度的列表／單一動作頁（最佳值、折線、明細列數）；肌群狀態六列與狀態字；組編輯 sheet 的建議行（給／不給／套用後重量欄的值）；不同器材的動作加重幅度不同（槓鈴深蹲 +5、啞鈴 +2、器械 +5、自建 +2.5、徒手不給）；離線時照常顯示（資料來自本機底）。
9. 建議與恢復度的運算只吃已疊上離線佇列的 db（與 `lastCompletedSets` 同一來源），離線剛記完的訓練也算。

#### 要改的檔
新增：`src/lib/strength.ts`、`src/lib/recovery.ts`＋各自 `.test.ts`；`src/screens/Analysis.tsx`（整頁）與 e1RM 折線元件；`e2e/analysis.spec.ts`（獨立成檔，fixture 要有多次訓練）。改：`exerciseCatalog.ts`（`weightStep(key)`＋全部 150 個 key 都有歸類的測試）、`SetSheet.tsx`（建議行）、`Training.tsx`（入口列）、`App.tsx`（路由）、`app.css`、DESIGN.md（元件規則＋版本紀錄）、CLAUDE.md（e2e 條數）。**不動 schema、不動離線佇列、不動 Edge Function。**

#### 待決（請一次回覆）
- **①建議的預設目標次數**：沒有課表目標時用 12 還是 10？（我建議 12：你的紀錄裡常見 60×12；但很多人做 8–10。）
- **②建議行要不要有「套用」鈕**：我建議要（省得重打，且是你主動點才填）。
- **③（已裁決改法）加重幅度內建、不給旋鈕**；**使用者已答器械（5 kg 一片＋2.5 kg 小調片→2.5）；仍待下次到健身房確認兩件事**：①有沒有 1.25 kg 的小槓片（沒有就槓鈴一律 5）；②啞鈴架的標示一格是 2.5 還是 2。確認後把歸類表的數字定下來；**沒確認前 B 用表上的預設值開工也可以，數字之後改一個地方就好**。
- **④順序**：A→B→C 一次核可、分三次上線（每次獨立可驗），還是只核可 A 先看看？

#### 風險
- **資料太少**：使用者 2026-10-13 才開始用，約一週的紀錄；折線點很少、建議多半會是「資料不足」。這是預期，不是 bug；A 先上才有資料感。
- **估算不準**：e1RM 是估算、肌群窗口是假設；畫面文字用「估算」「約」，不寫百分比與診斷。
- **建議信任度**：建議錯一次就會被忽略。所以保守（只在上次都做到才加重）、說明理由、永遠只是建議。
- **熱身組**：沒有標記，會讓恢復度的組數偏大；e1RM 與建議因為取最大值／最高重量不受影響。若日後加 RPE 欄位，一併考慮加「熱身」標記（同一次 schema 變更）。
- **內建加重幅度是假設**：依器材歸類，你的健身房實際跳格可能不同（啞鈴 2／2.5、器械 5／2.5／3.5…）；錯了建議就會落在加不出來的重量。要改只能改程式裡的歸類表（沒有旋鈕）；自建動作固定 2.5。
- **圖表量法**：recharts 的 hover 測試要先算每天幾像素（見 wiki `lesson-recharts-trend-chart`）；e2e 的假時鐘只能用 `setFixedTime`（見 DESIGN v2.79）。

#### 明確不做（本節）
RPE（D，另案）、熱身標記、降重與 deload 規則、使用者可調的加重幅度旋鈕、週訓練量目標、肌群恢復百分比、自動排下一個訓練日的菜單、AI 生成建議、1RM 以外的指標（容量 PR、體積趨勢）。

#### ★ 核可後的順序
① A：`strength.ts` e1RM 部分＋unit（含 mutation）→ `dataviz` 樣張、使用者核可樣式 → 動作進度頁＋e2e → push 前 review → 真機。
② B：建議規則＋unit → 設定「最小加重」→ 組編輯 sheet 建議行＋e2e。
③ C：`recovery.ts`＋unit → 肌群狀態頁＋e2e。
④ 每一步：vitest／build／lint／e2e 全量、DESIGN.md 回寫、notepad 更新；**D（RPE）等使用用過 A–C 之後另開 spec，先問填寫意願**。

### 階段 4 乙：RPE（吃力程度）與熱身判斷（2026-10-21 起草；**使用者同日核可，四個待決全依我的建議：近力竭＝RPE ≥ 9 加 24 小時、熱身門檻 60%、休息條用 A（同一顆長高成兩列）、DDL 由我執行；DDL 已於 2026-10-21 在 Tally 專案執行並驗證（欄位 `rpe smallint` 可空、check 5–10）；同日已實作＝v2.84，與下面「純邏輯」「要改的檔」不同處：問題狀態放在 `TrainingSession`（`useRestTimer` 沒動）、chip 對應是常數 `RPE_CHIPS`（沒有 `rpeFromChip` 函式）、`isWarmup` 實作為 `warmupSetIds`**；樣張 `_design-sample/rpe.html`）

**來源**：使用者 2026-10-20 說 1RM 與 RPE 是「訓練真正有價值的東西」；2026-10-21 補一句「RPE 確實要，但填也是負擔，所以要設計 UI 讓它填起來很順、沒有負擔」，UI 由我設計。肌群狀態（C）上線時已預告：文獻說力竭程度是恢復時間最大的變數，C 沒有這個輸入；D 補上它。

**與既有決定的衝突（請確認）**
- 2026-10-13 訪談定案「RPE 不做」（見「階段 2 spec」待決），2026-10-20 使用者重新要求，**這節取代那個決定**。
- **動 schema**（`workout_sets` 加一欄）＝影響面升級，所以先給 spec＋plan，你點頭才動實作碼。
- **熱身組不加欄位**：用規則判斷（見下），不增加任何填寫負擔，也不動 schema。

**不是 AI**：全部是本機算的規則，離線可用；RPE 只在肌群狀態的恢復窗口用到，**不改 e1RM、不改重量建議（B）**。

#### 設計（填寫負擔的來源與壓法）
填 RPE 的負擔來自「每組都要填」。壓法是三條：**一個動作只問一次**（最後一組）、**問題長在休息條上**（你本來就在看它、不用另外找入口）、**單點作答，不點就是不知道**（沒有確認鈕、沒有彈窗、不擋任何操作）。

- **何時問**：訓練中畫面單點把一組勾成完成，且勾完後**這個動作沒有任何未完成的組**（＝這個動作做完了），且休息計時器因此啟動時。取消勾、「全部完成」、補記與已結束的訓練都不問（和休息計時器同一組條件）。只有一組的動作也問。**這一組的 RPE 就是這個動作的 RPE**，寫在那一組上。
- **怎麼問**（樣張 ②③，推薦 A）：休息條長高成兩列——上列「這個動作做完了，最後一組還能再做幾下？」＋四顆 chip **3 下以上／2 下／1 下／力竭**；下列是原本的 休息 1:23／−15／＋15／略過，**一個字不動**。點 chip＝立即寫入那一組的 `rpe`（無確認鈕），選中那顆變白、其餘退淡，約 0.6 秒後問題列收起，只剩單列倒數。沒點：問題列留到休息條自己收起為止，**不再追問**，該組 RPE 維持空白。「略過」收整條（＝沒作答）。已經有 RPE 的組（例如取消勾又重勾）不再問。減少動態：只淡入淡出（≤120ms）。
- **對應**：3 下以上＝RPE 7、2 下＝8、1 下＝9、力竭＝10（RPE 的標準定義是「還剩幾下」：10 − 剩餘下數；3 下以上全歸 7，不細分更輕的）。
- **補與改**（樣張 ⑤）：**組編輯 sheet** 在「次數」下面多一區「吃力程度 RPE」，五格 **6／7／8／9／10**＋說明一行（9＝還能再做 1 下，10＝力竭）＋「清除」。只在**已完成的組**顯示。點格立即寫入；再點同一格不取消（取消用「清除」，免得誤觸）。休息條漏點、答錯、或想補上一次的，都在這裡。6 只有 sheet 有（休息條只問「有沒有逼近極限」，不問太輕的）。
- **預填**：新增的組、複製上次訓練、課表預填**都不帶 RPE**（每次都是當下的感覺）。

#### 熱身判斷（規則，不是欄位）
對每個「訓練中的動作」：`maxW`＝該動作這次訓練**已打勾組**的最大重量。已打勾、`maxW > 0`、且 **重量 < maxW × 60%** 的組視為熱身組。例：40、60、100 三組 → 只有 40 是熱身（60 剛好 60%，不算）。**只影響肌群狀態的組數 n**（熱身組不計入）；不影響 e1RM（本來就取最大值）、不影響重量建議、不在列表上標示。已知誤判：遞減組（做完 100×5 再做 50×12）會被當成熱身；**同一個動作裡混著 0 kg 的徒手組和有重量的組（例如加重引體向上先做一組純徒手），0 kg 那組也會被當熱身**。整個動作都是 0 kg 才不判斷。**60% 是我定的門檻**（待決②）。

#### 對恢復窗口的影響（改 `recoveryWindowHours`，只動這一處）
n 改成「已打勾、非熱身」的組數。新增一個旗標 **近力竭**：該肌群在那次訓練裡**任一組 RPE ≥ 9**。窗口＝C 的窗口＋（近力竭 ? 24 : 0）：

| 部位 | n < 10 | n ≥ 10 |
| --- | --- | --- |
| 下半身 | 48（近力竭 72） | 72（近力竭 96） |
| 其餘五類 | 24（近力竭 48） | 48（近力竭 72） |

沒填 RPE 的資料，窗口與 C 完全相同（向下相容）。**依據與誠實度**：2024 年回顧（PMC11057610）說練到力竭會多拉長 24–48 小時；我取下緣 24，並把「1 下」（RPE 9）也算進來——這是設計決定，不是文獻給的界線，待決①。畫面：該列副標多「· 近力竭」，窗口數字照新值算（樣張 ⑥）；說明小字改成「…；有一組做到 RPE 9 以上，再加 24 小時。重量不到當天最重一組 60% 的熱身組不計入組數。」

#### 資料表（**動 schema＝先核可**；DDL 草案，核可後由你在 Supabase Dashboard SQL Editor 執行，我提供回滾 SQL）
```sql
-- 階段 4 乙：每組的吃力程度。可空；5–10 整數（休息條只會寫 7–10，sheet 可寫 6–10，留 5 的餘裕）。
alter table workout_sets add column rpe smallint check (rpe is null or rpe between 5 and 10);
-- 回滾：alter table workout_sets drop column rpe;
```
RLS 不用動（`owner_all` 是整列的政策）。**部署順序不能反**：①你先執行 DDL（加可空欄位，舊版 app 不受影響）→ ②我才 push。反過來的話，新版寫 `rpe` 會被 PostgREST 以未知欄位拒絕（400），進未同步 sheet 的「被拒絕」。**只在使用者真的填了 RPE 時 payload 才帶 `rpe`**，沒填的寫入與現在一模一樣。讀取走 `select('*')`（`trainingRuntime.ts:195`），新欄位會自動帶回，不用改查詢。**e2e 全 stub 不打真後端，驗不到真資料庫的欄位**，所以 DDL 執行後要在真機填一次 RPE 確認寫入與讀回。

#### AC（＝將來的測試；預期值全部手算、不呼叫被測函式）
1. **熱身判斷**：該動作已打勾組 40×10、60×8、100×5 → 熱身＝只有 40×10；59.9 → 熱身、60 → 不是；只有一組 → 不是；全 0 kg → 沒有熱身；沒打勾的組不判斷、也不影響 maxW。
2. **窗口**：下半身 n=10、近力竭 → 96；n=9、近力竭 → 72；n=9、沒近力竭 → 48；胸 n=6、近力竭 → 48；胸 n=10、近力竭 → 72；胸 n=6、沒近力竭 → 24。
3. **近力竭旗標**：RPE 8 → 否；RPE 9、10 → 是；只在**最近一次有已打勾組的訓練**裡看；該肌群的別的動作有 RPE 9 也算；沒填（null）→ 否；沒打勾的組上的 RPE 不算。
4. **恢復狀態**：腿 12 組已打勾、其中 2 組是熱身 → n=10 → 窗口 72；其中一組 RPE 9 → 96，距今 30 小時 → 恢復中、剩約 66 小時（手算）。熱身組不計入「X 組」的顯示。
5. **休息條（e2e）**：勾「最後一組」→ 出現問題與四顆 chip；勾非最後一組、取消勾、全部完成、已結束／補記的訓練 → 沒有問題；點「1 下」→ 寫入 `{ rpe: 9 }`，問題列收起、倒數續跑；「力竭」→ 10；不點 → 沒有 `rpe` 寫入；略過 → 整條收；已有 RPE 的組重勾不再問；只有一組的動作也問；減少動態只淡入淡出。
6. **組編輯 sheet（e2e）**：已完成的組有 RPE 區、未完成的組沒有；點 8 → 寫 `{ rpe: 8 }` 且該格高亮；點「清除」→ 寫 `{ rpe: null }`；休息條答的 9 在 sheet 裡是 9 高亮；離線時寫入進佇列、回線上後送出。
7. **肌群狀態（e2e）**：近力竭的列副標有「近力竭」、剩餘小時用新窗口；沒填 RPE 的列與 C 的數字完全一樣；說明小字為新文字。
8. 新增組、複製上次訓練、課表預填**不帶 `rpe`**（payload 不含該鍵）。

#### 純邏輯
`src/lib/recovery.ts`：新增 `isWarmup(setsOfEntry)`（或等價）、`recoveryWindowHours(group, n, nearFailure)`、`MuscleRecovery.nearFailure`；`src/lib/training.ts`：`rpeFromChip`（chip→值）與「這個動作做完了」判斷（`isLastSetOfEntry`）；各自 unit，預期值手算＋mutation。

#### 要改的檔
改：`recovery.ts`／`recovery.test.ts`、`training.ts`、`RestBar.tsx`、`useRestTimer.ts`（要知道這次啟動是否要問、問的是哪一組）、`TrainingSession.tsx`（`onToggleSet` 判斷最後一組並把那組 id 交給條）、`SetSheet.tsx`（RPE 區）、`Analysis.tsx`（「近力竭」副標、說明小字）、`app.css`、DESIGN.md（元件規則＋版本紀錄；`--rest-h` 隨問題列展開而變，要回寫）、spec.md（上面「RPE 不做」的舊決定標明被取代）、CLAUDE.md（e2e 條數）。新增：e2e 的休息條與 sheet RPE 部分放 `rest-timer.spec.ts`（要接管時鐘）與 `training.spec.ts`。**不動離線佇列的機制**（`rpe` 只是 update payload 的一個鍵）、不動 Edge Function。

#### 待決（請一次回覆）
- **①近力竭的界線與加時**：我建議 **RPE ≥ 9（還能再做 1 下以內）＋24 小時**。替代：只算 RPE 10（力竭）才加、或 RPE 9 加 12／10 加 24。文獻只說「力竭多 24–48」，沒有分 9 與 10。
- **②熱身門檻 60%**：「重量低於當天該動作最重一組的 60%」。替代 50%（更少誤判遞減組、但會漏掉較重的熱身組）或 70%。
- **③休息條的形式**：**A 同一顆長高成兩列（我推薦）**，還是 B 問題另成一顆 pill 疊在休息條上方（樣張 ②④）。
- **④DDL 何時執行**：核可後我給 SQL 與回滾，你方便時在 Supabase 執行並回報「好了」，我再 push；中間舊版 app 照常可用。

#### 風險
- **資料很少**：RPE 要累積幾週才影響到你的判斷；剛開始多半是「沒填」，窗口和現在一樣，不是 bug。
- **真正會不會填**：「問一次、單點」是我能做到最輕的，但最終看你肯不肯點；漏填就是空白，不會讓任何功能壞掉。使用兩週後看「有填的比例」，太低就再簡化（例如整個只問力竭與否）。
- **休息條變高**：約 52px → 139px（實測），疊在動作卡上更多；列表底部留白（`--rest-h`）要跟著變，走既有的過渡；最後一組多半在卡的下半，可能蓋住「新增一組」鈕——問題列只存在到休息條收起為止，且可略過。真機要看。
- **熱身規則誤判**：遞減組被當熱身（見上）；影響只是肌群狀態的組數少算，方向是偏短窗口，使用者覺得不準再調門檻。
- **RPE 是主觀的**：同一個人不同天的 9 不一定一樣；只當粗訊號，畫面不寫「疲勞度」「恢復百分比」。
- **部署順序**：DDL 要先於 push，否則新寫入被拒絕；e2e 驗不到真資料庫（見資料表節）。

#### 明確不做
每組都問 RPE、0.5 刻度（7.5、8.5）、RPE 進 e1RM 或重量建議（B 不看 RPE）、RPE 趨勢圖、依 RPE 自動降重／deload、熱身標記的按鈕或欄位、在**組列**上顯示 RPE（v2.85 起動作卡上標「RPE 9」「未填 RPE」，見 DESIGN）、設定頁開關、鎖屏通知問 RPE。

#### ★ 核可後的順序
① 你執行 DDL（④）→ ② 純邏輯＋unit（含 mutation）：`isWarmup`、窗口、旗標、chip 對應、最後一組判斷 → ③ `recovery.ts` 接上、肌群狀態列副標與說明 → ④ 組編輯 sheet RPE 區＋e2e → ⑤ 休息條問題列＋e2e → ⑥ vitest／build／lint／e2e 全量、DESIGN.md 回寫、notepad → ⑦ push 前 review → ⑧ 真機：填一次 RPE，確認寫入、讀回、肌群狀態數字。

### 資料模型草案（**已由上方「階段 2 spec」定案**，這裡保留當初草案；以上方為準）

`exercises`（名稱、肌群、是否封存）／`workouts`（日期、起訖時間）／`workout_exercises`（所屬訓練、動作、順序）／`workout_sets`（所屬動作項、第幾組、重量、次數、是否完成）。全部走與既有四表相同的 `owner_all` RLS。主鍵由客戶端產 UUID（為了離線寫入冪等）。**不做**：存 Gymwork 歷史（使用者 10/12 才開始試用，只有一次紀錄，不需搬）。

### 明確不做（別在下一輪長回來）

- 動作圖庫、教學影片、職業選手課表、AI 生成週計畫、朋友分享與競賽、肌肉恢復人體圖——內容與服務，不是功能；Tally 是單人。
- **運動消耗熱量**：不估算、不進目標、不進實測維持熱量（那張卡的口徑已把運動量吸收進去）。
- Apple Watch 震動提醒；寫入 Apple 健康（做不到）。
- 重做體重／體脂頁：Tally 已有。

### 待決與風險

- ~~**有氧動作（跑步機）怎麼記**、**RPE 要不要**~~（RPE 2026-10-21 起改為做，見「階段 4 乙」）：**2026-10-13 已問並定案**——有氧記速度、坡度與使用者自填的機器／遊戲顯示熱量；RPE 不做。見「階段 2 spec」。
- **網頁計時器在手機鎖屏時不會響**（背景執行受限）：2026-10-20 查過，網頁沒有排程本機通知的 API，鎖屏要響只能走伺服器 Web Push；使用者選「畫面內倒數＋回前景補算」，見「階段 3 甲：組間休息計時器」。
- 階段 4 的「運動×飲食」：資料要累積幾週才看得出趨勢；體重資料少時會誤導（見實測維持熱量節），圖要標資料量。

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
