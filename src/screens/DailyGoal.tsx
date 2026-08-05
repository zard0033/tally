/* 每日目標頁（v2.22 起獨立成頁，取代原本擠在設定頁的唯讀 dl）：公式估算／自訂目標
   分段控制器＋分組卡片＋即時預覽——改下面任何一格，頂部的熱量／三大營養素當場跟著
   算，不必先按儲存。live 預覽跟送出時的驗證分開：預覽只要求「能不能算」（算不出來
   就顯示 —），送出才擋不合理值，避免使用者打到一半（例如刪掉出生年準備打新的）
   畫面就跳錯誤。 */
import { useRef, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import {
  ACTIVITY_FACTOR_PRESETS,
  computeTargets,
  nearestPreset,
  num,
  numOrNull,
  PROTEIN_G_PER_KG_PRESETS,
  rateMonthlyToWeekly,
  rateWeeklyToMonthly,
  RATE_PRESETS_KG_PER_MONTH,
  type Goal,
  type Profile,
} from '@/lib/formulas'
import type { ProfileRow, Weight } from '@/lib/api'

/** 衛福部標準活動量表的五段係數＋說詞，跟 formulas.ts 的 ACTIVITY_FACTOR_PRESETS 一一對應。 */
const ACTIVITY_LABELS = ['久坐不動', '輕度活動', '中度活動', '高度活動', '非常活躍']
const ACTIVITY_PRESETS = ACTIVITY_FACTOR_PRESETS.map((v, i) => ({ value: String(v), label: `${ACTIVITY_LABELS[i]}（${v}）` }))
const PROTEIN_PRESETS = PROTEIN_G_PER_KG_PRESETS.map((v) => ({ value: String(v), label: `${v} g/kg` }))
const RATE_PRESETS = RATE_PRESETS_KG_PER_MONTH.map((v) => ({ value: String(v), label: `${v} kg/月` }))

/** 目標跟變化速度是兩個獨立欄位（2026-08-04 從合併的單一下拉拆開，理由見 formulas.ts
 *  該段落註解）：目標永遠顯示，速度只在非「維持」時才顯示第二個 select。 */
const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'cut', label: '減重' },
  { value: 'maintain', label: '維持' },
  { value: 'bulk', label: '增肌' },
]

interface DraftForm {
  birthYear: string
  height: string
  sex: string
  goal: Goal
  rateChoice: string
  activityChoice: string
  proteinChoice: string
  useCustom: boolean
  customKcal: string
  customProtein: string
  customFat: string
  customCarb: string
}

function draftFrom(profile: ProfileRow): DraftForm {
  const rateKgPerWeek = numOrNull(profile.rate_kg_per_week)
  const rateKgPerMonth = rateKgPerWeek !== null ? rateWeeklyToMonthly(rateKgPerWeek) : RATE_PRESETS_KG_PER_MONTH[0]
  return {
    birthYear: String(numOrNull(profile.birth_year) ?? ''),
    height: String(numOrNull(profile.height_cm) ?? ''),
    sex: profile.sex,
    goal: profile.goal,
    rateChoice: String(nearestPreset(RATE_PRESETS_KG_PER_MONTH, rateKgPerMonth)),
    activityChoice: String(nearestPreset(ACTIVITY_FACTOR_PRESETS, num(profile.activity_factor))),
    proteinChoice: String(nearestPreset(PROTEIN_G_PER_KG_PRESETS, num(profile.protein_g_per_kg))),
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
 *  這裡擋，那是送出時才做的事。activityFactor／proteinPerKg 由呼叫端算好傳進來
 *  （effectiveActivityFactor／effectiveProteinPerKg，跟 rate 同一套「沒碰過選單就沿用
 *  原始值」的規則，不是單純讀 draft 的選單字串）。 */
function draftToProfile(d: DraftForm, activityFactor: number, proteinPerKg: number): Profile {
  return {
    birth_year: reqNum(d.birthYear),
    height_cm: reqNum(d.height),
    activity_factor: activityFactor,
    sex: d.sex,
    goal: d.goal,
    rate_kg_per_week: d.goal === 'maintain' ? null : rateMonthlyToWeekly(Number(d.rateChoice)),
    protein_g_per_kg: proteinPerKg,
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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /** DB 的 rate_kg_per_week 換算回 kg/月選單時，若不是剛好落在五個 preset 上（例如既有
   *  使用者的 0.5 kg/週 ≈ 2.17 kg/月，超出這輪選單的上限 1.5），draftFrom 只能取最接近
   *  的 preset 顯示。**這個「取最接近」只該影響選單怎麼畫，不該悄悄改掉使用者還沒碰過的
   *  真實數值**——沒有這個 ref，live 預覽與送出都會直接拿 rateMonthlyToWeekly(draft.rateChoice)
   *  算，使用者什麼都沒改、只是進來看一眼就按儲存，DB 裡的速度會被四捨五入成不同的值，且畫面
   *  同時間會跟今日頁／設定頁入口顯示的目標熱量對不上（precommit-review 抓到）。只要使用者
   *  沒有手動動過「變化速度」選單，一律沿用 profile 上的原始 rate_kg_per_week。目標欄位本身
   *  不需要這套——goal 在 DB 裡永遠精準是 cut/maintain/bulk 三者之一，沒有「取最接近」的
   *  近似問題。 */
  const rateTouchedRef = useRef(false)
  const initialRateKgPerWeek = numOrNull(profile.rate_kg_per_week)

  /* 活動量／蛋白質這輪拿掉自訂選項，既有值改用「取最接近的 preset」顯示——跟上面
   * rate_kg_per_week 同一個風險：使用者沒碰過選單就按儲存，不該讓近似值悄悄覆寫
   * 真實資料。同一套 touched-ref 規則照搬一次。 */
  const activityTouchedRef = useRef(false)
  const initialActivityFactor = numOrNull(profile.activity_factor)
  const proteinTouchedRef = useRef(false)
  const initialProteinPerKg = numOrNull(profile.protein_g_per_kg)

  const patch = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => {
    if (key === 'rateChoice') rateTouchedRef.current = true
    if (key === 'activityChoice') activityTouchedRef.current = true
    if (key === 'proteinChoice') proteinTouchedRef.current = true
    setDraft((p) => ({ ...p, [key]: value }))
  }

  const effectiveRateKgPerWeek = (): number | null => {
    if (draft.goal === 'maintain') return null
    if (!rateTouchedRef.current && initialRateKgPerWeek !== null) return initialRateKgPerWeek
    return rateMonthlyToWeekly(Number(draft.rateChoice))
  }
  const effectiveActivityFactor = (): number =>
    !activityTouchedRef.current && initialActivityFactor !== null ? initialActivityFactor : num(draft.activityChoice)
  const effectiveProteinPerKg = (): number =>
    !proteinTouchedRef.current && initialProteinPerKg !== null ? initialProteinPerKg : num(draft.proteinChoice)

  const rawPreview = draft.useCustom
    ? null
    : computeTargets(
        { ...draftToProfile(draft, effectiveActivityFactor(), effectiveProteinPerKg()), rate_kg_per_week: effectiveRateKgPerWeek() },
        num(latestWeight.weight_kg),
        latestWeight.body_fat_pct,
      )
  const preview = rawPreview && Number.isFinite(rawPreview.kcal) ? rawPreview : null

  const bodyFatPct = latestWeight.body_fat_pct
  const goal = draft.goal
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

    // 活動量／蛋白質一律來自固定 preset（select 保證合法值），不必再驗證範圍。
    const patchBase: Partial<ProfileRow> = {
      goal,
      rate_kg_per_week: effectiveRateKgPerWeek(),
      activity_factor: effectiveActivityFactor(),
      protein_g_per_kg: effectiveProteinPerKg(),
      use_custom_targets: false,
    }

    // 出生年／身高／性別只在 Mifflin-St Jeor 分支（沒填體脂率）才用得到——Katch-McArdle
    // 只吃體重與體脂率。有體脂率時這三格整卡都不渲染，維持 DB 既有值不動，不逼使用者
    // 補填跟這次計算無關的資料。
    if (bodyFatPct === null) {
      const birthYear = reqNum(draft.birthYear)
      const thisYear = new Date().getFullYear()
      if (!Number.isFinite(birthYear) || birthYear < 1900 || birthYear > thisYear) {
        return setErr('出生年要填合理的西元年')
      }
      const height = reqNum(draft.height)
      if (!Number.isFinite(height) || height <= 0) return setErr('身高要填數字')
      patchBase.birth_year = birthYear
      patchBase.height_cm = height
      patchBase.sex = draft.sex
    }

    setBusy(true)
    setErr(null)
    try {
      await onSaveProfile(patchBase)
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
              <div className="goal-row">
                <span className="lb">
                  BMR
                  {/* 公式說明原本是 BMR 底下一段常駐的 .goal-hint，中文折成兩行、把整張卡撐高，
                      而它是「想確認才看」的資訊，不是每次都要讀的。收進 popover：**不是 tooltip**
                      ——tooltip 靠 hover/focus 觸發，手機沒有 hover 就打不開，這個 app 是手機為主。 */}
                  <Popover.Root>
                    <Popover.Trigger className="info-btn" aria-label="BMR 是怎麼算的">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 11v5" />
                        <path d="M12 7.6v.5" />
                      </svg>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={12}>
                        {/* Popup 帶 dialog 語意，沒有可及名稱時讀屏會播報一個沒有名字的
                            dialog——聽不出這是什麼的說明（precommit-review 抓到）。 */}
                        <Popover.Popup className="info-popup" aria-label="BMR 是怎麼算的">
                          {bodyFatPct !== null
                            ? '有體脂率，所以用 Katch-McArdle 公式：以去脂體重推 BMR，比只看身高年齡的公式準。哪天沒有體脂率可用，會自動退回 Mifflin-St Jeor。'
                            : '目前沒有體脂率，用 Mifflin-St Jeor 公式：看的是體重、身高、年齡、性別。記一次體脂率之後會自動改用更準的 Katch-McArdle，以去脂體重計算。'}
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>
                </span>
                <span className="val">{preview && preview.bmr !== null ? Math.round(preview.bmr) : '—'} 卡</span>
              </div>
              <button className="goal-link-row" type="button" onClick={onOpenBodyUpdate}>
                <span>更新身體數據</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>

            {bodyFatPct === null && (
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
            )}

            <div className="goal-group">
              <div className="goal-group-title">活動與目標</div>
              <div style={{ padding: '0 var(--s-4) var(--s-3)' }}>
                <div className="field-float" style={{ marginBottom: 0 }}>
                  <select
                    id="g-goal"
                    value={draft.goal}
                    onChange={(e) => patch('goal', e.target.value as Goal)}
                  >
                    {GOAL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <label htmlFor="g-goal">
                    目標<span className="req">*</span>
                  </label>
                </div>
                {draft.goal !== 'maintain' && (
                  <div className="field-float" style={{ marginBottom: 0, marginTop: 'var(--s-3)' }}>
                    <select
                      id="g-rate"
                      value={draft.rateChoice}
                      onChange={(e) => patch('rateChoice', e.target.value)}
                    >
                      {RATE_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                    <label htmlFor="g-rate">
                      變化速度<span className="req">*</span>
                    </label>
                  </div>
                )}
                {/* 活動量與攝取蛋白質**各佔整行**，不併成兩欄（2026-08-05 改）。
                    量過才改：半寬欄位的可用文字寬度是 103.5px，而最長的選項
                    「輕度活動（1.375）」需要 136px——差 32.5px。這不是加了下拉箭頭才有的
                    問題，箭頭之前就已經短 8.5px、只是勉強看不出來。縮箭頭補不回 32.5px；
                    縮短選項文字也不行，DESIGN.md 明訂活動量要帶數字給看得懂公式的人核對，
                    而「非常活躍（1.9）」就算砍成兩字仍然超出。整行是唯一不靠魔術數字的解，
                    也跟上面的目標／變化速度一致。 */}
                <div className="field-float" style={{ marginBottom: 0, marginTop: 'var(--s-3)' }}>
                  <select
                    id="g-activity"
                    value={draft.activityChoice}
                    onChange={(e) => patch('activityChoice', e.target.value)}
                  >
                    {ACTIVITY_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <label htmlFor="g-activity">
                    活動量<span className="req">*</span>
                  </label>
                </div>
                <div className="field-float" style={{ marginBottom: 0, marginTop: 'var(--s-3)' }}>
                  <select
                    id="g-protein"
                    value={draft.proteinChoice}
                    onChange={(e) => patch('proteinChoice', e.target.value)}
                  >
                    {PROTEIN_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <label htmlFor="g-protein">
                    攝取蛋白質<span className="req">*</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="goal-src">
              <div className="t">計算依據</div>
              <ul>
                {/* 原本這條寫「有填體脂率（…）：用 X 公式算 BMR（沒填則…）」——前綴寫死「有填
                    體脂率」但公式名隨狀態變，沒填體脂率時整句自相矛盾，而且兩層括號讓它折成
                    三行。改成只陳述規則、不講「目前」：現在是哪個公式由 BMR 那顆 ⓘ 負責講。 */}
                <li>BMR 依有沒有體脂率選公式（Katch-McArdle／Mifflin-St Jeor）</li>
                <li>TDEE ＝ BMR × 活動係數</li>
                <li>減重／增肌依變化速度（7700 卡／公斤換算）在 TDEE 上加減每日熱量差額；維持＝TDEE。{goal !== 'maintain' && `目前是${goalLabel}`}</li>
                <li>蛋白質＝體重 × g/kg；脂肪＝體重 × 0.85 g/kg（固定，不隨目標變動）；碳水＝扣掉蛋白質與脂肪熱量後的剩餘熱量 ÷ 4，不開放個別調整</li>
              </ul>
            </div>
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
