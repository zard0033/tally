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
3. **疊層淡出的過場，淡出那一刻畫面上只能剩「跟底下頁面一致的東西」。**（v2.136）淡出本質是兩張畫面疊在一起：第一版放大推近、第二版太陽留到最後，淡出中段都是大太陽疊在餐別列上。做法是先讓會疊到字的東西（地面、太陽、雲）在淡出前離場，淡出時只剩純天空，而今日頁頂端本來就是天空。
4. **短於 ~150ms 的畫面狀態不要用 expect 輪詢去抓。** 減少動態時過場只有 120ms，`toHaveCount(1)` 輪詢直接錯過、看起來像功能壞了。改用 `addInitScript` 掛 MutationObserver，在元素掛上當下記下要驗的值（這裡是 `animationDuration`）、卸掉時記一筆。
5. **`pointer-events: none` 的全頁疊層要有自己的「一定會收掉」測試。** 它不擋點擊，動畫要是被關掉、animationend 不來，整頁永遠蓋著一層，但所有點擊測試照樣綠。

