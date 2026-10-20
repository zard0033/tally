---
title: "lesson-recharts-trend-chart recharts 趨勢圖的三條通則（2026-10-20）"
tags: ["recharts", "圖表", "體重趨勢", "e2e", "dataviz"]
created: 2026-10-20T01:51:49.967Z
updated: 2026-10-20T01:51:49.967Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-recharts-trend-chart recharts 趨勢圖的三條通則（2026-10-20）

# lesson-recharts-trend-chart recharts 趨勢圖的三條通則（2026-10-20）

來源：體重趨勢圖（DESIGN v2.75）。

1. **recharts 的 `<text>` 會繼承圖層 `<g>` 的 stroke**：自訂 dot 裡的數字標籤變粗變糊。CSS 對該 class 設 `stroke: var(--card); stroke-width: 3px; paint-order: stroke`，同時得到光暈與可讀性。SVG 屬性吃不到 rem／token 字級，刻度字級用 `.recharts-cartesian-axis-tick-value` 的 CSS 蓋。
2. **Y 軸只給 domain 會得到怪刻度**（步長 3 之類）：刻度自己算並傳 `ticks`，純函式放 `src/lib` 附 vitest。多張圖同步用 `syncId`＋**同一份 data**（索引才對得上）；浮動 tooltip 只掛一張，其餘的 `content={() => null}`，免得兩個框疊在一起。
3. **數字 X 軸的 hover 測試要先算每天幾像素**：90 天約 3px/天，指標差 6px 就落到前兩天；測試先切 30 天（約 9px/天）再對準端點。
4. 附帶：Edit 的 old_string 與 new_string 的既有行不一致會靜默改掉既有文字（這次把 `kcal` 改成 `kkcal`），做完看 `git diff -U0` 確認只有新增行。

