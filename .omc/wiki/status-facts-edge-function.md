---
title: "status-facts 現況：線上、棧、Edge Function 部署旗標、測試基線"
tags: ["線上", "Supabase", "Edge Function", "vitest", "e2e"]
created: 2026-10-14T06:26:53.047Z
updated: 2026-10-14T06:26:53.047Z
sources: []
links: []
category: environment
confidence: medium
schemaVersion: 1
---

# status-facts 現況：線上、棧、Edge Function 部署旗標、測試基線

- **線上**：`https://zard0033.github.io/tally/`（GitHub Pages，push main 後 Actions 自動 build＋部署）。
  棧＝Vite + React 19 + TS + Tailwind 4 + shadcn(Base UI) + vaul + motion + supabase-js。
- **功能**：第一版全數上線＋額度預警提示＋今日頁品項就地編輯＋每日目標計算引擎＋食品庫管理
  與設定頁重構。逐版細節一律看 DESIGN.md 版本紀錄，這裡不再複述。
  **已上線＝v2.52**（逐版細節在 DESIGN.md）。**v2.45 拍照讀營養標示之後**：v2.46＝鍵盤真正機制（見續點 2 ③）；
  v2.47＝預先記錄明天（界在 `dates.ts` 的 `maxPlanDate()`，全文 DESIGN.md v2.47）。v2.48（後端連不上提示）、v2.49／v2.50（實測維持熱量卡）亦已 push；**v2.51（離線開機，推翻 v2.48 開機畫面決策）、v2.52（網路回來自動恢復）已上線並經真機驗證**。
  Edge Function `read-label` 部署在 Supabase（**`--use-api --no-verify-jwt` 兩個旗標缺一不可**，
  理由在 spec 與 DESIGN v2.40；本機沒有 Docker，預設打包路徑會靜默失敗成 404）。`ingest-weight` 同旗標，**2026-10-12 已部署並線上驗證**。
  仍在生效的兩條地基：走 vaul 的 sheet 一律 `repositionInputs={false}`、sheet 的 top 吃 `--vvtop`（iOS 鍵盤三題已真機驗過結案；`?debug` 讀數列已移除，要用從 git 撿）。
- **測試**：`npx vitest run` 470/470（含 `dates` 31、`queue` 89、`training` 85、`trainingRuntime` 19、`queueStore` 16、`sender` 16、`uuid` 8、`ingest-weight` 54、`baseline` 46、`session` 18）；`npm run build`／`npm run lint` 乾淨；`npm run e2e`
  **147/147（「慢態有出口」那條先前單跑必紅，2026-10-14 全跑為綠，原因未查、不算修好，見未解失敗）**（約 3.5 分，十三個 spec 檔，涵蓋範圍見 CLAUDE.md）。**條數以實跑輸出為準**——
  2026-08-12 又漏算一條被 review 抓到；且條數（147／13／470）有四份文件在寫（CLAUDE.md、本檔、
  兩份 README），改要一次改到底。DESIGN.md 版號刻意不寫進 README——每輪 UI 都 bump，寫死必過期。

來源：`session-state/active.md`（2026-10-14 搬入後該檔已刪；更早的歷史在 `session-state/archive-*.md`）。
