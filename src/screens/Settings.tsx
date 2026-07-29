/* 設定頁：身體參數編輯＋記體重＋登出。1:1 對齊 legacy/app.js 的 renderSettings／
   openSheet('weight'|'profile')／submitWeight／submitProfile。

   編輯與記體重不共用 LogSheet 的 Drawer（地基裁決）——這裡自建一個獨立的 sheet 覆蓋層，
   照 legacy 的呈現方式重用 app.css 既有的 .scrim/.sheet/.field-float 等 class
   （這些 class 是既有 CSS，此檔不新增樣式）。唯一的落地差異：legacy 用
   `#sheet-root.closing .sheet` 這個 id-scoped 選擇器做退場動畫，但 id="sheet-root"
   已經被 LogSheet 佔用（它在 App.tsx 裡永遠掛載），兩個畫面不能共用同一個 id。
   這裡改用另一個 id 掛容器，退場動畫直接用 inline style 套用同一組 keyframes
   （sheet-out／scrim-out 在 app.css 是全域定義，不需要重複宣告）。

   表單一律用 uncontrolled input（ref 讀值），送出前才一次讀完全部欄位——
   跟 legacy 的 withBusy 坑等效：busy=true 觸發的重繪不會讓已讀到的值變成別的東西。 */
import { useEffect, useRef, useState } from 'react'
import { localDate } from '@/lib/dates'
import { macroPercentagesSumTo100, normalizeMacroPercentages, num, roundTo1 } from '@/lib/formulas'
import type { SettingsProps } from './types'

type SheetKind = 'weight' | 'profile'

const GOAL_LABEL: Record<string, string> = { cut: '減重', maintain: '維持', bulk: '增肌' }
const GOAL_NOTE: Record<string, string> = { cut: '減重再乘 0.8', maintain: '維持不調整', bulk: '增肌再加 500' }

/** 退場動畫時長：讀 app.css 的 --dur-mid token（退場比進場 --dur-sheet 降一級，與 LogSheet
 *  同一來源），reduced-motion 時降到近乎 0。 */
function closeDurationMs(): number {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 0.01
  const t = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-mid'))
  return Number.isFinite(t) ? t : 220
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

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

  const openerRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)

  const pBirth = useRef<HTMLInputElement>(null)
  const pHeight = useRef<HTMLInputElement>(null)
  const pSex = useRef<HTMLSelectElement>(null)
  const pGoal = useRef<HTMLSelectElement>(null)
  const pAf = useRef<HTMLInputElement>(null)
  const pProtein = useRef<HTMLInputElement>(null)
  const pFat = useRef<HTMLInputElement>(null)
  const pCarb = useRef<HTMLInputElement>(null)

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
    if (fat !== null && !Number.isFinite(fat)) return setErr('體脂要填數字或留空')

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
    const p = {
      birth_date: pBirth.current?.value.trim() ?? '',
      height_cm: reqNum(pHeight),
      sex: pSex.current?.value ?? '',
      goal: pGoal.current?.value ?? '',
      activity_factor: reqNum(pAf),
      protein_pct: reqNum(pProtein),
      fat_pct: reqNum(pFat),
      carb_pct: reqNum(pCarb),
    }

    if (!p.birth_date) return setErr('生日要填')
    if (!Number.isFinite(p.height_cm) || p.height_cm <= 0) return setErr('身高要填數字')
    if (!Number.isFinite(p.activity_factor) || p.activity_factor <= 0) return setErr('活動係數要填數字')
    if ([p.protein_pct, p.fat_pct, p.carb_pct].some((n) => !Number.isFinite(n) || n < 0)) {
      return setErr('三大比例要填數字')
    }

    // DB 欄位 numeric(4,1)：先各自捨入到一位小數再驗和＝100，粒度要跟寫入一致
    const normalized = normalizeMacroPercentages(p)
    if (!macroPercentagesSumTo100(p)) {
      const sum = roundTo1(normalized.protein_pct + normalized.fat_pct + normalized.carb_pct)
      return setErr(`三大比例相加要等於 100（目前 ${sum}）`)
    }

    setBusy(true)
    setErr(null)
    try {
      await onSaveProfile({
        birth_date: p.birth_date,
        height_cm: p.height_cm,
        sex: p.sex,
        goal: p.goal,
        activity_factor: p.activity_factor,
        protein_pct: normalized.protein_pct,
        fat_pct: normalized.fat_pct,
        carb_pct: normalized.carb_pct,
      })
      closeSheet()
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const goal = GOAL_LABEL[profile.goal] ?? profile.goal
  const ratio = [profile.protein_pct, profile.fat_pct, profile.carb_pct].map((v) => String(num(v))).join(' / ')
  const sheetTitle = sheetKind === 'weight' ? '記體重' : '身體參數'
  // 退場覆寫整個 animation shorthand（不能只改 duration）：.scrim 平時的 animation 是
  // scrim-in，只改時長會讓它用縮短的時間重播「進場」而不是播放「退場」
  const scrimExitStyle = closing ? { animation: `scrim-out ${closeDurationMs()}ms var(--ease-sheet) both` } : undefined
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
        <dl>
          <Kv label="最新體重" value={`${num(latestWeight.weight_kg).toFixed(2)} kg`} />
          <Kv label="量測日" value={latestWeight.measured_on} />
          <Kv label="身高" value={`${num(profile.height_cm).toFixed(1)} cm`} />
          <Kv label="年齡" value={`${targets.age} 歲`} />
          <Kv label="BMR" value={`${Math.round(targets.bmr)} 卡`} />
          <Kv label="活動係數" value={String(num(profile.activity_factor))} />
          <Kv label="TDEE" value={`${Math.round(targets.tdee)} 卡`} />
          <Kv label="目標" value={goal} />
          <Kv label="三大比例" value={ratio} />
        </dl>
        <p className="note">
          Mifflin-St Jeor 公式算 BMR，乘活動係數得 TDEE，{GOAL_NOTE[profile.goal] ?? ''}
          。三大營養素按 {ratio} 拆分。體重取最新一筆，數值變動時目標會跟著動。
        </p>

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
                  <p className="note">存體脂計原始讀數，不做校正。同一天再記一次會覆蓋當天那筆。</p>
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
                  <div className="field-float">
                    <input ref={pBirth} id="p-birth" type="date" defaultValue={profile.birth_date} />
                    <label htmlFor="p-birth">生日</label>
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
                  <div className="field-row">
                    <div className="field-float">
                      <select ref={pGoal} id="p-goal" defaultValue={profile.goal}>
                        <option value="cut">減重</option>
                        <option value="maintain">維持</option>
                        <option value="bulk">增肌</option>
                      </select>
                      <label htmlFor="p-goal">目標</label>
                    </div>
                    <div className="field-float">
                      <input
                        ref={pAf}
                        id="p-af"
                        type="text"
                        inputMode="decimal"
                        placeholder=" "
                        defaultValue={String(num(profile.activity_factor))}
                      />
                      <label htmlFor="p-af">
                        活動係數<span className="req">*</span>
                      </label>
                    </div>
                  </div>
                  <div className="field-row">
                    <div className="field-float">
                      <input
                        ref={pProtein}
                        id="p-protein"
                        type="text"
                        inputMode="decimal"
                        placeholder=" "
                        defaultValue={String(num(profile.protein_pct))}
                      />
                      <label htmlFor="p-protein">
                        蛋白 %<span className="req">*</span>
                      </label>
                    </div>
                    <div className="field-float">
                      <input
                        ref={pFat}
                        id="p-fat"
                        type="text"
                        inputMode="decimal"
                        placeholder=" "
                        defaultValue={String(num(profile.fat_pct))}
                      />
                      <label htmlFor="p-fat">
                        脂肪 %<span className="req">*</span>
                      </label>
                    </div>
                    <div className="field-float">
                      <input
                        ref={pCarb}
                        id="p-carb"
                        type="text"
                        inputMode="decimal"
                        placeholder=" "
                        defaultValue={String(num(profile.carb_pct))}
                      />
                      <label htmlFor="p-carb">
                        碳水 %<span className="req">*</span>
                      </label>
                    </div>
                  </div>
                  <p className="note">活動係數：久坐 1.2、輕度 1.375、中度 1.55、高度 1.725。三大比例相加要等於 100。</p>
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
