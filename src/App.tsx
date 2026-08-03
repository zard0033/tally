/* App 殼：auth 開機、資料狀態機、分頁殼。screens/ 底下三個畫面純呈現＋互動，
   所有資料讀取與 mutation 都收在這裡呼叫 src/lib/api.ts——理由與契約見 screens/types.ts。

   E2E seam：本檔完全不碰 window.fetch／XHR／WebSocket，所有 IO 都經 supabase-js
   （內部走 fetch）。只要外部把 window.fetch 換掉並在 localStorage 種好
   `sb-<ref>-auth-token`，這裡從開機判斷到 CRUD 全部離線可跑，不需要真網路。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Session } from '@supabase/supabase-js'
import {
  createFood as apiCreateFood,
  createIntake as apiCreateIntake,
  deleteIntake as apiDeleteIntake,
  getLatestWeight,
  getProfile,
  getSession,
  listFoods,
  listIntake,
  onAuthStateChange,
  signOut as apiSignOut,
  updateFood as apiUpdateFood,
  updateIntakeMeal as apiUpdateIntakeMeal,
  updateIntakeQty as apiUpdateIntakeQty,
  updateProfile as apiUpdateProfile,
  upsertWeight as apiUpsertWeight,
  type Food,
  type IntakeRow,
  type NewFood,
  type NewIntake,
  type NewWeight,
  type ProfileRow,
  type Weight,
} from '@/lib/api'
import { DUR, sec } from '@/lib/durations'
import { computeTargets, num, type Targets } from '@/lib/formulas'
import { localDate, shiftDate } from '@/lib/dates'
import { defaultMeal, type MealKey } from '@/lib/meals'
import Login from '@/screens/Login'
import Today from '@/screens/Today'
import LogSheet from '@/screens/LogSheet'
import Settings from '@/screens/Settings'

type Tab = 'today' | 'settings'

interface Notice {
  headline: string
  detail?: string
  actionLabel: string
  onAction: () => void
}

/** 原始錯誤訊息（'Failed to fetch'、'signal timed out'、TimeoutError…）對使用者沒有意義，
 *  換成看得懂的話。AbortSignal.timeout 產生的是 DOMException{name:'TimeoutError'}，
 *  postgrest-js 組出的 message 形如 'TimeoutError: signal timed out'——三種寫法都要接住
 *  （precommit review 抓到只認 AbortError 會讓逾時原文直接見人）。 */
function friendlyError(message: string): string {
  if (message.includes('TimeoutError') || message.includes('AbortError') || message.includes('signal timed out')) {
    return '網路沒回應，請確認連線是否正常'
  }
  if (message.includes('Failed to fetch') || message.includes('TypeError')) {
    return '連不上網路，請確認 Wi-Fi 或行動網路'
  }
  return message
}

/** 刪除的可復原窗。5 秒：夠看到「已刪除」並反悔，又不會久到讓人以為沒刪成功 */
const UNDO_MS = 5000

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const byFoodName = (a: Food, b: Food) => a.name.localeCompare(b.name, 'zh-Hant')

/** 把「待刪那一筆」從 rows 濾掉——這是把 rows 放進畫面的唯一合法方式，不論 rows 是
 *  剛 fetch 回來的、還是從快取取出的。快取本身永遠存**原始**（未濾除）的 rows，
 *  濾除只在「放進畫面」這一刻做，理由是 pendingDelete 會隨時間改變（送出、復原），
 *  存濾過的版本進快取只會讓快取跟著過期。 */
function filterPendingRow(
  rows: IntakeRow[],
  date: string,
  pending: { row: IntakeRow; date: string } | null,
): IntakeRow[] {
  return pending && pending.date === date ? rows.filter((row) => row.id !== pending.row.id) : rows
}

export default function App() {
  // undefined＝還在問 getSession()；null＝沒有 session；Session＝已登入
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [loginError, setLoginError] = useState<string | null>(null)

  const [currentDate, setCurrentDate] = useState<string>(() => localDate())
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [weight, setWeight] = useState<Weight | null>(null)
  const [targets, setTargets] = useState<Targets | null>(null)
  const [rows, setRows] = useState<IntakeRow[] | null>(null)
  const [foods, setFoods] = useState<Food[] | null>(null)

  const [tab, setTab] = useState<Tab>('today')
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetMeal, setSheetMeal] = useState<MealKey | null>(null)
  const [justAddedIds, setJustAddedIds] = useState<Set<number>>(new Set())
  const flashTimer = useRef<number | undefined>(undefined)

  /* 刪除的 undo 窗（v2.1）：按下刪除後**先不打 DELETE**，只把該列從畫面樂觀移除，
     等 UNDO_MS 過了才真的送出。復原＝把快照的 rows 放回去，不必反向 INSERT——
     反向 INSERT 會拿到新的 id，而且復原本身也可能失敗，那就真的救不回來了。
     代價是這段窗內關掉分頁的話刪除不會生效，所以 pagehide 會先結清（見 useEffect）。
     v2.5 真機第四輪：待刪要**跨日期存活**（換日期不再結清，只有換分頁才結清，見下方
     兩個 useEffect）。因此多記一個 date——復原時要知道那一筆原本屬於哪一天，
     不同天就不能把它插回目前畫面（那正是當初「換日期就結清」要防的事）。 */
  const pendingDelete = useRef<{ row: IntakeRow; index: number; date: string } | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const [undoOpen, setUndoOpen] = useState(false)
  const undoBtnRef = useRef<HTMLButtonElement>(null)

  /* 已看過的日期快取（v2.6：切日期無感）。存原始（未濾除待刪）rows，見 filterPendingRow。
     沒有上限、不做 LRU——一次 session 看不到幾千天，淘汰只是多一套要維護的東西。
     prefetchingRef 只是「這個日期正在背景撈」的去重旗標，跟 cacheRef 分開存，
     避免同一天被連續按箭頭時觸發兩次重複的預取請求。 */
  const cacheRef = useRef<Map<string, IntakeRow[]>>(new Map())
  const prefetchingRef = useRef<Set<string>>(new Set())

  /* 「現在正在看哪一天」的 ref。用 ref 不用 currentDate 本身，是因為需要它的地方
     （loadDay 的 await 之後、commitDelete 的 catch）都不能把 currentDate 放進 deps：
     那會讓這些 callback 的 identity 每次換日期都變，而 pagehide 那個 effect 依賴
     commitDelete，identity 一變 cleanup 就跑，等於每換一次日期就偷送一次真的 DELETE
     （已經踩過一次的坑，見下方 pagehide effect）。 */
  const currentDateRef = useRef(currentDate)
  useEffect(() => {
    currentDateRef.current = currentDate
  }, [currentDate])

  const showNotice = useCallback(
    (headline: string, detail: string | undefined, actionLabel: string, onAction: () => void) => {
      setNotice({ headline, detail, actionLabel, onAction })
      setFailed(true)
    },
    [],
  )

  /* 背景把某一天的 intake 撈進快取，不碰任何畫面 state。失敗靜默忽略——這是預取，
   *  使用者根本不知道它發生過，彈錯誤畫面或動到當前畫面的 state 都是過度反應。
   *  prefetchingRef 防同一天被連續觸發兩次重複的請求（例如快速連按兩次箭頭）。 */
  const prefetchDate = useCallback((date: string) => {
    if (cacheRef.current.has(date) || prefetchingRef.current.has(date)) return
    prefetchingRef.current.add(date)
    void listIntake(date)
      .then((r) => {
        /* 落地前再檢查一次：這支請求在飛的期間，這一天可能已經被更新的東西寫進快取了
           （commitDelete 成功後濾掉那筆、loadDay 重撈、記一筆後回填）。無條件寫入會把
           較新的內容回捲成舊快照——症狀是「已經真的刪掉的那筆，切走再切回又出現」，
           而且因為走快取不打 API，伺服器不會來糾正它（precommit deep review 抓到）。 */
        if (!cacheRef.current.has(date)) cacheRef.current.set(date, r)
      })
      .catch(() => {})
      .finally(() => {
        prefetchingRef.current.delete(date)
      })
  }, [])

  /* 載入某一天成功之後呼叫：背景預取前一天；只有在目前檢視日不是今天時才連後一天
   *  也預取，且後一天不能超過今天——goToDate 已有「看不了未來」的規則，這裡照樣守。 */
  const prefetchAdjacent = useCallback(
    (date: string) => {
      prefetchDate(shiftDate(date, -1))
      if (date !== localDate()) {
        const next = shiftDate(date, 1)
        if (next <= localDate()) prefetchDate(next)
      }
    },
    [prefetchDate],
  )

  /* 照 legacy load()：profile／最新體重／當日 intake／食品庫並行撈。
   * 食品庫在這裡一起撈（跟 legacy 開 sheet 時才撈不同）是委派指示的明確要求——
   * 讓 LogSheet 拿到現成的 foods prop，不必自己管一份載入狀態，
   * 代價是開機多打一支 API，量體（23 筆）小到可以忽略。 */
  const load = useCallback(async (date: string) => {
    try {
      const [p, w, r, f] = await Promise.all([getProfile(), getLatestWeight(), listIntake(date), listFoods()])
      if (!p || !w) {
        const detail = !p && !w
          ? '這個帳號的身體參數與體重紀錄都是空的。若之前用另一組帳號登入過，資料可能掛在那組帳號下——請確認登入的是同一個 Google 帳號。'
          : !p
            ? '還沒有身高、出生年這些身體參數，算不出目標熱量。'
            : '還沒有任何體重紀錄，算不出目標熱量。'
        showNotice('還沒有身體參數', detail, '重新載入', () => void load(date))
        return
      }
      const t = computeTargets(p, num(w.weight_kg), w.body_fat_pct)
      if (!Number.isFinite(t.kcal)) {
        showNotice('目標熱量算不出來', '身體參數有缺漏或格式不對，算出來的目標不是有效數字。', '重新載入', () => void load(date))
        return
      }
      setProfile(p)
      setWeight(w)
      setTargets(t)
      // 濾除照樣走 filterPendingRow：目前這條路徑（開機／設定頁存檔）呼叫時待刪一定是
      // null（切到設定分頁就結清了），但「把 rows 放進畫面的唯一合法方式」是個不變式，
      // 留一條例外就等著哪天有人加一個不必切分頁的存檔入口時漏掉它（review 指出）
      setRows(filterPendingRow(r, date, pendingDelete.current))
      setFoods(f)
      setFailed(false)
      setNotice(null)
      cacheRef.current.set(date, r) // 也覆寫快取——這條路徑也會被 handleSaveProfile／
      // handleSaveWeight 呼叫（設定改動後重算），r 是這一天的最新狀態，讓快取跟著更新
      prefetchAdjacent(date)
    } catch (e) {
      showNotice('讀不到你的資料', friendlyError(errMsg(e)), '重試', () => void load(date))
    }
    // 日期走顯式參數（跟 loadDay 對稱）——closure 抓 currentDate 曾造成
    // 「歷史日存設定後畫面日期與資料錯位」，precommit review 抓到的，別改回去
  }, [showNotice, prefetchAdjacent])

  /* 只換日期時不必重撈 profile／體重／食品庫——目標與食品庫不隨檢視日改變。
   *  這是「快取沒命中」的路徑，goToDate 命中快取時完全繞過這支函式。 */
  const loadDay = useCallback(
    async (date: string = currentDate) => {
      setRows(null)
      try {
        const r = await listIntake(date)
        cacheRef.current.set(date, r) // 存原始 rows，濾除留給 filterPendingRow 在放進畫面時做
        /* 回來時人還在這一天嗎？不在就只寫快取、不動畫面。**加了快取之後這條 race 從
           罕見變成常態**：以前每次換日都要往返、延遲差不多，最後按的那天最後落地；
           現在命中快取是同步回填，於是「先發的慢請求」會後到並蓋掉畫面。實測重現
           （verifier）：慢 fetch 到前兩天途中按回今天 → 今天的畫面被前兩天的空清單整包
           蓋掉，頁首寫「7/30」、主數字 1863、品項 0 筆，而且不會自我修復（不再打 API）。 */
        if (date !== currentDateRef.current) return
        /* 待刪跨日期存活（v2.5）：如果它屬於「正在載入的這一天」（最常見的路徑是
           使用者切走又切回來，5 秒還沒到），要把它從剛撈回來的 rows 濾掉，**不要結清**
           （不要真的送出 DELETE）。舊版做法是重撈前先結清，理由是防「畫面看得到、
           伺服器已經沒有」的反向不一致；濾掉同樣防得住這個不一致——只是方向相反
           （畫面藏著、伺服器還在，跟樂觀刪除本來就是同一個方向），而且不會讓使用者
           單純切走再切回來就把一筆還在 undo 窗內的東西弄假成真地刪掉。 */
        setRows(filterPendingRow(r, date, pendingDelete.current))
        setFailed(false)
        setNotice(null)
        prefetchAdjacent(date)
      } catch (e) {
        showNotice('讀不到這天的紀錄', friendlyError(errMsg(e)), '重試', () => void loadDay(date))
      }
    },
    [currentDate, showNotice, prefetchAdjacent],
  )

  const goToDate = useCallback(
    (iso: string) => {
      if (iso === currentDate) return
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return
      if (iso > localDate()) return // 看不了未來
      setCurrentDate(iso)
      const cached = cacheRef.current.get(iso)
      if (cached) {
        /* 快取命中：直接把快取的 rows（經同一套濾除）放進畫面，完全不進載入態——
         *  不 setRows(null)，主數字不掉回 —、時間軸不出現「載入中…」。這是這次改動
         *  唯一的目的：使用者按下箭頭時資料已經在手上。 */
        setRows(filterPendingRow(cached, iso, pendingDelete.current))
        setFailed(false)
        setNotice(null)
        prefetchAdjacent(iso)
      } else {
        void loadDay(iso)
      }
    },
    [currentDate, loadDay, prefetchAdjacent],
  )

  const shiftDateBy = useCallback((days: number) => goToDate(shiftDate(currentDate, days)), [currentDate, goToDate])

  const openSheet = useCallback((meal: MealKey) => {
    setSheetMeal(meal)
    setSheetOpen(true)
  }, [])
  const closeSheet = useCallback(() => setSheetOpen(false), [])

  /* 刪除失敗跟 legacy 一致：轉全域 Notice，不是就地錯誤——這是讀寫失敗分流的例外，
   * 因為刪除沒有「已選內容」需要保留，直接回今天重試就好 */
  /* 還原一律是「把那一筆插回**目前**的清單」，不是套用一份刪除當下的整包快照。
     快照做法在連續刪兩筆時會錯：刪 A → 5 秒內刪 B → A 送出失敗 → 畫面被還原成
     「A、B 都在」，但 B 其實仍在待刪且隨後真的會被刪掉，使用者看到的是假的復活
     （verifier 抓到）。插回單筆就沒有這個歧義。 */
  const restore = useCallback((p: { row: IntakeRow; index: number }) => {
    setRows((prev) => {
      if (!prev) return prev
      if (prev.some((r) => r.id === p.row.id)) return prev
      const next = [...prev]
      next.splice(Math.min(p.index, next.length), 0, p.row)
      return next
    })
  }, [])

  /* commitDelete 不能把 loadDay 直接放進自己的 deps：loadDay 的 identity 隨 currentDate
     變（它把 currentDate 當預設參數關進 closure），若 commitDelete 也跟著變，
     下面 pagehide／visibilitychange 那個 effect的 cleanup 會在**單純換日期**時被觸發
     （cleanup 在依賴改變時一樣會跑，不是只有真正卸載才跑）——cleanup 最後一行的
     flush() 因此在每次換日期都偷跑一次真的 DELETE，等於繞了一圈把「換日期不再結清」
     這條規則悄悄破了（真機第四輪這條 e2e 一開始就是被這裡絆倒，不是被日期效果絆倒）。
     用 ref 把 loadDay 的最新版本存住、只在真正呼叫的當下讀，commitDelete 的 identity
     就只跟著 restore／showNotice 走（兩者 deps 都是 []，形同永遠不變）。 */
  const loadDayRef = useRef<(date?: string) => Promise<void>>(async () => {})
  useEffect(() => {
    loadDayRef.current = loadDay
  }, [loadDay])

  const commitDelete = useCallback(async () => {
    const p = pendingDelete.current
    if (!p) return
    pendingDelete.current = null
    window.clearTimeout(undoTimer.current)
    setUndoOpen(false)
    try {
      await apiDeleteIntake(p.row.id)
      // 真的刪成功了：快取這一天的原始 rows 裡也要把它拿掉，不然之後切回這天
      // 會命中快取、直接把已經真的刪掉的那一筆又畫回螢幕上
      const cached = cacheRef.current.get(p.date)
      if (cached) cacheRef.current.set(p.date, cached.filter((row) => row.id !== p.row.id))
    } catch (e) {
      /* 送不出去就把那一筆放回去，不留下「看起來刪掉了其實還在」。
         **但只在使用者仍停在那一天時才還原**——待刪會跨日期存活（v2.5），計時器可能在
         使用者已經切到別天之後才觸發，此時無條件 restore 會把 A 日那筆插進 B 日的 rows，
         正是 undoDelete 明講「絕對不可以」的事。目前它剛好被錯誤畫面擋著畫不出來，但
         記一筆的 sheet 不在那道 gate 裡，會把 A 日的熱量算進 B 日的「已吃」
         （precommit deep review 抓到）。不同天時不必補償：那筆從沒真的刪掉，
         下次載入那天自然還在。
         重試也要帶上 p.date——不帶的話 loadDay 會用預設的 currentDate，重撈的是
         使用者現在看的那天，而不是真正出事的那天。 */
      if (p.date === currentDateRef.current) restore(p)
      showNotice('刪不掉這一筆', friendlyError(errMsg(e)), '重試', () => void loadDayRef.current(p.date))
    }
  }, [restore, showNotice])

  const handleDeleteIntake = useCallback(
    (id: number) => {
      // 同一列連點（樂觀移除到退場動畫跑完之間仍點得到）直接忽略
      if (pendingDelete.current?.row.id === id) return
      // 前一筆還在 undo 窗裡就先結清它——同時只維護一個待刪，省掉一整套佇列。
      // 這條不分日期：換日期後刪第二筆一樣先把前一筆（不論哪天）真的送出去。
      if (pendingDelete.current) void commitDelete()
      // 索引與待刪都在 updater 外面算好：updater 應該是純函式，StrictMode 下 React 會
      // 刻意跑兩次來抓副作用，在裡面寫 ref 只是目前剛好無害（precommit review 指出）
      const index = rows?.findIndex((r) => r.id === id) ?? -1
      if (index < 0) return
      pendingDelete.current = { row: rows![index], index, date: currentDate }
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev)
      setUndoOpen(true)
      window.clearTimeout(undoTimer.current)
      undoTimer.current = window.setTimeout(() => void commitDelete(), UNDO_MS)
    },
    [commitDelete, rows, currentDate],
  )

  /* 切分頁才結清待刪（v2.5：換日期不再結清，待刪要跨日期存活，計時器照跑，
     見上方 pendingDelete 註解與 loadDay）。切分頁維持原樣：復原提示條掛在 <main>
     下、與 Today／Settings 同層，不結清的話它會浮在設定頁上，而它的定位是照今日頁
     的 CTA 高度算的，在設定頁會落在半空（precommit review 抓到）。 */
  const tabRef = useRef(tab)
  useEffect(() => {
    if (tabRef.current !== tab) {
      tabRef.current = tab
      if (pendingDelete.current) void commitDelete()
    }
  }, [tab, commitDelete])

  const undoDelete = useCallback(() => {
    const p = pendingDelete.current
    if (!p) return
    pendingDelete.current = null
    window.clearTimeout(undoTimer.current)
    setUndoOpen(false)
    /* 待刪跨日期存活（v2.5）：只有在使用者仍停在待刪那一天時，復原才把那一筆插回
       目前畫面。已經切到別天的話，那一筆從來沒有從**別天**的清單被移出過——它只在
       它自己那天的邏輯狀態裡被樂觀移除，切回別天時 loadDay 會把它濾掉（見上方），
       畫面看起來「消失」但其實從沒被插進別天過，所以這裡只需要收掉計時器與提示條，
       不能呼叫 restore(p)。**絕對不可以把 A 日的那筆插進 B 日目前的畫面**——
       這正是當初「換日期就結清」要防的事，只是這次用「不還原」而不是「先結清」來防。 */
    if (p.date === currentDate) restore(p)
  }, [restore, currentDate])

  /* 被刪掉那一列連同它的刪除鈕一起離開 DOM，焦點會掉回 body，鍵盤使用者等於原地迷路、
     而且要在 5 秒內盲摸 Tab 才找得到「復原」。只在焦點真的掉了（activeElement 是 body）
     才把它接到復原鈕上——觸控刪除不會有 focus-visible 外框，看不出差別。
     **一定要等退場動畫跑完才判斷**：刪除是樂觀移除＋AnimatePresence，undoOpen 轉 true 的
     那一刻被刪那列還在 DOM 上、刪除鈕仍持有焦點，當場檢查 activeElement 永遠不是 body，
     這個轉移就等於沒寫（第一版正是這樣寫的，verifier 逐時刻取樣抓到：+80ms 還在按鈕上、
     +200ms 才掉到 body，而 effect 早就跑完了）。 */
  useEffect(() => {
    if (!undoOpen) return
    const t = window.setTimeout(() => {
      if (document.activeElement === document.body) undoBtnRef.current?.focus()
    }, DUR.mid + 40)
    return () => window.clearTimeout(t)
  }, [undoOpen])

  /* 待刪還沒送出就離開頁面／切到背景的話，先把它結清。iOS Safari 不保證跑 beforeunload，
     pagehide 與 visibilitychange 是它比較認的兩個。
     ponytail: 這裡送的是普通 fetch（經 supabase-js），關分頁時可能被中止，那筆就沒刪成
     ——下次開 app 它會再出現。**這是刻意選的失敗方向**：反過來做（先真的 DELETE、
     復原時反向 INSERT）在復原失敗時會直接損失資料，而這邊最壞只是「刪了又回來」，
     使用者再刪一次就好。要根治得繞過 supabase-js 自己組帶 keepalive 的請求（要自帶
     auth header，sendBeacon 設不了 header），為這個機率不高的邊界情況不值得。 */
  useEffect(() => {
    const flush = () => {
      if (pendingDelete.current) void commitDelete()
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
      flush()
    }
  }, [commitDelete])

  /* 寫入失敗（記一筆／新增食物／設定編輯／記體重）刻意不接在這裡吞掉——
   * 讓錯誤 reject 到呼叫的 screen 自己接住，就地顯示「存不進去：」＋不清空已選＋
   * 按鈕變重試，跟 legacy 的 withBusy 行為一致（跟上面 deleteIntake 的全域 Notice 不同）。 */
  const handleCreateIntake = useCallback(
    async (newRows: NewIntake[]) => {
      // 先結清待刪：底下的 loadDay() 會整包換掉 rows，undo 的快照就過期了
      if (pendingDelete.current) await commitDelete()
      const created = await apiCreateIntake(newRows)
      setSheetOpen(false)
      await loadDay()
      const ids = new Set(created.map((r) => r.id))
      setJustAddedIds(ids)
      if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setJustAddedIds(new Set()), 1300)
    },
    [loadDay, commitDelete],
  )

  const handleCreateFood = useCallback(async (food: NewFood): Promise<Food> => {
    const created = await apiCreateFood(food)
    setFoods((prev) => [...(prev ?? []), created].sort(byFoodName))
    return created
  }, [])

  /* 食品庫管理頁的就地編輯：只動品名／店家／營養值，archived 不在 patch 裡。
   * App 的 foods（今日頁挑選清單）跟著更新同一筆，不必整包重撈。 */
  const handleUpdateFood = useCallback(async (id: number, patch: Partial<NewFood>): Promise<void> => {
    await apiUpdateFood(id, patch)
    setFoods((prev) => prev?.map((f) => (f.id === id ? { ...f, ...patch } : f)) ?? prev)
  }, [])

  /** 封存：從「使用中」清單移除（今日頁picker 不該再挑到它），回傳封存後的完整列
   *  給 FoodLibrary 的復原用——復原不必重新整包撈食品庫。呼叫端已經握著完整的 Food
   *  物件（就是清單裡點下封存那一列），直接收下來用，不必再回頭用 setFoods 的 updater
   *  當「順便讀一下目前 foods」的手段——updater 是否同步執行是 React 的最佳化細節，
   *  不是合約，拿它當讀取管道會在極少數時機（DB 已寫入成功後）踩到「找不到就 throw」，
   *  造成資料庫已封存、畫面卻回滾成失敗的不同步（precommit-review 抓到）。 */
  const handleArchiveFood = useCallback(async (food: Food): Promise<Food> => {
    await apiUpdateFood(food.id, { archived: true })
    setFoods((prev) => prev?.filter((f) => f.id !== food.id) ?? prev)
    return { ...food, archived: true }
  }, [])

  /** 復原：解封存，插回「使用中」清單並保持排序。 */
  const handleUnarchiveFood = useCallback(async (food: Food): Promise<void> => {
    await apiUpdateFood(food.id, { archived: false })
    setFoods((prev) => [...(prev ?? []).filter((f) => f.id !== food.id), { ...food, archived: false }].sort(byFoodName))
  }, [])

  /* 單筆 intake 的就地編輯（份量、餐別）共用這一條：先送出再更新畫面，跟
   * handleCreateIntake/handleCreateFood 同一套慣例——失敗 reject 給呼叫端就地顯示
   * 「存不進去：」，不走樂觀更新＋回滾。kcal/protein/fat/carb 是單份快照，兩種編輯
   * 都不必重算，只需要 rows 與快取裡對應的那一欄跟著換。
   *
   * 寫入前先確認這個 id 還在「現在畫面看得到的那天」，擋下時靜靜跳過、不當錯誤處理。
   * 這道守門是 v2.14 為長按 sheet 加的：那個 sheet 掛在畫面根節點下，底下那一列卸載了
   * 它照樣開著，於是「送出當下這筆早就不是畫面上那一筆」有真實的觸發路徑（fresh-context
   * verifier 當時連兩輪抓到同一病灶的兩個入口）。
   *
   * **v2.20 之後它降級成深度防禦**：就地編輯區是 .item-row 的子節點，那一列卸載它必然
   * 一起走，UI 上已經構造不出那個狀態（改寫 e2e 時實測到——舊的重現手法現在會停在
   * 「找不到 stepper」）。留著的理由是下一個編輯入口未必還有這個結構，而它的成本是一行。
   * **寫成共用的 patchIntakeRow 而不是複製到每個 mutation**：v2.14 時它只服務改份量，
   * 當時就在 session-state 記下「新增其他就地編輯入口要記得補同樣的檢查」——這輪加改餐別
   * 就是那個新入口，與其再抄一次不如讓它們共用同一道門。 */
  const patchIntakeRow = useCallback(
    async (id: number, patch: Partial<IntakeRow>, send: () => Promise<void>) => {
      if (!rows?.some((r) => r.id === id)) return
      await send()
      const apply = (list: IntakeRow[]) => list.map((r) => (r.id === id ? { ...r, ...patch } : r))
      setRows((prev) => (prev ? apply(prev) : prev))
      const cached = cacheRef.current.get(currentDate)
      if (cached) cacheRef.current.set(currentDate, apply(cached))
    },
    [currentDate, rows],
  )
  const handleUpdateIntakeQty = useCallback(
    (id: number, qty: number) => patchIntakeRow(id, { qty }, () => apiUpdateIntakeQty(id, qty)),
    [patchIntakeRow],
  )
  const handleUpdateIntakeMeal = useCallback(
    (id: number, meal: MealKey) => patchIntakeRow(id, { meal }, () => apiUpdateIntakeMeal(id, meal)),
    [patchIntakeRow],
  )

  const handleSaveProfile = useCallback(
    async (patch: Partial<ProfileRow>) => {
      if (!profile) throw new Error('身體參數還沒載入')
      await apiUpdateProfile(profile.user_id, patch)
      await load(currentDate) // 參數變了，目標要重算；load() 保留在目前分頁，不會被丟回今日頁
    },
    [profile, load, currentDate],
  )

  const handleSaveWeight = useCallback(
    async (w: Omit<NewWeight, 'user_id'>) => {
      if (!profile) throw new Error('身體參數還沒載入')
      await apiUpsertWeight({ ...w, user_id: profile.user_id })
      await load(currentDate) // 體重變了，目標要重算
    },
    [profile, load, currentDate],
  )

  const handleSignOut = useCallback(() => void apiSignOut(), [])

  /* 開機：問一次目前 session，並訂閱後續變化（token 自動 refresh、登出、跨分頁同步
   * 都由 supabase-js 處理，這裡只反應結果）。 */
  useEffect(() => {
    let cancelled = false
    void getSession()
      .then((s) => {
        if (!cancelled) setSession(s)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setSession(null)
          setLoginError(errMsg(e))
        }
      })

    const { data: sub } = onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') {
        setSession(null)
        setLoginError('登入已過期，請重新登入')
        // 清掉上一個帳號的殘留狀態，避免下次登入短暫看到舊資料
        setProfile(null)
        setWeight(null)
        setTargets(null)
        setRows(null)
        setFoods(null)
        setFailed(false)
        setNotice(null)
        setSheetOpen(false)
        setTab('today')
        cacheRef.current.clear() // 換帳號後別讓上一個帳號的快取資料在切日期時冒出來
        prefetchingRef.current.clear()
      } else if (s) {
        setSession(s)
      }
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  /* 登入成功後載入一次資料。用 ref 而非把 session 物件放進依賴陣列，
   * 避免 token 自動 refresh（session 物件參照會變）誤觸重新載入。 */
  const loadedForSession = useRef(false)
  useEffect(() => {
    if (session && !loadedForSession.current) {
      loadedForSession.current = true
      void load(currentDate)
    } else if (!session) {
      loadedForSession.current = false
    }
  }, [session, load, currentDate])

  if (session === undefined) {
    return (
      <div className="screen">
        <div className="notice">
          <p className="muted">載入中…</p>
        </div>
      </div>
    )
  }

  if (!session) return <Login error={loginError} />

  const ready = profile !== null && targets !== null && weight !== null

  return (
    <div className="screen" id="view-app">
      <main className="main">
        {failed && notice ? (
          <div className="notice">
            <p className="headline">{notice.headline}</p>
            {notice.detail && <p>{notice.detail}</p>}
            <button className="action-btn" type="button" onClick={notice.onAction}>
              {notice.actionLabel}
            </button>
          </div>
        ) : !ready ? (
          <div className="notice">
            <p className="muted">載入中…</p>
          </div>
        ) : tab === 'today' ? (
          <Today
            dayData={{ date: currentDate, rows }}
            profile={profile}
            targets={targets}
            currentDate={currentDate}
            onShiftDate={shiftDateBy}
            onGoToDate={goToDate}
            onOpenSheet={openSheet}
            onDeleteIntake={handleDeleteIntake}
            justAddedIds={justAddedIds}
            onUpdateIntakeQty={handleUpdateIntakeQty}
            onUpdateIntakeMeal={handleUpdateIntakeMeal}
          />
        ) : (
          <Settings
            profile={profile}
            targets={targets}
            latestWeight={weight}
            foods={foods}
            onSaveProfile={handleSaveProfile}
            onSaveWeight={handleSaveWeight}
            onCreateFood={handleCreateFood}
            onUpdateFood={handleUpdateFood}
            onArchiveFood={handleArchiveFood}
            onUnarchiveFood={handleUnarchiveFood}
            onSignOut={handleSignOut}
          />
        )}
        {/* 刪除的可復原提示。role=status＋aria-live=polite：讀屏會播報，但不搶焦點——
            它是可忽略的提示，不是必須回應的對話框。時間到自己消失，不擋任何操作。
            放在 main 內用絕對定位浮在時間軸底部：走版面流的話它一出現就把時間軸擠短
            62px、消失再彈回來，每次刪除都抖一下（verifier 實測）。v2.3：置中浮在底部列
            上方，不進底部列——它是 5 秒就消失的暫時物件，進常駐列會讓那一列的構成
            每次刪除都改變。 */}
        <AnimatePresence>
          {undoOpen && (
            <motion.div
              className="undo-bar"
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={prefersReducedMotion() ? { duration: 0 } : { duration: sec(DUR.mid), ease: [0.4, 0, 0.2, 1] }}
            >
              {/* 「已刪除」只給讀屏（role=status 播報）。畫面上不寫——列消失本身就是回報，
                  再寫一次就得為它撐出一整條，而使用者要的是一顆「icon ＋ 復原」 */}
              <span className="sr-only">已刪除</span>
              <button type="button" ref={undoBtnRef} onClick={undoDelete} aria-label="復原剛刪除的一筆">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 8h11a5 5 0 0 1 0 10H9" />
                  <path d="M7 4 3 8l4 4" />
                </svg>
                復原
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 底部列（v2.3）：分頁 pill 靠左、56px 圓形主 CTA 靠右，同列取代 v2.2 的上下兩段
          （138px→約 72px，時間軸多出 84px）。CTA 只在今日頁渲染，設定頁右端留空——
          這是預期行為，不是漏放。分頁改純圖示：同列已有主 CTA，兩顆帶字分頁塞不下，
          aria-label 補無障礙名稱。 */}
      {/* 底部列本身是純版面容器（div），<nav> 只包分頁——CTA 是「開記一筆表單」的動作，
          不是導覽項；把它放進 aria-label="主要導覽" 的 landmark 裡，讀屏使用者跳到導覽時
          會撿到一個不切換頁面的東西（review 抓到的語意錯置）。 */}
      <div className="bottom-bar">
        <nav className="tabbar" aria-label="主要導覽">
          {/* 選中態指示器（v2.5）：只在被選中的那顆 .tab 裡渲染 <motion.span layoutId>，
              兩顆分頁共用同一個 layoutId——切換時上一顆卸載、下一顆掛載發生在同一次
              React commit，motion 的 projection 系統把這當成「同一個元素移動」，
              自動在兩個掛載點之間做 FLIP（只動 transform），接管掉原本瞬跳的底色／邊框。
              --dur-mid（220ms）是 DESIGN.md「中等位移」級距，EASE 沿用全站的
              cubic-bezier(0.4,0,0.2,1)；reduced-motion 直接把 duration 降到 0，
              不是另外接 CSS transition-duration（indicator 的位移是 JS 端的
              motion tween，CSS 那條規則對它沒有作用）。 */}
          <button
            className="tab"
            type="button"
            aria-current={tab === 'today' ? 'page' : undefined}
            aria-label="日記"
            onClick={() => setTab('today')}
          >
            {tab === 'today' && (
              <motion.span
                className="tab-indicator"
                layoutId="tab-indicator"
                aria-hidden="true"
                transition={prefersReducedMotion() ? { duration: 0 } : { duration: sec(DUR.mid), ease: [0.4, 0, 0.2, 1] }}
              />
            )}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h16v16H4z" />
              <path d="M8 4v16" />
            </svg>
          </button>
          <button
            className="tab"
            type="button"
            aria-current={tab === 'settings' ? 'page' : undefined}
            aria-label="設定"
            onClick={() => setTab('settings')}
          >
            {tab === 'settings' && (
              <motion.span
                className="tab-indicator"
                layoutId="tab-indicator"
                aria-hidden="true"
                transition={prefersReducedMotion() ? { duration: 0 } : { duration: sec(DUR.mid), ease: [0.4, 0, 0.2, 1] }}
              />
            )}
            {/* 齒輪（cog），取代原本的圓＋放射線——那組讀起來像太陽／亮度圖示，跟「設定」
                語意不合（review 快篩抓到的）。path 是通用的齒輪幾何座標（lucide 的
                settings 圖示同款輪廓），不 import lucide-react，手抄座標到這裡即可，
                stroke/fill 規格沿用 `.screen svg` 的全域設定，不必額外覆寫 */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </nav>
        {/* !failed 不可少：ready 只看 profile/targets/weight，初次載入成功之後才發生的失敗
            （loadDay 掛掉、刪除送不出去）不會讓 ready 轉 false。CTA 搬出 Today 之前是跟著
            Today 一起被錯誤畫面換掉的，搬到底部列之後就沒人管它了——會在「讀不到這天的
            紀錄」的畫面上留一顆綠色加號，按下去用過期的 rows 開表單（review 抓到）。 */}
        {tab === 'today' && ready && !failed && (
          <button className="cta" type="button" aria-label="記一筆" onClick={() => openSheet(defaultMeal())}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {ready && (
        <LogSheet
          open={sheetOpen}
          meal={sheetMeal}
          foods={foods}
          dayData={{ date: currentDate, rows }}
          targets={targets}
          onClose={closeSheet}
          onCreateIntake={handleCreateIntake}
          onCreateFood={handleCreateFood}
        />
      )}
    </div>
  )
}
