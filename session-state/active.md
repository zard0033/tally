# Tally — session state

最後更新：2026-08-02（同日第五輪：app icon manifest 版本參數＋份量文字加粗，push 中）

> 這是**覆寫式快照**，不是流水帳。已完成輪次的施工細節看 `git log`；
> 2026-07-30 手術前的完整歷史在 [archive-2026-07.md](archive-2026-07.md)（570 行，不再更新）。

## 現況

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示（本輪新增）。記一筆 sheet（多選／搜尋品名＋店家／
  新增食物／逐筆超標預警）、今日頁左滑刪除＋滑到底刪除＋5 秒復原窗、日期切換＋快取預取、
  設定頁編輯＋記體重。資料在 Supabase（四表＋RLS）。Notion 一次性遷移已出貨，收尾（刪 Notion
  頁面）還沒做，細節見「待決問題」。
- **測試**：`npx vitest run` 59/59（**必須用 PowerShell 跑**，Git Bash 全炸，見下方未解）；
  `npm run e2e` ＝ 26 條，分六個檔（`tally.spec.ts` 全份回歸 ＋ `interaction.spec.ts` 互動路徑
  ＋ `vendor-autocomplete.spec.ts` ＋ `meal-exit-animation.spec.ts` ＋ `quota-warning.spec.ts`
  ＋ `qty-edit.spec.ts`）。
- **`ui-design-flow` 規則本身改版**（使用者 2026-08-01 直接改的，非本輪施工）：五階段
  `⓪➊➋➌➍➎` 精簡成四階段 `➊➋➌➍`，依據是 15 天實測稽核（⓪ 兩次都跳過、➍➎ 從沒真的跑過）。

### 已 push 的歷史輪次（施工細節看 `git log`，這裡只留結論）

- **2026-08-01～02（`ef650d6`）**：額度預警提示上線（逐筆超標預警＋底部確認列蛋白/脂/碳），
  走完 `ui-design-flow` 四階段＋deep precommit-review 修 6 個問題，DESIGN.md → v2.12。
- **2026-08-02 第二輪（`dffb3a0`）**：真機第五輪回報 7 項回修（表單焦點、店家下拉留白、加入
  動畫太廉價、Archivo 400 字重、qty stepper 外框、日期標題字體、app icon 快取破解），
  DESIGN.md → v2.13。**app icon 修復尚未拿到真機確認結果**。
- **2026-08-02 第五輪**：真機截圖確認 app icon 仍黑底白T，但 curl 核對三個部署圖示檔跟 repo
  md5 完全一致，問題不在檔案——`manifest.webmanifest` 的 icons 陣列上一輪沒加版本參數（只有
  `apple-touch-icon` 有），這個 PWA 是 standalone 模式，iOS 可能優先吃 manifest 那組，補上
  版本參數＋manifest 連結本身也加版本。另外今日頁品項份量文字從 `--ink-muted` 改 `--ink`
  加粗（真機回報編輯前後只看得出熱量變了看不出份量變了）。DESIGN.md → v2.19。**這輪 skip
  了 precommit-review**（純設定/一行 CSS，22 行，已跑 vitest/build/lint/e2e 全綠，使用者
  要休息了）。**app icon 與份量顯示都尚未拿到真機確認**。
- **2026-08-02 第四輪（`b29a35c`）**：真機驗收第三輪回報「長按開編輯
  sheet 前會先閃一下左滑刪除鈕」，100% 重現。根因是 iOS click 合成常以 pointerdown 當下
  目標為準，即使 scrim 已蓋住該列，補來的 click 仍可能命中底下品項——`blockClickUntil`
  改成跟拖曳同一套手法（放手當下才收斂，不是計時器觸發當下）。**修法本身在同一輪
  precommit-review（light）被抓到一個新迴歸並一併修掉**：滑鼠收尾若走
  `pointercancel`/`pointerleave` 而非 `pointerup`，防呆窗口會卡在 `Infinity` 永久出不來。
  DESIGN.md → v2.18，e2e 26 條。**尚未拿到這輪修復的真機確認**。
- **2026-08-02 第三輪（`61af147`）**：兩個新功能，DESIGN.md → v2.17。
  (1) **今日頁品項可編輯份量**——長按品項（500ms）開自建 sheet 改 qty，只 PATCH `qty` 一欄
  （單份快照乘 qty 才顯示）。三輪 executor→verifier 揪出並修好兩個資料寫入時序 bug（長按
  計時器未隨 unmount 清理、編輯 sheet 開著時目標列離開視圖仍會寫入），收斂成寫入前的通用
  守門檢查。(2) **記一筆彈窗依今日剩餘額度排序**（方案 B：不隱藏，只排後面＋降視覺優先度）
  ——視覺降權機制試了三版都被真機核可打回：opacity 為過 WCAG AA 淡到肉眼看不出來、背景色
  調跟極簡風格不搭，**最終定案不做任何視覺處理，只靠排序位置＋既有紅字**。三版演變記在
  DESIGN.md 版本紀錄，避免以後重蹈覆轍。push 前 `precommit-review`（deep，
  `wf_93544908-e2d`）：6 條 major 全被對抗性驗證反駁，28 條 minor 挑 4 條修了（測試空洞
  通過風險、長按缺 button/isPrimary 檢查、`.over-quota` 相關命名語意過時、一句測試註解
  訂正），其餘既有模式或低急迫度未修。驗證：`vitest` 59/59、build/lint 過、`e2e` 24/24。

## 已驗證事實

- `foods.archived` 欄已在線上 DB（`schema.sql` 已同步），**前端還沒用它**——soft delete UI 是下一輪的事。
- Base UI Autocomplete 的 portal 坑已解掉，細節在 DESIGN.md「店家欄位（v2.6）」。
- 數字字體選 Archivo 是硬約束（實測數據見 DESIGN.md「字體」章節），不是品味決定。
- `pickTotals` 之類綁著 screen-specific 型別（如 `Food`）的純函式，不要為了「照規矩放 src/lib/」
  硬搬——要先查有沒有循環匯入風險（`api.ts` 已經匯入 `formulas.ts` 的 `Profile`，反向搬會 circular）。
- **判定精度與顯示精度要對齊**：`rowOverage` 用 0.1 級精度判「有沒有超標」，顯示卻用整數捨入，
  0.1~0.4 的超標量會顯示成「+0」——這種兩層精度不一致的坑，兩支數字都要設，不能只設其中一支。
- **「正在編輯的資料可能已經離開畫面」是要在寫入前守門的一類 bug，不是單一路徑補丁能擋完**：
  今日頁編輯份量這輪連續踩到兩條路徑（長按計時器待觸發時列被卸載／編輯 sheet 開著時列被換走），
  根因都是「送出當下沒人確認這筆還在畫面上」。最終解法是在 `App.tsx` 的 `handleUpdateIntakeQty`
  寫入前加 `rows?.some(r => r.id === id)` 這道通用守門，兩條路徑一次擋住——**但這道防線目前只
  服務這一個 mutation**，之後如果新增其他「開 sheet 編某一列」的入口，要記得在那個入口也補
  同樣的檢查，不會自動套用到全 app。

## 未解失敗

- **scrim 分區變色（iPhone 真機，使用者裁定擱置）**：關 sheet 時頂部延遲變回底色。純視覺瑕疵、
  不影響資料，優先級低，診斷配方見 archive。
- **vitest 在 Git Bash 集合階段全炸**：已定位 MSYS 環境特有，實務解＝本機一律 PowerShell 跑。
- **`tally.spec.ts` 在 `npm run e2e` 全量並行跑（5 workers）時偶發 flaky**：2026-08-02 撞過一次
  「刪除後焦點沒接到復原鈕，停在 BODY」，單獨跑（1 worker）穩定過，判斷是既有的 CPU 搶佔計時
  問題（harness.ts 已有相關註解），非本輪改動造成，未進一步深挖。
- **長按觸發本身真機確認沒問題**（原本擔心的 3px 取消門檻太嚴，實測不影響觸發），但抓到並
  修了另一個真的 bug（長按開 sheet 前會先閃一下左滑刪除鈕，見第四輪 `b29a35c`）——**這次
  回修還沒拿到真機再確認**，下次真機驗收要看這個閃爍是否真的消失了。
- **編輯份量目前只有長按（滑鼠/觸控）入口，沒有鍵盤可達的路徑**：純滑鼠/觸控 app 情境下不擋
  上線，但如果之後要顧無障礙，這是缺口。
- **守門檔下時是「偽成功」**：sheet 照常關閉、無錯誤訊息，使用者不會知道那筆其實沒被更新（多半
  只會在極端操作下觸發，例如編輯 sheet 開著時跳去別的日期）。目前只有程式碼註解記載是刻意選擇，
  沒有 UI 提示。優先級低，值得考慮加一句 Notice。

## 待決問題

- **食品庫管理與設定頁重構（已走完 dev-flow 前段＋★核可，等 ui-design-flow ➊ 出樣張）**：
  決策全部拍板（設定頁改純入口列表、食品庫 soft delete＋「封存」、店家管理頁延後不取消、
  不建 vendors 表、食物搜尋維持手刻），細節見 `git log` 該輪討論。**這輪先做了額度預警提示
  （使用者現場改變優先序），還沒動工。**
- **零碎（都不擋上線）**：RLS 跨使用者 DELETE 未實測（需兩組真帳號撞正式 DB）；飲食紀錄 4 筆
  刻意未遷移，使用者要自己補；21 條 precommit-review 的 unverified-minor 未逐條處理（效能熱
  路徑、PWA manifest 決策未寫進 DESIGN.md、macro-line 三種精度並存等，見該輪 runId 記錄）。
- **Notion 退場現況**：遷移已出貨，卡住的是收尾（刪 Notion 頁面＋補髒資料），判斷現存內容需要
  Notion MCP 或使用者自己看。
- **復原 pill 會蓋住時間軸最後一列 5 秒**：有意識略過。

## 下次續點

1. **請使用者真機重新驗收這輪三件事**：長按誤閃 reveal 是否真的消失（`b29a35c`）、app icon
   加了 manifest 版本參數後對不對（若還是黑的，先移除主畫面圖示＋清 Safari 網站資料再重加）、
   份量文字加粗夠不夠醒目。
2. **實作食品庫管理＋設定頁重構**：決策已拍板，下一步是 `ui-design-flow` ➊ 出決策樣張。
   建議開新對話，這輪 context 已經很長。
3. **PWA / service worker（新排入待辦，2026-08-02）**：Tally 現在只有 manifest.webmanifest，
   沒有 service worker——離線不能用、部署更新也沒有主動接手機制。`d:\Personal\Games\Gambit` 已用
   `vite-plugin-pwa`（Workbox `generateSW`）做過同款需求，設計記在該 repo
   `docs/architecture/adr-0016-pwa-caching-strategy.md`，可直接照搬：`registerType: 'autoUpdate'`
   （鐵律，避免 SW 把使用者鎖在舊版本）、app shell 快取（JS/CSS/HTML/SVG）、**Supabase 請求刻意排除
   在快取規則外**（Tally 也是 Supabase 後端，這條必抄，否則會出現「別台裝置改了、這台還在看舊
   資料」）。屬中型改動（新依賴＋新 build 設定），下次開工先走 `dev-flow`，不要直接動手。

## 教訓指標（本體已升格，這裡只留指標）

- **設計決策與被否決的做法** → `DESIGN.md`（元件規則表 ＋ 版本紀錄 v1→v2.12）。動 UI 前必讀，
  改完必回寫，已入 CLAUDE.md Pre-Push Checklist。
- **Windows/PowerShell 坑** → 全域 memory `windows-shell-ledger`。
- **驗證方法坑**（煙霧驗證抓不到互動 bug、量測要有對照組、「等寬」判準要用容差、判定精度要與
  顯示精度對齊） → 全域 memory `verification-ledger` ＋ `ui-verify` skill。
- **委派坑**（宣稱「文件已改好」要先 `git diff` 核對；agent 中斷後不能 SendMessage 恢復） →
  全域 memory `delegation-ledger`。
- **ezycopy 對純文字 raw markdown URL 會把反引號跳脫壞掉**——那個工具設計來把 HTML 轉
  markdown，餵它已經是 markdown 的原始檔反而會壞。下次這類 URL 改用 curl 或 WebFetch 的
  `EZYCOPY_FALLBACK` bypass。
- **真機／真實資料試用是設計核可之外的必要一關**：demo 樣張資料量小、乾淨，測不出「熱量資訊
  重複」「顏色判定漏掉」這類只有真實資料量與真實數值才會浮現的問題，deep code review 也再抓到
  一批（aria 閘門條件、精度對齊、日期切換誤判）——三層（樣張核可／真機試用／deep review）各自
  抓到不同類的問題，缺一層都會漏。
- 完整的歷史病歷 → `archive-2026-07.md`。
