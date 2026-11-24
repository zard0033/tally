/* 「這週」卡的資料（spec「熱量看這一週」）：正在看的那天所在的週，每天吃了多少、哪幾餐有紀錄、哪幾餐按了「沒吃」。
   一週兩支查詢（區間 intake 四欄＋meal_skip），按週抓、抓過的週記著不重抓；失敗給重試。
   正在看的這一天以畫面上的 rows 為準（增刪改當下就反映，不重撈），看過的日子記在 localDays，
   之後切回同一週別天時照舊用它——比當初抓的那份新（同 useMonthMarks 的 localMarksRef）。
   「沒吃」：本機按的與取消的各記一份，疊在抓到的上面（review S2；整份蓋掉會把伺服器上別餐的沒吃弄丟）。
   讀不到的週：當日清單又讀得到了（rows 換了一份）或 online 時，丟掉失敗紀錄重抓（review S6）。
   登出（scope 變 null）全部丟掉；查詢在飛時登出了，回來的不採用（generation）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addMealSkip, listIntakeKcal, listMealSkips, removeMealSkip, type IntakeRow } from '@/lib/api'
import { weekDates } from '@/lib/dates'
import type { MealKey } from '@/lib/meals'
import { dayIntakeFromRows, mergeSkips, type DayIntake, type MainMeal } from '@/lib/weekBudget'

type Fetched = { kcal: Map<string, { kcal: number; logged: Set<MealKey> }>; skips: Map<string, Set<MainMeal>> }
type LocalSkip = { added: Set<MainMeal>; removed: Set<MainMeal> }

export type WeekData =
  | { state: 'loading'; dates: string[] }
  | { state: 'error'; dates: string[] }
  | { state: 'done'; dates: string[]; byDate: Map<string, DayIntake> }

const NONE: ReadonlySet<MainMeal> = new Set()

export function useWeekData(scope: string | null, currentDate: string, rows: IntakeRow[] | null) {
  const dates = useMemo(() => weekDates(currentDate), [currentDate])
  const weekKey = dates[0]
  const [weeks, setWeeks] = useState<Map<string, Fetched | 'error'>>(() => new Map())
  const loadingRef = useRef<Set<string>>(new Set())
  const generationRef = useRef(0)
  /* 畫面上讀過的日子（rows 是那天的最新狀態）。 */
  const [localDays, setLocalDays] = useState<Map<string, { kcal: number; logged: Set<MealKey> }>>(() => new Map())
  const [localSkips, setLocalSkips] = useState<Map<string, LocalSkip>>(() => new Map())

  const load = useCallback((key: string, ds: string[]) => {
    if (loadingRef.current.has(key)) return
    loadingRef.current.add(key)
    const gen = generationRef.current
    const from = ds[0]
    const to = ds[6]
    Promise.all([listIntakeKcal(from, to), listMealSkips(from, to)])
      .then(([rs, sk]) => {
        if (gen !== generationRef.current) return
        // stub 與分頁都可能多給，照區間再濾一次
        const kcal = dayIntakeFromRows(rs.filter((r) => r.eaten_on >= from && r.eaten_on <= to))
        const skips = new Map<string, Set<MainMeal>>()
        for (const s of sk) {
          if (s.eaten_on < from || s.eaten_on > to) continue
          skips.set(s.eaten_on, new Set([...(skips.get(s.eaten_on) ?? []), s.meal]))
        }
        setWeeks((prev) => new Map(prev).set(key, { kcal, skips }))
      })
      .catch(() => {
        if (gen === generationRef.current) setWeeks((prev) => new Map(prev).set(key, 'error'))
      })
      .finally(() => {
        if (gen === generationRef.current) loadingRef.current.delete(key)
      })
  }, [])

  // 登出：上一個帳號的全部丟掉
  useEffect(() => {
    if (scope !== null) return
    generationRef.current++
    loadingRef.current.clear()
    setWeeks(new Map())
    setLocalDays(new Map())
    setLocalSkips(new Map())
  }, [scope])

  useEffect(() => {
    if (scope === null || weeks.has(weekKey)) return
    load(weekKey, dates)
  }, [scope, weekKey, dates, weeks, load])

  /* 丟掉失敗紀錄＝下一輪 effect 重抓。 */
  const dropErrors = useCallback(() => {
    setWeeks((prev) => {
      if (![...prev.values()].includes('error')) return prev
      return new Map([...prev].filter(([, v]) => v !== 'error'))
    })
  }, [])

  // 正在看的這一天：rows 為 null＝載入中，不動。讀得到了＝連得上，順手讓失敗的週重抓
  useEffect(() => {
    if (rows === null) return
    const kcal = rows.reduce((s, r) => s + Number(r.kcal) * Number(r.qty), 0)
    const logged = new Set(rows.map((r) => r.meal))
    setLocalDays((prev) => new Map(prev).set(currentDate, { kcal, logged }))
    dropErrors()
  }, [rows, currentDate, dropErrors])

  useEffect(() => {
    window.addEventListener('online', dropErrors)
    return () => window.removeEventListener('online', dropErrors)
  }, [dropErrors])

  const fetchedSkips = useCallback(
    (date: string): ReadonlySet<MainMeal> => {
      const w = weeks.get(weekDates(date)[0])
      return w && w !== 'error' ? (w.skips.get(date) ?? NONE) : NONE
    },
    [weeks],
  )

  const skipsOf = useCallback((date: string): ReadonlySet<MainMeal> => mergeSkips(fetchedSkips(date), localSkips.get(date)), [fetchedSkips, localSkips])

  /** 按「沒吃」或取消。成功才改畫面（失敗由呼叫端顯示）。 */
  const setSkip = useCallback(async (date: string, meal: MainMeal, on: boolean) => {
    if (on) await addMealSkip(date, meal)
    else await removeMealSkip(date, meal)
    setLocalSkips((prev) => {
      const cur = prev.get(date) ?? { added: new Set<MainMeal>(), removed: new Set<MainMeal>() }
      const added = new Set(cur.added)
      const removed = new Set(cur.removed)
      if (on) {
        added.add(meal)
        removed.delete(meal)
      } else {
        removed.add(meal)
        added.delete(meal)
      }
      return new Map(prev).set(date, { added, removed })
    })
  }, [])

  const data: WeekData = useMemo(() => {
    const w = weeks.get(weekKey)
    if (w === undefined) return { state: 'loading', dates }
    if (w === 'error') return { state: 'error', dates }
    const byDate = new Map<string, DayIntake>()
    for (const d of dates) {
      const k = localDays.get(d) ?? w.kcal.get(d) ?? { kcal: 0, logged: new Set<MealKey>() }
      byDate.set(d, { kcal: k.kcal, logged: k.logged, skipped: mergeSkips(w.skips.get(d) ?? NONE, localSkips.get(d)) })
    }
    return { state: 'done', dates, byDate }
  }, [weeks, weekKey, dates, localDays, localSkips])

  return { week: data, retry: dropErrors, skipsOf, setSkip }
}
