/* 離線佇列的本機儲存 adapter（階段 2，spec.md AC 15、20）。
 *
 * 只做兩件事：把 QueueStore 的 load／save 接到一個 key-value 儲存（真正的實作是 IndexedDB，
 * 由呼叫端注入），以及把底層的失敗翻成**明確的錯誤**。佇列是那幾筆資料唯一的一份，所以這裡的
 * 取向是「寧可大聲失敗，也不要悄悄改寫它」：
 * - 讀到格式不認得的內容就丟錯、不回 null——回 null 會讓佇列從空的開始，下一次 save 就把原本那份蓋掉。
 * - 寫入失敗（容量滿、隱私模式、IndexedDB 被關）一律丟 QueueStorageError，由 UI 告知「這筆沒有存下來」。 */

import type { FailureKind, OnParentDelete, QueueOp, QueueSnapshot, QueueStore } from './queue'

export class QueueStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'QueueStorageError'
  }
}

/** idb-keyval 的 get／set 形狀。測試注入記憶體版本。 */
export interface KeyValueStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export const QUEUE_STORAGE_KEY = 'offline-queue'

const OPS: readonly QueueOp[] = ['insert', 'update', 'delete']
const FAILURES: readonly FailureKind[] = ['offline', 'auth', 'rejected', 'transient']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

const ON_DELETE: readonly OnParentDelete[] = ['cascade', 'restrict', 'setNull']

function isRowRef(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v.table === 'string' &&
    typeof v.rowId === 'string' &&
    (v.column === undefined || typeof v.column === 'string') &&
    (v.onDelete === undefined || ON_DELETE.includes(v.onDelete as OnParentDelete))
  )
}

function isEntry(v: unknown): boolean {
  if (!isRecord(v)) return false
  return (
    isCount(v.seq) &&
    OPS.includes(v.op as QueueOp) &&
    typeof v.table === 'string' &&
    typeof v.rowId === 'string' &&
    typeof v.userId === 'string' &&
    (v.payload === null || isRecord(v.payload)) &&
    isCount(v.attempts) &&
    (v.failure === null || FAILURES.includes(v.failure as FailureKind)) &&
    (v.parents === undefined || (Array.isArray(v.parents) && v.parents.every(isRowRef))) &&
    (v.ignoreDuplicates === undefined || v.ignoreDuplicates === true) &&
    (v.maybeApplied === undefined || v.maybeApplied === true)
  )
}

function isSnapshot(v: unknown): v is QueueSnapshot {
  return isRecord(v) && isCount(v.nextSeq) && Array.isArray(v.entries) && v.entries.every(isEntry)
}

export function createQueueStore(kv: KeyValueStore, key: string = QUEUE_STORAGE_KEY): QueueStore {
  return {
    async load() {
      let raw: unknown
      try {
        raw = await kv.get(key)
      } catch (cause) {
        throw new QueueStorageError('讀不到本機尚未同步的資料', { cause })
      }
      if (raw === undefined || raw === null) return null
      if (!isSnapshot(raw)) {
        throw new QueueStorageError('本機尚未同步的資料格式不認得，已原樣保留、沒有覆蓋')
      }
      return raw
    },

    async save(snapshot) {
      try {
        await kv.set(key, snapshot)
      } catch (cause) {
        throw new QueueStorageError('這筆沒有存下來：本機儲存寫入失敗', { cause })
      }
    },
  }
}
