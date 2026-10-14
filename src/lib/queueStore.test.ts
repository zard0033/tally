import { describe, expect, it } from 'vitest'
import { appendEntry, createQueue, emptySnapshot, type QueueEntry, type QueueSnapshot, type SendResult } from './queue'
import { QUEUE_STORAGE_KEY, QueueStorageError, createQueueStore, type KeyValueStore } from './queueStore'

/** 記憶體版 key-value；經過 structuredClone，模擬 IndexedDB 存進去的是副本。 */
function memoryKv(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial))
  const calls = { get: 0, set: 0 }
  const fail = { get: false, set: false }
  const kv: KeyValueStore = {
    get: async (k) => {
      calls.get++
      if (fail.get) throw new Error('get boom')
      return data.has(k) ? structuredClone(data.get(k)) : undefined
    },
    set: async (k, v) => {
      calls.set++
      if (fail.set) throw new DOMException('quota', 'QuotaExceededError')
      data.set(k, structuredClone(v))
    },
  }
  return { kv, data, calls, fail }
}

const entry = (patch: Partial<QueueEntry> = {}): QueueEntry => ({
  seq: 1, op: 'insert', table: 'workouts', rowId: 'w1', payload: { performed_on: '2026-10-14' },
  userId: 'u1', createdAt: 1, attempts: 0, lastError: null, failure: null, ...patch,
})

describe('createQueueStore', () => {
  it('沒存過回 null', async () => {
    expect(await createQueueStore(memoryKv().kv).load()).toBeNull()
  })

  it('存了再讀回來，內容相同（含 parents 與 ignoreDuplicates）', async () => {
    const m = memoryKv()
    const store = createQueueStore(m.kv)
    const snap: QueueSnapshot = {
      nextSeq: 3,
      entries: [
        entry({ parents: [{ table: 'workouts', rowId: 'w0' }], ignoreDuplicates: true }),
        entry({ seq: 2, op: 'delete', payload: null, failure: 'rejected', lastError: 'x', attempts: 2 }),
      ],
    }
    await store.save(snap)
    expect(await store.load()).toEqual(snap)
    expect(m.data.has(QUEUE_STORAGE_KEY)).toBe(true)
  })

  it.each([
    ['不是物件', 'oops'],
    ['缺 nextSeq', { entries: [] }],
    ['nextSeq 不是整數', { nextSeq: 1.5, entries: [] }],
    ['entries 不是陣列', { nextSeq: 1, entries: {} }],
    ['條目缺 rowId', { nextSeq: 2, entries: [{ ...entry(), rowId: undefined }] }],
    ['條目 op 不認得', { nextSeq: 2, entries: [{ ...entry(), op: 'upsert' }] }],
    ['條目 failure 不認得', { nextSeq: 2, entries: [{ ...entry(), failure: 'weird' }] }],
    ['parents 格式錯', { nextSeq: 2, entries: [{ ...entry(), parents: [{ table: 1 }] }] }],
    ['payload 是陣列', { nextSeq: 2, entries: [{ ...entry(), payload: [] }] }],
  ])('內容格式不認得（%s）：丟錯、且不寫入——否則下一次 save 會把原本那份蓋掉', async (_label, raw) => {
    const m = memoryKv({ [QUEUE_STORAGE_KEY]: raw })
    const store = createQueueStore(m.kv)
    await expect(store.load()).rejects.toBeInstanceOf(QueueStorageError)
    expect(m.calls.set).toBe(0)
    expect(m.data.get(QUEUE_STORAGE_KEY)).toEqual(raw)
  })

  it('讀取失敗翻成 QueueStorageError，原因保留在 cause', async () => {
    const m = memoryKv()
    m.fail.get = true
    const err = await createQueueStore(m.kv).load().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(QueueStorageError)
    expect((err as QueueStorageError).cause).toBeInstanceOf(Error)
  })

  it('寫入失敗（容量滿）翻成「這筆沒有存下來」（AC 20）', async () => {
    const m = memoryKv()
    m.fail.set = true
    const err = await createQueueStore(m.kv).save(emptySnapshot()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(QueueStorageError)
    expect((err as QueueStorageError).message).toContain('沒有存下來')
    expect(((err as QueueStorageError).cause as DOMException).name).toBe('QuotaExceededError')
  })
})

describe('接上佇列', () => {
  const ok = async (): Promise<SendResult> => ({ ok: true })

  it('寫入失敗時 enqueue 明確失敗，且記憶體狀態不前進（重試不會多出一條）', async () => {
    const m = memoryKv()
    const q = createQueue({ store: createQueueStore(m.kv), send: ok })
    m.fail.set = true
    await expect(q.enqueue({ op: 'insert', table: 'workouts', rowId: 'w1', payload: { v: 1 }, userId: 'u1' })).rejects.toBeInstanceOf(
      QueueStorageError,
    )
    m.fail.set = false
    await q.enqueue({ op: 'insert', table: 'workouts', rowId: 'w1', payload: { v: 1 }, userId: 'u1' })
    expect((await q.summary('u1')).total).toBe(1)
  })

  it('重開（新實例、同一份儲存）後尚未送出的條目還在，且送得出去', async () => {
    const m = memoryKv()
    const first = createQueue({ store: createQueueStore(m.kv), send: ok })
    await first.enqueue({ op: 'insert', table: 'workouts', rowId: 'w1', payload: { v: 1 }, userId: 'u1' })
    await first.enqueue({
      op: 'insert', table: 'workout_exercises', rowId: 'we1', payload: { v: 1 }, userId: 'u1',
      parents: [{ table: 'workouts', rowId: 'w1' }],
    })
    const sent: string[] = []
    const reopened = createQueue({
      store: createQueueStore(m.kv),
      send: async (e) => {
        sent.push(e.rowId)
        return { ok: true }
      },
    })
    expect((await reopened.summary('u1')).total).toBe(2)
    const r = await reopened.flush('u1')
    expect(sent).toEqual(['w1', 'we1'])
    expect(r.summary.total).toBe(0)
  })

  it('appendEntry 產生的快照可以直接存取（結構化複製不丟欄位）', async () => {
    const m = memoryKv()
    const store = createQueueStore(m.kv)
    const snap = appendEntry(
      emptySnapshot(),
      { op: 'insert', table: 'exercises', rowId: 'e1', payload: { name: 'x' }, userId: 'u1', ignoreDuplicates: true },
      5,
    )
    await store.save(snap)
    expect(await store.load()).toEqual(snap)
  })
})
