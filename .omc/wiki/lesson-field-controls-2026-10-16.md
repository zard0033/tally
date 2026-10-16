---
title: "lesson-field-controls 填色控件的三條通則（2026-10-16）"
tags: ["css", "控件", "填色", "contrast", "review", "SegmentedControl"]
created: 2026-10-16T15:54:38.652Z
updated: 2026-10-16T15:54:38.652Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-field-controls 填色控件的三條通則（2026-10-16）

1. **填色欄位的底線用背景漸層畫成直線，不用 border-bottom、也不用 inset box-shadow。** 圓角 12 下兩者都會沿轉角彎成月牙，讀起來像按鈕的立體邊而不是底線；程式與測試都看不出來，截圖才看得出。做法：`background: linear-gradient(var(--line), var(--line)) no-repeat center bottom / calc(100% - 2 * var(--s-3)) 2px, var(--fill)`，聚焦只換 `--line` 與底色。e2e 要斷言就看 `backgroundImage`／`backgroundColor`，不是 `boxShadow`。
2. **填色疊在 `--raised` 上會隱形。** `--fill`（#F1E6D2）對 `--raised`（#F4EAD8）只有約 1.04:1，而對 `--card` 有 1.18:1；放欄位、步進器、分段軌道的容器底一律用 `--card`。同理，骨架條這類「比底淺一階」的元素也要換成更深的 token（`--rule`），不能沿用原本站在 `--paper` 上時選的 `--raised`。改底色時 grep 所有 `background: var(--raised)` 的容器，看裡面有沒有填色控件。
3. **改一個全站共用 class 的外觀，要 grep 手刻的副本。** `.seg` 原本有三個消費者，我只抽了兩個進 `SegmentedControl`，有氧 sheet 自己手刻的那份被漏掉；新外觀的選中態靠 `.seg-thumb` 子元素，手刻的那份沒有，選中態就只剩字重。review 抓到，測試沒抓到（舊測試只看 `aria-pressed`）。新外觀若依賴新增的子元素，測試要斷言那個子元素存在。
