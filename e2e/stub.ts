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
  /** 餐建議的回看查詢回 500。要從開機就失敗才需要這個選項；測試中途改 `window.__repeatFail` 模擬恢復。 */
  repeatFail?: boolean
  /** intake 寫入真的落地（預設不落地）：由 fix.intake／intakeYday／repeatWindow 起頭，POST 與 DELETE 改得到
   *  之後的 GET，驗「寫入後重撈」「復原」「切走切回不復活」用。PATCH 不落地。 */
  intakePersist?: boolean
  /** 開機就要停住的日期（見 __holdIntake）：開機時的預取測試來不及從外面設。 */
  holdIntake?: string[]
  /** 類型分類（read-label 的分類模式）的回應，見 __classify。不設＝每次都回 502：背景補判失敗是無聲的、
   *  也不寫任何東西，既有測試（新增食物會觸發補判）的寫入計數因此不受影響。 */
  classify?: ClassifyStub
}

/** ok＝依品名查 categories 回類型（查不到回「其他正餐」）；fail＝502。delayMs 造「補判還在路上」。 */
export interface ClassifyStub {
  mode: 'ok' | 'fail'
  categories?: Record<string, string>
  delayMs?: number
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
    ({ fix, today, userId, storageKey, intakeDelayMs, authMode, unparseableSession, dataDown, repeatFail, intakePersist, holdIntake, classify }) => {
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
        /* 非 GET 請求記錄後延遲這麼久才回應：造「前一筆還在路上」。 */
        __writeDelayMs: number
        /* 拍照辨識（read-label Edge Function）的回應控制。**預設 null＝比照其他非 rest/v1 的
         * 請求擋下來並記進 __blocked**，測試要用才明確打開——不讓「忘了設」變成靜默放行。
         * delayMs 是讓測試有時間在辨識途中操作畫面（例如打字），那正是 stale closure 那類
         * bug 唯一現形的時機。 */
        __scan: { mode: 'ok' | 'fail'; body?: unknown; delayMs?: number } | null
        /* 分類模式的回應控制（見 StubOptions.classify），測試中途可改。__classifyCalls＝每次送來的 foods。 */
        __classify: ClassifyStub
        __classifyCalls: { id: number; name: string; vendor: string | null }[][]
        /* 額度查詢（read-label 的 `credits: true`，設定頁的 AI 額度）。null＝回 502（設定頁顯示「讀不到額度」）；
           測試中途可改。__creditsCalls＝打了幾次。 */
        __credits: Record<string, unknown> | null
        __creditsCalls: number
        /* 分類與辨識送來的 `model`（設定頁選的主模型），依序記下。 */
        __readLabelModels: (string | undefined)[]
        /* 認證端點行為（見 StubOptions.authMode）。null＝一般測試，/auth/v1/ 走下面那道總擋。 */
        __authMode: AuthMode | null
        /* 設 true＝資料請求連不上（見 StubOptions.dataDown）。 */
        __dataDown: boolean
        /* 設 true＝實測維持熱量卡的區間查詢回 500，驗「讀不到記錄」那條。 */
        __kcalFail: boolean
        /* 區間查詢要回的列，蓋掉 fix.kcalWindow：測試中途換帳號用。 */
        __kcalWindow: { eaten_on: string; qty: number; kcal: number }[] | null
        /* 有值時區間查詢等它 resolve 才回，用來造「查詢在飛」。要回哪一份在等之前就決定了（查詢送出當下的帳號）。 */
        __kcalHold: Promise<void> | null
        /* 設 true＝餐建議的回看查詢回 500（見 StubOptions.repeatFail）。 */
        __repeatFail: boolean
        /* 餐建議的回看查詢回應過幾次（要回應前才 +1），斷言「失敗了也沒事」要等到它。 */
        __repeatServed: number
        /* 當日清單查詢的一次性注入（intakePersist 才有），放這個日期進去、用掉就清：
           __holdIntake＝快照在收到當下就定了、停住等 __releaseIntake() 才回，造「舊 GET 在寫入之後才落地」；
           __failIntake＝回 500，造「寫入成功但重撈失敗」（postgrest-js 只重試 503／520，所以 500 只打一次）。 */
        __holdIntake: Set<string>
        __heldIntake: (() => void)[]
        __releaseIntake: () => void
        __failIntake: Set<string>
        /* __dropIntake＝這個日期的下一次當日清單查詢斷一次網（丟 TypeError，跟真的斷線同一種錯），用掉就清：
           造「寫入成功、重撈剛好碰到網路抖一下」。postgrest-js 會重試這種錯，所以只有開了重試的查詢撐得過去（v2.128）。 */
        __dropIntake: Set<string>
      }
      w.__authMode = authMode
      w.__dataDown = dataDown
      w.__repeatFail = repeatFail
      w.__repeatServed = 0
      w.__holdIntake = new Set(holdIntake)
      w.__heldIntake = []
      w.__releaseIntake = () => w.__heldIntake.splice(0).forEach((release) => release())
      w.__failIntake = new Set()
      w.__dropIntake = new Set()
      w.__kcalFail = false
      w.__kcalWindow = null
      w.__kcalHold = null
      w.__writes = []
      w.__allFetches = []
      w.__blocked = []
      w.__intakeCalls = []
      w.__failNext = null
      w.__rejectWrite = null
      w.__writeDelayMs = 0
      w.__scan = null
      w.__classify = classify
      w.__classifyCalls = []
      w.__credits = null
      w.__creditsCalls = 0
      w.__readLabelModels = []

      const TRAINING_TABLES = [
        'exercises',
        'routines',
        'routine_exercises',
        'workouts',
        'workout_exercises',
        'workout_sets',
      ]
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

      /* 訓練六張表的假資料庫：由 fix 起頭，寫入真的落地、之後的 GET 讀得回來（不像 intake 的 stub
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

      // 昨天，只給「undo 跨日期」的 intake 查詢分流用（跟 e2e/fixtures.ts 的 YDAY 算法一致）
      const yday = (() => {
        const [y, mo, d] = today.split('-').map(Number)
        const dt = new Date(y, mo - 1, d - 1)
        const p = (n: number) => String(n).padStart(2, '0')
        return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
      })()

      /* intakePersist 的假資料表。fix.intake／intakeYday 沒有 eaten_on，由這裡依日期蓋上。 */
      let intakeStore: Record<string, unknown>[] = intakePersist
        ? [
            ...fix.intake.map((r) => ({ ...r, eaten_on: today })),
            ...fix.intakeYday.map((r) => ({ ...r, eaten_on: yday })),
            ...fix.repeatWindow,
          ]
        : []
      let nextIntakeId = 900
      /* 組 foods 關聯：先查 fix.foods，查不到再查 repeatWindow 同 food_id 的列——封存食物只放在 repeatWindow，
         因為 foods 查詢不看 filter，放進 fix.foods 就會被當成使用中的食物回給 listFoods。 */
      const intakeFoodsJoin = (foodId: unknown) => {
        const food = (fix.foods as Record<string, unknown>[]).find((f) => f.id === foodId)
        if (food) return { name: food.name, vendor: food.vendor, archived: food.archived ?? false, category: food.category ?? null }
        return fix.repeatWindow.find((r) => r.food_id === foodId)?.foods ?? null
      }

      /* foods 的寫入落地處，只給類型補判用：未分類查詢（`category=is.null`）從這裡篩，PATCH 依同樣的條件
         只動符合的列（「手動改過的不被覆蓋」靠它），POST 的新食物也放進來。一般的 foods GET 照舊回 fix.foods，
         既有測試的資料不變。 */
      let foodStore = (fix.foods as Record<string, unknown>[]).map((f) => ({ ...f }))
      const foodFilter = (qs: URLSearchParams) => {
        const idParam = qs.get('id') ?? ''
        const ids = idParam.startsWith('in.(') ? idParam.slice(4, -1).split(',').map(Number) : idParam ? [Number(idParam.replace(/^eq\./, ''))] : null
        return (f: Record<string, unknown>) =>
          (ids === null || ids.includes(f.id as number)) &&
          (qs.get('category') !== 'is.null' || f.category == null) &&
          (qs.get('category_manual') !== 'eq.false' || !f.category_manual)
      }

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
        /* 分類模式：body 帶 foods。排在拍照辨識之前（同一個網址）。 */
        if (u.includes('/functions/v1/read-label')) {
          let sent: { foods?: { id: number; name: string; vendor: string | null }[]; credits?: boolean; model?: string; image?: string } = {}
          try {
            sent = JSON.parse(String(opts.body ?? '{}'))
          } catch {
            sent = {}
          }
          if (sent.credits === true) {
            w.__creditsCalls++
            return w.__credits ? json(w.__credits) : json({ error: '辨識失敗' }, 502)
          }
          if (sent.foods || sent.image) w.__readLabelModels.push(sent.model)
          if (sent.foods) {
            w.__classifyCalls.push(sent.foods)
            const c = w.__classify
            if (c.delayMs) await new Promise((r) => setTimeout(r, c.delayMs))
            if (c.mode === 'fail') return json({ error: '辨識失敗' }, 502)
            return json({ results: sent.foods.map((f) => ({ id: f.id, category: c.categories?.[f.name] ?? '其他正餐' })) })
          }
        }

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

          if (w.__writeDelayMs) {
            // 失敗要在送出當下判定，不然 __failNext 會被延遲中的下一筆搶走
            const failing = w.__failNext?.table === table && w.__failNext.method === method
            if (failing) w.__failNext = null
            await new Promise((r) => setTimeout(r, w.__writeDelayMs))
            if (failing) return json({ message: '模擬的寫入失敗' }, 500)
          }

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
          // 每日目標存完不重撈，但之後的 load（例如存體重）會讀 profile：不落地就讀回舊值
          if (table === 'profile' && method === 'PATCH') {
            Object.assign(fix.profile[0], body as Record<string, unknown>)
            return new Response(null, { status: 204 })
          }
          if (table === 'foods' && method === 'POST') {
            const rec = Array.isArray(body) ? body[0] : body
            // 資料庫的預設值：還沒分類、沒手動改過
            const created = { id: 999, category: null, category_manual: false, ...(rec as Record<string, unknown>) }
            foodStore.push(created)
            return json([created], 201)
          }
          if (table === 'foods' && method === 'PATCH') {
            const qs = new URL(u).searchParams
            const hit = foodFilter(qs)
            const touched = foodStore.filter(hit).map((f) => f.id)
            foodStore = foodStore.map((f) => (hit(f) ? { ...f, ...(body as Record<string, unknown>) } : f))
            // .select('id') 要拿到真的寫到的列；就地編輯、封存沒有 select，照舊 204
            if (qs.has('select')) return json(touched.map((id) => ({ id })))
            return new Response(null, { status: 204 })
          }
          if (table === 'intake' && intakePersist) {
            if (method === 'PATCH') {
              const id = Number(new URL(u).searchParams.get('id')?.replace(/^eq\./, ''))
              intakeStore = intakeStore.map((r) => (r.id === id ? { ...r, ...(body as Record<string, unknown>) } : r))
              return new Response(null, { status: 204 })
            }
            if (method === 'POST') {
              // 同一批的 created_at 相同（比照 DB 的交易時間），時間軸順序要靠 id
              const created_at = new Date().toISOString()
              const rows = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]
              const added = rows.map((r) => ({ ...r, id: nextIntakeId++, created_at, foods: intakeFoodsJoin(r.food_id) }))
              intakeStore.push(...added)
              return json(added.map(({ id }) => ({ id })), 201)
            }
            if (method === 'DELETE') {
              // new URL 已解碼：.in() 送的是 id=in.%281%2C2%29
              const filter = new URL(u).searchParams.get('id') ?? ''
              const ids = (filter.startsWith('in.(') ? filter.slice(4, -1).split(',') : [filter.replace(/^eq\./, '')]).map(Number)
              intakeStore = intakeStore.filter((r) => !ids.includes(r.id as number))
              return new Response(null, { status: 204 })
            }
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
        if (table === 'foods') {
          const qs = new URL(u).searchParams
          if (qs.get('category') === 'is.null') return json(foodStore.filter(foodFilter(qs)))
          return json(fix.foods)
        }
        // 訓練表（階段 2）：stub 不看 filter，回該表目前的全部列（fixture ＋ 已落地的寫入）。
        // 認 offset／limit（分頁）：執行期的分頁迴圈停在空頁，stub 若每頁都回整份就停不下來。
        if (TRAINING_TABLES.includes(table)) {
          const qs = new URL(u).searchParams
          const offset = Number(qs.get('offset') ?? 0)
          const limit = qs.get('limit') === null ? Infinity : Number(qs.get('limit'))
          return json([...trainStore[table].values()].slice(offset, offset + limit))
        }
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
            const kcalWindow = w.__kcalWindow ?? fix.kcalWindow
            if (w.__kcalHold) await w.__kcalHold
            return json(kcalWindow.slice(offset, offset + limit))
          }
          /* 餐建議的回看查詢：select 含 meal、且是區間條件。沒有這條會落到最下面回 fix.history，列沒有
             eaten_on，App 算建議時會崩。不記 __intakeCalls：那是給「當日清單打了幾次」計次用的。 */
          if (selectCols.includes('meal') && path.includes('eaten_on=gte.')) {
            w.__repeatServed++
            if (w.__repeatFail) return json({ message: '模擬的讀取失敗' }, 500)
            const range = new URL(u).searchParams.getAll('eaten_on')
            const from = range.find((c) => c.startsWith('gte.'))?.slice(4) ?? ''
            const to = range.find((c) => c.startsWith('lte.'))?.slice(4) ?? '9999'
            const source = intakePersist ? intakeStore : fix.repeatWindow
            return json(source.filter((r) => (r.eaten_on as string) >= from && (r.eaten_on as string) <= to))
          }
          // 有 eaten_on 參數＝當日清單查詢；比對日期。沒有＝listRecentIntake 的常吃排序查詢
          const m = /eaten_on=eq\.([\d-]+)/.exec(path)
          if (m) {
            w.__intakeCalls.push(m[1])
            if (w.__dropIntake.delete(m[1])) throw new TypeError('Load failed')
            if (intakeDelayMs) await new Promise((r) => setTimeout(r, intakeDelayMs))
            // 延遲期間才斷線：造「慢請求晚到才失敗」，開頭那道檢查攔不到
            if (intakeDelayMs && w.__dataDown) throw new TypeError('Load failed')
            if (intakePersist) {
              if (w.__failIntake.delete(m[1])) return json({ message: '模擬的讀取失敗' }, 500)
              const snapshot = intakeStore.filter((r) => r.eaten_on === m[1])
              if (w.__holdIntake.delete(m[1])) await new Promise<void>((release) => w.__heldIntake.push(release))
              return json(snapshot)
            }
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
      repeatFail: opts.repeatFail ?? false,
      intakePersist: opts.intakePersist ?? false,
      holdIntake: opts.holdIntake ?? [],
      classify: opts.classify ?? { mode: 'fail' },
    },
  )
}
