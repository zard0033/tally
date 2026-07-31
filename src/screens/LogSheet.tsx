/* 記一筆 sheet：vaul Drawer 承載，清單多選／搜尋／份量 stepper／新增食物／確認列。
   行為與視覺依 DESIGN.md 元件規則表（2026-07-31 起是唯一真相來源，原本對齊的
   sample-log-entry.html 樣張已隨該日的樣張退場一併移除），程式邏輯照 legacy/app.js
   的「記一筆 sheet」整段（openSheet／sheetListHtml／onSheetClick／onSheetInput／
   onSheetChange／submitPicks／submitFood）逐條搬，計算全部交給 src/lib 不重新推導。

   vanilla 版的兩個坑（sheet 整塊重繪咬 click、注音組字被打斷）源自 renderSheet() 用
   innerHTML 整塊換掉 DOM——React keyed 渲染天然不會這樣做（同一顆按鈕、同一個 input
   在 re-render 之間是同一個 DOM 節點，不會被拔掉重建），所以這裡不需要 legacy 那套
   「清單走增量、搜尋框不動」的特殊處理，直接用一般的 controlled component 寫法即可。 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent, type ReactNode } from 'react'
import { Autocomplete } from '@base-ui/react/autocomplete'
import { Drawer } from 'vaul'
import {
  listRecentIntake,
  type Food,
  type NewFood,
  type NewIntake,
} from '@/lib/api'
import { localDate } from '@/lib/dates'
import { num, sumIntake } from '@/lib/formulas'
import { MEALS, mealLabel, type MealKey } from '@/lib/meals'
import { normalizeQty } from '@/lib/quantity'
import type { LogSheetProps } from './types'

/* vaul 內建動效走 CSS 動畫（[data-vaul-drawer]/[data-vaul-overlay] 的 data-state 屬性），
   不是 legacy 那種掛 .opening／.closing class 手動控制的寫法，所以「用 CSS 覆寫其 data
   屬性動畫」是唯一路徑：vaul 自己的規則用 [data-vaul-drawer][data-state=...] 這組選擇器
   （二個屬性選擇器，優先權 (0,0,2,0)），這裡用相同優先權的選擇器覆寫，靠 !important
   保證勝出（vaul 的 <style> 插入時機不保證在這份元件的 <style> 之前）。
   進場沿用 --dur-sheet/--ease-sheet（DESIGN.md v1.9 動效階梯）；drawer 退場 --dur-mid
   （退場比進場降一級；原 200ms 真機體感「像直接消失」）；scrim 退場另走 --dur-fast，
   比 drawer 短——暗幕先清，否則滑走掀開的區域與頂部帶淡出起點不同，分區變色（下方詳註）。
   scrim（Drawer.Overlay）的動畫只有這一軌——app.css 的 .scrim base class 不掛動畫。 */
const VAUL_TRANSITION_CSS = `
[data-vaul-drawer][data-state="open"], [data-vaul-overlay][data-state="open"] {
  animation-duration: var(--dur-sheet, 280ms) !important;
  animation-timing-function: var(--ease-sheet, cubic-bezier(.32, .72, 0, 1)) !important;
}
[data-vaul-drawer][data-state="closed"] {
  animation-duration: var(--dur-mid, 220ms) !important;
  animation-timing-function: var(--ease-sheet, cubic-bezier(.32, .72, 0, 1)) !important;
}
/* overlay 退場比 sheet 短：兩者同速時，sheet 滑走「掀開」的區域露出的是淡到一半的
   scrim，而頂部 96px 從全黑開始淡——真機看起來就是頂部延遲變色（2026-07-29 實測）。
   暗幕先清、sheet 慢滑，掀開處已是乾淨背景，不一致感即消失 */
[data-vaul-overlay][data-state="closed"] {
  animation-duration: var(--dur-fast, 100ms) !important;
  animation-timing-function: var(--ease-sheet, cubic-bezier(.32, .72, 0, 1)) !important;
}
/* reduced-motion 要在這裡自帶一份：上面幾條都掛著 !important，app.css 的全域
   reduced-motion 區塊（無 !important）壓不過，只能同權重就地覆寫 */
@media (prefers-reduced-motion: reduce) {
  [data-vaul-drawer][data-state], [data-vaul-overlay][data-state] {
    animation-duration: .01ms !important;
  }
}
`

type View = 'list' | 'food-form'

interface FoodForm {
  name: string
  vendor: string
  kcal: string
  protein: string
  fat: string
  carb: string
}

const BLANK_FORM: FoodForm = { name: '', vendor: '', kcal: '', protein: '', fat: '', carb: '' }

const byName = (a: Food, b: Food) => a.name.localeCompare(b.name, 'zh-Hant')

/* 同時比對品名與店家——五筆「雞胸餐盒」其中三筆完全同名，只靠店家區分 */
function foodMatches(f: Food, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return f.name.toLowerCase().includes(s) || (f.vendor ?? '').toLowerCase().includes(s)
}

function pickTotals(picks: Map<number, number>, foodById: (id: number) => Food | undefined) {
  let n = 0
  let kcal = 0
  for (const [id, qty] of picks) {
    const f = foodById(id)
    if (!f) continue
    n++
    kcal += num(f.kcal) * qty
  }
  return { n, kcal }
}

/* 補記過去某天時「剩 479」是錯的語意——那天已經過完了，沒有「剩」可言，
   歷史日看的是加進去之後那天總共吃了多少。剩餘／超出不用正負號，避免「+594」
   被讀成「多攝取 594」。 */
function pickBarRight(isToday: boolean, eatenKcal: number, targetKcal: number, picksKcal: number) {
  if (!isToday) {
    const total = Math.round(eatenKcal + picksKcal)
    return { text: `共 ${total}`, ariaLabel: `共 ${total} 大卡`, over: false }
  }
  const left = Math.round(targetKcal) - Math.round(eatenKcal + picksKcal)
  const over = left < 0
  return {
    text: over ? `超出 ${-left}` : `剩 ${left}`,
    ariaLabel: over ? `超出 ${-left} 大卡` : `剩 ${left} 大卡`,
    over,
  }
}

interface FoodRowHandlers {
  picks: Map<number, number>
  qtyDrafts: Map<number, string>
  onToggle: (id: number) => void
  onStep: (id: number, dir: 1 | -1) => void
  onQtyInput: (id: number, raw: string) => void
  onQtyBlur: (id: number, raw: string) => void
}

/* 一般函式、不是元件——用 fn(f) 呼叫而非 <Fn/>，React 才不會把它當成每次 render
   都換了身分的新元件型別重新掛載（那樣份量輸入框每打一個字就會失焦）。 */
function renderFoodRow(f: Food, picked: boolean, h: FoodRowHandlers) {
  const qty = h.picks.get(f.id) ?? 1
  const draft = h.qtyDrafts.get(f.id) ?? String(qty)
  return (
    <li key={f.id}>
      <div className={picked ? 'food-item selected' : 'food-item'}>
        {picked ? (
          <div className="food-line">
            <button className="food-row" type="button" aria-pressed="true" onClick={() => h.onToggle(f.id)}>
              <svg className="chk" viewBox="0 0 22 22" aria-hidden="true">
                <circle cx="11" cy="11" r="9" />
                <path d="M7 11.5l2.5 2.5L15 8.5" />
              </svg>
              <div className="nm-wrap">
                <span className="nm">{f.name}</span>
                {f.vendor && <span className="sub">{f.vendor}</span>}
              </div>
            </button>
            <div className="qty-stepper">
              <button
                className="qty-btn"
                type="button"
                disabled={qty <= 1}
                aria-label={`減少 ${f.name} 的份量`}
                onClick={() => h.onStep(f.id, -1)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14" />
                </svg>
              </button>
              <input
                className="qty-value"
                type="text"
                inputMode="decimal"
                aria-label={`${f.name} 份量`}
                value={draft}
                onChange={(e) => h.onQtyInput(f.id, e.target.value)}
                onBlur={(e) => h.onQtyBlur(f.id, e.target.value)}
              />
              <button
                className="qty-btn"
                type="button"
                aria-label={`增加 ${f.name} 的份量`}
                onClick={() => h.onStep(f.id, 1)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          <button className="food-row" type="button" aria-pressed="false" onClick={() => h.onToggle(f.id)}>
            <svg className="chk" viewBox="0 0 22 22" aria-hidden="true">
              <circle cx="11" cy="11" r="9" />
            </svg>
            <div className="nm-wrap">
              <span className="nm">{f.name}</span>
              {f.vendor && <span className="sub">{f.vendor}</span>}
            </div>
            <span className="kc">{Math.round(num(f.kcal))}</span>
          </button>
        )}
      </div>
    </li>
  )
}

interface FieldOpts {
  id: string
  label: string
  required?: boolean
  numeric?: boolean
  value: string
  onChange: (v: string) => void
  inputRef?: (el: HTMLInputElement | null) => void
}

/* floating label：label 是真的 label 元素、永遠在 DOM 裡，只是視覺上位移（app.css
   .field-float 那組規則）。placeholder=" " 只是給 :placeholder-shown 當開關用的空白值，
   不是拿 placeholder 冒充 label（WCAG 3.3.2）。
   iOS AutoFill 灌值時 :placeholder-shown 正確翻轉、標籤不壓字——2026-07-29 真機驗證通過
   （legacy 同一處也標了這條，行為照搬），真機發現標籤壓字時改用 input 事件加 class 判斷。 */
function renderField(opts: FieldOpts) {
  return (
    <div className="field-float">
      <input
        id={opts.id}
        type="text"
        inputMode={opts.numeric ? 'decimal' : undefined}
        placeholder=" "
        value={opts.value}
        onChange={(e) => opts.onChange(e.target.value)}
        ref={opts.inputRef}
      />
      <label htmlFor={opts.id}>
        {opts.label}
        {opts.required && <span className="req">*</span>}
      </label>
    </div>
  )
}

const fieldNum = (v: string): number => (v.trim() === '' ? NaN : Number(v.trim()))
/* 選填數值留空當 0——無糖飲料的蛋白質與脂肪本來就是 0，不必逼人打出來 */
const fieldOptNum = (v: string): number => (v.trim() === '' ? 0 : Number(v.trim()))

export default function LogSheet(props: LogSheetProps) {
  const { open, meal: initialMeal, foods, dayData, targets, onClose, onCreateIntake, onCreateFood } = props

  const [meal, setMeal] = useState<MealKey | null>(initialMeal)
  const [view, setView] = useState<View>('list')
  const [picks, setPicks] = useState<Map<number, number>>(new Map())
  const [qtyDrafts, setQtyDrafts] = useState<Map<number, string>>(new Map())
  const [query, setQuery] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const composingRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [foodForm, setFoodForm] = useState<FoodForm>(BLANK_FORM)
  const kcalInputRef = useRef<HTMLInputElement | null>(null)
  /* 店家 Autocomplete 的 Portal 要指到這裡，不能用預設的 document.body——vaul 的
     Drawer 底層是 Radix Dialog，開啟時會把 body 設成 pointer-events:none、只放行
     Dialog Content 自己的子樹。預設 Portal 掛在 body 下等於掛在被擋的那層，選單看得到
     但點不到（真機／e2e 都撞到這個，見 DESIGN.md「店家欄位」條）。指到 Drawer.Content
     這個 ref 之後，選單變成 Dialog Content 的子孫，繼承同一份 pointer-events 豁免。 */
  const sheetRef = useRef<HTMLDivElement | null>(null)

  /* 「常吃」＝該餐別歷史出現次數，順便記住每樣最近一次的份量——LogSheetProps 只給當天
     dayData，這份跨日期的歷史不在 props 契約裡（見回報「共用檔缺口清單」），這裡直接讀
     lib/api 既有的 listRecentIntake（唯讀查詢，不改動 App 的資料流／不寫其他檔案）。
     撈不到就靜靜略過「常吃」分段，不擋清單其他功能可用。 */
  const [recent, setRecent] = useState<Map<MealKey, number[]> | null>(null)
  const [lastQty, setLastQty] = useState<Map<string, number>>(new Map())
  const recentFetchedRef = useRef(false)

  const foodById = (id: number): Food | undefined => foods?.find((f) => f.id === id)

  function defaultQty(m: MealKey | null, foodId: number): number {
    if (!m) return 1
    const q = lastQty.get(`${m}:${foodId}`)
    return Number.isFinite(q) && (q as number) > 0 ? (q as number) : 1
  }

  /* 開啟時重置整個 sheet 的本地狀態——對齊 legacy openSheet 每次都是一份新的 state.sheet */
  useEffect(() => {
    if (!open) return
    setMeal(initialMeal)
    setView('list')
    setPicks(new Map())
    setQtyDrafts(new Map())
    setQuery('')
    setFilterQuery('')
    setBusy(false)
    setErr(null)
    setFoodForm(BLANK_FORM)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || recentFetchedRef.current) return
    recentFetchedRef.current = true
    void (async () => {
      try {
        const hist = await listRecentIntake()
        const byMeal = new Map<MealKey, Map<number, number>>(MEALS.map((m) => [m.key, new Map()]))
        const lq = new Map<string, number>()
        for (const r of hist) {
          const key = `${r.meal}:${r.food_id}`
          if (!lq.has(key)) lq.set(key, num(r.qty))
          const c = byMeal.get(r.meal as MealKey)
          if (c) c.set(r.food_id, (c.get(r.food_id) ?? 0) + 1)
        }
        setLastQty(lq)
        setRecent(new Map([...byMeal].map(([k, counts]) => [k, [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id)])))
      } catch {
        /* 常吃只是排序優化，撈不到不影響「全部食物」清單能不能用，也不用打全域 Notice */
      }
    })()
  }, [open])

  useEffect(() => {
    if (view === 'food-form') kcalInputRef.current?.focus()
  }, [view])

  function togglePick(id: number) {
    setErr(null)
    setPicks((prev) => {
      const next = new Map(prev)
      if (next.has(id)) {
        next.delete(id)
        setQtyDrafts((d) => {
          const nd = new Map(d)
          nd.delete(id)
          return nd
        })
      } else {
        const q = defaultQty(meal, id)
        next.set(id, q)
        setQtyDrafts((d) => new Map(d).set(id, String(q)))
      }
      return next
    })
  }

  function stepQty(id: number, dir: 1 | -1) {
    const cur = picks.get(id) ?? 1
    const next = normalizeQty(cur + dir)
    setPicks((prev) => new Map(prev).set(id, next))
    setQtyDrafts((prev) => new Map(prev).set(id, String(next)))
  }

  /* 打字途中不正規化——"1." 這種中間狀態被改成 1 的話游標會跳走。值先寬鬆收下
     （能解析成正數就先更新 picks 讓小計跟著動），正規化留到 onBlur 再做 */
  function handleQtyInput(id: number, raw: string) {
    setQtyDrafts((prev) => new Map(prev).set(id, raw))
    const n = Number(raw.trim())
    if (Number.isFinite(n) && n > 0) setPicks((prev) => new Map(prev).set(id, n))
  }

  function handleQtyBlur(id: number, raw: string) {
    const n = normalizeQty(raw)
    setPicks((prev) => new Map(prev).set(id, n))
    setQtyDrafts((prev) => new Map(prev).set(id, String(n)))
  }

  /* 搜尋框是受控 input（value 一直等於 query，顯示不會被打斷）；filterQuery 才是拿去
     過濾清單的值，且只在「沒有在組字」時同步——compositionstart／compositionend 之間
     （中文注音／拼音組字中）完全不觸發過濾，組字結束那一刻才補上最終值。 */
  function handleQueryChange(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    if (!composingRef.current) setFilterQuery(v)
  }
  function handleCompositionStart() {
    composingRef.current = true
  }
  function handleCompositionEnd(e: CompositionEvent<HTMLInputElement>) {
    composingRef.current = false
    setFilterQuery(e.currentTarget.value)
  }

  function openFoodForm(prefillName: string) {
    setFoodForm({ ...BLANK_FORM, name: prefillName })
    setErr(null)
    setView('food-form')
  }

  function backToList() {
    setView('list')
    setErr(null)
  }

  async function submitPicks() {
    if (picks.size === 0 || busy || !meal) return
    setBusy(true)
    setErr(null)
    const rows: NewIntake[] = []
    for (const [id, qty] of picks) {
      const f = foodById(id)
      if (!f) continue
      rows.push({ eaten_on: dayData.date, meal, food_id: id, qty, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb })
    }
    try {
      await onCreateIntake(rows)
      /* 成功後 App 會把 open 翻成 false，交給 vaul 播退場動畫；不在這裡手動 setBusy(false)——
         下次開啟時 open 的 reset effect 會處理 */
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function submitFoodForm() {
    if (busy) return
    const name = foodForm.name.trim()
    const vendor = foodForm.vendor.trim() || null
    const kcal = fieldNum(foodForm.kcal)
    const protein = fieldOptNum(foodForm.protein)
    const fat = fieldOptNum(foodForm.fat)
    const carb = fieldOptNum(foodForm.carb)
    if (!name) return setErr('品名要填')
    if (!Number.isFinite(kcal) || kcal < 0) return setErr('熱量要填數字')
    if ([protein, fat, carb].some((n) => !Number.isFinite(n) || n < 0)) return setErr('營養素要填數字或留空')

    setBusy(true)
    setErr(null)
    const newFood: NewFood = { name, vendor, kcal, protein, fat, carb }
    try {
      const created = await onCreateFood(newFood)
      /* 新增完直接選起來，回清單由底部確認列承接——這顆按鈕只承諾「加入食品庫」，
         真正記進 intake 仍要按「加入」，兩件事分開才不會以為記完就關掉 app（跟 legacy
         submitFood 行為一致；sample-log-entry.html A-6 的按鈕文案「加入食品庫並記一筆」
         與此不同，取捨與理由見回報「與樣張／legacy 的偏差」） */
      setPicks((prev) => new Map(prev).set(created.id, 1))
      setQtyDrafts((prev) => new Map(prev).set(created.id, '1'))
      setView('list')
      setQuery('')
      setFilterQuery('')
      setBusy(false)
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const isToday = dayData.date === localDate()
  const eaten = sumIntake(dayData.rows ?? [])
  const totals = pickTotals(picks, foodById)
  const right = pickBarRight(isToday, eaten.kcal, targets.kcal, totals.kcal)

  const sortedFoods = foods ? [...foods].sort(byName) : null
  /* 店家 Autocomplete 的選項來源：foods 上的 vendor 字串去重排序，不建專屬資料表——
     去重就是清單，建表要付新表＋外鍵＋遷移＋RLS 的代價卻買不到東西。 */
  const vendorOptions = useMemo(() => {
    if (!foods) return []
    const set = new Set<string>()
    for (const f of foods) if (f.vendor) set.add(f.vendor)
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant-u-co-stroke'))
  }, [foods])
  const trimmedQuery = filterQuery.trim()
  const pickedFoods = [...picks.keys()].map(foodById).filter((f): f is Food => !!f)

  const handlers: FoodRowHandlers = {
    picks,
    qtyDrafts,
    onToggle: togglePick,
    onStep: stepQty,
    onQtyInput: handleQtyInput,
    onQtyBlur: handleQtyBlur,
  }

  let browseBody: ReactNode = null
  if (sortedFoods === null) {
    browseBody = <p className="muted">載入中…</p>
  } else if (trimmedQuery) {
    const hits = sortedFoods.filter((f) => !picks.has(f.id) && foodMatches(f, trimmedQuery))
    browseBody = (
      <>
        <div className="sect-lb">搜尋結果</div>
        {hits.length === 0 && <p className="search-empty-msg">找不到「{trimmedQuery}」</p>}
        <ul className="food-list">
          {hits.map((f) => renderFoodRow(f, false, handlers))}
          <li>
            <button className="add-food-row" type="button" onClick={() => openFoodForm(trimmedQuery)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="txt">新增「{trimmedQuery}」到食品庫</span>
            </button>
          </li>
        </ul>
      </>
    )
  } else {
    const recentIds = (meal ? recent?.get(meal) : undefined) ?? []
    const recentFoods = recentIds
      .filter((id) => !picks.has(id))
      .map(foodById)
      .filter((f): f is Food => !!f)
      .slice(0, 5)
    const restFoods = sortedFoods.filter((f) => !picks.has(f.id) && !recentFoods.includes(f))
    browseBody = (
      <>
        {recentFoods.length > 0 && (
          <>
            <div className="sect-lb">{meal ? mealLabel(meal) : ''}常吃</div>
            <ul className="food-list">{recentFoods.map((f) => renderFoodRow(f, false, handlers))}</ul>
          </>
        )}
        {restFoods.length > 0 && (
          <>
            <div className="sect-lb">全部食物</div>
            <ul className="food-list">{restFoods.map((f) => renderFoodRow(f, false, handlers))}</ul>
          </>
        )}
        {recentFoods.length === 0 && restFoods.length === 0 && (
          <p className="muted">食品庫還是空的。在上面搜尋框輸入品名就能新增第一筆。</p>
        )}
      </>
    )
  }

  const contentAriaLabel = view === 'list' ? (meal ? mealLabel(meal) : '記一筆') : '新增食物'

  return (
    <>
      <style>{VAUL_TRANSITION_CSS}</style>
      <Drawer.Root open={open} onOpenChange={(v) => { if (!v) onClose() }} direction="bottom" shouldScaleBackground={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="scrim" />
          <Drawer.Content ref={sheetRef} className="sheet" aria-label={contentAriaLabel} data-screen="log-sheet">
            <Drawer.Handle className="handle" />

            {view === 'list' ? (
              <>
                <div className="chip-bar">
                  <div className="chiprow" role="tablist" aria-label="餐別">
                    {MEALS.map((m) => (
                      <button
                        key={m.key}
                        className="chip"
                        type="button"
                        role="tab"
                        aria-current={meal === m.key ? 'true' : undefined}
                        onClick={() => setMeal(m.key)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <button className="icon-btn" type="button" aria-label="關閉" onClick={onClose}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>

                <div className="search-wrap">
                  <div className="search-box">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="11" cy="11" r="6" />
                      <path d="M20 20l-4-4" />
                    </svg>
                    <input
                      type="text"
                      placeholder="搜尋品名或店家"
                      aria-label="搜尋食物"
                      value={query}
                      onChange={handleQueryChange}
                      onCompositionStart={handleCompositionStart}
                      onCompositionEnd={handleCompositionEnd}
                    />
                  </div>
                </div>

                <div className="food-scroll">
                  {picks.size > 0 && (
                    <>
                      <div className="sect-lb">已選</div>
                      <ul className="food-list">{pickedFoods.map((f) => renderFoodRow(f, true, handlers))}</ul>
                    </>
                  )}
                  {browseBody}
                </div>

                {picks.size > 0 && (
                  <div className={right.over ? 'pick-bar is-over' : 'pick-bar'}>
                    {err && (
                      <p className="sheet-error" role="alert">
                        存不進去：{err}
                      </p>
                    )}
                    <div className="pick-line" aria-label={`${totals.n} 樣，共 ${Math.round(totals.kcal)} 大卡，${right.ariaLabel}`}>
                      <span className="sub" aria-hidden="true">
                        {totals.n} 樣 · {Math.round(totals.kcal)} 卡
                      </span>
                      <span className="remain" aria-hidden="true">
                        {right.text}
                      </span>
                    </div>
                    <button className="pick-bar-btn" type="button" disabled={busy} onClick={() => void submitPicks()}>
                      {busy ? '加入中…' : err ? '重試' : '加入'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="sheet-head">
                  <span className="sheet-title">新增食物</span>
                  <button className="icon-btn" type="button" aria-label="關閉" onClick={onClose}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                <div className="back-row">
                  <button className="back-btn" type="button" onClick={backToList}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M15 6l-6 6 6 6" />
                    </svg>
                    返回搜尋
                  </button>
                </div>

                <div className="form-wrap">
                  <div className="field-row">
                    {renderField({
                      id: 'f-name',
                      label: '品名',
                      required: true,
                      value: foodForm.name,
                      onChange: (v) => setFoodForm((p) => ({ ...p, name: v })),
                    })}
                    <div className="field-float">
                      {/* 可自由輸入的 Autocomplete，不是受限 Combobox——使用者常打錯店家名，
                          這裡讓既有店家可選，但打一個清單外的新名字一樣送得出去。
                          Autocomplete.Root 不渲染自己的元素，input 緊接 label 是直接子節點，
                          floating label 的 `input + label` CSS 選擇器因此照樣命中。
                          IME 組字：Autocomplete 底層共用 combobox 的 AriaCombobox，
                          composition 期間本來就不會把中間態送進 onValueChange，不需要
                          比照食物搜尋另外做 query/filterQuery 雙 state。 */}
                      <Autocomplete.Root
                        items={vendorOptions}
                        value={foodForm.vendor}
                        onValueChange={(v) => setFoodForm((p) => ({ ...p, vendor: v }))}
                        openOnInputClick
                      >
                        <Autocomplete.Input id="f-vendor" placeholder=" " />
                        <label htmlFor="f-vendor">店家</label>
                        <Autocomplete.Portal container={sheetRef}>
                          <Autocomplete.Positioner sideOffset={4} className="vendor-positioner">
                            <Autocomplete.Popup className="vendor-popup">
                              <Autocomplete.Empty className="vendor-empty">沒有符合的店家，直接送出就會新增</Autocomplete.Empty>
                              <Autocomplete.List className="vendor-list">
                                {(vendor: string) => (
                                  <Autocomplete.Item key={vendor} value={vendor} className="vendor-item">
                                    {vendor}
                                  </Autocomplete.Item>
                                )}
                              </Autocomplete.List>
                            </Autocomplete.Popup>
                          </Autocomplete.Positioner>
                        </Autocomplete.Portal>
                      </Autocomplete.Root>
                    </div>
                  </div>
                  {renderField({
                    id: 'f-kcal',
                    label: '熱量（卡）',
                    required: true,
                    numeric: true,
                    value: foodForm.kcal,
                    onChange: (v) => setFoodForm((p) => ({ ...p, kcal: v })),
                    inputRef: (el) => {
                      kcalInputRef.current = el
                    },
                  })}
                  <div className="field-row">
                    {renderField({
                      id: 'f-protein',
                      label: '蛋白質 g',
                      numeric: true,
                      value: foodForm.protein,
                      onChange: (v) => setFoodForm((p) => ({ ...p, protein: v })),
                    })}
                    {renderField({
                      id: 'f-fat',
                      label: '脂肪 g',
                      numeric: true,
                      value: foodForm.fat,
                      onChange: (v) => setFoodForm((p) => ({ ...p, fat: v })),
                    })}
                    {renderField({
                      id: 'f-carb',
                      label: '碳水 g',
                      numeric: true,
                      value: foodForm.carb,
                      onChange: (v) => setFoodForm((p) => ({ ...p, carb: v })),
                    })}
                  </div>
                </div>

                <div className="confirm-wrap">
                  {err && (
                    <p className="sheet-error" role="alert">
                      {err}
                    </p>
                  )}
                  <button className="pick-bar-btn" type="button" disabled={busy} onClick={() => void submitFoodForm()}>
                    {busy ? '加入中…' : '加入食品庫'}
                  </button>
                </div>
              </>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  )
}
