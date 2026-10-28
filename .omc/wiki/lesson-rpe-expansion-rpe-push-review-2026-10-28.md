---
title: "lesson-rpe-expansion RPE 擴大用途與 push 前 review 的五條通則（2026-10-28）"
tags: ["RPE", "review", "e2e", "文獻", "v2.105"]
created: 2026-10-28T05:35:47.406Z
updated: 2026-10-28T05:35:47.406Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-rpe-expansion RPE 擴大用途與 push 前 review 的五條通則（2026-10-28）

# lesson-rpe-expansion RPE 擴大用途與 push 前 review 的五條通則（2026-10-28）

1. **文獻只給方向時，規則數字要在 spec 標「我定的」。** Helms 2016（RIR 版 RPE）沒有給「該加多少重量」的演算法；Robinson 2024 預印本（未審查）說離失敗越近增肌越多、沒有找到 RIR 界線、效果隨重量變輕變明顯、只分析總組數相同的研究。所以「RPE ≥N 才算有效組」撤回，改成顯示 RPE 分布，不下判斷。決定前先讀全文，不憑摘要。
2. **回報的 RPE 平均低估剩餘下數約 1 下**（Halperin 回顧 414 人，不分新手老手；Helms 2016 說老手較準，兩邊不一致）。依 RPE 修正的 e1RM 會偏保守，先不補償、只標註；商業網站「新手低估 2–4 下」的說法不要再引。
3. **新 UI 的條件要用「語意對的函式」並測邊界資料。** 編輯動作 sheet 的縮圖用了 `catalogKey`（對沒有圖的預設動作也回 key），應該用 `hasCatalogImage`；測試只測了新增與自建，漏了「有 key 但沒圖」的三個預設動作。獨立 review 才抓到。
4. **顯示態與編輯態的 padding 要一致，否則點進去會換行跳高。** 輸入框為清空鈕留 44px 右內距、平常色塊只留 12px，長度落在兩者之間的內容會跳。測試要用「落在兩者之間的長度」。
5. **失焦才存的欄位加按鈕，失焦收尾要放外層、看 `relatedTarget`。** 否則 Tab 到按鈕那一瞬間整塊卸載、焦點掉回 body。小標籤／角標用實機 DOM 截圖驗：樣張看不出它會蓋住組號數字（28px 欄、數字在正中）。

另：學術全文被站方擋（403／Client Challenge）時不要繞過（換 UA、headless 都算），請使用者下載 PDF 給路徑，用 `pdftotext` 轉文字再讀。

