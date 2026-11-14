/* 每日目標頁與設定頁入口共用的回推估算（spec.md「每日目標改版」）。掛在 Settings 這層，進設定抓一次，
   兩邊讀同一份；體重更新（refreshKey 變）才重抓。失敗不擋頁面，由各自決定怎麼顯示。
   trainingStart（v2.137）：第一筆訓練的日期，之後 28 天不用；訓練資料還沒讀到（undefined）就維持 loading——
   先算一份不排除的、讀到後再換，數字會在眼前跳，還可能閃出一張「有新數字」的卡。 */
import { useEffect, useMemo, useState } from 'react'
import { listIntakeKcal, listWeights } from '@/lib/api'
import {
  LOOKBACK_DAYS,
  WINDOW_DAYS,
  baselineFetchRange,
  baselineWithFallback,
  dailyKcalFromRows,
  maintenanceAdvice,
  type BaselineResult,
  type DailyKcal,
  type MaintenanceAdvice,
  type ShownBaseline,
  type WeightPoint,
} from '@/lib/baseline'
import { localDate } from '@/lib/dates'

export type MaintenanceEstimate =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'done'; current: BaselineResult; shown: ShownBaseline | null }

/** 抓體重的筆數：窗口含回溯的總天數，每天一筆（weight 表同一天只有一列）再留一點餘裕；
 *  api 預設的 90 不夠。 */
const WEIGHT_FETCH = WINDOW_DAYS + LOOKBACK_DAYS + 10

export function useMaintenanceEstimate(refreshKey: string, trainingStart: string | null | undefined): MaintenanceEstimate {
  const [data, setData] = useState<{ daily: DailyKcal[]; weights: WeightPoint[]; today: string } | 'loading' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    const today = localDate()
    const { from, end } = baselineFetchRange(today)
    void Promise.all([listIntakeKcal(from, end), listWeights(WEIGHT_FETCH)])
      .then(([rows, weights]) => {
        if (cancelled) return
        setData({
          daily: dailyKcalFromRows(rows),
          weights: weights.map((w) => ({ date: w.measured_on, kg: Number(w.weight_kg), brk: w.method_break === true })),
          today,
        })
      })
      .catch(() => {
        if (!cancelled) setData('error')
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return useMemo<MaintenanceEstimate>(() => {
    if (data === 'error') return { state: 'error' }
    if (data === 'loading' || trainingStart === undefined) return { state: 'loading' }
    return { state: 'done', ...baselineWithFallback(data.daily, data.weights, data.today, { trainingStart }) }
  }, [data, trainingStart])
}

/** 目前算不算得出建議。自訂目標沒有維持熱量可比，不問；讀不到或還在讀也不問。 */
export function adviceOf(estimate: MaintenanceEstimate, inUseTdee: number | null): MaintenanceAdvice | null {
  if (estimate.state !== 'done' || inUseTdee === null) return null
  return maintenanceAdvice(estimate.current, inUseTdee)
}
