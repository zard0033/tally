/* 每日目標頁（spec.md「每日目標改版」，樣張 _design-sample/daily-goal.html 方案 B）。

   數字固定在上面、不隨捲動離開；每項一列，點整列叫出系統滾輪，改了就存。**只送改動的那個欄位**：
   沒碰過的欄位根本不會寫，所以選單為了顯示取的近似值不可能蓋掉資料庫的真實值。
   維持熱量只有一個：確認過的回推值，沒有就是公式。回推值要按「改用」才生效。 */
import { useEffect, useRef, useState } from 'react'
import {
  ACTIVITY_FACTOR_PRESETS,
  computeTargets,
  num,
  numOrNull,
  PROTEIN_G_PER_KG_PRESETS,
  rateMonthlyToWeekly,
  rateWeeklyToMonthly,
  RATE_PRESETS_KG_PER_MONTH,
  type Goal,
} from '@/lib/formulas'
import type { ProfileRow, Weight } from '@/lib/api'
import { errMsg, friendlyError } from '@/lib/errors'
import { checkBodyBasics, checkCustomTargets } from '@/lib/goalForm'
import { localDate, monthDay } from '@/lib/dates'
import SegmentedControl from '@/components/SegmentedControl'
import SubPageTop from '@/components/SubPageTop'
import { adviceOf, type MaintenanceEstimate } from '@/useMaintenanceEstimate'
import MaintenanceCard, { ConfirmCard, EstimateDetail } from './MaintenanceCard'

/** 衛福部標準活動量表的五段係數＋說詞，跟 formulas.ts 的 ACTIVITY_FACTOR_PRESETS 一一對應。 */
const ACTIVITY_LABELS = ['久坐不動', '輕度活動', '中度活動', '高度活動', '非常活躍']
const activityLabel = (v: number) => {
  const i = ACTIVITY_FACTOR_PRESETS.findIndex((p) => p === v)
  return i >= 0 ? `${ACTIVITY_LABELS[i]}（${v}）` : `${v}`
}
const GOAL_LABEL: Record<Goal, string> = { cut: '減重', maintain: '維持', bulk: '增肌' }

/** 「已儲存」閃多久：只是回報，時間是假設值，夠看到就好。 */
const SAVED_FLASH_MS = 1500
/** kg/週 存進 numeric(3,2) 再換回 kg/月 會有誤差（0.5 → 0.12 → 0.52），這個範圍內算同一格；格距是 0.25。 */
const RATE_MATCH_KG_PER_MONTH = 0.03
/** 資料庫是 numeric(3,2)：先捨入再存，存完的畫面才跟下次讀回來一樣。 */
const weeklyRate = (kgPerMonth: number) => Math.round(rateMonthlyToWeekly(kgPerMonth) * 100) / 100
const finiteOrNull = (n: number | null | undefined) => (n !== null && n !== undefined && Number.isFinite(n) ? n : null)

/** 空字串要是 NaN，不能是 Number('') 的 0：出生年 0 歲會讓年齡算成兩千多歲，變成閃一個離譜的熱量而不是 —。 */
const reqNum = (v: string): number => (v.trim() === '' ? NaN : Number(v.trim()))
const textOf = (v: unknown) => String(numOrNull(v) ?? '')

/** 選單的選項：DB 值對不上任何一格時（舊值、速度換算誤差）多列一項顯示真實值，不假裝它是最接近的那格。 */
function choices(presets: readonly number[], value: number, tolerance = 0.0001) {
  const match = presets.find((p) => Math.abs(p - value) <= tolerance)
  if (match !== undefined || !Number.isFinite(value)) return { list: [...presets], selected: match ?? presets[0] }
  const shown = Math.round(value * 100) / 100
  return { list: [...presets, shown].sort((a, b) => a - b), selected: shown }
}

const CHEV = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>

interface PickRowProps {
  id: string
  label: string
  shown: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}

/** 一列：左標籤、右目前值，整列是原生 select 的命中區，iOS 叫出系統滾輪。 */
function PickRow({ id, label, shown, value, onChange, children }: PickRowProps) {
  return (
    <label className="goal-pick" htmlFor={id}>
      <span className="lb">{label}</span>
      <span className="val">{shown}</span>
      {CHEV}
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  )
}

function field(opts: { id: string; label: string; value: string; onChange: (v: string) => void }) {
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
      <label htmlFor={opts.id}>{opts.label}<span className="req">*</span></label>
    </div>
  )
}

export interface DailyGoalProps {
  profile: ProfileRow
  latestWeight: Weight
  estimate: MaintenanceEstimate
  onSaveProfile: (patch: Partial<ProfileRow>) => Promise<void>
  onSaveLost: (message: string) => void
  onBack: () => void
  onOpenBodyUpdate: () => void
}

export default function DailyGoal(props: DailyGoalProps) {
  const { profile, latestWeight, estimate, onSaveProfile, onSaveLost, onBack, onOpenBodyUpdate } = props

  /* 還沒回來的改動疊在 profile 上：畫面當場跟著變，失敗就把那幾欄拿掉，自然退回原值。 */
  const [local, setLocal] = useState<Partial<ProfileRow>>({})
  const [isCustom, setIsCustom] = useState(profile.use_custom_targets)
  const [custom, setCustom] = useState({
    kcal: textOf(profile.custom_kcal),
    protein: textOf(profile.custom_protein_g),
    fat: textOf(profile.custom_fat_g),
    carb: textOf(profile.custom_carb_g),
  })
  const [basics, setBasics] = useState({ birthYear: textOf(profile.birth_year), height: textOf(profile.height_cm) })
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  /* 只有離開整組欄位才檢查與儲存：依序填到一半切下一格不算，不然第一格填完就跳紅字。 */
  const leavingForm = (e: React.FocusEvent<HTMLFormElement>) => !e.currentTarget.contains(e.relatedTarget as Node | null)
  const editCustom = (key: keyof typeof custom) => (v: string) => {
    setErr(null)
    setCustom((c) => ({ ...c, [key]: v }))
  }
  const editBasics = (key: keyof typeof basics) => (v: string) => {
    setErr(null)
    setBasics((b) => ({ ...b, [key]: v }))
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const savedTimer = useRef<number | undefined>(undefined)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      window.clearTimeout(savedTimer.current)
    }
  }, [])

  /* 同時只送一筆：連改時後面的併成一包，同一欄只留最後一次，回來才送下一包。 */
  const inflightRef = useRef(false)
  const queuedRef = useRef<Partial<ProfileRow> | null>(null)
  /** 失敗過、還沒被後來的存檔補上的欄位：補上了錯誤才收掉，別筆成功不能把它洗掉。 */
  const failedKeysRef = useRef(new Set<string>())

  function settleFailed(keys: string[]) {
    if (failedKeysRef.current.size === 0) return
    for (const k of keys) failedKeysRef.current.delete(k)
    if (failedKeysRef.current.size === 0) setErr(null)
  }

  async function flush() {
    if (inflightRef.current || !queuedRef.current) return
    const patch = queuedRef.current
    queuedRef.current = null
    inflightRef.current = true
    try {
      await onSaveProfile(patch)
      // profile 已經是新的了：沒被後來的改動蓋掉的欄位不用再疊
      setLocal((prev) => {
        const next = { ...prev } as Record<string, unknown>
        for (const [k, v] of Object.entries(patch)) if (next[k] === v) delete next[k]
        return next as Partial<ProfileRow>
      })
      if (!queuedRef.current) {
        setSaved(true)
        window.clearTimeout(savedTimer.current)
        savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_FLASH_MS)
      }
      const settled = Object.keys(patch)
      // 這兩種成功會讓失敗的欄位整列消失，留著錯誤就再也收不掉
      if (patch.goal === 'maintain') settled.push('rate_kg_per_week')
      if (numOrNull(patch.measured_tdee) !== null) settled.push('activity_factor')
      settleFailed(settled)
    } catch (e) {
      const message = friendlyError(errMsg(e))
      if (!mountedRef.current) {
        onSaveLost(message)
        return
      }
      // 只退回值還是這筆的欄位：同一欄後面又改了的話，畫面要留著新的
      setLocal((prev) => {
        const next = { ...prev } as Record<string, unknown>
        for (const [k, v] of Object.entries(patch)) if (next[k] === v) delete next[k]
        return next as Partial<ProfileRow>
      })
      for (const k of Object.keys(patch)) failedKeysRef.current.add(k)
      // 切回自動失敗＝實際目標還是自訂的，畫面要留在自訂；切到自訂失敗就留著讓人重試，填的值不能不見
      // 後面還排著另一個「切回自動」就不拉回來：那才是使用者最後按的
      const queued = queuedRef.current as Partial<ProfileRow> | null
      if (patch.use_custom_targets === false && queued?.use_custom_targets !== false) setIsCustom(true)
      setSaved(false)
      setErr(message)
    } finally {
      inflightRef.current = false
      void flush()
    }
  }

  function save(patch: Partial<ProfileRow>) {
    // 有欄位失敗還沒補上時留著錯誤：改別欄成功不能把它洗掉
    if (failedKeysRef.current.size === 0) setErr(null)
    setSaved(false)
    setLocal((prev) => ({ ...prev, ...patch }))
    queuedRef.current = { ...queuedRef.current, ...patch }
    void flush()
  }

  const effective = { ...profile, ...local }
  const weightKg = num(latestWeight.weight_kg)
  const bodyFatPct = latestWeight.body_fat_pct

  /* 算不出來（出生年還沒填完）就讓它是 NaN，畫面顯示 —，不跳錯誤：擋不合理值是失焦時才做的事。 */
  const raw = computeTargets(
    { ...effective, use_custom_targets: false, birth_year: reqNum(basics.birthYear), height_cm: reqNum(basics.height) },
    weightKg,
    bodyFatPct,
  )
  const preview = Number.isFinite(raw.kcal) ? raw : null

  const customKcal = reqNum(custom.kcal)
  const customValid =
    checkCustomTargets({
      kcal: customKcal,
      proteinG: reqNum(custom.protein),
      fatG: reqNum(custom.fat),
      carbG: reqNum(custom.carb),
    }) === null
  const customDirty = !(
    effective.use_custom_targets &&
    num(effective.custom_kcal) === customKcal &&
    num(effective.custom_protein_g) === reqNum(custom.protein) &&
    num(effective.custom_fat_g) === reqNum(custom.fat) &&
    num(effective.custom_carb_g) === reqNum(custom.carb)
  )
  const basicsDirty =
    bodyFatPct === null && (reqNum(basics.birthYear) !== num(effective.birth_year) || reqNum(basics.height) !== num(effective.height_cm))
  const customSum = (reqNum(custom.protein) || 0) * 4 + (reqNum(custom.fat) || 0) * 9 + (reqNum(custom.carb) || 0) * 4

  const goal = effective.goal
  const rateWeekly = numOrNull(effective.rate_kg_per_week)
  const plannedKgPerWeek = isCustom || goal === 'maintain' || rateWeekly === null ? null : goal === 'cut' ? -rateWeekly : rateWeekly
  const measuredOn = effective.measured_tdee_on
  const usingMeasured = numOrNull(effective.measured_tdee) !== null

  const inUseTdee = isCustom ? null : (preview?.tdee ?? null)
  const advice = adviceOf(estimate, inUseTdee)
  const adopted = advice?.kind === 'new' ? Math.round(advice.result.maintenance) : null
  const afterKcal = adopted !== null
    ? computeTargets({ ...effective, use_custom_targets: false, birth_year: reqNum(basics.birthYear), height_cm: reqNum(basics.height), measured_tdee: adopted }, weightKg, bodyFatPct).kcal
    : null

  /* 判斷一律看 effective（含還沒回來的改動），看 profile 會在請求途中做出錯的決定。 */
  function pickMode(key: 'auto' | 'custom') {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    failedKeysRef.current.clear()
    setErr(null)
    if (key === 'custom') {
      setIsCustom(true)
      if (customValid && !effective.use_custom_targets) saveCustom()
      return
    }
    setIsCustom(false)
    if (isCustom && customValid && customDirty) saveCustom() // 還沒存的值先存，自訂值要留著
    if (effective.use_custom_targets || (isCustom && customValid && customDirty)) save(withRate({ use_custom_targets: false }, goal))
  }

  /** iOS Safari 點按鈕不會讓輸入框失焦，返回與開 sheet 都等不到 onBlur，改到一半的值會靜默不見。
   *  離開前主動存；不合法的半成品照舊丟棄，因為資料庫還是對的值。 */
  function commitTyped() {
    if (isCustom) {
      if (customValid && customDirty) saveCustom()
      return
    }
    if (!basicsDirty) return
    const birthYear = reqNum(basics.birthYear)
    const height = reqNum(basics.height)
    if (checkBodyBasics({ birthYear, height }, new Date().getFullYear()) !== null) return
    const patch: Partial<ProfileRow> = {}
    if (birthYear !== num(effective.birth_year)) patch.birth_year = birthYear
    if (height !== num(effective.height_cm)) patch.height_cm = height
    save(patch)
  }

  /** 資料庫可能沒有速度（舊資料）：減重／增肌沒有速度會算不出目標，每次開 app 都卡在錯誤畫面。
   *  看已落地的 profile，不看 local：帶著速度的前一筆可能失敗，後一筆不帶就會存成有目標沒速度。 */
  function withRate(patch: Partial<ProfileRow>, nextGoal: Goal): Partial<ProfileRow> {
    if (nextGoal === 'maintain' || numOrNull(profile.rate_kg_per_week) !== null) return patch
    return { ...patch, rate_kg_per_week: rateWeekly ?? weeklyRate(RATE_PRESETS_KG_PER_MONTH[0]) }
  }

  function saveCustom() {
    save({
      use_custom_targets: true,
      custom_kcal: customKcal,
      custom_protein_g: reqNum(custom.protein),
      custom_fat_g: reqNum(custom.fat),
      custom_carb_g: reqNum(custom.carb),
    })
  }

  function blurCustom() {
    const invalid = checkCustomTargets({
      kcal: customKcal,
      proteinG: reqNum(custom.protein),
      fatG: reqNum(custom.fat),
      carbG: reqNum(custom.carb),
    })
    if (invalid) return setErr(invalid)
    setErr(null)
    if (customDirty) saveCustom()
    else settleFailed(['use_custom_targets', 'custom_kcal', 'custom_protein_g', 'custom_fat_g', 'custom_carb_g'])
  }

  function blurBasics() {
    const birthYear = reqNum(basics.birthYear)
    const height = reqNum(basics.height)
    const invalid = checkBodyBasics({ birthYear, height }, new Date().getFullYear())
    if (invalid) return setErr(invalid)
    setErr(null)
    const patch: Partial<ProfileRow> = {}
    if (birthYear !== num(effective.birth_year)) patch.birth_year = birthYear
    if (height !== num(effective.height_cm)) patch.height_cm = height
    if (Object.keys(patch).length > 0) save(patch)
    else settleFailed(['birth_year', 'height_cm'])
  }

  function pickGoal(next: Goal) {
    save(withRate({ goal: next }, next))
  }

  const rate = choices(RATE_PRESETS_KG_PER_MONTH, rateWeeklyToMonthly(rateWeekly ?? NaN), RATE_MATCH_KG_PER_MONTH)
  const activity = choices(ACTIVITY_FACTOR_PRESETS, num(effective.activity_factor))
  const protein = choices(PROTEIN_G_PER_KG_PRESETS, num(effective.protein_g_per_kg))

  const heroKcal = isCustom ? (Number.isFinite(customKcal) ? customKcal : null) : (preview?.kcal ?? null)
  const source = isCustom
    ? (!customValid ? '填完才生效' : customDirty ? '未儲存' : '自己填的')
    : basicsDirty
      ? '未儲存'
      : usingMeasured
        ? (measuredOn ? `依 ${monthDay(measuredOn)} 確認的記錄` : '依確認的記錄')
        : '依公式估算'

  return (
    <div className="main" data-screen="daily-goal">
      <SubPageTop title="每日目標" backLabel="返回設定" onBack={() => { commitTyped(); onBack() }} />

      <div className="goal-hero">
        <div>
          <span className="gauge-num">{heroKcal !== null ? Math.round(heroKcal) : '—'}</span>
          <span className="gauge-unit">卡</span>
        </div>
        <div className="goal-hero-macros">
          {isCustom
            ? `蛋白 ${custom.protein || 0}g・脂肪 ${custom.fat || 0}g・碳水 ${custom.carb || 0}g`
            : preview
              ? `蛋白 ${Math.round(preview.protein)}g・脂肪 ${Math.round(preview.fat)}g・碳水 ${Math.round(preview.carb)}g`
              : '欄位還沒填完，先看不出目標'}
        </div>
        <div className="goal-hero-src">
          <span>{source}</span>
          <span className="goal-saved" role="status">{saved ? '已儲存' : ''}</span>
        </div>
      </div>

      {err && <p className="sheet-error goal-err" role="alert">{err}</p>}

      <div className="goal-seg-wrap">
        <SegmentedControl
          label="目標計算方式"
          items={[{ key: 'auto', label: '自動' }, { key: 'custom', label: '自訂' }]}
          value={isCustom ? 'custom' : 'auto'}
          onPick={pickMode}
        />
      </div>

      <div className="form-wrap goal-scroll" style={{ paddingTop: 0 }} ref={scrollRef}>
        {isCustom ? (
          <form className="goal-custom" onSubmit={(e) => { e.preventDefault(); blurCustom() }} onBlur={(e) => { if (leavingForm(e)) blurCustom() }}>
            {field({ id: 'g-custom-kcal', label: '熱量（卡）', value: custom.kcal, onChange: editCustom('kcal') })}
            <div className="goal-macro-grid">
              {field({ id: 'g-custom-protein', label: '蛋白 g', value: custom.protein, onChange: editCustom('protein') })}
              {field({ id: 'g-custom-fat', label: '脂肪 g', value: custom.fat, onChange: editCustom('fat') })}
              {field({ id: 'g-custom-carb', label: '碳水 g', value: custom.carb, onChange: editCustom('carb') })}
            </div>
            {customValid && (
              <p className="goal-sum">
                三大營養素加起來 <b>{Math.round(customSum)}</b> 卡
                {Math.round(customSum) === Math.round(customKcal)
                  ? '，和熱量一致'
                  : `，比熱量${customSum > customKcal ? '多' : '少'} `}
                {Math.round(customSum) !== Math.round(customKcal) && <><b>{Math.abs(Math.round(customSum - customKcal))}</b> 卡</>}
              </p>
            )}
          </form>
        ) : (
          <>
            {advice?.kind === 'new' && !dismissed && preview && afterKcal !== null && (
              <ConfirmCard
                result={advice.result}
                beforeKcal={preview.kcal}
                afterKcal={afterKcal}
                bmr={finiteOrNull(preview.bmr)}
                plannedKgPerWeek={plannedKgPerWeek}
                onAdopt={() => { setDismissed(false); save({ measured_tdee: adopted, measured_tdee_on: localDate() }) }}
                onDismiss={() => setDismissed(true)}
              />
            )}

            <div className="goal-group">
              <PickRow id="g-goal" label="目標" shown={GOAL_LABEL[goal]} value={goal} onChange={(v) => pickGoal(v as Goal)}>
                {(Object.keys(GOAL_LABEL) as Goal[]).map((g) => <option key={g} value={g}>{GOAL_LABEL[g]}</option>)}
              </PickRow>
              {goal !== 'maintain' && (
                <PickRow
                  id="g-rate"
                  label="速度"
                  shown={`${rate.selected} kg/月`}
                  value={String(rate.selected)}
                  onChange={(v) => save({ rate_kg_per_week: weeklyRate(Number(v)) })}
                >
                  {rate.list.map((v) => <option key={v} value={v}>{v} kg/月</option>)}
                </PickRow>
              )}
              <PickRow
                id="g-protein"
                label="蛋白質"
                shown={`${protein.selected} g/kg`}
                value={String(protein.selected)}
                onChange={(v) => save({ protein_g_per_kg: Number(v) })}
              >
                {protein.list.map((v) => <option key={v} value={v}>{v} g/kg</option>)}
              </PickRow>
              {/* 用回推值時目標不吃活動量，留著只會讓人以為改了有用 */}
              {!usingMeasured && (
                <PickRow
                  id="g-activity"
                  label="活動量"
                  shown={activityLabel(activity.selected)}
                  value={String(activity.selected)}
                  onChange={(v) => save({ activity_factor: Number(v) })}
                >
                  {activity.list.map((v) => <option key={v} value={v}>{activityLabel(v)}</option>)}
                </PickRow>
              )}
            </div>
          </>
        )}

        <MaintenanceCard
          estimate={estimate}
          inUseTdee={inUseTdee}
          formulaTdee={finiteOrNull(preview?.formulaTdee)}
          usingMeasured={usingMeasured}
          targetKcal={heroKcal}
          isCustom={isCustom}
          dismissed={dismissed}
          onUndismiss={() => setDismissed(false)}
          onRevert={() => { setDismissed(true); save({ measured_tdee: null, measured_tdee_on: null }) }}
        />

        {!isCustom && (
          <>
            {bodyFatPct === null && (
              <div className="goal-group">
                <div className="goal-group-title">基本資料</div>
                <form style={{ padding: '0 var(--s-4) var(--s-3)' }} onSubmit={(e) => { e.preventDefault(); blurBasics() }} onBlur={(e) => { if (leavingForm(e)) blurBasics() }}>
                  {field({ id: 'g-birth-year', label: '出生年', value: basics.birthYear, onChange: editBasics('birthYear') })}
                  <div className="field-row" style={{ marginTop: 'var(--s-3)' }}>
                    {field({ id: 'g-height', label: '身高 cm', value: basics.height, onChange: editBasics('height') })}
                    <div className="field-float" style={{ marginBottom: 0, flex: 1 }}>
                      <select id="g-sex" value={effective.sex} onChange={(e) => save({ sex: e.target.value })}>
                        <option value="male">男</option>
                        <option value="female">女</option>
                      </select>
                      <label htmlFor="g-sex">性別</label>
                    </div>
                  </div>
                </form>
              </div>
            )}

            <div className="goal-group">
              <button type="button" className="goal-pick as-btn" onClick={() => { commitTyped(); onOpenBodyUpdate() }}>
                <span className="lb">身體數據</span>
                <span className="val">{weightKg.toFixed(2)} kg{bodyFatPct !== null && `・${num(bodyFatPct).toFixed(1)}%`}</span>
                {CHEV}
              </button>
            </div>

            <details className="goal-group goal-how">
              <summary className="goal-pick"><span className="lb">怎麼算的</span>{CHEV}</summary>
              <div className="goal-row">
                <span className="lb">BMR（{bodyFatPct !== null ? 'Katch-McArdle' : 'Mifflin-St Jeor'}）</span>
                <span className="val">{finiteOrNull(preview?.bmr) !== null ? Math.round(preview!.bmr!) : '—'} 卡</span>
              </div>
              <EstimateDetail estimate={estimate} targetKcal={preview?.kcal ?? null} plannedKgPerWeek={plannedKgPerWeek} />
              <div className="goal-src">
                <ul>
                  <li>維持熱量：按過「改用」就是你確認的回推值，否則是 BMR × 活動量</li>
                  <li>BMR：有體脂率用 Katch-McArdle，沒有用 Mifflin-St Jeor</li>
                  <li>目標＝維持熱量 ± 速度換算（7700 卡／公斤）</li>
                  <li>蛋白質＝體重 × g/kg；脂肪＝體重 × 0.85 g/kg；碳水取剩餘熱量 ÷ 4</li>
                </ul>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
