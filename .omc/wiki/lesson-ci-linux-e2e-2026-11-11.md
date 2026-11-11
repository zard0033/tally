---
title: "lesson-ci-linux-e2e 全量 e2e 搬到 Linux CI 的五條通則（2026-11-11）"
tags: ["e2e", "ci", "flaky", "webkit", "linux"]
created: 2026-11-11T04:00:00.000Z
updated: 2026-11-11T04:00:00.000Z
sources: []
links: ["lesson-flaky-root-cause-2026-11-03.md", "e2e-reference.md"]
category: pattern
confidence: high
schemaVersion: 1
---

# lesson-ci-linux-e2e 全量 e2e 搬到 Linux CI 的五條通則（2026-11-11）

背景：全量 e2e 從本機（Windows WebKit，2 worker，14 分鐘）搬到 GitHub Actions（ubuntu WebKit、無 GPU）。首跑紅 8 條，本機全綠；四輪後全綠部署（run 42942213668）。

1. **CI 每片 1 個 worker**：4 片×2 worker 時動畫幀率被拖垮，紅 8 條；8 片×1 worker 降到 2 條，牆鐘差不多。根因假設在 8 片首跑前就標成假設，靠下一輪驗證。
2. **「等動畫落定」要判「停在終點」，不是「兩次讀數一樣」**：spring 衝過頭的最高點速度≈0，慢幀下兩次讀數相同就被誤判落定（頂緣 88≠96、儲存鈕差 2px）。只判「在終點附近」又會在穿過終點的瞬間誤判。兩個都要：相隔 80ms 兩次都在 0 附近。共用一份放 `e2e/harness.ts` 的 `springSettled`，別在每個 spec 各抄一份（這次三份同一個缺陷）。
3. **本機重現不了就讓 CI 交證據**：失敗時上傳 test-results（截圖＋trace），另開只能手動觸發、不部署的 `e2e-diag.yml` 跑指定測試加探針。這次靠截圖看到「反白」才找到左滑的真因，探針數據推翻了「8px 捲軸」假設——沒證據時兩個假設看起來一樣合理。
4. **Linux WebKit 會在拖曳時選取文字**：往下拖過組列會從非 button 的文字（組號、列外空白）開始選取，下一次左滑按在選取上變成拖曳文字、pointer 被取消。只鎖 `.swipe-row` 不夠，要鎖整個手勢區（`.ex-body`）、把 textarea 解回來。推測修法上線前在 DESIGN 標「推測、以 CI 轉綠為準」，綠了才改成已驗證。
5. **測試的偶發紅背後可能是產品競態**：rest-timer 連點時問 RPE 的判斷用到還沒落地的畫面狀態——測試改成等勾翻轉之外，app 也要修（`withPendingDone`）。review 時問一句「真機上手指夠快會不會一樣」。Playwright 自己的點擊重試也會捲動頁面（第 4 次 `scrollIntoView({block:'start'})`），點之前先等 sheet 停穩，不要把它當成 app bug 去修。
