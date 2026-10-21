---
title: "lesson-rpe-and-ddl RPE 與 DDL 的三條通則（2026-10-21）"
tags: ["rpe", "ddl", "supabase", "mutation"]
created: 2026-10-21T06:32:47.518Z
updated: 2026-10-21T06:32:47.518Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-rpe-and-ddl RPE 與 DDL 的三條通則（2026-10-21）

# lesson-rpe-and-ddl RPE 與 DDL 的三條通則（2026-10-21）

1. **Tally 的 schema 變更我自己能跑，不用請使用者貼進 SQL Editor。** Supabase CLI 已登入使用者帳號：`npx supabase@latest db query --linked --project-ref bpnucfejoiazmsnsuzdb -o json "<SQL>"`（`--project-ref` 必須搭 `--linked`；多條語句只回最後一條的結果，驗證要分開查）。先用 information_schema 讀現況、再執行、再回讀欄位與 `pg_get_constraintdef`。我一度在 spec 裡寫成「DDL 由使用者執行」，是沒先查有沒有 CLI 登入就假設做不到。Tally 專案 ref 與 Gambit 不同，`projects list` 兩個都會列。
2. **新增「規則推出來」的判斷會改到既有測試的前提，跑全量 unit 才看得到。** 熱身判斷（重量 < 當天最重 60%）讓一條既有測試（同一動作混 0 kg 與 20 kg）掉了一組；那是規則本身的正常結果，不是 bug。處理是改測試的資料（拆成兩個動作）並把「混 0 kg 徒手組會被當熱身」寫進 spec 與 DESIGN 的已知限制，不是為了讓測試綠就放寬規則。
3. **用 Python 文字模式改檔會把整個檔轉成 CRLF（Windows）。** repo 的 HEAD 本來就是 CRLF（autocrlf），所以 diff 沒有噪音；但寫反向的 mutation 腳本時，多行 `from` 字串要先看檔案是 CRLF 還是 LF，否則 NOT FOUND 會被誤讀成「mutation 存活」。腳本裡別用字面 `\r\n`（寫檔時被 Python 轉義吃掉會變成語法錯誤），用 `String.fromCharCode(13, 10)`。

