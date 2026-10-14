/* sheet 掛上時把焦點移進來。vaul 不自己做，焦點會留在觸發的那顆鈕上，而 `#root` 已被標成
   `aria-hidden`（鍵盤與讀屏使用者就卡在被隱藏的區域）。**必須是 callback ref**：掛在 `[open]`
   的 effect 上不會生效，那時 Portal 還沒掛好節點。
   LogSheet／FoodLibrary 各自逐字寫了一份（刻意不抽，見它們的註解）；這一份給訓練的幾張新 sheet
   共用，不再往那兩份旁邊多複製三份。 */
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
