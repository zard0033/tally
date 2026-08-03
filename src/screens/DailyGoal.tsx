/* 每日目標頁（v2.22 起獨立成頁，取代原本擠在設定頁的唯讀 dl）：公式估算／自訂目標
   分段控制器＋分組卡片＋即時預覽——改下面任何一格，頂部的熱量／三大營養素當場跟著
   算，不必先按儲存。live 預覽跟送出時的驗證分開：預覽只要求「能不能算」（算不出來
   就顯示 —），送出才擋不合理值，避免使用者打到一半（例如刪掉出生年準備打新的）
   畫面就跳錯誤。 */
import { useRef, useState } from 'react'
import {
  activityChoiceFrom as activityFactorChoiceFrom,
  computeTargets,
  goalFromMode,
  goalModeFrom,
  num,
  numOrNull,
  rateFromMode,
  RATE_PRESETS_KG_PER_MONTH,
  type GoalMode,
  type Profile,
} from '@/lib/formulas'
import type { ProfileRow, Weight } from '@/lib/api'

const ACTIVITY_PRESETS = [
  { value: '1.2', label: '久坐（1.2）' },
  { value: '1.375', label: '輕度（1.375）' },
  { value: '1.55', label: '中度（1.55）' },
  { value: '1.725', label: '高度（1.725）' },
]

function activityChoiceFrom(af: number): string {
  const preset = activityFactorChoiceFrom(af)
  return preset === 'custom' ? 'custom' : String(preset)
}

const GOAL_MODE_OPTIONS: { value: GoalMode; label: string }[] = [
  { value: 'maintain', label: '維持' },
  ...RATE_PRESETS_KG_PER_MONTH.map((p) => ({ value: `cut:${p}` as GoalMode, label: `減重（${p} kg/月）` })),
  ...RATE_PRESETS_KG_PER_MONTH.map((p) => ({ value: `bulk:${p}` as GoalMode, label: `增肌（${p} kg/月）` })),
]

interface DraftForm {
  birthYear: string
  height: string
  sex: string
  goalMode: GoalMode
  activityChoice: string
  customActivity: string
  proteinPerKg: string
  useCustom: boolean
  customKcal: string
  customProtein: string
  customFat: string
  customCarb: string
}

function draftFrom(profile: ProfileRow): DraftForm {
  return {
    birthYear: String(numOrNull(profile.birth_year) ?? ''),
    height: String(numOrNull(profile.height_cm) ?? ''),
    sex: profile.sex,
    goalMode: goalModeFrom(profile.goal, numOrNull(profile.rate_kg_per_week)),
    activityChoice: activityChoiceFrom(num(profile.activity_factor)),
    customActivity: String(numOrNull(profile.activity_factor) ?? ''),
    proteinPerKg: String(numOrNull(profile.protein_g_per_kg) ?? ''),
    useCustom: profile.use_custom_targets,
    customKcal: String(numOrNull(profile.custom_kcal) ?? ''),
    customProtein: String(numOrNull(profile.custom_protein_g) ?? ''),
    customFat: String(numOrNull(profile.custom_fat_g) ?? ''),
    customCarb: String(numOrNull(profile.custom_carb_g) ?? ''),
  }
}

/** 必填欄位：空字串要是 NaN，不能是 num() 的 0——Number('') === 0，如果拿 num() 讀空白的
 *  出生年／身高／蛋白質 g/kg，算出來的不是「算不出來」而是一個荒謬但有限的數字（出生年 0
 *  歲會讓年齡算成兩千多歲），會被下面 preview 的 Number.isFinite 守門放過，變成畫面上
 *  閃一個離譜的熱量而不是 —（precommit-review 抓到）。跟 submit() 送出時用的驗證同一把尺，
 *  只是這裡不擋、只回 NaN 讓它自然傳染。 */
const reqNum = (v: string): number => (v.trim() === '' ? NaN : Number(v.trim()))

/** 即時預覽用：把 draft 表單字串盡量轉成 Profile 餵給 computeTargets，算不出來（欄位
 *  還沒填完）就讓它自然變成 NaN——呼叫端用 Number.isFinite 判斷要不要顯示 —，不在
 *  這裡擋，那是送出時才做的事。 */
function draftToProfile(d: DraftForm): Profile {
  const activityFactor = d.activityChoice === 'custom' ? reqNum(d.customActivity) : num(d.activityChoice)
  return {
    birth_year: reqNum(d.birthYear),
    height_cm: reqNum(d.height),
    activity_factor: activityFactor,
    sex: d.sex,
    goal: goalFromMode(d.goalMode),
    rate_kg_per_week: rateFromMode(d.goalMode),
    protein_g_per_kg: reqNum(d.proteinPerKg),
    use_custom_targets: false,
    custom_kcal: null,
    custom_protein_g: null,
    custom_fat_g: null,
    custom_carb_g: null,
  }
}

interface FieldOpts {
  id: string
  label: string
  required?: boolean
  value: string
  onChange: (v: string) => void
}

function field(opts: FieldOpts) {
  return (
    <div className="field-float" style={{ marginBottom: 0 }}>
      <input
        id={opts.id}
        type="text"
        inputMode="decimal"
        placeholder=" "
        value={opts.value}
        onChange={(e) => opts.onChange(e.target.value)}
      />
      <label htmlFor={opts.id}>
        {opts.label}
        {opts.required && <span className="req">*</span>}
      </label>
    </div>
  )
}

export interface DailyGoalProps {
  profile: ProfileRow
  latestWeight: Weight
  onSaveProfile: (patch: Partial<ProfileRow>) => Promise<void>
  onBack: () => void
  onOpenBodyUpdate: () => void
}

export default function DailyGoal(props: DailyGoalProps) {
  const { profile, latestWeight, onSaveProfile, onBack, onOpenBodyUpdate } = props

  const [draft, setDraft] = useState<DraftForm>(() => draftFrom(profile))
  const [showDetail, setShowDetail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /** DB 的 rate_kg_per_week 換算回 kg/月選單時，若不是剛好落在五個 preset 上（例如既有
   *  使用者的 0.5 kg/週 ≈ 2.17 kg/月，超出這輪選單的上限 1.5），goalModeFrom 只能取最接近
   *  的 preset 顯示。**這個「取最接近」只該影響選單怎麼畫，不該悄悄改掉使用者還沒碰過的
   *  真實數值**——沒有這個 ref，live 預覽與送出都會直接拿 rateFromMode(draft.goalMode) 算，
   *  使用者什麼都沒改、只是進來看一眼就按儲存，DB 裡的速度會被四捨五入成不同的值，且畫面
   *  同時間會跟今日頁／設定頁入口顯示的目標熱量對不上（precommit-review 抓到）。只要使用者
   *  沒有手動動過「目標」選單，一律沿用 profile 上的原始 rate_kg_per_week。 */
  const goalModeTouchedRef = useRef(false)
  const initialRateKgPerWeek = numOrNull(profile.rate_kg_per_week)

  const patch = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => {
    if (key === 'goalMode') goalModeTouchedRef.current = true
    setDraft((p) => ({ ...p, [key]: value }))
  }

  const effectiveRateKgPerWeek = (): number | null => {
    if (goalFromMode(draft.goalMode) === 'maintain') return null
    if (!goalModeTouchedRef.current && initialRateKgPerWeek !== null) return initialRateKgPerWeek
    return rateFromMode(draft.goalMode)
  }

  const rawPreview = draft.useCustom
    ? null
    : computeTargets(
        { ...draftToProfile(draft), rate_kg_per_week: effectiveRateKgPerWeek() },
        num(latestWeight.weight_kg),
        latestWeight.body_fat_pct,
      )
  const preview = rawPreview && Number.isFinite(rawPreview.kcal) ? rawPreview : null

  const bodyFatPct = latestWeight.body_fat_pct
  const bmrFormulaLabel = bodyFatPct !== null ? 'Katch-McArdle' : 'Mifflin-St Jeor'
  const goal = goalFromMode(draft.goalMode)
  const goalLabel = goal === 'cut' ? '減重' : goal === 'bulk' ? '增肌' : '維持'

  async function submit() {
    if (busy) return
    if (draft.useCustom) {
      const kcal = reqNum(draft.customKcal)
      const proteinG = reqNum(draft.customProtein)
      const fatG = reqNum(draft.customFat)
      const carbG = reqNum(draft.customCarb)
      if (!Number.isFinite(kcal) || kcal <= 0) return setErr('熱量要填數字')
      if (![proteinG, fatG, carbG].every((n) => Number.isFinite(n) && n >= 0)) {
        return setErr('蛋白質／脂肪／碳水都要填數字')
      }
      setBusy(true)
      setErr(null)
      try {
        await onSaveProfile({
          use_custom_targets: true,
          custom_kcal: kcal,
          custom_protein_g: proteinG,
          custom_fat_g: fatG,
          custom_carb_g: carbG,
        })
        setBusy(false)
      } catch (e) {
        setBusy(false)
        setErr(e instanceof Error ? e.message : String(e))
      }
      return
    }

    const birthYear = reqNum(draft.birthYear)
    const thisYear = new Date().getFullYear()
    if (!Number.isFinite(birthYear) || birthYear < 1900 || birthYear > thisYear) {
      return setErr('出生年要填合理的西元年')
    }
    const height = reqNum(draft.height)
    if (!Number.isFinite(height) || height <= 0) return setErr('身高要填數字')
    const activityFactor = draft.activityChoice === 'custom' ? reqNum(draft.customActivity) : num(draft.activityChoice)
    if (!Number.isFinite(activityFactor) || activityFactor <= 0 || activityFactor > 3) {
      return setErr('活動係數要填 0–3 之間的數字')
    }
    const proteinPerKg = reqNum(draft.proteinPerKg)
    if (!Number.isFinite(proteinPerKg) || proteinPerKg <= 0 || proteinPerKg > 5) {
      return setErr('攝取蛋白質要填 0–5 之間的數字')
    }

    setBusy(true)
    setErr(null)
    try {
      await onSaveProfile({
        birth_year: birthYear,
        height_cm: height,
        sex: draft.sex,
        goal,
        rate_kg_per_week: effectiveRateKgPerWeek(),
        activity_factor: activityFactor,
        protein_g_per_kg: proteinPerKg,
        use_custom_targets: false,
      })
      setBusy(false)
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="main" data-screen="daily-goal">
      <div className="lib-topbar">
        <button className="icon-btn" type="button" aria-label="返回設定" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1>每日目標</h1>
      </div>

      <div className="goal-seg-wrap">
        <div className="seg" role="group" aria-label="目標計算方式">
          <button type="button" aria-pressed={!draft.useCustom} onClick={() => patch('useCustom', false)}>
            公式估算
          </button>
          <button type="button" aria-pressed={draft.useCustom} onClick={() => patch('useCustom', true)}>
            自訂目標
          </button>
        </div>
      </div>

      <div className="form-wrap" style={{ paddingTop: 0 }}>
        {draft.useCustom ? (
          <>
            <div className="goal-group-title" style={{ paddingLeft: 0 }}>今日目標（自己填）</div>
            {field({ id: 'g-custom-kcal', label: '熱量（卡）', required: true, value: draft.customKcal, onChange: (v) => patch('customKcal', v) })}
            <div style={{ marginTop: 'var(--s-3)' }}>
              {field({ id: 'g-custom-protein', label: '蛋白質 g', value: draft.customProtein, onChange: (v) => patch('customProtein', v) })}
            </div>
            <div style={{ marginTop: 'var(--s-3)' }}>
              {field({ id: 'g-custom-fat', label: '脂肪 g', value: draft.customFat, onChange: (v) => patch('customFat', v) })}
            </div>
            <div style={{ marginTop: 'var(--s-3)' }}>
              {field({ id: 'g-custom-carb', label: '碳水 g', value: draft.customCarb, onChange: (v) => patch('customCarb', v) })}
            </div>
            <div className="goal-note-box" style={{ marginTop: 'var(--s-4)' }}>
              這是你自己設定的目標，沒有套用任何公式，跟身體數據無關。關掉「自訂目標」會退回公式估算——這幾個數字會留著，下次切回來還在。
            </div>
          </>
        ) : (
          <>
            <div className="goal-hero">
              <div className="gauge-num">
                {preview ? Math.round(preview.kcal) : '—'}
                <span className="gauge-unit">卡</span>
              </div>
              <div className="goal-hero-macros">
                {preview
                  ? `蛋白 ${Math.round(preview.protein)}g・脂肪 ${Math.round(preview.fat)}g・碳水 ${Math.round(preview.carb)}g`
                  : '欄位還沒填完，先看不出目標'}
              </div>
              <div className="goal-hero-live">改下面任何一格，這裡會即時跟著算，不用先按儲存</div>
            </div>

            <div className="goal-group">
              <div className="goal-group-title">身體數據</div>
              <div className="goal-row"><span className="lb">最新體重</span><span className="val">{num(latestWeight.weight_kg).toFixed(2)} kg</span></div>
              {bodyFatPct !== null && (
                <div className="goal-row"><span className="lb">體脂率</span><span className="val">{num(bodyFatPct).toFixed(1)} %</span></div>
              )}
              <button className="goal-link-row" type="button" onClick={onOpenBodyUpdate}>
                <span>更新身體數據</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>

            <div className="goal-group">
              <div className="goal-group-title">基本資料</div>
              <div style={{ padding: '0 var(--s-4) var(--s-3)' }}>
                {field({ id: 'g-birth-year', label: '出生年', required: true, value: draft.birthYear, onChange: (v) => patch('birthYear', v) })}
                <div className="field-row" style={{ marginTop: 'var(--s-3)' }}>
                  {field({ id: 'g-height', label: '身高 cm', required: true, value: draft.height, onChange: (v) => patch('height', v) })}
                  <div className="field-float" style={{ marginBottom: 0, flex: 1 }}>
                    <select id="g-sex" value={draft.sex} onChange={(e) => patch('sex', e.target.value)}>
                      <option value="male">男</option>
                      <option value="female">女</option>
                    </select>
                    <label htmlFor="g-sex">性別</label>
                  </div>
                </div>
              </div>
            </div>

            <div className="goal-group">
              <div className="goal-group-title">活動與目標</div>
              <div style={{ padding: '0 var(--s-4) var(--s-3)' }}>
                <div className="field-float" style={{ marginBottom: 0 }}>
                  <select
                    id="g-goal-mode"
                    value={draft.goalMode}
                    onChange={(e) => patch('goalMode', e.target.value as GoalMode)}
                  >
                    {GOAL_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <label htmlFor="g-goal-mode">
                    目標<span className="req">*</span>
                  </label>
                </div>
                <div className="field-row" style={{ marginTop: 'var(--s-3)' }}>
                  <div className="field-float" style={{ marginBottom: 0, flex: 1 }}>
                    <select
                      id="g-activity"
                      value={draft.activityChoice}
                      onChange={(e) => patch('activityChoice', e.target.value)}
                    >
                      {ACTIVITY_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                      <option value="custom">自訂…</option>
                    </select>
                    <label htmlFor="g-activity">
                      活動量<span className="req">*</span>
                    </label>
                  </div>
                  {draft.activityChoice === 'custom' ? (
                    <div style={{ flex: 1 }}>
                      {field({ id: 'g-custom-activity', label: '自訂係數', required: true, value: draft.customActivity, onChange: (v) => patch('customActivity', v) })}
                    </div>
                  ) : (
                    <div style={{ flex: 1 }}>
                      {field({ id: 'g-protein-per-kg', label: '攝取蛋白質 g/kg', required: true, value: draft.proteinPerKg, onChange: (v) => patch('proteinPerKg', v) })}
                    </div>
                  )}
                </div>
                {draft.activityChoice === 'custom' && (
                  <div style={{ marginTop: 'var(--s-3)' }}>
                    {field({ id: 'g-protein-per-kg-2', label: '攝取蛋白質 g/kg', required: true, value: draft.proteinPerKg, onChange: (v) => patch('proteinPerKg', v) })}
                  </div>
                )}
                <p className="note" style={{ margin: 'var(--s-2) 0 0' }}>攝取蛋白質建議 1.6–2.2 g/kg 體重。</p>
              </div>
            </div>

            <button className="link-btn" type="button" style={{ marginTop: 0 }} onClick={() => setShowDetail((v) => !v)}>
              詳細 {showDetail ? '▴' : '▾'}
            </button>
            {showDetail && (
              <div className="goal-detail">
                <div className="goal-src">
                  <div className="t">計算依據</div>
                  <ul>
                    <li>有填體脂率（最新一筆記錄）：用 {bmrFormulaLabel} 公式算 BMR{bodyFatPct !== null ? '（以去脂體重計算）' : '（沒填則不用去脂體重）'}</li>
                    <li>TDEE ＝ BMR × 活動係數</li>
                    <li>減重／增肌依變化速度（7700 卡／公斤換算）在 TDEE 上加減每日熱量差額；維持＝TDEE。{goal !== 'maintain' && `目前是${goalLabel}`}</li>
                    <li>蛋白質＝體重 × g/kg；脂肪／碳水依目標自動配好比例分剩餘熱量（減重 35/65、維持 40/60、增肌 30/70），不開放個別調整</li>
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="confirm-wrap">
        {err && <p className="sheet-error" role="alert">{err}</p>}
        <button type="button" className="pick-bar-btn" disabled={busy} onClick={() => void submit()}>
          {busy ? '儲存中…' : '儲存'}
        </button>
      </div>
    </div>
  )
}
