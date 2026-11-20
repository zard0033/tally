---
title: "recharts 讀數要跟 tooltip 狀態走，不要聽圖表的指標事件"
tags: ["recharts", "weight-trend", "e2e", "touch"]
created: 2026-11-20T08:11:44.778Z
updated: 2026-11-20T08:11:44.778Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# recharts 讀數要跟 tooltip 狀態走，不要聽圖表的指標事件

**通則（v2.146 review H1，2026-11-20）**：圖表外面要顯示「指到的那一天」時，用掛在圖裡的元件讀 `useIsTooltipActive()`＋`useActiveTooltipDataPoints()`（recharts 3 匯出），不要用 ComposedChart 的 `onMouseMove`／`onTouchMove`／`onTouchEnd` 回呼自己記。

**為什麼**：recharts 3.10 的 `onTouchEnd` 只轉發事件、不收 tooltip（只有 mouseleave 會收），`onTouchStart` 拿到的是這次觸控之前的狀態，鍵盤方向鍵（accessibilityLayer 預設開）也不會呼叫外部回呼——外部記的讀數跟十字線會各指一天。

**做法**：讀數只看 recharts 的狀態；手指放開要「回到最新」時，自己記一個 released 旗標，給兩張圖的 `<Tooltip active={released ? false : undefined}>`，十字線才會一起收。指到的那天記日序（`t`）不記索引——切範圍或資料晚到時索引會指到別天。

**測法**：桌面 WebKit 沒有觸控，在 `.recharts-surface` 上 `dispatchEvent('touchend')`，React 收得到、recharts 轉給 onTouchEnd。滑鼠停在圖上就會讓 tooltip 亮——進頁後先 `page.mouse.move(0, 0)`，不然點入口的位置換頁後落在圖上。
