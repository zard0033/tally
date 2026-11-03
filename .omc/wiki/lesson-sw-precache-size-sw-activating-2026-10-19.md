---
title: "lesson-sw-precache-size 預快取項數與新版 SW 卡 activating（2026-10-19）"
tags: ["SW", "precache", "WebKit", "e2e", "動作示意圖"]
created: 2026-10-19T14:30:26.126Z
updated: 2026-10-19T14:30:26.126Z
sources: []
links: []
category: debugging
confidence: medium
schemaVersion: 1
---

# lesson-sw-precache-size 預快取項數與新版 SW 卡 activating（2026-10-19）

# lesson-sw-precache-size 預快取項數與新版 SW 卡 activating（2026-10-19）

- **事實**：v2.74 把放大圖（640 寬）全放進 workbox precache（460 項／7.1MB）時，`service-worker.spec`「新版 SW 裝好就接手」單跑 6 次只過 3 次；失敗時 SW 停在 `activating`，把 poll 放寬到 60 秒也不出來（卡死、不是變慢；通過時 60ms 內 activated）。
- **對照**：基線 v2.73（約 160 項）3/3 過；排除放大圖（161 項）3/3 過；只留起始姿勢（311 項／4.5MB）5/5 過；全進 460 項 3/6 過。**門檻落在 311～460 項之間，根因沒查**（疑似項數或總量；只在 WebKit 測試環境觀察到）。
- **風險**：SW 卡在 activating 時，更新後重載的頁面請求會被擋住，真機可能表現為更新後卡白畫面（沒有真機驗證）。
- **通則**：
  1. 往 precache 加大量資產（百項級、MB 級）前，先單跑 SW 的接手測試至少 5 次；這條測試過去「偶發紅」的說法在 precache 變大時要重新檢驗，**別直接當 flaky**——用「單跑 N 次通過率」對照基線與實驗組。
  2. 判斷是不是自己造成的：開 worktree 切到基線 commit 同測試各跑 3 次＋把嫌疑資產排除再跑，兩組對照比猜原因快。
  3. 離線要看的大圖要分級：先進 precache 的是起始姿勢，次要的（收尾姿勢）不進，由元件自己在載入失敗時藏起來。
- **2026-11-03 結案，上面的結論不成立**：SW 沒有卡住，是重載後那一頁的 `ServiceWorker` 物件停在 `activating`（SW 自己報 `activated`、fetch 正常、別的分頁讀到 `activated`）。164 項也會重現，當時 3/3、5/5 全過只是樣本太少。460 項那組沒有重驗，症狀相同，應該是同一回事。**所以「項數多會卡」不是限制**，gif 不進 precache 的理由只剩體積。細節見 `e2e-reference`。
- 全文脈絡見 DESIGN.md v2.74。
