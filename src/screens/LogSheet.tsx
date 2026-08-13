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
import { Drawer } from 'vaul'
import FoodFormFields from '@/components/FoodFormFields'
import {
  listRecentIntake,
  scanLabel,
  type Food,
  type NewIntake,
} from '@/lib/api'
import { localDate } from '@/lib/dates'
import { BLANK_FOOD_FORM, validateFoodForm, vendorOptionsOf, type FoodForm } from '@/lib/foodForm'
import { formatOverAria, formatOverDelta, macroExceeds, num, pickBarRight, roundTo1, rowOverage, sumIntake, type IntakeTotals, type OverDelta, type Targets } from '@/lib/formulas'
import { MEALS, mealLabel, type MealKey } from '@/lib/meals'
import { normalizeQty } from '@/lib/quantity'
import type { LogSheetProps } from './types'


type View = 'list' | 'food-form'

const byName = (a: Food, b: Food) => a.name.localeCompare(b.name, 'zh-Hant')

/* 同時比對品名與店家——五筆「雞胸餐盒」其中三筆完全同名，只靠店家區分 */
function foodMatches(f: Food, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return f.name.toLowerCase().includes(s) || (f.vendor ?? '').toLowerCase().includes(s)
}

function pickTotals(
  picks: Map<number, number>,
  foodById: (id: number) => Food | undefined,
): IntakeTotals & { n: number } {
  const amounts = [...picks]
    .map(([id, qty]) => ({ f: foodById(id), qty }))
    .filter((x): x is { f: Food; qty: number } => !!x.f)
  const totals = sumIntake(amounts.map(({ f, qty }) => ({ qty, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb })))
  return { n: amounts.length, ...totals }
}

interface FoodRowHandlers {
  picks: Map<number, number>
  qtyDrafts: Map<number, string>
  onToggle: (id: number) => void
  onStep: (id: number, dir: 1 | -1) => void
  onQtyInput: (id: number, raw: string) => void
  onQtyBlur: (id: number, raw: string) => void
  /* 逐筆超標預警的判定基準：今日已吃＋sheet 內已勾選的加總（不含這一筆本身，
     由 renderFoodRow 依 picked 狀態決定要不要疊加），與 targets 一起傳，
     免得每個呼叫端各自重算一次 */
  combined: IntakeTotals
  targets: Targets
  /* 逐筆超標預警要用「勾下去實際會用的份量」試算，不能假設 1——togglePick 勾選時
     用的就是這個函式（依該餐上次吃這樣東西的份量），兩邊要算同一個數字，
     否則預告「不會超標」點下去卻超標（precommit review 抓到，2026-08-01）。 */
  defaultQty: (foodId: number) => number
  /* 軟性排序（v2.15，視覺降權在 v2.17 拿掉）：不符合今日剩餘額度的品項所屬 id
     集合，判斷基準是「今日已吃」（eaten），不含這次 sheet 內勾選中的品項——刻意
     跟上面 combined（用來算逐列變色與 kc-delta）不同源，見 browseBody 旁的長註解。
     `.over-quota` class 現在**只當排序分組與 e2e 測試用的語意標記，不掛任何樣式**
     （見 app.css 同名 class 旁的註解）——不是死碼，刪掉會讓排序分組與既有測試斷言
     一起失效。 */
  overQuotaIds: Set<number>
}

/* 一般函式、不是元件——用 fn(f) 呼叫而非 <Fn/>，React 才不會把它當成每次 render
   都換了身分的新元件型別重新掛載（那樣份量輸入框每打一個字就會失焦）。 */
function renderFoodRow(f: Food, picked: boolean, h: FoodRowHandlers) {
  const qty = h.picks.get(f.id) ?? 1
  const draft = h.qtyDrafts.get(f.id) ?? String(qty)
  const overQuota = !picked && h.overQuotaIds.has(f.id)
  return (
    <li key={f.id}>
      <div className={picked ? 'food-item selected' : overQuota ? 'food-item over-quota' : 'food-item'}>
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
          (() => {
            const previewQty = h.defaultQty(f.id)
            const over = rowOverage(h.combined, num(f.kcal) * previewQty, num(f.fat) * previewQty, num(f.carb) * previewQty, h.targets)
            const delta = formatOverDelta(over)
            const ariaText = formatOverAria(over)
            const ariaSuffix = ariaText ? `，加入後${ariaText}` : ''
            return (
              <button
                className="food-row"
                type="button"
                aria-pressed="false"
                aria-label={`${f.name}${f.vendor ? '，' + f.vendor : ''}，${Math.round(num(f.kcal))} 大卡${ariaSuffix}`}
                onClick={() => h.onToggle(f.id)}
              >
                <svg className="chk" viewBox="0 0 22 22" aria-hidden="true">
                  <circle cx="11" cy="11" r="9" />
                </svg>
                <div className="nm-wrap" aria-hidden="true">
                  <span className="nm">{f.name}</span>
                  {f.vendor && <span className="sub">{f.vendor}</span>}
                </div>
                <div className="kc-wrap" aria-hidden="true">
                  <span className={over.kcal > 0 ? 'kc over' : 'kc'}>{Math.round(num(f.kcal))}</span>
                  {delta && <span className="kc-delta">{delta}</span>}
                </div>
              </button>
            )
          })()
        )}
      </div>
    </li>
  )
}

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
  const [foodForm, setFoodForm] = useState<FoodForm>(BLANK_FOOD_FORM)
  /** 辨識中鎖住關閉（關閉鈕 ＋ 下滑）——誤關的代價是那張照片白拍。 */
  const [scanBusy, setScanBusy] = useState(false)
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
    setFoodForm(BLANK_FOOD_FORM)
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

  /* 進表單時品名已經是搜尋字串帶進來的（openFoodForm 的 prefillName），下一個該落焦的
     是店家，不是熱量——原本直接 focus 熱量會跳過店家，真機回報「順序不對」（2026-08-02）。
     這個行為現在由 FoodFormFields 的 `vendorAutoFocus` 承擔（表單是在 view 切過去時才
     掛載的，元件自己的 mount effect 等價於原本這個 [view] effect）。 */

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
    setFoodForm({ ...BLANK_FOOD_FORM, name: prefillName })
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
    const validated = validateFoodForm(foodForm)
    if ('error' in validated) return setErr(validated.error)

    setBusy(true)
    setErr(null)
    try {
      const created = await onCreateFood(validated.food)
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
  const combined: IntakeTotals = {
    kcal: eaten.kcal + totals.kcal,
    protein: eaten.protein + totals.protein,
    fat: eaten.fat + totals.fat,
    carb: eaten.carb + totals.carb,
  }

  /* 軟性排序（v2.15，取代「篩選會清空清單」的疑慮；視覺降權在 v2.17 拿掉，見
     renderFoodRow 旁的長註解）：全部食物／搜尋結果依「加上這一筆還吃得下嗎」排前面。
     判斷基準刻意用 eaten（今日已吃，不含這次 sheet 內勾選中的品項）而不是 combined
     （含勾選中）——如果用 combined，使用者每勾一個東西整批清單就重新排序一次，手指
     還沒點完下一個就跳位，容易誤觸。逐列變色／kc-delta（renderFoodRow 既有邏輯）
     維持用 combined 即時反應，這裡刻意跟那邊不同源，兩者互不干擾。「常吃」清單語意
     是「這餐平常都吃這些」，不重排，所以這裡只算出 overQuotaIds 這個集合供
     renderFoodRow 疊 class（純測試/分組標記），排序另外只在全部食物／搜尋結果套用
     （見下面 byQuotaFit）。 */
  function quotaOverage(f: Food): OverDelta {
    const qty = defaultQty(meal, f.id)
    return rowOverage(eaten, num(f.kcal) * qty, num(f.fat) * qty, num(f.carb) * qty, targets)
  }
  const fitsQuota = (over: OverDelta) => over.kcal === 0 && over.fat === 0 && over.carb === 0

  const sortedFoods = foods ? [...foods].sort(byName) : null
  const overQuotaIds = new Set<number>()
  // 超標品項的 OverDelta 順便存起來給 byQuotaFit 的排序分數用，不必為了 tie-break
  // 對同一筆再呼叫一次 quotaOverage（precommit-review 抓到的重複運算）
  const overAmounts = new Map<number, OverDelta>()
  if (sortedFoods) {
    for (const f of sortedFoods) {
      const over = quotaOverage(f)
      if (!fitsQuota(over)) {
        overQuotaIds.add(f.id)
        overAmounts.set(f.id, over)
      }
    }
  }
  /* 符合的排前面（維持原本 byName 順序，Array.sort 穩定排序）；不符合的排後面，
     按超出總量（kcal ＋ 脂 ＋ 碳，三個單位不同但只拿來排序不顯示，不必為排序
     另外換算成同一單位）由小到大。 */
  function byQuotaFit(list: Food[]): Food[] {
    return [...list].sort((a, b) => {
      const aOver = overQuotaIds.has(a.id) ? 1 : 0
      const bOver = overQuotaIds.has(b.id) ? 1 : 0
      if (aOver !== bOver) return aOver - bOver
      if (aOver === 0) return 0
      const oa = overAmounts.get(a.id)!
      const ob = overAmounts.get(b.id)!
      return (oa.kcal + oa.fat + oa.carb) - (ob.kcal + ob.fat + ob.carb)
    })
  }
  /* 店家 Autocomplete 的選項來源：foods 上的 vendor 字串去重排序，不建專屬資料表——
     去重就是清單，建表要付新表＋外鍵＋遷移＋RLS 的代價卻買不到東西。
     規則本體在 lib（食品庫那邊也要用同一套，v2.29 precommit-review 抓到重複實作）。 */
  const vendorOptions = useMemo(() => vendorOptionsOf(foods), [foods])
  const trimmedQuery = filterQuery.trim()
  const pickedFoods = [...picks.keys()].map(foodById).filter((f): f is Food => !!f)

  const handlers: FoodRowHandlers = {
    picks,
    qtyDrafts,
    onToggle: togglePick,
    onStep: stepQty,
    onQtyInput: handleQtyInput,
    onQtyBlur: handleQtyBlur,
    combined,
    targets,
    defaultQty: (foodId) => defaultQty(meal, foodId),
    overQuotaIds,
  }

  let browseBody: ReactNode = null
  if (sortedFoods === null) {
    browseBody = <p className="muted">載入中…</p>
  } else if (trimmedQuery) {
    const hits = byQuotaFit(sortedFoods.filter((f) => !picks.has(f.id) && foodMatches(f, trimmedQuery)))
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
    const restFoods = byQuotaFit(sortedFoods.filter((f) => !picks.has(f.id) && !recentFoods.includes(f)))
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
      {/* repositionInputs={false}：vaul 自己那套鍵盤補償會直接往 Drawer.Content 寫 inline
          `height`／`bottom`，把 app.css 的 `--kb` 蓋掉（inline 永遠贏）。原委與取捨寫在
          app.css `.sheet` 那段，改這裡之前先讀那段。 */}
      {/* dismissible={!scanBusy}：辨識中鎖住下滑關閉。只擋關閉鈕沒用——vaul 的抽屜手指往下
          一滑就關了，而誤關的代價是那張照片白拍。逾時 15 秒保證最壞情況不會被關太久。 */}
      <Drawer.Root open={open} onOpenChange={(v) => { if (!v) onClose() }} direction="bottom" shouldScaleBackground={false} repositionInputs={false} dismissible={!scanBusy}>
        <Drawer.Portal>
          <Drawer.Overlay className="scrim" />
          <Drawer.Content ref={sheetRef} className="sheet" aria-label={contentAriaLabel} data-screen="log-sheet">
            <Drawer.Handle className="handle" />

            {view === 'list' ? (
              <>
                <div className="chip-bar">
                  {/* 選中態用 aria-pressed，不是 aria-current，容器也不是 tablist
                      （2026-08-05 補；Today.tsx 的餐別分段控制器早一輪就是這樣，那裡的註解
                      已標記這排 chip 有同樣的問題）。這排 chip 選的是「這筆要記到哪一餐」，
                      按下去改的是資料值，不是換頁——aria-current 的規範語意是「目前所在的
                      頁面／步驟／位置」，用在這裡是誤用。
                      **role="tab" 一併拿掉**：tab 角色的選中態屬性是 aria-selected，而完整的
                      APG tablist 契約還要 roving tabindex ＋ 方向鍵導航 ＋ aria-controls 指向
                      tabpanel。半套實作會讓螢幕閱讀器期待方向鍵可用卻沒有，比不做更糟——這是
                      Today.tsx 拒絕升級成 radiogroup 時的同一個判斷。 */}
                  <div className="chiprow" role="group" aria-label="餐別">
                    {MEALS.map((m) => (
                      <button
                        key={m.key}
                        className="chip"
                        type="button"
                        aria-pressed={meal === m.key}
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
                  <div className="pick-bar">
                    {err && (
                      <p className="sheet-error" role="alert">
                        存不進去：{err}
                      </p>
                    )}
                    {/* role="group"：generic 的 <div> 禁止用 aria-label 命名（ARIA naming
                        prohibited），子元素又全部 aria-hidden，沒有 role 這條 aria-label
                        很可能整段被螢幕閱讀器忽略（precommit review 抓到，2026-08-01） */}
                    <div role="group" className="pick-line" aria-label={`${totals.n} 樣，共 ${Math.round(totals.kcal)} 大卡，${right.ariaLabel}`}>
                      <span className="sub" aria-hidden="true">
                        {totals.n} 樣 · {Math.round(totals.kcal)} 卡
                        {right.deltaText && <span className="over-delta"> {right.deltaText}</span>}
                      </span>
                      {right.remainText && (
                        <span className="remain" aria-hidden="true">
                          {right.remainText}
                        </span>
                      )}
                    </div>
                    {/* 蛋白/脂/碳三個誠實數字，判定規則跟今日頁的三大營養素條同一條（DESIGN.md
                        「三大營養素判定」）：脂肪／碳水各自獨立 >100% 轉破表，蛋白質不足不轉紅——
                        不是這裡不判定，是蛋白質那格本來就不該判（DESIGN.md v2.10「底部確認列」條）。
                        role="group"：同上，generic <div> 不能靠 aria-label 命名。 */}
                    {(() => {
                      const fatOver = macroExceeds(combined.fat, targets.fat)
                      const carbOver = macroExceeds(combined.carb, targets.carb)
                      return (
                        <div
                          role="group"
                          className="macro-line"
                          aria-label={`蛋白質 ${roundTo1(combined.protein)} 克，目標 ${Math.round(targets.protein)} 克；脂肪 ${roundTo1(combined.fat)} 克，${fatOver ? '超出目標' : '目標'} ${Math.round(targets.fat)} 克；碳水 ${roundTo1(combined.carb)} 克，${carbOver ? '超出目標' : '目標'} ${Math.round(targets.carb)} 克`}
                        >
                          <span aria-hidden="true">蛋白 {Math.round(combined.protein)}/{Math.round(targets.protein)}</span>
                          <span className={fatOver ? 'over' : undefined} aria-hidden="true">脂 {Math.round(combined.fat)}/{Math.round(targets.fat)}</span>
                          <span className={carbOver ? 'over' : undefined} aria-hidden="true">碳 {Math.round(combined.carb)}/{Math.round(targets.carb)}</span>
                        </div>
                      )
                    })()}
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
                  <button className="icon-btn" type="button" aria-label="關閉" disabled={scanBusy} onClick={onClose}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                <div className="back-row">
                  {/* scanBusy 也要吃：按下去會把 FoodFormFields 整層卸載，而辨識還在跑（元件內另有卸載守衛把
                      晚到的結果丟掉，但讓使用者按得到一顆「按了等於白拍」的鈕本身就是壞體驗）。 */}
                  <button className="back-btn" type="button" disabled={scanBusy} onClick={backToList}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M15 6l-6 6 6 6" />
                    </svg>
                    返回搜尋
                  </button>
                </div>

                <div className="form-wrap">
                  {/* portalContainer 一定要傳 sheetRef：vaul 的 Drawer 開啟時會把 body 設成
                      pointer-events:none，店家下拉的 Portal 掛在預設的 body 下就會看得到、
                      點不到（見元件檔頭與 DESIGN.md「店家欄位」條）。
                      vendorAutoFocus：品名已經是搜尋字串帶進來的，下一個該落焦的是店家。 */}
                  <FoodFormFields
                    form={foodForm}
                    onChange={setFoodForm}
                    idPrefix="f-"
                    vendorOptions={vendorOptions}
                    portalContainer={sheetRef}
                    vendorAutoFocus
                    onScan={scanLabel}
                    onBusyChange={setScanBusy}
                  />
                </div>

                <div className="confirm-wrap">
                  {err && (
                    <p className="sheet-error" role="alert">
                      {err}
                    </p>
                  )}
                  <button className="pick-bar-btn" type="button" disabled={busy || scanBusy} onClick={() => void submitFoodForm()}>
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
