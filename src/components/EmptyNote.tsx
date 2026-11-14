/* 空狀態列（v2.135）：56px --plate 圓盤裡一個故事書圖示，字在右邊。v2.132 訓練頁「還沒有課表」那款，
   推到食品庫、體重趨勢、訓練中、訓練分析的「第一次使用、還沒有東西」。圖示是裝飾（字說過一次），aria-hidden。
   圖示出自 `_design-sample/other-pages-directions.html`（v2.132 樣張畫的設定列首圖示，當時沒採用在列首）。 */
import type { ReactNode } from 'react'

export type EmptyArt = 'notebook' | 'bowl' | 'scale' | 'dumbbell' | 'bars'

function Art({ art }: { art: EmptyArt }) {
  switch (art) {
    case 'notebook':
      /* 一本筆記本夾著書籤、旁邊一支鉛筆 */
      return (
        <>
          <rect x="11" y="8.5" width="25" height="31" rx="4" fill="var(--accent)" />
          <rect x="11" y="8.5" width="5.2" height="31" rx="2.6" fill="var(--ink)" opacity=".3" />
          <rect x="20" y="16" width="12" height="2.6" rx="1.3" fill="var(--snow)" />
          <rect x="20" y="21.6" width="12" height="2.6" rx="1.3" fill="var(--snow)" />
          <rect x="20" y="27.2" width="7.4" height="2.6" rx="1.3" fill="var(--snow)" />
          <path d="M29.4 8.5h5.2v11.6l-2.6-2.2-2.6 2.2z" fill="var(--clay)" />
          <g transform="rotate(28 37 31)">
            <rect x="34.4" y="22" width="5.2" height="14" rx="1.6" fill="var(--sun)" />
            <path d="M34.4 36h5.2l-2.6 4.6z" fill="var(--sun-deep)" />
          </g>
        </>
      )
    case 'bowl':
      /* 一只空碗（跟「飯類」類型圖示同一只，碗裡沒有飯） */
      return (
        <>
          <path d="M9 22.4h30c0 8-6.8 14-15 14s-15-6-15-14z" fill="var(--accent)" />
          <rect x="8.6" y="21.2" width="30.8" height="3.2" rx="1.6" fill="var(--hill-mid)" />
          <rect x="18" y="35.2" width="12" height="3" rx="1.5" fill="var(--ink)" />
        </>
      )
    case 'scale':
      /* 體重計（俯視） */
      return (
        <>
          <rect x="9" y="10" width="30" height="28" rx="7.5" fill="var(--accent)" />
          <path d="M15 27a9 9 0 0 1 18 0z" fill="var(--snow)" />
          <path d="M24 27l4.4-6.4" stroke="var(--clay)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <circle cx="24" cy="27" r="2" fill="var(--clay)" />
          <rect x="14" y="31.2" width="20" height="3" rx="1.5" fill="var(--hill-far)" />
        </>
      )
    case 'dumbbell':
      return (
        <>
          <rect x="13" y="22.4" width="22" height="3.4" rx="1.7" fill="var(--ink)" />
          <rect x="9" y="15.5" width="6.4" height="17" rx="3.2" fill="var(--accent)" />
          <rect x="32.6" y="15.5" width="6.4" height="17" rx="3.2" fill="var(--accent)" />
          <rect x="5" y="19.4" width="4.2" height="9.2" rx="2.1" fill="var(--ink)" />
          <rect x="38.8" y="19.4" width="4.2" height="9.2" rx="2.1" fill="var(--ink)" />
        </>
      )
    case 'bars':
      /* 三根長高的柱子 */
      return (
        <>
          <rect x="9.5" y="26" width="7.4" height="12" rx="2.2" fill="var(--hill-mid)" />
          <rect x="20.3" y="19" width="7.4" height="19" rx="2.2" fill="var(--tree)" />
          <rect x="31.1" y="11" width="7.4" height="27" rx="2.2" fill="var(--accent)" />
          <rect x="7.5" y="37.4" width="33" height="3" rx="1.5" fill="var(--ink)" />
        </>
      )
  }
}

export default function EmptyNote({ art, children }: { art: EmptyArt; children: ReactNode }) {
  return (
    <div className="empty-note">
      <span className="empty-ico" aria-hidden="true">
        <svg className="art" viewBox="0 0 48 48">
          <Art art={art} />
        </svg>
      </span>
      <p>{children}</p>
    </div>
  )
}
