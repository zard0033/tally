---
title: "lesson-b2-sort-and-mutation B2 排序與 mutation 的四條通則（2026-10-17）"
tags: ["dnd-kit", "mutation", "e2e", "base-ui"]
created: 2026-10-17T05:26:35.733Z
updated: 2026-10-17T05:26:35.733Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-b2-sort-and-mutation B2 排序與 mutation 的四條通則（2026-10-17）

# lesson-b2-sort-and-mutation B2 排序與 mutation 的四條通則（2026-10-17）

1. **dnd-kit 在 `beforedragstart` 之後等 React 渲染完才量尺寸，並凍結被拖那張的寬高。** 拖起時要收合其他卡，收合必須在同一次 commit 完成（不掛 `AnimatePresence`、沒有退場動畫），並在 `onBeforeDragStart`（不是 `onDragStart`）設狀態；否則被拖的卡維持展開時的高度（探針實測 343px），空白佔位也同高。dnd-kit 另會留一份隱藏 placeholder（同 class，`data-dnd-placeholder`），被拖的才有 `data-dnd-dragging`，測試要用後者選。鍵盤拖曳要等 `data-dnd-dragging` 出現才能按方向鍵，太快會被吃掉。
2. **dnd-kit modifier 的橡皮筋做法：** 繼承 `RestrictToElement`（量邊界、跟捲動與縮放更新都現成），覆寫 `apply()` 把「未夾住的 transform 減去夾住後的」過衰減函式再加回去；包裝用 `configure(plugin, options)`，`descriptor()` 只收一個參數。context7 連不上時讀 `node_modules/@dnd-kit/dom/modifiers.js` 原始碼，比猜 API 快。
3. **mutation 要寫成「編得過」的。** 弄壞後 TypeScript 因未使用的 import／變數編不過，`playwright.config` 的 webServer 建置會失敗、測試根本沒跑，輸出看起來像「沒抓到」或亂碼。用 `.slice(0, 0)`、`Math.random() > 2 ? x : undefined` 這類保留引用的寫法。另外抓到過一個真漏洞：只量 `.ex .set` 為 0 抓不到「拖起時不收合」（退場動畫最後也會把它收掉），要量被拖那張的高度。
4. **Safari 點按鈕不會讓它取得焦點**，所以 Base UI Dialog 預設的「關閉後焦點回到開啟前聚焦的元素」回不到被點的那顆；要自己用 `finalFocus` ref 指定。PowerShell 5.1 讀無 BOM 的 `.ps1` 會把中文當 ANSI，整支語法錯誤；含中文的批次腳本寫 Python（`subprocess.run(..., encoding='utf-8')`、`PYTHONUTF8=1`）。

