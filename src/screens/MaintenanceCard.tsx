/* 每日目標頁的「① 維持熱量（TDEE）」與「怎麼算的」（spec.md「每日目標改版」，樣張 _design-sample/daily-goal-v2.html）。
   算法、窗口與回溯規則全在 src/lib/baseline.ts（純函式，有單元測試），這裡只決定怎麼說。

   維持熱量有兩種算法並排：公式推導（BMR × 活動係數）與紀錄回推（近 28 天吃的與體重走勢）。
   圓點標使用中的那個；沒在用的那一列整列可點：紀錄回推先展開確認框、按了才生效（漏記會讓它偏低，
   一次可能差幾百卡），公式推導直接改回。回溯到舊的一段只當參考，要明寫起訖日期。 */
import type { ReactNode } from 'react'
import {
  BASELINE_NEEDS,
  WINDOW_DAYS,
  expectedWeeklyChangeKg,
  insufficientShortfalls,
  type BaselineResult,
  type ShownBaseline,
} from '@/lib/baseline'
import { monthDay } from '@/lib/dates'
import { FAT_G_PER_KG, KCAL_PER_KG, type Goal } from '@/lib/formulas'
import type { MaintenanceEstimate } from '@/useMaintenanceEstimate'

type OkResult = Extract<BaselineResult, { status: 'ok' }>

/** 預期週變化小於這個值就說「大致持平」——體重的日常波動本來就比這大。 */
const FLAT_KG_PER_WEEK = 0.05

/** 體重筆數低於這個數時要多說一句誤差可能很大。實測（Monte Carlo，日常波動 σ≈0.4 kg）：
 *  4 筆時 p90 誤差約 250–480 卡、8 筆約 200 卡，而我們要對帳的赤字常常只有一兩百卡。 */
const FEW_WEIGHINS = 8

const r = Math.round
const kg = (n: number) => Math.abs(n).toFixed(2)
/** 欄位沒填完（出生年清空）時是 NaN：算式裡寫 —，不能出現 NaN。 */
const fin = (n: number) => (Number.isFinite(n) ? n : '—')

function weeklyText(delta: number): string {
  if (Math.abs(delta) < FLAT_KG_PER_WEEK) return '體重大致持平'
  return delta < 0 ? `每週約瘦 ${kg(delta)} kg` : `每週約增加 ${kg(delta)} kg`
}

/** 負數用全形減號 −（toFixed 印的是 ASCII -，跟其他地方的 − 不一樣）。 */
const signed = (n: number, digits?: number) => {
  const abs = digits === undefined ? Math.abs(n) : Math.abs(n).toFixed(digits)
  return n < 0 ? `−${abs}` : String(abs)
}

/** 體重換算的那一項（正數＝在掉，吃的比燒的少）。用畫面上的兩個整數相減，
 *  「平均吃 1846 ＋ 154」才會剛好等於右邊的 2000（各自捨入會差 1）。 */
const shownWeightKcal = (res: OkResult) => r(res.maintenance) - r(res.meanIntake)

/** 「平均吃 1846 ＋ 體重換算 154」：體重在增加時是減號。 */
function recordFormulaText(res: OkResult): ReactNode {
  const w = shownWeightKcal(res)
  return (
    <>
      平均吃 <b>{r(res.meanIntake)}</b> {w < 0 ? '−' : '＋'} 體重換算 <b>{Math.abs(w)}</b>
    </>
  )
}

const InUseTag = () => <span className="goal-tag">使用中</span>

/** 維持熱量的一種算法。使用中＝div（點了沒事）；沒在用＝button，點了切過去。 */
function EstRow(props: { on: boolean; label: string; sub: ReactNode; value: ReactNode; onPick?: () => void; ariaLabel?: string }) {
  const inner = (
    <>
      <span className="goal-radio" aria-hidden="true" />
      <span className="goal-est-tx">
        <span className="goal-est-lb">{props.label}{props.on && <InUseTag />}</span>
        <span className="goal-est-sub">{props.sub}</span>
      </span>
      <span className="goal-est-val">{props.value}</span>
    </>
  )
  if (props.on || !props.onPick) return <div className={`goal-est${props.on ? ' on' : ''}`}>{inner}</div>
  return (
    <button type="button" className="goal-est" onClick={props.onPick} aria-label={props.ariaLabel}>
      {inner}
    </button>
  )
}

export interface ConfirmCardProps {
  result: OkResult
  /** 現在的目標（改用前）與改用後的目標。 */
  beforeKcal: number
  afterKcal: number
  /** 現在用的維持熱量與它的來源：差多少要跟它比。 */
  inUseTdee: number
  usingMeasured: boolean
  bmr: number | null
  plannedKgPerWeek: number | null
  onAdopt: () => void
  onDismiss: () => void
}

/** 改用前的確認：就地展開在「紀錄回推」下面，寫改用後每日目標從多少變多少；不按什麼都不變。 */
export function ConfirmCard({ result, beforeKcal, afterKcal, inUseTdee, usingMeasured, bmr, plannedKgPerWeek, onAdopt, onDismiss }: ConfirmCardProps) {
  const diff = r(result.maintenance) - r(inUseTdee)
  return (
    <section className="goal-confirm" aria-label="改用紀錄回推">
      <p className="goal-confirm-cmp">
        <small>每日目標</small>
        <span className="old">{r(beforeKcal)}</span>
        <span aria-hidden="true">→</span>
        <span className="new">{r(afterKcal)} 卡</span>
      </p>
      <p className="goal-confirm-why">
        {diff !== 0 && `紀錄回推比${usingMeasured ? '現在用的' : '公式推導'}${diff < 0 ? '少' : '多'} ${Math.abs(diff)} 卡。`}
        {`照現在的目標吃，${weeklyText(expectedWeeklyChangeKg(result.maintenance, beforeKcal))}`}
        {plannedKgPerWeek !== null && `；你設定的是${weeklyText(plannedKgPerWeek)}`}
        {`。依據近 ${WINDOW_DAYS} 天：記錄 ${result.loggedDays} 天、體重 ${result.weighIns} 筆。漏記的餐會讓這個數字偏低。`}
        {result.weighIns < FEW_WEIGHINS && `體重只有 ${result.weighIns} 筆，誤差可能到幾百卡。`}
      </p>
      {bmr !== null && afterKcal < bmr && <p className="goal-confirm-warn">比基礎代謝 {r(bmr)} 卡低，確定再改。</p>}
      <div className="goal-confirm-acts">
        <button type="button" className="goal-btn quiet" onClick={onDismiss}>先不要</button>
        <button type="button" className="goal-btn primary" onClick={onAdopt}>改用紀錄回推</button>
      </div>
    </section>
  )
}

/** 離「夠用」還有多遠：取三道門檻裡最落後的一道，進度條才不會在還差很多時看起來快滿了。 */
function readiness(res: Extract<BaselineResult, { status: 'insufficient' }>): number {
  const ratio = Math.min(
    res.loggedDays / BASELINE_NEEDS.loggedDays,
    res.weighIns / BASELINE_NEEDS.weighIns,
    res.weightSpanDays / BASELINE_NEEDS.weightSpanDays,
  )
  return Math.min(1, ratio)
}

/** 紀錄回推「還算不出來／算錯／回溯」時，接在那一列下面的說明。 */
function RecordNotes({ estimate }: { estimate: Extract<MaintenanceEstimate, { state: 'done' }> }) {
  const cur = estimate.current
  return (
    <>
      {cur.status === 'insufficient' && (
        <div className="goal-meter">
          <div className="goal-meter-track" role="presentation"><i style={{ width: `${r(readiness(cur) * 100)}%` }} /></div>
          {lackShort(cur)}，就算得出來。
        </div>
      )}
      {cur.status === 'implausible' && <div className="goal-note-box goal-note-in">{implausibleText(cur)}</div>}
      {estimate.shown?.stale && <StaleRows shown={estimate.shown} current={cur} />}
    </>
  )
}

export interface MaintenanceSectionProps {
  estimate: MaintenanceEstimate
  /** 目標實際用的維持熱量。 */
  inUseTdee: number | null
  formulaTdee: number | null
  bmr: number | null
  activityFactor: number
  usingMeasured: boolean
  /** 按過「改用」存下的那個數字與日期。 */
  measuredTdee: number | null
  measuredOn: string | null
  /** 活動係數那一列（只影響公式推導，掛在它下面；改用紀錄回推時不給）。 */
  activityRow: ReactNode
  /** 確認框（要顯示時才給）。 */
  confirm: ReactNode
  onOpenConfirm: () => void
  onRevert: () => void
}

/** ① 維持熱量（TDEE）：兩種算法並排。 */
export default function MaintenanceSection(p: MaintenanceSectionProps) {
  const { estimate } = p
  const cur = estimate.state === 'done' ? estimate.current : null
  const formulaRow = (
    <EstRow
      on={!p.usingMeasured}
      label="公式推導"
      sub={<>BMR <b>{p.bmr !== null ? r(p.bmr) : '—'}</b> × 活動係數 <b>{p.activityFactor}</b></>}
      value={p.formulaTdee !== null ? `${r(p.formulaTdee)} 卡` : '—'}
      onPick={p.formulaTdee !== null ? p.onRevert : undefined}
      ariaLabel={`改回公式推導，${p.formulaTdee !== null ? r(p.formulaTdee) : '—'} 卡`}
    />
  )

  let recordRow: ReactNode
  if (p.usingMeasured) {
    // 使用中的是按「改用」那天存下的數字，不會自己變；最新回推不一樣時，下面另給一列可以更新
    recordRow = (
      <EstRow
        on
        label="紀錄回推"
        sub={p.measuredOn ? `${monthDay(p.measuredOn)} 確認的數字` : '確認過的數字'}
        value={p.measuredTdee !== null ? `${r(p.measuredTdee)} 卡` : '—'}
      />
    )
  } else if (estimate.state === 'loading') {
    recordRow = <EstRow on={false} label="紀錄回推" sub="用近 28 天吃的與體重變化倒推" value="讀取中…" />
  } else if (estimate.state === 'error') {
    recordRow = <EstRow on={false} label="紀錄回推" sub="用近 28 天吃的與體重變化倒推" value="讀不到紀錄" />
  } else if (cur?.status === 'ok') {
    recordRow = (
      <EstRow
        on={false}
        label="紀錄回推"
        sub={recordFormulaText(cur)}
        value={`${r(cur.maintenance)} 卡`}
        onPick={p.onOpenConfirm}
        ariaLabel={`改用紀錄回推，${r(cur.maintenance)} 卡`}
      />
    )
  } else {
    recordRow = (
      <EstRow
        on={false}
        label="紀錄回推"
        sub="用近 28 天吃的與體重變化倒推"
        value={cur?.status === 'implausible' ? '資料看起來有誤' : '還算不出來'}
      />
    )
  }

  /* 已改用、最新回推又算出不一樣的數字：給一列可以更新（同樣先確認）。範圍內就不打擾。 */
  const newer = p.usingMeasured && cur?.status === 'ok' && p.inUseTdee !== null &&
    (r(p.inUseTdee) < r(cur.low) || r(p.inUseTdee) > r(cur.high))

  return (
    <div className="goal-sec" data-card="maintenance">
      <div className="goal-sec-h"><span>① 維持熱量（TDEE）</span><span className="out">{p.inUseTdee !== null ? `${r(p.inUseTdee)} 卡` : '—'}</span></div>
      <div className="goal-group">
        {formulaRow}
        {!p.usingMeasured && p.activityRow}
        {recordRow}
        {newer && !p.confirm && cur?.status === 'ok' && (
          <button type="button" className="goal-pick as-btn" onClick={p.onOpenConfirm}>
            <span className="lb">最新紀錄回推約 {r(cur.maintenance)} 卡，要更新嗎</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        )}
        {p.confirm}
        {estimate.state === 'done' && <RecordNotes estimate={estimate} />}
      </div>
    </div>
  )
}

/** 自訂目標模式：沒有維持熱量可切換，只對帳。 */
export function CustomCompare({ estimate, targetKcal }: { estimate: MaintenanceEstimate; targetKcal: number | null }) {
  const cur = estimate.state === 'done' ? estimate.current : null
  return (
    <div className="goal-sec" data-card="maintenance">
      <div className="goal-sec-h"><span>對照你的維持熱量</span></div>
      <div className="goal-group">
        <div className="goal-row">
          <span className="lb">紀錄回推的維持熱量</span>
          <span className="val">
            {estimate.state === 'loading' ? '讀取中…'
              : estimate.state === 'error' ? '讀不到紀錄'
              : cur?.status === 'ok' ? `約 ${r(cur.maintenance)} 卡`
              : cur?.status === 'implausible' ? '資料看起來有誤' : '還算不出來'}
          </span>
        </div>
        {estimate.state === 'done' && estimate.shown && targetKcal !== null && (
          <div className="goal-row">
            <span className="lb">照這個目標吃</span>
            <span className="val">{weeklyText(expectedWeeklyChangeKg(estimate.shown.result.maintenance, targetKcal))}</span>
          </div>
        )}
        {estimate.state === 'done' && <RecordNotes estimate={estimate} />}
      </div>
    </div>
  )
}

function StaleRows({ shown, current }: { shown: ShownBaseline; current: BaselineResult }) {
  return (
    <>
      {/* 回溯時標題就帶日期：數字本身跟最新那段長得一模一樣，只有灰色說明框寫日期的話，
          掃一眼的人會把三個月前的數字當成現在的（review M4） */}
      <div className="goal-row">
        <span className="lb">紀錄回推（{monthDay(shown.from)}–{monthDay(shown.end)}）</span>
        <span className="val">約 {r(shown.result.maintenance)} 卡</span>
      </div>
      <div className="goal-note-box goal-note-in">{staleText(shown, current)}</div>
    </>
  )
}

export interface CalcDetailProps {
  estimate: MaintenanceEstimate
  usingMeasured: boolean
  measuredTdee: number | null
  weightKg: number
  bodyFatPct: number | null
  heightCm: number
  age: number
  sex: string
  bmr: number | null
  activityFactor: number
  formulaTdee: number | null
  inUseTdee: number | null
  goal: Goal
  /** 選單上顯示的速度（kg/月）與資料庫實際存的（kg/週，numeric(3,2)）：算式用存的，前面寫選的。 */
  rateKgPerMonth: number | null
  rateKgPerWeek: number | null
  proteinGPerKg: number
  kcal: number
  protein: number
  fat: number
  carb: number
  plannedKgPerWeek: number | null
}

/** 怎麼算的：三段算式對應上面的 ①②③，每個數字都代入你自己的值，算到最後就是頂端的每日目標。 */
export function CalcDetail(p: CalcDetailProps) {
  const cur = p.estimate.state === 'done' ? p.estimate.current : null
  const lean = p.bodyFatPct !== null ? p.weightKg * (1 - p.bodyFatPct / 100) : null
  const ln = (children: ReactNode) => <p className="goal-calc-ln">{children}</p>
  const delta = p.rateKgPerWeek !== null ? (p.rateKgPerWeek * KCAL_PER_KG) / 7 : null
  return (
    <div className="goal-calc">
      <h3>① 公式推導{!p.usingMeasured && <InUseTag />}</h3>
      {lean !== null
        ? <>
            {ln(<>去脂體重 ＝ 體重 <b>{p.weightKg.toFixed(2)}</b> × (1 − 體脂 <b>{p.bodyFatPct!.toFixed(1)}</b>%) ＝ <b>{lean.toFixed(2)}</b> kg</>)}
            {ln(<>BMR（Katch-McArdle）＝ 370 ＋ 21.6 × <b>{lean.toFixed(2)}</b> ＝ <b>{p.bmr !== null ? r(p.bmr) : '—'}</b></>)}
          </>
        : ln(<>BMR（Mifflin-St Jeor）＝ 10 × 體重 <b>{p.weightKg.toFixed(2)}</b> ＋ 6.25 × 身高 <b>{fin(p.heightCm)}</b> − 5 × 年齡 <b>{fin(p.age)}</b> {p.sex === 'male' ? '＋ 5' : '− 161'} ＝ <b>{p.bmr !== null ? r(p.bmr) : '—'}</b></>)}
      {ln(<>維持熱量 ＝ BMR <b>{p.bmr !== null ? r(p.bmr) : '—'}</b> × 活動係數 <b>{p.activityFactor}</b> ＝ <span className="res">{p.formulaTdee !== null ? `${r(p.formulaTdee)} 卡` : '—'}</span></>)}

      <h3>① 紀錄回推{p.usingMeasured && <InUseTag />}</h3>
      {ln(<>維持熱量 ＝ 近 {WINDOW_DAYS} 天平均每天吃的 − 體重每天的變化 × 7700</>)}
      {p.usingMeasured && p.measuredTdee !== null && <p className="goal-calc-fine">使用中的是按「改用」那天存下的 {r(p.measuredTdee)} 卡，不會自己變。</p>}
      {cur?.status === 'ok' ? (
        <>
          {ln(<>
            體重每週 <b>{signed(cur.slopeKgPerWeek, 2)}</b> kg ÷ 7 × 7700 ≈ 每天 <b>{signed(-shownWeightKcal(cur))}</b> 卡
            {shownWeightKcal(cur) !== 0 && `（吃的比燒的${shownWeightKcal(cur) > 0 ? '少' : '多'} ${Math.abs(shownWeightKcal(cur))} 卡）`}
          </>)}
          {ln(<>＝ <b>{r(cur.meanIntake)}</b> {shownWeightKcal(cur) < 0 ? '−' : '＋'} <b>{Math.abs(shownWeightKcal(cur))}</b> ＝ <span className="res">約 {r(cur.maintenance)} 卡</span></>)}
          <p className="goal-calc-fine">
            {`體重走勢是 ${cur.weighIns} 筆體重畫出的趨勢線，不是頭尾兩筆相減。`}
            {r(cur.low) !== r(cur.high) && `估計範圍約 ${r(cur.low)}–${r(cur.high)} 卡（約六成把握）。`}
            {`依據近 ${WINDOW_DAYS} 天：記錄 ${cur.loggedDays} 天、體重 ${cur.weighIns} 筆。漏記的餐會讓它偏低；改變運動習慣後約要 3–4 週才跟上。`}
            {cur.weighIns < FEW_WEIGHINS && `體重只有 ${cur.weighIns} 筆，誤差可能到幾百卡，多量幾次會更準。`}
          </p>
          {p.inUseTdee !== null && (
            <p className="goal-calc-fine">
              {`照現在的目標吃，${weeklyText(expectedWeeklyChangeKg(cur.maintenance, p.kcal))}`}
              {p.plannedKgPerWeek !== null && `；你設定的是${weeklyText(p.plannedKgPerWeek)}`}。
            </p>
          )}
        </>
      ) : (
        <p className="goal-calc-fine">
          {p.estimate.state === 'loading' ? '讀取紀錄中…'
            : p.estimate.state === 'error' ? '讀不到紀錄，這段先算不出來。'
            : cur?.status === 'insufficient'
              ? `還算不出來：近 ${WINDOW_DAYS} 天要記滿 ${BASELINE_NEEDS.loggedDays} 天、量 ${BASELINE_NEEDS.weighIns} 筆體重、體重橫跨 ${BASELINE_NEEDS.weightSpanDays} 天以上。`
              : '近 28 天的資料看起來有誤，這段先不算（上面那一列有說要查什麼）。'}
        </p>
      )}

      <h3>② {p.goal === 'cut' ? '減重' : p.goal === 'bulk' ? '增肌' : '維持'}</h3>
      {p.goal === 'maintain' || delta === null
        ? ln(<>維持不加不減，每日目標＝維持熱量。</>)
        : <>
            {ln(<>速度 <b>{p.rateKgPerMonth ?? '—'}</b> kg/月（存成每週 <b>{p.rateKgPerWeek}</b> kg）；1 公斤約 7700 卡</>)}
            {ln(<>每天{p.goal === 'cut' ? '少' : '多'}吃 ＝ <b>{p.rateKgPerWeek}</b> × 7700 ÷ 7 ＝ <span className="res">{r(delta)} 卡</span></>)}
          </>}
      {p.inUseTdee !== null && ln(<>每日目標 ＝ <b>{r(p.inUseTdee)}</b>{p.goal !== 'maintain' && delta !== null && <> {p.goal === 'cut' ? '−' : '＋'} <b>{r(delta)}</b></>} ＝ <span className="res">{r(p.kcal)} 卡</span></>)}

      <h3>③ 怎麼分</h3>
      {ln(<>蛋白質 ＝ <b>{p.proteinGPerKg}</b> g × 體重 <b>{p.weightKg.toFixed(2)}</b> ＝ <span className="res">{r(p.protein)} g</span></>)}
      {ln(<>脂肪 ＝ <b>{FAT_G_PER_KG}</b> g × 體重 <b>{p.weightKg.toFixed(2)}</b> ＝ <span className="res">{r(p.fat)} g</span></>)}
      {ln(<>
        碳水 ＝（<b>{r(p.kcal)}</b> − 蛋白 <b>{r(p.protein)}</b> × 4 − 脂肪 <b>{r(p.fat)}</b> × 9）÷ 4 ＝ <span className="res">{r(p.carb)} g</span>
        {/* formulas.ts 把負的剩餘熱量夾成 0：算式算出來是負的，要說為什麼寫 0 */}
        {p.kcal - p.protein * 4 - p.fat * 9 < 0 && '（蛋白質和脂肪已經超過目標熱量，剩下的不夠分，算成 0）'}
      </>)}
    </div>
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
function implausibleText(res: Extract<BaselineResult, { status: 'implausible' }>): string {
  switch (res.reason) {
    case 'slope':
      return `近 ${WINDOW_DAYS} 天體重算出每週變化 ${Math.abs(res.slopeKgPerWeek).toFixed(1)} kg，不像真的。檢查一下這段時間的體重紀錄有沒有打錯。`
    case 'range':
      return `算出的維持熱量是 ${r(res.maintenance)} 卡，超出合理範圍。體重走勢正常，所以先檢查近 ${WINDOW_DAYS} 天的飲食記錄有沒有打錯份量或熱量。`
    default:
      return `近 ${WINDOW_DAYS} 天算不出結果。檢查一下體重與飲食記錄有沒有打錯。`
  }
}

function lackShort(res: Extract<BaselineResult, { status: 'insufficient' }>): string {
  return insufficientShortfalls(res).map((s) => {
    switch (s.kind) {
      case 'loggedDays': return `記錄還差 ${s.need - s.have} 天`
      case 'weighIns': return `體重還差 ${s.need - s.have} 筆`
      case 'weightSpanDays': return `體重要橫跨 ${s.need} 天以上`
    }
  }).join('、')
}
