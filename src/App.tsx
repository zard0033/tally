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
import { computeTargets, num, type Targets } from '@/lib/formulas'
import { localDate, shiftDate } from '@/lib/dates'
import type { MealKey } from '@/lib/meals'
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
     代價是這段窗內關掉分頁的話刪除不會生效，所以 pagehide 會先結清（見 useEffect）。 */
  const pendingDelete = useRef<{ row: IntakeRow; index: number } | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const [undoOpen, setUndoOpen] = useState(false)
  const undoBtnRef = useRef<HTMLButtonElement>(null)

  const showNotice = useCallback(
    (headline: string, detail: string | undefined, actionLabel: string, onAction: () => void) => {
      setNotice({ headline, detail, actionLabel, onAction })
      setFailed(true)
    },
    [],
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
            ? '還沒有身高、生日這些身體參數，算不出目標熱量。'
            : '還沒有任何體重紀錄，算不出目標熱量。'
        showNotice('還沒有身體參數', detail, '重新載入', () => void load(date))
        return
      }
      const t = computeTargets(p, num(w.weight_kg))
      if (!Number.isFinite(t.kcal)) {
        showNotice('目標熱量算不出來', '身體參數有缺漏或格式不對，算出來的目標不是有效數字。', '重新載入', () => void load(date))
        return
      }
      setProfile(p)
      setWeight(w)
      setTargets(t)
      setRows(r)
      setFoods(f)
      setFailed(false)
      setNotice(null)
    } catch (e) {
      showNotice('讀不到你的資料', friendlyError(errMsg(e)), '重試', () => void load(date))
    }
    // 日期走顯式參數（跟 loadDay 對稱）——closure 抓 currentDate 曾造成
    // 「歷史日存設定後畫面日期與資料錯位」，precommit review 抓到的，別改回去
  }, [showNotice])

  /* 只換日期時不必重撈 profile／體重／食品庫——目標與食品庫不隨檢視日改變 */
  const loadDay = useCallback(
    async (date: string = currentDate) => {
      setRows(null)
      try {
        const r = await listIntake(date)
        setRows(r)
        setFailed(false)
        setNotice(null)
      } catch (e) {
        showNotice('讀不到這天的紀錄', friendlyError(errMsg(e)), '重試', () => void loadDay(date))
      }
    },
    [currentDate, showNotice],
  )

  const goToDate = useCallback(
    (iso: string) => {
      if (iso === currentDate) return
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return
      if (iso > localDate()) return // 看不了未來
      setCurrentDate(iso)
      void loadDay(iso)
    },
    [currentDate, loadDay],
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

  const commitDelete = useCallback(async () => {
    const p = pendingDelete.current
    if (!p) return
    pendingDelete.current = null
    window.clearTimeout(undoTimer.current)
    setUndoOpen(false)
    try {
      await apiDeleteIntake(p.row.id)
    } catch (e) {
      // 送不出去就把那一筆放回去，不留下「看起來刪掉了其實還在」
      restore(p)
      showNotice('刪不掉這一筆', friendlyError(errMsg(e)), '重試', () => void loadDay())
    }
  }, [loadDay, restore, showNotice])

  const handleDeleteIntake = useCallback(
    (id: number) => {
      // 同一列連點（樂觀移除到退場動畫跑完之間仍點得到）直接忽略
      if (pendingDelete.current?.row.id === id) return
      // 前一筆還在 undo 窗裡就先結清它——同時只維護一個待刪，省掉一整套佇列
      if (pendingDelete.current) void commitDelete()
      setRows((prev) => {
        if (!prev) return prev
        const index = prev.findIndex((r) => r.id === id)
        if (index < 0) return prev
        pendingDelete.current = { row: prev[index], index }
        return prev.filter((r) => r.id !== id)
      })
      setUndoOpen(true)
      window.clearTimeout(undoTimer.current)
      undoTimer.current = window.setTimeout(() => void commitDelete(), UNDO_MS)
    },
    [commitDelete],
  )

  /* 換日期就結清待刪：不然 undo 會把 A 日的 rows 快照放進正在看的 B 日，
     失敗時的還原也會錯位。待刪永遠不跨日，下面的還原邏輯才能假設同一天。 */
  const dateRef = useRef(currentDate)
  useEffect(() => {
    if (dateRef.current !== currentDate) {
      dateRef.current = currentDate
      if (pendingDelete.current) void commitDelete()
    }
  }, [currentDate, commitDelete])

  const undoDelete = useCallback(() => {
    const p = pendingDelete.current
    if (!p) return
    pendingDelete.current = null
    window.clearTimeout(undoTimer.current)
    setUndoOpen(false)
    restore(p)
  }, [restore])

  /* 被刪掉那一列連同它的刪除鈕一起離開 DOM，焦點會掉回 body，鍵盤使用者等於原地迷路、
     而且要在 5 秒內盲摸 Tab 才找得到「復原」。只在焦點真的掉了（activeElement 是 body）
     才把它接到復原鈕上——觸控刪除不會有 focus-visible 外框，看不出差別。 */
  useEffect(() => {
    if (!undoOpen) return
    if (document.activeElement === document.body) undoBtnRef.current?.focus()
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
            <button className="cta" type="button" onClick={notice.onAction}>
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
          />
        ) : (
          <Settings
            profile={profile}
            targets={targets}
            latestWeight={weight}
            onSaveProfile={handleSaveProfile}
            onSaveWeight={handleSaveWeight}
            onSignOut={handleSignOut}
          />
        )}
        {/* 刪除的可復原提示。role=status＋aria-live=polite：讀屏會播報，但不搶焦點——
            它是可忽略的提示，不是必須回應的對話框。時間到自己消失，不擋任何操作。
            放在 main 內用絕對定位浮在時間軸底部：走版面流的話它一出現就把時間軸擠短
            62px、消失再彈回來，每次刪除都抖一下（verifier 實測）。浮層蓋住的是時間軸
            最後幾列，不是 CTA。 */}
        <AnimatePresence>
          {undoOpen && (
            <motion.div
              className="undo-bar"
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={prefersReducedMotion() ? { duration: 0 } : { duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              <span>已刪除</span>
              <button type="button" ref={undoBtnRef} onClick={undoDelete}>
                復原
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <nav className="tabbar-wrap" aria-label="主要導覽">
        <div className="tabbar">
          <button
            className="tab"
            type="button"
            aria-current={tab === 'today' ? 'page' : undefined}
            onClick={() => setTab('today')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h16v16H4z" />
              <path d="M8 4v16" />
            </svg>
            日記
          </button>
          <button
            className="tab"
            type="button"
            aria-current={tab === 'settings' ? 'page' : undefined}
            onClick={() => setTab('settings')}
          >
            {/* 齒輪（cog），取代原本的圓＋放射線——那組讀起來像太陽／亮度圖示，跟「設定」
                語意不合（review 快篩抓到的）。path 是通用的齒輪幾何座標（lucide 的
                settings 圖示同款輪廓），不 import lucide-react，手抄座標到這裡即可，
                stroke/fill 規格沿用 `.screen svg` 的全域設定，不必額外覆寫 */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            設定
          </button>
        </div>
      </nav>

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
