---
title: "lesson-flaky-root-cause 把「偶發紅」查到底的五條通則（2026-11-03）"
tags: ["e2e", "flaky", "mutation", "動效"]
created: 2026-11-03T02:00:19.344Z
updated: 2026-11-03T02:00:19.344Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-flaky-root-cause 把「偶發紅」查到底的五條通則（2026-11-03）

# lesson-flaky-root-cause 把「偶發紅」查到底的五條通則（2026-11-03）

1. **先看失敗當下的畫面，再提原因。** `recovery-foreground` 被推論成跨午夜，寫進 wiki 又擺了一陣子；看一眼 `error-context.md` 的頁面快照就知道是被踢回登入頁。撥時鐘的測試要想到 session 也會一起過期。
2. **CSS transition 預設 `fill: backwards`，延遲期間 `getComputedTiming().progress` 是 0，不是 `null`。** 要判斷還在延遲裡，用 `currentTime < delay`。還在延遲裡就把狀態切回去，目標色等於現在的顏色，不會有新 transition，等事件會等到逾時。`transitionrun` 也要排到下一幀才發，要量當下就用 `MutationObserver` 配 `getAnimations()`。
3. **mutation 的紅也要看紅在哪。** 拿掉函式呼叫讓它變成沒人用，`tsc -b` 先失敗，測試根本沒跑。沒有斷言失敗的摘要就不算數，換成 `void fn` 這種編譯得過的弄壞法。

4. **「測試說卡住」要從旁邊問一次。** SW 卡 `activating` 被當真了兩週，還影響了 precache 的決定；問 SW 自己、發一個經過它的 fetch、另開分頁讀，一輪就知道卡住的只是頁面手上的物件。少量全過的對照（3/3、5/5）撐不起門檻結論。

5. **合成事件驗不到瀏覽器的焦點行為，對照組要真的會紅。** 搶焦點那條，發一整串合成事件都重現不了，真滑鼠 3 次全中；helper 的 `.click()` 打到 SVG 也會靜靜失敗。對照時，弄壞的版本要能紅，測試才算數。

順帶：收合中的點擊原本到不了目標，所以用座標點一下、再用 `elementFromPoint` 看打到誰，比繼續讀碼快，一輪就找到 `InternalBackdrop`。

