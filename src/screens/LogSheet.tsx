/* 記一筆 sheet：SpringSheet 承載（全站精緻度 B1b，原為 vaul Drawer），清單多選／搜尋／份量 stepper／新增食物／確認列。
   行為與視覺依 DESIGN.md 元件規則表（2026-07-31 起是唯一真相來源），
   計算全部交給 src/lib 不重新推導。

   vanilla 版的兩個坑（sheet 整塊重繪咬 click、注音組字被打斷）源自 renderSheet() 用
   innerHTML 整塊換掉 DOM——React keyed 渲染天然不會這樣做（同一顆按鈕、同一個 input
   在 re-render 之間是同一個 DOM 節點，不會被拔掉重建），所以這裡不需要
   「清單走增量、搜尋框不動」的特殊處理，直接用一般的 controlled component 寫法即可。 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type CompositionEvent, type KeyboardEvent, type ReactNode } from 'react'
import CategoryIcon, { CategoryStack } from '@/components/CategoryIcon'
import FoodFormFields from '@/components/FoodFormFields'
import PortionMods from '@/components/PortionMods'
import QtyStepper from '@/components/QtyStepper'
import SpringSheet, { SheetGrabZone } from '@/components/SpringSheet'
import {
  estimateFix,
  estimateMeal,
  listRecentIntake,
  scanLabel,
  type Food,
  type NewIntake,
} from '@/lib/api'
import {
  adoptNear,
  applyFix,
  fixTag,
  backToAi,
  canFix,
  draftFromKcal,
  draftFromTier,
  fixRequestItem,
  fixTextOk,
  draftsToIntake,
  draftName,
  draftToFood,
  estimateTotals,
  resolveAfterAi,
  settleKcal,
  stepLibQty,
  withKcalInput,
  withLibQty,
  type EstimateDraft,
  type TierKey,
} from '@/lib/estimate'
import { duplicateCheck, foodLabel, recencyRank } from '@/lib/foodMatch'
import { aliasKey, aliasRowsOf, foodIdOf, foodKey, foodRow, genericCandidates, isGeneric, recordRow, rowIntake, rowKeyOfIntake, searchRows, shopRow, withAlias, type ListRow } from '@/lib/listRows'
import { BOX_SEPARATOR, adoptRow, draftEntry, entriesFromSegments, entryDomKey, pendingEntry, pickEntry, replaceEntry, splitBox, unresolved, waiting, type MealEntry } from '@/lib/mealBox'
import MealSection, { type FixState } from './MealSection'
import ShopCard from './ShopCard'

const FIX_IDLE: FixState = { open: false, text: '', status: 'idle' }
import { isPlannable } from '@/lib/dates'
import { errMsg, friendlyError } from '@/lib/errors'
import { BLANK_FOOD_FORM, aliasHit, byFoodName, foodMatches, validateFoodForm, vendorOptionsOf, type FoodForm } from '@/lib/foodForm'
import { categoryOf } from '@/lib/categories'
import { byQuotaFit, defaultQty, groupByCategory, overQuotaAmounts, pickTotals, recentStats, type FoodGroup } from '@/lib/foodPicks'
import { formatOverAria, formatOverDelta, macroExceeds, num, pickBarRight, roundTo1, rowOverage, sumIntake, type IntakeTotals, type OverDelta, type Targets } from '@/lib/formulas'
import { mergeByKey, seenText, type RepeatItem, type SeenMark } from '@/lib/mealSuggest'
import { MEALS, mealLabel, type MealKey } from '@/lib/meals'
import { applyMods, normalizeMods } from '@/lib/portionMods'
import { normalizeQty, parseTypedQty } from '@/lib/quantity'
import type { LogSheetProps } from './types'


type View = 'list' | 'food-form'

/* v2.162 起勾選狀態的鍵是清單的「列」（listRows：食物列 f:139、別名列 a:139:麻古 紅萱波波），不是 food_id——
   同一筆通用食物會同時有好幾列（spec「記店家改版」）。營養、微調基準、軟性排序仍看列背後的 food_id。 */
interface FoodRowHandlers {
  picks: Map<string, number>
  qtyDrafts: Map<string, string>
  onToggle: (key: string) => void
  onStep: (key: string, dir: 1 | -1) => void
  onQtyInput: (key: string, raw: string) => void
  onQtyBlur: (key: string, raw: string) => void
  /* 逐筆超標預警的判定基準：今日已吃＋sheet 內已勾選的加總（不含這一筆本身，
     由 renderFoodRow 依 picked 狀態決定要不要疊加），與 targets 一起傳，
     免得每個呼叫端各自重算一次 */
  combined: IntakeTotals
  targets: Targets
  /* 逐筆超標預警要用「勾下去實際會用的份量」試算，不能假設 1——togglePick 勾選時
     用的就是這個函式（依該餐上次吃這樣東西的份量），兩邊要算同一個數字，
     否則預告「不會超標」點下去卻超標（precommit review 抓到，2026-08-01）。 */
  defaultQty: (key: string) => number
  /* 軟性排序（v2.15，視覺降權在 v2.17 拿掉）：不符合今日剩餘額度的品項 → 超標量，
     判斷基準是「今日已吃」（eaten），不含這次 sheet 內勾選中的品項——刻意
     跟上面 combined（用來算逐列變色與 kc-delta）不同源，見 lib/foodPicks.ts 的軟性排序註解。
     `.over-quota` class 現在**只當排序分組與 e2e 測試用的語意標記，不掛任何樣式**
     （見 app.css 同名 class 旁的註解）——不是死碼，刪掉會讓排序分組與既有測試斷言
     一起失效。 */
  overAmounts: Map<number, OverDelta>
  /* 份量微調（spec「份量微調」）：勾起來的每一列各自按了哪些、哪一列展開、哪幾列是「照上次」帶的。
     modsBase：微調的基準＝食品庫那一筆；查不到（封存）就不出微調。建議段勾的也出（v2.158），基準一樣是食品庫。 */
  mods: Map<string, string[]>
  modsOpen: string | null
  /** 標「照上次」：一般勾選看 fromLast 狀態（自己按過就拿掉）；建議段勾的看現在跟來源那組一不一樣 */
  isFromLast: (key: string) => boolean
  /** 建議段勾的、微調沒動：展開後不出算式（那是食品庫現值，跟要記的快照數字對不上），改寫這一句 */
  modsNote: (key: string) => string | undefined
  modsBase: (key: string) => Food | undefined
  /** 勾起來那一列顯示的食物（建議段勾的是來源快照；別名列的品名與店家是別名的） */
  pickedFood: (key: string) => Food | undefined
  onToggleModsOpen: (key: string) => void
  onMods: (key: string, mods: string[]) => void
  /** 搜尋字：只靠（沒有店家段的）別名對上的列，副標寫「對到：別名」。 */
  query: string
  /** 寫入中：微調鎖住（寫入途中改了會被靜默丟掉）。 */
  busy: boolean
  /** 點已選膠囊捲過來的那一列閃一下；seq 讓連點同一顆也重播 */
  flash: { id: string; seq: number } | null
  onFlashEnd: () => void
}

/** 「對到：麻古 紅萱波波」，對上的那幾個字標主色。 */
function renderAliasHit(alias: string, q: string): ReactNode {
  const s = q.trim()
  const i = alias.toLowerCase().indexOf(s.toLowerCase())
  if (i < 0) return alias
  return (
    <>
      {alias.slice(0, i)}
      <mark>{alias.slice(i, i + s.length)}</mark>
      {alias.slice(i + s.length)}
    </>
  )
}

/* 一般函式、不是元件——用 fn(f) 呼叫而非 <Fn/>，React 才不會把它當成每次 render
   都換了身分的新元件型別重新掛載（那樣份量輸入框每打一個字就會失焦）。 */
function renderFoodRow(row: ListRow<Food>, h: FoodRowHandlers, withIcon = false) {
  /* 勾了留在原位（v2.158）：同一個 li 換成勾選的樣子，不搬到別段 */
  const key = row.key
  const picked = h.picks.has(key)
  const f = (picked && h.pickedFood(key)) || row.food
  const name = picked ? f.name : row.name
  const vendor = picked ? f.vendor : row.vendor
  const qty = h.picks.get(key) ?? 1
  const draft = h.qtyDrafts.get(key) ?? String(qty)
  const overQuota = !picked && h.overAmounts.has(row.id)
  const lib = picked ? h.modsBase(key) : undefined
  // 別名列本身就是那個別名，不再寫「對到：」；食物列只有舊式（沒有店家段）的別名會對上
  const hit = row.alias ? null : aliasHit(row.food, h.query)
  return (
    <li key={key}>
      <div className={picked ? 'food-item selected' : overQuota ? 'food-item over-quota' : 'food-item'} data-key={key}>
        {h.flash?.id === key && <span className="row-flash" key={h.flash.seq} aria-hidden="true" onAnimationEnd={h.onFlashEnd} />}
        {picked ? (
          <>
          <div className="food-line">
            <button className="food-row" type="button" aria-pressed="true" onClick={() => h.onToggle(key)}>
              <svg className="chk" viewBox="0 0 22 22" aria-hidden="true">
                <circle cx="11" cy="11" r="9" />
                <path d="M7 11.5l2.5 2.5L15 8.5" />
              </svg>
              <div className="nm-wrap">
                <span className="nm">{name}</span>
                {vendor && <span className="sub">{vendor}</span>}
              </div>
            </button>
            <QtyStepper
              qty={qty}
              draft={draft}
              name={name}
              onStep={(dir) => h.onStep(key, dir)}
              onInput={(raw) => h.onQtyInput(key, raw)}
              onBlur={(raw) => h.onQtyBlur(key, raw)}
            />
          </div>
          {lib && (
            <PortionMods
              target={lib}
              base={{ kcal: num(lib.kcal), protein: num(lib.protein), fat: num(lib.fat), carb: num(lib.carb) }}
              mods={h.mods.get(key) ?? []}
              open={h.modsOpen === key}
              fromLast={h.isFromLast(key)}
              note={h.modsNote(key)}
              hideCalc={h.modsNote(key) !== undefined}
              onToggleOpen={() => h.onToggleModsOpen(key)}
              onChange={(m) => h.onMods(key, m)}
              disabled={h.busy}
            />
          )}
          </>
        ) : (
          (() => {
            const previewQty = h.defaultQty(key)
            const over = rowOverage(h.combined, num(f.kcal) * previewQty, num(f.fat) * previewQty, num(f.carb) * previewQty, h.targets)
            const delta = formatOverDelta(over)
            const ariaText = formatOverAria(over)
            const ariaSuffix = ariaText ? `，加入後${ariaText}` : ''
            return (
              <button
                className="food-row"
                type="button"
                aria-pressed="false"
                aria-label={`${name}${vendor ? '，' + vendor : ''}${hit ? `，對到 ${hit}` : ''}，${Math.round(num(f.kcal))} 大卡${ariaSuffix}`}
                onClick={() => h.onToggle(key)}
              >
                <svg className="chk" viewBox="0 0 22 22" aria-hidden="true">
                  <circle cx="11" cy="11" r="9" />
                </svg>
                {withIcon && <CategoryIcon category={categoryOf(f.category)} size={24} decorative />}
                <div className="nm-wrap" aria-hidden="true">
                  <span className="nm">{name}</span>
                  {hit ? <span className="sub alias-hit">對到：{renderAliasHit(hit, h.query)}</span> : vendor && <span className="sub">{vendor}</span>}
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
    // 顯示用的店家（食物本身的，或來源那筆記的）；寫回的店家看建議快照的 intakeVendor，不看這欄
    vendor: item.vendor,
    kcal: item.kcal,
    protein: item.protein,
    fat: item.fat,
    carb: item.carb,
    archived: item.archived,
    category: item.category,
    // 只給 sheet 顯示與寫入用，不會寫回食品庫；手動與否、來源、別名這裡不知道也用不到
    category_manual: false,
    verified: false,
    aliases: [],
  }
}

/* 類型組標：圖示＋組名＋（吃過提示，或這一餐吃過幾次）。圖示是裝飾，組名已經是同一句話。 */
function renderGroup(g: FoodGroup<ListRow<Food>>, seen: SeenMark | undefined, rows: (r: ListRow<Food>) => ReactNode) {
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
  const { open, meal: initialMeal, foods, dayData, targets, repeatByMeal, seenByMeal, onClose, onCreateIntake, onCreateFood, onCreateEstimateFood, onUpdateFood } = props

  const [meal, setMeal] = useState<MealKey | null>(initialMeal)
  const [view, setView] = useState<View>('list')
  const [picks, setPicks] = useState<Map<string, number>>(new Map())
  const [qtyDrafts, setQtyDrafts] = useState<Map<string, string>>(new Map())
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
  const [recent, setRecent] = useState<Map<MealKey, string[]> | null>(null)
  const [lastQty, setLastQty] = useState<Map<string, number>>(new Map())
  const [mealCounts, setMealCounts] = useState<Map<MealKey, Map<number, number>>>(new Map())
  /** 最近記過的順序（同一份 listRecentIntake）：估一筆對到同名好幾筆時，挑最近記過的那筆（spec「食品庫改版」第二步）。撈不到就是空的，退回照來源挑。 */
  const [rank, setRank] = useState<Map<number, number>>(new Map())
  /** 每一列最近一筆的份量微調（同一份 listRecentIntake）：勾起來時預設帶上、標「照上次」。以列為單位——麻古那杯不跟青山那杯混。 */
  const [lastMods, setLastMods] = useState<Map<string, string[]>>(new Map())
  const [mods, setMods] = useState<Map<string, string[]>>(new Map())
  const [modsOpen, setModsOpen] = useState<string | null>(null)
  const [fromLast, setFromLast] = useState<Set<string>>(new Set())
  /** 新店第一次（ShopCard）勾的、食品庫還沒有的列（沒勾「記住」）：不在任何一段，單獨列在最上面 */
  const [extraRows, setExtraRows] = useState<Map<string, ListRow<Food>>>(new Map())
  /** 最近記過裡「自己記了品名或店家、對不上別名」的紀錄列（recordKey）：常吃要畫得出來，所以從那份歷史先建好 */
  const [histRows, setHistRows] = useState<Map<string, ListRow<Food>>>(new Map())
  const [shopBusy, setShopBusy] = useState(false)
  const [shopErr, setShopErr] = useState<string | null>(null)
  /** 「其他餐的」收合列展開了沒；每次打開 sheet 都收回去。 */
  const [elsewhereOpen, setElsewhereOpen] = useState(false)
  const recentFetchedRef = useRef(false)

  /* 從建議段勾起來的品項留一份快照：封存的食物 foods 查不到，切餐別後建議段也換了，
     沒有這份就會從小計、寫入靜默消失。取消勾選就清掉。 */
  const [suggestSnaps, setSuggestSnaps] = useState<Map<string, { food: Food; name: string | null; mods: string[]; vendor: string | null }>>(new Map())
  /** 「全選」按完會消失：焦點接到建議段第一列（列留在原位，下一個能按的就是它） */
  const focusSuggestRef = useRef(false)
  /** 勾／取消勾那一列換了一棵 DOM，按下去的那顆鈕被拔掉；焦點接回同一列的新鈕 */
  const refocusRef = useRef<string | null>(null)
  /** 搜尋框下的「已選」膠囊列（v2.158）：最近勾的那顆描邊；點膠囊捲到那一列、閃一下 */
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  /** focus false＝只捲過去、閃一下，不搶焦點（框裡打完一段只是多一份時：手還在框裡打字） */
  const [jump, setJump] = useState<{ id: string; seq: number; focus?: boolean } | null>(null)
  const [flash, setFlash] = useState<{ id: string; seq: number } | null>(null)
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const pinRef = useRef<HTMLDivElement | null>(null)
  const chipsRef = useRef<HTMLDivElement | null>(null)
  /** 膠囊列上一輪在不在、多高、跟著哪個捲動區：出現／消失時補 scrollTop 用 */
  const pinPrevRef = useRef<{ shown: boolean; h: number; scroller: HTMLDivElement | null }>({ shown: false, h: 0, scroller: null })
  /* 捲動區一掛上就記進 pinPrevRef（當下膠囊列在不在、多高）。不能等 useLayoutEffect：sheet 內容是 SpringSheet 之後才掛上的，
     那一輪 LogSheet 自己沒有 re-render，useLayoutEffect 不會跑，記住的還是「沒有捲動區」；接著「捲動→勾第一樣」（捲動不 re-render）
     就被當成捲動區換了而不補（v2.158 CI 抓到，本機測試先換了餐別多一次 render 才遮住）。膠囊列在 DOM 上排在捲動區前面，ref 先接上，這裡讀得到。 */
  const setListScroll = useCallback((el: HTMLDivElement | null) => {
    listScrollRef.current = el
    if (!el) return
    const pin = pinRef.current
    pinPrevRef.current = { shown: !!pin, h: pin ? pin.offsetHeight : pinPrevRef.current.h, scroller: el }
  }, [])

  const libById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods])
  /** 食品庫展開成的每一列（食物列＋通用食物的別名列），key → 列 */
  const rowByKey = useMemo(() => new Map(foods.flatMap((f) => [foodRow(f), ...aliasRowsOf(f)]).map((r) => [r.key, r])), [foods])
  const rowOf = (key: string): ListRow<Food> | undefined => extraRows.get(key) ?? rowByKey.get(key) ?? histRows.get(key)
  /** 選擇器用的 key：列 key 含空白與中文，放進屬性選擇器前要跳脫 */
  const sel = (attr: string, key: string) => `[${attr}="${CSS.escape(key)}"]`

  /* 「這一餐」段（spec「一個框記一餐」，v2.164）：框裡打完的每一段一列（entries，照打的順序）。對上食品庫的那一段直接勾好清單上那一列
     （在 picks，同清單勾選：份數、份量微調、別名的品名與店家）；估好的、檔位的、自己打的是草稿（drafts）。
     estReqRef：每次打開 sheet 遞增，關掉之後才回來的估算一律丟掉。 */
  const [entries, setEntries] = useState<MealEntry[]>([])
  const [drafts, setDrafts] = useState<EstimateDraft[]>([])
  /** 剛估好回來的草稿：播浮現與熱量從 0 滾上去；值＝在剛回來那一批裡的第幾樣（浮現的錯開只算這一批，一樣的不延遲）。播完就清掉（見下面的 effect）。 */
  const [fresh, setFresh] = useState<Map<string, number>>(new Map())
  /** 「這一餐」的讀屏播報 */
  const [said, setSaid] = useState('')
  /* 修正（spec A2 階段 1，v2.151）：每一列各自的框、修正字、送出狀態。修正中不能加入（結果會換掉那一列）。 */
  const [fixes, setFixes] = useState<Record<string, FixState>>({})
  const fixBusy = Object.values(fixes).some((f) => f.status === 'busy')
  const estReqRef = useRef(0)
  /** 待估列估好就卸載了（按下去的那顆「估」跟著不見）：焦點接到第一樣估好的那一列 */
  const focusDraftRef = useRef<string | null>(null)
  /** 框裡打完一段：捲回頂端，看得到「這一餐」剛多的那一列（不照膠囊列的補捲動——手指不在清單的哪一列上） */
  const toTopRef = useRef(false)
  /** ✕ 拿掉「這一餐」的一列之後焦點接到哪：下一列的 data-key；空字串＝沒有下一列，回框裡 */
  const focusNextRef = useRef<string | null>(null)
  /** await 回來時看「現在」的這一餐、勾選與草稿（閉包裡的是送出那一刻的） */
  const liveRef = useRef<{ entries: MealEntry[]; picks: Map<string, number>; drafts: EstimateDraft[] }>({ entries: [], picks: new Map(), drafts: [] })

  /* 開啟時重置整個 sheet 的本地狀態：每次打開都是一份新的 */
  useEffect(() => {
    if (!open) return
    setMeal(initialMeal)
    setView('list')
    setPicks(new Map())
    setQtyDrafts(new Map())
    setSuggestSnaps(new Map())
    setMods(new Map())
    setModsOpen(null)
    setFromLast(new Set())
    setExtraRows(new Map())
    setHistRows(new Map())
    setShopBusy(false)
    setShopErr(null)
    setQuery('')
    setFilterQuery('')
    setBusy(false)
    setErr(null)
    setFoodForm(BLANK_FOOD_FORM)
    setElsewhereOpen(false)
    setLastPicked(null)
    setJump(null)
    setFlash(null)
    /* pinPrevRef 刻意不在這裡重置：這個 effect 跑在補償的 useLayoutEffect 之後，而這裡的 setState 多半跟原值一樣、不會再 render，
       清掉（或在這時讀捲動區，此時常常還沒掛上）都會讓「打開→捲動→勾第一樣」（捲動不 re-render）判成捲動區換了而不補（v2.158 CI 抓到）。
       「捲動區換了就不補」由 useLayoutEffect 自己比對捲動區處理；關到一半又打開、清掉 picks 時往回補一行，SpringSheet 會把捲動歸零，看不出來。 */
    estReqRef.current++
    setEntries([])
    setDrafts([])
    setFresh(new Map())
    setSaid('')
    setFixes({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* 待估列估好回來就換成草稿列，原本的「估」鈕卸載、焦點掉到 body：接到第一樣估好的那一列（只在焦點真的掉了時） */
  useEffect(() => {
    liveRef.current = { entries, picks, drafts }
  })
  useEffect(() => {
    const key = focusDraftRef.current
    if (key === null) return
    focusDraftRef.current = null
    if (document.activeElement !== document.body) return
    listScrollRef.current?.querySelector<HTMLElement>(sel('data-key', key))?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])
  /* ✕ 拿掉「這一餐」的一列（按下去的 ✕ 跟著卸載）：焦點接到下一列，沒有下一列就回框裡。只在焦點真的掉了時 */
  useEffect(() => {
    const key = focusNextRef.current
    if (key === null) return
    focusNextRef.current = null
    if (document.activeElement !== document.body) return
    const el = key ? listScrollRef.current?.querySelector<HTMLElement>(sel('data-key', key)) : null
    const target = el ? (el.querySelector<HTMLElement>('.food-row') ?? el) : sheetRef.current?.querySelector<HTMLElement>('input[aria-label="吃了什麼"]')
    target?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])
  /* 浮現與熱量滾動播完（每樣錯開 90ms＋滾 600ms＋落定亮一圈）就清掉，從新增食物回來不重播 */
  useEffect(() => {
    if (fresh.size === 0) return
    const t = setTimeout(() => setFresh(new Map()), 2500)
    return () => clearTimeout(t)
  }, [fresh])

  /* 焦點接手：「全選」那顆鈕勾完全部就消失，接到建議段第一列；勾／取消勾那一列換了一棵 DOM，接回同一列。
     只在焦點真的掉了（落在 body）時接，不搶使用者已經移走的焦點。refocusRef 每一輪都先取出清掉：
     全選那一輪留下的值會在之後按加減時把焦點搶到建議段最後一列。 */
  useEffect(() => {
    const sc = listScrollRef.current
    const id = refocusRef.current
    refocusRef.current = null
    if (focusSuggestRef.current) {
      focusSuggestRef.current = false
      sc?.querySelector<HTMLElement>('.sect-suggest + .food-list .food-row')?.focus({ preventScroll: true })
      return
    }
    if (id === null || document.activeElement !== document.body) return
    /* 取消勾之後那一列可能整列不見（「別的餐勾的」、估一筆對到的那樣）：退回膠囊列第一顆，膠囊列也收了就回搜尋框 */
    const target =
      sc?.querySelector<HTMLElement>(`${sel('data-key', id)} .food-row`) ??
      pinRef.current?.querySelector<HTMLElement>('.pick-chip') ??
      sheetRef.current?.querySelector<HTMLElement>('input[aria-label="吃了什麼"]')
    target?.focus({ preventScroll: true })
  }, [picks])

  /* 膠囊列有勾才出現：出現那一刻把捲動區往下推一行，同一幀把 scrollTop 補回來，手指底下的列不動（消失時反過來）。
     捲動區換了一個（從新增食物回來、重新打開）就不補——新的捲動區本來就從頂端開始。 */
  useLayoutEffect(() => {
    const el = pinRef.current
    const sc = listScrollRef.current
    const prev = pinPrevRef.current
    const shown = !!el
    // 平常的 render 什麼都沒翻轉，不讀版面（offsetHeight 會逼一次排版）
    if (shown === prev.shown && sc === prev.scroller) return
    const h = el ? el.offsetHeight : prev.h
    if (sc && sc === prev.scroller) sc.scrollTop += shown ? h : -h
    pinPrevRef.current = { shown, h, scroller: sc }
  })

  useLayoutEffect(() => {
    if (!toTopRef.current) return
    toTopRef.current = false
    const sc = listScrollRef.current
    if (sc) sc.scrollTop = 0
  }, [entries])

  /* 最近勾的那顆膠囊捲進膠囊列看得到的範圍（只動膠囊列自己的 scrollLeft，不用 scrollIntoView——那會連 sheet 一起捲） */
  useLayoutEffect(() => {
    const row = chipsRef.current
    const chip = lastPicked === null ? null : row?.querySelector<HTMLElement>(sel('data-chip', lastPicked))
    if (!row || !chip) return
    // .pick-chips 是 position: relative，offsetLeft 直接是膠囊在列裡的位置；左右留內距那麼寬，描邊才不會被切掉
    const pad = parseFloat(getComputedStyle(row).paddingLeft) || 0
    const left = chip.offsetLeft - pad
    const right = chip.offsetLeft + chip.offsetWidth + pad
    if (left < row.scrollLeft) row.scrollLeft = left
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth
    // view：從新增食物回來膠囊列是新的一份，要重捲
  }, [lastPicked, view])

  /* 點膠囊：那一列捲到捲動區中間（減少動態就直接跳），閃一下在 jumpTo 就排好了。看不到的列（收合的「其他餐的」、被搜尋濾掉）
     在 jumpTo 已經先展開／清掉搜尋，這裡是它們畫出來之後的那一輪。 */
  useEffect(() => {
    if (!jump) return
    const sc = listScrollRef.current
    const el = sc?.querySelector<HTMLElement>(sel('data-key', jump.id))
    if (!sc || !el) return
    const cr = sc.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const top = sc.scrollTop + er.top - cr.top - Math.max(0, (cr.height - er.height) / 2)
    sc.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    // 焦點跟著到那一列（鍵盤、讀屏才接得下去）；草稿列沒有 .food-row，焦點給那一列本身。preventScroll，不跟上面的 smooth 捲動搶
    if (jump.focus !== false) (el.querySelector<HTMLElement>('.food-row') ?? el).focus({ preventScroll: true })
  }, [jump])

  useEffect(() => {
    /* 每次打開都重撈一次（v2.156 review）：「照上次」要看最近一筆，同一次開 app 裡午餐剛記的中杯微糖，晚餐再開就要帶得到。
       收起時放掉旗標；旗標只擋「同一次打開裡重複觸發」。 */
    if (!open) {
      recentFetchedRef.current = false
      return
    }
    if (recentFetchedRef.current) return
    recentFetchedRef.current = true
    void (async () => {
      try {
        const hist = await listRecentIntake()
        // 紀錄接回清單上的列：記的品名＋店家對得上某個「店家 品名」別名就是那個別名列（常吃、照上次、上次份量都以列為單位）
        const stats = recentStats(hist, (r) => rowKeyOfIntake(r, libById.get(r.food_id)))
        const records = new Map<string, ListRow<Food>>()
        for (const r of hist) {
          const f = libById.get(r.food_id)
          const k = rowKeyOfIntake(r, f)
          if (f && k.startsWith('r:') && !records.has(k)) records.set(k, recordRow(f, r.name?.trim() || null, r.vendor?.trim() || null))
        }
        setHistRows(records)
        setRank(recencyRank(hist))
        setLastQty(stats.lastQty)
        setLastMods(stats.lastMods)
        setRecent(stats.recent)
        setMealCounts(stats.counts)
      } catch {
        /* 常吃只是排序優化，撈不到不影響「全部食物」清單能不能用，也不用打全域 Notice */
      }
    })()
    // libById 用打開那一刻的就好（別名列對應只看食品庫的別名）；不能放進依賴——食品庫一變就重撈整份歷史
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* 進表單時品名已經是搜尋字串帶進來的（openFoodForm 的 prefillName），下一個該落焦的
     是店家，不是熱量——原本直接 focus 熱量會跳過店家，真機回報「順序不對」（2026-08-02）。
     這個行為現在由 FoodFormFields 的 `vendorAutoFocus` 承擔（表單是在 view 切過去時才
     掛載的，元件自己的 mount effect 等價於原本這個 [view] effect）。 */

  function togglePick(key: string) {
    setErr(null)
    refocusRef.current = key
    setPicks((prev) => {
      const next = new Map(prev)
      if (next.has(key)) {
        next.delete(key)
        setQtyDrafts((d) => {
          const nd = new Map(d)
          nd.delete(key)
          return nd
        })
        setSuggestSnaps((s) => {
          const ns = new Map(s)
          ns.delete(key)
          return ns
        })
        setMods((m) => {
          const nm = new Map(m)
          nm.delete(key)
          return nm
        })
        setFromLast((l) => {
          const nl2 = new Set(l)
          nl2.delete(key)
          return nl2
        })
        setExtraRows((x) => {
          if (!x.has(key)) return x
          const nx = new Map(x)
          nx.delete(key)
          return nx
        })
        setModsOpen((o) => (o === key ? null : o))
        setLastPicked((l) => (l === key ? null : l))
      } else {
        next.set(key, startPick(key))
      }
      return next
    })
  }

  /** 勾起一列（清單勾、框裡對上的那一段）：份量照這一餐上次吃的，照上次的微調預設帶上。回份量給呼叫端放進 picks。 */
  function startPick(key: string): number {
    setLastPicked(key)
    const q = defaultQty(lastQty, meal, key)
    setQtyDrafts((d) => new Map(d).set(key, String(q)))
    // 照上次：這一列最近一筆按過微調就預設帶上（清掉現在已不適用的代碼）。店家不用帶：店家就是這一列（別名列）
    const f = libById.get(foodIdOf(key))
    const prevMods = f ? normalizeMods(lastMods.get(key) ?? [], f) : []
    if (prevMods.length) {
      setMods((m) => new Map(m).set(key, prevMods))
      setFromLast((l) => new Set(l).add(key))
    }
    return q
  }

  /** 建議段那一樣在清單上是哪一列：來源紀錄的品名＋店家對得上別名就是那個別名列。 */
  const suggestKey = (item: RepeatItem): string => rowKeyOfIntake({ food_id: item.food_id, name: item.name, vendor: item.intakeVendor }, libById.get(item.food_id))

  /* 建議段勾起來（v2.158 起也出微調）：微調預設帶來源那一筆按的、標「照上次」。沒動就照來源的快照數字記；
     動了（跟來源那組不一樣）才從食品庫的基準重算，見 pickedRow。品名與店家照來源那一筆記的（同營養快照）。 */
  function pickSuggested(item: RepeatItem) {
    const key = suggestKey(item)
    setErr(null)
    refocusRef.current = key
    setLastPicked(key)
    setPicks((prev) => new Map(prev).set(key, item.qty))
    setQtyDrafts((prev) => new Map(prev).set(key, String(item.qty)))
    setSuggestSnaps((prev) => new Map(prev).set(key, { food: suggestedFood(item), name: item.name, mods: item.mods, vendor: item.intakeVendor }))
    const lib = libById.get(item.food_id)
    const m = lib ? normalizeMods(item.mods, lib) : []
    setMods((prev) => {
      const next = new Map(prev)
      if (m.length) next.set(key, m)
      else next.delete(key)
      return next
    })
    // 「照上次」不存狀態：render 時看現在按的跟來源那組一不一樣（snapSame），改了再改回原樣會重新出現
    setFromLast((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  function stepQty(key: string, dir: 1 | -1) {
    const cur = picks.get(key) ?? 1
    const next = normalizeQty(cur + dir)
    setPicks((prev) => new Map(prev).set(key, next))
    setQtyDrafts((prev) => new Map(prev).set(key, String(next)))
  }

  /* 打字途中不正規化——"1." 這種中間狀態被改成 1 的話游標會跳走。值先寬鬆收下
     （能解析成正數就先更新 picks 讓小計跟著動），正規化留到 onBlur 再做 */
  function handleQtyInput(key: string, raw: string) {
    setQtyDrafts((prev) => new Map(prev).set(key, raw))
    const n = parseTypedQty(raw)
    if (n !== null) setPicks((prev) => new Map(prev).set(key, n))
  }

  function handleQtyBlur(key: string, raw: string) {
    const n = normalizeQty(raw)
    setPicks((prev) => new Map(prev).set(key, n))
    setQtyDrafts((prev) => new Map(prev).set(key, String(n)))
  }

  function setRowMods(key: string, m: string[]) {
    setMods((prev) => new Map(prev).set(key, m))
    // 自己按過就不再是「照上次」
    setFromLast((l) => {
      if (!l.has(key)) return l
      const n = new Set(l)
      n.delete(key)
      return n
    })
  }

  /** 勾起來那一列的微調基準：食品庫那一筆；封存的（foods 查不到）沒有基準，不出微調。 */
  const modsBase = (key: string): Food | undefined => libById.get(foodIdOf(key))

  /** 勾起來那一列顯示的食物：建議段勾的是來源快照；別名列的品名與店家是別名的。出微調時品名不接「（中杯・微糖）」——微調的狀態寫在下面那一行，改了才不會對不上。 */
  function pickedFood(key: string): Food | undefined {
    const snap = suggestSnaps.get(key)
    const lib = libById.get(foodIdOf(key))
    if (snap) return lib ? { ...snap.food, name: snap.name ?? lib.name } : snap.food
    const row = rowOf(key)
    if (!lib) return row?.food
    return row ? { ...lib, name: row.name, vendor: row.vendor } : lib
  }

  /* 勾起來那一筆實際要記的單份值與 mods。建議段勾的：微調跟來源那組一樣（沒動）就照搬快照數字與 mods，不重算；
     動了就跟一般勾選一樣，從食品庫的基準套上這次按的。 */
  /** 建議段勾的那一列，微調跟來源那一筆一不一樣（不是建議段勾的＝undefined）。封存的沒有微調可改，永遠算一樣。 */
  function snapSame(key: string): boolean | undefined {
    const snap = suggestSnaps.get(key)
    if (!snap) return undefined
    const lib = libById.get(foodIdOf(key))
    return !lib || normalizeMods(snap.mods, lib).join() === normalizeMods(mods.get(key) ?? [], lib).join()
  }

  function pickedRow(key: string): { food: Food; mods: string[] } | undefined {
    const snap = suggestSnaps.get(key)
    const lib = libById.get(foodIdOf(key))
    if (snap && snapSame(key)) return { food: snap.food, mods: snap.mods }
    if (!lib) return undefined
    const m = normalizeMods(mods.get(key) ?? [], lib)
    if (!m.length) return { food: lib, mods: m }
    return { food: { ...lib, ...applyMods({ kcal: num(lib.kcal), protein: num(lib.protein), fat: num(lib.fat), carb: num(lib.carb) }, m, lib).result }, mods: m }
  }

  /** 寫進 intake 的品名與店家：建議段勾的照來源那一筆；別名列（含新店卡的）記別名的；食物列不記。 */
  function pickedIntake(key: string): { name: string | null; vendor: string | null } {
    const snap = suggestSnaps.get(key)
    if (snap) return { name: snap.name, vendor: snap.vendor }
    const row = rowOf(key)
    return row ? rowIntake(row) : { name: null, vendor: null }
  }

  /* 「吃了什麼？」框（spec「一個框記一餐」）：受控 input（value 一直等於 query，顯示不會被打斷）；filterQuery 才是拿去
     過濾清單的值（框裡正在打的那一段＝搜尋）。組字中（注音／拼音 compositionstart～end）不過濾、也不切段，組字結束那一刻才補上。
     打出段落符號（mealBox.BOX_SEPARATOR）＝前面那段打完、移出框；按完成（Enter）＝最後那段也移出。 */
  function applyBox(v: string, final: boolean) {
    // 寫入中框是唯讀的（readOnly 擋打字，這裡擋 Enter／組字結束）：這時收進來的段落會被寫完關掉的 sheet 一起丟掉
    if (busy) return
    const { committed, rest } = splitBox(v, final)
    if (committed.length) commitSegments(committed)
    const next = committed.length || final ? rest : v
    setQuery(next)
    setFilterQuery(next)
  }
  function handleQueryChange(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    if (composingRef.current) return setQuery(v)
    applyBox(v, false)
  }
  function handleCompositionStart() {
    composingRef.current = true
  }
  function handleCompositionEnd(e: CompositionEvent<HTMLInputElement>) {
    composingRef.current = false
    applyBox(e.currentTarget.value, false)
  }
  function handleBoxKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // 注音選字中按 Enter 是在選字，不是打完。keyCode 229＝輸入法還在處理這個鍵（iOS／部分瀏覽器組字剛結束的那一下 isComposing 已經是 false）
    if (e.key !== 'Enter' || composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    e.preventDefault()
    applyBox(query, true)
  }
  /** 貼上一整句（含段落符號）：一次全部切成列，最後那段也算打完（AC 8）。沒有段落符號的照一般打字。 */
  function handleBoxPaste(e: ClipboardEvent<HTMLInputElement>) {
    const t = e.clipboardData.getData('text')
    if (!BOX_SEPARATOR.test(t)) return
    e.preventDefault()
    // 貼在游標的位置（有選取就取代選取的字），不是一律接在最後
    const el = e.currentTarget
    const start = el.selectionStart ?? query.length
    const end = el.selectionEnd ?? start
    applyBox(query.slice(0, start) + t + query.slice(end), true)
  }

  /** 草稿裡的食品庫列對應清單上的哪一列（同一個 key 就是同一樣）；不是食品庫列＝null */
  const libDraftKey = (d: EstimateDraft): string | null => (d.lib ? (d.lib.alias ? aliasKey(d.lib.food.id, d.lib.alias.alias) : foodKey(d.lib.food.id)) : null)
  /** 還沒建好食物的食品庫草稿：列 key → 草稿 key */
  const libDraftsOf = (ds: readonly EstimateDraft[]) =>
    new Map(ds.flatMap((d): [string, string][] => { const k = libDraftKey(d); return k && d.foodId === null ? [[k, d.key]] : [] }))
  const bumpDraft = (draftKey: string, by: number) => patchDraft(draftKey, (d) => withLibQty(d, normalizeQty((d.lib?.qty ?? 0) + by)))
  /** 勾著的列多 by 份 */
  function bumpPicks(keys: readonly string[]) {
    if (!keys.length) return
    setPicks((prev) => {
      const next = new Map(prev)
      for (const k of keys) next.set(k, normalizeQty((next.get(k) ?? 0) + 1))
      setQtyDrafts((d) => {
        const nd = new Map(d)
        for (const k of keys) nd.set(k, String(next.get(k)))
        return nd
      })
      return next
    })
  }
  /** 只捲過去、閃一下（不搶焦點）：框裡打的那段只是讓已經在的那一列多一份，讓人看到加到哪了 */
  function flashRow(key: string) {
    const seq = (jump?.seq ?? 0) + 1
    setJump({ id: key, seq, focus: false })
    setFlash({ id: key, seq })
  }

  /** 打完的幾段放進「這一餐」：對上食品庫的勾好那一列（同一批打兩次＝2 份）；那一列已經在了（勾著的、這一餐的食品庫草稿）就多一份；對不上的變待估。 */
  function commitSegments(segs: string[]) {
    const libDrafts = libDraftsOf(drafts)
    const { add, counts, bump } = entriesFromSegments(segs, foods, rank, new Set([...picks.keys(), ...libDrafts.keys()]))
    setErr(null)
    if (add.length) {
      toTopRef.current = true
      setEntries((prev) => [...prev, ...add])
    }
    const newPicks = add.flatMap((e) => (e.kind === 'pick' ? [e.key] : []))
    if (newPicks.length)
      setPicks((prev) => {
        const next = new Map(prev)
        for (const k of newPicks) {
          const q = startPick(k)
          next.set(k, counts.get(k) ?? q)
        }
        setQtyDrafts((d) => {
          const nd = new Map(d)
          for (const k of counts.keys()) nd.set(k, String(next.get(k)))
          return nd
        })
        return next
      })
    bumpPicks(bump.filter((k) => !libDrafts.has(k)))
    for (const k of bump) {
      const dk = libDrafts.get(k)
      if (dk) bumpDraft(dk, 1)
    }
    // 只多了一份、沒有新的列：捲到那一列閃一下（不捲回頂端，也不搶框裡的焦點）
    if (!add.length && bump.length) {
      const k = bump[bump.length - 1]
      flashRow(libDrafts.get(k) ?? k)
    }
  }

  function openFoodForm(prefillName: string) {
    // 回來時草稿重掛，不要再播一次浮現與滾動
    setFresh(new Map())
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

  const patchPending = (id: string, patch: Partial<Extract<MealEntry, { kind: 'pending' }>>) =>
    setEntries((prev) => prev.map((e) => (e.id === id && e.kind === 'pending' ? { ...e, ...patch } : e)))

  /* 估一段（spec「一個框記一餐」）：只送這一段（店家也只認這一段寫的）；回來一樣或好幾樣就在原位換成草稿列、勾上。
     AI 回的品名完全對上食品庫的照舊換成食品庫列（resolveAfterAi）。失敗只那一列留錯誤與「重試」。關掉 sheet 之後才回來的丟掉。 */
  async function estimatePending(e: Extract<MealEntry, { kind: 'pending' }>) {
    if (e.status === 'busy' || busy) return
    const gen = estReqRef.current
    patchPending(e.id, { status: 'busy', startedAt: Date.now(), tiers: false })
    // 等的說法唸一次（秒數不唸，不然每秒唸一次）
    setSaid('在看你吃了什麼…')
    try {
      const items = await estimateMeal(e.text)
      if (gen !== estReqRef.current) return
      const live = liveRef.current
      // 那一列已經不在了（關掉、拿掉）：結果丟掉，不留沒有列的草稿
      if (!live.entries.some((x) => x.id === e.id)) return
      const all = resolveAfterAi(items, e.text, foods, rank)
      /* AI 回的品名對上的那一樣已經在這一餐了（勾著的、別的食品庫草稿）：那一列多一份，不再多一列（L2） */
      const libDrafts = libDraftsOf(live.drafts)
      const ds: EstimateDraft[] = []
      const pickBumps: string[] = []
      for (const d of all) {
        const k = libDraftKey(d)
        if (k && live.picks.has(k)) pickBumps.push(k)
        else if (k && libDrafts.has(k)) bumpDraft(libDrafts.get(k) as string, 1)
        else ds.push(d)
      }
      setDrafts((prev) => [...prev, ...ds])
      setEntries((prev) => replaceEntry(prev, e.id, ds.map((d) => draftEntry(d.key))))
      bumpPicks(pickBumps)
      setFresh((prev) => new Map([...prev, ...ds.map((d, i): [string, number] => [d.key, i])]))
      if (ds.length) {
        focusDraftRef.current = ds[0].key
        setLastPicked(ds[0].key)
      } else {
        focusNextRef.current = ''
      }
      setSaid(`估好了：${all.map((d) => `${draftName(d, meal ?? 'dinner')} ${d.kcal} 卡`).join('、')}${pickBumps.length || ds.length < all.length ? '（已經在這一餐的多記一份）' : ''}`)
    } catch {
      if (gen !== estReqRef.current) return
      patchPending(e.id, { status: 'error', startedAt: null })
      // 那一列自己的 role=alert 會唸，這裡不再唸第二次
      setSaid('')
    }
  }
  function estimateById(id: string) {
    const e = entries.find((x) => x.id === id)
    if (e?.kind === 'pending') void estimatePending(e)
  }
  /** 「全部估」：每一列待估各自送、各自回來 */
  function estimateAll() {
    for (const e of entries) if (e.kind === 'pending' && e.status !== 'busy') void estimatePending(e)
  }
  /** 只記熱量：待估那一列換成檔位或自己打的熱量列（三大照這一餐的歷史比例，v2.142） */
  function pendingToDraft(id: string, d: EstimateDraft) {
    setDrafts((prev) => [...prev, d])
    setEntries((prev) => replaceEntry(prev, id, [draftEntry(d.key)]))
    focusDraftRef.current = d.key
    setLastPicked(d.key)
  }
  /** ✕ 拿掉「這一餐」的一列之前記下焦點要接去哪：下一列，沒有就回框裡 */
  function focusAfterRemoving(id: string) {
    const i = entries.findIndex((x) => x.id === id)
    const next = i >= 0 ? entries[i + 1] : undefined
    focusNextRef.current = next ? entryDomKey(next) : ''
  }
  function removePending(id: string) {
    focusAfterRemoving(id)
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }
  const ratio = meal ? (props.macroRatios[meal] ?? null) : null
  /** 待估列的相近提示按「改用」：那一列換成食品庫那一筆（勾好），那一段寫的店家與別名不丟（mealBox.adoptRow）；那一列已經勾著就多一份。 */
  function adoptPending(id: string, foodId: number) {
    const e = entries.find((x) => x.id === id)
    const f = foods.find((x) => x.id === foodId)
    if (e?.kind !== 'pending' || !f) return
    const { key, row } = adoptRow(e.text, f, vendorOptions)
    if (row) setExtraRows((prev) => new Map(prev).set(row.key, row))
    if (picks.has(key)) {
      focusAfterRemoving(id)
      setEntries((prev) => prev.filter((x) => x.id !== id))
      bumpPicks([key])
      return
    }
    setEntries((prev) => replaceEntry(prev, id, [pickEntry(key)]))
    refocusRef.current = key
    setPicks((prev) => new Map(prev).set(key, startPick(key)))
  }
  /** 「這一餐」裡勾好的那一列取消勾：那一列整個拿掉（它不在清單其他段） */
  function dropSegmentPick(key: string) {
    setEntries((prev) => prev.filter((e) => !(e.kind === 'pick' && e.key === key)))
    togglePick(key)
  }
  /** 刪掉一列草稿（已經建好食物、等重試的不能刪） */
  function deleteDraft(key: string) {
    const d = drafts.find((x) => x.key === key)
    if (!d || d.foodId !== null) return
    const entry = entries.find((e) => e.kind === 'draft' && e.key === key)
    if (entry) focusAfterRemoving(entry.id)
    setDrafts((prev) => prev.filter((x) => x.key !== key))
    setEntries((prev) => prev.filter((e) => !(e.kind === 'draft' && e.key === key)))
  }

  /* 食品庫列按「改用 AI 估」：換回 AI 那一樣（記著換之前 AI 給的那一樣），之後不再自動換、不再提示。 */
  function libToAi(key: string) {
    if (fixBusy) return
    patchDraft(key, backToAi)
  }

  /** 相近提示按「改用」、或查重提示按「改用那筆」：那一列換成食品庫的那一筆。 */
  function adoptFood(key: string, foodId: number) {
    const f = foods.find((x) => x.id === foodId)
    if (f) patchDraft(key, (d) => (d.foodId === null && !d.lib ? adoptNear(d, f) : d))
  }

  const patchDraft = (key: string, fn: (d: EstimateDraft) => EstimateDraft) => setDrafts((prev) => prev.map((d) => (d.key === key ? fn(d) : d)))
  const patchFix = (key: string, patch: Partial<FixState>) =>
    setFixes((prev) => ({ ...prev, [key]: { ...(prev[key] ?? FIX_IDLE), ...patch } }))

  /* 修正一樣：送原句＋那一列目前的估算＋修正字，只換那一列。回來時那一列不在了（重估換掉、刪掉、已建食物）就丟掉結果。
     失敗那一列維持原樣，修正字留著，按「重試」再送。 */
  async function submitFix(key: string) {
    const d = drafts.find((x) => x.key === key)
    const f = fixes[key]
    if (!d || !f || !canFix(d) || !fixTextOk(f.text) || fixBusy) return
    const text = f.text.trim()
    patchFix(key, { status: 'busy' })
    try {
      const it = await estimateFix(d.sentence as string, fixRequestItem(d), text)
      const next = applyFix(d, it, text)
      setDrafts((prev) => prev.map((x) => (x.key === key && x.foodId === null ? applyFix(x, it, text) : x)))
      patchFix(key, { open: false, text: '', status: 'idle' })
      setSaid(`已照「${fixTag(text)}」修正，${draftName(next, meal ?? 'dinner')} ${next.kcal} 卡`)
    } catch {
      patchFix(key, { status: 'error' })
    }
  }

  /* 「加入」：清單勾的、「這一餐」勾好的與草稿一次寫入。
     草稿要先建 foods（沒勾存進食品庫就建立即封存）、記下 id，再跟勾的食物一起寫 intake。
     中途失敗按重試：已經有 id 的草稿不再建一次，不會在食品庫留下重複的列。
     還有待估的列、或有一列在估或修正中時不能加入（待估沒有數字，加入就靜靜少一樣；估回來會換掉那一列）。 */
  const addBlocked = unresolved(entries) > 0 || fixBusy
  async function submitPicks() {
    if ((picks.size === 0 && drafts.length === 0) || busy || !meal || addBlocked) return
    setBusy(true)
    setErr(null)
    const rows: NewIntake[] = []
    for (const [key, qty] of picks) {
      const row = pickedRow(key)
      if (!row) continue
      const { food: f, mods: m } = row
      // 沒調就不帶 mods（DB 預設空陣列）：跟一鍵加入、估一筆的寫入同一個形狀
      // 品名與店家跟著這一列：別名列記「紅萱波波」「麻古」，建議段照來源那一筆，食物列不記（spec「記店家改版」）
      const { name, vendor } = pickedIntake(key)
      rows.push({ eaten_on: dayData.date, meal, food_id: foodIdOf(key), qty, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb, name, ...(m.length ? { mods: m } : {}), ...(vendor ? { vendor } : {}) })
    }
    /* 勾了「存進食品庫」、但食品庫已有同名同店家的：不再存一筆（AC 13）。在估一筆那一列有「改用那筆」，這裡只擋下說原因 */
    const hit = drafts
      .filter((d) => !d.lib && d.keep && d.foodId === null)
      .map((d) => duplicateCheck({ name: draftName(d, meal), vendor: null }, foods).block)
      .find((b) => b !== null)
    if (hit) {
      setBusy(false)
      setErr(`食品庫已有「${foodLabel(hit)}」，在那一列改用那筆，或取消勾「存進食品庫」`)
      return
    }
    try {
      const done: EstimateDraft[] = []
      for (const d of drafts) {
        if (d.foodId !== null || d.lib) {
          done.push(d)
          continue
        }
        const created = await onCreateEstimateFood(draftToFood(d, meal), d.keep)
        // 品名跟著定下來：之後換了餐別，已建的食物仍是這個名字，草稿也不能再跟著變（re-review M1）
        const withId = { ...d, name: created.name, foodId: created.id }
        done.push(withId)
        patchDraft(d.key, () => withId)
      }
      await onCreateIntake([...rows, ...draftsToIntake(done, meal, dayData.date, vendorOptions)])
      /* 成功後 App 會把 open 翻成 false，交給 SpringSheet 播退場 spring；不在這裡手動 setBusy(false)——
         下次開啟時 open 的 reset effect 會處理 */
    } catch (e) {
      setBusy(false)
      setErr(friendlyError(errMsg(e)))
    }
  }

  /* 新增時查重（AC 13）：同店家同品名（或別名）擋下、給「改用那筆」；只有品名一樣、店家不同就一行提醒、照樣能存。邊打邊算。 */
  const formDup = duplicateCheck({ name: foodForm.name, vendor: foodForm.vendor.trim() || null, aliases: foodForm.aliases }, foods)

  /** 查重擋下時「改用那筆」：不新增，直接把食品庫那一筆勾起來回清單。 */
  function pickExisting(id: number) {
    const key = foodKey(id)
    setPicks((prev) => (prev.has(key) ? prev : new Map(prev).set(key, 1)))
    setQtyDrafts((prev) => (prev.has(key) ? prev : new Map(prev).set(key, '1')))
    setLastPicked(key)
    setView('list')
    setQuery('')
    setFilterQuery('')
    setErr(null)
  }

  /* 新店第一次（spec「記店家改版」甲3）：用那筆通用食物的數字，品名與店家從搜尋字切；勾「記住」先把搜尋字加成它的別名
     （成功後食品庫長出同一個 key 的別名列，這一列就落回原位），存不進去就留在卡上，不勾。勾完照舊要按「加入」才寫。 */
  async function pickShop(f: Food, remember: boolean) {
    if (shopBusy) return
    const row = shopRow(f, trimmedQuery)
    if (remember) {
      const next = withAlias(f.aliases, trimmedQuery)
      if (Array.isArray(next)) {
        setShopBusy(true)
        setShopErr(null)
        try {
          await onUpdateFood(f.id, { aliases: next })
        } catch (e) {
          setShopBusy(false)
          setShopErr(`別名存不進去：${friendlyError(errMsg(e))}`)
          return
        }
        setShopBusy(false)
      }
    }
    setExtraRows((prev) => new Map(prev).set(row.key, row))
    setPicks((prev) => (prev.has(row.key) ? prev : new Map(prev).set(row.key, 1)))
    setQtyDrafts((prev) => (prev.has(row.key) ? prev : new Map(prev).set(row.key, '1')))
    setLastPicked(row.key)
    refocusRef.current = row.key
    setQuery('')
    setFilterQuery('')
    setShopErr(null)
    setErr(null)
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
      /* 新增完直接選起來，回清單由底部確認列承接——這顆按鈕只承諾「加入食品庫」，
         真正記進 intake 仍要按「加入」，兩件事分開才不會以為記完就關掉 app */
      setPicks((prev) => new Map(prev).set(foodKey(created.id), 1))
      setQtyDrafts((prev) => new Map(prev).set(foodKey(created.id), '1'))
      setLastPicked(foodKey(created.id))
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
  /** 這天已經有紀錄的餐：餐別膠囊前面打勾。 */
  const loggedMeals = new Set((dayData.rows ?? []).map((r) => r.meal))
  const totals = pickTotals(picks, (key) => pickedRow(key)?.food)
  const addOn = (t: IntakeTotals): IntakeTotals => ({
    kcal: eaten.kcal + t.kcal,
    protein: eaten.protein + t.protein,
    fat: eaten.fat + t.fat,
    carb: eaten.carb + t.carb,
  })
  const estTotals = estimateTotals(drafts)
  const waitingCount = waiting(entries)
  /* 確認列與逐筆超標預警看的是「勾的＋這一餐的草稿」合起來 */
  const allTotals = {
    n: totals.n + estTotals.n,
    kcal: totals.kcal + estTotals.kcal,
    protein: totals.protein + estTotals.protein,
    fat: totals.fat + estTotals.fat,
    carb: totals.carb + estTotals.carb,
  }
  const combined: IntakeTotals = addOn(allTotals)

  /* 底部確認列。清單的勾選與「這一餐」的草稿共用：小計、剩餘、三大營養素（＋這次）、加入鈕與失敗重試都同一套規則。 */
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
        {waitingCount > 0 && <p className="pick-hint">還有 {waitingCount} 樣沒估：按「估」或「只記熱量」，不要的按 ✕</p>}
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
  const overAmounts = overQuotaAmounts(sortedFoods, (f) => defaultQty(lastQty, meal, foodKey(f.id)), eaten, targets)
  /* 店家 Autocomplete 的選項來源（新增食物表單）：foods 上的 vendor 字串去重排序，不建專屬資料表——
     去重就是清單，建表要付新表＋外鍵＋遷移＋RLS 的代價卻買不到東西。
     規則本體在 lib（食品庫那邊也要用同一套，v2.29 precommit-review 抓到重複實作）。 */
  const vendorOptions = useMemo(() => vendorOptionsOf(foods), [foods])
  const catById = useMemo(() => new Map(foods.map((f) => [f.id, categoryOf(f.category)])), [foods])
  const trimmedQuery = filterQuery.trim()
  const handlers: FoodRowHandlers = {
    picks,
    qtyDrafts,
    onToggle: togglePick,
    onStep: stepQty,
    onQtyInput: handleQtyInput,
    onQtyBlur: handleQtyBlur,
    combined,
    targets,
    defaultQty: (key) => defaultQty(lastQty, meal, key),
    overAmounts,
    mods,
    modsOpen,
    isFromLast: (key) => {
      const same = snapSame(key)
      if (same === undefined) return fromLast.has(key)
      return same && (mods.get(key) ?? []).length > 0
    },
    modsNote: (key) => {
      const snap = suggestSnaps.get(key)
      return snap && snapSame(key) ? `沒改就照上次記的每份 ${Math.round(num(snap.food.kcal))} 卡；改了用食品庫現在的數字重算` : undefined
    },
    modsBase,
    pickedFood,
    onToggleModsOpen: (key) => setModsOpen((o) => (o === key ? null : key)),
    onMods: setRowMods,
    query: filterQuery,
    busy,
    flash,
    onFlashEnd: () => setFlash(null),
  }

  /* 「這一餐」草稿裡的食品庫列不列成可勾的列：再勾一次就寫兩筆同一樣（v2.154 review M1）。已經勾著的照舊留在原位。
     勾了的不再從清單拿掉（v2.158）：列留在原位，所以同一列不重複出現的規則只剩「這一餐先、建議段、常吃、全部最後」。 */
  const hiddenKeys = new Set<string>(drafts.flatMap((d) => (d.lib ? [d.lib.alias ? aliasKey(d.lib.food.id, d.lib.alias.alias) : foodKey(d.lib.food.id)] : [])))
  /** 框裡打完、對上食品庫的那幾列：畫在「這一餐」段，清單其他段不再出現 */
  const segKeys = new Set(entries.flatMap((e) => (e.kind === 'pick' && picks.has(e.key) ? [e.key] : [])))
  /* 新店卡勾的列一律放最上面「剛加的」（記住之後食品庫也長出同一列，可能落在收合的「其他餐的」裡，看不到剛加了什麼） */
  const visible = (r: ListRow<Food>) => !segKeys.has(r.key) && (!hiddenKeys.has(r.key) || picks.has(r.key))
  const shown = (r: ListRow<Food>) => !extraRows.has(r.key) && visible(r)

  /* 建議段：該餐已有紀錄或沒有來源時 repeatByMeal 就沒有這一餐。同一列不同時出現在建議與常吃／全部，所以兩段都要先濾再取。
     搜尋時也照算：點膠囊捲過去要知道那一列在不在收合的「其他餐的」裡。 */
  const suggestion = meal ? repeatByMeal[meal] : undefined
  const suggestRows = (suggestion ? mergeByKey(suggestion.items, suggestKey) : [])
    .map((i): ListRow<Food> & { item: RepeatItem } => ({ key: suggestKey(i), id: i.food_id, category: i.category, food: suggestedFood(i), name: i.label, vendor: i.vendor, alias: null, item: i }))
    .filter(shown)
  const suggestKeys = new Set(suggestRows.map((r) => r.key))
  const suggestLeft = suggestRows.filter((r) => !picks.has(r.key))
  /* 預覽（逐筆超標）與勾下去的份量同源，都是建議量，不是「該餐上次的份量」。勾著的再點一下就是取消。 */
  const suggestHandlers: FoodRowHandlers = {
    ...handlers,
    onToggle: (key) => {
      if (picks.has(key)) return togglePick(key)
      const r = suggestRows.find((x) => x.key === key)
      if (r) pickSuggested(r.item)
    },
    defaultQty: (key) => suggestRows.find((x) => x.key === key)?.item.qty ?? 1,
  }
  const recentKeys = (meal ? recent?.get(meal) : undefined) ?? []
  const recentRows = recentKeys
    .map((k) => rowByKey.get(k) ?? histRows.get(k))
    .filter((r): r is ListRow<Food> => !!r && shown(r) && !suggestKeys.has(r.key))
    .slice(0, 5)
  const recentKeySet = new Set(recentRows.map((r) => r.key))
  /* 全部食物：通用食物（掛了「店家 品名」別名的）拆成別名列進類型分組，它自己那列放到最下面「通用（說不出哪家）」；
     其餘照舊一筆一列。列照列上的品名排，再套軟性排序（spec「記店家改版」）。 */
  const allRows = sortedFoods.flatMap((f) => (isGeneric(f) ? aliasRowsOf(f) : [foodRow(f)]))
  allRows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant-u-co-stroke'))
  const restRows = byQuotaFit(allRows.filter((r) => shown(r) && !suggestKeys.has(r.key) && !recentKeySet.has(r.key)), overAmounts)
  const genericRows = sortedFoods.filter(isGeneric).map(foodRow).filter((r) => shown(r) && !suggestKeys.has(r.key) && !recentKeySet.has(r.key))
  /* 依類型分組：組序看這一餐吃過幾次（常吃那份歷史），組內沿用軟性排序；只在其他餐吃過的類型收在最底。
     次數要用整個食品庫查類型，不能只看 restRows——已勾、常吃那幾樣也是這一類吃過的次數。 */
  const grouped = groupByCategory(restRows, meal, mealCounts, (id) => catById.get(id))
  const elsewhereKeys = new Set(grouped.elsewhere.flatMap((g) => g.foods.map((r) => r.key)))
  /* 勾著、但哪一段都沒有它的：建議段勾的封存食物（切了餐別之後）、新店卡勾的（沒記住別名）。不收進任何一段就會從畫面上消失，放在上面單獨一段 */
  const listedKeys = new Set([...segKeys, ...suggestKeys, ...recentKeySet, ...restRows.map((r) => r.key), ...genericRows.map((r) => r.key)])
  const strays = [...picks.keys()]
    .filter((key) => !listedKeys.has(key))
    .map((key): ListRow<Food> | undefined => {
      const row = rowOf(key)
      if (row) return row
      const f = pickedFood(key)
      return f && { key, id: foodIdOf(key), category: f.category, food: f, name: f.name, vendor: f.vendor, alias: null }
    })
    .filter((r): r is ListRow<Food> => !!r)

  /* 點膠囊：那一列現在沒畫出來（被搜尋濾掉、在收合的「其他餐的」裡）就先清掉搜尋／展開，下一輪畫出來再捲過去 */
  function jumpTo(key: string) {
    const seq = (jump?.seq ?? 0) + 1
    if (!listScrollRef.current?.querySelector(sel('data-key', key))) {
      if (query) {
        setQuery('')
        setFilterQuery('')
      }
      if (elsewhereKeys.has(key)) setElsewhereOpen(true)
    }
    setJump({ id: key, seq })
    setFlash({ id: key, seq })
  }

  /** 「這一餐」裡勾好的那一列：取消勾＝整列拿掉 */
  const segHandlers: FoodRowHandlers = { ...handlers, onToggle: dropSegmentPick }
  /** 列的資料查不到（封存的食物）：照勾起來的那一筆畫 */
  const strayRow = (key: string): ListRow<Food> => {
    const f = pickedFood(key) ?? { id: foodIdOf(key), name: '', vendor: null, kcal: 0, protein: 0, fat: 0, carb: 0, archived: true, category: null, category_manual: false, verified: false, aliases: [] }
    return { key, id: foodIdOf(key), category: f.category, food: f, name: f.name, vendor: f.vendor, alias: null }
  }
  const draftMap = new Map(drafts.map((d) => [d.key, d]))
  /** 新店卡「都不像 → 估一筆」：使用者已經說要估，不比對食品庫，框裡這一段直接變待估列、送出去估 */
  function estimateQuery(q: string) {
    if (busy) return
    const e = pendingEntry(q, foods, rank)
    setQuery('')
    setFilterQuery('')
    toTopRef.current = true
    setEntries((prev) => [...prev, e])
    if (e.kind === 'pending') void estimatePending(e)
  }

  let browseBody: ReactNode = null
  if (trimmedQuery) {
    const allHits = searchRows(sortedFoods, trimmedQuery, foodMatches)
    const hits = byQuotaFit(allHits.filter(visible), overAmounts)
    /** 搜到的只有已經在「這一餐」的那一列（清單其他段不重複出它）：不說「找不到」 */
    const inMeal = hits.length === 0 && allHits.some((r) => segKeys.has(r.key))
    /* 搜不到：新店第一次（spec「記店家改版」甲3）——選一筆差不多的通用食物記成「品名 · 店家」；卡裡「都不像 → 估一筆」＝這一段打完、直接估 */
    const shopCands = hits.length === 0 && meal ? genericCandidates(foods, rank) : []
    browseBody = (
      <>
        <div className="sect-lb">搜尋結果</div>
        {hits.length === 0 && <p className="search-empty-msg">{inMeal ? `「${trimmedQuery}」已經在「這一餐」` : `找不到「${trimmedQuery}」`}</p>}
        {shopCands.length > 0 && (
          <ShopCard
            key={trimmedQuery}
            query={trimmedQuery}
            candidates={shopCands}
            busy={shopBusy}
            error={shopErr}
            onPick={(f, remember) => void pickShop(f, remember)}
            onEstimate={() => estimateQuery(trimmedQuery)}
          />
        )}
        <ul className="food-list">
          {/* 建議段有的那一列從搜尋勾，跟從建議段勾一樣（建議量、來源快照） */}
          {hits.map((r) => renderFoodRow(r, suggestKeys.has(r.key) ? suggestHandlers : handlers))}
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
    const seen = meal ? seenByMeal[meal] : undefined
    const seenOf = (g: FoodGroup<ListRow<Food>>) => (g.category ? seen?.get(g.category) : undefined)
    const row = (r: ListRow<Food>) => renderFoodRow(r, handlers)
    const elsewhereNames = grouped.elsewhere.map((g) => g.category ?? '未分類')
    const shopStrays = strays.filter((r) => extraRows.has(r.key))
    const otherStrays = strays.filter((r) => !extraRows.has(r.key))
    browseBody = (
      <>
        {shopStrays.length > 0 && (
          <>
            <div className="sect-lb">剛加的</div>
            <ul className="food-list">{shopStrays.map(row)}</ul>
          </>
        )}
        {otherStrays.length > 0 && (
          <>
            <div className="sect-lb">別的餐勾的</div>
            <ul className="food-list">{otherStrays.map(row)}</ul>
          </>
        )}
        {suggestRows.length > 0 && (
          <>
            <div className="sect-lb sect-suggest">
              <span>建議</span>
              {/* 全選只勾還沒勾的；都勾了就收起來，焦點接到建議段第一列 */}
              {suggestLeft.length > 0 && (
                <button
                  className="sect-act"
                  type="button"
                  aria-label={`全選建議的 ${suggestLeft.length} 樣`}
                  onClick={() => {
                    focusSuggestRef.current = true
                    suggestLeft.forEach((r) => pickSuggested(r.item))
                  }}
                >
                  全選
                </button>
              )}
            </div>
            <ul className="food-list">{suggestRows.map((r) => renderFoodRow(r, suggestHandlers, true))}</ul>
          </>
        )}
        {recentRows.length > 0 && (
          <>
            <div className="sect-lb">{meal ? mealLabel(meal) : ''}常吃</div>
            <ul className="food-list">{recentRows.map(row)}</ul>
          </>
        )}
        {restRows.length > 0 && (
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
        {/* 通用食物自己那一列：給自己泡、說不出哪家的時候用，勾了不記店家（spec「記店家改版」） */}
        {genericRows.length > 0 && (
          <>
            <div className="sect-lb">通用（說不出哪家）</div>
            <ul className="food-list">{genericRows.map(row)}</ul>
          </>
        )}
        {suggestRows.length === 0 && recentRows.length === 0 && restRows.length === 0 && genericRows.length === 0 && strays.length === 0 && (
          <p className="muted">食品庫還是空的。在上面搜尋框輸入品名就能新增第一筆。</p>
        )}
      </>
    )
  }

  const contentAriaLabel = view === 'list' ? (meal ? mealLabel(meal) : '記一筆') : '新增食物'

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
            {/* v2.166：這天記過的餐前面一個小勾（今日頁的踏腳石拿掉後，「記過了沒」搬到這裡）；預選規則不變 */}
            <div className="chiprow" role="group" aria-label="餐別">
              {MEALS.map((m) => (
                <button
                  key={m.key}
                  className="chip"
                  type="button"
                  aria-pressed={meal === m.key}
                  aria-label={loggedMeals.has(m.key) ? `${m.label}，記過了` : undefined}
                  onClick={() => {
                    setMeal(m.key)
                    // 換餐別，「其他餐的」收的是另一批類型，收回去
                    setElsewhereOpen(false)
                  }}
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
              {/* 一個框記一餐：打一樣是搜尋，打完一段（頓號、逗號、或按完成）就變成「這一餐」的一列 */}
              <input
                type="text"
                placeholder="吃了什麼？打一樣或一整句"
                aria-label="吃了什麼"
                enterKeyHint="done"
                readOnly={busy}
                value={query}
                onChange={handleQueryChange}
                onKeyDown={handleBoxKeyDown}
                onPaste={handleBoxPaste}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
              />
            </div>
          </div>

          {/* 已選膠囊列（v2.158，樣張 picked-inplace.html C）：釘在搜尋框下、不跟著捲走，有勾才出現。
              勾了的列留在原位，這一行是「我勾了哪些」的總覽；點膠囊捲到那一列，取消勾在列上做（膠囊沒有 ✕）。 */}
          {(picks.size > 0 || drafts.length > 0) && (
            <div className="pick-pin" role="group" aria-label="已選的食物" ref={pinRef}>
              <span className="pick-pin-lb" aria-hidden="true">已選</span>
              <div className="pick-chips" ref={chipsRef}>
                {[...picks.keys()].map((key) => {
                  const f = pickedFood(key)
                  if (!f) return null
                  return (
                    <button key={key} className={key === lastPicked ? 'pick-chip is-new' : 'pick-chip'} type="button" data-chip={key} aria-label={`捲到 ${f.name}`} onClick={() => jumpTo(key)}>
                      <span className="pick-chip-tx">{f.name}</span>
                    </button>
                  )
                })}
                {meal &&
                  drafts.map((d) => (
                    <button key={d.key} className={d.key === lastPicked ? 'pick-chip is-new' : 'pick-chip'} type="button" data-chip={d.key} aria-label={`捲到 ${draftName(d, meal)}`} onClick={() => jumpTo(d.key)}>
                      <span className="pick-chip-tx">{draftName(d, meal)}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="food-scroll" key="list-scroll" ref={setListScroll}>
            <MealSection
              meal={meal ?? 'dinner'}
              entries={entries}
              drafts={draftMap}
              renderPick={(key) => (picks.has(key) ? renderFoodRow(rowOf(key) ?? strayRow(key), segHandlers) : null)}
              fresh={fresh}
              said={said}
              locked={busy}
              fixes={fixes}
              fixBusy={fixBusy}
              foods={foods}
              onEstimate={estimateById}
              onEstimateAll={estimateAll}
              onRemovePending={removePending}
              onOwnText={(id, v) => patchPending(id, { own: v })}
              onToggleTiers={(id) => {
                const e = entries.find((x) => x.id === id)
                if (e?.kind === 'pending') patchPending(id, { tiers: !e.tiers })
              }}
              onTier={(id, k: TierKey) => pendingToDraft(id, draftFromTier(k, ratio))}
              onOwnKcal={(id, k) => pendingToDraft(id, draftFromKcal(k, ratio))}
              onAdoptPending={adoptPending}
              onKcalInput={(key, raw) => patchDraft(key, (d) => (d.foodId === null ? withKcalInput(d, raw) : d))}
              onKcalBlur={(key) => patchDraft(key, settleKcal)}
              onName={(key, v) => patchDraft(key, (d) => (d.foodId === null ? { ...d, name: v } : d))}
              onDelete={deleteDraft}
              onToggleKeep={(key) => patchDraft(key, (d) => (d.foodId === null ? { ...d, keep: !d.keep } : d))}
              onFixToggle={(key) => patchFix(key, { open: !fixes[key]?.open, status: fixes[key]?.status === 'busy' ? 'busy' : 'idle' })}
              onFixText={(key, v) => patchFix(key, { text: v })}
              onFixSubmit={(key) => void submitFix(key)}
              onLibStep={(key, dir) => patchDraft(key, (d) => stepLibQty(d, dir))}
              onLibQtyInput={(key, raw) =>
                patchDraft(key, (d) => {
                  if (!d.lib) return d
                  const n = parseTypedQty(raw)
                  return n === null ? { ...d, lib: { ...d.lib, qtyDraft: raw } } : withLibQty(d, n, raw)
                })}
              onLibQtyBlur={(key, raw) => patchDraft(key, (d) => withLibQty(d, normalizeQty(raw)))}
              onLibToAi={libToAi}
              onAdopt={adoptFood}
            />
            {browseBody}
          </div>

          {(picks.size > 0 || drafts.length > 0 || entries.length > 0) && renderPickBar(allTotals, () => void submitPicks(), addBlocked)}
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
            {formDup.block ? (
              <div className="dup-block" role="alert">
                <span>食品庫已有「{foodLabel(formDup.block)}」</span>
                <button className="row-pill" type="button" onClick={() => formDup.block && pickExisting(formDup.block.id)}>改用那筆</button>
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
