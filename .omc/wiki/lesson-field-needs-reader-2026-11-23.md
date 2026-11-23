---
title: "lesson-field-needs-reader 欄位與分類要先有讀取端（2026-11-23）"
tags: ["schema", "food-library", "ux-copy"]
created: 2026-11-23T04:00:00.000Z
updated: 2026-11-23T04:00:00.000Z
sources: []
links: ["lesson-food-library-redesign-2026-11-22.md"]
category: pattern
confidence: high
schemaVersion: 1
---

# lesson-field-needs-reader 欄位與分類要先有讀取端（2026-11-23）

v2.153 加的「一份幾克」與四種來源，使用者真機一看就問「這要幹嘛」，v2.155 拿掉／併掉。

1. **加欄位前寫出誰讀它**：spec 只寫「知道才填」、沒有任何畫面或計算讀它的欄位，就是不該加的欄位。一份幾克只存不用，整欄刪掉（含 DB）。
2. **分類的格數照「使用者要做的判斷」定，不照資料的來處定**：來源要回答的只有「這個數字能不能信、先核對哪些」，標示與官方對使用者沒差，四種併成「官方標示／粗估」兩種。仿別的 app（FoodKcalNotes）拆的分類要回頭對使用者的用途。
3. **欄位名不用問句**：「數字從哪來」改回「來源」。
4. **DB 換欄的補對應要限時間**：新前端不寫舊欄時，「where not verified」補對應會把部署後手動改的值翻回去；只補加欄位之後舊版新建的（created_at 條件）。刪舊欄前先確認每台裝置（含 iOS 主畫面 PWA）都換到新版。
