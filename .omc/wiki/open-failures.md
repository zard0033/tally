---
title: "open-failures 未解失敗與已結案別撿回"
tags: ["未解", "e2e flaky", "主畫面App", "探針", "離線"]
created: 2026-10-14T06:26:53.236Z
updated: 2026-10-14T06:26:53.236Z
sources: []
links: []
category: debugging
confidence: medium
schemaVersion: 1
---

# open-failures 未解失敗與已結案別撿回

- **2026-09-08 查過，三條舊項都不是待修的程式碼**：vitest 在 Git Bash 全炸＝環境（已寫進 CLAUDE.md）；scrim 分區變色 `9782544` 已修；改份量無 debounce 是刻意的（`Today.tsx` 的 `ponytail:` 標記有升級路徑，觸發條件尚未發生）。
- **已結案、別再撿回來的**：app icon（v2.19–v2.26）、就地編輯區 focus trap、scrim 模糊、`.tabbar`／`.datectl` 邊框（v2.39）。
- **主畫面 App 登入失敗**：登入途中收信驗證時，上滑回首頁→開信箱→點圖示回來會失敗，用底部滑動切換則正常；症狀未能辨識（登入頁三種可能訊息都不是），**暫停追查**，階段 1 實作登入時請使用者失敗當下截圖。Safari 無二次驗證，不能對照。
- **e2e 全跑偶發 1 條失敗，原因未查到**（2026-10-13）：加入 SW spec 後的一次全跑，`tally.spec.ts`（累積狀態那條，約 19 秒處）失敗，之後單跑與全跑各一次皆綠、沒留下失敗訊息。**未驗證的假設**：SW spec 第 5 條的巢狀 `vite build` 與 tally 那條同時搶資源（workers 2）。**再現時**先把完整輸出存檔（`npm run e2e *> 檔案`）讀失敗訊息，別直接當 flaky；假設成立的話，解法是把解除版 build 前移到 webServer 啟動階段。
- **離線開機實測發現的兩個既有行為**（2026-10-13，不在甲範圍，要動先問）：① OAuth 回跳時網路失敗，supabase-js 的 `getSession()` 只回 `session: null`、不回初始化階段的錯，人靜默落到登入頁沒有說明；（原記「離線按登出沒反應」已更正：review 實測 `/logout` 失敗時 supabase-js 仍清本機 session，且離線提示亮著時按不到登出，不是問題。）**另有取捨待你裁決**：慢但通的網路上 refresh 超過 2 秒才完成時，會先閃一下含「專案被閒置暫停」的提示再消失（DESIGN v2.51）；要緩解可延後提示幾百毫秒。
- **`interaction.spec.ts`「本機 session 格式認不得、後端連上了卻永不回應：慢態有出口」目前單跑必紅**（2026-10-13 23:2x，**HEAD 乾淨樹上也紅**，stash 驗過，不是 v2.53 造成）；同日稍早一次全跑是綠的。症狀：`page.clock.runFor(120_000)` 之後畫面仍是「載入中…」、沒換成「比平常慢」。**未驗證的假設**：與當下時間／機器狀態有關。再現時先讀 trace，別直接當 flaky。
- **e2e 全跑偶發：`training.spec.ts`「訓練中：要點只能看…」紅在 `toHaveValue`**（2026-10-14，v2.55 那次全跑 151/152）；單跑 ×3 綠，失敗訊息被重跑覆蓋沒留下。之後兩次全跑 152/152（輸出已改存檔）。**再現時**讀存檔的失敗訊息，別直接當 flaky；與 10-13 那條 tally.spec 偶發紅可能同源（workers 2 下資源競爭），未驗證。
- **探針頁 `public/_probe/` 已上線**：**2026-10-19 起**看 Safari 分頁那 2 筆是否還在。**收尾順序：先推自我解除並清快取的 sw.js、等手機開過、再刪資料夾**，直接刪會留孤兒 SW。
- **`D:\Personal\.claude` 的遠端 `zard0033/claude-Personal-Config` 在 GitHub 上已不存在**，commit `f6b14c1` 只在本機；等使用者決定：不推／給新名稱／重建 private repo。

來源：`session-state/active.md`（2026-10-14 搬入後該檔已刪；更早的歷史在 `session-state/archive-*.md`）。
