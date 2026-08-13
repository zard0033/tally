# Tally — session state

最後更新：2026-08-13（v2.38 已上線；**拍照辨識功能實作中，dev-flow 步驟 0–3 完成、4–5 進行中——見續點 2**）

> **覆寫式快照**，不是流水帳。施工細節看 `git log`；2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯＋每日目標計算引擎＋食品庫管理
  與設定頁重構。逐版細節一律看 DESIGN.md 版本紀錄，這裡不再複述。
  **已上線＝v2.38**（`73b923f`，含雙語 README）；本機 v2.39 是純文件結案、無程式改動。
  仍在生效的兩條地基：走 vaul 的 sheet 一律 `repositionInputs={false}`、sheet 的 top 吃 `--vvtop`
  （iOS 鍵盤三題已真機驗過結案）；診斷用的 `?debug` 讀數列已整組移除，要用從 git 撿。
- **測試**：`npx vitest run` 97/97；`npm run build`／`npm run lint` 乾淨；`npm run e2e`
  **76/76 全綠**（約 1.4 分，十個 spec 檔，涵蓋範圍見 CLAUDE.md）。**條數以實跑輸出為準**——
  2026-08-12 又漏算一條被 review 抓到；且條數（76／10／97）有三份文件在寫（CLAUDE.md、本檔、
  兩份 README），改要一次改到底。DESIGN.md 版號刻意不寫進 README——每輪 UI 都 bump，寫死必過期。

## 已驗證事實

- **e2e 撞牆兩層，都已從根上處理（v2.25）**：dev server OOM（改跑 `vite preview`）、WebKit 塞不下
  記憶體（`workers: 2` 守這層，**別拿掉**）。**兩層都表現成「Playwright 壞了」，真兇兩次都不在
  Playwright**——先讀 `[WebServer]` 那幾行、再量機器餘裕。
- **抽共用元件的判準**（v2.29 `FoodFormFields`）：兩份長得像**不**構成抽出來的理由，
  「本來就該一致、且已經開始不一致」才是——那次的觸發點是已經分岔過兩次。
- **修分岔的那一輪，最容易製造新的分岔**（v2.29 三條，兩條自造）：抽共用元件時又抄了一份
  去重邏輯；`role="status"` 掛在 `<button>` 上（**顯式 role 取代隱含 role**，讀屏找不到那顆
  按鈕）；放寬 undo pill 蓋住 FAB。**共同形狀：只盯著要修的缺陷，沒重新檢查它跟周圍的關係。**
- **新測試一律做 mutation 檢查才收**（v2.24 起每輪都做）：把受測行為改回舊樣子，確認對應
  測試變紅、其餘不誤報。**綠色測試不等於有效測試。** v2.33 那次它直接推翻假設——
  **mutation 不只驗測試有沒有效，也會告訴你它守的其實是哪一道防線**。
- **版面問題要量對東西**（2026-08-05 三處真機回報）：① 圖示「沒對齊」偏的是 SVG **筆畫**在
  viewBox 裡的位置，量元素框查不出來（用 `getBBox()`）② `select` 文字放不下不會有 ellipsis，
  只是安靜切掉 ③ 全域元件搬進新容器要重驗。**照肉眼改，①會改錯地方、③會整條漏掉。**
- **`backdrop-filter` 在 headless WebKit 裡靜默無效，真機是好的**（v2.38 診斷六輪，v2.39
  真機確認結案）：computed style 一切正常（值拉到 40px 照樣回報），截圖就是不糊。
  **可複用判準：computed style 正常 ＋ 截圖無效果 ＋ 對照實驗互相矛盾＝先懷疑環境，不是修法。**
  副作用：scrim 模糊**在 e2e 裡驗不到，別為它寫視覺斷言**。
- **e2e stub（`e2e/stub.ts`）不看 query 參數／filter**，只按 table+method 回同一份 fixture。
  兩個後果：食品庫的分頁資料差異測不了；`intake` 的 PATCH 不反映在後續 GET，所以**任何
  「重整後還在」的斷言都驗不到真持久化**，只驗得到 App 本地 state 與 `cacheRef`。
- **screens 新增子頁不必上 router**：Settings.tsx 自己管 `view` state，同 App.tsx 的 `tab`。
- **把 DB 上分開的兩欄在 UI 層合併成聯集型別（v2.22 `GoalMode`）**型別漂亮但使用者覺得難用；
  事後拆要跨三處，比想像中貴。
- **RLS 已驗，此題結案**（2026-08-05 使用者實跑 `pg_policies`／`pg_class`：四張表各一條
  `owner_all`、無第二條 permissive policy、RLS 全開）。**判準（可複用）**：要驗的若是資料庫
  自己的執行行為而非我們的程式碼，把設定查完整就是充分證據；跨帳號 runtime 測試留給
  「policy 判斷式本身有條件分支」那種情況。
- **選中態語意的統一裁決（v2.30）**：互斥選一組一律 `aria-pressed`、容器不掛 `role="tablist"`，
  `aria-current` 只留給底部分頁列。**不補成完整 tablist 是刻意的**——半套 APG 契約會讓讀屏期待
  方向鍵可用卻沒有，比不做更糟（同 v2.24 拒絕升級 radiogroup）。
- **「select 保證合法值」只涵蓋一半的路徑**（v2.30）：v2.22 拿掉自訂輸入後移除範圍檢查，
  理由是選單保證合法——但 `xTouchedRef` 沒被碰過時走的是 **DB 原值**那條分支，那個值
  沒有人驗過。新增 `clampToPresetRange()` 補上。**通則：拿「輸入源受控」當理由移除驗證前，
  先數清楚有幾條路徑通到那個變數**，受控的通常只有其中一條。
- **已升格 DESIGN.md、這裡只留指標**：真機讀數的兩個判讀陷阱（v2.36——`getBoundingClientRect()`
  相對 visual viewport／指紋要先於一切數字被檢查）、motion 不把 drag 速度交給接手的 spring（v2.38）。

## 未解失敗

- 舊的未解失敗（vitest Git Bash 炸、scrim 分區變色、改份量無 debounce）維持原狀未動，細節見
  git log。**已結案、別再撿回來的**：app icon（DESIGN.md v2.19–v2.26）、就地編輯區的 focus trap
  （inline 展開本來就不該有，那是 modal 的契約）、scrim 模糊、`.tabbar`／`.datectl` 邊框（v2.39）。

## 待決問題

- **[新需求 2026-08-13 · 未開工] 預先記錄明天的飲食**（「今天先排明天吃什麼，看會不會超過」）：
  **範圍已定（使用者裁決）：只開明天、不做確認關卡、零新欄位**——日期本身就是狀態，到了隔天
  自動變成當天紀錄，沒吃到自己刪；額度預警與每日目標引擎本來就逐日算，零新邏輯。**翻掉一條既有
  決策**：`App.tsx:258`「看不了未來」＋DESIGN.md「日期切換」右箭頭在今天停用、e2e 有鎖，翻案
  理由要回寫 DESIGN.md。spec 先解三題：明天那頁主數字「還能吃多少」的語意、時間軸「待記錄」
  節點顯示什麼、「回今天」鈕目前只在歷史日出現。**跨四檔、走 dev-flow。**
- **[進行中 2026-08-13] 拍照讀營養標示自動填表**——**需求、AC、模型選型、已否決的路徑全文都在
  [spec.md](../spec.md) 的「拍照讀營養標示」節**，本檔只記進度與還沒落檔的東西，不複製第二份。
  模型 `qwen/qwen3.7-flash`，走使用者既有的 OpenRouter 帳號（另開的獨立 key，**花費上限已設**）。
  探針 `<scratchpad>/ocr-probe.py`（多模型並排）與 `calib-probe.py`（壓縮校準，會自動對答案）。
- **體重趨勢完整圖表仍是佔位卡**：要過 `dataviz` 定案才能做，樣張在
  `_design-sample/food-library.html` A3 frame；e2e 刻意只驗進出不鎖內容。
  **零碎（不擋上線）**：Notion 退場收尾未完成。

## 下次續點

1. **PWA / service worker：★核可已通過，實作零進度**（2026-08-05 收工於此）。
   走完 dev-flow 前段，**規模判為「大」**（壞掉的 SW 會把舊版鎖在使用者手機上＝不可逆）。
   **範圍（使用者裁決）**：離線可讀 ＋ 冷啟動加速；更新走「下次開啟自動換」。
   **Musk 視角砍掉的兩件事，別在下一輪又長回來**：
   ① 不承諾「變快」——assets 檔名帶 hash，HTTP cache 已經蓋住重複載入，SW 只多買到
      `index.html` 那一跳，量不出來的東西不寫進 AC。
   ② **SW 不快取 Supabase API 回應**——App.tsx 已有 `cacheRef` 日期快取，兩層快取壽命
      不同必然對不上；且 SW 那層是透明的，App 拿到舊資料時不知道它舊，就無法誠實標示。
      離線資料改由 `cacheRef` 持久化到 localStorage 供給，一層快取、App 自己知道新舊。
   **AC 六條、plan 六步的全文只存在於 2026-08-05 那次對話、已撈不回來——下一輪直接重跑 spec**
   （範圍與上面兩條砍除決策仍有效，不必重談）。**已定的補遺**：SW 放 `public/` 以 `./sw.js` 註冊
   （scope 跟著 `base: '/tally/'`）；登出時一併清掉快照（掛在既有的 `cacheRef.clear()` 旁）。
   **實作第一步必須先實測「離線時 supabase-js 會不會把 App 踢回登入頁」**——唯一可能推翻整個設計
   的未知數，探針已寫好但**還沒跑**：`<scratchpad>/probe-offline-auth.mjs`（兩種 session：未過期／
   已過期，分歧點在 supabase-js 要不要為了 refresh 打網路；需 `npm run preview` 起在 5501）。
   **這條有 UI**（離線指示條），實作階段照 dev-flow 鐵律 4 轉 `ui-design-flow`。

2. **拍照辨識：dev-flow 走到實作階段，步驟 0–3 完成、4–5 進行中**（規格全文見 spec.md）。
   完成：key 上限已設／壓縮參數 1200px q0.85 實測定案／Edge Function `read-label`（驗 JWT ＋
   OpenRouter ＋CORS allowlist ＋POST-only ＋SSRF 閘），21 條測試、**兩輪獨立 verifier 皆 PASS**。
   前端：相機鈕「AI 辨識輸入」已接進兩個新增入口（就地編輯刻意不給），辨識中用 `<fieldset disabled>`
   整組鎖住、關閉鈕與 vaul 下滑一起鎖，e2e ＋2 條。
   等待動效已落地：四版對照 demo 讓使用者挑，選「骨架呼吸」（空欄位變灰條輕微呼吸、標籤同時
   浮起，已打字的欄位不長骨架）＋填入時數值由上而下依序浮現。demo 是一次性產物、已刪。
   **剩一件：push 前端**（後端已上線，push 前 app 上還沒有那顆鈕）。
   註冊已關閉（單人 app 的成本防線，理由在 spec.md「安全」節，不複製第二份）；金鑰已進 Supabase secrets。
   **Edge Function 已部署並從外部驗過（2026-08-13）**：preflight 不帶 Authorization → 204 且
   `Allow-Origin` 回的是白名單常數；無 token／亂寫 token → 401、GET → 405，訊息都是函式自己寫的
   中文（代表請求真的進到程式碼）；未授權 origin 拿不到 `Allow-Origin`。**部署指令要兩個旗標**：
   `--use-api`（預設的打包路徑要 Docker，這台沒有——第一次部署就是靜默失敗成 404）＋
   `--no-verify-jwt`（**閘道那層的驗證連公開的 anon key 都收，擋不住人，卻會擋掉依規範不帶
   Authorization 的 preflight**；真正的防線是函式內那道，21 條測試＋兩輪 verifier＋mutation 檢查）。
   **仍未驗（要真機）**：iOS 鍵盤的上下箭頭——這輪在 `<form>` 與欄位之間插了一層 `<fieldset>`，
   而 v2.33 的教訓正是「沒有 form 時 Safari 靠 DOM 相鄰性猜欄位分組」，多一層會不會擾動那個猜測
   **桌面重現不了**（precommit review 指出，confidence low 但這專案為同一件事踩過三輪）。
   另一個已知缺口：`supabase/functions/**` 不在 `tsconfig.app.json` 的 include 內，**型別錯誤 CI
   攔不到**（vitest 只做 esbuild transform 不查型別），收尾時補。

3. **預先記錄明天的飲食**：範圍已定（見待決問題），尚未開工。

4. 體重趨勢完整圖表尚未開工，要先過 `dataviz` 定案。

5. **待刪（v2.38 一次性產物，結案條件已滿足，等使用者點頭）**：[ios-gap-analysis.md](ios-gap-analysis.md)、
   `_design-sample/ios-tuning-compare.html`。**刪前先 grep 這兩個檔名**——已知三處引用：DESIGN.md
   「對照 demo 現況」（要改）、v2.38 那條（歷史，留著）、`app.css` scrim 註解的出處句（自行判斷）。

**dev-flow 申報（PWA 這條）**：規模<大> 釐清／spec／plan／★核可<全部完成> 實作<未開始>——
但 AC 與 plan 全文已遺失（見續點 1），實質上要從 spec 重跑。

**蒸餾（前四條關於「停在第一個看起來對的答案」，②③ 全文已升格 DESIGN.md v2.33／v2.34）**：
① 待決清單記的位置往往只是「當時看到的那一處」，**收零碎項時要重搜一次**（`aria-current`）。
② 症狀有兩個面向時，一個原因解釋得通不代表另一個面向也被它解釋了；③ **懷疑「我寫的 CSS
沒生效」時先查有沒有第三方在寫 inline style**；④ **真機回報的因果先擱著，直接問「還有哪裡
不一樣」**（v2.35「注音會推、數字不會」其實是欄位位置）——而**症狀清單本身就是線索：追第一條
之前先看它們有沒有共同的上游**（三題最後同一個開關）。⑤ **交付形式錯了，內容再對也沒用**
（v2.38：微調類的選項給文字清單，使用者的回應是「講太多我都聽不懂的東西」——**可摸的對照
demo 才是這類決策的正確載體**，而且要我先做、不是等他要求）。⑥ **宣告「某條路否決」前先數清楚
候選裡真的測過幾個**——2026-08-13 四個免費模型只實測過一個就下結論，使用者連問兩次才補測，翻盤。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表＋版本紀錄）。動 UI 前必讀、改完必回寫，
  已入 CLAUDE.md Pre-Push Checklist。
- **三本全域 ledger memory**：`windows-shell-ledger`、`verification-ledger`（＋`ui-verify` skill）、
  `delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：三層（樣張核可／真機試用／deep review）各抓到不同類的問題。
