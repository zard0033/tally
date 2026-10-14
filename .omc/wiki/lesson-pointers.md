---
title: "lesson-pointers 教訓指標與蒸餾（本體已升格，這裡只留指標）"
tags: ["蒸餾", "DESIGN.md", "ledger"]
created: 2026-10-14T06:26:53.287Z
updated: 2026-10-14T06:26:53.287Z
sources: []
links: []
category: reference
confidence: medium
schemaVersion: 1
---

# lesson-pointers 教訓指標與蒸餾（本體已升格，這裡只留指標）

**蒸餾（歷次教訓 ①–⑳、v2.53 四條）** 已於 2026-10-14 整段搬到 [archive-2026-10.md](session-state/archive-2026-10.md)；通則升格 DESIGN.md 的看其版號，新的蒸餾一句寫在這裡。
**第 3 段蒸餾**：mutation 腳本在子程序裡跑 vitest，第一次四個 mutant 全顯示 `exit=1`、看似全紅，實際是整個測試檔載入失敗（`Tests no tests`）——**判轉紅要讀 `N failed | M passed` 的計數，`no tests` 是環境失敗、不是 mutation 被抓到**；改走 PowerShell 後才得到每個 mutant 恰好 1 條失敗。


- **設計決策與被否決的做法** → `DESIGN.md`（動 UI 前必讀、改完必回寫，已入 CLAUDE.md Pre-Push Checklist）。
- **全域 ledger memory**：`windows-shell-ledger`、`verification-ledger`（＋`ui-verify` skill）、`delegation-ledger`。
- **真機／真實資料試用是設計核可之外的必要一關**：三層（樣張核可／真機試用／deep review）各抓到不同類的問題。

來源：`session-state/active.md`（2026-10-14 搬入後該檔已刪；更早的歷史在 `session-state/archive-*.md`）。
