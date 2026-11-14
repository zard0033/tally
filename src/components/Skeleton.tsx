/* 載入中的骨架（v2.135）：取代散在各頁的「載入中…」「讀取中…」純文字。
   延遲 300ms 才出現、呼吸、減少動態時不動（規則在 app.css `.skel`）。 */
import type { CSSProperties, ReactNode } from 'react'

interface SkelProps {
  /** 寬（CSS 長度），預設撐滿 */
  w?: string
  /** 高（CSS 長度），預設 14px */
  h?: string
  /** 圓形（圖示位置）：寬跟著高 */
  round?: boolean
}

export function Skel({ w, h, round }: SkelProps) {
  return <span className={round ? 'skel is-round' : 'skel'} style={{ '--w': w, '--h': h } as CSSProperties} aria-hidden="true" />
}

/** 行內的值還沒讀到（額度、動作數、回推值）：一小段條，寬度跟真值差不多。讀屏讀 label。 */
export function SkelInline({ w, label = '讀取中' }: { w?: string; label?: string }) {
  return (
    <>
      <span className="skel is-inline" style={{ '--w': w } as CSSProperties} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </>
  )
}

/** 一整塊的骨架；讀屏讀隱藏的「載入中…」（e2e 也用這段字分辨「還沒讀到」與「讀到空」）。 */
export function SkelBlock({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={className} aria-busy="true">
      <span className="sr-only">載入中…</span>
      {children}
    </div>
  )
}
