/* 按鈕的「按下中」標記：pointerdown 設、放開／取消／手指移走就清，展開到按鈕上變成 `data-pressed`，CSS 跟 `:active` 一起吃。
   訓練中組列的勾與欄頭「全部完成」雙勾用（v2.92）。

   **為什麼不只靠 `:active`**：真機回報按住這兩種勾完全沒有「被壓下去」的感覺。桌面 WebKit 量得到 `:active` 生效
   （按住時 `matrix(0.9, …)`），但 iOS Safari 在可捲動容器裡對 `:active` 會延遲或不觸發，而這兩顆勾正好在
   `.tr-scroll`（overflow-y:auto）裡、組列的勾又包在 SwipeDelete 的橫向拖曳層裡——自己用指標事件標記就不看瀏覽器臉色。

   **清除聽 window，不聽按鈕**：手指滑出按鈕才放開時 pointerup 不在按鈕上。SwipeDelete 的 motion drag 拖起來後
   不會發 pointercancel（橫向位移是頁面自己接手的），所以另外把「離起點超過 10px」當成「不是在按、是在拖或捲」——
   10px 同 motion `dragDirectionLock` 判方向的門檻；縱向捲動時瀏覽器會發 pointercancel，一併清。
   監聽只在按下期間掛著，放開或卸載就拆，一排組列不會常駐幾十組 window listener。 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

const MOVE_SLOP_PX = 10

export function usePressed() {
  const [pressed, setPressed] = useState(false)
  const detach = useRef<(() => void) | null>(null)
  useEffect(() => () => detach.current?.(), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || e.currentTarget.disabled) return
    detach.current?.()
    const x0 = e.clientX
    const y0 = e.clientY
    const release = () => {
      detach.current?.()
      setPressed(false)
    }
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > MOVE_SLOP_PX) release()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('pointermove', onMove)
    detach.current = () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('pointermove', onMove)
      detach.current = null
    }
    setPressed(true)
  }

  return { 'data-pressed': pressed || undefined, onPointerDown }
}
