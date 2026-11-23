---
title: "lesson-meal-vendor 每一餐記店家的三條通則（2026-11-23）"
tags: ["intake", "vendor", "e2e", "alias"]
created: 2026-11-23T15:04:53.493Z
updated: 2026-11-23T15:04:53.493Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-meal-vendor 每一餐記店家的三條通則（2026-11-23）

# lesson-meal-vendor 每一餐記店家的三條通則（2026-11-23，v2.161）

1. **快照欄只在缺的時候寫，讀取用 `??` 合併**：intake.vendor 只給通用食物（foods.vendor 為 null）寫，讀取一律 `foods.vendor ?? intake.vendor`（`rowVendor`）。好處：不用回填舊資料、食品庫改店家名照舊連動過去紀錄、寫入端只有一個判斷（`intakeVendor`）。餐建議的 RepeatItem 要分兩個欄位：顯示／排除用合併後的 `vendor`，寫回用來源自己的 `intakeVendor`，混成一個就會把食品庫店家寫進 intake。
2. **別名一個值當兩個用**：「店家 品名」第一個空白切開，比對鍵另收品名那段、搜尋去空白比對，就不必把品名再存一次。轉換前後要用「轉換前的每個別名都還對得到同一筆」驗（不是只數個數）。
3. **e2e 鎖 Base UI Autocomplete 的輸入框用 `getByRole('combobox', { name })`**：Autocomplete 會另外掛一個 `aria-hidden` 的 hidden input，`.xxx input` 會 strict mode 撞兩個。sheet 裡的輸入框離開焦點用 `locator.blur()`，不要按 Escape（可能把 sheet 一起關掉）。

