---
title: "e2e-reference 各 spec 涵蓋範圍、偶發紅清單、歷次跑測紀錄"
tags: ["e2e", "flaky", "跑測紀錄"]
created: 2026-11-02T01:46:40.000Z
updated: 2026-11-11T14:30:00.000Z
sources: []
links: []
category: reference
confidence: medium
schemaVersion: 1
---

# e2e-reference 各 spec 涵蓋範圍、偶發紅清單、歷次跑測紀錄

2026-11-02 從 CLAUDE.md 搬來（原本全塞在一條 bullet，每個請求都要載一次）。跑測規則留在 CLAUDE.md，這頁放會隨版本變動的細節。**每輪跑測的紀錄寫在這頁「歷次跑測紀錄」最上面，不要寫回 CLAUDE.md。**

條數一律用 `npx playwright test --list` 實測，這頁的數字都是當時的快照。

## 偶發紅清單

再紅先對這張表；不在表上的先對乾淨基線驗，別直接當偶發放過。

| 條目 | 已知狀況 |
| --- | --- |
| `tally.spec`「填份量後直接按加入」（`.pick-bar-btn` 等不到 stable） | 2026-11-11 v2.125 本機 smoke（2 worker）紅 1 次，失敗後整份累積狀態連鎖紅（sheet 沒關、後面的點擊被攔）；同一份 code 單跑 tally.spec 綠、再跑一次 smoke 55 全綠。改動（插圖前景改紙、踏腳石命中區）不碰記錄 sheet，推測是負載下 sheet 動畫落定慢、5 秒內按鈕沒穩；**假設，未對乾淨基線重複驗**。再紅就對 `914e754` 重複跑比次數 |
| `tally.spec` 復原提示條 `.undo-bar` 一族 | 2026-10-21 查過：headless WebKit 的 rAF 有些輪掉到 30Hz，220ms 退場動畫實測 258–440ms，寫死的 300／400ms 等待時過時不過。後半段改 `settle`（乘 2）後單 worker 重複 10 次全過；前半段 120–200ms 的等待沒動，再紅先看是不是同類。 |
| `interaction`「本機 session 格式認不得…慢態有出口」 | 時紅時綠，原因未查。2026-10-16 stash 回基線也紅過，當輪判定與改動無關。2026-11-02 整檔跑紅一次（`載入中…` 沒轉成 `比平常慢`），單跑 8 次全過。**2026-11-04 紅率高很多**：乾淨基線 `1140e9f` 重複 16 次紅 8 次、餐建議那批改動重複 8 次紅 2 次，都紅在等 `比平常慢` 那句（`interaction.spec.ts:1007`，測試本體 :999：`page.clock.runFor(120_000)` 之後的斷言）。基線一樣紅，與那批無關；原因未查。**2026-11-12 本機幾乎必紅**：乾淨基線 `8a7daec` 2 worker ×4 紅 2、1 worker ×8 紅 8；v2.132 那批 4＋8＋3 次全紅——兩邊一樣，不是改動造成。CI 靠重試才過（同日 3367c86 全綠）。使用者 2026-11-10 說先不查。 |
| `spring-sheet`「開啟中點一下把手」 | 動畫 3 秒內沒落定，原因未查。2026-10-21 單獨重複 20 次全過、整套才偶發；2026-10-27 乾淨基線單跑 6 次紅 1 次、該輪單跑 6 次紅 2 次。 |
| `settings-nav`「三個入口都進得去」（從體重趨勢返回，lazy chunk）、「進次級頁收起底部列」 | 前者原因未查，單獨重複 20 次全過、整套才偶發；後者單跑 50 次紅 1 次（沒有查過原因的紀錄）。2026-11-02 兩條各紅一次，都是「從體重趨勢返回」，單跑各 8、15 次全過。推論（未驗證）：lazy chunk 在點擊途中載完，fallback 的返回鈕被真頁面換掉，那次點擊落空；基線 `efc1999` 也發生過，不是清理造成的。 |
| `food-library`「開啟 sheet 後焦點進到 sheet 裡」 | 原因未查。乾淨基線 `5ad1b89` 重複 16 次紅 4 次，該輪改動重複 12 次紅 1 次。 |
| `training.spec`「訓練中排序（指標拖曳）…被拖的卡是收合後的高度」 | dnd-kit 位置觀測非同步，斷言已改輪詢（DESIGN v2.71）。2026-10-22 又紅過一次，單跑 5 次全過。 |
| `training`「收合時第二行看進度…新增一組是最後一組下方的整列」 | 2026-11-12 CI（d4fc0cf，shard 8）兩次都紅、紅點不同：展開卡片途中點勾、點「新增一組」落空；本機 10/10 綠。測試改用 `toggleCard(card, want)` 等展開／收合停在終點（高度 auto＋不透明度 1／body 不在）再點。再紅先看是不是別條也在展開途中點。 |
| `training`「全部完成：逐組進行中單點一組，換色不被逐組的延遲拖慢」 | 2026-11-03 修過「還在 120ms 延遲裡就點」。2026-11-13 CI（`1afbe31`，shard 7）兩次都紅、量到 `delay = -1`（找不到背景色 transition）：等到 `transitionstart` 就點，慢機器上那一刻進度近 0、算出的顏色捨入後仍等於未完成色，取消完成不起新 transition。改成用 rAF 等 `getComputedStyle` 的底色真的離開未完成色才點；本機 10/10 綠，mutation（`endCascade` 變 no-op）3/3 紅 120。再紅先看 `hadClass` 前提有沒有過（rAF 拖太久會超過逐組 class 的約 540ms） |
| `rest-timer`「休息條答 9 之後，組編輯 sheet 裡 RPE 9 是高亮的」 | 逾時，單跑 8 次與整檔重跑都過。2026-11-12 整檔 `--repeat-each=6`（33 條×6＝198）全過、0 flaky——連點不問 RPE 的競態 v2.122 已修（產品端 `withPendingDone`＋測試 `tick` 等勾翻轉），這條再紅才重開。 |
| `analysis`「訓練分析入口列…」（返回訓練） | 2026-11-04 smoke 紅一次，單跑 10 次全過，原因未查。同樣是返回後等畫面，可能跟 `settings-nav` 的 lazy chunk 同類，這只是推論。 |
| `meal-suggest`「加入中切設定再切回…」、「sheet 寫入失敗：寫入中關不掉…」 | 2026-11-10 push 後全量（`da43c7b`，跑了 21.9 分鐘、比平常慢約 5 分鐘＝機器忙）各紅一次（15.2s、11.5s，前者紅在 `toHaveText`）。之後兩條各單跑 6 次、`meal-suggest` 整檔再跑一次全過。兩條都靠寫入延遲排時序，推論（未驗證）負載下等待逾時。**沒對乾淨基線重複**：只在全量負載下出現、單跑重現不了，對照不出差異；那批只改每日目標頁、設定頁一句副標與 `.goal-*` 樣式，沒碰餐建議的寫入與 sheet。原因未查。 |
| `meal-suggest`「「全選」命中區 ≥44×44…」 | 2026-11-10 餐建議第二版整檔跑紅一次，失敗細節被之後的單跑蓋掉、沒留下。之後單跑 8＋20 次、整檔再跑一輪全過（約 30 次紅 1 次）。**沒對乾淨基線重複**：這個重現率對照不出差異；這批沒動 `LogSheet` 與 sheet 的 CSS。測試量的是 spring 落定後的 `elementFromPoint`，推論（未驗證）跟負載下 sheet 還在微動有關。原因未查。 |
| `interaction`「日期快取 5 — 慢請求…」 | 2026-11-02（週一）全量紅一次：點日期格前等元素穩定逾時 5 秒。單跑 12 次、整檔跑都過。週一往前一天會跨週要開月曆，多一段動畫，負載下可能逾時，這只是推論。 |

## 各 spec 涵蓋範圍

分二十一個檔（快照，含各檔在測什麼）：`daily-goal.spec.ts`＝每日目標 54 條（2026-11-04 `--list` 實測）：只送改動的欄位、改了就存與失敗退回、頁面關了才失敗要提示、連改與舊值競態、確認卡與改用、改回公式、四種狀態、自訂目標、NaN 不進畫面、iOS 等不到失焦時要主動存；`meal-suggest.spec.ts`＝餐建議 R、第二版與營養素條差 N 55 條（2026-11-10 `--list` 實測；第二版 5 條：晚餐依缺口挑與刪午餐換回常吃、換一個輪流與 sheet／加入跟著與紀錄變動回第一名、超 N 卡與命中區列高、單一候選無換一個、過去的日子不依缺口挑；目標用自訂目標釘死；改紀錄要 `intakePersist`，否則加入的列不會落地）：今日頁一鍵加入與復原、平日假日取來源、該餐已有紀錄、寫入失敗、連按、途中切日期或刪別筆、切分頁收窗、查詢失敗、加入後切明天的來源、sheet 建議段與全選、封存食物、同食物不重複、差 N 的顯示規則與字寬、待刪送失敗不寫、舊 GET 與舊預取丟棄、重撈不畫回已刪列、鎖與錯誤跨重掛、重撈失敗、段落順序、命中區、sheet 寫入中鎖住、待刪的 DELETE 已在路上、舊回應蓋掉 sheet 與就地編輯的新寫入（重抓）；開場一律用 `openAppAt` 釘日期，要走寫入後重撈的用 stub 的 `intakePersist`，要造舊 GET 或重撈失敗用 `__holdIntake`／`__failIntake`；`weight-suggest.spec.ts`＝組編輯 sheet 的重量建議 7 條：槓鈴 +5／啞鈴 +2.5／器械維持／自建 +2.5、套用與已套用、徒手不出現與資料不足、進行中不算歷史、課表目標次數、離線；預期值手算；`tally.spec.ts` 累積狀態的全份回歸（**偶發紅**：今日頁復原提示條 `.undo-bar` 一族，基線 `ddb5292` 單跑 10 次也紅 2 次，**2026-10-21 在已 push 的 `8dacb49` 單 worker 重複 6 次紅了 5 次（失敗點在「復原後提示條應該消失」「滑到底直接刪除」），同一天稍早的全量卻是綠的——所以不是這批改動造成**；原因已查（2026-10-21）：headless WebKit 的 rAF 有些輪掉到 30Hz，220ms 的退場動畫點完到消失實測 258–440ms，原本寫死的 300／400ms 等待時過時不過；後半段各步的等待改成 `settle`（乘 2）後單 worker 重複 10 次全過；前面的路徑（前半段 120–200ms 的等待）沒動，若再紅先看是不是同類；單跑重複的過濾字串用 `tally.spec`——寫 `tally` 會比對到 repo 路徑而把整套都跑進去）、`interaction.spec.ts` 47 條可單獨跑的互動路徑（含日期元件展開收合動效 6 條，含離線開機、登出分流、網路回來自動恢復、飲食頁底部列浮起與霧化帶不攔截、展開最後一列不被底部列蓋住、sheet 收合中的點擊不被 scrim 吃掉）、`vendor-autocomplete.spec.ts`、`meal-exit-animation.spec.ts`、`quota-warning.spec.ts`、`inline-edit.spec.ts`、`intake-detail.spec.ts`、`daily-goal.spec.ts`、`food-library.spec.ts`、`settings-nav.spec.ts`（含設定頁底部的 Gym visual 致謝）、`analysis.spec.ts`（訓練分析 17 條——**肌群狀態 7 條**：分段切換與六列順序、各列狀態與剩餘小時、說明小字、沒有訓練、取最近一次、離線、RPE 近力竭與熱身；`ended_at` 用「距現在 N 小時前」造、離窗口邊界很遠，不接管時鐘，邊界由 `recovery.test.ts` 守；動作進度 10 條：入口列與副標、列表順序與數字〔超過 10 下／0 kg／沒打勾的組不算〕、單一動作的最佳值與最近一次與明細、範圍切換、十字線讀數、空狀態與單點、離線；預期值手算）、`recovery-foreground.spec.ts`（肌群狀態回前景重取「現在」，1 條；獨立成檔因為要接管時鐘）、`weight-trend.spec.ts`（體重趨勢頁：兩張圖與明細、範圍切換、7 日平均端點、十字線同步與讀數、各種空狀態與離線）、`form-macros-align.spec.ts`、`training.spec.ts`（訓練分頁：從本機底讀資料、連不上伺服器時的說明、預填整份目錄、動作示意圖與自動補預設動作（縮圖、既有帳號自動補、同名不補、自建庫不補、建置層不內嵌）、開始／記組／完成、組編輯 sheet（同步剩餘組數、刪除；v2.104 起沒有「上次」籤與 RPE 清除）、組列左滑刪除、全部完成（欄頭雙勾：逐組換色間隔 60ms、按下縮放不延後、減少動態不錯開、進行中再按接續、逐組進行中單點一組不被延遲）、統計格數字翻動（訓練量與完成組數翻 160ms，時長跳秒不翻；減少動態只淡入、≤120ms）、收合列進度、要點條（就地寫、失焦才存）與替換動作與 ⋯ 選單、訓練中排序（鍵盤／指標／橡皮筋範圍／離線）、離線記錄回線上傳、補記、刪除確認、登出前確認、動作庫與編輯動作、離線改要點、有氧卡（加卡不產組、預填上次的值、有氧 sheet 欄位依動作、只送有變的欄位、守門、連按兩次、離線、沒有獨立入口與 `cardio_sessions` 請求、列表與編輯刪除、完成訓練 sheet、排序、移除確認、沒有示意圖、393 寬摘要折行、課表）／組編輯 sheet 內確認框的拖曳與 Escape／不認得的 kind 當重訓；**動效斷言不要逐幀（rAF）取樣**——機器忙時幀間隔會拖到 40–100ms，短動畫取不到中間幀而假紅；改讀 `getAnimations()` 的 delay、攔 `Element.animate`、用 `MutationObserver` 記 style 寫入，見 DESIGN v2.73）、`rest-timer.spec.ts`（組間休息計時器 12 條＋RPE 問題列 13 條＋有氧卡沒有休息條／重量建議 1 條（動作卡 RPE 頁尾 8 條已於 v2.107 拿掉）：開始與不開始的條件、結束時間點算法、−15／＋15、只有三顆鈕且固定 1:30、重新載入續算、歸零響一聲與自動收起、回前景重算、浮動 pill 的位置與留白、進場動畫、提示音進 precache；**獨立成檔因為 `page.clock` 會接管整頁計時器**；**跳時間用 `setFixedTime`，不要用 `fastForward`**——撥快後條的退場動畫退不掉，見 DESIGN v2.79）、`sync-sheet.spec.ts`（未同步 sheet：離線、被拒絕、等父列、登入失效、別帳號殘留、放棄確認；stub 的 `window.__rejectWrite` 讓某張表的寫入持續回 4xx）、`spring-sheet.spec.ts`（自製 spring sheet：開啟落定、第一幀不閃、四種關閉方式、下滑手勢三種結果、背景藏起來與焦點循環、減少動態、記一筆 sheet 辨識中鎖住關閉與焦點落在 sheet 本身、從餐別列下滑起手、點 chip 不被當成拖曳、鍵盤升起時頂緣留 12px、起手列 touch-action 接線；鍵盤位置桌面測不出，只能真機）、`service-worker.spec.ts`（SW 行為與離線冷啟動實測毫秒數，自己在 5502 起 preview 並真的關掉它，不吃 stub，用 `serviceWorkers: 'allow'`；其餘 spec 由 playwright.config 的 `'block'` 擋掉 SW）。

## 歷次跑測紀錄

2026-11-13 CI e2e 根治（分支 `ci-e2e-hardening`）：統計 11-10 改雲端後 26 次 run（8 份×1 worker 之後 20 次）——紅 8 次＝5 次測試時序、2 次 apt 解析不到 ubuntu 鏡像（一條測試都沒跑）、1 次真 bug（interaction:901）；另有 9 次重試才過。**共同底層：shard 的前幾條跑在冷機器上**——每份 shard 第一條的耗時是同一條排在後面時的 2–5 倍（多 5–8 秒）：`meal-exit:7` 排第一 16 次 3.9–13.5s、排後面 2.3–3.1s；`sync-sheet:171` 第一 5–22s、平常 4s；`training:904` 4–13s、平常 2.3s。紅過抖過的 training:3067/3068、904–970 一帶都在 shard 開頭。裸 runner 上 apt 有跑 fontconfig trigger，所以不是字型快取沒建，冷啟動機制**未查明**。改成 Playwright 官方容器後 diag（run 43437585830，左滑 7 條×10）70 過、第一條沒有懲罰（2.2s vs 2.0s），**但 diag 先跑了探針可能已暖機，未證實**；合併後看 8 份 shard 第一條的耗時才算數，懲罰還在就加每個 worker 先暖機。本機用 rAF 燒主執行緒（每幀 25／50／80ms）模擬慢幀，左滑紅重現不出來，那個工具已拿掉。通則：**CI 偶發紅先看它在 shard 裡排第幾**（log 的 `✓ N e2e/…` 的 N），排前面的先懷疑冷啟動。

2026-11-13 `feat/one-line-meal` 估一筆（v2.134，未合併、函式未部署）：`--list` 551 條 22 檔。第一次全量 549 條 545 過 4 紅——全是本批造成：「估一筆『…』」列沿用了 `.add-food-row`，既有測試（inline-edit、spring-sheet、vendor-autocomplete×2）用那個 class 點「新增」撞嚴格模式；改成獨立的 `.est-row` 後重跑那幾檔全過。改流程（帶回清單、合併加入）後再跑全量 17.1 分鐘 550 過 1 紅，紅的是偶發清單上的「慢態有出口」。`estimate.spec.ts` 11 條 `--repeat-each=3` 33 過。mutation：不封存、重試不沿用 foodId 都轉紅。vitest 1115 全過；lint 0 error。**通則**：新元件沿用既有 class 拿樣式前，先 grep e2e 有沒有拿那個 class 當選擇器——撞了就是嚴格模式紅，而且分散在好幾個檔。

2026-11-13 push 前全量（v2.133 App 圖示換成樣張 A，`?v=6`→7；動到 `vite.config.ts`（只改註解）＋precache 的圖示資產，屬例外清單，所以 push 前跑）：`--list` 540 條 21 檔，18.3 分鐘，539 過 1 紅。紅的是 `interaction`「慢態有出口」，偶發清單上、本機幾乎必紅、基線一樣，使用者說先不查。這批沒動登入與 session 路徑，判定與本批無關。push 前：`npx vitest run` 1056 全過（31 檔，PowerShell）；`npm run lint` 0 error；build 含在 e2e 裡。

2026-11-11 push 後全量（`c769ce8`，v2.127–v2.129）：541 條 8 份全過、0 偶發。之前三輪全紅都是環境：runner 解析不到 `*.ubuntu.com`（azure 鏡像、官方鏡像都一樣，GitHub 狀態頁沒公告），8 份卡在 apt 裝字型，最多 1 份撐過去；workflow 改成 apt 前把 `/etc/resolv.conf` 換成 1.1.1.1／8.8.8.8 就好了。撐過去那 1 份測出真紅：`interaction:901` 在讀取一次失敗就拋（v2.128）後，開機「載入中…」一閃而過、Linux CI 量不到——本機量得到，**本機綠不代表 CI 綠，動到時序的改動要找「斷言中間態」的測試**。

2026-11-11 v2.128（冷啟動不等重試、全站 AI 一份設定、設定頁 AI 段，未跑全量、未推）：vitest 1058 過；build、lint 過。`meal-suggest`＋`settings-nav`＋`service-worker`＋`quota-warning`＋`inline-edit` 104 過、`training`「連不上伺服器」1 過、smoke 55 過（smoke 第一輪紅 1：`tally.spec` 的「零真實網路請求」把 stub 接住的 read-label 額度查詢也算進去，改成排除 read-label）。冷啟動（token 有效）e2e 實測 7644 ms → 334 ms，門檻 12 秒收到 3 秒。mutation：vitest 6 處（辨識只用校準過的、白名單、額度欄位驗型別、credits 嚴格 true、log 遮 key、空白辨識串）都紅；e2e 3 處（拿掉 `rest.retry=false` 回到 7.6 秒、分類不帶 model、寫入後重撈不重試）都紅；**第一次「分類不帶 model」的 mutant 讓 tsc 擋掉 build、測試根本沒跑，不算數**，改成能編譯的寫法才得到真的紅。**陷阱：關掉 postgrest-js 退避重試後，靠「等 7 秒退避」的斷言會變成量不到中間態**（weight-trend 的骨架斷言拿掉）。新 stub 開關 `__dropIntake`（下一次當日清單查詢斷一次網）、`__credits`、`__readLabelModels`。訓練頁同步的 1 秒重試沒有 e2e 守。

2026-11-11 記一筆 sheet 依類型分組（v2.127，未跑全量）：`npx vitest run` 1046 過；build、lint 過；`e2e:affected --dry` 印 FULL。`meal-suggest`＋`quota-warning`＋`inline-edit` 85 過、`training` 寫入失敗 2 過、smoke 55 過（review 修正前後各跑一輪，兩輪都綠）。新增 e2e 1 條（分組、組序、徽章、收合、搜尋不分組、早餐不提示、換餐別收回）。mutation：vitest 7 處（沒歷史不收、次數排序、這一餐吃過的不收、早餐不提示、只收餐點類型、最早那餐，第 3 處第一次**活下來**——fixture 晚餐和早餐的類型剛好不重疊，補一條重疊的才紅）；e2e 1 處（拿掉徽章）紅。**陷阱：`openApp` 不釘時鐘，sheet 的預設餐別跟著跑測時刻走**（`openAppAt` 才釘 09:00）。以前每個餐別看到的清單都一樣所以沒差；這批讓「別餐吃過的類型收起來」之後，晚上跑就紅了 quota-warning 兩條、inline-edit 有兩條是潛在紅（CI runner 是 UTC，台灣晚上推等於午餐）。通則：**開 sheet 點特定食物前先點餐別 chip 釘住**，不要靠預設餐別。

2026-11-10 push 後全量（`da43c7b` 每日目標照算式排）：519 條 21.9 分鐘，517 過 2 紅，都在 `meal-suggest`（見偶發清單「加入中切設定再切回」那列）；兩條各單跑 6 次、整檔再跑一次（55 過）都綠，判定是負載下的偶發，與本批無關。`daily-goal` 60 條這輪全過。

2026-11-10 每日目標 v2.118 push 前 review 修正：兩路 review 0 blocking。修了：怎麼算的速度寫選單上的值（原本換算回來成 1.52）、自己點紀錄回推的路徑（範圍內）沒有測試、切模式不重設 `picked`、「已儲存」改到膠囊下面（原本在右邊讓膠囊每次存檔跳一下）、popover 往上開時箭頭位置、算式數字用畫面整數相加減與全形負號、碳水夾成 0 的說明、讀取中／讀不到的寫法、設定頁入口用詞、Katch／Mifflin 判斷跟 formulas.ts 一致。新增 e2e 2 條（範圍內點列改用＋切模式不自己又開、速度寫法）。`daily-goal` 60 條全過；smoke 55 過。**陷阱：新測試第一次的前提錯（第一頁用預設 75.95 kg、第二頁 75 kg，公式值不同，回推根本不在範圍內），測試本來就紅——那輪做的 mutation「變紅」不算數，修好前提後重做才得到真的紅。** 另「每一列命中區」因頂端多預留一行、活動係數列落到可視範圍外，`elementFromPoint` 量不到，改成先捲進畫面再量。

2026-11-10 每日目標照算式排（v2.118，未 commit、沒跑全量）：`daily-goal` 舊 54 條先跑紅 19 條（全是改了用詞或版面的），逐條改成在新版面驗同一件事（「依你的記錄推算」→ 紀錄回推那一列 `.goal-est`、「要改用嗎」→ 點那一列、四條依據清單 → 算式代入數字），再加 4 條（頂端算式相減＝大數字、兩列算式在 393 與捲軸少 15px 都不換行、ⓘ popover 開關與 44px 命中區、已改用後最新回推跑出範圍外的「要更新嗎」），共 58 條全過。拿掉的斷言：清單 marker 的三條（「怎麼算的」不再是清單）。`npx vitest run` 971 全過；build、lint 過；`e2e:affected --dry` 印 FULL（`app.css`、`formulas.ts`）。mutation 4 處（公式算不出來還能點改回、年齡 NaN 進算式、沒有「要更新嗎」、ⓘ 命中區）都紅；**「要更新嗎」那處第一次寫成 `false && …` 又讓 tsc 先失敗、沒跑到測試**，改成永假的比較才得到真的紅。webkit 393×745 真畫面截了四張（記錄不夠、確認框、已改用＋ⓘ、怎麼算的），截圖已刪。`npm run e2e:smoke` 54 過 1 紅：`analysis`「訓練分析入口列」（偶發清單上），單跑 8 次全過；這批 CSS 只動 `.goal-*`。**踩到的實際 bug**：已改用時清空出生年，公式算不出來，公式推導那列卻還能點、點了目標會算不出來；改成算不出來時不能點、算式裡缺的值寫 —。

2026-11-10 push 後全量（`bf4eb71` 餐建議第二版）：513 條 15.6 分鐘，511 過 2 紅，都在偶發清單上、乾淨基線 `1140e9f` 也紅過：`food-library`「開啟 sheet 後焦點」、`interaction`「慢態有出口」。兩條各重複 4 次：前者 4 紅 1、後者 4 全過。這批沒動 `FoodLibrary`、登入與 session 路徑，判定與本批無關。

2026-11-10 餐建議第二版 push 前 review 修正：兩路 review 0 blocking。修了：換一個的簽章一變就丟掉（原本只比對，切走再切回、復原還原紀錄會回到換過的那一名；簽章加入日期與目標）、換一個清掉上一組的寫入錯誤、脂碳超出與蛋白質達標先捨到 0.1 g、淡化透明度對齊 .6、spec AC 重排與決策樹「缺口 ≤ 0 不出」對齊條列。新增 vitest 1 條（浮點）——**第一版算例沒真的產生浮點誤差，mutation 沒紅才發現；改用 node 實算出 2.9e-15 的組合**。e2e 換一個那條加「換日期再切回回第一名」與「每次換都重閃（舊的 `.sg-flash` 要 detach、`getAnimations` 有 flash）」。vitest 971 全過、lint 0、`meal-suggest -g 第二版` 5 過、smoke 55 過；mutation「只比日期不比簽章」紅在換一個那條。

2026-11-10 餐建議第二版（未 commit、沒跑全量）：`--list` 513 條 21 檔，其中 `meal-suggest` 55 條（+5；回看 14→28 天改了兩條的邊界日期 10-19→10-05）。`npx vitest run` 970 全過（28 檔）；`npm run lint` 0 error；`e2e:affected --dry` 印 FULL（`App.tsx`、`app.css`、`types.ts`），`npm run e2e:smoke` 55 過；`meal-suggest` 整檔兩輪：54 過 1 紅（「全選」命中區，見偶發清單）、55 過。mutation：邏輯 6 處（拿掉脂碳超出、拿掉次數、減重也用 1.1、蛋白質容差 0、常吃門檻 1、晚餐不需午餐）、畫面 3 處（換一個不看紀錄簽章、單一候選也顯示換一個、過去也依缺口挑）全紅在斷言上。**陷阱：第一次「過去也依缺口挑」的 mutation 讓 `isPlannable` 變成沒用到的 import，`tsc` 先失敗、一條測試都沒跑，輸出只是沒有結果行——要看到 x 才算數。** webkit 393×745 真畫面截了一般與超標兩張，色值是 token、無黑色 fallback，截圖已刪。

2026-11-10 push 後全量（`481d965` 每日目標改版）：508 條 17.1 分鐘，全綠（「慢態有出口」這輪剛好沒紅，不代表修好）。push 前：`npx vitest run` 954 全過；`npm run lint` 0 error；`e2e:affected --dry` 印 FULL，`npm run e2e:smoke` 55 過。

2026-11-04 每日目標改版（未 push、沒跑全量）：`--list` 508 條 21 檔，其中 `daily-goal` 54 條（原 22 條，綁舊版面的逐條改寫）。`npx vitest run` 954 全過；`npm run e2e:smoke` 55 過；`daily-goal` 重複 2 輪 108 過；前一輪受影響檔整批 229 條紅 1 條（`連改`，測試時序問題，已修）。獨立 review 三輪都抓到測試當時全綠的問題；mutation 共 38 處，第一次有 3 處不算數（`tsc` 先失敗一處、假綠兩處），修過測試後都紅在目標斷言。**陷阱：`smoke.json` 用標題選條目，改了標題 smoke 不會報錯，條數默默從 55 變 53，要看條數。** 本輪 smoke 紅過一次 `analysis`「訓練分析入口列」（從分析頁返回訓練頁，5 秒內沒看到 `[data-screen="training"]`），單跑 10 次與下一輪 smoke 都過，這批沒動那條路徑；原因未查，沒有對乾淨基線重複。

2026-11-04 push 後全量（`009be2e`）：476 條 16.2 分鐘，474 過 2 紅，都判定偶發、與本批無關。`spring-sheet`「開啟中點一下把手」負載下 3 秒內沒收斂到 0（讀到 2.29），測的是訓練的開始 sheet，不經過這批改的 `LogSheet`，重複單跑 12 次全過。`interaction`「慢態有出口」重複 4 次紅 1 次，基線本來就高機率紅，原因未查、值得另查。

2026-11-04 餐建議第二輪驗證修正 F1–F3 與小修（未 commit、沒跑全量）：`--list` 476 條 21 檔，其中 `meal-suggest` 50 條。`npx vitest run` 951 全過（28 檔）；`npm run lint` 0 error；`npm run e2e:smoke` 55 過（前一次跑紅 1 條 `settings-nav`「三個入口」，偶發清單上、同症狀「從體重趨勢返回」，單跑 5 次全過，之後整輪 55 過）；`meal-suggest interaction tally.spec inline-edit quota-warning food-library spring-sheet sync-sheet` 209 條全過 6.0 分鐘（基線也紅的「慢態有出口」「開啟 sheet 後焦點」這輪剛好沒紅，不代表修好）。`e2e:affected --dry` 印 FULL。mutation 都紅在斷言上。**通則**：`TaskStop` 停背景的 e2e 只殺外層 shell，playwright 與 preview 會留著占 5501，下一輪直接報 `already used`，要用 `taskkill /T` 收掉。

2026-11-04 餐建議第一輪驗證修正 R1–R13（未 commit、沒跑全量）：`--list` 465 條 21 檔，其中 `meal-suggest` 39 條。`npx vitest run` 951 全過（28 檔）；`npm run lint` 0 error；`npm run e2e:smoke` 55 過；`meal-suggest interaction tally.spec inline-edit quota-warning food-library spring-sheet sync-sheet` 198 條，196 過 2 紅，兩條都在偶發紅清單上：`food-library`「開啟 sheet 後焦點進到 sheet 裡」、`interaction`「本機 session 格式認不得…慢態有出口」。兩條對乾淨基線 `1140e9f`（`git archive` 匯出）各重複 8 次：`interaction` 這條基線 8 紅 8、本輪 8 紅 8；`food-library` 基線 6 紅 8、本輪 3 紅 8，所以跟這輪改動無關。注意 `interaction` 這條 2 worker 重複跑是穩定紅，單獨跑一次會過，比清單上寫的「時紅時綠」更嚴重，原因仍未查。新測試裡吃時序的 10 條各重複 3 次，30 過。mutation 踩到三個假綠，寫法都修了：斷言會重試時，DELETE 一落地畫面自己變對（改只看一次）；被蓋掉的列還在退場動畫裡，看列會過（先看 `.gauge-side .cur`）；sheet 還在飛就量 `elementFromPoint` 會量到視窗外（先等 transform 到位）。

2026-11-04 餐建議 R＋差 N（未 commit、沒跑全量）：`--list` 449 條 21 檔，其中 `meal-suggest` 23 條。`npx vitest run` 951 全過（28 檔）；`npm run e2e:smoke` 55 過；`meal-suggest` 整檔 23 過；`quota-warning`、`food-library`、`spring-sheet`、`sync-sheet`、`inline-edit` 合跑 99 過。`e2e:affected --dry` 印 FULL（`App.tsx`、`app.css`、`api.ts` 等表上沒有的檔）。mutation 都紅在斷言上，含：拿掉 `suggestRepeatByMeal` 的當日檢查紅在 sheet 的 `.sect-suggest`（今日頁的卡片本來就不在有紀錄的分支，紅不了）、切分頁不收窗、`handleCreateIntake` 不 invalidate。

2026-11-03 push 後全量（`d4880a7`）：426 條 14.6 分鐘，425 過 1 紅（`inline-edit`「連按：前一筆失敗、後一筆成功」），查明是測試賽跑、產品沒問題：負載下 40 次重現 2 次，都是兩下隔超過 300ms，第一筆失敗退回 1 才按第二下，送 `{qty:2}` 兩次、畫面也是 2，與伺服器一致。三條連按測試改用頁內連發的 `pressStepsFast`，負載下 3 條各 30 次全過；提早回滾、比對存成功的值兩個 mutation 都紅。只改測試，未 commit，沒再跑全量。

2026-11-03 `training`「有氧 sheet 寫入失敗」查明，移出偶發清單：**是真 bug。** `CardioForm` 用 `useEffect` 回報 busy，effect 觸發的上層更新是非同步排程的，有一段空檔按鈕已 disabled、`SpringSheet` 的 `locked` 還是 false，這時按 Escape 會把 sheet 關掉，失敗時填的值跟著不見。改成同一批更新回報（比照 `SyncSheet`）。對照：4 個燒 CPU 的行程＋頁內日誌下重複 40 次，舊寫法紅 5 次（日誌 `locked=false reason=escape-key`），修正版全綠（40 次都是 `locked=true`）。測試原本用 `toBeVisible` 驗不到，收合要 0.8 秒，開始收了也還看得見，改驗 `pointerEvents`。沒跑全量。

2026-11-03 刪除 `public/_probe/` 後全量（未 commit，動到 `vite.config.ts` 要 push 前綠）：426 條 15.2 分鐘，全綠。

2026-11-03 push 後全量（`d2ee2f8`）：426 條 15.3 分鐘，425 過 1 紅（`training` 有氧 sheet 寫入失敗，查明見上一筆）。

2026-11-03 push 前 review 修正：`e2e/harness.ts` 新增 `armClickDuringClose`，收合中的點擊在頁內排程，不用 `waitForTimeout` 再 `mouse.click`；唯一例外是搶焦點那條，合成事件重現不了，用真滑鼠。修正後全量 426 條 15.2 分鐘全綠。

2026-11-03 收合吃點擊修正後全量（v2.113，未 commit）：424 條 14.1 分鐘，423 過，紅的是當輪新增的「從收到一半的位置彈回去」：固定等 120ms，滿載時 sheet 已快收到底。改成在頁內等 y 過門檻就點，`spring-sheet` 整檔重複 3 次 81 條過 80 條，mutation 確認會紅；唯一的紅是偶發清單上的「開啟中點把手」，單跑 12 次全過。之後只改這條測試，沒有再跑全量。

2026-11-03 `service-worker`「新版 SW 裝好就接手」查明（舊紀錄在 notepad 已知問題，已移除）：**SW 沒有卡住，是測試讀到過時的值。** `clientsClaim` 在 activate 期間就觸發 App 重載，WebKit 給重載後那一頁的 `ServiceWorker` 物件有時停在 `activating`、之後不再更新。診斷 8 次重現 2 次，兩次都是頁面讀 `activating`，但 SW 自己報 `activated`、fetch 7ms 回 200、另開分頁讀到 `activated`。改成另開分頁才讀，連跑 8 次全過；讓 `activate` 真的卡死會紅。產品碼沒有讀這個值，沒有使用者影響；真機沒驗。

2026-11-03 第三輪全量（下一輪 8 項，未 commit）：421 條 13.4 分鐘，420 過 1 紅（`service-worker` AC 6，下一條）。之前穩定紅的兩條都查明、修掉：
- `recovery-foreground`：**不是**之前推論的跨午夜，早上照樣 10 次全紅。撥快 13 小時讓 session 過期，回前景時 refresh 被 stub 擋下（599），被踢回登入頁，斷言在跟登出賽跑。改成撥時鐘前設 `__authMode = 'ok'`。
- `training` 逐組單點：點擊落在第 3 組 120ms 的延遲內，顏色還沒變，取消完成後沒有新 transition，等不到事件。改成等延遲走完，並用 `MutationObserver` 在 `done` 拿掉的當下量。連跑 20 次全過，拿掉 `endCascade` 會紅。

2026-11-02 第二輪全量（`8d49d6d`，之後只改文件成 `2b6064b`）：415 條 14.4 分鐘，412 過 3 紅（`recovery-foreground`、`spring-sheet` 開啟中點把手、`training` 逐組單點）。重複 10 次：`spring-sheet` 全過；另兩條在已上線的 `7c71941` 上紅得一樣多，判定不是這批造成。push 前沒再跑一次全量，產品碼與測試從 `8d49d6d` 起沒變。

2026-11-02 push 後全量（`7c71941`）：398 條 14.9 分鐘，全綠。

2026-11-02 push 前最後一次全量（`484bcad`）：397 條 14.7 分鐘，396 過，紅的是 `interaction`「日期快取 5」（偶發，見清單）。之後 verify 抓到 `FoodLibrary` 的 stale closure，修正只動兩行並新增 1 條，跑 `FoodLibrary` 對應的 spec，沒有再跑全量。

2026-11-02 批次 4 之後全量：392 條 14.8 分鐘，390 過 2 紅（`settings-nav` 三個入口、`training` 有氧 sheet 寫入失敗），兩條各單跑 8 次全過。push 前 review 抓到 B2 的回歸（按 + 再按 − 第二筆不送），修正時新增 5 條，`--list` 實測 397 條；stub 補 `__writeDelayMs` 造「前一筆還在路上」。

2026-11-02 批次 1 之後全量：392 條 14.5 分鐘，391 過，紅的是 `interaction`「undo 跨日期 3」。這條不是偶發，是測試本身的賽跑：探針量到刪除在第 0.9 秒、切回在第 6 秒左右，5 秒計時器每輪都已送出 DELETE，通過只是趕上提示條的退場動畫。切日期改用 `dispatchEvent` 後重複 20 次全過；mutation（換日期時收掉提示條）確認會紅。已移出偶發清單。**通則：反覆出現的「偶發紅」先量時間線，別一直靠重跑放行。**

2026-11-02 B1–B6 修正（新增 11 條，10 條修前紅、修後綠；「小幅拖曳不到門檻」修前就綠，留作守門）：`interaction`、`inline-edit`、`food-library` 整檔 91 條 90 過，唯一的紅是偶發清單上的 undo 跨日期 3；`e2e:smoke` 55 條全綠；`training` 的同步與組編輯 7 條全綠。`--list` 實測 392 條 20 檔。沒跑全量，留到批次 1 之後一起跑。

2026-11-02 全量基線（`efc1999`，工作樹只有 wiki index 改動，整體清理前）：381 條 14.6 分鐘，377 過 4 紅——`interaction` undo 跨日期 3、`recovery-foreground`、`settings-nav` 三個入口、`training` 指標拖曳橡皮筋。4 條各單獨重複 5 次（`--repeat-each=5`，2 worker）共 20 次全過，判定偶發。

2026-11-02 `npx playwright test --list` 實測：381 條、20 個檔（沒有跑測，只是計數）。

以下是搬過來的原文，由新到舊，新紀錄加在這段最上面。原文裡的「下面」是搬動前的排列：`tally.spec` 的部分看上方偶發紅清單與各 spec 涵蓋範圍，其餘在本段後文。

`npm run e2e` 共 379 條（`--list` 實測；2026-10-29 v2.107 拿掉動作卡 RPE 頁尾，刪 7 條、新增 2 條，淨 −5，只跑 `rest-timer`／`training` 的 RPE 相關條目，沒跑全量；2026-10-28 v2.105 階段 0 新增 1 條〔RPE 標籤〕、review 修正後再新增 2 條〔要點長度不跳高、清空鈕 Tab 焦點〕，這一輪的全量紀錄只有 DESIGN v2.105 那句「全量 384 條（review 修正後）」；2026-10-28 v2.103 新增 2 條〔封存確認框、編輯動作 sheet 縮圖〕、左滑預期值 REVEAL 56→72 重算；v2.104 新增 1 條〔要點清空鈕〕、刪 1 條〔沒做過的動作「沒有紀錄」〕，淨 +2；這兩輪只跑 `training`／`sync-sheet` 等相關檔，沒跑全量；2026-10-27 v2.98（日期元件展開收合動效，`interaction.spec` 新增 6 條）**這一輪跑了全量**：375 條跑 373 過、2 紅——`spring-sheet`「開啟中點一下把手」是下面記過的已知偶發（乾淨基線 origin/main 單跑 6 次紅 1 次，本輪單跑 6 次紅 2 次，沒動到 SpringSheet）；`interaction`「v2.53 往未來滑夾到明天」是真的被這輪改動打到（展開收合有動畫後，`gotoDate` 點完日期要等月曆走完才能量週列座標），已修，該檔 v2.53＋日期元件 13 條重複 3 次全過；再前一輪 v2.97（動作庫管理搬到設定頁，原有動作庫測試的 helper 改走設定頁，條數不變）**同樣沒有跑全量**〔使用者裁決〕：跑 `training`＋`settings-nav`＋`food-library`＋`daily-goal`＋`weight-trend`＋`form-macros-align`＋`rest-timer`＋`spring-sheet` 八個檔共 252 條全過（第一輪 4 條紅，都是「從動作庫返回後以為回訓練頁」的舊假設，已改，不是 bug）；再前一輪 v2.96（Picker 加「新增動作」，`training.spec` 新增 5 條）也沒有跑全量，跑 `training`＋`rest-timer`＋`spring-sheet` 三個檔共 192 條全過；再前一輪 v2.95（要點條，展開的卡頂部就地寫要點、拿掉 ⋯ 選單的編輯要點，`training.spec` 淨增 2 條）**同樣沒有跑全量**〔使用者裁決〕：跑 `training`＋`rest-timer`＋`spring-sheet` 三個檔共 187 條全過；再前一輪 v2.94（動作替換，訓練中卡片頭 ⓘ 換成替換鈕，`training.spec` 淨增 4 條）也沒有跑全量，跑 `training`＋`rest-timer` 兩個檔共 161 條全過；前一輪 2026-10-22 v2.93（封存從編輯動作 sheet 搬到動作庫列表，`training.spec` 新增 6 條）**同樣沒有跑全量**〔使用者裁決〕：`training.spec` 整檔 123 條跑 122 過、1 紅（「訓練中排序（指標拖曳）：拉過清單上緣…被拖的卡是收合後的高度」，下面記過的 dnd-kit 高度觀測偶發，單跑 5 次全過）；再前一輪 v2.91／v2.92（編輯動作 sheet 的 CTA 釘底與鍵盤處理、組列左滑停點、勾的按下回饋）也沒有跑全量〔使用者裁決〕：v2.91 跑 166 條（`training`／`food-library`／`spring-sheet`／`vendor-autocomplete`／`form-macros-align`／`settings-nav`）全過，v2.92 跑 189 條（`training` 117／`spring-sheet` 24／`rest-timer` 34／`sync-sheet` 14）全過；之前 v2.90 有氧縮圖那輪同樣**沒有跑全量**〔使用者裁決〕，只跑受影響的檔：`training.spec` 107 過、`service-worker.spec` 8 過、`spring-sheet.spec` 24 過、`rest-timer.spec` 34 過〔第一輪 33 過 1 紅：「休息條答 9 之後，組編輯 sheet 裡 RPE 9 是高亮的」逾時，單跑 8 次與整檔重跑都過，列入偶發〕；上一輪全量是 340 條：2026-10-22 有氧併入動作 review 修正後全量實測 **338 過、2 紅、695 秒**：`food-library`「開啟 sheet 後焦點進到 sheet 裡」是下面記過的已知偶發（單跑 8 次全過）；`recovery-foreground`「肌群狀態：回到前景…」**不在已知清單**，單跑 6 次全過、路徑與有氧無關，但沒有對乾淨基線驗證，再紅先查；其中 `training.spec` 有氧卡新增 14 條、`rest-timer.spec` 新增 1 條；review 前那輪是 338 條 337 過、1 紅（`interaction`「慢態有出口」，單跑 6 次全過）；以下是 325 條時的紀錄：2026-10-21 重量建議上線後全量實測 **325 條全過、642 秒**，其中 7 條是 `weight-suggest.spec.ts`；再往前是 318 條時的紀錄：2026-10-21 `--list` 實測，全量 314 過、1 紅（已知偶發「慢態有出口」，單跑 5 次全過）、595 秒，二十個檔加總；全量牆鐘數字是 291 條時量的；**全量牆鐘 2026-10-21 實測：改前 981 秒、`training.spec` 檔內平行後 659 秒（291 全過）、動作庫改用現成 fixture 後 573 秒（289 過、2 紅）**；紅的是 `settings-nav`「三個入口都進得去」（從體重趨勢返回，lazy chunk；另一條同檔「進次級頁收起底部列」也偶發紅過，單跑 50 次紅 1 次）與 `spring-sheet`「開啟中點一下把手」（動畫 3 秒內沒落定），**兩條單獨重複跑各 20 次全過，整套一起跑才偶發，原因未查**，與 `tally.spec` 的偶發同歸一類；其中 17 條是 `analysis.spec.ts`（動作進度 10＋肌群狀態 7，含近力竭與熱身那條）、33 條是 `rest-timer.spec.ts`（含休息條 RPE 問題列 13 條、動作卡 RPE 頁尾 8 條，v2.107 已拿掉）、3 條是著作權標示；加著作權標示那輪全量 275 條跑 272 過、3 紅——`tally.spec`「Tally UI 回歸」與 `interaction`「慢態有出口」是下面記過的偶發，單跑重跑都綠；第三條 `food-library.spec`「開啟 sheet 後焦點進到 sheet 裡」也是偶發紅，**乾淨基線（沒有著作權標示的 `5ad1b89`）重複跑 16 次紅 4 次、本輪改動重複跑 12 次紅 1 次**，原因未查、不是本輪造成；前一輪（沒有著作權標示）全量 272 條全過；以下是 260 條時的紀錄：比 2026-10-19 的 249 多的 11 條＝`weight-trend.spec.ts` 10 條（含 review 後補的兩條離線）＋設定頁致謝 1 條，換圖那輪新增「減少動態」1 條、刪掉「上游兩張相同」1 條，淨 0。2026-10-20 review 修正後全量 260 條全過（這一輪 `tally.spec.ts` 的偶發沒有紅）；以下是更早的紀錄：v2.74 點縮圖放大那輪比 242 多的 7 條都在 `training.spec.ts`；此前同日全量：review 前 240 條全過、review 修正後 242 條跑 241 過、1 紅，紅的是 `tally.spec.ts` 的偶發（基線也會紅，見下面與 DESIGN v2.73 限制②），之後沒有再跑出全綠的一輪；比 236 多的 6 條都在 `training.spec.ts`；前一次 2026-10-17 `--list` 是 236 條，其全量 237 條實測：236 過、1 紅，紅的就是下面那條時紅時綠的「慢態有出口」；動作示意圖那輪另有一次「訓練中排序（指標拖曳）」的被拖卡高度偶發偏高（dnd-kit 位置觀測非同步，斷言已改輪詢，見 DESIGN v2.71）；前一輪 B2 全跑 227 條、之後補動效 +4、動作示意圖 +6；前一輪 2026-10-16 食品庫新增食物 sheet 換 SpringSheet 後是 215 全過；同日稍早曾 206 過、1 紅，紅的是 `interaction.spec.ts` 的「本機 session 格式認不得…慢態有出口」，它時紅時綠、原因未查（2026-10-15 全跑 4 次紅、1 次綠；2026-10-16 單跑 3 次 1 紅、全跑兩次中一次綠一次紅，與改動無關：stash 回基線也紅過）；**實測計數，不要用「舊數字＋本輪新增」外推**——那正是它一路從 57 漂到 65 的原因）。
