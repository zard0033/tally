/* Safari 26 不讀 theme-color，狀態列的顏色是從頁面頂端的固定色條取的（App 的 .edge-top，v2.124）。
   天空（今日頁的 .sky、設定／訓練頁的 .sky-band、登入／開機／整頁錯誤那幅畫 .gate-art）還頂著色條時把色條染成天空色，狀態列跟天空接起來；
   捲走了換回紙色。ref 掛在含天空的那一塊（會捲的話就是捲動區，onScroll 接 sync）。

   ref 是 callback ref：那一塊卸載（換分頁、進子頁面）時 React 用 null 叫它，順手把色條換回紙色。
   不用 useEffect 的 cleanup——換分頁時舊頁的 passive cleanup 跑在新頁的 ref 掛上**之後**，
   會把新頁剛染好的天空色洗掉（v2.132 設定／訓練頁也有天空之後才會撞到）。 */
import { useCallback, useRef } from 'react'

export function useSkyEdge() {
  const host = useRef<HTMLElement | null>(null)
  const sync = useCallback(() => {
    const sky = host.current?.querySelector('.sky, .sky-band, .gate-art')
    const strip = document.querySelector('.edge-top')
    const onSky = !!sky && !!strip && sky.getBoundingClientRect().bottom > strip.getBoundingClientRect().bottom
    const root = document.documentElement
    // 捲動每一格都會叫到這裡：值沒變就不碰 DOM
    if (onSky === (root.dataset.edge === 'sky')) return
    if (onSky) root.dataset.edge = 'sky'
    else delete root.dataset.edge
  }, [])
  const ref = useCallback(
    (node: HTMLElement | null) => {
      host.current = node
      sync()
    },
    [sync],
  )
  return { ref, sync }
}
