---
title: "lesson-recovery-status 肌群恢復狀態的三條通則（2026-10-21）"
tags: ["recovery", "e2e", "time", "evidence"]
created: 2026-10-21T03:15:48.809Z
updated: 2026-10-21T03:15:48.809Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-recovery-status 肌群恢復狀態的三條通則（2026-10-21）

# lesson-recovery-status 肌群恢復狀態的三條通則（2026-10-21）

1. **先查文獻再定數字，起草的數字可能整組要改。** 階段 4 C 起草時六個肌群共用 36／48／72 小時窗口，查 2024 年回顧（PMC11057610）後發現下半身 48–72 小時、上半身 24 小時內，力竭多 24–48 小時，量大需求也大但個體差異大；窗口改成部位×組數。文獻沒給組數門檻，n=10 與各數字仍是設計決定，DESIGN 與畫面都寫「估算」。Schoenfeld 統合分析另說每週總量相同時訓練頻率對增肌沒有顯著差異，所以「可再練」標籤的價值偏向安排當天狀態，不是增肌。
2. **時間相關的 e2e 不接管時鐘：造資料用「距現在 N 小時前」、N 離窗口邊界很遠，顯示用無條件進位吸收測試執行的幾秒，邊界交給 unit。** `ended_at` 用 `Date.now() - N*3600000` 造；剩餘小時 `Math.ceil` 所以跑幾秒不漂；顯示的「X 天前」吃 `performed_on`（明寫），不吃時間點，避免凌晨跑測試日界翻掉。邊界（35／36 小時、47／48 小時）全在 `recovery.test.ts`，用固定的 `now` 參數，不碰時鐘。
3. **mutation 殺不掉的存活者就是缺的測試。** `daysAgo` 的 `Math.max(0, …)` 第一輪存活，補一條「performed_on 在今天之後」才殺掉；e2e 也要破壞一次確認會紅（把 `sets >= 10` 改成 `>= 11`，下半身剩餘小時 42 變 18，測試紅）。

相關：DESIGN.md v2.83、spec.md「階段 4 甲」口徑 4。

