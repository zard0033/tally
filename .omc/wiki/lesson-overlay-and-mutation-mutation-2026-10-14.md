---
title: "lesson-overlay-and-mutation 疊層元件與 mutation 的兩條通則（2026-10-14）"
tags: ["蒸餾", "vaul", "e2e", "mutation"]
created: 2026-10-14T08:42:00.062Z
updated: 2026-10-14T08:42:00.062Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-overlay-and-mutation 疊層元件與 mutation 的兩條通則（2026-10-14）

# 疊層元件與 mutation 的兩條通則（2026-10-14，v2.55＋review 修正）

- **兩套 modal 函式庫疊在一起時，內外由 DOM 包含關係決定**：vaul（Radix）把掛在 body 的 Base UI 對話框當「外面」，焦點被搶回、點擊被攔、Escape 兩邊都收。DESIGN 寫「z-index 高一級就蓋得上去」是沒在真實疊層下測過的假設。疊層的新組合第一次出現時，e2e 要驗「預設焦點」「按得到」「Escape 只關最上層」三件事。
- **斷言「某物仍在」要等過它的消失動畫**：關閉中的 sheet 在動畫期間仍 `toBeVisible`，這種斷言對「被一起關掉」沒有鑑別力；先 mutation 拿掉修正，看它會不會紅。
- **mutation 測失敗路徑時，故障要注入在「第二步」**：enqueueMany 的測試原本讓第一次 save 就失敗，逐條寫與一次寫的結果一樣，mutation 活下來；改成「快照有 ≥2 條就失敗」才分得出來。
- review 抓到的佇列問題全文：notepad MANUAL「review 修正清單」；修正在 41bd5cd、ab27dc0。

