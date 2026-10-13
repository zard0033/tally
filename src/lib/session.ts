/* 本機 session 的讀取與驗證（階段 1 甲，離線開機快速路徑；見 spec.md AC 2）。
 *
 * 為什麼需要自己讀：supabase-js 的 getSession() 會先等初始化，而初始化包含「token 過期就 refresh」，
 * 後端連不上時 refresh 退避約 26 秒才放棄——期間任何 auth 呼叫都被擋住，連「我是誰」都問不出來。
 * 離線開機要的只是「本機有沒有一份看起來完整的 session」，不需要它是新的。
 *
 * 純函式、不碰 window／localStorage：字串由呼叫端（App.tsx）讀了傳進來，跟 lib 內禁沾 DOM 一致。 */
import type { Session } from '@supabase/supabase-js'

/** supabase-js 預設的 storageKey 形如 `sb-<project-ref>-auth-token`（ref＝URL 第一段子網域）。
 *  api.ts 建 client 時明確傳這個值進去，讓「我們讀的 key」與「supabase-js 寫的 key」由同一個
 *  函式決定，不是靠它的預設值剛好沒變。值與預設相同，所以既有登入不會被登出。 */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** 驗證 localStorage 裡的 session 字串。只認「欄位齊全」的，缺任何一欄、不是 JSON、不是物件都回
 *  null——呼叫端接著走原本的 getSession() 路徑，由 supabase-js 自己判斷，不在這裡猜。
 *  不判斷過期：過期的 session 正是這條路徑要服務的對象。 */
export function parseStoredSession(raw: string | null): Session | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const s = parsed as Record<string, unknown>
  const user = s.user
  if (typeof user !== 'object' || user === null || !isNonEmptyString((user as Record<string, unknown>).id)) return null
  if (!isNonEmptyString(s.access_token) || !isNonEmptyString(s.refresh_token)) return null
  if (typeof s.expires_at !== 'number' || !Number.isFinite(s.expires_at)) return null
  return parsed as Session
}
