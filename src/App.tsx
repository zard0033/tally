/* App 殼：auth 開機、資料狀態機、分頁殼。screens/ 底下三個畫面純呈現＋互動，
   所有資料讀取與 mutation 都收在這裡呼叫 src/lib/api.ts——理由與契約見 screens/types.ts。

   E2E seam：本檔完全不碰 window.fetch／XHR／WebSocket，所有 IO 都經 supabase-js
   （內部走 fetch）。只要外部把 window.fetch 換掉並在 localStorage 種好
   `sb-<ref>-auth-token`，這裡從開機判斷到 CRUD 全部離線可跑，不需要真網路。 */
import { useCallback, useEffect, useRef, useState } from 'react'
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

/** 原始錯誤訊息（'Failed to fetch'、'signal timed out'、AbortError…）對使用者沒有意義，
 *  換成看得懂的話。逾時的判準照委派指示：message 含 'AbortError' 一律當網路沒回應。
 *  逐字照 legacy/app.js 的 db() catch 區塊。 */
function friendlyError(message: string): string {
  if (message.includes('AbortError')) return '網路沒回應，請確認連線是否正常'
  if (message.includes('Failed to fetch') || message.includes('TypeError')) {
    return '連不上網路，請確認 Wi-Fi 或行動網路'
  }
  return message
}

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
  const load = useCallback(async () => {
    try {
      const [p, w, r, f] = await Promise.all([getProfile(), getLatestWeight(), listIntake(currentDate), listFoods()])
      if (!p || !w) {
        const detail = !p && !w
          ? '這個帳號的身體參數與體重紀錄都是空的。若之前用另一組帳號登入過，資料可能掛在那組帳號下——請確認登入的是同一個 Google 帳號。'
          : !p
            ? '還沒有身高、生日這些身體參數，算不出目標熱量。'
            : '還沒有任何體重紀錄，算不出目標熱量。'
        showNotice('還沒有身體參數', detail, '重新載入', () => void load())
        return
      }
      const t = computeTargets(p, num(w.weight_kg))
      if (!Number.isFinite(t.kcal)) {
        showNotice('目標熱量算不出來', '身體參數有缺漏或格式不對，算出來的目標不是有效數字。', '重新載入', () => void load())
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
      showNotice('讀不到你的資料', friendlyError(errMsg(e)), '重試', () => void load())
    }
    // currentDate 變動不該觸發這支——那是 loadDay 的事，load() 只在登入／全域重試時呼叫
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const handleDeleteIntake = useCallback(
    (id: number) => {
      void (async () => {
        try {
          await apiDeleteIntake(id)
          await loadDay()
        } catch (e) {
          showNotice('刪不掉這一筆', friendlyError(errMsg(e)), '回今天', () => void loadDay())
        }
      })()
    },
    [loadDay, showNotice],
  )

  /* 寫入失敗（記一筆／新增食物／設定編輯／記體重）刻意不接在這裡吞掉——
   * 讓錯誤 reject 到呼叫的 screen 自己接住，就地顯示「存不進去：」＋不清空已選＋
   * 按鈕變重試，跟 legacy 的 withBusy 行為一致（跟上面 deleteIntake 的全域 Notice 不同）。 */
  const handleCreateIntake = useCallback(
    async (newRows: NewIntake[]) => {
      const created = await apiCreateIntake(newRows)
      setSheetOpen(false)
      await loadDay()
      const ids = new Set(created.map((r) => r.id))
      setJustAddedIds(ids)
      if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setJustAddedIds(new Set()), 1300)
    },
    [loadDay],
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
      await load() // 參數變了，目標要重算；load() 保留在目前分頁，不會被丟回今日頁
    },
    [profile, load],
  )

  const handleSaveWeight = useCallback(
    async (w: Omit<NewWeight, 'user_id'>) => {
      if (!profile) throw new Error('身體參數還沒載入')
      await apiUpsertWeight({ ...w, user_id: profile.user_id })
      await load() // 體重變了，目標要重算
    },
    [profile, load],
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
      void load()
    } else if (!session) {
      loadedForSession.current = false
    }
  }, [session, load])

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
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4" />
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
