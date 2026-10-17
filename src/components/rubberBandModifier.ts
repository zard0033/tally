/* 訓練中排序用的 dnd-kit modifier：把被拖的卡限制在指定元素（清單區）內，超出邊界的部分用橡皮筋阻力，
   最多露出約 14px，放手回到範圍內。基底是 dnd-kit 自己的 RestrictToElement（它負責量邊界、隨捲動與縮放更新），
   這裡只把「硬夾在邊界」改成「夾住之後再加上衰減的超出量」。 */
import { configure } from '@dnd-kit/abstract'
import type { DragDropManager } from '@dnd-kit/dom'
import { RestrictToElement } from '@dnd-kit/dom/modifiers'
import { rubberBand } from '@/lib/rubberBand'

type Operation = DragDropManager['dragOperation']

class RubberBandToElement extends RestrictToElement {
  apply(operation: Operation) {
    const clamped = super.apply(operation)
    const { transform } = operation
    return {
      x: clamped.x + rubberBand(transform.x - clamped.x),
      y: clamped.y + rubberBand(transform.y - clamped.y),
    }
  }
}

/** 用法：`<DragDropProvider modifiers={[rubberBandToElement(() => listRef.current)]}>` */
export const rubberBandToElement = (element: () => Element | null) => configure(RubberBandToElement, { element })
