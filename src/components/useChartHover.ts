import { useMemo, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react'

/* 趨勢圖的「指到哪一天」（v2.149，體重趨勢、吃練體重並排、訓練分析共用）。
   讀數跟著 recharts 自己的 tooltip 狀態走（ChartActiveDay 回報日序），這裡只處理 recharts 不管的事：
   ① 拖完放開要收：recharts 放開後不收 tooltip，released 把它關掉、讀數回到預設。
   ② **點一下不收**：手指移動不到 TAP_SLOP 就放開＝點一下，讀數交給 iOS 隨後補發的 mousemove 換到點到的那天。
      點一下也收的話，連點兩處會是「A → 預設 → B」，就是使用者說的「點的時候會閃一下」（v2.149 review）。
   ③ 重新起手不閃：放開後 recharts 還記著上次那天，下一次碰到圖時它先報那天、等 touchmove 的 rAF 才換。
      所以重新起手那一刻，把 recharts 當下報的值記成 stale 先不採用，直到報上來的是別天。
      在起手那一刻記、不在放開時記：放開時畫面上的值可能比 recharts 落後一幀（touchmove 的 rAF 沒被取消）。
   ④ 讀數取「手指／滑鼠／鍵盤實際在操作的那張圖」：syncId 讓別張跟著報，跟著報的那張不一定比較晚、也可能是舊值。
   事件掛在包住每張圖的 div 上（bind(i)），不掛在 ComposedChart：觸控取消（系統手勢）recharts 沒有接。 */

/** 手指移動不到這麼多 px 就放開＝點一下（iOS 自己判斷點擊的容許量約 10px） */
const TAP_SLOP = 10

export interface ChartHover {
  /** 讀數要指的日序；null＝沒指著，顯示預設 */
  t: number | null
  /** 給 recharts Tooltip 的 active：放開後強制關掉，其餘交給 recharts */
  tipActive: false | undefined
  /** 第 i 張圖的 ChartActiveDay onDay（穩定的 reference） */
  onDay: readonly ((t: number | null) => void)[]
  /** 包住第 i 張圖的 div 要掛的事件 */
  bind: (i: number) => {
    onMouseMove: () => void
    onTouchStart: (e: TouchEvent) => void
    onTouchMove: (e: TouchEvent) => void
    onTouchEnd: () => void
    onTouchCancel: () => void
    onKeyDown: (e: KeyboardEvent) => void
  }
}

export function useChartHover(n: number): ChartHover {
  const [vals, setVals] = useState<(number | null)[]>(() => Array.from({ length: n }, () => null))
  const [active, setActive] = useState(0)
  const [released, setReleased] = useState(false)
  const [stale, setStale] = useState<number | null>(null)
  // 只在事件與 onDay 裡讀寫：onDay 要穩定（ChartActiveDay 的 effect 依賴它），讀現值只能走 ref
  const activeRef = useRef(0)
  const valsRef = useRef<(number | null)[]>(vals)
  const touchRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const onDay = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => (t: number | null) => {
        valsRef.current = valsRef.current.map((v, j) => (j === i ? t : v))
        setVals((prev) => (prev[i] === t ? prev : prev.map((v, j) => (j === i ? t : v))))
        // 操作中的那張圖報了別天：起手的舊值過去了，之後照常採用
        if (t !== null && activeRef.current === i) setStale((s) => (s !== null && s !== t ? null : s))
      }),
    [n],
  )

  const current = vals[active] ?? null
  const shown = released || current === null || current === stale ? null : current

  const take = (i: number) => {
    activeRef.current = i
    setActive(i)
  }
  /** 放開狀態下重新開始操作第 i 張圖：recharts 這一刻報的值是上一輪的，先不採用 */
  const engage = (i: number) => {
    take(i)
    if (released) {
      setStale(valsRef.current[i])
      setReleased(false)
    }
  }
  const release = () => {
    touchRef.current = null
    setReleased(true)
  }
  const bind = (i: number) => ({
    onMouseMove: () => engage(i),
    onTouchStart: (e: TouchEvent) => {
      const p = e.touches[0]
      touchRef.current = p ? { x: p.clientX, y: p.clientY, moved: false } : null
    },
    onTouchMove: (e: TouchEvent) => {
      const p = e.touches[0]
      const s = touchRef.current
      if (s && p && Math.hypot(p.clientX - s.x, p.clientY - s.y) > TAP_SLOP) s.moved = true
      engage(i)
    },
    onTouchEnd: () => {
      // 點一下（沒拖）不收，讀數等補發的 mousemove 換到點到的那天
      if (touchRef.current && !touchRef.current.moved) { touchRef.current = null; return }
      release()
    },
    onTouchCancel: release,
    // 只有方向鍵算「在圖上移動」：Tab、Shift 離開圖時不該把讀數拉回圖上
    onKeyDown: (e: KeyboardEvent) => {
      if (!e.key.startsWith('Arrow') && e.key !== 'Home' && e.key !== 'End') return
      take(i)
      setStale(null)
      setReleased(false)
    },
  })

  return { t: shown, tipActive: released ? false : undefined, onDay, bind }
}
