---
title: "verified-platform 已驗證事實：RLS、a11y 裁決、Supabase 暫停與重試、體重同步、離線 PWA"
tags: ["RLS", "aria", "Supabase", "keep-alive", "PWA", "離線", "體重同步"]
created: 2026-10-14T06:26:53.191Z
updated: 2026-10-14T06:26:53.191Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# verified-platform 已驗證事實：RLS、a11y 裁決、Supabase 暫停與重試、體重同步、離線 PWA

- **RLS 已驗，此題結案**（2026-08-05 實跑 `pg_policies`／`pg_class`：四張表各一條 `owner_all`、
  無第二條 permissive policy、RLS 全開）。**判準**：要驗的若是資料庫自己的行為而非我們的程式碼，
  把設定查完整就是充分證據；跨帳號 runtime 測試留給「policy 判斷式本身有分支」那種情況。
- **選中態語意的統一裁決（v2.30）**：互斥選一組一律 `aria-pressed`、容器不掛 `role="tablist"`，
  `aria-current` 只留給底部分頁列。**不補成完整 tablist 是刻意的**——半套 APG 契約比不做更糟。
- **「select 保證合法值」只涵蓋一半的路徑**（v2.30）：v2.22 拿掉自訂輸入後移除範圍檢查，
  理由是選單保證合法——但 `xTouchedRef` 沒被碰過時走的是 **DB 原值**那條分支，那個值
  沒有人驗過。新增 `clampToPresetRange()` 補上。**通則：拿「輸入源受控」當理由移除驗證前，
  先數清楚有幾條路徑通到那個變數**，受控的通常只有其中一條。
- [追加] **Supabase 免費專案閒置會被暫停，keep-alive 要驗「有沒有真的擋住」**（2026-10-12）：久未開 App ⇒ 後端 DNS 被撤 ⇒
  一直「載入中…」⇒ 登入頁 `Load failed`。Gambit 舊版每 3 天一次、回 200 的匿名查詢仍被暫停（官方只說「每天幾次
  user 查詢通常夠」）。現行 `supabase-keep-alive.yml`（每天 5 次 `foods`、只認 200）是**降低機率不是保證**；變紅多半＝
  已暫停（000／curl exit 6＝DNS 已撤，去 dashboard 按 Resume）。App 端「後端不可達」提示已於 v2.48 補上（看門狗＋`BackendUnreachableError`，全文 DESIGN.md v2.48）。
- [追加] **「卡 25 秒」的上限在函式庫的重試預算，不在我們的逾時**（v2.48，使用者點名要做）：auth-js 對 refresh 退避到 30 秒線才放棄，
  且放棄後 60 秒內同一顆 token 直接回快取的失敗。**做「重試」鈕前先查函式庫有沒有失敗冷卻**——再叫一次會立刻拿到同一個失敗，要 reload 才清得掉。
- [追加] **手謄的資料帶著謄寫者的流程，下結論前要對第二個來源**（2026-10-12）：Tally 體重 7 筆有 2 筆日期錯（月初當日期、
  填最近讀值：08-01＝08-21、09-01＝09-25 的讀值），我據此推出「記錄期間 +1.4kg」並駁倒使用者假設——被 Apple 健康匯出推翻：記錄 7 週持平、停記 5 週 +1.5kg。
- [追加] **體重自動同步**（spec.md 同名節）：Health→iOS 捷徑→`ingest-weight`（共用祕密、只寫 `weight`）；捷徑實測已過（77.35kg／24.6%）。
  mutation：token 比對／整批拒絕／同日先後各讓對應測試轉紅；**`user_id` 取自請求那個被權限擋下，該條未經 mutation 驗證。**
- [追加] **離線／PWA 實測事實**（全文在 spec.md「訓練記錄與離線」）：auth-js 網路錯誤時**不登出**，真問題是 token 過期後離線開機卡約 26 秒；`navigator.onLine` 在伺服器死了仍回「線上」、
  Playwright `setOffline` 在 WebKit 重載會丟內部錯誤，**離線測試一律把伺服器真的關掉**；iOS 主畫面 App 離線冷啟動與離線寫入可行（iOS 27.2），但**與 Safari 分頁儲存互不相通**。Tally **已有 standalone manifest**，缺的只有 SW。
- **已升格 DESIGN.md、這裡只留指標**：真機讀數的兩個判讀陷阱（v2.36——`getBoundingClientRect()`
  相對 visual viewport／指紋要先於一切數字被檢查）、motion 不把 drag 速度交給接手的 spring（v2.38）。

來源：`session-state/active.md`（2026-10-14 搬入後該檔已刪；更早的歷史在 `session-state/archive-*.md`）。
