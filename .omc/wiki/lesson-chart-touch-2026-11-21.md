---
title: "lesson-chart-touch 趨勢圖觸控讀數的四條通則（2026-11-21）"
tags: ["recharts", "touch", "ios", "v2.149", "e2e"]
created: 2026-11-21T15:49:22.295Z
updated: 2026-11-21T15:49:22.295Z
sources: []
links: []
category: pattern
confidence: medium
schemaVersion: 1
---

# lesson-chart-touch 趨勢圖觸控讀數的四條通則（2026-11-21）

# lesson-chart-touch 趨勢圖觸控讀數的四條通則（2026-11-21）

出處：v2.149，使用者在 iPhone 上回報「點的時候會閃一下」「體重圖拖不動、體脂圖可以」。程式在 `src/components/useChartHover.ts`。

1. **recharts 放開手指後不會清掉 active index。** 我們用 `released` 把 tooltip 強制關掉，但重新起手解除 released 的那一刻，recharts 報上來的還是上次那天。等 touchmove 的 rAF 跑完才會換成新位置，中間就是「閃一下」。處理方式：放開時把當時指著的那天記成 stale，重新起手後報上來的值如果等於 stale，就先不採用，直到報的是別天。只把 engage 從 touchstart 挪到 touchmove 不夠，touchmove 的第一幀照樣會閃。mutation 實測：拿掉 stale 過濾後，「重新起手不閃」那條測試紅。
2. **syncId 下別只看「誰最後回報」。** 被同步、跟著報的那張圖不一定比較晚，也可能是舊值。讀數要取手指、滑鼠或鍵盤實際在操作的那張圖：在包住圖的 div 上記 `active`。舊寫法 `hoverW ?? hoverF` 固定先取第一張圖，第一張有殘留值時，拖第二張讀數就不換；mutation 實測可以重現。
3. **圖上的 label 不要寫成 render 裡的箭頭函式。** recharts 的 `Label` 遇到函式會 `createElement(content)`，新的箭頭函式等於新的元件型別，每次 render 都重建 `<text>`。iOS 上手指起手落在被移除的節點，之後的 touchmove 會送到脫離畫面的節點，冒泡不到 React。改成模組層級的元件，以元素傳進去：recharts 對元素是 `cloneElement`，元件型別不變。這是「拖不動」最可疑的原因，**桌面重現不出、未證實**。另外，把 `dot` 函式包成 useCallback 沒有效果：`Dots` 是直接呼叫函式，不是當元件掛上去。
4. **桌面 WebKit 測觸控**：不能 `new Touch`。用一般 Event 掛上 `touches`／`changedTouches`，React 與 recharts 讀的就是這兩個欄位（`e2e/harness.ts` 的 `touch()`）。「閃一下」只會出現一兩幀，輪詢斷言看不到，要用 MutationObserver 記下每一次文字變化（`recordText()`）。mutation 要能編譯：讓變數變成沒用到，`tsc -b` 會擋下 build，e2e 一條都不跑，結果看起來像沒輸出，不是測試過了。

5. **點一下不能當放開。** 移動不到 10px 就放開算點一下，不收讀數，讓 iOS 補發的 mousemove 換到點到的那天。點一下也收的話，連點兩處會是「A → 現在 → B」：「閃一下」的另一半就是這個，第一輪修完 review 才抓到。
6. **觸控目標固定在 svg**：`.trend-chart-hit svg * { pointer-events: none }`。讀數靠 recharts 的座標，不靠點中哪個圖形，比逐一把 label 改成穩定元件更徹底。測這條要取樣「會接觸控的圖形」（量測點 `circle`）。線外框的中心、label 的位置本來就落在 svg 上，取那些點，mutation 會照樣綠。

觸控外框用 `touch-action: pan-y pinch-zoom`，別只寫 `pan-y`：那樣會關掉雙指縮放，違反 body 那條 WCAG 設定。

