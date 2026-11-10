---
title: "lesson-meal-suggest-v2 排序規則與 mutation 檢查的四條通則（2026-11-10）"
tags: ["餐建議", "排序", "mutation", "review", "v2.117"]
created: 2026-11-10T04:00:00.000Z
updated: 2026-11-10T04:00:00.000Z
sources: []
links: ["lesson-meal-suggest-2026-11-04.md", "e2e-reference.md"]
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-meal-suggest-v2 排序規則與 mutation 檢查的四條通則（2026-11-10）

1. **mutation 沒紅，先懷疑測試沒重現情境，不是懷疑 mutation。** 浮點那條第一版算例（已吃 0.1＋0.2）用 node 實算根本沒有誤差，拿掉捨入照樣綠。重現條件要用真函式實算出來（這次是 65−64.7 對 0.1＋0.2，差 2.9e-15），不要憑印象寫「這樣會有浮點尾巴」。

2. **mutation 的輸出要看到失敗行才算數。** 一處 mutation 讓某個 import 變成沒用到，`tsc` 先失敗、一條測試都沒跑，grep 過濾後的輸出只是「沒有結果行」，看起來像什麼都沒發生。改寫成不會編譯失敗的版本（`|| true`）才得到真的紅。

3. **「換到第幾名」這類畫面狀態，條件一變就丟掉，不要只拿來比對。** 只比對簽章時，切走再切回、復原把紀錄還原成舊樣子，簽章又對上了，舊的名次就回來。render 時發現簽章不同就 `setState(null)`；簽章要含所有會改變排序的輸入（日期、目標、當天紀錄）。

4. **spec 裡的決策樹、條列、AC 是三份會互相漂的東西。** 這輪改了條列（缺口 ≤ 0 不出）沒改決策樹與 AC，程式與測試照條列做，需求對照 review 才抓到。改規則時三處一起搜。
