/* 記一筆 sheet：SpringSheet 承載（全站精緻度 B1b，原為 vaul Drawer），清單多選／搜尋／份量 stepper／新增食物／確認列。
   行為與視覺依 DESIGN.md 元件規則表（2026-07-31 起是唯一真相來源），
   計算全部交給 src/lib 不重新推導。

   vanilla 版的兩個坑（sheet 整塊重繪咬 click、注音組字被打斷）源自 renderSheet() 用
   innerHTML 整塊換掉 DOM——React keyed 渲染天然不會這樣做（同一顆按鈕、同一個 input
   在 re-render 之間是同一個 DOM 節點，不會被拔掉重建），所以這裡不需要
   「清單走增量、搜尋框不動」的特殊處理，直接用一般的 controlled component 寫法即可。 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent, type ReactNode } from 'react'
import CategoryIcon, { CategoryStack } from '@/components/CategoryIcon'
import FoodFormFields from '@/components/FoodFormFields'
import QtyStepper from '@/components/QtyStepper'
import SpringSheet, { SheetGrabZone } from '@/components/SpringSheet'
import {
  estimateMeal,
  listRecentIntake,
  scanLabel,
  type Food,
  type NewIntake,
} from '@/lib/api'
import {
  draftFromKcal,
  draftFromTier,
  draftsFromItems,
  draftsToIntake,
  draftName,
  draftToFood,
  estimateTextOk,
  estimateTotals,
  settleKcal,
  withKcalInput,
  type EstimateDraft,
} from '@/lib/estimate'
import EstimateView, { type EstimateStatus } from './EstimateView'
import { isPlannable } from '@/lib/dates'
import { errMsg, friendlyError } from '@/lib/errors'
import { BLANK_FOOD_FORM, byFoodName, foodMatches, validateFoodForm, vendorOptionsOf, type FoodForm } from '@/lib/foodForm'
import { categoryOf } from '@/lib/categories'
import { byQuotaFit, defaultQty, groupByCategory, overQuotaAmounts, pickTotals, recentStats, type FoodGroup } from '@/lib/foodPicks'
import { formatOverAria, formatOverDelta, macroExceeds, num, pickBarRight, roundTo1, rowOverage, sumIntake, type IntakeTotals, type OverDelta, type Targets } from '@/lib/formulas'
import { mergeByFood, seenText, type RepeatItem, type SeenMark } from '@/lib/mealSuggest'
import { MEALS, mealLabel, type MealKey } from '@/lib/meals'
import { normalizeQty, parseTypedQty } from '@/lib/quantity'
import type { LogSheetProps } from './types'


type View = 'list' | 'food-form' | 'estimate'

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
  /* 軟性排序（v2.15，視覺降權在 v2.17 拿掉）：不符合今日剩餘額度的品項 → 超標量，
     判斷基準是「今日已吃」（eaten），不含這次 sheet 內勾選中的品項——刻意
     跟上面 combined（用來算逐列變色與 kc-delta）不同源，見 lib/foodPicks.ts 的軟性排序註解。
     `.over-quota` class 現在**只當排序分組與 e2e 測試用的語意標記，不掛任何樣式**
     （見 app.css 同名 class 旁的註解）——不是死碼，刪掉會讓排序分組與既有測試斷言
     一起失效。 */
  overAmounts: Map<number, OverDelta>
}

/* 一般函式、不是元件——用 fn(f) 呼叫而非 <Fn/>，React 才不會把它當成每次 render
   都換了身分的新元件型別重新掛載（那樣份量輸入框每打一個字就會失焦）。 */
function renderFoodRow(f: Food, picked: boolean, h: FoodRowHandlers, withIcon = false) {
  const qty = h.picks.get(f.id) ?? 1
  const draft = h.qtyDrafts.get(f.id) ?? String(qty)
  const overQuota = !picked && h.overAmounts.has(f.id)
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
            <QtyStepper
              qty={qty}
              draft={draft}
              name={f.name}
              onStep={(dir) => h.onStep(f.id, dir)}
              onInput={(raw) => h.onQtyInput(f.id, raw)}
              onBlur={(raw) => h.onQtyBlur(f.id, raw)}
            />
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
                {withIcon && <CategoryIcon category={categoryOf(f.category)} size={24} decorative />}
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

/* 建議品項顯示、確認列、寫入一律用來源列的快照，不是食品庫現值：兩個入口的數字才會一樣。 */
function suggestedFood(item: RepeatItem): Food {
  return {
    id: item.food_id,
    name: item.label,
    vendor: item.vendor,
    kcal: item.kcal,
    protein: item.protein,
    fat: item.fat,
    carb: item.carb,
    archived: item.archived,
    category: item.category,
    // 只給 sheet 顯示與寫入用，不會寫回食品庫；手動與否這裡不知道也用不到
    category_manual: false,
  }
}

/* 類型組標：圖示＋組名＋（吃過提示，或這一餐吃過幾次）。圖示是裝飾，組名已經是同一句話。 */
function renderGroup(g: FoodGroup, seen: SeenMark | undefined, rows: (f: Food) => ReactNode) {
  const name = g.category ?? '未分類'
  return (
    <div key={name} className="grp">
      <h3 className="grp-head">
        <CategoryIcon category={g.category} size={32} badge={seen && (seen.when === 'yesterday' ? 'yesterday' : 'today')} decorative />
        <span className="gn">{name}</span>
        {seen ? <span className="seen">{seenText(seen)}</span> : g.count > 0 && <span className="cnt"><span className="sr-only">這一餐吃過 </span><span className="num">{g.count}</span> 次</span>}
      </h3>
      <ul className="food-list">{g.foods.map(rows)}</ul>
    </div>
  )
}

export default function LogSheet(props: LogSheetProps) {
  const { open, meal: initialMeal, foods, dayData, targets, repeatByMeal, seenByMeal, onClose, onCreateIntake, onCreateFood, onCreateEstimateFood } = props

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
  /* 店家 Autocomplete 的 Portal 指到 sheet 自己（SpringSheet 交出的 popup 節點）。vaul 時代這是必須的
     （Radix Dialog 把 body 設成 pointer-events:none，掛在 body 的選單點不到，見 DESIGN.md「店家欄位」
     條）；Base UI 的 Dialog 不做那件事，但留著也無害——選單仍是 sheet 的子孫，stacking 跟著 sheet。
     同時當 `initialFocus`：開啟時焦點落在 sheet 容器上（與 vaul 版「聚焦容器」一致，不是第一顆 chip）。 */
  const sheetRef = useRef<HTMLDivElement | null>(null)

  /* 「常吃」＝該餐別歷史出現次數，順便記住每樣最近一次的份量——LogSheetProps 只給當天
     dayData，這份跨日期的歷史不在 props 契約裡，這裡直接讀
     lib/api 既有的 listRecentIntake（唯讀查詢，不改動 App 的資料流／不寫其他檔案）。
     撈不到就靜靜略過「常吃」分段，不擋清單其他功能可用。 */
  const [recent, setRecent] = useState<Map<MealKey, number[]> | null>(null)
  const [lastQty, setLastQty] = useState<Map<string, number>>(new Map())
  const [mealCounts, setMealCounts] = useState<Map<MealKey, Map<number, number>>>(new Map())
  /** 「其他餐的」收合列展開了沒；每次打開 sheet 都收回去。 */
  const [elsewhereOpen, setElsewhereOpen] = useState(false)
  const recentFetchedRef = useRef(false)

  /* 從建議段勾起來的品項留一份快照：封存的食物 foods 查不到，切餐別後建議段也換了，
     沒有這份就會從已選、小計、寫入靜默消失。取消勾選就清掉。 */
  const [suggestSnaps, setSuggestSnaps] = useState<Map<number, { food: Food; name: string | null }>>(new Map())
  const pickedListRef = useRef<HTMLUListElement | null>(null)
  const focusPickedRef = useRef(false)

  const foodById = (id: number): Food | undefined => suggestSnaps.get(id)?.food ?? foods.find((f) => f.id === id)

  /* 「估一筆」（spec A 2026-11-13 版）：草稿跟著 sheet 走，回清單再進來還在；關掉 sheet 才清。
     estReqRef：每次送出遞增，晚到的舊回應（已經重送或關掉了）一律丟掉。 */
  const [estText, setEstText] = useState('')
  const [estStatus, setEstStatus] = useState<EstimateStatus>('idle')
  const [estStartedAt, setEstStartedAt] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<EstimateDraft[]>([])
  const [revealSeq, setRevealSeq] = useState(0)
  const estReqRef = useRef(0)
  const estTitleRef = useRef<HTMLSpanElement | null>(null)
  /** 這次進估一筆是不是帶了句子（搜尋列帶字進來）：是才把焦點放描述框，回來改草稿不叫出鍵盤。 */
  const focusTextRef = useRef(false)

  /* 進「估一筆」時點下去的那顆鈕已經卸載，焦點會掉到 body（review N4）：帶了句子就放描述框（下一步就是送出），
     否則放標題，讓讀屏從頭念、也不會一進來就叫出鍵盤蓋住檔位。 */
  useEffect(() => {
    if (view !== 'estimate') return
    if (focusTextRef.current) document.getElementById('est-text')?.focus()
    else estTitleRef.current?.focus()
    // 只在切進來那一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  /* 開啟時重置整個 sheet 的本地狀態：每次打開都是一份新的 */
  useEffect(() => {
    if (!open) return
    setMeal(initialMeal)
    setView('list')
    setPicks(new Map())
    setQtyDrafts(new Map())
    setSuggestSnaps(new Map())
    setQuery('')
    setFilterQuery('')
    setBusy(false)
    setErr(null)
    setFoodForm(BLANK_FOOD_FORM)
    setElsewhereOpen(false)
    estReqRef.current++
    setEstText('')
    setEstStatus('idle')
    setEstStartedAt(null)
    setDrafts([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* 「全選」那顆鈕會隨建議段一起消失，焦點要接到已選段，否則鍵盤使用者原地迷路。 */
  useEffect(() => {
    if (!focusPickedRef.current) return
    focusPickedRef.current = false
    pickedListRef.current?.querySelector('button')?.focus()
  }, [picks])

  useEffect(() => {
    if (!open || recentFetchedRef.current) return
    recentFetchedRef.current = true
    void (async () => {
      try {
        const stats = recentStats(await listRecentIntake())
        setLastQty(stats.lastQty)
        setRecent(stats.recent)
        setMealCounts(stats.counts)
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
        setSuggestSnaps((s) => {
          const ns = new Map(s)
          ns.delete(id)
          return ns
        })
      } else {
        const q = defaultQty(lastQty, meal, id)
        next.set(id, q)
        setQtyDrafts((d) => new Map(d).set(id, String(q)))
      }
      return next
    })
  }

  function pickSuggested(item: RepeatItem) {
    setErr(null)
    setPicks((prev) => new Map(prev).set(item.food_id, item.qty))
    setQtyDrafts((prev) => new Map(prev).set(item.food_id, String(item.qty)))
    setSuggestSnaps((prev) => new Map(prev).set(item.food_id, { food: suggestedFood(item), name: item.name }))
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
    const n = parseTypedQty(raw)
    if (n !== null) setPicks((prev) => new Map(prev).set(id, n))
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

  /* 有草稿已經建好食物＝上一次加入失敗、等重試：錯誤與「重試」要留著（DESIGN「寫入失敗（記一筆）」）。 */
  const pendingRetry = drafts.some((d) => d.foodId !== null)

  function backToList() {
    setView('list')
    if (!pendingRetry) setErr(null)
  }

  function openEstimate(prefill: string) {
    // 估算進行中不換句子：回來的結果屬於原本那句（review N14）
    if (prefill && estStatus !== 'busy') setEstText(prefill)
    focusTextRef.current = !!prefill
    if (estStatus === 'error') setEstStatus('idle')
    if (!pendingRetry) setErr(null)
    setView('estimate')
  }

  async function submitEstimate() {
    if (!meal || !estimateTextOk(estText) || estStatus === 'busy') return
    const id = ++estReqRef.current
    setEstStatus('busy')
    setEstStartedAt(Date.now())
    setErr(null)
    try {
      const items = await estimateMeal(estText)
      if (id !== estReqRef.current) return
      /* 新的估算取代上一次 AI 的草稿（重估同一句不該疊成兩份）；檔位與自己打的那幾列留著。 */
      setDrafts((prev) => [...prev.filter((d) => d.kcalOnly || d.foodId !== null), ...draftsFromItems(items)])
      setRevealSeq((n) => n + 1)
      setEstStatus('idle')
    } catch {
      if (id !== estReqRef.current) return
      setEstStatus('error')
    }
  }

  const patchDraft = (key: string, fn: (d: EstimateDraft) => EstimateDraft) => setDrafts((prev) => prev.map((d) => (d.key === key ? fn(d) : d)))

  /* 「加入」：清單勾的食物＋估一筆帶回來的草稿一次寫入（使用者 2026-11-13：估一筆的結果帶回 sheet 打勾，一起加入）。
     草稿要先建 foods（沒勾存進食品庫就建立即封存）、記下 id，再跟勾的食物一起寫 intake。
     中途失敗按重試：已經有 id 的草稿不再建一次，不會在食品庫留下重複的列。估算還在跑時不能加入（結果回來會換掉草稿）。 */
  async function submitPicks() {
    if ((picks.size === 0 && drafts.length === 0) || busy || !meal || estStatus === 'busy') return
    setBusy(true)
    setErr(null)
    const rows: NewIntake[] = []
    for (const [id, qty] of picks) {
      const f = foodById(id)
      if (!f) continue
      rows.push({ eaten_on: dayData.date, meal, food_id: id, qty, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb, name: suggestSnaps.get(id)?.name ?? null })
    }
    try {
      const done: EstimateDraft[] = []
      for (const d of drafts) {
        if (d.foodId !== null) {
          done.push(d)
          continue
        }
        const created = await onCreateEstimateFood(draftToFood(d, meal), d.keep)
        // 品名跟著定下來：之後換了餐別，已建的食物仍是這個名字，草稿也不能再跟著變（re-review M1）
        const withId = { ...d, name: created.name, foodId: created.id }
        done.push(withId)
        patchDraft(d.key, () => withId)
      }
      await onCreateIntake([...rows, ...draftsToIntake(done, meal, dayData.date)])
      /* 成功後 App 會把 open 翻成 false，交給 SpringSheet 播退場 spring；不在這裡手動 setBusy(false)——
         下次開啟時 open 的 reset effect 會處理 */
    } catch (e) {
      setBusy(false)
      setErr(friendlyError(errMsg(e)))
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
         真正記進 intake 仍要按「加入」，兩件事分開才不會以為記完就關掉 app */
      setPicks((prev) => new Map(prev).set(created.id, 1))
      setQtyDrafts((prev) => new Map(prev).set(created.id, '1'))
      setView('list')
      setQuery('')
      setFilterQuery('')
      setBusy(false)
    } catch (e) {
      setBusy(false)
      setErr(friendlyError(errMsg(e)))
    }
  }

  /* v2.47：**不是 `=== localDate()`**。這裡問的是「這天還能不能改變結果」，明天也算——
     確認列要顯示「剩 N／(+N)」而不是「共 N」，那正是「先排明天、看會不會超過」的落點。
     判斷收在 dates.ts 共用，不在這裡再維護一份（第一版就是各維護一份才漏改）。 */
  const plannable = isPlannable(dayData.date)
  const eaten = sumIntake(dayData.rows ?? [])
  const totals = pickTotals(picks, foodById)
  const addOn = (t: IntakeTotals): IntakeTotals => ({
    kcal: eaten.kcal + t.kcal,
    protein: eaten.protein + t.protein,
    fat: eaten.fat + t.fat,
    carb: eaten.carb + t.carb,
  })
  const estTotals = estimateTotals(drafts)
  /* 確認列與逐筆超標預警看的是「勾的＋估一筆帶回來的」合起來 */
  const allTotals = {
    n: totals.n + estTotals.n,
    kcal: totals.kcal + estTotals.kcal,
    protein: totals.protein + estTotals.protein,
    fat: totals.fat + estTotals.fat,
    carb: totals.carb + estTotals.carb,
  }
  const combined: IntakeTotals = addOn(allTotals)

  /* 底部確認列。清單的勾選與「估一筆」的草稿共用：小計、剩餘、三大營養素（＋這次）、加入鈕與失敗重試都同一套規則。 */
  function renderPickBar(t: IntakeTotals & { n: number }, onSubmit: () => void, blocked = false) {
    const right = pickBarRight(plannable, eaten.kcal, targets.kcal, t.kcal)
    const all = addOn(t)
    const fatOver = macroExceeds(all.fat, targets.fat)
    const carbOver = macroExceeds(all.carb, targets.carb)
    return (
      <div className="pick-bar">
        {err && (
          <p className="sheet-error" role="alert">
            存不進去：{err}
          </p>
        )}
        {/* role="group"：generic 的 <div> 禁止用 aria-label 命名（ARIA naming
            prohibited），子元素又全部 aria-hidden，沒有 role 這條 aria-label
            很可能整段被螢幕閱讀器忽略（precommit review 抓到，2026-08-01） */}
        <div role="group" className="pick-line" aria-label={`${t.n} 樣，共 ${Math.round(t.kcal)} 大卡，${right.ariaLabel}`}>
          <span className="sub" aria-hidden="true">
            {t.n} 樣 · {Math.round(t.kcal)} 卡
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
        <div
          role="group"
          className="macro-line"
          aria-label={`蛋白質 ${roundTo1(all.protein)} 克，目標 ${Math.round(targets.protein)} 克，這次加 ${roundTo1(t.protein)} 克；脂肪 ${roundTo1(all.fat)} 克，${fatOver ? '已超出，目標' : '目標'} ${Math.round(targets.fat)} 克，這次加 ${roundTo1(t.fat)} 克；碳水 ${roundTo1(all.carb)} 克，${carbOver ? '已超出，目標' : '目標'} ${Math.round(targets.carb)} 克，這次加 ${roundTo1(t.carb)} 克`}
        >
          <span aria-hidden="true">
            蛋白 {Math.round(all.protein)}/{Math.round(targets.protein)}
            <span className="add">(+{Math.round(t.protein)})</span>
          </span>
          <span className={fatOver ? 'over' : undefined} aria-hidden="true">
            脂 {Math.round(all.fat)}/{Math.round(targets.fat)}
            <span className="add">(+{Math.round(t.fat)})</span>
          </span>
          <span className={carbOver ? 'over' : undefined} aria-hidden="true">
            碳 {Math.round(all.carb)}/{Math.round(targets.carb)}
            <span className="add">(+{Math.round(t.carb)})</span>
          </span>
        </div>
        <button className="pick-bar-btn" type="button" disabled={busy || blocked} onClick={onSubmit}>
          {busy ? '加入中…' : err ? '重試' : '加入'}
        </button>
      </div>
    )
  }

  /* 軟性排序的判定與理由見 lib/foodPicks.ts：全部食物／搜尋結果依「加上這一筆還吃得下嗎」
     排前面，基準是 eaten 不是 combined。「常吃」清單不重排，所以只在全部食物／搜尋結果套用 byQuotaFit。 */
  const sortedFoods = [...foods].sort(byFoodName)
  const overAmounts = overQuotaAmounts(sortedFoods, (f) => defaultQty(lastQty, meal, f.id), eaten, targets)
  /* 店家 Autocomplete 的選項來源：foods 上的 vendor 字串去重排序，不建專屬資料表——
     去重就是清單，建表要付新表＋外鍵＋遷移＋RLS 的代價卻買不到東西。
     規則本體在 lib（食品庫那邊也要用同一套，v2.29 precommit-review 抓到重複實作）。 */
  const vendorOptions = useMemo(() => vendorOptionsOf(foods), [foods])
  const catById = useMemo(() => new Map(foods.map((f) => [f.id, categoryOf(f.category)])), [foods])
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
    defaultQty: (foodId) => defaultQty(lastQty, meal, foodId),
    overAmounts,
  }

  let browseBody: ReactNode = null
  if (trimmedQuery) {
    const hits = byQuotaFit(sortedFoods.filter((f) => !picks.has(f.id) && foodMatches(f, trimmedQuery)), overAmounts)
    browseBody = (
      <>
        <div className="sect-lb">搜尋結果</div>
        {hits.length === 0 && <p className="search-empty-msg">找不到「{trimmedQuery}」</p>}
        <ul className="food-list">
          {hits.map((f) => renderFoodRow(f, false, handlers))}
          {meal && (
            <li>
              <button className="est-row" type="button" onClick={() => openEstimate(trimmedQuery)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4z" />
                  <path d="M13.5 7.5l3 3" />
                </svg>
                <span className="txt">估一筆「{trimmedQuery}」</span>
              </button>
            </li>
          )}
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
    /* 建議段：該餐已有紀錄或沒有來源時 repeatByMeal 就沒有這一餐。沒有「已選用」狀態：勾了進已選、
       取消回來，全靠這裡每次重算。同一食物不同時出現在建議與常吃／全部，所以兩段都要先濾再取。 */
    const suggestion = meal ? repeatByMeal[meal] : undefined
    const suggestItems = suggestion ? mergeByFood(suggestion.items).filter((i) => !picks.has(i.food_id)) : []
    const suggestIds = new Set(suggestItems.map((i) => i.food_id))
    /* 預覽（逐筆超標）與勾下去的份量同源，都是建議量，不是「該餐上次的份量」。 */
    const suggestHandlers: FoodRowHandlers = {
      ...handlers,
      onToggle: (id) => {
        const item = suggestItems.find((i) => i.food_id === id)
        if (item) pickSuggested(item)
      },
      defaultQty: (id) => suggestItems.find((i) => i.food_id === id)?.qty ?? 1,
    }
    const recentIds = (meal ? recent?.get(meal) : undefined) ?? []
    const recentFoods = recentIds
      .filter((id) => !picks.has(id) && !suggestIds.has(id))
      .map(foodById)
      .filter((f): f is Food => !!f)
      .slice(0, 5)
    const restFoods = byQuotaFit(sortedFoods.filter((f) => !picks.has(f.id) && !suggestIds.has(f.id) && !recentFoods.includes(f)), overAmounts)
    /* 依類型分組：組序看這一餐吃過幾次（常吃那份歷史），組內沿用軟性排序；只在其他餐吃過的類型收在最底。
       次數要用整個食品庫查類型，不能只看 restFoods——已勾、常吃那幾樣也是這一類吃過的次數。 */
    const grouped = groupByCategory(restFoods, meal, mealCounts, (id) => catById.get(id))
    const seen = meal ? seenByMeal[meal] : undefined
    const seenOf = (g: FoodGroup) => (g.category ? seen?.get(g.category) : undefined)
    const row = (f: Food) => renderFoodRow(f, false, handlers)
    const elsewhereNames = grouped.elsewhere.map((g) => g.category ?? '未分類')
    browseBody = (
      <>
        {suggestItems.length > 0 && (
          <>
            <div className="sect-lb sect-suggest">
              <span>建議</span>
              <button
                className="sect-act"
                type="button"
                aria-label={`全選建議的 ${suggestItems.length} 樣`}
                onClick={() => {
                  focusPickedRef.current = true
                  suggestItems.forEach(pickSuggested)
                }}
              >
                全選
              </button>
            </div>
            <ul className="food-list">{suggestItems.map((i) => renderFoodRow(suggestedFood(i), false, suggestHandlers, true))}</ul>
          </>
        )}
        {recentFoods.length > 0 && (
          <>
            <div className="sect-lb">{meal ? mealLabel(meal) : ''}常吃</div>
            <ul className="food-list">{recentFoods.map((f) => renderFoodRow(f, false, handlers))}</ul>
          </>
        )}
        {restFoods.length > 0 && (
          <>
            <div className="sect-lb">全部食物</div>
            <div className="food-groups">
              {grouped.main.map((g) => renderGroup(g, seenOf(g), row))}
              {grouped.elsewhere.length > 0 && (
                <button
                  className="grp-more"
                  type="button"
                  aria-expanded={elsewhereOpen}
                  onClick={() => setElsewhereOpen((v) => !v)}
                >
                  <CategoryStack categories={grouped.elsewhere.slice(0, 3).map((g) => g.category)} />
                  <span className="what">其他餐的（{elsewhereNames.join('、')}）</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
              {elsewhereOpen && grouped.elsewhere.map((g) => renderGroup(g, seenOf(g), row))}
            </div>
          </>
        )}
        {suggestItems.length === 0 && recentFoods.length === 0 && restFoods.length === 0 && (
          <p className="muted">食品庫還是空的。在上面搜尋框輸入品名就能新增第一筆。</p>
        )}
      </>
    )
  }

  const contentAriaLabel = view === 'list' ? (meal ? mealLabel(meal) : '記一筆') : view === 'estimate' ? `估一筆，${meal ? mealLabel(meal) : ''}` : '新增食物'

  /* 辨識中鎖住關閉。只擋關閉鈕沒用——下滑、Escape、點 scrim 都會關，
     而誤關的代價是那張照片白拍。辨識逾時（函式端 45 秒）保證最壞情況不會被關太久。
     寫入中也鎖：關掉再按今日頁卡片的「加入」，同餐就兩份；失敗時已選與錯誤也才有地方留著。不會永遠鎖住：請求有 DB_TIMEOUT，但 token 過期又連不上時要先等 refresh 退避，最壞約 26 秒。 */
  return (
    <SpringSheet open={open} onClose={onClose} label={contentAriaLabel} screen="log-sheet" initialFocus={sheetRef} popupRef={sheetRef} locked={scanBusy || busy}>
      {view === 'list' ? (
        <>
          <SheetGrabZone className="chip-bar">
            {/* 選中態用 aria-pressed，不是 aria-current，容器也不是 tablist
                （2026-08-05 補；Today.tsx 的餐別分段控制器早一輪就是這樣，那裡的註解
                已標記這排 chip 有同樣的問題）。這排 chip 選的是「這筆要記到哪一餐」，
                按下去改的是資料值，不是換頁——aria-current 的規範語意是「目前所在的
                頁面／步驟／位置」，用在這裡是誤用。
                **role="tab" 一併拿掉**：tab 角色的選中態屬性是 aria-selected，而完整的
                APG tablist 契約還要 roving tabindex ＋ 方向鍵導航 ＋ aria-controls 指向
                tabpanel。半套實作會讓螢幕閱讀器期待方向鍵可用卻沒有，比不做更糟——這是
                ItemEditor.tsx 拒絕升級成 radiogroup 時的同一個判斷。 */}
            <div className="chiprow" role="group" aria-label="餐別">
              {MEALS.map((m) => (
                <button
                  key={m.key}
                  className="chip"
                  type="button"
                  aria-pressed={meal === m.key}
                  onClick={() => {
                    setMeal(m.key)
                    // 換餐別，「其他餐的」收的是另一批類型，收回去
                    setElsewhereOpen(false)
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <button className="icon-btn" type="button" aria-label="關閉" disabled={busy} onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </SheetGrabZone>

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

          {/* key 分開：清單與估一筆的捲動區不能被 React 當成同一個 DOM 重用，否則帶回清單時停在估一筆捲到的位置 */}
          <div className="food-scroll" key="list-scroll">
            {!trimmedQuery && meal && (
              <button className="est-entry" type="button" disabled={busy} onClick={() => openEstimate('')}>
                <span className="est-entry-ic" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4z" />
                    <path d="M13.5 7.5l3 3" />
                  </svg>
                </span>
                <span className="est-entry-tx">
                  <b>估一筆</b>
                  <small>食品庫沒有的，描述一下或選最接近的一種</small>
                </span>
                <svg className="est-entry-chev" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            )}
            {(picks.size > 0 || drafts.length > 0) && (
              <>
                <div className="sect-lb">已選</div>
                <ul className="food-list" ref={pickedListRef}>
                  {pickedFoods.map((f) => renderFoodRow(f, true, handlers))}
                  {/* 估一筆帶回來的草稿：跟勾的食物排在一起；點了回估一筆改（熱量、品名、刪掉都在那裡） */}
                  {meal &&
                    drafts.map((d) => (
                      <li key={d.key}>
                        <div className="food-item selected">
                          <button
                            className="food-row est-picked"
                            type="button"
                            aria-label={`${draftName(d, meal)}，估一筆，${d.kcal} 大卡，點了回估一筆修改`}
                            disabled={busy}
                            onClick={() => openEstimate('')}
                          >
                            <svg className="chk" viewBox="0 0 22 22" aria-hidden="true">
                              <circle cx="11" cy="11" r="9" />
                              <path d="M7 11.5l2.5 2.5L15 8.5" />
                            </svg>
                            <div className="nm-wrap" aria-hidden="true">
                              <span className="nm">{draftName(d, meal)}</span>
                              <span className="sub">{d.kcalOnly ? '估一筆・只估了熱量' : '估一筆'}</span>
                            </div>
                            <div className="kc-wrap" aria-hidden="true">
                              <span className="kc">{d.kcal}</span>
                            </div>
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              </>
            )}
            {browseBody}
          </div>

          {(picks.size > 0 || drafts.length > 0) && renderPickBar(allTotals, () => void submitPicks(), estStatus === 'busy')}
        </>
      ) : view === 'estimate' ? (
        <>
          <SheetGrabZone className="sheet-head">
            <span className="sheet-title" tabIndex={-1} ref={estTitleRef}>估一筆</span>
            <button className="icon-btn" type="button" aria-label="關閉" disabled={busy} onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </SheetGrabZone>
          <div className="back-row">
            <button className="back-btn" type="button" disabled={busy || estStatus === 'busy'} aria-label={`返回${meal ? mealLabel(meal) : ''}清單`} onClick={backToList}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
              {meal ? mealLabel(meal) : '返回'}
            </button>
          </div>
          <div className="food-scroll" key="est-scroll">
            <EstimateView
              meal={meal ?? 'dinner'}
              text={estText}
              onText={setEstText}
              canSubmit={estimateTextOk(estText)}
              status={estStatus}
              startedAt={estStartedAt}
              onSubmit={() => void submitEstimate()}
              drafts={drafts}
              revealSeq={revealSeq}
              onTier={(k) => setDrafts((prev) => [...prev, draftFromTier(k)])}
              onOwnKcal={(k) => setDrafts((prev) => [...prev, draftFromKcal(k)])}
              onKcalInput={(key, raw) => patchDraft(key, (d) => (d.foodId === null ? withKcalInput(d, raw) : d))}
              onKcalBlur={(key) => patchDraft(key, settleKcal)}
              onName={(key, v) => patchDraft(key, (d) => (d.foodId === null ? { ...d, name: v } : d))}
              onDelete={(key) => setDrafts((prev) => prev.filter((d) => d.key !== key || d.foodId !== null))}
              onToggleKeep={(key) => patchDraft(key, (d) => (d.foodId === null ? { ...d, keep: !d.keep } : d))}
              locked={busy}
            />
          </div>
          {drafts.length > 0 && (
            <div className="pick-bar">
              <button className="pick-bar-btn" type="button" disabled={busy || estStatus === 'busy'} onClick={backToList}>
                帶回清單（{estTotals.n} 樣 · {Math.round(estTotals.kcal)} 卡）
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <SheetGrabZone className="sheet-head">
            <span className="sheet-title">新增食物</span>
            <button className="icon-btn" type="button" aria-label="關閉" disabled={scanBusy || busy} onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </SheetGrabZone>
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
            {/* portalContainer 傳 sheetRef：選單掛在 sheet 裡、stacking 跟著 sheet（vaul 時代是
                必須的——body 被設成 pointer-events:none，見元件檔頭與 DESIGN.md「店家欄位」條）。
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
    </SpringSheet>
  )
}
