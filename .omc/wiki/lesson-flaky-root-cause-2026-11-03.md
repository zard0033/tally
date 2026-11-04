---
title: "lesson-flaky-root-cause 把「偶發紅」查到底的七條通則（2026-11-03）"
tags: ["e2e", "flaky", "mutation", "動效"]
created: 2026-11-03T02:00:19.344Z
updated: 2026-11-04T02:16:09.000Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-flaky-root-cause 把「偶發紅」查到底的七條通則（2026-11-03）

1. **先看失敗當下的畫面，再提原因。** `recovery-foreground` 被推論成跨午夜，寫進 wiki 又擺了一陣子；看一眼 `error-context.md` 的頁面快照就知道是被踢回登入頁。撥時鐘的測試要想到 session 也會一起過期。
2. **CSS transition 預設 `fill: backwards`，延遲期間 `getComputedTiming().progress` 是 0，不是 `null`。** 要判斷還在延遲裡，用 `currentTime < delay`。還在延遲裡就把狀態切回去，目標色等於現在的顏色，不會有新 transition，等事件會等到逾時。`transitionrun` 也要排到下一幀才發，要量當下就用 `MutationObserver` 配 `getAnimations()`。
3. **mutation 的紅也要看紅在哪。** 拿掉函式呼叫讓它變成沒人用，`tsc -b` 先失敗，測試根本沒跑。沒有斷言失敗的摘要就不算數，換成 `void fn` 這種編譯得過的弄壞法。

4. **「測試說卡住」要從旁邊問一次。** SW 卡 `activating` 被當真了兩週，還影響了 precache 的決定；問 SW 自己、發一個經過它的 fetch、另開分頁讀，一輪就知道卡住的只是頁面手上的物件。少量全過的對照（3/3、5/5）撐不起門檻結論。

5. **合成事件驗不到瀏覽器的焦點行為，對照組要真的會紅。** 搶焦點那條，發一整串合成事件都重現不了，真滑鼠 3 次全中；helper 的 `.click()` 打到 SVG 也會靜靜失敗。對照時，弄壞的版本要能紅，測試才算數。

6. **對照分不出差別時，就是還沒重現，別下結論。** 舊寫法與修正版一開始都 30 次全綠，那時的「鎖晚一步」只是推論。把探針加回去改變了時序才重現（40 次紅 5 次），也才看到 `locked=false`。**「偶發紅」裡可能藏真 bug**：這條在清單上掛了兩輪，查下去是會丟使用者資料的競態。也要小心反向斷言：`toBeVisible` 在動畫中照樣過。

7. **要測「前一筆還在路上」，別靠兩次 Playwright `click` 製造時序。** 每次 click 都要來回，機器滿載時兩下可能隔超過 300ms，前一筆早就回來，測到的就不是連按（`inline-edit` 負載下 40 次紅 2 次，產品行為與伺服器一致）。改在頁內連發（`pressStepsFast`），兩下之間只隔一個 task。頁內 `.click()` 是合成事件，只適合驗請求競態；焦點與指標行為照第 5 條用真滑鼠。

順帶：收合中的點擊原本到不了目標，所以用座標點一下、再用 `elementFromPoint` 看打到誰，比繼續讀碼快，一輪就找到 `InternalBackdrop`。

