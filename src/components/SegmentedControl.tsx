/* 分段控制：填色軌道＋會滑動的白塊（全站基礎 spec 規則 1）。今日頁編輯區的餐別、每日目標的計算方式、體重趨勢與訓練分析的範圍／分頁共用。
   DOM 與改版前一致：`div.seg[role=group]` 裡是 `button[aria-pressed]`（e2e 與讀屏都吃這個），
   白塊 `.seg-thumb` 是選中那顆鈕的子節點，靠 motion 的 `layoutId` 在鈕與鈕之間用 spring 滑過去。
   沒有升級成 radiogroup 是刻意的取捨（半套 roving tabindex 比不做更糟，見 DESIGN.md「餐別分段控制」條）。 */
import { useId } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { SPRING_CARD } from '@/lib/durations'

export interface SegItem<K extends string> {
  key: K
  label: string
}

interface SegmentedControlProps<K extends string> {
  label: string
  items: SegItem<K>[]
  /** null＝一顆都不亮（每日目標的速度：存的舊值不在任何一格上，v2.166）。 */
  value: K | null
  onPick: (key: K) => void
  /** 整組停用（每日目標用自己填的目標時，速度不影響熱量）。 */
  disabled?: boolean
  /** 容器的額外 class（版面用，例如佔滿整行）。 */
  className?: string
}

export default function SegmentedControl<K extends string>({ label, items, value, onPick, className, disabled }: SegmentedControlProps<K>) {
  const thumbId = useId()
  const reduced = useReducedMotion()
  return (
    <div className={className ? `seg ${className}` : 'seg'} role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.key} type="button" aria-pressed={it.key === value} disabled={disabled} onClick={() => onPick(it.key)}>
          {it.key === value && (
            <motion.span className="seg-thumb" layoutId={thumbId} layoutDependency={value} transition={reduced ? { duration: 0.01 } : SPRING_CARD} aria-hidden="true" />
          )}
          <span className="seg-label">{it.label}</span>
        </button>
      ))}
    </div>
  )
}
