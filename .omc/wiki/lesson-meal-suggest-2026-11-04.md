---
title: "lesson-meal-suggest 一鍵多筆寫入與復原的四條通則（2026-11-04）"
tags: ["餐建議", "競態", "review", "e2e", "v2.115"]
created: 2026-11-04T06:10:47.859Z
updated: 2026-11-04T06:10:47.859Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-meal-suggest 一鍵多筆寫入與復原的四條通則（2026-11-04）

1. **「丟棄舊 GET」要先問丟棄之後誰補畫面。** 計畫寫 `loadDay`、`load` 比對世代、舊的就丟棄，實測兩條都出事：Notice 重試的 `loadDay` 已清空畫面，丟棄後一直卡著；`load` 丟棄後把 Notice 清掉，畫面剩舊列與卡片，可以再寫一次。改成世代變了就重抓（`listIntakeFresh`，上限 3 次）。只有不碰畫面的 `prefetchDate` 能直接丟。

2. **多筆寫入的洞要順著「同餐變兩份」找所有入口，不是只防連按。** 這輪找到的路徑：待刪的 DELETE 失敗或還在路上時 POST 照送、加入中從 sheet 再寫、sheet 寫入中關掉再按卡片、復原在途從 sheet 再加、舊 GET 蓋回讓卡片復活。每條測試當時都是綠的，都是獨立審查推演出來的。

3. **審查要連修法一起審。** 第一輪修法引入的鎖、世代、重抓，在第二、三輪又抓到新問題（反方向的重複寫入、DELETE 在途繞過防線）。修競態的 commit 不能只看新測試綠。

4. **e2e 量不到「它已經落地」時，等待只能防假紅、防不了假綠。** 舊 GET 或失敗回應落地沒有訊號，只能 `waitForTimeout` 兜，機器太慢時會假綠。斷言前先確認前置真的成立（例如「這時 DELETE 應該還沒落地」），否則那條測試什麼都沒驗到。另外，`.pair` 是 `nowrap`，「不折行」恆真，要量字寬；`page.clock.install` 用過去時間可行，固定星期不用另外切日期。

順帶：`TaskStop` 停背景 e2e 只殺外層 shell，playwright 與 preview 會留著占 5501，要 `taskkill /T`。
