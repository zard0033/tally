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
  /** 放棄佇列裡的一條（連帶的子孫一起走），之後以佇列現況刷新畫面。 */
  discard: (seq: number) => Promise<void>
  /** 放棄這一條會連帶消失幾列（不含它自己），給確認框用。 */
  discardImpact: (seq: number) => Promise<number>
  /** 立刻跑一輪完整同步（送、重讀、再送）；進行中就等那一輪，結束後補跑一次。 */
  retry: () => Promise<void>
  /** 主動登出收尾：佇列是空的就連本機底一起清（免得下一個登入的人讀到）；有東西就原樣保留。 */
  settleOnSignOut: () => Promise<void>
  /** 佇列裡還沒上傳的總條數（含別的帳號的）。登出前要不要多問一句就看它。 */
  pendingCount: () => Promise<number>
  /** 使用者確認「仍要登出」之後：清掉佇列與本機底。 */
  discardAll: () => Promise<void>
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function useTraining(userId: string | null): TrainingState {
  const [view, setView] = useState<TrainingView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = useRef<Promise<void> | null>(null)
  /** 一輪進行中又有人要求：記下來，這一輪結束後**補跑一次**（要求裡有 sync 就補 sync）。
   *  只回傳進行中那一輪、不補跑是錯的：離線時最後一次寫入觸發的 flush 還在收尾，這時 `online`
   *  事件到了，被當成「已經有人在跑」丟掉，佇列就一直卡到下一個觸發點（e2e 兩次抓到）。 */
  const queued = useRef<'flush' | 'sync' | null>(null)
  const userRef = useRef(userId)
  userRef.current = userId

  /** 同一時間只跑一輪；進行中到達的要求合併成結束後的一次補跑。
   *  - flush：只送（每記一組就重讀七張表太貴）
   *  - sync：先送、再重讀、有新排的（預填）再送一次。送在前：讀回來的底才包含自己剛送出的。 */
  const request = useCallback((kind: 'flush' | 'sync'): Promise<void> => {
    if (running.current) {
      queued.current = kind === 'sync' || queued.current === 'sync' ? 'sync' : 'flush'
      return running.current
    }
    const perform = async (k: 'flush' | 'sync') => {
      const id = userRef.current
      if (!id) return
      try {
        if (k === 'flush') {
          const { view: v } = await trainingRuntime.flush(id)
          if (userRef.current === id) setView(v)
          return
        }
        await trainingRuntime.flush(id)
        let v = await trainingRuntime.load(id)
        // 重數一次而不是看 v.summary：讀取途中（斷網時最久約 8 秒）使用者可能又記了東西
        if ((await trainingRuntime.queue.summary(id)).mine > 0) v = (await trainingRuntime.flush(id)).view
        if (userRef.current === id) {
          setView(v)
          setError(null)
        }
      } catch (e) {
        if (userRef.current === id) setError(errorText(e))
      }
    }
    const takeQueued = () => {
      const q = queued.current
      queued.current = null
      return q
    }
    const p = (async () => {
      queued.current = null
      let next: 'flush' | 'sync' | null = kind
      while (next) {
        await perform(next)
        next = takeQueued()
      }
      // 同一個同步段落裡放開：takeQueued 回 null 之後若等到 finally（下一個 microtask）才清，
      // 中間進來的要求會被記進 queued、卻沒有人再接，下一輪開頭又把它歸零
      running.current = null
    })().finally(() => {
      if (running.current === p) running.current = null // perform 之外丟錯時的兜底
    })
    running.current = p
    return p
  }, [])

  const sync = useCallback(() => request('sync'), [request])
  const flushOnly = useCallback(() => request('flush'), [request])

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

  const discard = useCallback(async (seq: number) => {
    const id = userRef.current
    if (!id) return
    await trainingRuntime.queue.discard(seq, id)
    const v = await trainingRuntime.view(id)
    if (userRef.current === id) setView(v)
    // 放棄解開了擋路的條目（例如被拒絕的 insert 後面還有別列的等待者）：不等下個觸發點，馬上送
    void flushOnly()
  }, [flushOnly])

  const discardImpact = useCallback(async (seq: number) => {
    const id = userRef.current
    return id ? trainingRuntime.queue.discardImpact(seq, id) : 0
  }, [])

  const settleOnSignOut = useCallback(async () => {
    if ((await trainingRuntime.queue.entries()).length === 0) await trainingRuntime.clearAll()
  }, [])

  const pendingCount = useCallback(async () => (await trainingRuntime.queue.entries()).length, [])
  const discardAll = useCallback(() => trainingRuntime.clearAll(), [])

  return { view, error, write, discard, discardImpact, retry: sync, settleOnSignOut, pendingCount, discardAll }
}
