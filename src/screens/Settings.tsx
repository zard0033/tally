/* 設定頁：v2.21 起改成純入口列表（取代第一版唯讀 dl），四個入口分頭導到各自的頁面
   （每日目標／食品庫管理／更新身體數據／體重趨勢）。「更新身體數據」不另做頁面，沿用
   既有的獨立 sheet 覆蓋層（地基裁決：編輯與記體重不共用 LogSheet 的 Drawer），因為
   DailyGoal 頁裡的「更新身體數據」連結也要能開同一個 sheet，所以 sheet 狀態留在這層
   路由元件管理，往下傳一個 openBodyUpdate callback。

   唯一的落地差異（沿用自舊版）：legacy 用 `#sheet-root.closing .sheet` 這個
   id-scoped 選擇器做退場動畫，但 id="sheet-root" 已經被 LogSheet 佔用，這裡改用
   另一個 id 掛容器，退場動畫直接用 inline style 套用同一組 keyframes。 */
import { useEffect, useRef, useState } from 'react'
import { listWeights, type Weight } from '@/lib/api'
import { localDate } from '@/lib/dates'
import { num } from '@/lib/formulas'
import DailyGoal from './DailyGoal'
import FoodLibrary from './FoodLibrary'
import WeightTrend from './WeightTrend'
import type { SettingsProps } from './types'

type View = 'list' | 'goal' | 'library' | 'trend'

/** 動效時長讀 app.css 的 token，reduced-motion 時降到近乎 0（跟 LogSheet 同一來源）。 */
function tokenMs(name: string, fallback: number): number {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 0.01
  const t = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(t) ? t : fallback
}
const closeDurationMs = () => tokenMs('--dur-mid', 220)
const scrimFadeMs = () => tokenMs('--dur-fast', 100)

function reqNum(ref: React.RefObject<HTMLInputElement | null>): number {
  const v = ref.current?.value.trim() ?? ''
  return v === '' ? NaN : Number(v)
}

/** sparkline 用：weight_kg 折線，寬 120 高 32 的 viewBox 內線性映射。少於 2 筆畫不出線，
 *  呼叫端自己判斷要不要渲染。 */
function sparklinePoints(weights: Weight[]): string {
  const values = weights.map((w) => Number(w.weight_kg))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = values.length > 1 ? 120 / (values.length - 1) : 0
  return values.map((v, i) => `${(i * stepX).toFixed(1)},${(28 - ((v - min) / span) * 24).toFixed(1)}`).join(' ')
}

export default function Settings(props: SettingsProps) {
  const {
    profile, targets, latestWeight, foods,
    onSaveProfile, onSaveWeight, onCreateFood, onUpdateFood, onArchiveFood, onUnarchiveFood, onSignOut,
    onSubViewChange,
  } = props

  const [view, setView] = useState<View>('list')
  const [weights, setWeights] = useState<Weight[] | null>(null)

  /* 離開這個元件（切回今日頁分頁）時要還原 navbar，不能只靠 view 變化——cleanup
   * 保證無論怎麼離開都會補一次 onSubViewChange(false)，把 navbar 還原。 */
  useEffect(() => {
    onSubViewChange(view !== 'list')
    return () => onSubViewChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const refreshWeights = () => void listWeights().then(setWeights).catch(() => setWeights([]))
  useEffect(refreshWeights, [])

  const [sheetOpen, setSheetOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const wDate = useRef<HTMLInputElement>(null)
  const wKg = useRef<HTMLInputElement>(null)
  const wFat = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current) }, [])
  useEffect(() => { if (sheetOpen && !closing) dialogRef.current?.focus() }, [sheetOpen, closing])

  useEffect(() => {
    if (!sheetOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeSheet()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen, closing])

  function openBodyUpdate() {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
    setErr(null)
    setBusy(false)
    setClosing(false)
    setSheetOpen(true)
  }

  function closeSheet() {
    if (!sheetOpen || closing) return
    setClosing(true)
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setSheetOpen(false)
      setClosing(false)
    }, closeDurationMs())
  }

  async function submitWeight() {
    if (busy) return
    const kg = reqNum(wKg)
    const on = wDate.current?.value.trim() ?? ''
    const fatVal = wFat.current?.value.trim() ?? ''

    if (!Number.isFinite(kg) || kg <= 0) return setErr('體重要填數字')
    if (!on) return setErr('量測日要填')
    const fat = fatVal === '' ? null : Number(fatVal)
    if (fat !== null && (!Number.isFinite(fat) || fat < 3 || fat > 70)) {
      return setErr('體脂要填 3–70 之間的數字，或留空')
    }

    setBusy(true)
    setErr(null)
    try {
      await onSaveWeight({ measured_on: on, weight_kg: kg, body_fat_pct: fat })
      refreshWeights()
      closeSheet()
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const scrimExitStyle = closing ? { animation: `scrim-out ${scrimFadeMs()}ms var(--ease-sheet) both` } : undefined
  const sheetExitStyle = closing ? { animation: `sheet-out ${closeDurationMs()}ms var(--ease-sheet) both` } : undefined

  const bodyUpdateSheet = sheetOpen && (
    <div id="settings-sheet-root">
      <button type="button" className="scrim" aria-label="關閉" style={scrimExitStyle} onClick={closeSheet} />
      <div
        ref={dialogRef}
        className={`sheet${closing ? '' : ' opening'}`}
        style={sheetExitStyle}
        role="dialog"
        aria-modal="true"
        aria-label="更新身體數據"
        tabIndex={-1}
      >
        <div className="handle" aria-hidden="true" />
        <div className="sheet-head">
          <span className="sheet-title">更新身體數據</span>
          <button type="button" className="icon-btn" aria-label="關閉" onClick={closeSheet}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="form-wrap">
          <div className="field-float">
            <input ref={wDate} id="w-date" type="date" defaultValue={localDate()} />
            <label htmlFor="w-date">量測日</label>
          </div>
          <div className="field-float">
            <input ref={wKg} id="w-kg" type="text" inputMode="decimal" placeholder=" " />
            <label htmlFor="w-kg">體重 kg<span className="req">*</span></label>
          </div>
          <div className="field-float">
            <input ref={wFat} id="w-fat" type="text" inputMode="decimal" placeholder=" " />
            <label htmlFor="w-fat">體脂 %</label>
          </div>
          <p className="note">同一天再記一次會覆蓋當天那筆。</p>
          <p className="note">填了體脂率，公式估算會用更準的 Katch-McArdle；沒填則改用 Mifflin-St Jeor，熱量目標可能因此跟著變。</p>
        </div>
        <div className="confirm-wrap">
          {err && <p className="sheet-error" role="alert">{err}</p>}
          <button type="button" className="pick-bar-btn" disabled={busy} onClick={() => void submitWeight()}>
            {busy ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )

  if (view === 'goal') {
    return (
      <>
        <DailyGoal profile={profile} latestWeight={latestWeight} onSaveProfile={onSaveProfile} onBack={() => setView('list')} onOpenBodyUpdate={openBodyUpdate} />
        {bodyUpdateSheet}
      </>
    )
  }
  if (view === 'library') {
    return (
      <FoodLibrary
        foods={foods}
        onCreateFood={onCreateFood}
        onUpdateFood={onUpdateFood}
        onArchiveFood={onArchiveFood}
        onUnarchiveFood={onUnarchiveFood}
        onBack={() => setView('list')}
      />
    )
  }
  if (view === 'trend') {
    return <WeightTrend weights={weights} onBack={() => setView('list')} />
  }

  const hasSpark = weights !== null && weights.length >= 2
  const latestSparkDate = weights && weights.length > 0 ? weights[weights.length - 1].measured_on : null
  const latestSparkLabel = latestSparkDate ? `${Number(latestSparkDate.slice(5, 7))}/${Number(latestSparkDate.slice(8, 10))}` : ''

  return (
    <div className="main" data-screen="settings">
      <header className="topbar">
        <h1 className="today">設定</h1>
      </header>

      <div className="settings">
        <div className="entry-list">
          <button className="entry-row" type="button" onClick={() => setView('goal')}>
            <span className="lb-wrap">
              <span className="lb">每日目標</span>
              <span className="lb-sub">
                {Math.round(targets.kcal)} 卡・蛋白 {Math.round(targets.protein)}g・脂 {Math.round(targets.fat)}g・碳水 {Math.round(targets.carb)}g
              </span>
            </span>
            <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <button className="entry-row" type="button" onClick={() => setView('library')}>
            <span className="lb-wrap"><span className="lb">食品庫管理</span></span>
            <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <button className="entry-row" type="button" onClick={openBodyUpdate}>
            <span className="lb-wrap"><span className="lb">更新身體數據</span></span>
            <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <button className="entry-row" type="button" onClick={() => setView('trend')}>
            <span className="lb-wrap">
              <span className="lb">體重趨勢</span>
              <span className="lb-sub">最新 {num(latestWeight.weight_kg).toFixed(1)} kg{latestSparkLabel ? `（${latestSparkLabel}）` : ''}</span>
            </span>
            {hasSpark && (
              <svg className="spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true">
                <polyline points={sparklinePoints(weights)} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
        <button className="signout" type="button" onClick={onSignOut}>
          登出
        </button>
      </div>

      {bodyUpdateSheet}
    </div>
  )
}
