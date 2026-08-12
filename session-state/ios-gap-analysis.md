# iOS 質感差距盤點（2026-08-12）

> 這是**選單**，不是計畫。你挑完之後才進 `ui-design-flow` 出樣張。
> 每項四欄：現在長怎樣／iOS 原生怎麼做／改哪裡／值不值得。
> 事實都帶 `檔案:行號`，平台行為當天查證過（來源見末段）。

## 盤點結論先講

五個面向裡，**兩個建議整項砍掉**（大標題摺疊、觸覺回饋），**一個大半已經做到了**（圖示與字重）。
真正有東西可做的是彈簧物理與 scrim 模糊，加起來約是「一行 transition ＋ 一行 CSS ＋ 一個字重值」。

這不是砍範圍，是這個 app 的既有決策（平的 cream、不用陰影、頂欄不捲、745px 一屏預算）
跟 iOS 的視覺語言本來就是兩套東西——而那些決策是為了「一天開五次、每次三秒」選的。

---

## 一、彈簧物理的滑動手感

### 1-A 左滑刪除放手後的吸附 ★推薦

- **現在**：`src/screens/Today.tsx:437-438` 用 motion 的 `animate={{x}}` ＋
  `transition={{ duration: 160/220ms, ease: --ease }}`。放手後**永遠從 0 速**跑一條固定曲線，
  跟手指離開時多快完全無關。
- **iOS**：手勢結束一律接 spring，初速＝手指離開時的速度。iOS 手感的本體是
  **可中斷 ＋ 速度連續**，不是「有彈跳」。
- **改哪裡**：那一行的 transition 換成 `{ type: 'spring', stiffness, damping }`。
  ~~motion 的 drag 會自動把 velocity 交棒。~~ **這句是錯的，已被同一輪的實測推翻**——
  慢拖與快甩的過衝都是 0，要自己在 `handleDragEnd` 記 `info.velocity.x` 餵進 transition
  的 `velocity`，並夾上限。`quick`（reduced-motion）分支保留。
- **值不值得**：**值得**。全 app 唯一的真手勢，改動一行。
  代價：DESIGN.md 的四級時長階梯（100/160/220/280）在這裡不再成立，要補一條
  「手勢類走 spring、非手勢走時長階梯」的規則。`e2e/meal-exit-animation.spec.ts` **沒有**硬斷言
  時長（只有註解提到 220ms），但那條的等待邏輯要重跑確認。

### 1-B vaul sheet 的拖曳關閉

- **現在**：vaul 1.1.2 全包，我們只設 `direction`／`shouldScaleBackground`／`repositionInputs`
  （`LogSheet.tsx:12`、`FoodLibrary.tsx:12`）。vaul 內建曲線本來就是 iOS 那條
  `cubic-bezier(.32,.72,0,1)`＝我們 `--ease-sheet` 抄的來源。
- **iOS**：sheet 拖曳放手同樣接 spring。
- **改哪裡**：要覆寫 vaul 內部動畫層。
- **值不值得**：**不做**。v2.34–v2.36 那三題（`repositionInputs={false}`）花了五輪才結案，
  動 vaul 動畫層是往那個雷區走；換到的差異在 280ms 的位移上肉眼幾乎分不出。

### 1-C 就地編輯區展開

- **現在**：`Today.tsx:486-488`，`height: 0→auto`、220ms。全站唯一動 height 的地方。
- **iOS**：原生對應物（table view 展開）用 layout spring。
- **值不值得**：**不做**。spring 沒有明確終點，而展開跑完要接 `scrollIntoView`
  （DESIGN.md v2.20 明訂「展開途中算出來的可見範圍是錯的」）；height 過衝也會讓內容上下彈。

### 1-D undo pill 進場／加入成功的 flash／日期列轉場

事件驅動的一次性動畫，沒有手指速度可承接，spring 在這裡只是換一條曲線。**不做**。

---

## 二、半透明材質與模糊

### 2-A scrim 加模糊 ★可做

- **現在**：`src/app.css:732` scrim ＝ `color-mix(in srgb, var(--ink) 55%, transparent)`。
  全站零 `backdrop-filter`、零 blur。
- **iOS**：sheet 拉起時背景是**模糊 ＋ 壓暗**，不是純壓暗。
- **改哪裡**：scrim 加一行 `backdrop-filter: blur(Npx)`（＋`-webkit-` 前綴，DESIGN.md 已有
  「前綴不可省」的先例）。
- **值不值得**：**可做，但要實機驗效能**。這是全 app 唯一「固定層底下真的有內容」的地方。
  相容性過線（基準線 Safari 16.0）。

### 2-B 底部列／分頁列的材質

- **現在**：`--card` 實心。`.timeline` 是獨立捲動容器，內容捲到底就停在底部列上方——
  **沒有任何東西會經過它底下**。
- **iOS**：tab bar 半透明模糊，前提是內容從它底下捲過去。
- **改哪裡**：得先改版面（時間軸延伸到底部列底下＋補 padding-bottom），才輪得到加模糊。
- **值不值得**：**不建議**。兩層阻礙：① 要動 v2.3 那套「一屏不捲、745px 預算」的結構
  ② 就算改完，模糊的是 `--paper`(#FAF6F0) 純色，而 `--card` 對 `--paper` 只有 **1.05:1**——
  cream 上的模糊等於看不見。DESIGN.md v2.4 已為日期膠囊裁決過同一件事：
  「不照抄 iOS 26 的玻璃材質——我們是平的 cream」。

---

## 三、大標題摺疊 ★建議砍掉

- **現在**：`.topbar` 是 `position: relative`（`app.css:116`）不參與捲動，捲的只有 `.timeline`。
  `<h1>` ＝ 日期（`Today.tsx:200`），`--t-md`(16px)/600。
- **iOS**：`prefersLargeTitles`——34pt 起始，捲動時摺疊成 17pt 置中並浮現分隔線。
- **改哪裡**：捲動範圍要從「只有時間軸」改成整頁、頂欄改 sticky、日期字級要能在 34↔16 之間動。
- **值不值得**：**建議砍掉**，三處硬碰：
  1. 那個 `<h1>` 是**日期導覽控制項**不是頁名。放大它＝把最大的視覺重量給全畫面**最低頻**的
     控制項——正是 v2.4 否決「兩顆箭頭各包一顆圓」的同一個理由。
  2. v2.7 才剛把它從 20px/700 縮到 16px/600，理由是你實機回報「有點大、有點突兀」。
     大標題是往回走、而且走更遠。
  3. 745px 基準下破表屏已溢出 96px，起始態再多吃約 50px。
- **摺疊裡真正有資訊的那一半（捲動時浮現分隔線）已經有了**：`.timeline` 頂端的 10px 漸層遮罩
  就在做「上面還有內容」這件事（DESIGN.md「區塊分隔」條）。

---

## 四、觸覺回饋節奏 ★建議移出範圍（平台做不到）

- **現在**：查無任何相關程式碼（全 `src/` 搜過 vibrate／haptic／taptic／switch）。
- **平台事實**（2026-08-12 查證）：**iOS Safari 從未實作 Vibration API**。唯一路徑是
  `<input type="checkbox" switch>`（Safari 17.4 起）被切換時系統發一下 tick——但
  **iOS 26.5 起 Apple 已封掉從 JS 程式化觸發**，只剩「真手指直接點在原生 switch 控件上」才會響。
- **對 Tally 的兩半**：
  - **事件驅動的回饋全部做不到**：滑過刪除門檻、加入成功、破表跨線、undo 送出——
    這些都是程式判斷後才發，正是被封掉的那條路。
  - **手指直接點的**（CTA、分頁、chip、stepper ±）理論上可把一個透明原生 switch 疊在按鈕上
    換到 tick，代價是那顆不再是 `<button>`（撞 DESIGN.md「可點的東西一律用原生 button」）、
    讀屏會唸成「開關」、鍵盤語意壞掉，而且是在用一個 Apple 剛封過一次的行為。
- **要你確認的變數**：**你的 iPhone 現在是 iOS 幾？** 若還停在 26.4 以下，程式化那條現在還能用——
  但它會在下次系統更新時消失，而這個 app 只有你一個使用者、系統會自動更新。

---

## 五、圖示與字重細節（大半已經做到了）

- **圓形線端：已經做了**——`app.css:102` 與 `app.css:786` 兩處都有
  `stroke-linecap: round; stroke-linejoin: round`。這本來是我要推薦的第一名，查了才發現在手上。
- **光學尺寸的 tracking：已經對齊**——`--track-hero/-md/-lg/-base/-xs` 隨字級走，
  正是 SF Pro 光學尺寸在做的事。

### 5-A 700 降到 600（唯一剩下的）

- **現在**：font-weight 四階 400/500/600/700；餐別標題是 `--t-md`/700（DESIGN.md 元件規則）。
- **iOS**：SF 的 UI 字重階梯多半停在 semibold(600)，bold(700) 少用在這種層級的標題。
- **改哪裡**：餐別標題 700→600，實機看它撐不撐得住與品項列的層級差。
- **值不值得**：**可以試，價值有限**。改一個值，回不去也只是改回來。品味題，要看實機。

### 5-B stroke-width 隨圖示尺寸調

現在 1.6 固定（例外 2.2）。SF Symbols 會隨尺寸調比例，但 Tally 的圖示尺寸範圍只有 17–20px，
差異看不出來。**不做**。

---

## 「不像網頁」那一組：也大半做完了

如果你要的其實不是「照抄 iOS 的視覺」而是「用起來不像網頁」，那是另一組東西，現況是：

| 項目 | 現況 |
| --- | --- |
| 點擊 300ms 延遲、double-tap 誤觸縮放 | 已做 `touch-action: manipulation`（`app.css:98`） |
| 藍色點擊高亮 | 已做 `-webkit-tap-highlight-color: transparent`（`app.css:93`） |
| 捲到底把整頁拉動 | 已做 `overscroll-behavior: contain`（`app.css:836`、`1061`，兩個容器） |
| 全螢幕、無網址列 | manifest 已 `display: standalone`；PWA 那條在待辦（active.md 續點 2） |
| 長按選字 | **還沒做** `user-select: none`（全 `src/` 查無）——最後一個明顯的網頁殘留。**但只該套在介面外殼與控件上，不套內容文字**：全域一刀切會連品名與營養數字都不能複製，而那是無障礙常見抱怨 |

---

## 我的排序建議

**做**：1-A（左滑 spring）→ 2-A（scrim 模糊）→ 5-A（700→600，實機看）
**不做**：1-B／1-C／1-D、2-B、3、5-B
**移出範圍**：第四項（觸覺回饋，平台沒給）
**順帶可考慮**：`user-select: none`（上表最後一列，跟五個面向無關但便宜）

---

## 來源（平台行為）

- [WebKit switch 控件 haptic 與 iOS 26.5 修補](https://github.com/doublej/web-haptics-polyfill)
- [ios-haptics（同一 hack 的函式庫，載明 17.4–26.4 適用）](https://github.com/tijnjh/ios-haptics)
- [project-fathom（iOS 26.5 後只剩「真手指點」路徑）](https://github.com/m1ckc3s/project-fathom)
