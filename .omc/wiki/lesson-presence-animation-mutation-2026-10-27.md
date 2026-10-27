---
title: "lesson-presence-animation 退場動畫與 mutation 的四條通則（2026-10-27）"
tags: ["AnimatePresence", "inert", "e2e", "mutation", "DateStrip", "v2.98"]
created: 2026-10-27T04:54:13.487Z
updated: 2026-10-27T04:54:13.487Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-presence-animation 退場動畫與 mutation 的四條通則（2026-10-27）

# lesson-presence-animation 退場動畫與 mutation 的四條通則（2026-10-27）

來源：v2.95 要點條、v2.97 動作庫搬移、v2.98 日期元件展開收合動效（DESIGN 對應版本紀錄）。

1. **退場動畫期間兩份 DOM 並存，所有「找元素」的地方都要排除退場那份。**
   AnimatePresence 讓離場的子元件留在 DOM 裡，新舊兩份都有同樣的 `data-date`、`aria-pressed`。
   做法：外殼元件（必須是 AnimatePresence 的直接子元件）用 `useIsPresent()` 在退場時標 `inert`＋`aria-hidden`＋`data-leaving`；
   選取器一律寫 `父層 > :not([data-leaving]) 目標`（元件自己的焦點邏輯用 `:scope > :not([data-leaving]) …`，e2e helper 同款）。
   漏掉的症狀：Playwright 嚴格模式報多重匹配、焦點落進 inert 的元素。
   `inert` 只擋真人操作與 hit-testing，**擋不了 `dispatchEvent`**——測試驗 `elementFromPoint` 落不到退場那份，不是派 click 看有沒有反應。

2. **量座標（滑動手勢、boundingBox）之前，先等退場走完。**
   AnimatePresence 會把退場中的子元件留在原本的排序位置：展開已落定時再收合，退場的月曆在上、新週列被擠到下面，座標會落在 inert 的元素上。
   helper（`gotoDate`）點完就等 `.datectl > .datectl-panel` 剩 1 份；自己手寫的收合步驟也要補同一行。這個坑同一天踩了兩次（`gotoDate` 與週列滑動測試）。

3. **mutation 存活＝防禦碼沒被執行，不是測試好。**
   要點條的 Esc 放棄原本是「設旗標、直接卸載輸入框」；拿掉旗標判斷，測試照綠——因為卸載輸入框時瀏覽器**不會補 blur**，旗標那行是死碼。
   改成 Esc 時自己 `blur()`，收尾全走 `onBlur` 這一條路，旗標才真的被走到，mutation 才轉紅。
   通則：寫完防禦碼一定做 mutation；活著就先查「這行到底有沒有被執行」，不要急著補斷言。

4. **在清單末尾加一個按鈕，會讓舊的「數列數」斷言失效；移動入口，會讓「返回後回到哪頁」的假設失效。**
   Picker 末尾加「新增動作」後，`picker.locator('.tr-row')` 的 count 多 1——改數 `[data-exercise-id]`（資料屬性），不要數樣式 class。
   動作庫搬到設定後，11 處「從動作庫返回」之後的步驟都要補切回訓練分頁。改入口前先 grep 所有走這個入口的 helper 與返回後的步驟。

