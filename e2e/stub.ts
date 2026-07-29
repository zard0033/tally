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

export async function seedFetchStub(page: Page, fix: typeof FixType, today: string, userId: string): Promise<void> {
  await page.addInitScript(
    ({ fix, today, userId, storageKey }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: 'stub-token',
          refresh_token: 'stub-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
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
        }),
      )

      const w = window as unknown as {
        __writes: { path: string; table: string; method: string; body: unknown }[]
        __allFetches: string[]
        __blocked: string[]
      }
      w.__writes = []
      w.__allFetches = []
      w.__blocked = []

      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

      const real = window.fetch.bind(window)
      // @ts-expect-error — 刻意覆寫全域 fetch，型別對不上是預期的
      window.fetch = async (input: RequestInfo | URL, opts: RequestInit = {}) => {
        const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
        w.__allFetches.push(u)

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
        if (table === 'intake') {
          // 有 eaten_on 參數＝當日清單查詢；比對日期。沒有＝listRecentIntake 的常吃排序查詢
          const m = /eaten_on=eq\.([\d-]+)/.exec(path)
          if (m) return json(m[1] === today ? fix.intake : [])
          return json(fix.history)
        }
        return json([])
      }
    },
    { fix, today, userId, storageKey: STORAGE_KEY },
  )
}
