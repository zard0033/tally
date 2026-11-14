---
title: "lesson-state-text-to-visual 狀態文字換成插圖／骨架的兩條通則（2026-11-14）"
tags: ["e2e", "ui", "loading", "v2.135"]
created: 2026-11-14T03:37:46.486Z
updated: 2026-11-14T03:37:46.486Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-state-text-to-visual 狀態文字換成插圖／骨架的兩條通則（2026-11-14）

# lesson-state-text-to-visual 狀態文字換成插圖／骨架的兩條通則（2026-11-14）

v2.135 把「載入中…」等純文字換成登入頁那幅畫與骨架時學到的。

1. **把可見文字改成讀屏用的隱藏字時，所有靠那段字或它的 class 定位的 e2e 要逐一改，而且要分「會紅」與「會假綠」兩種。** 會紅的跑一次就抓到（`.notice .muted`、`must(page, '.notice .action-btn')`）；會假綠的跑不出來：日期快取那條用 MutationObserver 找 `.timeline .muted` 的「載入中」，骨架上線後那個元素永遠不存在，斷言「沒出現過載入中」永遠成立。做法：grep 舊 class／舊字串，凡是「斷言不存在」的都換成新結構的定位器（這裡是 `[aria-busy="true"]`）。
2. **把按鈕從畫面中間搬到底部拇指區時，要查同時可能浮在底部的其他層。** 整頁錯誤原本置中，「復原」膠囊浮在底部列上方互不相干；改成底部後「重試」被膠囊蓋住點不到（meal-suggest:676／:910 真紅）。底部的浮層清單：底部列、`.undo-bar`、休息條、霧化帶。

