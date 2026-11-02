import { useCallback, useEffect, useRef, useState } from 'react'
import { listIntakeDates, type IntakeRow } from '@/lib/api'
import { monthBounds, type MonthKey } from '@/lib/dates'

export function useMonthMarks(rows: IntakeRow[] | null, currentDate: string) {
  /* 週列／月曆的小點（v2.53）：有飲食紀錄的日子。按「月」抓、抓過的月不重抓（loadedMonthsRef 去重，
     失敗就放掉去重旗標讓下次再試）。失敗靜默——小點是附帶資訊，彈錯誤畫面是過度反應，
     而且離線時整頁本來就已經有提示。沒載到的月份沒有小點，**不是「那個月沒紀錄」**。
     之後在目前這一天做的增刪（見下面的 effect）直接改這份集合，不重撈。 */
  const [markedDates, setMarkedDates] = useState<ReadonlySet<string>>(() => new Set())
  const loadedMonthsRef = useRef<Set<MonthKey>>(new Set())
  /* 畫面上讀過品項的日子，本機的「有沒有紀錄」比月份查詢新：查詢在飛的期間使用者刪光了某天，
     回來的結果不可以把剛移掉的小點加回去（review 抓到）。 */
  const localMarksRef = useRef<Map<string, boolean>>(new Map())
  const loadMonthMarks = useCallback((key: MonthKey) => {
    if (loadedMonthsRef.current.has(key)) return
    loadedMonthsRef.current.add(key)
    const { from, to } = monthBounds(key)
    listIntakeDates(from, to)
      .then((dates) => {
        const fresh = [...dates].filter((d) => localMarksRef.current.get(d) !== false)
        setMarkedDates((prev) => new Set([...prev, ...fresh]))
      })
      .catch(() => {
        loadedMonthsRef.current.delete(key)
      })
  }, [])
  /* 目前這一天的增刪即時反映在小點：rows 變了就把這天加進／移出集合（含刪除的樂觀移除與復原）。
     rows 為 null＝載入中，不動。 */
  useEffect(() => {
    if (rows === null) return
    const has = rows.length > 0
    localMarksRef.current.set(currentDate, has)
    setMarkedDates((prev) => {
      if (prev.has(currentDate) === has) return prev
      const next = new Set(prev)
      if (has) next.add(currentDate)
      else next.delete(currentDate)
      return next
    })
  }, [rows, currentDate])
  return { markedDates, loadMonthMarks }
}
