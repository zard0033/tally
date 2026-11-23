import { useEffect, useRef, useState } from 'react'

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** 數字往上滾到 target（ease-out cubic）。只在變大時滾，變小或減少動態直接跳。
 *  今日頁「還能吃」（掛上時不滾，從現值起跳）與訓練完成畫面（from 0、ms 較長）共用。 */
export function useCountUp(target: number, opts: { ms?: number; from?: number } = {}): number {
  const ms = opts.ms ?? 480
  const [shown, setShown] = useState(() => (opts.from !== undefined && !reduceMotion() ? opts.from : target))
  /* 起點是畫面上正在顯示的數字，不是上一次的目標：滾到一半目標又變大（連按份量），從上一個目標起跳會先跳一下（review） */
  const showing = useRef(shown)
  useEffect(() => {
    const start = showing.current
    if (target <= start || reduceMotion()) {
      showing.current = target
      setShown(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      showing.current = Math.round(start + (target - start) * (1 - (1 - p) ** 3))
      setShown(showing.current)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return shown
}
