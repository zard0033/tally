/* sheet 掛上時把焦點移進來。vaul 不自己做，焦點會留在觸發的那顆鈕上，而 `#root` 已被標成
   `aria-hidden`（鍵盤與讀屏使用者就卡在被隱藏的區域）。**必須是 callback ref**：掛在 `[open]`
   的 effect 上不會生效，那時 Portal 還沒掛好節點。
   LogSheet、FoodLibrary 換成 SpringSheet 後（`initialFocus`）都不再需要；這一份只給訓練還在 vaul 的幾張 sheet 共用。 */
import { useCallback } from 'react'

export function useSheetFocus() {
  return useCallback((node: HTMLDivElement | null) => {
    if (node) {
      requestAnimationFrame(() => {
        if (node.isConnected && !node.contains(document.activeElement)) node.focus()
      })
    }
  }, [])
}
