---
title: "lesson-cleanup-review 整體清理與 push 前 review 的四條通則（2026-11-02）"
tags: ["cleanup", "review", "e2e", "競態"]
created: 2026-11-02T08:26:08.372Z
updated: 2026-11-02T08:26:08.372Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-cleanup-review 整體清理與 push 前 review 的四條通則（2026-11-02）

整體清理（清單見 `cleanup-inventory`）踩到的通則。

1. **「只送有變的」要比對最後送出的值，不是最後存成功的值。** 請求還在路上時，存成功的值已經過時：按 + 再按 − 會被判成沒變而不送，資料庫停在 + 的結果。回滾也要等全部請求回來，否則前一筆失敗、後一筆成功時畫面會停在舊值。見 `ItemEditor` 的 `commitQty`。
2. **把狀態更新移到 `await` 之後，就要改用 functional update。** `await` 回來時閉包裡的值可能已過時。`FoodLibrary` 收起編輯區移到封存成功之後，讀舊的 `editingId` 就關錯了別列。
3. **反覆紅的「偶發」先量時間線，別靠重跑放行。** `undo 跨日期 3` 被當偶發很久，量了才知道測試切走再切回要到第 6 秒，已超過 5 秒的時限，通過只是趕上退場動畫。只斷言終點也驗不到過程：減少動態的 `jump` 改成 spring 照樣綠，要用 `MutationObserver` 記中間值，再用 mutation 確認會紅。
4. **「行為不變」的重構也要獨立 review。** 這輪兩個回歸都是我自己的修法引入的，都由獨立 agent 推演連按、請求在路上這類情境才抓到；測試當時全綠，因為只測單筆請求。

