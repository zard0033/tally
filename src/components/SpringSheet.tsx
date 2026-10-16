/* 自製的 spring sheet（全站精緻度改版 B0；取代 vaul——vaul 的開關是 CSS 過渡，做不出 spring）。

   分工：Base UI Dialog 管無障礙（modal、焦點陷阱、背景 inert、捲動鎖、Escape、點 scrim 關），
   motion 管手感（y 位移 spring、下滑手勢、scrim 隨位置淡出），`lib/sheetPhysics.ts` 決定放手後關或回彈。
   位置與鍵盤處理沿用 app.css 的 `.sheet`（`--kb`、`--vvtop`，DESIGN v2.32–v2.46 反覆修過那一套），
   這裡一行都沒動它——所以 iOS 鍵盤行為與既有 sheet 一致，**但沒有 vaul 那層了，必須真機驗**。

   生命週期：`open` 由呼叫端控制；元件自己多一個 `present`（還在畫面上）。open 變 false 時先跑關閉 spring，
   跑完才讓 Dialog 卸載——這是 Base UI 偵測不到 JS 動畫的情況，所以不靠它的 CSS 動畫偵測，自己決定何時卸。
   `y`＝距離完全展開的下移量（px）：0 完全展開、頂高＝完全在畫面下方。 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { animate, motion, useDragControls, useMotionValue, useReducedMotion, useTransform, type PanInfo } from 'motion/react'
import { SPRING_SHEET_CLOSE, SPRING_SHEET_OPEN } from '@/lib/durations'
import { shouldDismiss } from '@/lib/sheetPhysics'

interface SpringSheetProps {
  open: boolean
  onClose: () => void
  /** 讀屏念的名稱；有 `title` 時以標題為準（aria-labelledby）。 */
  label: string
  /** 標題列。給了就渲染「標題＋關閉鈕」（沿用 `.sheet-head`）。 */
  title?: string
  /** 給 e2e／樣式用的 `data-screen`。 */
  screen?: string
  /** 貼合內容高度。預設近全高（含大量輸入欄位的 sheet）。 */
  fit?: boolean
  /** 開啟時焦點落在哪；不給＝第一個可聚焦元素（標題列的關閉鈕）。 */
  initialFocus?: RefObject<HTMLElement | null>
  /** 鎖住關閉：Escape、點 scrim、下滑手勢都不收（辨識中這類「誤關代價高」的時段）。關閉鈕由呼叫端自己 disable。 */
  locked?: boolean
  /** 把 popup 節點交出去（店家 Autocomplete 的 Portal 要指到這裡）。 */
  popupRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}

/* 下滑起手區：預設只有頂端的把手（與標題列）。沒有標題列的 sheet（記一筆）把手只有約 12px 高，難拉；
   `SheetGrabZone` 讓 sheet 內任何一列（餐別列、新增食物的標題列）也能起手下滑。放在 SpringSheet 底下用。 */
const GrabContext = createContext<((e: ReactPointerEvent) => void) | null>(null)

/** 把這一列變成下滑起手區。`touch-action: pan-x`：垂直方向不交給瀏覽器捲動，才收得到往下拖；橫向（餐別 chip 的捲動）照舊歸瀏覽器。 */
export function SheetGrabZone({ className, children }: { className?: string; children: ReactNode }) {
  const grab = useContext(GrabContext)
  return (
    <div className={className} style={{ touchAction: 'pan-x' }} onPointerDown={grab ?? undefined}>
      {children}
    </div>
  )
}

const screenH = () => (typeof window === 'undefined' ? 800 : window.innerHeight)

export default function SpringSheet({ open, onClose, label, title, screen, fit = false, initialFocus, locked = false, popupRef: outerRef, children }: SpringSheetProps) {
  const reduced = useReducedMotion()
  const [present, setPresent] = useState(open)
  // 起點放在畫面下方：第一次畫出來就在外面，不會在 0 的位置閃一幀
  const y = useMotionValue(screenH())
  const popupRef = useRef<HTMLDivElement | null>(null)
  // scrim 跟著 sheet 自己的高度淡出（貼合內容的 sheet 只有幾百 px，拿螢幕高度算會在關閉尾端跳一格）
  const heightRef = useRef(0)
  const backdrop = useTransform(y, (v) => 1 - Math.min(1, Math.max(0, v / (heightRef.current || screenH() * 0.6))))
  const controls = useDragControls()
  const releaseVelocity = useRef(0)
  const motionRef = useRef<{ stop: () => void } | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  const dragged = useRef(false)

  const run = useCallback(
    (to: number, spring: typeof SPRING_SHEET_OPEN | typeof SPRING_SHEET_CLOSE, velocity = 0, then?: () => void) => {
      motionRef.current?.stop()
      // 往上的速度不帶進 spring：會讓 sheet 抬到靜止位置之上，底下露出一條縫
      const transition = reduced ? { duration: 0.01 } : { ...spring, velocity: Math.max(0, velocity) }
      const c = animate(y, to, transition)
      motionRef.current = c
      void c.then(() => {
        if (motionRef.current === c) then?.()
      })
    },
    [y, reduced],
  )

  // open → present：先掛上（畫面下方），掛好後由 popup 的 ref callback 跑開啟 spring
  useEffect(() => {
    if (open) setPresent(true)
  }, [open])

  // open 變 false：跑關閉 spring，跑完才卸載；中途又被打開就回到 0
  useEffect(() => {
    if (!present) return
    if (open) {
      if (popupRef.current && y.get() > 0.5) run(0, SPRING_SHEET_OPEN, releaseVelocity.current)
      return
    }
    const h = popupRef.current?.offsetHeight ?? screenH()
    run(h, SPRING_SHEET_CLOSE, releaseVelocity.current, () => {
      y.set(screenH())
      releaseVelocity.current = 0
      setPresent(false)
    })
    // eslint 沒開；依賴刻意只看 open／present：run 與 y 都是穩定的
  }, [open, present, run, y])

  // popup 掛進 DOM 的那一刻：量高度、spring 進場
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      popupRef.current = node
      if (outerRef) outerRef.current = node
      if (node) {
        heightRef.current = node.offsetHeight
        y.set(node.offsetHeight)
        run(0, SPRING_SHEET_OPEN)
      }
    },
    [run, y, outerRef],
  )

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const h = popupRef.current?.offsetHeight ?? 0
    if (!lockedRef.current && shouldDismiss({ offset: info.offset.y, velocity: info.velocity.y, height: h })) {
      releaseVelocity.current = info.velocity.y
      onClose()
    } else run(0, SPRING_SHEET_OPEN, info.velocity.y)
  }

  // motion 在 pointerdown 的當下就停掉進行中的動畫；沒有真的拖動（單純點一下）就不會有 onDragEnd，
  // 動畫會停在半路。所以放手後若沒拖過，自己把 sheet 接回 0。關閉中（open 已是 false）整個不接手，
  // 否則 sheet 卡在半路、Dialog 還開著，就是一個關不掉的 modal。
  const onGrabPointerDown = (e: ReactPointerEvent) => {
    if (!openRef.current || lockedRef.current) return
    dragged.current = false
    controls.start(e)
    const settle = () => {
      window.removeEventListener('pointerup', settle)
      window.removeEventListener('pointercancel', settle)
      requestAnimationFrame(() => {
        if (!dragged.current && openRef.current && y.get() > 0.5) run(0, SPRING_SHEET_OPEN)
      })
    }
    window.addEventListener('pointerup', settle)
    window.addEventListener('pointercancel', settle)
  }

  return (
    <Dialog.Root
      open={present}
      onOpenChange={(next) => {
        if (!next && !locked) onClose() // Escape、點 scrim、關閉鈕：交給呼叫端，之後 open 變 false 才跑關閉 spring
      }}
    >
      <Dialog.Portal>
        {/* 關閉 spring 要約 1 秒才卸載，期間 scrim 與 popup 不吃點擊：按「加入」後馬上點別的東西不該被擋 */}
        <Dialog.Backdrop className="scrim" render={<motion.div style={{ opacity: backdrop, pointerEvents: open ? undefined : 'none' }} />} />
        <Dialog.Popup
          ref={attach}
          className={`sheet spring-sheet${fit ? ' sheet-fit' : ''}`}
          aria-label={title ? undefined : label}
          data-screen={screen}
          initialFocus={initialFocus}
          render={
            <motion.div
              style={{ y, pointerEvents: open ? undefined : 'none' }}
              drag="y"
              dragControls={controls}
              dragListener={false}
              dragElastic={0}
              dragMomentum={false}
              onDragStart={() => {
                dragged.current = true
              }}
              onDrag={() => {
                if (y.get() < 0) y.set(0) // 往上拉到頂就停（不做上拉阻力，YAGNI）
              }}
              onDragEnd={onDragEnd}
            />
          }
        >
          <div className="sheet-grab" onPointerDown={onGrabPointerDown}>
            <div className="handle" />
            {title && (
              <div className="sheet-head">
                <Dialog.Title className="sheet-title" render={<h2 />}>
                  {title}
                </Dialog.Title>
                <Dialog.Close className="icon-btn" aria-label="關閉">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </Dialog.Close>
              </div>
            )}
          </div>
          <GrabContext.Provider value={onGrabPointerDown}>{children}</GrabContext.Provider>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
