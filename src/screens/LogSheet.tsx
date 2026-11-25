/* 記一筆 sheet（spec「記一筆重做：兩個情境」第一段「主畫面重排」，v2.167，樣張 `_design-sample/logsheet-c3/c4/c5.html`、`learn-stories.html`）。
   由上而下：餐別膠囊＋✕ → 框「找食物：打品名或店家」（只是搜尋）→ 工具列（食品庫／只記熱量）→ 這一餐＋搭配卡 →
   框空著＝{餐別}常吃（第一列整組「上次{餐別}」）；框裡有字＝搜尋結果（一張清單，最下面永遠有「用 AI 估」）→ 底部確認列。
   另兩個 view：食品庫頁（LogLibrary）、新增食物表單。整張只有兩種列：這一餐的列（MealSection）與找東西的列（FindRow）。
   計算全在 src/lib（logFind、logMeal、estimate、portionMods），這裡只接線。 */
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react'
import FoodFormFields from '@/components/FoodFormFields'
import SpringSheet, { SheetGrabZone } from '@/components/SpringSheet'
import { estimateFix, estimateMeal, listRecentIntake, scanLabel, type Food, type NewIntake, type RecentIntakeRow } from '@/lib/api'
import { isPlannable, localDate, shiftDate, weekdayDate } from '@/lib/dates'
import {
  applyFix,
  draftFromKcal,
  draftFromTier,
  draftName,
  ESTIMATE_TEXT_MAX,
  fixRequestItem,
  fixTag,
  fixTextOk,
  canFix,
  parseKcal,
  resolveAfterAi,
  settleKcal,
  TIERS,
  withKcalInput,
  type TierKey,
} from '@/lib/estimate'
import { errMsg, friendlyError } from '@/lib/errors'
import { BLANK_FOOD_FORM, byFoodName, validateFoodForm, vendorOptionsOf, type FoodForm } from '@/lib/foodForm'
import { duplicateCheck, foodLabel, recencyRank } from '@/lib/foodMatch'
import { byQuotaFit, overQuotaAmounts } from '@/lib/foodPicks'
import { formatOverAria, formatOverDelta, macroExceeds, pickBarRight, roundTo1, rowOverage, sumIntake, type IntakeTotals } from '@/lib/formulas'
import { knownStores, lastSeenText, matchText, mergeResults, nameHistory, parseBox, searchFoods, storeHistory, type BoxQuery } from '@/lib/logFind'
import {
  aiLibItem,
  aliasUpdates,
  draftIntake,
  foundItem,
  frequentRows,
  itemTotals,
  lastCombo,
  lastRecords,
  libIntake,
  libItem,
  newItemId,
  pairCandidates,
  perServing,
  pickKey,
  savePlan,
  unsettled,
  wantsPair,
  type DraftItem,
  type EstItem,
  type LibItem,
  type MealFood,
  type MealItem,
  type RecordRow,
} from '@/lib/logMeal'
import { MEALS, mealLabel, type MealKey } from '@/lib/meals'
import { normalizeMods, summaryOf } from '@/lib/portionMods'
import { normalizeQty, parseTypedQty } from '@/lib/quantity'
import FindRow from './FindRow'
import LogLibrary from './LogLibrary'
import MealSection, { type FixState } from './MealSection'
import type { LogSheetProps } from './types'

type View = 'main' | 'library' | 'food-form'

const FIX_IDLE: FixState = { open: false, text: '', status: 'idle' }
/** 記一筆看的紀錄回看天數（spec：常吃、搭配卡都是「近 60 天」）。 */
const HISTORY_DAYS = 60

const BOX_LABEL = '找食物'

export default function LogSheet(props: LogSheetProps) {
  const { open, meal: initialMeal, foods, dayData, targets, onClose, onCreateIntake, onCreateFood, onCreateEstimateFood, onUpdateFood } = props

  const [meal, setMeal] = useState<MealKey | null>(initialMeal)
  const [view, setView] = useState<View>('main')
  /** 框裡的字（受控，一直等於畫面上的）；filterQuery 才拿去找——注音組字中不找，組字結束那一刻才補上。 */
  const [query, setQuery] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const composingRef = useRef(false)
  const [items, setItems] = useState<MealItem[]>([])
  /** 這一餐展開的那一列（一次只開一列）。 */
  const [openId, setOpenId] = useState<string | null>(null)
  const [modsClosed, setModsClosed] = useState<Set<string>>(new Set())
  const [kcalOpen, setKcalOpen] = useState(false)
  const [ownKcal, setOwnKcal] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [foodForm, setFoodForm] = useState<FoodForm>(BLANK_FOOD_FORM)
  /** 辨識中鎖住關閉（關閉鈕＋下滑）——誤關的代價是那張照片白拍。 */
  const [scanBusy, setScanBusy] = useState(false)
  /** 近 60 天的紀錄（由新到舊）：常吃、整組、你在那家記過的、搭配卡、同名挑最近記過的都看它。撈不到就是空的，那幾段不出、搜尋照常。 */
  const [hist, setHist] = useState<RecentIntakeRow[]>([])
  const [fixes, setFixes] = useState<Record<string, FixState>>({})
  const fixBusy = Object.values(fixes).some((f) => f.status === 'busy')
  /** 剛估好回來的列：播浮現，播完清掉。 */
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  /** 「這一餐」的讀屏播報 */
  const [said, setSaid] = useState('')
  /** 這次進食品庫頁加的（回到主畫面時底部鈕寫「加 N 樣」）。 */
  const [libKeys, setLibKeys] = useState<Set<string>>(new Set())
  /** 框下「在 {店} 買 ✕」按掉的店名：這次整串都當品名（「大杯 拿鐵」的大杯不是店）。清框、送去估、重開時歸零。 */
  const [notStore, setNotStore] = useState<string | null>(null)
  /* 店家 Autocomplete 的 Portal 指到 sheet 自己（SpringSheet 交出的 popup 節點）；同時當 initialFocus：開啟時焦點落在 sheet 容器上。 */
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLInputElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** 捲回頂端：送去估、打開只記熱量時，剛多出來的東西在捲動區最上面（框清空後清單從搜尋結果換回常吃，捲動位置會停在半路） */
  const toTop = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }
  /** 每次打開 sheet 遞增，關掉之後才回來的估算一律丟掉。 */
  const estReqRef = useRef(0)
  /** await 回來時看「現在」的這一餐（閉包裡的是送出那一刻的）。 */
  const liveRef = useRef<MealItem[]>([])
  /** 拿掉一列之後焦點接到哪：下一列的 data-key；空字串＝沒有下一列，回框裡。 */
  const focusNextRef = useRef<string | null>(null)
  /** 按下去的那顆鈕跟著卸載（整組收掉、只記熱量面板收起、改用提示消失、換頁）：焦點接到這個選擇器（sheet 裡），下一輪畫完才接 */
  const pendingFocusRef = useRef<string | null>(null)
  const focusLater = (sel: string) => {
    pendingFocusRef.current = sel
  }
  const headOf = (id: string) => `.meal-rows [data-key="${CSS.escape(id)}"] .mr-head`
  const histFetchedRef = useRef(false)

  /* 開啟時重置整個 sheet 的本地狀態：每次打開都是一份新的 */
  useEffect(() => {
    if (!open) return
    setMeal(initialMeal)
    setView('main')
    setQuery('')
    setFilterQuery('')
    setItems([])
    setOpenId(null)
    setModsClosed(new Set())
    setKcalOpen(false)
    setOwnKcal('')
    setBusy(false)
    setErr(null)
    setFoodForm(BLANK_FOOD_FORM)
    setFixes({})
    setFresh(new Set())
    setSaid('')
    setLibKeys(new Set())
    setNotStore(null)
    estReqRef.current++
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    liveRef.current = items
  })

  /* 每次打開都重撈（同一次開 app 裡午餐剛記的，晚餐再開就要看得到）；收起時放掉旗標。 */
  useEffect(() => {
    if (!open) {
      histFetchedRef.current = false
      return
    }
    if (histFetchedRef.current) return
    histFetchedRef.current = true
    void (async () => {
      try {
        setHist(await listRecentIntake(shiftDate(dayData.date, -HISTORY_DAYS), dayData.date))
      } catch {
        /* 常吃、整組、搭配卡是捷徑：撈不到那幾段就不出，搜尋、AI 估、食品庫照常能用，不打全域 Notice */
        setHist([])
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* 拿掉一列（按下去的鈕跟著卸載）：焦點接到下一列，沒有下一列就回框裡。只在焦點真的掉了時 */
  useEffect(() => {
    const key = focusNextRef.current
    if (key === null) return
    focusNextRef.current = null
    if (document.activeElement !== document.body) return
    const li = key ? sheetRef.current?.querySelector<HTMLElement>(`.meal-rows [data-key="${CSS.escape(key)}"]`) : null
    const target = li ? (li.querySelector<HTMLElement>('.mr-head') ?? li) : boxRef.current
    target?.focus({ preventScroll: true })
  }, [items])

  useEffect(() => {
    const sel = pendingFocusRef.current
    if (!sel) return
    pendingFocusRef.current = null
    // WebKit 按鈕點了不取得焦點，焦點常停在 sheet 容器或框上：不看「焦點掉了沒」，只在有人正在別的輸入欄打字時不搶
    const target = sheetRef.current?.querySelector<HTMLElement>(sel)
    const a = document.activeElement
    if (!target || (a !== target && a instanceof HTMLInputElement && a.isConnected && a !== boxRef.current)) return
    target.focus({ preventScroll: true })
  })

  /* 浮現播完就清掉，從食品庫頁回來不重播 */
  useEffect(() => {
    if (fresh.size === 0) return
    const t = setTimeout(() => setFresh(new Set()), 2500)
    return () => clearTimeout(t)
  }, [fresh])

  const libById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods])
  const foodOf = (id: number) => libById.get(id)
  const rank = useMemo(() => recencyRank(hist), [hist])
  const stores = useMemo(() => knownStores(hist, foods), [hist, foods])
  const vendorOptions = useMemo(() => vendorOptionsOf(foods), [foods])
  const inMeal = new Set(items.flatMap((i) => (i.kind === 'lib' ? [i.key] : [])))
  const inMealFoods = new Set(items.flatMap((i) => (i.kind === 'lib' ? [i.foodId] : [])))

  /* ── 這一餐 ── */

  const patchItem = (id: string, fn: (i: MealItem) => MealItem) => setItems((prev) => prev.map((i) => (i.id === id ? fn(i) : i)))
  const add = (...next: MealItem[]) => {
    setErr(null)
    setItems((prev) => [...prev, ...next])
  }
  const removeKey = (key: string) => setItems((prev) => prev.filter((i) => !(i.kind === 'lib' && i.key === key)))
  /** 找東西的列：沒在這一餐＝加（make 才組那一樣，叫法、店家照當下的框），已經在＝拿掉。 */
  const toggleRow = (key: string, make: () => LibItem) => (inMeal.has(key) ? removeKey(key) : add(make()))

  function removeItem(id: string) {
    const i = items.findIndex((x) => x.id === id)
    const next = i >= 0 ? items[i + 1] : undefined
    focusNextRef.current = next ? next.id : ''
    setItems((prev) => prev.filter((x) => x.id !== id))
    setOpenId((o) => (o === id ? null : o))
    setFixes(({ [id]: _drop, ...rest }) => rest)
  }

  function stepQty(id: string, dir: 1 | -1) {
    patchItem(id, (i) => {
      if (i.kind === 'est') return i
      const qty = normalizeQty(i.qty + dir)
      return { ...i, qty, qtyDraft: String(qty) }
    })
  }
  /* 打字途中不正規化（"1." 被改成 1 游標會跳走），能解析成正數就先更新小計；正規化留到 blur */
  function typeQty(id: string, raw: string) {
    patchItem(id, (i) => {
      if (i.kind === 'est') return i
      const n = parseTypedQty(raw)
      return n === null ? { ...i, qtyDraft: raw } : { ...i, qty: n, qtyDraft: raw }
    })
  }
  function settleQty(id: string, raw: string) {
    patchItem(id, (i) => {
      if (i.kind === 'est') return i
      const qty = normalizeQty(raw)
      return { ...i, qty, qtyDraft: String(qty) }
    })
  }
  function setMods(id: string, mods: string[]) {
    patchItem(id, (i) => {
      if (i.kind !== 'lib') return i
      const f = libById.get(i.foodId)
      return f ? { ...i, mods: normalizeMods(mods, f) } : i
    })
  }
  const patchDraft = (id: string, fn: (d: DraftItem) => DraftItem) => patchItem(id, (i) => (i.kind === 'draft' && i.saved === null ? fn(i) : i))

  /* ── AI 估（按了才叫，spec AC 5） ── */

  /** 送一樣去估：框清空，這一餐多一列估算中的；回來可能好幾樣，在原位換掉，第一樣展開。 */
  async function runEstimate(est: EstItem) {
    const gen = estReqRef.current
    setSaid('在看你吃了什麼…')
    try {
      const res = await estimateMeal(est.text)
      if (gen !== estReqRef.current) return
      // 那一列已經被拿掉了：結果丟掉
      if (!liveRef.current.some((x) => x.id === est.id)) return
      // 對食品庫時把店名一起看：AI 把店家拿掉的品名對到別家的那一筆，不自動換（v2.154 review H1）
      const context = est.store ? `${est.store} ${est.text}` : est.text
      const typed = res.length === 1 ? est.text : null
      const next: MealItem[] = resolveAfterAi(res, context, foods, rank, est.text).map((d) => {
        const f = d.lib ? libById.get(d.lib.food.id) : undefined
        if (d.lib && f) return aiLibItem(f, d.lib.alias, est.store, typed)
        return { id: newItemId(), kind: 'draft', draft: d, qty: 1, qtyDraft: '1', vendor: est.store, typed, saved: null }
      })
      setItems((prev) => prev.flatMap((x) => (x.id === est.id ? next : [x])))
      setFresh(new Set(next.map((x) => x.id)))
      // 一句話回好幾樣：第一樣展開（spec 我定的）
      if (next.length) setOpenId(next[0].id)
      setSaid(`估好了：${next.map((x) => (x.kind === 'draft' ? `${draftName(x.draft, meal ?? 'dinner')} ${x.draft.kcal} 卡` : x.kind === 'lib' ? `${foodOf(x.foodId)?.name ?? ''}（食品庫）` : '')).join('、')}`)
    } catch {
      if (gen !== estReqRef.current) return
      patchItem(est.id, (x) => (x.kind === 'est' ? { ...x, status: 'error', startedAt: null } : x))
      // 那一列自己的 role=alert 會唸
      setSaid('')
    }
  }

  function estimate(bq: BoxQuery) {
    if (busy) return
    const text = [...bq.item].slice(0, ESTIMATE_TEXT_MAX).join('')
    const est: EstItem = { id: newItemId(), kind: 'est', text, store: bq.storeOnly ? null : bq.store, status: 'busy', startedAt: Date.now() }
    setErr(null)
    setItems((prev) => [...prev, est])
    setQuery('')
    setFilterQuery('')
    setNotStore(null)
    // AI 鈕跟著搜尋結果卸載：焦點回框裡，可以接著打下一樣
    boxRef.current?.focus({ preventScroll: true })
    toTop()
    void runEstimate(est)
  }

  function retryEstimate(id: string) {
    const e = items.find((x) => x.id === id)
    if (e?.kind !== 'est' || busy) return
    const next: EstItem = { ...e, status: 'busy', startedAt: Date.now() }
    patchItem(id, () => next)
    void runEstimate(next)
  }

  /** AI 的列「食品庫有『X』N 卡　改用」：換成食品庫那一筆，照勾它的規則（叫法、代替、店家）。 */
  function adoptNear(id: string, foodId: number) {
    const it = items.find((x) => x.id === id)
    const f = libById.get(foodId)
    if (it?.kind !== 'draft' || !f) return
    const item = foundItem(f, { name: f.name, vendor: f.vendor, alias: null }, { store: it.vendor, item: it.typed ?? it.draft.name, storeOnly: false })
    setItems((prev) => prev.map((x) => (x.id === id ? item : x)))
    setOpenId((o) => (o === id ? null : o))
    focusLater(headOf(item.id))
  }

  const patchFix = (id: string, patch: Partial<FixState>) => setFixes((prev) => ({ ...prev, [id]: { ...(prev[id] ?? FIX_IDLE), ...patch } }))

  /* 不對？跟 AI 說：送估的那一段＋那一列目前的估算＋修正字，只換那一列。回來時那一列不在了就丟掉。失敗那一列維持原樣、修正字留著。 */
  async function submitFix(id: string) {
    const it = items.find((x) => x.id === id)
    const f = fixes[id]
    if (it?.kind !== 'draft' || it.saved !== null || !f || !canFix(it.draft) || !fixTextOk(f.text) || fixBusy) return
    const text = f.text.trim()
    patchFix(id, { status: 'busy' })
    try {
      const res = await estimateFix(it.draft.sentence as string, fixRequestItem(it.draft), text)
      const next = applyFix(it.draft, res, text)
      patchDraft(id, (x) => ({ ...x, draft: applyFix(x.draft, res, text) }))
      patchFix(id, { open: false, text: '', status: 'idle' })
      setSaid(`已照「${fixTag(text)}」修正，${draftName(next, meal ?? 'dinner')} ${next.kcal} 卡`)
    } catch {
      patchFix(id, { status: 'error' })
    }
  }

  /* ── 只記熱量（工具列那格原地展開） ── */

  const ratio = meal ? (props.macroRatios[meal] ?? null) : null
  function addKcalDraft(tier: TierKey | null) {
    const kcal = parseKcal(ownKcal)
    if (tier === null && kcal === null) return
    const d = tier ? draftFromTier(tier, ratio) : draftFromKcal(kcal as number, ratio)
    const id = newItemId()
    add({ id, kind: 'draft', draft: d, qty: 1, qtyDraft: '1', vendor: null, typed: null, saved: null })
    setKcalOpen(false)
    setOwnKcal('')
    // 面板收起、按下去的那顆跟著不見：焦點接到剛多的那一列
    focusLater(headOf(id))
  }

  /* ── 加入 ── */

  const addBlocked = unsettled(items) > 0 || fixBusy || !meal
  /* 「加入」：食品庫的照勾的寫；估好的先存進食品庫（同名已有就不另建），再一起寫 intake。
     中途失敗按重試：已經存好的不再存一次（DraftItem.saved），不會在食品庫留下重複的列。
     加入成功後才把叫法記成別名（背景，畫面上不出現）。 */
  async function submit() {
    if (items.length === 0 || busy || !meal || addBlocked) return
    setBusy(true)
    setErr(null)
    try {
      const rows: NewIntake[] = []
      const wants: { foodId: number; alias: string }[] = []
      /* 這次加入剛建的食物：同一次有兩樣同名的估算，第二樣要看得到第一樣、不另建（App 的 foods 這時還沒更新） */
      const created: Food[] = []
      for (const it of items) {
        if (it.kind === 'lib') {
          const f = libById.get(it.foodId)
          // 食品庫那一筆不見了（別的裝置封存、刪掉）：不能靜靜少記一樣，講出來讓人拿掉
          if (!f) throw new Error(`「${it.name ?? '有一樣'}」已經不在食品庫，拿掉它再加入`)
          rows.push(libIntake(it, f, meal, dayData.date))
          if (it.alias) wants.push({ foodId: it.foodId, alias: it.alias })
        } else if (it.kind === 'draft') {
          let saved = it.saved
          if (!saved) {
            const plan = savePlan(it, meal, [...foods, ...created], rank)
            if (plan.kind === 'existing') saved = { foodId: plan.foodId, alias: plan.alias }
            else {
              const f = await onCreateEstimateFood(plan.food, plan.keep)
              if (plan.keep) created.push(f)
              saved = { foodId: f.id, alias: null }
            }
            const s = saved
            patchItem(it.id, (x) => (x.kind === 'draft' ? { ...x, saved: s } : x))
          }
          rows.push(draftIntake(it, saved.foodId, meal, dayData.date))
          if (saved.alias) wants.push({ foodId: saved.foodId, alias: saved.alias })
        }
      }
      await onCreateIntake(rows)
      /* 成功後 App 會把 open 翻成 false，交給 SpringSheet 播退場；不在這裡 setBusy(false)——下次開啟時 reset effect 處理。
         叫法是背景學的（spec「系統學兩件事」）：存不進去就是這次沒學到，下次打一樣的字勾一樣的再學；走背景失敗的那條路（console.warn，
         同類型補判），不打斷使用者 */
      for (const [id, aliases] of aliasUpdates(wants, foodOf)) {
        void onUpdateFood(id, { aliases }).catch((e) => console.warn('[叫法] 別名存不進去，下次再學', e))
      }
    } catch (e) {
      setBusy(false)
      setErr(friendlyError(errMsg(e)))
    }
  }

  /* ── 食品庫頁、新增食物 ── */

  /** 食品庫頁：這一樣已經在這一餐（不管是從哪裡、記成什麼品名店家）就是 ✓，再按一次把它拿掉；不重複加。 */
  function libToggle(f: Food) {
    const key = pickKey(f, null, null)
    if (inMealFoods.has(f.id)) {
      setItems((prev) => prev.filter((i) => !(i.kind === 'lib' && i.foodId === f.id)))
      setLibKeys((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    } else {
      add(libItem(f))
      setLibKeys((s) => new Set(s).add(key))
    }
  }
  function openLibrary() {
    setLibKeys(new Set())
    setKcalOpen(false)
    setView('library')
    focusLater('.libp-head .back-btn')
  }
  function backToMain() {
    setView('main')
    focusLater('.log-tool[data-tool="library"]')
  }
  function openFoodForm(prefill: string) {
    setFoodForm({ ...BLANK_FOOD_FORM, name: prefill })
    setErr(null)
    setView('food-form')
  }
  /* 新增時查重（AC 13）：同店家同品名（或別名）擋下、給「改用那筆」；只有品名一樣、店家不同就一行提醒、照樣能存。 */
  const formDup = duplicateCheck({ name: foodForm.name, vendor: foodForm.vendor.trim() || null, aliases: foodForm.aliases }, foods)
  /** 查重擋下時「改用那筆」：不新增，把食品庫那一筆加進這一餐、回主畫面。 */
  function pickExisting(f: Food) {
    const it = libItem(f)
    if (!inMealFoods.has(f.id)) add(it)
    setView('main')
    setErr(null)
    focusLater(inMealFoods.has(f.id) ? `input[aria-label="${BOX_LABEL}"]` : headOf(it.id))
  }
  async function submitFoodForm() {
    if (busy) return
    const validated = validateFoodForm(foodForm)
    if ('error' in validated) return setErr(validated.error)
    if (formDup.block) return setErr(null)
    setBusy(true)
    setErr(null)
    try {
      const created = await onCreateFood(validated.food)
      /* 新增完直接加進這一餐、回主畫面——這顆鈕只承諾「加入食品庫」，真正記進 intake 仍要按「加入」 */
      const it = libItem(created)
      add(it)
      setView('main')
      focusLater(headOf(it.id))
      setBusy(false)
    } catch (e) {
      setBusy(false)
      setErr(friendlyError(errMsg(e)))
    }
  }

  /* ── 框 ── */

  function handleQueryChange(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    if (!composingRef.current) setFilterQuery(v)
  }
  function handleCompositionEnd(e: CompositionEvent<HTMLInputElement>) {
    composingRef.current = false
    setFilterQuery(e.currentTarget.value)
  }
  function clearBox() {
    setQuery('')
    setFilterQuery('')
    setNotStore(null)
    boxRef.current?.focus({ preventScroll: true })
  }

  /* ── 數字 ── */

  /* v2.47：不是 `=== localDate()`——明天也算「還能改變結果」，確認列要顯示「剩 N」。 */
  const plannable = isPlannable(dayData.date)
  const eaten = sumIntake(dayData.rows ?? [])
  const loggedMeals = new Set((dayData.rows ?? []).map((r) => r.meal))
  const totals = items.reduce(
    (t, it) => {
      const x = itemTotals(it, foodOf)
      return x ? { n: t.n + 1, kcal: t.kcal + x.kcal, protein: t.protein + x.protein, fat: t.fat + x.fat, carb: t.carb + x.carb } : t
    },
    { n: 0, kcal: 0, protein: 0, fat: 0, carb: 0 },
  )
  const addOn = (t: IntakeTotals): IntakeTotals => ({ kcal: eaten.kcal + t.kcal, protein: eaten.protein + t.protein, fat: eaten.fat + t.fat, carb: eaten.carb + t.carb })
  const combined = addOn(totals)
  /** 找東西的列：加進去會超標多少（逐筆超標預警，v2.10；基準含這一餐已經加的）。 */
  const overOf = (u: { kcal: number; fat: number; carb: number }) => {
    const o = rowOverage(combined, u.kcal, u.fat, u.carb, targets)
    const delta = formatOverDelta(o)
    return o.kcal > 0 || delta ? { delta, aria: formatOverAria(o) } : null
  }
  const unitOf = (r: { food: MealFood; mods: readonly string[]; qty: number }) => {
    const u = perServing(r.food, r.mods)
    return { kcal: u.kcal * r.qty, protein: u.protein * r.qty, fat: u.fat * r.qty, carb: u.carb * r.qty }
  }
  /* 軟性排序（v2.15）：吃得下的排前面，基準是今日已吃（不含這一餐，勾一樣整張不重排）；搜尋結果在完全符合之後才看它 */
  const sortedFoods = useMemo(() => {
    const byName = [...foods].sort(byFoodName)
    return byQuotaFit(byName, overQuotaAmounts(byName, () => 1, eaten, targets))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foods, eaten.kcal, eaten.fat, eaten.carb, targets])

  /* ── 找東西的列 ── */

  const label = meal ? mealLabel(meal) : ''
  const lastText = (r: RecordRow) => {
    const parts = [r.qty !== 1 ? `×${r.qty}` : '', r.mods.length ? summaryOf(r.mods, r.food) : ''].filter(Boolean)
    return parts.length ? ` · 上次 ${parts.join(' ')}` : ''
  }
  const recordRow = (r: RecordRow, sub: string, opts: { tag?: boolean; hits?: number[] } = {}) => {
    const u = unitOf(r)
    const name = r.name ?? r.food.name
    return (
      <FindRow
        key={r.key}
        rowKey={r.key}
        name={name}
        hits={opts.hits}
        vendor={r.vendor ?? r.food.vendor}
        vendorTag={opts.tag}
        sub={sub}
        kcal={u.kcal}
        added={inMeal.has(r.key)}
        over={overOf(u)}
        onToggle={() => toggleRow(r.key, () => libItem(r.food, { name: r.name, vendor: r.vendor, qty: r.qty, mods: r.mods }))}
      />
    )
  }

  /* 跟框無關的（常吃、整組、每一樣最近一次）：紀錄、食品庫、餐別一變才重算 */
  const freq = useMemo(() => (meal ? frequentRows(hist, meal, (id) => libById.get(id)) : []), [hist, libById, meal])
  const combo = useMemo(() => (meal ? lastCombo(hist, meal, dayData.date, (id) => libById.get(id)) : null), [hist, libById, meal, dayData.date])
  const last = useMemo(() => lastRecords(hist, (id) => libById.get(id)), [hist, libById])
  /* 跟框有關的：打字時清單晚一拍跟上（useDeferredValue），框本身不卡 */
  const deferredQuery = useDeferredValue(filterQuery)
  const bq = useMemo(() => parseBox(deferredQuery, stores, notStore), [deferredQuery, stores, notStore])
  const found = useMemo(() => {
    if (!bq) return null
    const fo = (id: number) => libById.get(id)
    const toRow = (h: { foodId: number; name: string | null; vendor: string | null; qty: number; mods: string[]; date: string | null }): RecordRow => {
      const f = libById.get(h.foodId) as Food
      const it = libItem(f, { name: h.name, vendor: h.vendor, qty: h.qty, mods: h.mods })
      return { key: it.key, food: f, name: it.name, vendor: it.vendor, qty: it.qty, mods: it.mods, date: h.date }
    }
    /* 打店名：你在那家記過的（店名＋品名時只列品名對得到的），點了照上次那樣記 */
    const storeRows = bq.store
      ? storeHistory(hist, bq.store, fo)
          .map((h) => ({ ...toRow(h), hits: bq.storeOnly ? undefined : matchText(bq.item, h.name ?? (fo(h.foodId)?.name ?? ''))?.hits }))
          .filter((r) => bq.storeOnly || r.hits)
      : []
    const storeKeys = new Set(storeRows.map((r) => r.key))
    /* 你記過的品名（代替記的「排骨飯」）：點了照上次那樣記；完全符合或整串出現的排最上面（logFind.mergeResults） */
    const names = bq.storeOnly
      ? []
      : nameHistory(hist, bq.item, fo)
          .map((h) => ({ ...toRow(h), hits: h.hits, kind: h.kind }))
          .filter((r) => !storeKeys.has(r.key))
    const taken = new Set([...storeKeys, ...names.map((r) => r.key)])
    /* 食品庫：勾了要記成什麼（叫法、代替、店家）每一列算一次；也照上次的微調（v2.156「照上次」，同一樣最近一次按的） */
    const foodHits = searchFoods(sortedFoods, bq.item)
      .map((h) => {
        const it = foundItem(h.food, h, bq)
        const prev = last.get(it.key)
        return { h, kind: h.kind, prev, item: prev?.mods.length ? { ...it, mods: prev.mods } : it }
      })
      .filter((x) => !taken.has(x.item.key))
    return { storeRows, merged: mergeResults(names, foodHits) }
  }, [bq, hist, libById, sortedFoods, last])

  const today = localDate()
  const seenText = (date: string | null) => (date ? `上次 ${lastSeenText(date, today)}` : '')
  let listBody
  if (!bq || !found) {
    const comboLeft = combo ? combo.rows.filter((r) => !inMeal.has(r.key)) : []
    const comboTotal = combo ? combo.rows.map(unitOf).reduce((a, u) => ({ kcal: a.kcal + u.kcal, protein: a.protein + u.protein, fat: a.fat + u.fat, carb: a.carb + u.carb }), { kcal: 0, protein: 0, fat: 0, carb: 0 }) : null
    listBody = (
      <section aria-label={`${label}常吃`}>
        <h3 className="sect-lb">{label}常吃</h3>
        {freq.length === 0 && !combo ? (
          <p className="find-empty">{foods.length === 0 ? '食品庫還是空的。在上面打品名找、或用「食品庫」新增第一筆。' : `還沒有${label}的紀錄。在上面打品名或店家找。`}</p>
        ) : (
          <ul className="find-list">
            {/* 整組＝上一個同類日的這一餐；只加這一餐還沒有的那幾樣，都有了就收掉（收掉時焦點接到剛加的第一列） */}
            {combo && comboTotal && comboLeft.length > 0 && (
              <FindRow
                rowKey="combo"
                lead="整組"
                name={`上次${label}：${combo.rows.map((r) => r.name ?? r.food.name).join('、')}`}
                sub={`${weekdayDate(combo.date)} · 蛋白 ${Math.round(comboTotal.protein)}g`}
                kcal={comboTotal.kcal}
                added={false}
                over={overOf(comboTotal)}
                onToggle={() => {
                  const added = comboLeft.map((r) => libItem(r.food, { name: r.name, vendor: r.vendor, qty: r.qty, mods: r.mods }))
                  add(...added)
                  focusLater(headOf(added[0].id))
                }}
              />
            )}
            {freq.map((r) => recordRow(r, `蛋白 ${Math.round(unitOf(r).protein)}g${lastText(r)}`))}
          </ul>
        )}
      </section>
    )
  } else {
    const { storeRows, merged } = found
    listBody = (
      <section aria-label="搜尋結果">
        {storeRows.length > 0 && (
          <>
            <h3 className="sect-lb">你在{bq.store}吃過的</h3>
            <ul className="find-list">
              {storeRows.map((r) => recordRow(r, [seenText(r.date), r.name ? `照${r.food.name}算` : ''].filter(Boolean).join(' · '), { tag: true, hits: r.hits }))}
            </ul>
          </>
        )}
        {merged.length > 0 && (
          <>
            {storeRows.length > 0 && <h3 className="sect-lb">其他對到的</h3>}
            <ul className="find-list">
              {merged.map((r) => {
                if (r.src === 'name') return recordRow(r.hit, [seenText(r.hit.date), `照${r.hit.food.name}算`].filter(Boolean).join(' · '), { tag: true, hits: r.hit.hits })
                const { h, prev, item } = r.hit
                const u = unitOf({ food: h.food, mods: item.mods, qty: 1 })
                const was = prev?.mods.length ? ` · 上次 ${summaryOf(prev.mods, h.food)}` : ''
                return (
                  <FindRow
                    key={item.key}
                    rowKey={item.key}
                    name={h.name}
                    hits={h.hits}
                    vendor={h.vendor}
                    sub={`蛋白 ${Math.round(u.protein)}g${was}`}
                    kcal={u.kcal}
                    added={inMeal.has(item.key)}
                    over={overOf(u)}
                    onToggle={() => toggleRow(item.key, () => ({ ...item, id: newItemId() }))}
                  />
                )
              })}
            </ul>
          </>
        )}
        {/* 永遠在最下面：送的是去掉店名的那段（spec AC 5）；按了才叫。整串只是店名時不出（「用 AI 估『全家』」沒有意義） */}
        {!bq.storeOnly && (
          <div className="ai-card">
            <p>食品庫沒有你吃的那個？</p>
            <button className="ai-card-btn" type="button" disabled={busy} onClick={() => estimate(bq)}>
              用 AI 估「{bq.item}」
            </button>
          </div>
        )}
      </section>
    )
  }

  /* 搭配卡（spec 情境一）：這一餐有正餐類、還沒有飲料時，跟這一餐一起吃過、放得進今天剩下額度的飲料點心 */
  const libFoods = items.flatMap((i) => (i.kind === 'lib' ? [libById.get(i.foodId)] : [])).filter((f): f is Food => !!f)
  const room = Math.round(targets.kcal - combined.kcal)
  const pairs = wantsPair(libFoods.map((f) => f.category)) ? pairCandidates(hist, new Set(libFoods.map((f) => f.id)), foodOf, { exclude: inMeal, room }) : []

  /* ── 底部確認列 ── */

  const waitingN = unsettled(items)
  const reason = waitingN > 0 ? `還有 ${waitingN} 樣沒估好` : fixBusy ? '正在跟 AI 說，好了才能加入' : !meal ? '先選是哪一餐' : null
  function renderPickBar() {
    const t = totals
    const right = pickBarRight(plannable, eaten.kcal, targets.kcal, t.kcal)
    const all = combined
    const fatOver = macroExceeds(all.fat, targets.fat)
    const carbOver = macroExceeds(all.carb, targets.carb)
    return (
      <div className="pick-bar">
        {err && (
          <p className="sheet-error" role="alert">
            存不進去：{err}
          </p>
        )}
        {reason && <p className="pick-hint">{reason}</p>}
        {/* role="group"：generic 的 <div> 禁止用 aria-label 命名，子元素又全部 aria-hidden */}
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
        {/* 蛋白/脂/碳的判定跟今日頁三大營養素條同一條：脂肪／碳水各自 >100% 轉破表，蛋白質不判（DESIGN「三大營養素判定」） */}
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
        <button className="pick-bar-btn" type="button" disabled={busy || addBlocked} onClick={() => void submit()}>
          {busy ? '加入中…' : err ? '重試' : '加入'}
        </button>
      </div>
    )
  }

  const libAdded = [...libKeys].filter((k) => inMeal.has(k)).length
  const contentAriaLabel = view === 'main' ? (meal ? mealLabel(meal) : '記一筆') : view === 'library' ? '食品庫' : '新增食物'
  const closeBtn = (
    <button className="icon-btn" type="button" aria-label="關閉" disabled={busy || scanBusy} onClick={onClose}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  )

  /* 辨識中、寫入中鎖住關閉（關閉鈕、下滑、Escape、點 scrim）：誤關的代價是那張照片白拍，或關掉再從今日頁加一次變兩份。 */
  return (
    <SpringSheet open={open} onClose={onClose} label={contentAriaLabel} screen="log-sheet" initialFocus={sheetRef} popupRef={sheetRef} locked={scanBusy || busy}>
      {view === 'main' && (
        <>
          <SheetGrabZone className="chip-bar">
            {/* 選中態用 aria-pressed（選的是「這筆記到哪一餐」，不是換頁）；不做半套 tablist。v2.166：這天記過的餐前面一個小勾 */}
            <div className="chiprow" role="group" aria-label="餐別">
              {MEALS.map((m) => (
                <button
                  key={m.key}
                  className="chip"
                  type="button"
                  aria-pressed={meal === m.key}
                  aria-label={loggedMeals.has(m.key) ? `${m.label}，記過了` : undefined}
                  onClick={() => setMeal(m.key)}
                >
                  {loggedMeals.has(m.key) && (
                    <svg className="chip-done" viewBox="0 0 14 14" aria-hidden="true">
                      <path d="M3 7.5l2.5 2.5L11 4.5" />
                    </svg>
                  )}
                  {m.label}
                </button>
              ))}
            </div>
            {closeBtn}
          </SheetGrabZone>

          <div className="search-wrap">
            <div className="search-box">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6" />
                <path d="M20 20l-4-4" />
              </svg>
              {/* 只是搜尋（v2.167 拿掉頓號、逗號、完成鍵切段）：打品名或「店家 品名」 */}
              <input
                ref={boxRef}
                type="text"
                placeholder="找食物：打品名或店家"
                aria-label={BOX_LABEL}
                enterKeyHint="search"
                readOnly={busy}
                value={query}
                onChange={handleQueryChange}
                onCompositionStart={() => (composingRef.current = true)}
                onCompositionEnd={handleCompositionEnd}
              />
              {query && (
                <button className="search-clear" type="button" aria-label="清掉框裡的字" onClick={clearBox}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 7l10 10M17 7L7 17" />
                  </svg>
                </button>
              )}
            </div>
            {/* 框裡第一段被當成店名時看得到、按得掉（「大杯 拿鐵」的大杯不是店）：按掉這次整串都當品名、不記店家 */}
            {bq?.store && (
              <div className="store-chip">
                <span>在 {bq.store} 買</span>
                <button type="button" aria-label={`不是店名：${bq.store}`} onClick={() => {
                  setNotStore(bq.store)
                  focusLater(`input[aria-label="${BOX_LABEL}"]`)
                }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 7l10 10M17 7L7 17" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* 讀屏播報一直掛著（這一餐空著時也在）——跟內容一起插進去的 live region 很多讀屏不會唸第一句（review N4） */}
          <p className="sr-only" role="status" aria-live="polite">{said}</p>

          {/* 工具列（樣張第四版甲）：食品庫換一頁、只記熱量原地展開。幫我想在第二段 */}
          <div className="log-tools" role="group" aria-label="其他記法">
            <button className="log-tool" type="button" data-tool="library" onClick={openLibrary}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14M5 12h14M5 17h14" />
              </svg>
              <span>食品庫</span>
            </button>
            <button className="log-tool" type="button" aria-expanded={kcalOpen} aria-controls="kcal-panel" onClick={() => {
                if (!kcalOpen) toTop()
                setKcalOpen((v) => !v)
              }}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 10c2.5-2 5.5-2 8 0s5.5 2 8 0M4 15c2.5-2 5.5-2 8 0s5.5 2 8 0" />
              </svg>
              <span>只記熱量</span>
            </button>
          </div>

          <div className="food-scroll" key="main-scroll" ref={scrollRef}>
            {kcalOpen && (
              <div className="kcal-panel" id="kcal-panel" role="group" aria-label="只記熱量">
                <p className="kcal-panel-lb">這一餐大概吃了多少？</p>
                <div className="est-tiers">
                  {TIERS.map((t) => (
                    <button key={t.key} className="est-tier" type="button" disabled={busy} onClick={() => addKcalDraft(t.key)}>
                      <b>{t.label}</b>
                      <small className="num">約 {t.kcal}</small>
                      <i>{t.examples}</i>
                    </button>
                  ))}
                </div>
                <form
                  className="est-own"
                  onSubmit={(ev) => {
                    ev.preventDefault()
                    addKcalDraft(null)
                  }}
                >
                  <label htmlFor="own-kcal">自己打</label>
                  <input id="own-kcal" className="num" type="text" inputMode="decimal" placeholder="熱量" value={ownKcal} disabled={busy} onChange={(e) => setOwnKcal(e.target.value)} />
                  <span>卡</span>
                  <button type="submit" className="est-own-add" disabled={parseKcal(ownKcal) === null || busy}>
                    記這個
                  </button>
                </form>
              </div>
            )}

            <MealSection
              meal={meal ?? 'dinner'}
              items={items}
              foodOf={foodOf}
              openId={openId}
              onToggleOpen={(id) => setOpenId((o) => (o === id ? null : id))}
              fresh={fresh}
              locked={busy}
              fixes={fixes}
              fixBusy={fixBusy}
              modsClosed={modsClosed}
              onToggleMods={(id) =>
                setModsClosed((s) => {
                  const n = new Set(s)
                  if (n.has(id)) n.delete(id)
                  else n.add(id)
                  return n
                })
              }
              onQtyStep={stepQty}
              onQtyInput={typeQty}
              onQtyBlur={settleQty}
              onMods={setMods}
              onKcalInput={(id, raw) => patchDraft(id, (x) => ({ ...x, draft: withKcalInput(x.draft, raw) }))}
              onKcalBlur={(id) => patchDraft(id, (x) => ({ ...x, draft: settleKcal(x.draft) }))}
              onFixToggle={(id) => patchFix(id, { open: !fixes[id]?.open, status: fixes[id]?.status === 'busy' ? 'busy' : 'idle' })}
              onFixText={(id, v) => patchFix(id, { text: v })}
              onFixSubmit={(id) => void submitFix(id)}
              onRemove={removeItem}
              onRetry={retryEstimate}
              onAdopt={adoptNear}
            />

            {pairs.length > 0 && (
              <div className="pair-card" role="group" aria-label="要不要來杯飲料、點心？">
                <p className="pair-head">
                  <span>要不要來杯飲料、點心？</span>
                  <span className="pair-room">還剩 {room} 卡</span>
                </p>
                <div className="pair-chips">
                  {pairs.map((r) => {
                    const name = r.name ?? r.food.name
                    const vendor = r.vendor ?? r.food.vendor
                    const k = Math.round(unitOf(r).kcal)
                    return (
                      <button
                        key={r.key}
                        className="pair-chip"
                        type="button"
                        aria-label={`加${name}${vendor ? `，${vendor}` : ''}，${k} 大卡`}
                        onClick={() => add(libItem(r.food, { name: r.name, vendor: r.vendor, qty: r.qty, mods: r.mods }))}
                      >
                        <span aria-hidden="true">
                          {name}
                          {vendor && ` · ${vendor}`}
                        </span>
                        <span className="num" aria-hidden="true">{k}</span>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 7v10M7 12h10" />
                        </svg>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {listBody}
          </div>

          {items.length > 0 && renderPickBar()}
        </>
      )}

      {view === 'library' && (
        <>
          <LogLibrary
            close={closeBtn}
            mealLabel={label || '記一筆'}
            foods={sortedFoods}
            inMealFoods={inMealFoods}
            added={libAdded}
            onToggle={libToggle}
            onNewFood={openFoodForm}
            onBack={backToMain}
          />
        </>
      )}

      {view === 'food-form' && (
        <>
          <SheetGrabZone className="sheet-head">
            <span className="sheet-title">新增食物</span>
            {closeBtn}
          </SheetGrabZone>
          <div className="back-row">
            {/* scanBusy 也要吃：按下去會把 FoodFormFields 整層卸載，而辨識還在跑 */}
            <button
              className="back-btn"
              type="button"
              disabled={scanBusy}
              onClick={() => {
                setErr(null)
                setView('library')
                focusLater('.libp-head .back-btn')
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
              返回食品庫
            </button>
          </div>

          <div className="form-wrap">
            {/* vendorAutoFocus：品名已經是食品庫頁的搜尋字帶進來的，下一個該落焦的是店家 */}
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
            {formDup.block ? (
              <div className="dup-block" role="alert">
                <span>食品庫已有「{foodLabel(formDup.block)}」</span>
                <button className="row-pill" type="button" onClick={() => formDup.block && pickExisting(formDup.block)}>
                  改用那筆
                </button>
              </div>
            ) : (
              formDup.note && <p className="dup-note">食品庫已有{formDup.note.vendor ? ` ${formDup.note.vendor} 的` : ''}「{formDup.note.name}」，不同店家照樣可以存</p>
            )}
            {err && (
              <p className="sheet-error" role="alert">
                {err}
              </p>
            )}
            <button className="pick-bar-btn" type="button" disabled={busy || scanBusy || formDup.block !== null} onClick={() => void submitFoodForm()}>
              {busy ? '加入中…' : '加入食品庫'}
            </button>
          </div>
        </>
      )}
    </SpringSheet>
  )
}
