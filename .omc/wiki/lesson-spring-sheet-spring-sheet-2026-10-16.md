---
title: "lesson-spring-sheet 自製 spring sheet 的三條通則（2026-10-16）"
tags: ["spring-sheet", "motion", "review"]
created: 2026-10-15T13:05:02.035Z
updated: 2026-10-15T13:05:02.035Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-spring-sheet 自製 spring sheet 的三條通則（2026-10-16）

# lesson-spring-sheet 自製 spring sheet 的三條通則（2026-10-16）

1. **motion 的 drag controls 在 pointerdown 就停掉進行中的動畫**，單純點一下沒有 onDragEnd，動畫停在半路。「關閉 spring 跑完才卸載」這種靠動畫完成回呼的設計，會因此留下「Dialog 仍是 modal、sheet 卡半路」的死局。守法：關閉中（open 已 false）不接手 pointerdown；開啟中點一下，放手後自己接回 0。e2e 用 dispatchEvent 送沒有位移的 pointerdown＋window pointerup 才測得到。
2. **手刻前先查元件庫有沒有現成的**：Base UI 1.6.0 自帶 Drawer，我手刻前沒查。它走 CSS 過渡＋swipe CSS 變數，沒有 JS spring 與放手速度接力，所以手刻成立，但理由要在動手前當場寫下，不是被 review 問了才補。
3. **fixed 元件的 max-height 要跟它的 bottom 一起算**：`.sheet` 貼底是 `bottom: var(--kb)`，貼合內容版的 max-height 若只扣 top 那段而漏扣 `--kb`，鍵盤升起時頂緣會高出 `--kb`。桌面測不出，要靠 review 對算式。

