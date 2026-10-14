import { describe, expect, it } from 'vitest'
import { classifyFailure, type QueueEntry } from './queue'
import { createSender, type SenderChain, type SenderClient, type SenderResponse } from './sender'

interface Call {
  table: string
  method: 'upsert' | 'update' | 'delete'
  values?: Record<string, unknown>
  options?: { onConflict: string; ignoreDuplicates?: boolean }
  eq: [string, string][]
  selected: string | null
  signal: AbortSignal | null
}

/** 記錄每一步呼叫的假 client。respond 決定該次請求的回應；回傳 Error＝丟例外。
 *  契約「update／delete 不得用 .single()」：假 client 根本不提供 single，真的呼叫會是 TypeError。 */
function fakeClient(respond: (c: Call) => SenderResponse | Error) {
  const calls: Call[] = []
  const chain = (c: Call): SenderChain => {
    const self: SenderChain = {
      select: (cols) => ((c.selected = cols), self),
      eq: (col, v) => (c.eq.push([col, v]), self),
      abortSignal: (s) => ((c.signal = s), self),
      then: (onFulfilled, onRejected) => {
        const r = respond(c)
        const p = r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
        return p.then(onFulfilled, onRejected)
      },
    }
    return self
  }
  const start = (c: Call) => {
    calls.push(c)
    return chain(c)
  }
  const client: SenderClient = {
    from: (table) => ({
      upsert: (values, options) =>
        start({ table, method: 'upsert', values, options, eq: [], selected: null, signal: null }),
      update: (values) => start({ table, method: 'update', values, eq: [], selected: null, signal: null }),
      delete: () => start({ table, method: 'delete', eq: [], selected: null, signal: null }),
    }),
  }
  return { client, calls }
}

const ok1: SenderResponse = { data: [{ id: 'x' }], error: null, status: 200 }
const ok0: SenderResponse = { data: [], error: null, status: 200 }

const entry = (patch: Partial<QueueEntry>): QueueEntry => ({
  seq: 1, op: 'insert', table: 'workouts', rowId: 'w1', payload: { performed_on: '2026-10-14' },
  userId: 'u1', createdAt: 0, attempts: 1, lastError: null, failure: null, ...patch,
})

const sig = () => new AbortController().signal

describe('createSender 契約（AC 22）', () => {
  it('insert 是 upsert，以 id 為衝突鍵，內容帶上 rowId', async () => {
    const { client, calls } = fakeClient(() => ok1)
    const r = await createSender(client)(entry({}), sig())
    expect(r).toEqual({ ok: true })
    expect(calls[0]).toMatchObject({
      table: 'workouts', method: 'upsert', options: { onConflict: 'id' },
      values: { id: 'w1', performed_on: '2026-10-14' },
    })
  })

  it('insert 回 2xx 但 0 列：回失敗並分類成 rejected，不讓佇列把唯一的一份當成功移除', async () => {
    const { client } = fakeClient(() => ok0)
    const r = await createSender(client)(entry({}), sig())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(classifyFailure(r.status)).toBe('rejected')
  })

  it('update 以 .eq(id) 定位、不改主鍵、要數筆數；0 列判失敗', async () => {
    const hit = fakeClient(() => ok1)
    const r1 = await createSender(hit.client)(
      entry({ op: 'update', payload: { id: 'ignored', ended_at: '2026-10-14T11:00:00Z' } }),
      sig(),
    )
    expect(r1).toEqual({ ok: true })
    expect(hit.calls[0]).toMatchObject({ method: 'update', eq: [['id', 'w1']], selected: 'id' })
    expect(hit.calls[0].values).toEqual({ ended_at: '2026-10-14T11:00:00Z' })

    const miss = fakeClient(() => ok0)
    const r2 = await createSender(miss.client)(entry({ op: 'update', payload: { v: 1 } }), sig())
    expect(r2.ok).toBe(false)
  })

  it('delete 0 列算成功（目標狀態已達成）；不用 .select 數筆數', async () => {
    const { client, calls } = fakeClient(() => ok0)
    const r = await createSender(client)(entry({ op: 'delete', payload: null }), sig())
    expect(r).toEqual({ ok: true })
    expect(calls[0]).toMatchObject({ method: 'delete', eq: [['id', 'w1']], selected: null })
  })

  it('ignoreDuplicates：改成 on conflict do nothing，且 0 列（已存在）算成功', async () => {
    const { client, calls } = fakeClient(() => ok0)
    const r = await createSender(client)(entry({ table: 'exercises', ignoreDuplicates: true }), sig())
    expect(r).toEqual({ ok: true })
    expect(calls[0].options).toEqual({ onConflict: 'id', ignoreDuplicates: true })
  })

  it('一般 insert 不帶 ignoreDuplicates', async () => {
    const { client, calls } = fakeClient(() => ok1)
    await createSender(client)(entry({}), sig())
    expect(calls[0].options).toEqual({ onConflict: 'id' })
  })

  it.each(['insert', 'update', 'delete'] as const)('%s：signal 傳給底層請求', async (op) => {
    const { client, calls } = fakeClient(() => ok1)
    const s = sig()
    await createSender(client)(entry({ op, payload: op === 'delete' ? null : { v: 1 } }), s)
    expect(calls[0].signal).toBe(s)
  })

  it.each([
    [0, 'offline'],
    [401, 'auth'],
    [403, 'rejected'],
    [409, 'rejected'],
    [503, 'transient'],
  ] as const)('伺服器回 %i：原樣把 status 交給佇列分類（%s）', async (status, kind) => {
    const { client } = fakeClient(() => ({ data: null, error: { message: 'x' }, status }))
    const r = await createSender(client)(entry({}), sig())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(status)
      expect(classifyFailure(r.status)).toBe(kind)
    }
  })

  it('底層丟例外：回 status 0（連不上），不讓整輪崩掉', async () => {
    const { client } = fakeClient(() => new TypeError('Load failed'))
    const r = await createSender(client)(entry({}), sig())
    expect(r).toEqual({ ok: false, status: 0, message: 'Load failed' })
  })

  it('不認得的表直接拒絕，不送到伺服器', async () => {
    const { client, calls } = fakeClient(() => ok1)
    const r = await createSender(client)(entry({ table: 'intake' }), sig())
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
    if (!r.ok) expect(classifyFailure(r.status)).toBe('rejected')
  })
})
