/* 訓練資料的 React 邊界：載入、同步觸發點、寫入、登出收尾。
 *
 * 同步觸發點（spec.md AC 16：只在前景送，不用 Background Sync）：開機登入後、頁面回到前景、
 * `online`、TOKEN_REFRESHED。四者常常幾乎同時到，所以同一時間只跑一輪。
 * 「送」與「重載」分開：每記一組就重載七張表太貴，寫入之後只 flush，重載留給上述觸發點。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { onAuthStateChange } from '@/lib/api'
import type { TrainingView, WriteOp } from '@/lib/trainingRuntime'
import { trainingRuntime } from './trainingSync'

export interface TrainingState {
  /** null＝還沒讀到（載入中），與「讀到了但是空的」要分開。 */
  view: TrainingView | null
  /** 最近一次失敗的白話說明（本機寫入失敗等）；成功一次就清掉。 */
  error: string | null
  /** 排進佇列並立刻更新畫面；本機寫入失敗會 reject，呼叫端要接住並告知「這筆沒有存下來」。 */
  write: (ops: WriteOp[]) => Promise<void>
  /** 主動登出收尾：佇列是空的就連本機底一起清（免得下一個登入的人讀到）；有東西就原樣保留。 */
  settleOnSignOut: () => Promise<void>
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function useTraining(userId: string | null): TrainingState {
  const [view, setView] = useState<TrainingView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = useRef<Promise<void> | null>(null)
  const userRef = useRef(userId)
  userRef.current = userId

  /** 同一時間只跑一輪；後來的呼叫共用那一輪。 */
  const exclusive = useCallback((job: () => Promise<void>): Promise<void> => {
    if (running.current) return running.current
    const p = job().finally(() => {
      running.current = null
    })
    running.current = p
    return p
  }, [])

  /** 先送、再重讀、有新排的（預填）再送一次。送在前：讀回來的底才包含自己剛送出的。 */
  const sync = useCallback(
    () =>
      exclusive(async () => {
        const id = userRef.current
        if (!id) return
        try {
          await trainingRuntime.flush(id)
          let v = await trainingRuntime.load(id)
          // 重數一次而不是看 v.summary：讀取途中（斷網時最久約 8 秒）使用者可能又記了東西，
          // 那些寫入的 flushOnly 被這一輪擋掉了（同時只跑一輪），要在收尾補送
          if ((await trainingRuntime.queue.summary(id)).mine > 0) v = (await trainingRuntime.flush(id)).view
          if (userRef.current === id) {
            setView(v)
            setError(null)
          }
        } catch (e) {
          if (userRef.current === id) setError(errorText(e))
        }
      }),
    [exclusive],
  )

  const flushOnly = useCallback(
    () =>
      exclusive(async () => {
        const id = userRef.current
        if (!id) return
        try {
          const { view: v } = await trainingRuntime.flush(id)
          if (userRef.current === id) setView(v)
        } catch (e) {
          if (userRef.current === id) setError(errorText(e))
        }
      }),
    [exclusive],
  )

  // 先拿本機的（不碰網路）讓畫面立刻有東西，再走一輪完整同步。
  useEffect(() => {
    if (!userId) {
      setView(null)
      setError(null)
      return
    }
    let cancelled = false
    void trainingRuntime
      .view(userId)
      .then((v) => {
        if (!cancelled) setView((cur) => cur ?? v)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e))
      })
    void sync()
    return () => {
      cancelled = true
    }
  }, [userId, sync])

  useEffect(() => {
    if (!userId) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    const onOnline = () => void sync()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    const { data } = onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') void sync()
    })
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      data.subscription.unsubscribe()
    }
  }, [userId, sync])

  const write = useCallback(
    async (ops: WriteOp[]) => {
      const id = userRef.current
      if (!id) return
      try {
        setView(await trainingRuntime.write(id, ops))
        setError(null)
      } catch (e) {
        setError(errorText(e))
        throw e
      }
      void flushOnly()
    },
    [flushOnly],
  )

  const settleOnSignOut = useCallback(async () => {
    if ((await trainingRuntime.queue.entries()).length === 0) await trainingRuntime.clearAll()
  }, [])

  return { view, error, write, settleOnSignOut }
}
