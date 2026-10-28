/* 左滑露出刪除鈕的一列（訓練中的組列用；飲食頁品項那套手勢的精簡版）。
   手勢常數與紅圓鈕與飲食頁相同（REVEAL／OPEN_AT／SETTLE_SPRING、`.item-delete` 的外觀），差別只有一個：
   **只露出、不做「滑到底直接刪」**——飲食頁的滑到底配 undo 才敢做，這邊沒有 undo，左滑＋點紅鈕已是兩個動作。
   開合狀態由父層控制（同時只有一列是開的）。列開著時點內容＝關掉、不觸發底下的勾或開 sheet；
   拖曳結束後瀏覽器補的那個 click 也吃掉（飲食頁 v3 的做法：記「在此之前的 click 都不算」的時刻）。
   門檻讀「這一列實際位移了多少」（x 這個 motion value），不讀指標原始位移：dragDirectionLock 判成縱向捲動時
   列不會動、offset.x 照樣累積，讀後者會在垂直捲動帶點左偏時靜默吃進「開啟」。 */
import { useRef, type ReactNode } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, type PanInfo } from 'motion/react'
import { SETTLE_SPRING } from '@/lib/durations'

/* 72＝紅鈕右緣內縮 20 ＋ 鈕 44 ＋ 左側留白 8。鈕的中心與上下列的勾同一條線（距列右緣 42px，見 app.css `.swipe-delete`），
   所以比飲食頁的 56 寬——那邊的紅鈕貼右緣內縮 8px，沒有對齊的對象 */
const REVEAL = 72
const OPEN_AT = 24
const CLICK_GRACE_MS = 150

interface SwipeDeleteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void
  /** 紅鈕的讀屏名稱。 */
  deleteLabel: string
  /** 不能刪（例如動作只剩一組）：不接手勢、也不畫紅鈕。 */
  disabled?: boolean
  className?: string
  children: ReactNode
}

export default function SwipeDelete({ open, onOpenChange, onDelete, deleteLabel, disabled = false, className, children }: SwipeDeleteProps) {
  const reduced = useReducedMotion()
  const x = useMotionValue(0)
  const blockClickUntil = useRef(0)
  /* 放手瞬間的橫向速度交棒給吸附用的 spring（motion 不會自己交棒，見 Today.tsx v2.38）；夾上限避免用力一甩衝太遠 */
  const releaseVel = useRef(0)

  if (disabled) return <div className={className ? `swipe-row ${className}` : 'swipe-row'}>{children}</div>

  const onDragEnd = (_: unknown, info: PanInfo) => {
    blockClickUntil.current = Date.now() + CLICK_GRACE_MS
    releaseVel.current = Math.max(-1500, Math.min(1500, info.velocity.x))
    const moved = x.get()
    // 速度也要配 moved < 0 把關：縱向甩動時的 velocity.x 雜訊不該被判成開啟
    const flung = info.velocity.x < -320 && moved < 0
    const next = moved < -OPEN_AT || flung
    onOpenChange(next)
    /* `animate` prop 只在 `open` 真的變了才會重跑：列本來就開著、使用者又往左多拉一截（或沒過門檻的小幅拖動）時 `next === open`，
       沒有任何東西把列吸回去，就停在拖到的位置、與紅鈕隔一段距離（真機回報）。這種情形自己接手吸附到該停的位置；
       `open` 有變的由 prop 那條路負責，不在這裡重複跑。 */
    if (next === open) {
      const target = next ? -REVEAL : 0
      // 減少動態用 jump 不用 set：放手當下 motion 自己已起了一段拉回拖曳範圍的回彈，set 停不掉它、jump 會（e2e 實測 set 留下 -72→-56 的十幾格）
      if (reduced) x.jump(target)
      // 吸附距離只有十幾 px，放手速度沒有意義：往左的速度配上在右邊的目標，spring 會先往左衝最多約 37px 才折回（獨立 review 算出來的）
      else animate(x, target, { ...SETTLE_SPRING, velocity: 0 })
    }
  }

  return (
    <div className={`swipe-row${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        className="swipe-delete"
        type="button"
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        aria-label={deleteLabel}
        onClick={onDelete}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
        </svg>
      </button>
      <motion.div
        className="swipe-slide"
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragMomentum={false}
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={{ left: 0.4, right: 0 }}
        animate={{ x: open ? -REVEAL : 0 }}
        // 速度只在「往左開啟」交棒，收合一律從靜止起跑（理由同 Today.tsx：被打斷的收合不該帶殘留速度）
        transition={reduced ? { duration: 0 } : { ...SETTLE_SPRING, velocity: open ? releaseVel.current : 0 }}
        onAnimationComplete={() => {
          releaseVel.current = 0
        }}
        onDragStart={() => {
          blockClickUntil.current = Infinity
        }}
        onDragEnd={onDragEnd}
        onClickCapture={(e) => {
          if (Date.now() < blockClickUntil.current) {
            e.stopPropagation()
            e.preventDefault()
            return
          }
          if (open) {
            e.stopPropagation()
            e.preventDefault()
            onOpenChange(false)
          }
        }}
      >
        {children}
      </motion.div>
    </div>
  )
}
