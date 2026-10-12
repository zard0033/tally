/* 實測維持熱量卡（spec.md「實測維持熱量」，DESIGN.md v2.49）。**唯讀對帳**：用近 28 天
   吃了多少＋體重怎麼變，反推這個人實際每天燒多少，跟「畫面上的上限」並列，告訴使用者照這個上限吃
   預期每週會變多少。不改目標、不寫任何資料。

   自己抓資料而不是由 DailyGoal 傳進來：這張卡只在每日目標頁出現，抓兩支唯讀查詢的成本
   遠小於為它多開兩條 props 與 Settings 的狀態。算法與窗口定義全在 src/lib/baseline.ts
   （純函式，有單元測試）。 */
import { useEffect, useState } from 'react'
import { listIntakeKcal, listWeights } from '@/lib/api'
import {
  BASELINE_NEEDS,
  WINDOW_DAYS,
  baselineWindow,
  dailyKcalFromRows,
  estimateMaintenance,
  expectedWeeklyChangeKg,
  type BaselineResult,
} from '@/lib/baseline'
import { localDate } from '@/lib/dates'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'done'; result: BaselineResult }

export interface MaintenanceCardProps {
  /** 畫面上顯示的上限（卡）——連未儲存的預覽也算；算不出來傳 null，卡片就只顯示實測值。 */
  targetKcal: number | null
  /** 使用者設定的每週變化（kg，負＝減）；維持／自訂目標傳 null。 */
  plannedKgPerWeek: number | null
}

/** 預期週變化小於這個值就說「大致持平」——體重的日常波動本來就比這大。 */
const FLAT_KG_PER_WEEK = 0.05

/** 體重筆數低於這個數時，依據行要多說一句誤差可能很大。實測（Monte Carlo，日常波動 σ≈0.4 kg）：
 *  4 筆時 p90 誤差約 250–480 卡、8 筆約 200 卡，而我們要對帳的赤字常常只有一兩百卡。 */
const FEW_WEIGHINS = 8

const kg = (n: number) => Math.abs(n).toFixed(2)

function weeklyText(delta: number): string {
  if (Math.abs(delta) < FLAT_KG_PER_WEEK) return '體重大致持平'
  return delta < 0 ? `每週約瘦 ${kg(delta)} kg` : `每週約增加 ${kg(delta)} kg`
}

export default function MaintenanceCard({ targetKcal, plannedKgPerWeek }: MaintenanceCardProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    const { from, end } = baselineWindow(localDate())
    void Promise.all([listIntakeKcal(from, end), listWeights()])
      .then(([rows, weights]) => {
        if (cancelled) return
        const result = estimateMaintenance(
          dailyKcalFromRows(rows),
          weights.map((w) => ({ date: w.measured_on, kg: Number(w.weight_kg) })),
          end,
        )
        setLoad({ state: 'done', result })
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="goal-group" data-card="maintenance">
      <div className="goal-group-title">實測維持熱量</div>
      {load.state === 'loading' && (
        <div className="goal-row"><span className="lb">讀取中…</span></div>
      )}
      {load.state === 'error' && (
        <div className="goal-row"><span className="lb">讀不到記錄</span></div>
      )}
      {load.state === 'done' && load.result.status === 'insufficient' && (
        <>
          <div className="goal-row"><span className="lb">依你的記錄推算</span><span className="val">資料不足</span></div>
          <div className="goal-note-box" style={{ margin: 'var(--s-3)' }}>
            {lackText(load.result)}
          </div>
        </>
      )}
      {load.state === 'done' && load.result.status === 'implausible' && (
        <>
          <div className="goal-row"><span className="lb">依你的記錄推算</span><span className="val">資料看起來有誤</span></div>
          <div className="goal-note-box" style={{ margin: 'var(--s-3)' }}>
            {implausibleText(load.result.slopeKgPerWeek)}
          </div>
        </>
      )}
      {load.state === 'done' && load.result.status === 'ok' && (
        <>
          <div className="goal-row">
            <span className="lb">依你的記錄推算</span>
            <span className="val">約 {Math.round(load.result.maintenance)} 卡</span>
          </div>
          {/* 體重剛好沒有雜訊時區間收斂成一點，「1780–1780」讀起來像壞掉，那就不顯示這一列。
              標籤寫「約六成」：區間是 ±1 個標準誤差，不是 95% 信賴區間，讀者很容易當成後者。 */}
          {Math.round(load.result.low) !== Math.round(load.result.high) && (
            <div className="goal-row">
              <span className="lb">估計範圍（約六成把握）</span>
              <span className="val">{Math.round(load.result.low)}–{Math.round(load.result.high)} 卡</span>
            </div>
          )}
          {targetKcal !== null && (
            <>
              <div className="goal-row">
                <span className="lb">畫面上的上限</span>
                <span className="val">{Math.round(targetKcal)} 卡</span>
              </div>
              <div className="goal-row">
                <span className="lb">照這個上限吃</span>
                <span className="val">{weeklyText(expectedWeeklyChangeKg(load.result.maintenance, targetKcal))}</span>
              </div>
              {plannedKgPerWeek !== null && (
                <div className="goal-row">
                  <span className="lb">你設定的</span>
                  <span className="val">{weeklyText(plannedKgPerWeek)}</span>
                </div>
              )}
            </>
          )}
          <div className="goal-note-box" style={{ margin: 'var(--s-3)' }}>
            {basisText(load.result.loggedDays, load.result.weighIns)}
          </div>
        </>
      )}
    </div>
  )
}

function basisText(loggedDays: number, weighIns: number): string {
  const base = `依據近 ${WINDOW_DAYS} 天記錄 ${loggedDays} 天、體重 ${weighIns} 筆。漏記的餐會讓這個數字偏低；改變運動習慣後約要 3–4 週才跟上。`
  return weighIns < FEW_WEIGHINS ? `${base}體重只有 ${weighIns} 筆，誤差可能到幾百卡，多量幾次會更準。` : base
}

function implausibleText(slopeKgPerWeek: number): string {
  const what = Number.isFinite(slopeKgPerWeek)
    ? `近 ${WINDOW_DAYS} 天體重算出每週變化 ${Math.abs(slopeKgPerWeek).toFixed(1)} kg，不像真的`
    : '算不出體重變化'
  return `${what}。檢查一下近 ${WINDOW_DAYS} 天的體重紀錄有沒有打錯。`
}

/** 資料不足時說清楚缺什麼，不給數字。 */
function lackText(r: Extract<BaselineResult, { status: 'insufficient' }>): string {
  const lack: string[] = []
  if (r.loggedDays < BASELINE_NEEDS.loggedDays) {
    lack.push(`記錄還差 ${BASELINE_NEEDS.loggedDays - r.loggedDays} 天（近 ${WINDOW_DAYS} 天有記 ${r.loggedDays} 天，需要 ${BASELINE_NEEDS.loggedDays}）`)
  }
  if (r.weighIns < BASELINE_NEEDS.weighIns) {
    lack.push(`體重還差 ${BASELINE_NEEDS.weighIns - r.weighIns} 筆（有 ${r.weighIns} 筆，需要 ${BASELINE_NEEDS.weighIns}）`)
  } else if (r.weightSpanDays < BASELINE_NEEDS.weightSpanDays) {
    lack.push(`體重要橫跨 ${BASELINE_NEEDS.weightSpanDays} 天以上（現在 ${r.weightSpanDays} 天）`)
  }
  return lack.join('；') + '。'
}
