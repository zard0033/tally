/* 每日目標的回推估算（spec.md「每日目標省心」）。掛在 App 這層：開 App 就算（每週自動調整不必等人進設定頁），
   設定頁入口、每日目標頁與底部列的小點讀同一份；體重更新（refreshKey 變）才重抓，重抓期間沿用上一份、不回到 loading。
   scope 是登入的使用者：null＝還沒載完身體參數，不抓；換帳號時上一個帳號的結果當成 loading，不拿來判斷要不要自動調整。
   trainingStart（v2.137）：第一筆訓練的日期，之後 28 天不用；訓練資料還沒讀到（undefined）就維持 loading——
   先算一份不排除的、讀到後再換，數字會在眼前跳，還可能閃出一張「有新數字」的卡。 */
import { useEffect, useMemo, useState } from 'react'
import { listIntakeKcal, listWeights, type ProfileRow } from '@/lib/api'
import {
  LOOKBACK_DAYS,
  WINDOW_DAYS,
  baselineFetchRange,
  baselineWithFallback,
  dailyKcalFromRows,
  maintenanceAdvice,
  type AdviceContext,
  type BaselineResult,
  type DailyKcal,
  type MaintenanceAdvice,
  type ShownBaseline,
  type WeightPoint,
} from '@/lib/baseline'
import { localDate } from '@/lib/dates'
import { numOrNull, type Targets } from '@/lib/formulas'

export type MaintenanceEstimate =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'done'; current: BaselineResult; shown: ShownBaseline | null; today: string; refreshing: boolean }

/** 抓體重的筆數：窗口含回溯的總天數，每天一筆（weight 表同一天只有一列）再留一點餘裕；
 *  api 預設的 90 不夠。 */
const WEIGHT_FETCH = WINDOW_DAYS + LOOKBACK_DAYS + 10

type Fetched = { scope: string; key: string } & ({ daily: DailyKcal[]; weights: WeightPoint[]; today: string } | { error: true })

export function useMaintenanceEstimate(scope: string | null, refreshKey: string, trainingStart: string | null | undefined): MaintenanceEstimate {
  const [data, setData] = useState<Fetched | null>(null)
  // 登出就丟掉：同一個人再登入時不沿用登出前那份（review LOW）
  if (scope === null && data !== null) setData(null)

  useEffect(() => {
    if (scope === null) return
    let cancelled = false
    const today = localDate()
    const { from, end } = baselineFetchRange(today)
    void Promise.all([listIntakeKcal(from, end), listWeights(WEIGHT_FETCH)])
      .then(([rows, weights]) => {
        if (cancelled) return
        setData({
          scope,
          key: refreshKey,
          daily: dailyKcalFromRows(rows),
          // 量法斷點只切體脂（v2.146）：體重看不出平移，回推照常連續；baseline 的分段迴歸留給「換了秤」那天
          weights: weights.map((w) => ({ date: w.measured_on, kg: Number(w.weight_kg) })),
          today,
        })
      })
      .catch(() => {
        if (!cancelled) setData({ scope, key: refreshKey, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [scope, refreshKey])

  return useMemo<MaintenanceEstimate>(() => {
    if (data === null || data.scope !== scope || trainingStart === undefined) return { state: 'loading' }
    if ('error' in data) return { state: 'error' }
    return { state: 'done', ...baselineWithFallback(data.daily, data.weights, data.today, { trainingStart }), today: data.today, refreshing: data.key !== refreshKey }
  }, [data, scope, trainingStart, refreshKey])
}

/** 判斷要用的現況。自訂目標沒有維持熱量可比，回 null（不問也不調）。 */
export function adviceContext(profile: Pick<ProfileRow, 'measured_tdee' | 'measured_tdee_on'>, targets: Targets | null): Omit<AdviceContext, 'today'> | null {
  if (targets === null || targets.tdee === null || !Number.isFinite(targets.tdee)) return null
  return {
    inUseTdee: targets.tdee,
    usingFormula: numOrNull(profile.measured_tdee) === null,
    changedOn: profile.measured_tdee_on ?? null,
    bmr: targets.bmr !== null && Number.isFinite(targets.bmr) ? targets.bmr : null,
    targetOffset: targets.kcal - targets.tdee,
  }
}

/** 目前算不算得出建議。自訂目標不問；讀不到或還在讀也不問。 */
export function adviceOf(estimate: MaintenanceEstimate, ctx: Omit<AdviceContext, 'today'> | null): MaintenanceAdvice | null {
  if (estimate.state !== 'done' || ctx === null) return null
  return maintenanceAdvice(estimate.current, { ...ctx, today: estimate.today })
}
