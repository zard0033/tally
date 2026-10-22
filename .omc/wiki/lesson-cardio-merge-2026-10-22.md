---
title: "lesson-cardio-merge 有氧併入動作的四條通則（2026-10-22）"
tags: ["cardio", "prefill", "migration", "review", "e2e"]
created: 2026-10-22T06:45:58.211Z
updated: 2026-10-22T06:45:58.211Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-cardio-merge 有氧併入動作的四條通則（2026-10-22）

# lesson-cardio-merge 有氧併入動作的四條通則（2026-10-22）

1. **預填的值若同時被當成「已記錄」的判準，就會把沒做的記成做了**。重訓的預填組是 `done=false`，預填與做了分得開；有氧卡沒有勾，「分鐘有值＝有記錄」又讓預填分鐘變成假記錄，還會傳給下次預填。設計「沒有確認動作的卡」時，預填不能含判定欄位（這次改成分鐘留空、sheet 欄位用 placeholder 提示上次值）。是獨立 review 抓到的，我自己 spec 的 D5 與 AC 3 互相打架卻沒發現。
2. **資料遷移別讓 SQL 與 app 兩邊各算一次確定性 id**（uuid v5 差一個字元就多出重複的預設動作）。改成 app 先建、SQL 用自然鍵 `(user_id, kind)` 去找，找不到就 raise exception；順序多一步「部署後開一次 App」。
3. **樣張省略了元素，寬度與折行的結論不能直接搬到實作**。樣張為了簡化省掉握把與縮圖，393 寬下摘要放得下一行；實作時名稱欄只剩約 150px，健走三欄折成兩行。下游 executor 擅自改成一行截斷，結果坡度數值被截掉；應該先問「這張卡唯一的內容是什麼」，內容不能為了高度犧牲。
4. **拆入口時，找「至少 N 個」這類寫死元素數量的測試**：開始訓練 sheet 拿掉「記一筆有氧」後，可聚焦元素從三個剩兩個，spring-sheet 的焦點循環測試要求「至少 3 個」而變紅，單看有氧相關的測試抓不到，只有全量才會發現。

附帶：多層改動（lib → UI → e2e）用「只加不刪舊匯出，UI 步驟才拆舊的」分步，每一步 tsc／vitest／lint 都保持綠；用 service key 做唯讀查證（筆數、自動補條件）要把金鑰留在腳本裡、只印聚合結果。

