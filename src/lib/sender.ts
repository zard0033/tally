/* 離線佇列的 Supabase sender（階段 2，spec.md AC 16、22）。
 *
 * 契約（queue.ts 的 `Sender` 註解）一條一條落在這裡，錯一條就是丟資料而佇列在那頭看不出來：
 * - insert 用 upsert（onConflict: id）——回應遺失後重送不會撞 409；條目帶 ignoreDuplicates 時改成
 *   on conflict do nothing，且「0 列」算成功（那一列已經在了）。
 * - insert／update 都要 `.select('id')` 數筆數：2xx 但 0 列（RLS 擋下、列不存在）必須回失敗，
 *   否則佇列把唯一的一份當成功移除。
 * - delete 不數筆數：0 列＝目標狀態已達成（列本來就不在）。
 * - update／delete 不用 `.single()`：0 列會得 406、永遠重試不成功。
 * - signal 傳給底層 fetch（`.abortSignal`）：逾時才真的中止請求，不只是佇列不再等。
 * - 沒有回應（斷網、DNS、逾時）要回 status 0，佇列才分得出「連不上」與「被拒絕」。 */

import type { Sender, SendResult } from './queue'
import { TRAINING_TABLES } from './training'

/** supabase-js 回應的最小形狀。 */
export interface SenderResponse {
  readonly data: unknown
  readonly error: { readonly message: string } | null
  readonly status: number
}

export interface SenderChain extends PromiseLike<SenderResponse> {
  select(columns: string): SenderChain
  eq(column: string, value: string): SenderChain
  abortSignal(signal: AbortSignal): SenderChain
}

export interface SenderTable {
  upsert(values: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates?: boolean }): SenderChain
  update(values: Record<string, unknown>): SenderChain
  delete(): SenderChain
}

/** 只用到 `.from(table)`。真正的 supabase client 在接線處轉型成這個形狀。 */
export interface SenderClient {
  from(table: string): SenderTable
}

const TABLES: readonly string[] = TRAINING_TABLES

const rowCount = (data: unknown): number => (Array.isArray(data) ? data.length : 0)

function toResult(r: SenderResponse, zeroRowsOk: boolean): SendResult {
  if (r.error) return { ok: false, status: r.status, message: r.error.message }
  if (!zeroRowsOk && rowCount(r.data) === 0) {
    // 2xx 卻沒有任何列受影響：多半是 RLS 擋下。分類成 rejected（403），不是 transient——重試不會自己好。
    return { ok: false, status: 403, message: '伺服器沒有套用這筆（0 列受影響）' }
  }
  return { ok: true }
}

export function createSender(client: SenderClient): Sender {
  return async (entry, signal) => {
    if (!TABLES.includes(entry.table)) {
      return { ok: false, status: 400, message: `不認得的表：${entry.table}` }
    }
    try {
      const table = client.from(entry.table)
      if (entry.op === 'delete') {
        const r = await table.delete().eq('id', entry.rowId).abortSignal(signal)
        return toResult(r, true)
      }
      if (entry.op === 'insert') {
        const ignore = entry.ignoreDuplicates === true
        const r = await table
          .upsert(
            { ...entry.payload, id: entry.rowId },
            { onConflict: 'id', ...(ignore ? { ignoreDuplicates: true } : {}) },
          )
          .select('id')
          .abortSignal(signal)
        return toResult(r, ignore)
      }
      // id 不放進 update 的內容：以 .eq 定位，不改主鍵
      const { id: _id, ...fields } = { ...entry.payload } as Record<string, unknown>
      const r = await table.update(fields).eq('id', entry.rowId).select('id').abortSignal(signal)
      return toResult(r, false)
    } catch (e) {
      // 底層丟例外（不是正常路徑）：當成沒有回應，佇列會留著下次再試
      return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) }
    }
  }
}
