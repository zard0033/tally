/* 維持熱量卡與確認卡（spec.md「每日目標改版」「實測維持熱量」）。算法、窗口與回溯規則全在
   src/lib/baseline.ts（純函式，有單元測試），這裡只決定怎麼說。

   回推值**只有最新 28 天能改用**，而且要使用者按確認才生效：漏記會讓它偏低，一次可能差幾百卡。
   回溯到舊的一段只當參考，要明寫起訖日期，不能讓人把它當成近 28 天。 */
import {
  BASELINE_NEEDS,
  WINDOW_DAYS,
  expectedWeeklyChangeKg,
  insufficientShortfalls,
  type BaselineResult,
  type ShownBaseline,
} from '@/lib/baseline'
import { monthDay } from '@/lib/dates'
import { adviceOf, type MaintenanceEstimate } from '@/useMaintenanceEstimate'

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

export interface ConfirmCardProps {
  result: Extract<BaselineResult, { status: 'ok' }>
  /** 現在的目標（改用前）與改用後的目標。 */
  beforeKcal: number
  afterKcal: number
  bmr: number | null
  plannedKgPerWeek: number | null
  onAdopt: () => void
  onDismiss: () => void
}

/** 記錄算出的數字和現在用的不同：列出前後目標與原因，按「改用」才生效，不按什麼都不變。 */
export function ConfirmCard({ result, beforeKcal, afterKcal, bmr, plannedKgPerWeek, onAdopt, onDismiss }: ConfirmCardProps) {
  return (
    <section className="goal-confirm" aria-label="有新的維持熱量">
      <p className="goal-confirm-t">你的記錄算出維持熱量約 {Math.round(result.maintenance)} 卡</p>
      <p className="goal-confirm-cmp">
        <span className="old">{Math.round(beforeKcal)}</span>
        <span aria-hidden="true"> → </span>
        <span className="new">{Math.round(afterKcal)} 卡</span>
      </p>
      <p className="goal-confirm-why">
        {`照現在的目標吃，${weeklyText(expectedWeeklyChangeKg(result.maintenance, beforeKcal))}`}
        {plannedKgPerWeek !== null && `；你設定的是${weeklyText(plannedKgPerWeek)}`}
        {`。依據近 ${WINDOW_DAYS} 天：記錄 ${result.loggedDays} 天、體重 ${result.weighIns} 筆。漏記的餐會讓這個數字偏低。`}
        {result.weighIns < FEW_WEIGHINS && `體重只有 ${result.weighIns} 筆，誤差可能到幾百卡。`}
      </p>
      {bmr !== null && afterKcal < bmr && (
        <p className="goal-confirm-warn">比基礎代謝 {Math.round(bmr)} 卡低，確定再改。</p>
      )}
      <div className="goal-confirm-acts">
        <button type="button" className="goal-btn quiet" onClick={onDismiss}>先不要</button>
        <button type="button" className="goal-btn primary" onClick={onAdopt}>改用</button>
      </div>
    </section>
  )
}

/** 離「夠用」還有多遠：取三道門檻裡最落後的一道，進度條才不會在還差很多時看起來快滿了。 */
function readiness(r: Extract<BaselineResult, { status: 'insufficient' }>): number {
  const ratio = Math.min(
    r.loggedDays / BASELINE_NEEDS.loggedDays,
    r.weighIns / BASELINE_NEEDS.weighIns,
    r.weightSpanDays / BASELINE_NEEDS.weightSpanDays,
  )
  return Math.min(1, ratio)
}

export interface MaintenanceCardProps {
  estimate: MaintenanceEstimate
  /** 目標實際用的維持熱量；自訂目標傳 null。 */
  inUseTdee: number | null
  /** 公式值：已改用回推時，「改回公式」要說會回到多少。 */
  formulaTdee: number | null
  usingMeasured: boolean
  /** 自訂目標模式：沒有維持熱量可切換，只對帳。 */
  targetKcal: number | null
  isCustom: boolean
  dismissed: boolean
  onUndismiss: () => void
  onRevert: () => void
}

export default function MaintenanceCard(props: MaintenanceCardProps) {
  const { estimate, inUseTdee, formulaTdee, usingMeasured, targetKcal, isCustom, dismissed, onUndismiss, onRevert } = props
  const advice = adviceOf(estimate, inUseTdee)
  const chev = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>

  return (
    <div className="goal-group" data-card="maintenance">
      {inUseTdee !== null && (
        <div className="goal-row">
          <span className="lb">維持熱量</span>
          <span className="val">{Math.round(inUseTdee)} 卡</span>
        </div>
      )}
      {estimate.state === 'loading' && <div className="goal-row"><span className="lb">讀取記錄中…</span></div>}
      {estimate.state === 'error' && <div className="goal-row"><span className="lb">讀不到記錄</span></div>}
      {estimate.state === 'done' && estimate.current.status === 'implausible' && (
        <>
          <div className="goal-row"><span className="lb">依你的記錄推算</span><span className="val">資料看起來有誤</span></div>
          <div className="goal-note-box" style={{ margin: 'var(--s-3)' }}>{implausibleText(estimate.current)}</div>
        </>
      )}
      {estimate.state === 'done' && estimate.current.status === 'insufficient' && (
        <div className="goal-meter">
          <div className="goal-meter-track" role="presentation"><i style={{ width: `${Math.round(readiness(estimate.current) * 100)}%` }} /></div>
          {lackShort(estimate.current)}，就能用你自己的數字。
        </div>
      )}
      {estimate.state === 'done' && estimate.shown?.stale && (
        <StaleRows shown={estimate.shown} current={estimate.current} />
      )}
      {/* 回推值就是現在用的值（改用之後）：同一個數字不列兩次 */}
      {estimate.state === 'done' && estimate.current.status === 'ok' && (inUseTdee === null || Math.round(inUseTdee) !== Math.round(estimate.current.maintenance)) && (
        <div className="goal-row">
          <span className="lb">依你的記錄推算</span>
          <span className="val">約 {Math.round(estimate.current.maintenance)} 卡</span>
        </div>
      )}
      {isCustom && estimate.state === 'done' && estimate.shown && targetKcal !== null && (
        <div className="goal-row">
          <span className="lb">照這個目標吃</span>
          <span className="val">{weeklyText(expectedWeeklyChangeKg(estimate.shown.result.maintenance, targetKcal))}</span>
        </div>
      )}
      {!isCustom && advice?.kind === 'new' && dismissed && (
        <button type="button" className="goal-pick as-btn" onClick={onUndismiss}>
          <span className="lb">記錄算出約 {Math.round(advice.result.maintenance)} 卡，要改用嗎</span>{chev}
        </button>
      )}
      {usingMeasured && !isCustom && formulaTdee !== null && (
        <button type="button" className="goal-pick as-btn" onClick={onRevert}>
          <span className="lb">改回公式（{Math.round(formulaTdee)} 卡）</span>{chev}
        </button>
      )}
    </div>
  )
}

function StaleRows({ shown, current }: { shown: ShownBaseline; current: BaselineResult }) {
  return (
    <>
      {/* 回溯時標題就帶日期：數字本身跟最新那段長得一模一樣，只有灰色說明框寫日期的話，
          掃一眼的人會把三個月前的數字當成現在的（review M4） */}
      <div className="goal-row">
        <span className="lb">依你的記錄推算（{monthDay(shown.from)}–{monthDay(shown.end)}）</span>
        <span className="val">約 {Math.round(shown.result.maintenance)} 卡</span>
      </div>
      <div className="goal-note-box" style={{ margin: 'var(--s-3)' }}>{staleText(shown, current)}</div>
    </>
  )
}

/** 怎麼算的（預設收合）裡的對帳細節：範圍、照這個目標吃、依據。 */
export function EstimateDetail({ estimate, targetKcal, plannedKgPerWeek }: { estimate: MaintenanceEstimate; targetKcal: number | null; plannedKgPerWeek: number | null }) {
  if (estimate.state !== 'done' || estimate.current.status !== 'ok') return null
  const r = estimate.current
  return (
    <>
      {/* 體重剛好沒有雜訊時區間收斂成一點，「1780–1780」讀起來像壞掉，那就不顯示這一列。
          標籤寫「約六成」：區間是 ±1 個標準誤差，不是 95% 信賴區間，讀者很容易當成後者。 */}
      {Math.round(r.low) !== Math.round(r.high) && (
        <div className="goal-row">
          <span className="lb">估計範圍（約六成把握）</span>
          <span className="val">{Math.round(r.low)}–{Math.round(r.high)} 卡</span>
        </div>
      )}
      {targetKcal !== null && (
        <div className="goal-row">
          <span className="lb">照這個目標吃</span>
          <span className="val">{weeklyText(expectedWeeklyChangeKg(r.maintenance, targetKcal))}</span>
        </div>
      )}
      {plannedKgPerWeek !== null && (
        <div className="goal-row">
          <span className="lb">你設定的</span>
          <span className="val">{weeklyText(plannedKgPerWeek)}</span>
        </div>
      )}
      <div className="goal-note-box" style={{ margin: 'var(--s-3)' }}>
        依據近 {WINDOW_DAYS} 天：記錄 {r.loggedDays} 天、體重 {r.weighIns} 筆。漏記的餐會讓這個數字偏低；改變運動習慣後約要 3–4 週才跟上。
        {r.weighIns < FEW_WEIGHINS && `體重只有 ${r.weighIns} 筆，誤差可能到幾百卡，多量幾次會更準。`}
      </div>
    </>
  )
}

function staleText(shown: ShownBaseline, current: BaselineResult): string {
  const { loggedDays, weighIns } = shown.result
  const base = `依據 ${monthDay(shown.from)}–${monthDay(shown.end)}（記錄最多的一連串，不是近 ${WINDOW_DAYS} 天）：記錄 ${loggedDays} 天、體重 ${weighIns} 筆。這段只當參考，不能改用。`
  /* 要補的是什麼要看最新窗口：天天有記只是體重太少時，寫「接回記錄」就是錯的（review）。 */
  const missingLogs = current.status === 'insufficient' && current.loggedDays < BASELINE_NEEDS.loggedDays
  const caveat = missingLogs ? '接回記錄後，這裡會自己更新到近 28 天。' : '多量幾次體重後，這裡會自己更新到近 28 天。'
  return `${base}${caveat}`
}

/** 叫人去查**對的東西**（review）：體重走勢離譜就查體重，維持熱量落界外而斜率正常多半是飲食記錄打錯。 */
function implausibleText(r: Extract<BaselineResult, { status: 'implausible' }>): string {
  switch (r.reason) {
    case 'slope':
      return `近 ${WINDOW_DAYS} 天體重算出每週變化 ${Math.abs(r.slopeKgPerWeek).toFixed(1)} kg，不像真的。檢查一下這段時間的體重紀錄有沒有打錯。`
    case 'range':
      return `算出的維持熱量是 ${Math.round(r.maintenance)} 卡，超出合理範圍。體重走勢正常，所以先檢查近 ${WINDOW_DAYS} 天的飲食記錄有沒有打錯份量或熱量。`
    default:
      return `近 ${WINDOW_DAYS} 天算不出結果。檢查一下體重與飲食記錄有沒有打錯。`
  }
}

function lackShort(r: Extract<BaselineResult, { status: 'insufficient' }>): string {
  return insufficientShortfalls(r).map((s) => {
    switch (s.kind) {
      case 'loggedDays': return `記錄還差 ${s.need - s.have} 天`
      case 'weighIns': return `體重還差 ${s.need - s.have} 筆`
      case 'weightSpanDays': return `體重要橫跨 ${s.need} 天以上`
    }
  }).join('、')
}
