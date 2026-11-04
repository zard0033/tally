import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listIntakeForRepeat } from '@/lib/api'
import { shiftDate } from '@/lib/dates'
import { REPEAT_LOOKBACK_DAYS, type RepeatSourceRow } from '@/lib/mealSuggest'

/** 餐建議的回看資料：按日存、缺哪幾天抓哪幾天。不併進 App 的 cacheRef（那份只放當日清單、命中與否是切日期的行為），
 *  也不放進 load 的 Promise.all：查詢失敗不該變全頁錯誤，失敗就是沒有建議，下次換日或 invalidate 再試。 */
export function useRepeatHistory(enabled: boolean, date: string) {
  // 沒有 key＝這天還沒涵蓋（跟「這天沒紀錄」的 [] 要分開）
  const [store, setStore] = useState<ReadonlyMap<string, RepeatSourceRow[]>>(() => new Map())
  /* 日期 → 抓這天的那一次請求。落地時比對：invalidate 或登出之後回來的舊回應丟棄，
     否則寫入後還在飛的查詢會把寫入前的快照放回 store。 */
  const inflightRef = useRef<Map<string, number>>(new Map())
  const tokenRef = useRef(0)

  const days = useMemo(
    () => Array.from({ length: REPEAT_LOOKBACK_DAYS }, (_, i) => shiftDate(date, i - REPEAT_LOOKBACK_DAYS)),
    [date],
  )

  useEffect(() => {
    if (!enabled) return
    const missing = days.filter((d) => !store.has(d) && !inflightRef.current.has(d))
    if (missing.length === 0) return
    const token = ++tokenRef.current
    for (const d of missing) inflightRef.current.set(d, token)
    const stillOurs = () => missing.filter((d) => inflightRef.current.get(d) === token)
    // 最小連續區間：days 由舊到新，中間夾到的已有日子照樣回來，但只有 missing 會落地
    listIntakeForRepeat(missing[0], missing[missing.length - 1])
      .then((rows) => {
        const owned = stillOurs()
        if (owned.length === 0) return
        for (const d of owned) inflightRef.current.delete(d)
        setStore((prev) => {
          const next = new Map(prev)
          for (const d of owned) next.set(d, rows.filter((r) => r.eaten_on === d))
          return next
        })
      })
      .catch(() => {
        for (const d of stillOurs()) inflightRef.current.delete(d)
      })
  }, [enabled, days, store])

  /* identity 必須穩定：它在 commitDelete 的依賴裡，一變動 App 的 pagehide effect 的 cleanup 就會跑，
     換日期時偷送 DELETE（App.tsx commitDelete 上方的註解）。 */
  const invalidate = useCallback((d: string) => {
    inflightRef.current.delete(d)
    setStore((prev) => {
      const next = new Map(prev)
      next.delete(d)
      return next
    })
  }, [])

  /** 登出：store 是上一個帳號的，還在飛的回應也不能採用。 */
  const reset = useCallback(() => {
    inflightRef.current.clear()
    setStore(new Map())
  }, [])

  /* 視窗沒全涵蓋就回 null（沒有建議）：只拿到一部分會把較舊的日子當成最近一次。 */
  const history = useMemo(
    () => (days.every((d) => store.has(d)) ? days.flatMap((d) => store.get(d) ?? []) : null),
    [days, store],
  )

  return { history, invalidate, reset }
}
