/* fetch stub + session seed，裝在 page.addInitScript——保證在任何 navigation／互動之前
   window.fetch 已經被換掉、localStorage 已經種好 session，不會有真實請求打中正式 Supabase。

   安全紅線（委派指示明講的那條)：這環境的 page.route() 完全不攔截，唯一可靠的擋法是
   在 init script 裡自己換 window.fetch。任何打到 supabase.co 但不是 /rest/v1/ 的請求
   （尤其 /auth/v1/token 這類）一律擋下記錄，不放行——零真實網路請求的斷言就是靠
   __blocked 這個陣列撐起來的，不是「沒看到報錯就當作沒發生」。

   storageKey 格式 sb-<project-ref>-auth-token 是 supabase-js 的預設值（ref 從
   SUPABASE_URL 的子網域取出），抄自 src/lib/config.ts；那邊的 URL 一旦換專案，
   下面的 SUPABASE_REF 常數要跟著改。 */
import type { Page } from '@playwright/test'
import type { FIX as FixType } from './fixtures'

const SUPABASE_REF = 'bpnucfejoiazmsnsuzdb' // 同步自 src/lib/config.ts 的 SUPABASE_URL
const STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`

export interface StubOptions {
  /** intake 查詢（listIntake）的人工延遲，只用來量「無感切日期」的實際毫秒數；
   *  不設就是 0——其餘測試不需要真的等這段時間。 */
  intakeDelayMs?: number
  /** 認證端點（/auth/v1/）的行為。**設了就會種一個已過期的 session**——讓 supabase-js 非打
   *  refresh 不可，不然根本走不到這條路徑。測試中途可改 `window.__authMode` 模擬後端恢復。
   *   - down：TypeError('Load failed')——Safari 的原文，跟 DNS 被撤時 fetch 的反應一致
   *   - hang：連上了但永不回應（fetch 不 reject，getSession 不 settle）
   *   - ok：回一個新的合法 session
   *   - revoked：400 refresh_token_not_found（refresh token 已被撤銷）
   *  全部都記進 __blocked——這些仍是「沒有放行到真實網路」。rest/v1 不受影響。 */
  authMode?: AuthMode
  /** 種一份**缺 user 欄位**的 session——App 的 parseStoredSession 認不得它，會退回原本的
   *  getSession() 開機流程（由 supabase-js 自己判斷；它只要求 access_token／refresh_token／
   *  expires_at 三欄）。用來守那條退路：本機 session 一般會走離線快速路徑（v2.51），
   *  開機畫面的慢態／連不上後端只剩這條走得到。要搭配 authMode（過期才會觸發 refresh）。 */
  unparseableSession?: boolean
  /** 資料請求（/rest/v1/）全部連不上、認證端點照常——模擬「token 有效但沒網路」（一小時內再開 App）。
   *  跟 authMode 不同：不種過期 session，所以不會走離線優先那條。測試中途改 `window.__dataDown` 模擬網路回來。 */
  dataDown?: boolean
}

export type AuthMode = 'down' | 'hang' | 'ok' | 'revoked'

export async function seedFetchStub(
  page: Page,
  fix: typeof FixType,
  today: string,
  userId: string,
  opts: StubOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({ fix, today, userId, storageKey, intakeDelayMs, authMode, unparseableSession, dataDown }) => {
      const stored: Record<string, unknown> = {
        access_token: 'stub-token',
        refresh_token: 'stub-refresh',
        expires_at: Math.floor(Date.now() / 1000) + (authMode ? -3600 : 3600),
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: userId,
          aud: 'authenticated',
          email: 'stub@example.com',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      }
      if (unparseableSession) delete stored.user
      localStorage.setItem(storageKey, JSON.stringify(stored))

      const w = window as unknown as {
        __writes: { path: string; table: string; method: string; body: unknown }[]
        __allFetches: string[]
        __blocked: string[]
        __intakeCalls: string[] // 每次 listIntake(date) 打中的日期，依序累積，量快取/計次用
        /* 一次性寫入失敗注入。測試在畫面上設好狀態後把它設起來，下一個符合的寫入回 500
         * 並自動清空——用來驗「失敗訊息怎麼呈現／有沒有殘留」這類只有失敗路徑才走得到的
         * 分支。page.route() 在這個環境完全不攔截（見檔頭），所以只能從 stub 內部注入。 */
        __failNext: { table: string; method: string } | null
        /* 持久的寫入拒絕：table → HTTP 狀態碼，該表的**每一個**非 GET 請求都回這個碼（不自動清空）。
         * 跟 __failNext 的差別：那個是一次性 500（transient），這個用來造 4xx（409／403＝rejected、
         * 401＝auth）——佇列對 4xx 不會自己好，要持續拒絕才驗得到「卡住了怎麼辦」那條路徑。 */
        __rejectWrite: Record<string, number> | null
        /* 拍照辨識（read-label Edge Function）的回應控制。**預設 null＝比照其他非 rest/v1 的
         * 請求擋下來並記進 __blocked**，測試要用才明確打開——不讓「忘了設」變成靜默放行。
         * delayMs 是讓測試有時間在辨識途中操作畫面（例如打字），那正是 stale closure 那類
         * bug 唯一現形的時機。 */
        __scan: { mode: 'ok' | 'fail'; body?: unknown; delayMs?: number } | null
        /* 認證端點行為（見 StubOptions.authMode）。null＝一般測試，/auth/v1/ 走下面那道總擋。 */
        __authMode: AuthMode | null
        /* 設 true＝資料請求連不上（見 StubOptions.dataDown）。 */
        __dataDown: boolean
        /* 設 true＝實測維持熱量卡的區間查詢回 500，驗「讀不到記錄」那條。 */
        __kcalFail: boolean
      }
      w.__authMode = authMode
      w.__dataDown = dataDown
      w.__kcalFail = false
      w.__writes = []
      w.__allFetches = []
      w.__blocked = []
      w.__intakeCalls = []
      w.__failNext = null
      w.__rejectWrite = null
      w.__scan = null

      const TRAINING_TABLES = [
        'exercises',
        'routines',
        'routine_exercises',
        'workouts',
        'workout_exercises',
        'workout_sets',
        'cardio_sessions',
      ]
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

      /* 訓練七張表的假資料庫：由 fix 起頭，寫入真的落地、之後的 GET 讀得回來（不像 intake 的 stub
         不落地）。離線記錄 → 回線同步 → 重新載入這條鏈，要寫入落地才驗得出「沒有重複、沒有消失」。
         語意只做到這份 App 用到的：POST＝upsert（Prefer 帶 ignore-duplicates 時已存在就略過），
         回傳實際動到的列（`.select('id')` 要靠它數筆數）；PATCH／DELETE 以 `id=eq.` 定位；
         刪除 workouts／workout_exercises 會 cascade（跟 DDL 一樣）。 */
      const trainStore: Record<string, Map<string, Record<string, unknown>>> = {}
      for (const t of TRAINING_TABLES) {
        const seed = ((fix as unknown as Record<string, unknown>)[t] ?? []) as Record<string, unknown>[]
        trainStore[t] = new Map(seed.map((r) => [String(r.id), { ...r }]))
      }
      const removeCascade = (table: string, id: string) => {
        trainStore[table].delete(id)
        if (table === 'workouts') {
          for (const [k, r] of [...trainStore.workout_exercises]) if (r.workout_id === id) removeCascade('workout_exercises', k)
        }
        if (table === 'workout_exercises') {
          for (const [k, r] of [...trainStore.workout_sets]) if (r.workout_exercise_id === id) trainStore.workout_sets.delete(k)
        }
      }
      ;(window as unknown as { __trainRows: (t: string) => Record<string, unknown>[] }).__trainRows = (t) => [
        ...trainStore[t].values(),
      ]
      /* 直接在「伺服器」放一列，不經過 app：模擬「這列在伺服器上已存在、但這台裝置的本機底不知道」
         （離線期間別台裝置改過、或本機底過期）——insert-ignore 能不能保護它，只有這樣才測得到。 */
      ;(window as unknown as { __trainPut: (t: string, row: Record<string, unknown>) => void }).__trainPut = (t, row) => {
        trainStore[t].set(String(row.id), { ...row })
      }

      // 昨天，只給「undo 跨日期」的 intake 查詢分流用（跟 e2e/fixtures.ts 的 YDAY 算法一致）
      const yday = (() => {
        const [y, mo, d] = today.split('-').map(Number)
        const dt = new Date(y, mo - 1, d - 1)
        const p = (n: number) => String(n).padStart(2, '0')
        return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
      })()

      const real = window.fetch.bind(window)
      // @ts-expect-error — 刻意覆寫全域 fetch，型別對不上是預期的
      window.fetch = async (input: RequestInfo | URL, opts: RequestInit = {}) => {
        /* 真的 fetch 收到已 abort 的 signal 會立刻 reject。這支 stub 原本不看 signal，於是 App 的
           `AbortSignal.timeout(8000)` 在測試裡形同虛設——「請求在被放行前就已逾時」這類失敗形態
           （v2.51 離線開機被 review 抓到的卡死）整個走不到。 */
        if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
        const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
        w.__allFetches.push(u)

        /* 拍照辨識：排在下面那道總擋之前，但**沒設 __scan 就一樣落回去被擋**，
           所以「測試忘了打開」不會靜默變成放行。 */
        if (u.includes('/functions/v1/read-label') && w.__scan) {
          const s = w.__scan
          if (s.delayMs) await new Promise((r) => setTimeout(r, s.delayMs))
          return s.mode === 'fail' ? json({ error: '辨識失敗' }, 502) : json(s.body)
        }

        if (w.__authMode && u.includes('/auth/v1/')) {
          w.__blocked.push(u)
          switch (w.__authMode) {
            case 'down':
              throw new TypeError('Load failed')
            case 'hang':
              return new Promise<Response>(() => {})
            case 'revoked':
              return json(
                { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' },
                400,
              )
            case 'ok':
              return json({
                access_token: 'stub-token-2',
                refresh_token: 'stub-refresh-2',
                expires_in: 3600,
                token_type: 'bearer',
                user: {
                  id: userId,
                  aud: 'authenticated',
                  email: 'stub@example.com',
                  app_metadata: {},
                  user_metadata: {},
                  created_at: new Date().toISOString(),
                },
              })
          }
        }

        /* 'down'＝整條網路斷了（DNS 被撤、飛航模式），不只認證端點：資料 REST 一樣連不上。
           只斷 /auth/v1/ 的話，supabase-js 放棄 refresh 後會拿 anon key 繼續發請求、而這裡的 REST
           照常回資料，「離線」在 stub 裡自己痊癒了——真網路斷時不會（離線提示測試的前提）。 */
        if ((w.__authMode === 'down' || w.__dataDown) && u.includes('/rest/v1/')) throw new TypeError('Load failed')

        if (u.includes('supabase.co') && !u.includes('/rest/v1/')) {
          w.__blocked.push(u)
          return new Response(JSON.stringify({ message: 'blocked by e2e stub: ' + u }), { status: 599 })
        }
        if (!u.includes('/rest/v1/')) return real(input as RequestInfo, opts)

        const path = u.split('/rest/v1/')[1] ?? ''
        const table = path.split('?')[0]
        const method = (opts.method || 'GET').toUpperCase()

        if (method !== 'GET') {
          let body: unknown = null
          try {
            body = opts.body ? JSON.parse(String(opts.body)) : null
          } catch {
            body = opts.body ?? null
          }
          w.__writes.push({ path, table, method, body })

          // 記錄在前、判失敗在後：要能斷言「確實送出了，但伺服器回錯」
          if (w.__failNext && w.__failNext.table === table && w.__failNext.method === method) {
            w.__failNext = null
            return json({ message: '模擬的寫入失敗' }, 500)
          }

          const rejected = w.__rejectWrite?.[table]
          if (rejected) return json({ code: rejected === 409 ? '23503' : 'PGRST000', message: '模擬的拒絕' }, rejected)

          if (TRAINING_TABLES.includes(table)) {
            const prefer = new Headers((opts.headers ?? {}) as HeadersInit).get('prefer') ?? ''
            const rows = (Array.isArray(body) ? body : body ? [body] : []) as Record<string, unknown>[]
            const id = new URL(u).searchParams.get('id')?.replace(/^eq\./, '') ?? null
            if (method === 'POST') {
              const touched: { id: string }[] = []
              for (const r of rows) {
                const rid = String(r.id)
                const cur = trainStore[table].get(rid)
                if (cur && prefer.includes('ignore-duplicates')) continue
                trainStore[table].set(rid, { ...cur, ...r })
                touched.push({ id: rid })
              }
              return json(touched, 201)
            }
            if (method === 'PATCH' && id) {
              const cur = trainStore[table].get(id)
              if (!cur) return json([])
              trainStore[table].set(id, { ...cur, ...(body as Record<string, unknown>) })
              return json([{ id }])
            }
            if (method === 'DELETE' && id) {
              removeCascade(table, id)
              return new Response(null, { status: 204 })
            }
          }
          if (table === 'foods' && method === 'POST') {
            const rec = Array.isArray(body) ? body[0] : body
            return json([{ id: 999, ...(rec as Record<string, unknown>) }], 201)
          }
          if (table === 'intake' && method === 'POST') {
            const rows = Array.isArray(body) ? body : [body]
            return json(
              rows.map((_, i) => ({ id: 900 + i })),
              201,
            )
          }
          return new Response(null, { status: 204 })
        }

        if (table === 'profile') return json(fix.profile)
        if (table === 'weight') return json(fix.weight)
        if (table === 'foods') return json(fix.foods)
        // 訓練表（階段 2）：stub 不看 filter／range，回該表目前的全部列（fixture ＋ 已落地的寫入）。
        // 單頁就回完（列數 < pageSize），執行期的分頁迴圈一頁就停。
        if (TRAINING_TABLES.includes(table)) return json([...trainStore[table].values()])
        if (table === 'intake') {
          /* 實測維持熱量卡的區間查詢：認的是「select 欄位含 eaten_on 且不含 meal」，不認欄位順序
             （順序一換就會悄悄 fall through 到 history，卡片測試會為錯的原因紅）。
             stub 不看 filter，回整份 kcalWindow；測試要驗 filter 就讀 window.__allFetches。 */
          const selectCols = (/select=([^&]*)/.exec(decodeURIComponent(path))?.[1] ?? '').split(',')
          if (selectCols.includes('eaten_on') && !selectCols.includes('meal')) {
            if (w.__kcalFail) return json({ message: '模擬的讀取失敗' }, 500)
            // 認 offset／limit（分頁）：listIntakeKcal 會一頁頁翻到空頁才停，stub 若每頁都回整份就停不下來
            const qs = new URL(u).searchParams
            const offset = Number(qs.get('offset') ?? 0)
            const limit = qs.get('limit') === null ? Infinity : Number(qs.get('limit'))
            return json(fix.kcalWindow.slice(offset, offset + limit))
          }
          // 有 eaten_on 參數＝當日清單查詢；比對日期。沒有＝listRecentIntake 的常吃排序查詢
          const m = /eaten_on=eq\.([\d-]+)/.exec(path)
          if (m) {
            w.__intakeCalls.push(m[1])
            if (intakeDelayMs) await new Promise((r) => setTimeout(r, intakeDelayMs))
            if (m[1] === today) return json(fix.intake)
            if (m[1] === yday) return json(fix.intakeYday)
            return json([])
          }
          return json(fix.history)
        }
        return json([])
      }
    },
    {
      fix,
      today,
      userId,
      storageKey: STORAGE_KEY,
      intakeDelayMs: opts.intakeDelayMs ?? 0,
      authMode: opts.authMode ?? null,
      unparseableSession: opts.unparseableSession ?? false,
      dataDown: opts.dataDown ?? false,
    },
  )
}
