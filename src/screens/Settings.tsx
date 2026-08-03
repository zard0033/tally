/* 設定頁：身體參數編輯（含目標計算方式：公式估算／自訂目標）＋記體重＋登出。1:1 對齊
   legacy/app.js 的 renderSettings／openSheet('weight'|'profile')／submitWeight／submitProfile。

   編輯與記體重不共用 LogSheet 的 Drawer（地基裁決）——這裡自建一個獨立的 sheet 覆蓋層，
   照 legacy 的呈現方式重用 app.css 既有的 .scrim/.sheet/.field-float 等 class
   （這些 class 是既有 CSS，此檔不新增樣式）。唯一的落地差異：legacy 用
   `#sheet-root.closing .sheet` 這個 id-scoped 選擇器做退場動畫，但 id="sheet-root"
   已經被 LogSheet 佔用（它在 App.tsx 裡永遠掛載），兩個畫面不能共用同一個 id。
   這裡改用另一個 id 掛容器，退場動畫直接用 inline style 套用同一組 keyframes
   （sheet-out／scrim-out 在 app.css 是全域定義，不需要重複宣告）。

   2026-08-03「每日目標」計算方式重新設計：公式估算改用 Katch-McArdle（weight 表最新一筆
   有體脂率時）或 Mifflin-St Jeor（沒有時），蛋白質改 g/kg 體重、脂肪／碳水依目標對照表
   （寫死在 formulas.ts）分剩餘熱量，不再開放使用者調整三大比例；新增變化速度控制減重/
   增肌的每日熱量差額；新增自訂目標開關，開著時完全繞過公式直接填四個數字。
   這輪只接計算引擎（範圍已跟使用者確認）：維持現有單頁＋sheet 架構，不做「每日目標」
   獨立入口頁、不做即時預覽——存檔後跟現有記體重／編輯身體參數一樣，靠 App.tsx 的
   load() 重新整包算一次。

   表單一律用 uncontrolled input（ref 讀值），送出前才一次讀完全部欄位——跟 legacy 的
   withBusy 坑等效：busy=true 觸發的重繪不會讓已讀到的值變成別的東西。例外：目標＋變化
   速度合併選單、活動量選單各自要 reactive state 決定「自訂」子欄位顯不顯示，這兩個不是
   最終送出值本身（送出時仍讀 ref／select.value），純粹控制條件渲染，跟自訂目標開關
   （useCustom）同一類。 */
import { useEffect, useRef, useState } from 'react'
import { localDate } from '@/lib/dates'
import {
  activityChoiceFrom as activityFactorChoiceFrom,
  goalFromMode,
  goalModeFrom,
  num,
  numOrNull,
  STANDARD_RATE,
  type GoalMode,
} from '@/lib/formulas'
import type { SettingsProps } from './types'

type SheetKind = 'weight' | 'profile'

const GOAL_LABEL: Record<string, string> = { cut: '減重', maintain: '維持', bulk: '增肌' }

const ACTIVITY_PRESETS = [
  { value: '1.2', label: '久坐（1.2）' },
  { value: '1.375', label: '輕度（1.375）' },
  { value: '1.55', label: '中度（1.55）' },
  { value: '1.725', label: '高度（1.725）' },
]

/** activityFactorChoiceFrom（formulas.ts）回傳數字或 'custom'，這裡的選單值是字串
 *  （HTML select option 天生只吃字串）——薄薄轉一層，實際判斷邏輯留在 lib 層可測。 */
function activityChoiceFrom(af: number): string {
  const preset = activityFactorChoiceFrom(af)
  return preset === 'custom' ? 'custom' : String(preset)
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** 動效時長讀 app.css 的 token（與 LogSheet 同一來源），reduced-motion 時降到近乎 0。
 *  sheet 退場 --dur-mid；scrim 退場 --dur-fast——暗幕要比 sheet 先清，否則 sheet 滑走
 *  掀開的區域露出淡到一半的 scrim，頂部卻從全黑開始淡，真機看起來是分區變色。 */
function tokenMs(name: string, fallback: number): number {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 0.01
  const t = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(t) ? t : fallback
}
const closeDurationMs = () => tokenMs('--dur-mid', 220)
const scrimFadeMs = () => tokenMs('--dur-fast', 100)

/** 必填數值：空白或非數字回 NaN，由呼叫端一次擋掉。 */
function reqNum(ref: React.RefObject<HTMLInputElement | null>): number {
  const v = ref.current?.value.trim() ?? ''
  return v === '' ? NaN : Number(v)
}

export default function Settings(props: SettingsProps) {
  const { profile, targets, latestWeight, onSaveProfile, onSaveWeight, onSignOut } = props

  const [sheetKind, setSheetKind] = useState<SheetKind | null>(null)
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /* 三顆條件渲染用的 reactive state，不是最終送出值本身——送出時仍讀對應的 ref／
     select.value，這幾顆只負責「自訂」子欄位顯不顯示。 */
  const [useCustom, setUseCustom] = useState(profile.use_custom_targets)
  const [goalMode, setGoalMode] = useState<GoalMode>(goalModeFrom(profile.goal, numOrNull(profile.rate_kg_per_week)))
  const [activityChoice, setActivityChoice] = useState(activityChoiceFrom(num(profile.activity_factor)))

  const openerRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)

  const pBirthYear = useRef<HTMLInputElement>(null)
  const pHeight = useRef<HTMLInputElement>(null)
  const pSex = useRef<HTMLSelectElement>(null)
  const pCustomRate = useRef<HTMLInputElement>(null)
  const pCustomActivity = useRef<HTMLInputElement>(null)
  const pProteinPerKg = useRef<HTMLInputElement>(null)
  const pCustomKcal = useRef<HTMLInputElement>(null)
  const pCustomProtein = useRef<HTMLInputElement>(null)
  const pCustomFat = useRef<HTMLInputElement>(null)
  const pCustomCarb = useRef<HTMLInputElement>(null)

  const wDate = useRef<HTMLInputElement>(null)
  const wKg = useRef<HTMLInputElement>(null)
  const wFat = useRef<HTMLInputElement>(null)

  useEffect(
    () => () => {
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  // sheet 開啟時把焦點交給對話框本身（tabindex=-1），跟 legacy 一致
  useEffect(() => {
    if (sheetKind && !closing) dialogRef.current?.focus()
  }, [sheetKind, closing])

  // Esc 關閉：手勢／點遮罩之外的鍵盤路徑
  useEffect(() => {
    if (!sheetKind) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeSheet()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKind, closing])

  function openSheet(kind: SheetKind, opener: HTMLElement | null) {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
    openerRef.current = opener
    setErr(null)
    setBusy(false)
    setClosing(false)
    // 每次重開都對齊目前的 profile——Settings 元件本身不會在開合 sheet 之間卸載，
    // 這幾顆 state 若不重設，上次編輯到一半沒存就關掉的殘值會在下次打開時還在。
    setUseCustom(profile.use_custom_targets)
    setGoalMode(goalModeFrom(profile.goal, numOrNull(profile.rate_kg_per_week)))
    setActivityChoice(activityChoiceFrom(num(profile.activity_factor)))
    setSheetKind(kind)
  }

  function closeSheet() {
    if (!sheetKind || closing) return
    setClosing(true)
    const opener = openerRef.current
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setSheetKind(null)
      setClosing(false)
      opener?.focus()
    }, closeDurationMs())
  }

  async function submitWeight() {
    if (busy) return
    // 欄位一律在 setBusy(true) 觸發重繪之前讀完
    const kg = reqNum(wKg)
    const on = wDate.current?.value.trim() ?? ''
    const fatVal = wFat.current?.value.trim() ?? ''

    if (!Number.isFinite(kg) || kg <= 0) return setErr('體重要填數字')
    if (!on) return setErr('量測日要填')
    const fat = fatVal === '' ? null : Number(fatVal)
    // 體脂率 2026-08-03 起會餵進 Katch-McArdle 算 BMR，範圍收在生理合理值——0 或
    // >100 會讓去脂體重算出負數或超過體重本身，不是單純「記錄用途」時可以放行的錯字。
    if (fat !== null && (!Number.isFinite(fat) || fat < 3 || fat > 70)) {
      return setErr('體脂要填 3–70 之間的數字，或留空')
    }

    setBusy(true)
    setErr(null)
    try {
      await onSaveWeight({ measured_on: on, weight_kg: kg, body_fat_pct: fat })
      closeSheet()
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function submitProfile() {
    if (busy) return
    const birthYear = reqNum(pBirthYear)
    const thisYear = new Date().getFullYear()
    if (!Number.isFinite(birthYear) || birthYear < 1900 || birthYear > thisYear) {
      return setErr('出生年要填合理的西元年')
    }
    const height = reqNum(pHeight)
    if (!Number.isFinite(height) || height <= 0) return setErr('身高要填數字')
    const sex = pSex.current?.value ?? ''

    if (useCustom) {
      const kcal = reqNum(pCustomKcal)
      const proteinG = reqNum(pCustomProtein)
      const fatG = reqNum(pCustomFat)
      const carbG = reqNum(pCustomCarb)
      // 熱量是 0 沒有意義（進度條、剩餘量全部跟著失真），三大營養素留 0 合理
      // （無糖飲料的蛋白脂肪本來就是 0，跟新增食物表單同一條規則）。
      if (!Number.isFinite(kcal) || kcal <= 0) return setErr('熱量要填數字')
      if (![proteinG, fatG, carbG].every((n) => Number.isFinite(n) && n >= 0)) {
        return setErr('蛋白質／脂肪／碳水都要填數字')
      }
      setBusy(true)
      setErr(null)
      try {
        // 只送自訂相關欄位＋基本資料，公式模式那組（goal/activity_factor/...）不動，
        // 之後切回公式估算時原本填過的還在，不必重打一次。
        await onSaveProfile({
          birth_year: birthYear,
          height_cm: height,
          sex,
          use_custom_targets: true,
          custom_kcal: kcal,
          custom_protein_g: proteinG,
          custom_fat_g: fatG,
          custom_carb_g: carbG,
        })
        closeSheet()
      } catch (e) {
        setBusy(false)
        setErr(e instanceof Error ? e.message : String(e))
      }
      return
    }

    const goal = goalFromMode(goalMode)
    let rate: number | null = null
    if (goal !== 'maintain') {
      rate = goalMode.endsWith('custom') ? reqNum(pCustomRate) : STANDARD_RATE
      // 上限對齊 schema 的 check（numeric(3,2) 欄位本身能存到 9.99，但生理上一週瘦/
      // 增 3 公斤已經不合理）——擋在前端比讓 PostgREST 丟一句英文 22003 錯誤好懂。
      if (!Number.isFinite(rate) || rate <= 0 || rate > 3) return setErr('變化速度要填 0–3 之間的數字')
    }
    const activityFactor = activityChoice === 'custom' ? reqNum(pCustomActivity) : num(activityChoice)
    if (!Number.isFinite(activityFactor) || activityFactor <= 0 || activityFactor > 3) {
      return setErr('活動係數要填 0–3 之間的數字')
    }
    const proteinPerKg = reqNum(pProteinPerKg)
    if (!Number.isFinite(proteinPerKg) || proteinPerKg <= 0 || proteinPerKg > 5) {
      return setErr('攝取蛋白質要填 0–5 之間的數字')
    }

    setBusy(true)
    setErr(null)
    try {
      // 同樣只送公式模式相關欄位，custom_* 那組不動——自訂數字保留，不因為切回
      // 公式估算就被清空。
      await onSaveProfile({
        birth_year: birthYear,
        height_cm: height,
        sex,
        goal,
        rate_kg_per_week: rate,
        activity_factor: activityFactor,
        protein_g_per_kg: proteinPerKg,
        use_custom_targets: false,
      })
      closeSheet()
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const isCustom = profile.use_custom_targets
  const goalLabel = GOAL_LABEL[profile.goal] ?? profile.goal
  const bodyFatPct = latestWeight.body_fat_pct
  const bmrFormulaLabel = bodyFatPct !== null ? 'Katch-McArdle' : 'Mifflin-St Jeor'
  const sheetTitle = sheetKind === 'weight' ? '記體重' : '編輯身體參數'
  // 退場覆寫整個 animation shorthand（不能只改 duration）：.scrim 平時的 animation 是
  // scrim-in，只改時長會讓它用縮短的時間重播「進場」而不是播放「退場」
  const scrimExitStyle = closing ? { animation: `scrim-out ${scrimFadeMs()}ms var(--ease-sheet) both` } : undefined
  const sheetExitStyle = closing ? { animation: `sheet-out ${closeDurationMs()}ms var(--ease-sheet) both` } : undefined

  return (
    <div className="main" data-screen="settings">
      <header className="topbar">
        <h1 className="today">設定</h1>
      </header>

      <div className="settings">
        <h2>今日目標</h2>
        <dl>
          <Kv label="熱量" value={`${Math.round(targets.kcal)} 卡`} />
          <Kv label="蛋白質" value={`${Math.round(targets.protein)} g`} />
          <Kv label="脂肪" value={`${Math.round(targets.fat)} g`} />
          <Kv label="碳水" value={`${Math.round(targets.carb)} g`} />
        </dl>

        <h2>怎麼算出來的</h2>
        {isCustom ? (
          <p className="note">這是你自己設定的目標，沒有套用任何公式。</p>
        ) : (
          <>
            <dl>
              <Kv label="最新體重" value={`${num(latestWeight.weight_kg).toFixed(2)} kg`} />
              {bodyFatPct !== null && <Kv label="體脂率" value={`${num(bodyFatPct).toFixed(1)} %`} />}
              <Kv label="身高" value={`${num(profile.height_cm).toFixed(1)} cm`} />
              <Kv label="年齡" value={`${targets.age} 歲`} />
              <Kv label="BMR" value={`${Math.round(targets.bmr ?? 0)} 卡`} />
              <Kv label="活動係數" value={String(num(profile.activity_factor))} />
              <Kv label="TDEE" value={`${Math.round(targets.tdee ?? 0)} 卡`} />
              <Kv label="目標" value={goalLabel} />
              {profile.goal !== 'maintain' && numOrNull(profile.rate_kg_per_week) !== null && (
                <Kv label="變化速度" value={`${num(profile.rate_kg_per_week)} kg/週`} />
              )}
              <Kv label="攝取蛋白質" value={`${num(profile.protein_g_per_kg)} g/kg`} />
            </dl>
            <p className="note">
              {bmrFormulaLabel} 公式算 BMR，乘活動係數得 TDEE
              {profile.goal !== 'maintain' ? `，${goalLabel}依變化速度調整每日熱量` : ''}
              。蛋白質＝體重 × 攝取量，脂肪／碳水依目標自動配好比例分剩餘熱量。
            </p>
          </>
        )}

        <button
          className="link-btn"
          type="button"
          onClick={(e) => openSheet('weight', e.currentTarget)}
        >
          記體重
        </button>
        <button
          className="link-btn"
          type="button"
          onClick={(e) => openSheet('profile', e.currentTarget)}
        >
          編輯身體參數
        </button>
        <button className="signout" type="button" onClick={onSignOut}>
          登出
        </button>
      </div>

      {sheetKind && (
        <div id="settings-sheet-root">
          <button
            type="button"
            className="scrim"
            aria-label="關閉"
            style={scrimExitStyle}
            onClick={closeSheet}
          />
          <div
            ref={dialogRef}
            className={`sheet${closing ? '' : ' opening'}`}
            style={sheetExitStyle}
            role="dialog"
            aria-modal="true"
            aria-label={sheetTitle}
            tabIndex={-1}
          >
            <div className="handle" aria-hidden="true" />
            <div className="sheet-head">
              <span className="sheet-title">{sheetTitle}</span>
              <button type="button" className="icon-btn" aria-label="關閉" onClick={closeSheet}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {sheetKind === 'weight' ? (
              <>
                <div className="form-wrap">
                  <div className="field-float">
                    <input ref={wDate} id="w-date" type="date" defaultValue={localDate()} />
                    <label htmlFor="w-date">量測日</label>
                  </div>
                  <div className="field-float">
                    <input ref={wKg} id="w-kg" type="text" inputMode="decimal" placeholder=" " />
                    <label htmlFor="w-kg">
                      體重 kg<span className="req">*</span>
                    </label>
                  </div>
                  <div className="field-float">
                    <input ref={wFat} id="w-fat" type="text" inputMode="decimal" placeholder=" " />
                    <label htmlFor="w-fat">體脂 %</label>
                  </div>
                  <p className="note">存體脂計原始讀數，不做校正。同一天再記一次會覆蓋當天那筆。填了體脂率，公式估算會用更準的 Katch-McArdle；這次沒填，目標就會改用不看體脂率的 Mifflin-St Jeor 算，熱量目標可能因此跟著變。</p>
                </div>
                <div className="confirm-wrap">
                  {err && (
                    <p className="sheet-error" role="alert">
                      {err}
                    </p>
                  )}
                  <button type="button" className="pick-bar-btn" disabled={busy} onClick={() => void submitWeight()}>
                    {busy ? '儲存中…' : '儲存'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-wrap">
                  <div className="seg" role="group" aria-label="目標計算方式" style={{ marginBottom: 'var(--s-4)' }}>
                    <button type="button" aria-pressed={!useCustom} onClick={() => setUseCustom(false)}>
                      公式估算
                    </button>
                    <button type="button" aria-pressed={useCustom} onClick={() => setUseCustom(true)}>
                      自訂目標
                    </button>
                  </div>

                  <div className="field-float">
                    <input
                      ref={pBirthYear}
                      id="p-birth-year"
                      type="text"
                      inputMode="numeric"
                      placeholder=" "
                      defaultValue={numOrNull(profile.birth_year) ?? ''}
                    />
                    <label htmlFor="p-birth-year">
                      出生年<span className="req">*</span>
                    </label>
                  </div>
                  <div className="field-row">
                    <div className="field-float">
                      <input
                        ref={pHeight}
                        id="p-height"
                        type="text"
                        inputMode="decimal"
                        placeholder=" "
                        defaultValue={String(num(profile.height_cm))}
                      />
                      <label htmlFor="p-height">
                        身高 cm<span className="req">*</span>
                      </label>
                    </div>
                    <div className="field-float">
                      <select ref={pSex} id="p-sex" defaultValue={profile.sex}>
                        <option value="male">男</option>
                        <option value="female">女</option>
                      </select>
                      <label htmlFor="p-sex">性別</label>
                    </div>
                  </div>

                  {useCustom ? (
                    <>
                      <div className="field-float">
                        <input
                          ref={pCustomKcal}
                          id="p-custom-kcal"
                          type="text"
                          inputMode="decimal"
                          placeholder=" "
                          defaultValue={numOrNull(profile.custom_kcal) ?? ''}
                        />
                        <label htmlFor="p-custom-kcal">
                          熱量（卡）<span className="req">*</span>
                        </label>
                      </div>
                      <div className="field-row">
                        <div className="field-float">
                          <input
                            ref={pCustomProtein}
                            id="p-custom-protein"
                            type="text"
                            inputMode="decimal"
                            placeholder=" "
                            defaultValue={numOrNull(profile.custom_protein_g) ?? ''}
                          />
                          <label htmlFor="p-custom-protein">蛋白質 g</label>
                        </div>
                        <div className="field-float">
                          <input
                            ref={pCustomFat}
                            id="p-custom-fat"
                            type="text"
                            inputMode="decimal"
                            placeholder=" "
                            defaultValue={numOrNull(profile.custom_fat_g) ?? ''}
                          />
                          <label htmlFor="p-custom-fat">脂肪 g</label>
                        </div>
                        <div className="field-float">
                          <input
                            ref={pCustomCarb}
                            id="p-custom-carb"
                            type="text"
                            inputMode="decimal"
                            placeholder=" "
                            defaultValue={numOrNull(profile.custom_carb_g) ?? ''}
                          />
                          <label htmlFor="p-custom-carb">碳水 g</label>
                        </div>
                      </div>
                      <p className="note">存成你自己設定的目標，不套用任何公式。關掉「自訂目標」會退回公式估算；存檔後這幾個數字會留著，下次切回來還在（同一次編輯中來回切換不會保留，只有存檔會）。</p>
                    </>
                  ) : (
                    <>
                      <div className="field-float">
                        <select
                          id="p-goal-mode"
                          value={goalMode}
                          onChange={(e) => setGoalMode(e.target.value as GoalMode)}
                        >
                          <option value="maintain">維持</option>
                          <option value="cut_standard">減重（標準・0.5 kg/週）</option>
                          <option value="cut_custom">減重（自訂速度…）</option>
                          <option value="bulk_standard">增肌（標準・0.5 kg/週）</option>
                          <option value="bulk_custom">增肌（自訂速度…）</option>
                        </select>
                        <label htmlFor="p-goal-mode">
                          目標<span className="req">*</span>
                        </label>
                      </div>
                      {(goalMode === 'cut_custom' || goalMode === 'bulk_custom') && (
                        <div className="field-float">
                          <input
                            ref={pCustomRate}
                            id="p-custom-rate"
                            type="text"
                            inputMode="decimal"
                            placeholder=" "
                            defaultValue={numOrNull(profile.rate_kg_per_week) ?? STANDARD_RATE}
                          />
                          <label htmlFor="p-custom-rate">
                            變化速度 kg/週<span className="req">*</span>
                          </label>
                        </div>
                      )}
                      <div className="field-row">
                        <div className="field-float">
                          <select
                            id="p-activity"
                            value={activityChoice}
                            onChange={(e) => setActivityChoice(e.target.value)}
                          >
                            {ACTIVITY_PRESETS.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                            <option value="custom">自訂…</option>
                          </select>
                          <label htmlFor="p-activity">
                            活動量<span className="req">*</span>
                          </label>
                        </div>
                        <div className="field-float">
                          <input
                            ref={pProteinPerKg}
                            id="p-protein-per-kg"
                            type="text"
                            inputMode="decimal"
                            placeholder=" "
                            defaultValue={numOrNull(profile.protein_g_per_kg) ?? ''}
                          />
                          <label htmlFor="p-protein-per-kg">
                            攝取蛋白質 g/kg<span className="req">*</span>
                          </label>
                        </div>
                      </div>
                      {activityChoice === 'custom' && (
                        <div className="field-float">
                          <input
                            ref={pCustomActivity}
                            id="p-custom-activity"
                            type="text"
                            inputMode="decimal"
                            placeholder=" "
                            defaultValue={numOrNull(profile.activity_factor) ?? ''}
                          />
                          <label htmlFor="p-custom-activity">
                            自訂係數<span className="req">*</span>
                          </label>
                        </div>
                      )}
                      <p className="note">攝取蛋白質建議 1.6–2.2 g/kg 體重。</p>
                    </>
                  )}
                </div>
                <div className="confirm-wrap">
                  {err && (
                    <p className="sheet-error" role="alert">
                      {err}
                    </p>
                  )}
                  <button type="button" className="pick-bar-btn" disabled={busy} onClick={() => void submitProfile()}>
                    {busy ? '儲存中…' : '儲存'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
