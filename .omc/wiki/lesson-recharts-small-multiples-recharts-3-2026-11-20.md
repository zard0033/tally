---
title: "lesson-recharts-small-multiples recharts 3 多排小圖對齊的四條通則（2026-11-20）"
tags: ["recharts", "chart", "v2.148", "weekly-compare"]
created: 2026-11-20T10:51:38.615Z
updated: 2026-11-20T10:51:38.615Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-recharts-small-multiples recharts 3 多排小圖對齊的四條通則（2026-11-20）

# lesson-recharts-small-multiples recharts 3 多排小圖對齊的四條通則（2026-11-20）

出處：v2.148「吃、練、體重並排」（`src/screens/WeeklyCompare.tsx`）。三排 ComposedChart 用 `syncId` 共用週的類別軸。

1. **沒有 Bar 的圖，類別軸要寫明 `scale="band"`。** recharts 3.10 的 `combineRealScaleType` 給「沒有 Bar 的 ComposedChart＋類別軸」point 比例尺：頭尾兩點會貼在圖框邊上，跟有 Bar 的那幾排（band）錯開。393 寬、14 週時偏 9px。`ReferenceArea x1=x2` 取的是 `bandwidth()`，在 point 比例尺下是 0 寬，選取底色因此消失。截圖時沒看出來，是 push 前 review 讀 recharts 原始碼才抓到。e2e 鎖法：比「點的中心」和「同一欄長條的中心」，誤差要 < 1.5px；mutation（拿掉 band）實測偏 9.2px。
2. **Bar 的自訂 shape 遇到 null 值也會被呼叫**（高度 0）。shape 裡要自己判斷 payload 的值是不是 null，不然每一欄都會畫出東西（這次是 14 個「沒記」）。
3. **選取底色別用 Tooltip 的自訂 cursor。** 非 BarChart 的 cursor 走 `cursorLine` 的 zIndex（1100），會疊在所有圖形上面、蓋住長條。改用 `ReferenceArea`：它畫在長條底下，而且 x 跟著自己的 state 走，沒指著的時候也能標出預設那一欄。
4. **`.screen svg` 全域描邊會傳到圖表的自訂圖形。** 線條圖示的規則是 `stroke: currentColor`，自訂的 path、rect、text 會被描成深色粗邊，字會糊。每個自訂圖形的 class 都要明寫 `stroke: none`。這條只有截圖看得出來，測試抓不到。

順帶：多張圖都可聚焦時，每張都是一個沒有名字的 tab 停點。只留一張 `accessibilityLayer`，用 `title` 當名稱（它會寫成 svg 的 `<title>`，可聚焦的就是那個 svg），另外幾張靠 `syncId` 跟著動。

