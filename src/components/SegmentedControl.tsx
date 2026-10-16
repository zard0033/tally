/* 分段控制：填色軌道＋會滑動的白塊（全站基礎 spec 規則 1）。今日頁編輯區的餐別、每日目標的計算方式共用。
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
  value: K
  onPick: (key: K) => void
}

export default function SegmentedControl<K extends string>({ label, items, value, onPick }: SegmentedControlProps<K>) {
  const thumbId = useId()
  const reduced = useReducedMotion()
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.key} type="button" aria-pressed={it.key === value} onClick={() => onPick(it.key)}>
          {it.key === value && (
            <motion.span className="seg-thumb" layoutId={thumbId} transition={reduced ? { duration: 0.01 } : SPRING_CARD} aria-hidden="true" />
          )}
          <span className="seg-label">{it.label}</span>
        </button>
      ))}
    </div>
  )
}
