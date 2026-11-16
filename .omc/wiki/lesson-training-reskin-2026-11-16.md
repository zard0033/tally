---
title: "lesson-training-reskin 時間軸套進可排序清單的三條通則（2026-11-16）"
tags: ["訓練換皮", "時間軸", "dnd-kit", "AnimatePresence", "e2e", "v2.145"]
created: 2026-11-16T06:00:00.000Z
updated: 2026-11-16T06:00:00.000Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-training-reskin 時間軸套進可排序清單的三條通則（2026-11-16）

1. **dnd-kit 拖曳中，被拖的元素永遠不是 `:last-child`。** 它在被拖那列後面插一份 `data-dnd-placeholder` 的複本（整份 `visibility: hidden`）。靠 `:last-child` 收尾的裝飾（時間軸的線）會吊在浮起的列下面，原位的軌道也會斷。要另外寫 `[data-dnd-dragging]` 與 `[data-dnd-placeholder]` 的規則；`visibility` 可以在子孫重新打開。

2. **「收合後變透明」不能跟收合同一刻切 class。** 內容還在跑退場動畫，裡面自帶底色的子元素（`.swipe-slide` 的白底）會在紙上留成白塊。透明要掛在 `AnimatePresence` 的 `onExitComplete`；展開則在 render 中立刻撤掉（`if (open && flat) setFlat(false)`）。排序中整段不掛 `AnimatePresence`，等不到 `onExitComplete`，那段期間維持白卡。

3. **整檔跑才紅、單跑全過的測試，第一次紅就把 `test-results` 拷出來。** 下一輪 Playwright 會清掉輸出資料夾，smoke 接在後面跑就把錯誤細節蓋掉了，這輪兩次都沒抓到。另外跑 e2e 時別同時跑 vitest：第一輪紅的三條裡，兩條是負載造成的。
