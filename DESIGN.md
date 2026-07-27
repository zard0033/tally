# DESIGN.md — Tally

> 動任何 UI 之前先讀這份。所有顏色、字級、間距一律引用下方 token，不硬編。

## 方向

溫暖、平靜的日常記錄工具。使用者一天開五次、每次三秒，所以**掃一眼看完**比資訊完整更重要。

**參照錨點**：使用者自用的 iOS app「小資算熱量」——暖米背景、低對比、圓潤。取其情緒核心，**資訊架構完全重做**（見下方「已否決的做法」）。

**色系來源**：沿用自家 Gambit 專案的 design system（`d:/Personal/Games/Gambit/design/gambit-design-system/colors_and_type.css`）的 cream + jade 子集。兩專案共用色系，對比度已在真實產品上驗證。棋盤色、地圖磚、金色高光不搬。

> Gambit 若改動色票，此處需同步。

## Tokens

### 色彩（只有淺色，不做暗色模式）

```css
:root {
  /* 表面 */
  --paper:        #FAF6F0;   /* 頁面底 · warm cream */
  --card:         #FCF9F3;   /* 卡片 / 分頁列 */
  --raised:       #F4EAD8;   /* 抬起面 */
  --rule:         #E0D3BD;   /* 分隔線 / 進度軌道 */
  --rule-subtle:  #ECE1CD;

  /* 文字 */
  --ink:          #3D2210;   /* 內文 · 對 paper 10:1 (AAA) */
  --ink-muted:    #7A5C44;   /* 次要 · 5.6:1 (AA) */
  --ink-faint:    #A88C76;   /* 裝飾 / placeholder · 永不用於內文 */

  /* 主色 · 深青瓷 jade */
  --accent:       #1C7059;   /* 進度填色 / CTA / 選中態 · 對 paper 5.55:1 */
  --accent-dark:  #155747;   /* hover / pressed */
  --accent-soft:  #CFE9E0;   /* 選取底色 / focus halo */
  --on-accent:    #FFFFFF;   /* accent 填色上的文字 · 4.5:1 */

  /* 破表警告 · 唯一的例外色 */
  --over:         #9A4330;   /* 文字 · 對 paper 6.06:1 */
  --over-fill:    #B8533A;   /* 進度填色 */
  --over-stripe:  #C06A50;   /* 斜紋亮條 */
}
```

**accent 用量守則**：jade 是常態基調（今天一切正常），`--over` 只在破表時出現。頁面上同時只該有一種訊號色。

### 字體

```css
--font-body: -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

**零 webfont、零 CDN**——專案架構限制（GitHub Pages 純靜態、無 build）。層次靠字重與 serif/mono 的角色分工做出來，不靠字型。

**所有數字一律 mono + `font-variant-numeric: tabular-nums`**，讓縱向對齊。

### 字階（1.25 major third，全頁六級以內）

```css
--t-xs:   0.72rem;   /* 11.5px · 標籤 */
--t-sm:   0.8rem;    /* 12.8px · 品項熱量、次要說明 */
--t-base: 0.875rem;  /* 14px   · 品項名、內文 */
--t-md:   1rem;      /* 16px   · 餐別名、CTA、日期 */
--t-hero: 2.75rem;   /* 44px   · 剩餘熱量主數字（600 weight） */
```

### 間距（4pt）

```css
--s-1: 4px;  --s-2: 8px;  --s-3: 12px;
--s-4: 16px; --s-5: 20px; --s-6: 24px;
```

水平邊距固定 `--s-5`（20px）。

### 圓角與層次

```css
--r-btn:  16px;   /* 主 CTA、分頁列外框 */
--r-tab:  12px;   /* 分頁列內層 */
--r-pill: 999px;  /* 圓形節點、chip */
```

**不用陰影。** 分層靠 `--paper` / `--card` / `--raised` 的明度差。

## 元件規則

| 元件 | 規則 |
| --- | --- |
| 主 CTA「記一筆」 | `--accent` 填色、`--on-accent` 文字、min-height 52px、**固定在拇指區不隨內容捲動** |
| 次要動作 | 不填色，`--accent` 文字 |
| 熱量量尺 | 高 8px、圓角 4px、軌道 `--rule`、填色 `--accent` |
| 三大營養素條 | 高 3px、三等分橫排，各自「標籤 → 條 → `60.5/126` 數值」由上而下 |
| 破表狀態 | 填色換 `--over-fill` 並疊 -45° 斜紋（4px 實 / 4px 亮條）、文字換 `--over`。**斜紋是必要的**——紅綠色覺者不靠顏色也要分得出來 |
| 三大營養素判定 | **各自獨立**。脂肪、碳水 >100% 轉破表；蛋白質不足**不**轉紅（吃不夠是待辦，不是錯誤） |
| 時間軸節點 | 已吃＝實心 `--accent` 圓 9px；待記錄＝空心、1.5px `--rule` 邊框。連接線 1px，待記錄段用虛線 |
| 餐別標題 | `--t-md` / 700，下方一條 1px `--rule` 細線與品項切開 |
| 品項列 | 名稱 `--t-base` / 400 `--ink`；熱量 `--t-sm` mono `--ink-muted` |
| 待記錄餐次 | 整行可點，直接進該餐別的記錄流程 |
| 觸控區 | 一律 ≥44×44px。日期箭頭、待記錄整行、分頁 44px；主 CTA 52px |
| 圖示 | 全部 inline SVG，`stroke-width: 1.6`、`fill: none`。不用 emoji、不用 icon font |

## 互動與動效

- 只動 `opacity` 與 `transform`，不動 layout 屬性
- `160ms cubic-bezier(0.4, 0, 0.2, 1)`
- CTA 按下 `translateY(1px)`
- `:focus-visible` 2px `--accent` 外框、offset 3px，**即時出現不做過場**
- `prefers-reduced-motion: reduce` → 全部降到 `0.01ms`，CTA 位移取消

## 禁止事項

本專案的黑名單，每一條都有踩過的理由：

- **不用環圈進度。** 圓環從 Apple Watch 三環來，那裡「填滿＝達成＝好」；吃東西相反，吃到目標不是成就、吃爆才是問題。用橫向量尺。
- **不做暗色模式。**（2026-07-27 決定，只維護淺色一套）
- **不做綠色「達標」狀態。** 綠色若代表「在範圍內」，一天中多數時間都會亮著，常態的顏色沒有資訊量。且使用者 Notion 六天資料裡蛋白質從未達標，那會是死功能。
- **不替使用者預先分配剩餘額度。** 曾把剩餘 957 切成「晚餐 670 / 點心 287」，結果使用者得在心裡反推「不吃點心就能吃 957」——發明一個規則再要人反推它，是設計失敗。改為顯示共用總額。
- **CJK 不用 italic。** 強調靠字重與 `--accent`。
- **不用 webfont / CDN / 任何外部請求。**
- **不用陰影分層。**
- **不硬編色值、字級、間距。** 一律 `var(--token)`；需要新值先加 token。
- **不照抄錨點。** 「小資算熱量」是情緒參照，不是版型範本。

## 已否決的做法（避免重蹈）

| 做法 | 否決理由 |
| --- | --- |
| 沿用錨點的卡片堆疊版型 | 環圈佔滿第一屏只傳達一個數字；最高頻動作「加入食品」藏在捲動後面；空狀態各佔一整張卡 |
| 環圈當主視覺 | 見上方禁止事項 |
| 把「已攝取」放在主數字位置 | 打開 app 要問的是「還能吃多少」，不是「吃了多少」 |
| 飲料點心併進正餐 | 使用者六天每天都有一筆點心，是固定習慣；併入就再也看不出點心吃掉多少——那正是減脂最該單獨盯的一類 |
| 用 11px 的「!」小圖示標示破表 | 實測太小，看起來像引號。改用斜紋 |

## 尚未設計

- 「記一筆」流程（選餐別 → 搜尋食物 → 填份量 → 新增食物）
- 設定頁
- 登入頁（Google OAuth）
- 剩餘額度的分配比例規則（第一版不做，只顯示共用總額）

## 版本紀錄

- **v1 · 2026-07-27** — 走完設計流程 ⓪→➊→➋。骨架＝時間軸＋共用額度＋一屏不捲＋CTA 拇指區；色系＝Gambit cream + jade。定案樣張：`palette-options.html` 的 E 欄。
