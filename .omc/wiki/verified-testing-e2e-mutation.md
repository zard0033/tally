---
title: "verified-testing 已驗證事實：e2e 環境、mutation 檢查、量測與判讀"
tags: ["e2e", "mutation", "WebKit", "量測", "判讀"]
created: 2026-10-14T06:26:53.142Z
updated: 2026-10-14T06:26:53.142Z
sources: []
links: []
category: debugging
confidence: medium
schemaVersion: 1
---

# verified-testing 已驗證事實：e2e 環境、mutation 檢查、量測與判讀

- **e2e 撞牆兩層，都已從根上處理（v2.25）**：dev server OOM（改跑 `vite preview`）、WebKit 塞不下
  記憶體（`workers: 2` 守這層，**別拿掉**）。**兩層都表現成「Playwright 壞了」，真兇都不在
  Playwright**——先讀 `[WebServer]` 那幾行、再量機器餘裕。
- **抽共用元件的判準**（v2.29）：兩份長得像**不**構成理由，「本來就該一致、且已經開始不一致」
  才是。而**修分岔的那一輪最容易製造新的分岔**（那次三條缺陷有兩條自造）——**共同形狀：
  只盯著要修的缺陷，沒重新檢查它跟周圍的關係。**
- **新測試一律做 mutation 檢查才收**（v2.24 起每輪都做）：把受測行為改回舊樣子，確認對應
  測試變紅、其餘不誤報。**綠色測試不等於有效測試。** v2.33 那次它直接推翻假設——
  **mutation 不只驗測試有沒有效，也會告訴你它守的其實是哪一道防線**。
- **版面問題要量對東西**（2026-08-05 三處真機回報）：① 圖示「沒對齊」偏的是 SVG **筆畫**在
  viewBox 裡的位置（用 `getBBox()`）② `select` 放不下不會有 ellipsis，只是安靜切掉
  ③ 全域元件搬進新容器要重驗。**照肉眼改，①會改錯地方、③會整條漏掉。**
- **`backdrop-filter` 在 headless WebKit 裡靜默無效，真機是好的**（v2.38 診斷六輪，v2.39
  真機確認結案）：computed style 一切正常（值拉到 40px 照樣回報），截圖就是不糊。
  **可複用判準：computed style 正常 ＋ 截圖無效果 ＋ 對照實驗互相矛盾＝先懷疑環境，不是修法。**
  副作用：scrim 模糊**在 e2e 裡驗不到，別為它寫視覺斷言**。
- **一天連翻四次案，解藥每次都是「一個獨立來源的量測」**（v2.43 全文在 DESIGN.md）：**共同形狀
  ＝拿一個能解釋數字的故事當因果，卻沒先問「這些量測是不是在同一條件下取的」「量測工具驗過嗎」。**
  v2.45 又中一次（測試綠的是瀏覽器內建行為，不是修法）、v2.46 第三次（**既有測試轉紅時先分辨
  是前提失效還是斷言寫錯**——兩條都是前提失效，照原方法重量門檻，不是把數字調到綠為止）。
- **模型錯的時候是「自洽地錯」**（v2.43 遠拍組）：140 大卡配 2.6/4/24，用 4-9-4 回推得 142.4，
  完美自洽。**所以任何「拿模型自己的輸出做交叉驗算」的守門員都是假的**，跑兩次比一致性同理。
- **日誌的「空白」也是讀數**（v2.42）：函式 log 只有 Boot、零錯誤行，而每條失敗路徑都會寫 diag
  ⇒ 沒失敗過。再對 `edge_logs`：那次 OPTIONS 有完成列、**POST 只有 Boot 沒有完成列**（該列是回應
  送出時才寫）⇒ 被切斷不是回錯誤。**前提是你知道那條路徑本來會寫什麼。** 查「線上是不是新版」
  用**從外部打一次無授權請求當金絲雀**（會走 401 那條 diag），比翻部署紀錄直接。
- **e2e 跑 preview（production build）、dev 跑 StrictMode——只在 dev 發作的 bug 整套測試都照不到**
  （v2.42 `aliveRef` 只寫 cleanup，被 double-invoke 永久壓死）。**effect 旗標的 setup 那半不可省。**
- **e2e stub（`e2e/stub.ts`）不看 query 參數／filter**，只按 table+method 回同一份 fixture。
  後果：分頁資料差異測不了；`intake` 的 PATCH 不反映在後續 GET，**「重整後還在」的斷言驗不到
  真持久化**，只驗得到 App 本地 state 與 `cacheRef`。
- **screens 新增子頁不必上 router**：Settings.tsx 自己管 `view` state，同 App.tsx 的 `tab`。
- **把 DB 上分開的兩欄在 UI 層合併成聯集型別（v2.22 `GoalMode`）**型別漂亮但使用者覺得難用；
  事後拆要跨三處，比想像中貴。

來源：`session-state/active.md`（2026-10-14 搬入後該檔已刪；更早的歷史在 `session-state/archive-*.md`）。
