---
title: "lesson-exercise-images 動作示意圖的四條通則（2026-10-17）"
tags: ["vite", "pwa", "catalog", "mutation"]
created: 2026-10-17T07:06:03.285Z
updated: 2026-10-17T07:06:03.285Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-exercise-images 動作示意圖的四條通則（2026-10-17）

# lesson-exercise-images 動作示意圖的四條通則（2026-10-17）

1. **Vite 預設把 < 4KB 的資產轉 base64 內嵌進 JS**（`assetsInlineLimit` 4096）。150 張動作圖裡 54 張小於 4KB，被吞進主 bundle（JS 1.03MB→1.28MB），而且它們不是獨立檔案、不會被 workbox precache。用函式形式 `assetsInlineLimit: (file) => file.includes('/assets/exercises/') ? false : undefined` 只對那個目錄關掉；建置層要有斷言（主 JS 不含 `data:image/webp`、`sw.js` 列出的 webp 數量＝圖數），單看 UI 測不出來。workbox `globPatterns` 也要記得加副檔名。
2. **「補一批預設資料」要用與寫入規則相同的唯一性判斷。** `checkExercise` 規定動作名稱不能重複（含已封存），所以補齊只比確定性 id 會建出同名列，兩列連「只改要點」都存不了，而 `exercises` 只能封存不能真刪。補齊的清單要同時排除「id 已在」與「名稱（foldName）已在」；測試也別把「同名照補」寫成預期行為（我自己寫的測試就這樣把 bug 固定住了，兩位審查者獨立抓到）。
3. **id 演算法要有字面值測試。** 確定性 id（uuid v5）同時決定預填會不會重複與圖對不對得上；只測「自己跟自己一致」，namespace 或組字格式被改時全綠、既有帳號的圖全退成肌群字。字面值要取自獨立實作（Python `uuid.uuid5`）。
4. **mutation 與 e2e 的坑**：①弄壞的程式要編得過（TS 未使用 import 會讓 webServer 建置失敗，輸出像「沒抓到」）；②`python -I` 隔離模式忽略 `PYTHONUTF8`，輸出中文／符號會 cp950 崩潰，腳本內自己 `sys.stdout.reconfigure(encoding='utf-8')`；③MutationObserver 的 `addedNodes` 不含整塊新掛入子樹裡的後代、同一節點可能重複通報、連續呼叫要先 disconnect 舊的；④「不蓋回」型測試要真的製造衝突（stub 的 `__trainPut` 放一列本機不知道的），否則被 id 排除在外的列本來就不會被蓋，測不到 `ignoreDuplicates`。

