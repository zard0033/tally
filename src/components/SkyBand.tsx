/* 設定頁與訓練頁頂端的矮橫幅（v2.132，樣張 `_design-sample/other-pages-directions.html` 方向 A）。
   一條 96px 的天空＋兩層山，頁面標題（設定）或日期標題（訓練）畫在天空上；插圖 aria-hidden，只是裝飾；標題與日期元件照常可讀。
   兩頁只差山坡上那一件小東西：設定是一棵小樹、訓練是一支啞鈴。

   插圖只鋪上面那 96px（--band-h），children 照常排版：訓練頁的日期元件整個放進來，標題列被撐到橫幅底，
   週列與展開的月曆落在橫幅下面的紙上（DateStrip 本身不用改，今日頁那份不受影響）。
   放在 components/：兩個 screen 共用（CLAUDE.md 的判準）。 */
import type { ReactNode } from 'react'

interface SkyBandProps {
  /** 左邊山坡上的小東西 */
  object: 'tree' | 'dumbbell'
  children: ReactNode
}

export default function SkyBand({ object, children }: SkyBandProps) {
  return (
    <div className="sky-band">
      {/* xMidYMax slice：比 393 寬時等比放大、從天空頂端裁掉，山坡永遠貼著橫幅底；比 393 窄時左右各裁一點 */}
      <svg className="art band-art" viewBox="0 0 393 96" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <rect width="393" height="96" fill="var(--sky)" />
        {/* 太陽與雲往左挪（樣張的太陽在 326）：訓練頁不在今天時右上角有「回今天」，字不能壓在太陽上 */}
        <circle cx="262" cy="38" r="24" fill="var(--sun-pale)" opacity=".6" />
        <circle cx="262" cy="38" r="15" fill="var(--sun)" />
        <g fill="var(--snow)" opacity=".9">
          <g transform="translate(160 22)">
            <ellipse cx="22" cy="17" rx="19" ry="8" />
            <ellipse cx="34" cy="11" rx="13" ry="9" />
            <ellipse cx="46" cy="17" rx="13" ry="7" />
          </g>
          <g transform="translate(292 12) scale(.567)">
            <ellipse cx="22" cy="17" rx="19" ry="8" />
            <ellipse cx="34" cy="11" rx="13" ry="9" />
            <ellipse cx="46" cy="17" rx="13" ry="7" />
          </g>
        </g>
        <path d="M0 64C70 44 130 48 190 60S300 42 393 54V96H0z" fill="var(--hill-far)" />
        <path d="M0 77C80 61 170 65 240 75S350 63 393 69V96H0z" fill="var(--hill-mid)" />
        {object === 'dumbbell' ? (
          <g transform="translate(168 70) rotate(-8)">
            <rect x="-13" y="-1.6" width="26" height="3.2" rx="1.6" fill="var(--ink)" />
            <rect x="-18" y="-7" width="5.6" height="14" rx="2.8" fill="var(--accent)" />
            <rect x="12.4" y="-7" width="5.6" height="14" rx="2.8" fill="var(--accent)" />
            <rect x="-21.4" y="-4" width="3.6" height="8" rx="1.8" fill="var(--ink)" />
            <rect x="17.8" y="-4" width="3.6" height="8" rx="1.8" fill="var(--ink)" />
          </g>
        ) : (
          <g transform="translate(120 70)">
            <rect x="-1.2" y="3" width="2.4" height="8" rx="1.2" fill="var(--hill-near)" />
            <circle cx="0" cy="1" r="6" fill="var(--tree)" />
          </g>
        )}
        <g transform="translate(300 65)">
          <rect x="-1.6" y="4" width="3.2" height="11" rx="1.6" fill="var(--hill-near)" />
          <circle cx="0" cy="1" r="8.5" fill="var(--tree)" />
        </g>
        {/* 最前面這層是紙（同今日頁 v2.125）：頁面就是畫裡的地面，橫幅與頁面之間沒有一條硬邊 */}
        <path d="M0 91C90 82 200 85 290 91S370 89 393 89V96H0z" fill="var(--paper)" />
      </svg>
      {children}
    </div>
  )
}
