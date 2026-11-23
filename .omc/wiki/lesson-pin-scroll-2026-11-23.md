---
title: "lesson-pin-scroll 膠囊列補捲動的四條通則（2026-11-23）"
tags: ["scroll", "useLayoutEffect", "ref", "e2e", "ci", "v2.158"]
created: 2026-11-23T09:30:00.000Z
updated: 2026-11-23T09:30:00.000Z
sources: []
links: []
category: pattern
confidence: high
schemaVersion: 1
---

# lesson-pin-scroll 膠囊列補捲動的四條通則（2026-11-23）

出處：v2.158 記一筆的已選膠囊列。第一次 push 後 CI 全量與 burn-in 都紅在「膠囊列出現：手指底下那一列不動」，偏移固定 45px，也就是膠囊列的高度。本機每次都綠。程式在 `src/screens/LogSheet.tsx` 的 `setListScroll` 和補償用的 `useLayoutEffect`。

1. **補償要靠 effect 記住「上一輪的捲動區」時，元件的 effect 不一定會在元素掛上時跑。** sheet 內容是 SpringSheet 之後才掛上的，那一輪 LogSheet 自己沒有 re-render，所以 `useLayoutEffect` 不會跑，記住的還是「沒有捲動區」。之後使用者捲動，捲動不會觸發 re-render；再勾第一樣時，程式就把這個捲動區當成「換了一個」而不補。處理方式：用 callback ref，在元素掛上的那一刻就記下當下的狀態。mutation 實測：callback 裡不記，`--repeat-each 3` 三次都紅（偏 45）；有記，三次都綠。
2. **本機綠是因為測試多做了一個動作，剛好把 bug 遮住。** 原本的測試先點「早餐」換餐別，多一次 render 把記憶補了回來。CI 在 UTC 早上跑，打開 sheet 本來就是早餐，點了等於沒點，bug 才露出來。**測「打開就做某事」的行為時，用 `openAppAt` 把時間和預設值釘住，而且開啟到動作之間不要多點任何東西。**只在 CI 紅、本機綠，不一定是環境差：先拿 CI 和本機的實際數值對照。這次是用 e2e-diag 在暫時分支上記錄所有 scrollTop 寫入，一輪就看出「補償根本沒執行」。
3. **在 open 的 reset effect 裡重置 ref 是錯的位置。** `useEffect` 跑在 `useLayoutEffect` 之後，而且 reset 裡的 setState 多半跟原值相同，不會再 render。第一版的修法（reset 時把捲動區清成 null，或改成在 reset 時讀）都沒用，因為那一刻捲動區常常還沒掛上。
4. **mutation 只跑一次不能當證據。** 第一次改壞後單跑是綠的，要 `--repeat-each 3` 才確定。另外兩個坑：改壞時讓變數變成未使用，`tsc` 會擋掉 build，畫面上只看到「webServer was not able to start」，測試其實根本沒跑；`sed -i` 會把 CRLF 檔整份轉成 LF（windows-shell-ledger 早有記錄，這次又踩到），改程式改用 python 讀寫，並保留換行。
