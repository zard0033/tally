import { useState } from 'react'
import type { Row, RowOp } from '@/lib/training'

/* 拖曳排序放下後的防閃動：放下的當下先用本機的 pending 順序顯示、寫完才放掉，
   不然函式庫會先把列彈回原位、等寫入完成才跳到新位置，看起來像閃一下。
   RoutineEditor（課表動作）與 TrainingSession（訓練中的動作卡）共用，只差組 ops 的函式。
   buildOps 丟例外或 run 丟例外都在這裡接住、交給 onError；ops 為空＝順序沒變，不寫也不進 pending。 */
export function usePendingOrder<T extends { entry: Row }>({
  items,
  buildOps,
  run,
  onError,
}: {
  items: readonly T[]
  buildOps: (orderedIds: string[]) => RowOp[]
  run: (ops: RowOp[]) => Promise<unknown>
  onError: (e: unknown) => void
}) {
  // 放下後到寫入完成之間的顯示順序（entry id）；null＝照資料的順序
  const [pending, setPending] = useState<string[] | null>(null)

  const shown = pending ? pending.flatMap((id) => items.filter((e) => e.entry.id === id)) : items

  const reorder = async (orderedIds: string[]) => {
    try {
      const ops = buildOps(orderedIds)
      if (ops.length === 0) return
      setPending(orderedIds)
      await run(ops)
    } catch (e) {
      onError(e)
    } finally {
      setPending(null)
    }
  }

  return { shown, reorder }
}
