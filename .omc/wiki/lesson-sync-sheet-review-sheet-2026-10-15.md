---
title: "lesson-sync-sheet-review 同步 sheet 的三條通則（2026-10-15）"
tags: ["a11y", "queue", "review", "sync-sheet"]
created: 2026-10-15T09:17:45.265Z
updated: 2026-10-15T09:17:45.265Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-sync-sheet-review 同步 sheet 的三條通則（2026-10-15）

# lesson-sync-sheet-review 同步 sheet 的三條通則（2026-10-15）

1. **把有語意的容器（role=status）換成互動元素會丟 live region**：外層固定 `role=status`，裡面才換 button／div；名稱用可見文字，補充說明走 aria-describedby 指向 hidden span，不放進按鈕。代價是外層一直掛著，內容閃現可能被讀屏播報（待真機驗）。
2. **文案不承諾沒有觸發點的行為**：App 只在開機、回前景、回線、token 更新、寫入後才同步，沒有計時器，所以不能寫「稍後會再試」；列出實際觸發點。review 抓到的，不是測試抓到的。
3. **UI 上算出的「連帶影響數字」要和實際動作用同一個函式算**：discardImpact 與 discard 共用 withoutDiscarded，才不會各算各的；單位（列 vs 條目）不同時要在 DESIGN 明寫是已接受的取捨。另：同一列後面的條目被前面失敗的條目擋住，summarize 要照 flush 的 blocked 算成 waiting，否則會顯示「會自動送出」但其實送不出去。

附帶：`notepad_write_priority` 一度回報成功但檔案沒變（2026-10-15），寫完要回讀；改用 Edit 直接寫檔可靠。
