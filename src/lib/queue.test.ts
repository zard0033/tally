import { describe, expect, it } from 'vitest'
import {
  appendEntry,
  classifyFailure,
  createQueue,
  emptySnapshot,
  signOutPlan,
  summarize,
  type NewEntry,
  type QueueEntry,
  type QueueSnapshot,
  type QueueStore,
  type SendResult,
} from './queue'

/* ═══════════ 測試替身 ═══════════ */

/** 假伺服器：insert＝upsert（冪等）、update 對不存在的列靜默 0 筆（PostgREST 不報錯）、delete 對不存在的列無害。
 *  用最終狀態斷言，不只數呼叫次數——順序與冪等的錯，只有最終狀態看得出來。 */
function fakeServer() {
  const rows = new Map<string, Record<string, unknown>>()
  const apply = (e: QueueEntry) => {
    const k = `${e.table}/${e.rowId}`
    if (e.op === 'insert') rows.set(k, { ...e.payload })
    else if (e.op === 'update') {
      const r = rows.get(k)
      if (r) rows.set(k, { ...r, ...e.payload })
    } else rows.delete(k)
  }
  return { rows, apply }
}

/** 可編排的 sender。behave 回傳：'ok'＝落地並成功；'lost'＝落地但回應遺失（status 0）；
 *  'lost503'＝落地但回 503；數字＝沒落地、回該狀態碼；'throw'＝sender 本身丟例外。 */
type Behaviour = 'ok' | 'lost' | 'lost503' | 'throw' | number
function scriptedSender(server: ReturnType<typeof fakeServer>, behave: (e: QueueEntry, n: number) => Behaviour) {
  const sent: QueueEntry[] = []
  const send = async (e: QueueEntry): Promise<SendResult> => {
    sent.push(e)
    const b = behave(e, sent.length)
    if (b === 'throw') throw new Error('boom')
    if (b === 'ok') {
      server.apply(e)
      return { ok: true }
    }
    if (b === 'lost') {
      server.apply(e)
      return { ok: false, status: 0, message: 'TimeoutError' }
    }
    if (b === 'lost503') {
      server.apply(e)
      return { ok: false, status: 503, message: 'HTTP 503' }
    }
    return { ok: false, status: b, message: `HTTP ${b}` }
  }
  return { send, sent }
}

function memoryStore(initial: QueueSnapshot | null = null) {
  const mem = {
    saved: initial,
    onSave: null as null | ((s: QueueSnapshot) => void),
    store: null as unknown as QueueStore,
  }
  mem.store = {
    load: async () => mem.saved,
    save: async (s) => {
      mem.onSave?.(s)
      mem.saved = s
    },
  }
  return mem
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

const ins = (rowId: string, payload: Record<string, unknown> = { v: 1 }, userId = 'u1'): NewEntry => ({
  op: 'insert', table: 't', rowId, payload, userId,
})
const upd = (rowId: string, payload: Record<string, unknown>, userId = 'u1'): NewEntry => ({
  op: 'update', table: 't', rowId, payload, userId,
})
const del = (rowId: string, userId = 'u1'): NewEntry => ({ op: 'delete', table: 't', rowId, userId })

const build = (initial: QueueSnapshot | null = null, behave: (e: QueueEntry, n: number) => Behaviour = () => 'ok') => {
  const server = fakeServer()
  const mem = memoryStore(initial)
  const sender = scriptedSender(server, behave)
  let clock = 1_000
  const queue = createQueue({ store: mem.store, send: sender.send, now: () => clock++ })
  return { server, mem, sender, queue }
}

/* ═══════════ 純函式 ═══════════ */

describe('classifyFailure', () => {
  it.each([
    [0, 'offline'],
    [401, 'auth'],
    [400, 'rejected'],
    [403, 'rejected'], // RLS 擋下是 403，不是 401：重新登入也沒用
    [404, 'rejected'],
    [409, 'rejected'],
    [422, 'rejected'],
    [408, 'transient'],
    [425, 'transient'],
    [429, 'transient'],
    [500, 'transient'],
    [503, 'transient'],
    [302, 'transient'], // 怪碼寧可留著再試，不判死
  ] as const)('%i → %s', (status, kind) => {
    expect(classifyFailure(status)).toBe(kind)
  })
})

describe('appendEntry', () => {
  it('seq 單調遞增，同一毫秒也不平手', () => {
    let s = emptySnapshot()
    s = appendEntry(s, ins('a'), 5)
    s = appendEntry(s, ins('b'), 5)
    s = appendEntry(s, ins('c'), 5)
    expect(s.entries.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(s.nextSeq).toBe(4)
  })

  it('新條目的初始欄位齊全（AC 9）', () => {
    const s = appendEntry(emptySnapshot(), ins('a', { w: 60 }, 'u9'), 1234)
    expect(s.entries[0]).toEqual({
      seq: 1, op: 'insert', table: 't', rowId: 'a', payload: { w: 60 },
      userId: 'u9', createdAt: 1234, attempts: 0, lastError: null, failure: null,
    })
  })

  it('insert／update 沒有 payload 要丟錯，不默默存一條送不出去的', () => {
    expect(() => appendEntry(emptySnapshot(), { op: 'insert', table: 't', rowId: 'a', userId: 'u1' }, 0)).toThrow()
    expect(() => appendEntry(emptySnapshot(), { op: 'update', table: 't', rowId: 'a', userId: 'u1' }, 0)).toThrow()
  })

  it('delete 的 payload 一律 null，即使呼叫端塞了東西', () => {
    const s = appendEntry(emptySnapshot(), { ...del('a'), payload: { x: 1 } }, 0)
    expect(s.entries[0].payload).toBeNull()
  })

  it('不改動傳入的 snapshot，也不與呼叫端共用 payload 物件', () => {
    const before = appendEntry(emptySnapshot(), ins('a'), 1)
    const frozen = JSON.stringify(before)
    const payload = { v: 7 }
    const after = appendEntry(before, ins('b', payload), 2)
    payload.v = 99
    expect(JSON.stringify(before)).toBe(frozen)
    expect(after.entries[1].payload).toEqual({ v: 7 })
  })

  describe('delete 的 tombstone（AC 14）', () => {
    const withEntry = (e: Partial<QueueEntry>): QueueSnapshot => {
      const base = appendEntry(emptySnapshot(), ins('a'), 1)
      return { ...base, entries: [{ ...base.entries[0], ...e }] }
    }

    it('清掉同一列較舊的 insert、update 與 delete，只留新的 delete', () => {
      let s = appendEntry(emptySnapshot(), del('a'), 1)
      s = appendEntry(s, ins('a'), 2)
      s = appendEntry(s, upd('a', { v: 2 }), 3)
      s = appendEntry(s, del('a'), 4)
      expect(s.entries.map((e) => [e.seq, e.op])).toEqual([[4, 'delete']])
    })

    it('不碰其他列、其他表、其他帳號', () => {
      let s = appendEntry(emptySnapshot(), ins('b'), 1)
      s = appendEntry(s, { ...ins('a'), table: 'other' }, 2)
      s = appendEntry(s, ins('a', { v: 1 }, 'u2'), 3)
      s = appendEntry(s, del('a'), 4)
      expect(s.entries.map((e) => `${e.table}/${e.rowId}/${e.userId}/${e.op}`)).toEqual([
        't/b/u1/insert', 'other/a/u1/insert', 't/a/u2/insert', 't/a/u1/delete',
      ])
    })

    it.each([
      ['被拒絕', { attempts: 1, failure: 'rejected' }],
      ['登入失效', { attempts: 2, failure: 'auth' }],
    ] as const)('伺服器明確沒收（%s）的舊 insert 清掉；delete 照留（保守，對不存在的列無害）', (_label, state) => {
      const s = appendEntry(withEntry(state), del('a'), 2)
      expect(s.entries.map((e) => e.op)).toEqual(['delete'])
    })

    it.each([
      ['正在送出', { attempts: 1, failure: null }],
      ['逾時或連不上', { attempts: 1, failure: 'offline' }],
      ['502／5xx', { attempts: 2, failure: 'transient' }],
    ] as const)(
      '結果曖昧的舊 insert（%s）不清：delete 不能搶在它可能的晚到落地之前，留著依 seq 先重送',
      (_label, state) => {
        const s = appendEntry(withEntry(state), del('a'), 2)
        expect(s.entries.map((e) => e.op)).toEqual(['insert', 'delete'])
      },
    )

    it('從未離開本機的 insert 被 delete 抵銷：兩者都不留，佇列是空的', () => {
      const s = appendEntry(withEntry({ attempts: 0, failure: null }), del('a'), 2)
      expect(s.entries).toEqual([])
      expect(s.nextSeq).toBe(3) // seq 照樣前進，不重用
    })

    it('從未送過的 update 被 delete 清掉但 delete 要留：那一列可能早已在伺服器上', () => {
      let s = appendEntry(emptySnapshot(), upd('a', { v: 2 }), 1)
      s = appendEntry(s, del('a'), 2)
      expect(s.entries.map((e) => e.op)).toEqual(['delete'])
    })

    it('同一列還有結果曖昧的舊條目時，delete 不能因為另一條未送的 insert 被抵銷就一起消失', () => {
      // 第一條已送出且逾時（列可能已落地），第二條是之後又存的、從未送過
      let s = appendEntry(emptySnapshot(), ins('a', { v: 1 }), 1)
      s = { ...s, entries: [{ ...s.entries[0], attempts: 1, failure: 'offline' }] }
      s = appendEntry(s, ins('a', { v: 2 }), 2)
      s = appendEntry(s, del('a'), 3)
      expect(s.entries.map((e) => [e.seq, e.op])).toEqual([[1, 'insert'], [3, 'delete']])
    })

    it('delete 之後才排進來的 insert 是重建，要留著', () => {
      let s = appendEntry(emptySnapshot(), del('a'), 1)
      s = appendEntry(s, ins('a', { v: 2 }), 2)
      expect(s.entries.map((e) => e.op)).toEqual(['delete', 'insert'])
    })
  })
})

describe('summarize／signOutPlan', () => {
  it('分開數自己的、別人的，以及各分類的卡住數（AC 11、13）', () => {
    const e = (rowId: string, patch: Partial<QueueEntry>): QueueEntry => ({
      ...appendEntry(emptySnapshot(), ins(rowId), 1).entries[0],
      ...patch,
    })
    const sum = summarize(
      {
        nextSeq: 5,
        entries: [
          e('a', { seq: 1 }),
          e('b', { seq: 2, failure: 'offline' }),
          e('c', { seq: 3, failure: 'rejected' }),
          e('d', { seq: 4, userId: 'u2' }),
        ],
      },
      'u1',
    )
    expect(sum).toEqual({
      total: 4, mine: 3, foreign: 1, pending: 1,
      failed: { offline: 1, auth: 0, rejected: 1, transient: 0 },
    })
  })

  it('空佇列不需要確認；非空要確認並報出會遺失的條數（Q1）', () => {
    const empty = summarize(emptySnapshot(), 'u1')
    expect(signOutPlan(empty)).toEqual({ needsConfirm: false, lost: 0 })
    const one = summarize(appendEntry(emptySnapshot(), ins('a'), 1), 'u1')
    expect(signOutPlan(one)).toEqual({ needsConfirm: true, lost: 1 })
    // 只有別人的殘留也算：登出會一併清掉
    const foreign = summarize(appendEntry(emptySnapshot(), ins('a', { v: 1 }, 'u2'), 1), 'u1')
    expect(signOutPlan(foreign)).toEqual({ needsConfirm: true, lost: 1 })
  })
})

/* ═══════════ 帶狀態的佇列 ═══════════ */

describe('持久化', () => {
  it('enqueue 寫進儲存；用同一份儲存重新建立佇列，條目還在（重開 App）', async () => {
    const a = build()
    await a.queue.enqueue(ins('a'))
    await a.queue.enqueue(upd('a', { v: 2 }))
    const b = build(a.mem.saved)
    expect((await b.queue.summary('u1')).mine).toBe(2)
    await b.queue.flush('u1')
    expect(b.sender.sent.map((e) => e.op)).toEqual(['insert', 'update'])
  })

  it('save 失敗：enqueue 丟錯，記憶體狀態不前進（不會出現磁碟上沒有的條目）', async () => {
    const t = build()
    await t.queue.enqueue(ins('a'))
    t.mem.onSave = () => {
      throw new Error('QuotaExceeded')
    }
    await expect(t.queue.enqueue(ins('b'))).rejects.toThrow('QuotaExceeded')
    t.mem.onSave = null
    expect((await t.queue.summary('u1')).mine).toBe(1)
    expect(t.mem.saved?.entries).toHaveLength(1)
    // 失敗之後佇列仍可用
    await t.queue.enqueue(ins('c'))
    expect((await t.queue.summary('u1')).mine).toBe(2)
  })

  it('成功送出後存檔失敗：條目仍在，下次重送，伺服器結果不變（冪等兜底）', async () => {
    const t = build()
    await t.queue.enqueue(ins('a', { v: 1 }))
    t.mem.onSave = (s) => {
      if (s.entries.length === 0) throw new Error('disk')
    }
    await expect(t.queue.flush('u1')).rejects.toThrow('disk')
    t.mem.onSave = null
    expect(t.server.rows.get('t/a')).toEqual({ v: 1 })
    const r = await t.queue.flush('u1')
    expect(r.sent).toBe(1)
    expect(t.sender.sent).toHaveLength(2)
    expect(t.server.rows.size).toBe(1)
    expect(t.server.rows.get('t/a')).toEqual({ v: 1 })
  })
})

describe('重放順序（AC 14）', () => {
  it('依 seq 重放，不依 createdAt：時鐘倒退，重開 App 載入後也不亂序', async () => {
    const server = fakeServer()
    const mem = memoryStore()
    const { send, sent } = scriptedSender(server, () => 'ok')
    const times = [900, 500, 100] // 使用者把時鐘往回調
    const first = createQueue({ store: mem.store, send, now: () => times.shift() ?? 0 })
    await first.enqueue(ins('a', { v: 1 }))
    await first.enqueue(upd('a', { v: 2 }))
    await first.enqueue(upd('a', { v: 3 }))
    // 重開：載入時 createdAt 的順序（100、500、900）與 seq 相反
    const reopened = createQueue({ store: mem.store, send })
    await reopened.flush('u1')
    expect(sent.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(server.rows.get('t/a')).toEqual({ v: 3 })
  })

  it('載入的 nextSeq 落後於已有的 seq：修正後再發號，不撞號', async () => {
    let s = appendEntry(emptySnapshot(), ins('a'), 1)
    s = { nextSeq: 1, entries: [{ ...s.entries[0], seq: 7 }] } // 儲存層的 nextSeq 壞了
    const t = build(s)
    const e = await t.queue.enqueue(ins('b'))
    expect(e?.seq).toBe(8)
    expect(t.mem.saved?.entries.map((x) => x.seq)).toEqual([7, 8])
  })

  it('儲存層回傳的順序不可信：載入時重新依 seq 排好', async () => {
    let s = appendEntry(emptySnapshot(), ins('a', { v: 1 }), 1)
    s = appendEntry(s, upd('a', { v: 2 }), 2)
    s = appendEntry(s, upd('a', { v: 3 }), 3)
    const shuffled: QueueSnapshot = { ...s, entries: [s.entries[2], s.entries[0], s.entries[1]] }
    const t = build(shuffled)
    await t.queue.flush('u1')
    expect(t.sender.sent.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(t.server.rows.get('t/a')).toEqual({ v: 3 })
  })

  it('insert 落地但回應遺失後被刪：先重送 insert、再 delete 把列刪掉，不留孤兒', async () => {
    let insertCalls = 0
    const t = build(null, (e) => (e.op === 'insert' && ++insertCalls === 1 ? 'lost503' : 'ok'))
    await t.queue.enqueue(ins('a'))
    await t.queue.flush('u1') // 列已在伺服器上，但佇列以為沒成功
    expect(t.server.rows.has('t/a')).toBe(true)
    await t.queue.enqueue(del('a'))
    await t.queue.flush('u1')
    expect(t.server.rows.has('t/a')).toBe(false)
    expect((await t.queue.summary('u1')).total).toBe(0)
  })

  it('離線新增又刪掉：佇列是空的，什麼都不送，也不會留下永遠卡住的 delete', async () => {
    const t = build()
    const first = await t.queue.enqueue(ins('a'))
    expect(first).not.toBeNull()
    const second = await t.queue.enqueue(del('a'))
    expect(second).toBeNull() // 被抵銷，沒有條目
    expect((await t.queue.summary('u1')).total).toBe(0)
    expect(signOutPlan(await t.queue.summary('u1')).needsConfirm).toBe(false)
    const r = await t.queue.flush('u1')
    expect(t.sender.sent).toHaveLength(0)
    expect(r.sent).toBe(0)
  })

  it('逾時（結果曖昧）的 insert 之後被刪：先重送 insert、再送 delete，列最後不在（晚到的落地被蓋過）', async () => {
    let insertCalls = 0
    const t = build(null, (e) => (e.op === 'insert' && ++insertCalls === 1 ? 'lost' : 'ok'))
    await t.queue.enqueue(ins('a'))
    const r1 = await t.queue.flush('u1') // 落地但回應遺失，記成 offline
    expect(r1.summary.failed.offline).toBe(1)
    await t.queue.enqueue(del('a')) // 結果曖昧的 insert 不被清
    expect(t.mem.saved?.entries.map((e) => e.op)).toEqual(['insert', 'delete'])
    await t.queue.flush('u1')
    expect(t.sender.sent.map((e) => e.op)).toEqual(['insert', 'insert', 'delete'])
    expect(t.server.rows.has('t/a')).toBe(false)
  })

  it('delete 失敗時，後面的重建 insert 不得越過它（否則重建的列隨後被舊 delete 刪掉）', async () => {
    let deleteCalls = 0
    const t = build(null, (e) => (e.op === 'delete' && ++deleteCalls === 1 ? 503 : 'ok'))
    t.server.rows.set('t/a', { v: 0 })
    await t.queue.enqueue(del('a'))
    await t.queue.enqueue(ins('a', { v: 2 })) // 使用者刪掉後又重新記了一筆同一列
    const r1 = await t.queue.flush('u1')
    expect(t.sender.sent.map((e) => e.op)).toEqual(['delete']) // insert 沒被送
    expect(r1.summary.failed.transient).toBe(1)
    await t.queue.flush('u1')
    expect(t.sender.sent.map((e) => e.op)).toEqual(['delete', 'delete', 'insert'])
    expect(t.server.rows.get('t/a')).toEqual({ v: 2 }) // 最後一次意圖（重建）得以保留
  })

  it('同一輪內 insert 失敗，後面同一列的 update 不得越過它（否則打到不存在的列、編輯靜默遺失）', async () => {
    let first = true
    const t = build(null, (e) => {
      if (e.op === 'insert' && first) {
        first = false
        return 503
      }
      return 'ok'
    })
    await t.queue.enqueue(ins('a', { v: 1 }))
    await t.queue.enqueue(upd('a', { v: 2 }))
    const r1 = await t.queue.flush('u1')
    expect(t.sender.sent.map((e) => e.op)).toEqual(['insert']) // update 沒被送
    expect(r1.summary.failed.transient).toBe(1)
    await t.queue.flush('u1')
    expect(t.server.rows.get('t/a')).toEqual({ v: 2 })
  })

  it('失敗只擋同一列，不擋別的列', async () => {
    const t = build(null, (e) => (e.rowId === 'a' ? 422 : 'ok'))
    await t.queue.enqueue(ins('a'))
    await t.queue.enqueue(upd('a', { v: 2 }))
    await t.queue.enqueue(ins('b'))
    const r = await t.queue.flush('u1')
    expect(t.server.rows.has('t/b')).toBe(true)
    expect(t.sender.sent.map((e) => e.rowId)).toEqual(['a', 'b'])
    expect(r.stoppedBy).toBeNull()
    expect(r.sent).toBe(1)
  })

  it('delete 之後的重建 insert 會被送出，列最後存在', async () => {
    const t = build()
    await t.queue.enqueue(ins('a', { v: 1 }))
    await t.queue.flush('u1')
    await t.queue.enqueue(del('a'))
    await t.queue.enqueue(ins('a', { v: 2 }))
    await t.queue.flush('u1')
    expect(t.server.rows.get('t/a')).toEqual({ v: 2 })
  })
})

describe('重送冪等（AC 10）', () => {
  it.each([
    ['insert', ins('a', { v: 1 })],
    ['update', upd('a', { v: 2 })],
    ['delete', del('a')],
  ] as const)('%s：回應遺失後重送，伺服器結果與只送一次相同', async (_label, op) => {
    const once = build()
    const twice = build(null, (_e, n) => (n === 1 ? 'lost' : 'ok'))
    for (const t of [once, twice]) {
      // 先讓列存在，update／delete 才有東西可作用
      t.server.rows.set('t/a', { v: 0 })
      await t.queue.enqueue(op)
    }
    await once.queue.flush('u1')
    const r1 = await twice.queue.flush('u1')
    expect(r1.stoppedBy).toBe('offline')
    await twice.queue.flush('u1')
    expect(twice.sender.sent).toHaveLength(2)
    expect([...twice.server.rows]).toEqual([...once.server.rows])
  })

  it('重送時條目的 rowId 不變（不重發主鍵）', async () => {
    const t = build(null, (_e, n) => (n === 1 ? 503 : 'ok'))
    await t.queue.enqueue(ins('a'))
    await t.queue.flush('u1')
    await t.queue.flush('u1')
    expect(t.sender.sent.map((e) => e.rowId)).toEqual(['a', 'a'])
  })
})

describe('父列依賴（AC 16）', () => {
  const row = (table: string, rowId: string, ...parents: [string, string][]): NewEntry => ({
    op: 'insert', table, rowId, payload: { v: 1 }, userId: 'u1',
    ...(parents.length ? { parents: parents.map(([t, r]) => ({ table: t, rowId: r })) } : {}),
  })
  const W = (id: string) => row('workouts', id)
  const WE = (id: string, parent: string) => row('workout_exercises', id, ['workouts', parent])
  const WS = (id: string, parent: string) => row('workout_sets', id, ['workout_exercises', parent])

  const fkOk = (server: ReturnType<typeof fakeServer>, e: QueueEntry): boolean =>
    (e.parents ?? []).every((p) => server.rows.has(`${p.table}/${p.rowId}`))

  /** 外鍵很嚴的伺服器：父列不在就 409。failing 內的列直接回指定狀態碼（沒落地）。 */
  const strict = (failing = new Map<string, number>()) => {
    const t: ReturnType<typeof build> = build(null, (e) => {
      const forced = failing.get(`${e.table}/${e.rowId}`)
      if (forced !== undefined) return forced
      if (e.op === 'insert' && !fkOk(t.server, e)) return 409
      return 'ok'
    })
    return t
  }

  describe('純函式', () => {
    it('parents 記進條目、與呼叫端不共用；沒有就不出現這個欄位', () => {
      const given = [{ table: 'workouts', rowId: 'w1' }]
      const s = appendEntry(emptySnapshot(), { ...WE('we1', 'w1'), parents: given }, 1)
      given[0].rowId = 'changed'
      expect(s.entries[0].parents).toEqual([{ table: 'workouts', rowId: 'w1' }])
      expect('parents' in appendEntry(emptySnapshot(), W('w1'), 1).entries[0]).toBe(false)
    })

    it('delete 不帶 parents：刪除靠伺服器 cascade，帶了反而會被自己的父列擋住', () => {
      const s = appendEntry(
        emptySnapshot(),
        { op: 'delete', table: 'workout_exercises', rowId: 'we1', userId: 'u1', parents: [{ table: 'workouts', rowId: 'w1' }] },
        1,
      )
      expect('parents' in s.entries[0]).toBe(false)
    })

    it('離線新增整棵樹再刪根：子孫連同它們之後的 update 一起抵銷，佇列是空的', () => {
      let s = appendEntry(emptySnapshot(), W('w1'), 1)
      s = appendEntry(s, WE('we1', 'w1'), 2)
      s = appendEntry(s, WS('s1', 'we1'), 3)
      s = appendEntry(s, { op: 'update', table: 'workout_sets', rowId: 's1', payload: { reps: 5 }, userId: 'u1' }, 4)
      s = appendEntry(s, { op: 'delete', table: 'workouts', rowId: 'w1', userId: 'u1' }, 5)
      expect(s.entries).toEqual([])
      expect(s.nextSeq).toBe(6)
    })

    it('只清自己那一棵：別的訓練、別的帳號的同名列不受影響', () => {
      let s = appendEntry(emptySnapshot(), W('w1'), 1)
      s = appendEntry(s, WE('we1', 'w1'), 2)
      s = appendEntry(s, W('w2'), 3)
      s = appendEntry(s, WE('we2', 'w2'), 4)
      s = appendEntry(s, { ...WE('we1', 'w1'), userId: 'u2', parents: [{ table: 'workouts', rowId: 'w1' }] }, 5)
      s = appendEntry(s, { op: 'delete', table: 'workouts', rowId: 'w1', userId: 'u1' }, 6)
      expect(s.entries.map((e) => `${e.rowId}/${e.userId}`)).toEqual(['w2/u1', 'we2/u1', 'we1/u2'])
    })
  })

  describe('flush', () => {
    it('父列這一輪送不出去：子列不送、也不被標成被拒絕，下一輪依序補上', async () => {
      const failing = new Map([['workouts/w1', 503]])
      const t = strict(failing)
      await t.queue.enqueue(W('w1'))
      await t.queue.enqueue(WE('we1', 'w1'))
      const r1 = await t.queue.flush('u1')
      expect(t.sender.sent.map((e) => e.rowId)).toEqual(['w1']) // 子列根本沒被送
      expect(r1.summary.failed).toEqual({ offline: 0, auth: 0, rejected: 0, transient: 1 })
      expect(r1.summary.pending).toBe(1) // 子列仍是「從未失敗」
      failing.clear()
      const r2 = await t.queue.flush('u1')
      expect([...t.server.rows.keys()].sort()).toEqual(['workout_exercises/we1', 'workouts/w1'])
      expect(r2.summary.mine).toBe(0)
    })

    it('一路傳下去：祖父列失敗，孫列（組）也不送', async () => {
      const failing = new Map([['workouts/w1', 503]])
      const t = strict(failing)
      await t.queue.enqueue(W('w1'))
      await t.queue.enqueue(WE('we1', 'w1'))
      await t.queue.enqueue(WS('s1', 'we1'))
      const r1 = await t.queue.flush('u1')
      expect(t.sender.sent.map((e) => e.rowId)).toEqual(['w1'])
      expect(r1.summary.pending).toBe(2)
      expect(r1.summary.failed.rejected).toBe(0)
      failing.clear()
      await t.queue.flush('u1')
      expect([...t.server.rows.keys()].sort()).toEqual(['workout_exercises/we1', 'workout_sets/s1', 'workouts/w1'])
    })

    it('父列被伺服器明確拒絕（4xx）一樣擋住子列，子列不跟著被標拒絕', async () => {
      const t = strict(new Map([['workouts/w1', 422]]))
      await t.queue.enqueue(W('w1'))
      await t.queue.enqueue(WE('we1', 'w1'))
      const r = await t.queue.flush('u1')
      expect(r.summary.failed).toEqual({ offline: 0, auth: 0, rejected: 1, transient: 0 })
      expect(r.summary.pending).toBe(1)
    })

    it('只擋有依賴的那一棵，別棵照送', async () => {
      const t = strict(new Map([['workouts/w1', 503]]))
      await t.queue.enqueue(W('w1'))
      await t.queue.enqueue(WE('we1', 'w1'))
      await t.queue.enqueue(W('w2'))
      await t.queue.enqueue(WE('we2', 'w2'))
      await t.queue.flush('u1')
      expect(t.sender.sent.map((e) => e.rowId)).toEqual(['w1', 'w2', 'we2'])
      expect([...t.server.rows.keys()].sort()).toEqual(['workout_exercises/we2', 'workouts/w2'])
    })

    it('父列早已在伺服器（不在佇列裡）：子列直接送', async () => {
      const t = strict()
      t.server.rows.set('workouts/w1', { v: 0 })
      await t.queue.enqueue(WE('we1', 'w1'))
      const r = await t.queue.flush('u1')
      expect(t.server.rows.has('workout_exercises/we1')).toBe(true)
      expect(r.sent).toBe(1)
    })

    it('全部順利時一輪就送完整棵樹，且父在子前', async () => {
      const t = strict()
      await t.queue.enqueue(W('w1'))
      await t.queue.enqueue(WE('we1', 'w1'))
      await t.queue.enqueue(WS('s1', 'we1'))
      const r = await t.queue.flush('u1')
      expect(t.sender.sent.map((e) => e.seq)).toEqual([1, 2, 3])
      expect(r.sent).toBe(3)
      expect(r.summary.total).toBe(0)
    })

    it('結果曖昧的父 insert 之後整棵被刪：不抵銷，父→子→delete 照序送，列最後不在', async () => {
      const t = build(null, (e, n) => (e.rowId === 'w1' && e.op === 'insert' && n === 1 ? 'lost' : 'ok'))
      await t.queue.enqueue(W('w1'))
      await t.queue.flush('u1') // 落地但回應遺失
      await t.queue.enqueue(WE('we1', 'w1'))
      await t.queue.enqueue({ op: 'delete', table: 'workouts', rowId: 'w1', userId: 'u1' })
      await t.queue.flush('u1')
      expect(t.sender.sent.map((e) => `${e.op}/${e.rowId}`)).toEqual([
        'insert/w1', 'insert/w1', 'insert/we1', 'delete/w1',
      ])
      expect(t.server.rows.has('workouts/w1')).toBe(false)
      expect((await t.queue.summary('u1')).total).toBe(0)
    })

    it('重開 App 後 parents 仍在，依賴照守', async () => {
      const failing = new Map([['workouts/w1', 503]])
      const t = strict(failing)
      await t.queue.enqueue(W('w1'))
      await t.queue.enqueue(WE('we1', 'w1'))
      await t.queue.flush('u1')
      const stored = JSON.parse(JSON.stringify(t.mem.saved)) as QueueSnapshot // 真的經過序列化
      const server = fakeServer()
      const { send, sent } = scriptedSender(server, (e) => (e.op === 'insert' && !fkOk(server, e) ? 409 : 'ok'))
      const reopened = createQueue({ store: memoryStore(stored).store, send })
      await reopened.flush('u1')
      expect(sent.map((e) => e.rowId)).toEqual(['w1', 'we1'])
      expect([...server.rows.keys()]).toEqual(['workouts/w1', 'workout_exercises/we1'])
    })
  })

  describe('discard', () => {
    it('放棄一條被拒絕的父 insert：掛在它底下的子孫連帶放棄', async () => {
      const t = strict(new Map([['workouts/w1', 422]]))
      await t.queue.enqueue(W('w1'))
      await t.queue.enqueue(WE('we1', 'w1'))
      await t.queue.enqueue(WS('s1', 'we1'))
      await t.queue.enqueue(W('w2'))
      await t.queue.flush('u1')
      expect(await t.queue.discard(1)).toBe(true)
      expect(t.mem.saved?.entries.map((e) => e.rowId)).toEqual([]) // w2 已送成而移除，w1 這棵全清
      expect((await t.queue.summary('u1')).total).toBe(0)
    })

    it('放棄 update 不連帶子孫：那一列來自伺服器，子列仍然合法', async () => {
      // we1 自己暫時失敗（503）才會留在佇列——父列 update 失敗不再擋它（見下方「父列的 update 失敗」）
      const t = strict(new Map([['workouts/w1', 422], ['workout_exercises/we1', 503]]))
      t.server.rows.set('workouts/w1', { v: 0 })
      await t.queue.enqueue({ op: 'update', table: 'workouts', rowId: 'w1', payload: { v: 2 }, userId: 'u1' })
      await t.queue.enqueue(WE('we1', 'w1'))
      await t.queue.flush('u1')
      expect(await t.queue.discard(1)).toBe(true)
      expect(t.mem.saved?.entries.map((e) => e.rowId)).toEqual(['we1'])
    })
  })

  describe('外鍵種類（review #1）', () => {
    const ref = (table: string, rowId: string, column: string, onDelete: 'cascade' | 'restrict' | 'setNull') => ({
      table, rowId, column, onDelete,
    })
    const R = (id: string): NewEntry => ({ op: 'insert', table: 'routines', rowId: id, payload: { name: 'A' }, userId: 'u1' })
    const WR = (id: string, routine: string): NewEntry => ({
      op: 'insert', table: 'workouts', rowId: id, payload: { routine_id: routine }, userId: 'u1',
      parents: [ref('routines', routine, 'routine_id', 'setNull')],
    })
    const EX = (id: string): NewEntry => ({ op: 'insert', table: 'exercises', rowId: id, payload: { name: 'x' }, userId: 'u1' })
    const WEX = (id: string, w: string, ex: string): NewEntry => ({
      op: 'insert', table: 'workout_exercises', rowId: id, payload: { workout_id: w, exercise_id: ex }, userId: 'u1',
      parents: [ref('workouts', w, 'workout_id', 'cascade'), ref('exercises', ex, 'exercise_id', 'restrict')],
    })
    const SET = (id: string, we: string): NewEntry => ({
      op: 'insert', table: 'workout_sets', rowId: id, payload: { workout_exercise_id: we }, userId: 'u1',
      parents: [ref('workout_exercises', we, 'workout_exercise_id', 'cascade')],
    })

    it('setNull：課表被拒絕時訓練先等著（不送、不標拒絕）；放棄課表後訓練留下、課表欄位改 null，下一輪送出', async () => {
      const t = strict(new Map([['routines/r1', 422]]))
      await t.queue.enqueue(R('r1'))
      await t.queue.enqueue(WR('w1', 'r1'))
      await t.queue.flush('u1')
      const waiting = (await t.queue.entries()).find((e) => e.rowId === 'w1')
      expect(waiting?.attempts, '父列沒到：不送').toBe(0)
      expect(waiting?.failure, '也不標成被拒絕').toBeNull()

      expect(await t.queue.discardImpact(1), '放棄課表不會帶走訓練').toBe(0)
      await t.queue.discard(1)
      const kept = (await t.queue.entries()).find((e) => e.rowId === 'w1')
      expect(kept?.payload).toEqual({ routine_id: null })
      expect(kept?.parents, '依賴拿掉了，不會再等一個不會來的父列').toBeUndefined()

      await t.queue.flush('u1')
      expect(t.server.rows.get('workouts/w1')).toEqual({ routine_id: null })
      expect(await t.queue.entries()).toEqual([])
    })

    it('restrict：放棄被拒絕的動作，用到它的訓練動作與組一起放棄；discardImpact 先講會帶走幾條；訓練本身留下', async () => {
      const t = strict(new Map([['exercises/x1', 422]]))
      await t.queue.enqueue(W('w1'))
      await t.queue.enqueue(EX('x1'))
      await t.queue.enqueue(WEX('we1', 'w1', 'x1'))
      await t.queue.enqueue(SET('s1', 'we1'))
      await t.queue.enqueue(SET('s2', 'we1'))
      await t.queue.flush('u1')
      expect(t.server.rows.has('workouts/w1')).toBe(true)
      const seq = (await t.queue.entries()).find((e) => e.rowId === 'x1')!.seq
      expect(await t.queue.discardImpact(seq)).toBe(3)
      await t.queue.discard(seq)
      expect(await t.queue.entries()).toEqual([])
      expect(t.server.rows.has('workouts/w1'), '訓練不受影響').toBe(true)
    })

    it('離線新增課表又刪掉：用它的訓練留下、課表欄位改 null（照伺服器的 on delete set null）', () => {
      let s = appendEntry(emptySnapshot(), R('r1'), 1)
      s = appendEntry(s, WR('w1', 'r1'), 2)
      s = appendEntry(s, { op: 'delete', table: 'routines', rowId: 'r1', userId: 'u1' }, 3)
      expect(s.entries.map((e) => e.rowId)).toEqual(['w1'])
      expect(s.entries[0].payload).toEqual({ routine_id: null })
      expect('parents' in s.entries[0]).toBe(false)
    })

    it('父列「可能已落地」（先 504 再 422）也放棄時：子孫不丟，但 setNull 連結照樣解開，訓練不會永遠撞外鍵', async () => {
      const t = build(null, (e, n) => (e.rowId === 'r1' ? (n === 1 ? 504 : 422) : 'ok'))
      await t.queue.enqueue(R('r1'))
      await t.queue.enqueue(WR('w1', 'r1'))
      await t.queue.flush('u1') // r1：504（可能已落地）
      await t.queue.flush('u1') // r1：422
      const r1 = (await t.queue.entries()).find((e) => e.rowId === 'r1')!
      expect(r1.maybeApplied).toBe(true)
      expect(await t.queue.discardImpact(r1.seq)).toBe(0)
      await t.queue.discard(r1.seq)
      const w1 = (await t.queue.entries()).find((e) => e.rowId === 'w1')
      expect(w1?.payload).toEqual({ routine_id: null })
      expect(w1?.parents).toBeUndefined()
    })

    it('沒標明 onDelete 的參照當 cascade（最保守）', () => {
      let s = appendEntry(emptySnapshot(), W('w1'), 1)
      s = appendEntry(s, WE('we1', 'w1'), 2)
      s = appendEntry(s, { op: 'delete', table: 'workouts', rowId: 'w1', userId: 'u1' }, 3)
      expect(s.entries).toEqual([])
    })
  })

  describe('父列的 update 失敗（review #6）', () => {
    it('列是存在的：子列的 insert 照送，不被擋成看不出原因的待上傳', async () => {
      const t = strict(new Map([['workouts/w1', 422]]))
      t.server.rows.set('workouts/w1', { v: 0 })
      await t.queue.enqueue({ op: 'update', table: 'workouts', rowId: 'w1', payload: { v: 2 }, userId: 'u1' })
      await t.queue.enqueue(WE('we1', 'w1'))
      await t.queue.enqueue(WS('s1', 'we1'))
      await t.queue.flush('u1')
      expect(t.server.rows.has('workout_exercises/we1')).toBe(true)
      expect(t.server.rows.has('workout_sets/s1')).toBe(true)
      expect((await t.queue.entries()).map((e) => e.rowId)).toEqual(['w1'])
    })

    it('父列的 insert 失敗仍然擋住子孫（父列依賴照舊）', async () => {
      const t = strict(new Map([['workouts/w1', 503]]))
      await t.queue.enqueue(W('w1'))
      await t.queue.enqueue(WE('we1', 'w1'))
      await t.queue.enqueue(WS('s1', 'we1'))
      await t.queue.flush('u1')
      const es = await t.queue.entries()
      expect(es.map((e) => [e.rowId, e.attempts])).toEqual([['w1', 1], ['we1', 0], ['s1', 0]])
    })
  })
})

describe('可能已落地是黏著的（review #7）', () => {
  it('第一次 503（可能已落地）、第二次 401：放棄它不會連帶子孫——那一列可能真的在伺服器上', async () => {
    const t = build(null, (e, n) => (e.rowId === 'w1' ? (n === 1 ? 'lost503' : 401) : 'ok'))
    await t.queue.enqueue({ op: 'insert', table: 'workouts', rowId: 'w1', payload: { v: 1 }, userId: 'u1' })
    await t.queue.enqueue({
      op: 'insert', table: 'workout_exercises', rowId: 'we1', payload: { v: 1 }, userId: 'u1',
      parents: [{ table: 'workouts', rowId: 'w1' }],
    })
    await t.queue.flush('u1') // w1：503
    await t.queue.flush('u1') // w1：401，整輪停
    const w1 = (await t.queue.entries()).find((e) => e.rowId === 'w1')!
    expect(w1.failure).toBe('auth')
    expect(w1.maybeApplied).toBe(true)
    await t.queue.discard(w1.seq)
    expect((await t.queue.entries()).map((e) => e.rowId)).toEqual(['we1'])
  })

  it('送到一半被殺掉（attempts>0、failure 為 null）後重送：也記成可能已落地', async () => {
    const t = build(
      {
        nextSeq: 2,
        entries: [{
          seq: 1, op: 'insert', table: 'a', rowId: 'a', payload: { v: 1 }, userId: 'u1',
          createdAt: 0, attempts: 1, lastError: null, failure: null,
        }],
      },
      () => 422,
    )
    await t.queue.flush('u1')
    expect((await t.queue.entries())[0].maybeApplied).toBe(true)
  })

  it('從頭到尾都是明確失敗：不標可能已落地', async () => {
    const t = build(null, () => 422)
    await t.queue.enqueue({ op: 'insert', table: 'a', rowId: 'a', payload: { v: 1 }, userId: 'u1' })
    await t.queue.flush('u1')
    expect('maybeApplied' in (await t.queue.entries())[0]).toBe(false)
  })
})

describe('read', () => {
  it('一次拿到同一份快照的 entries 與 summary', async () => {
    const t = build()
    await t.queue.enqueue({ op: 'insert', table: 'a', rowId: 'a', payload: { v: 1 }, userId: 'u1' })
    await t.queue.enqueue({ op: 'insert', table: 'a', rowId: 'b', payload: { v: 1 }, userId: 'u2' })
    const r = await t.queue.read('u1')
    expect(r.entries).toEqual(await t.queue.entries())
    expect(r.summary).toEqual(await t.queue.summary('u1'))
  })
})

describe('enqueueMany（review #5）', () => {
  const one = (id: string): NewEntry => ({ op: 'insert', table: 'a', rowId: id, payload: { v: 1 }, userId: 'u1' })

  it('只寫一次儲存；寫入失敗時一條都沒排進去', async () => {
    const t = build()
    let saves = 0
    // 容量只夠一條：逐條寫的話第一條會先存進去、第二條才失敗——正是「UI 說沒存下來、卻有半份會上傳」
    t.mem.onSave = (snap) => {
      saves++
      if (snap.entries.length >= 2) throw new Error('quota')
    }
    await expect(t.queue.enqueueMany([one('a'), one('b'), one('c')])).rejects.toThrow('quota')
    expect(saves).toBe(1)
    expect(await t.queue.entries()).toEqual([])
    t.mem.onSave = null
    await t.queue.enqueueMany([one('a'), one('b')])
    expect((await t.queue.entries()).map((e) => [e.seq, e.rowId])).toEqual([[1, 'a'], [2, 'b']])
  })
})

describe('跨分頁（review #3）', () => {
  const one = (id: string): NewEntry => ({ op: 'insert', table: 'a', rowId: id, payload: { v: 1 }, userId: 'u1' })

  /** 兩個分頁＝兩個實例、共用同一份儲存；鎖以名稱互斥，模擬 Web Locks。 */
  function twoTabs() {
    const mem = memoryStore()
    const chains = new Map<string, Promise<unknown>>()
    const crossLock = <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
      const p = (chains.get(name) ?? Promise.resolve()).then(fn)
      chains.set(name, p.catch(() => undefined))
      return p
    }
    const server = fakeServer()
    const sender = scriptedSender(server, () => 'ok')
    const tab = () => createQueue({ store: mem.store, send: sender.send, crossLock })
    return { mem, server, sender, a: tab(), b: tab() }
  }

  it('兩個分頁各排一條：兩條都在，seq 不撞號', async () => {
    const t = twoTabs()
    await t.a.entries() // 兩邊都先讀過一次（記憶體裡各有一份空的）
    await t.b.entries()
    await t.a.enqueue(one('x'))
    await t.b.enqueue(one('y'))
    expect(t.mem.saved?.entries.map((e) => [e.seq, e.rowId])).toEqual([[1, 'x'], [2, 'y']])
  })

  it('兩個分頁同時 flush：每條只送一次', async () => {
    const t = twoTabs()
    await t.a.enqueue(one('x'))
    await t.a.enqueue(one('y'))
    await Promise.all([t.a.flush('u1'), t.b.flush('u1')])
    expect(t.sender.sent.map((e) => e.rowId)).toEqual(['x', 'y'])
    expect(t.mem.saved?.entries).toEqual([])
  })
})

describe('entries（唯讀快照）', () => {
  it('依 seq 排好、含別的帳號的；送成功的條目消失', async () => {
    const t = build()
    await t.queue.enqueue(ins('a'))
    await t.queue.enqueue(ins('b', { v: 1 }, 'u2'))
    await t.queue.enqueue(upd('a', { v: 2 }))
    expect((await t.queue.entries()).map((e) => [e.seq, e.rowId, e.userId])).toEqual([
      [1, 'a', 'u1'], [2, 'b', 'u2'], [3, 'a', 'u1'],
    ])
    await t.queue.flush('u1')
    expect((await t.queue.entries()).map((e) => e.rowId)).toEqual(['b'])
  })

  it('載入時儲存層亂序也回傳排好的', async () => {
    let s = appendEntry(emptySnapshot(), ins('a'), 1)
    s = appendEntry(s, ins('b'), 2)
    const t = build({ ...s, entries: [s.entries[1], s.entries[0]] })
    expect((await t.queue.entries()).map((e) => e.rowId)).toEqual(['a', 'b'])
  })
})

describe('ignoreDuplicates（預填用的 insert-ignore）', () => {
  const preset = (rowId: string): NewEntry => ({ ...ins(rowId), ignoreDuplicates: true })

  it('只記在 insert 條目上，且經過序列化還在', () => {
    const s = appendEntry(emptySnapshot(), preset('a'), 1)
    expect(s.entries[0].ignoreDuplicates).toBe(true)
    const back = JSON.parse(JSON.stringify(s)) as QueueSnapshot
    expect(back.entries[0].ignoreDuplicates).toBe(true)
  })

  it('沒要求就不出現這個欄位；update／delete 帶了也不採用', () => {
    expect('ignoreDuplicates' in appendEntry(emptySnapshot(), ins('a'), 1).entries[0]).toBe(false)
    expect('ignoreDuplicates' in appendEntry(emptySnapshot(), { ...upd('a', { v: 2 }), ignoreDuplicates: true }, 1).entries[0]).toBe(false)
    expect('ignoreDuplicates' in appendEntry(emptySnapshot(), { ...del('a'), ignoreDuplicates: true }, 1).entries[0]).toBe(false)
  })

  it('sender 收到的條目帶著這個旗標', async () => {
    const t = build()
    await t.queue.enqueue(preset('a'))
    await t.queue.flush('u1')
    expect(t.sender.sent[0].ignoreDuplicates).toBe(true)
  })
})

describe('卡住的分類與出路（AC 11、12）', () => {
  it('離線：整輪中止，後面的不送，全部留著；回線後依序送完', async () => {
    let online = false
    const t = build(null, () => (online ? 'ok' : 0))
    await t.queue.enqueue(ins('a'))
    await t.queue.enqueue(ins('b'))
    const r1 = await t.queue.flush('u1')
    expect(r1.stoppedBy).toBe('offline')
    expect(t.sender.sent).toHaveLength(1)
    expect(r1.summary).toMatchObject({ mine: 2, pending: 1, failed: { offline: 1 } })
    online = true
    const r2 = await t.queue.flush('u1')
    expect(r2.sent).toBe(2)
    expect(t.server.rows.size).toBe(2)
  })

  it('token 失效：401 → 整輪中止、條目全留、標成 auth；重新登入後繼續送且順序不變（必答②）', async () => {
    let authed = false
    const t = build(null, () => (authed ? 'ok' : 401))
    await t.queue.enqueue(ins('a', { v: 1 }))
    await t.queue.enqueue(upd('a', { v: 2 }))
    const r1 = await t.queue.flush('u1')
    expect(r1.stoppedBy).toBe('auth')
    expect(r1.summary).toMatchObject({ mine: 2, failed: { auth: 1 } })
    expect(t.mem.saved?.entries).toHaveLength(2) // 唯一的一份還在
    authed = true
    const r2 = await t.queue.flush('u1')
    expect(r2.stoppedBy).toBeNull()
    expect(t.server.rows.get('t/a')).toEqual({ v: 2 })
  })

  it('4xx（非 401）標成 rejected 並留著；下一輪會再試（例如伺服器端補了 migration）', async () => {
    let fixed = false
    const t = build(null, () => (fixed ? 'ok' : 404))
    await t.queue.enqueue(ins('a'))
    const r1 = await t.queue.flush('u1')
    expect(r1.summary.failed.rejected).toBe(1)
    expect(t.mem.saved?.entries[0]).toMatchObject({ failure: 'rejected', lastError: 'HTTP 404', attempts: 1 })
    fixed = true
    const r2 = await t.queue.flush('u1')
    expect(r2.sent).toBe(1)
    expect(r2.summary.total).toBe(0)
  })

  it('5xx 標成 transient 並留著', async () => {
    const t = build(null, () => 503)
    await t.queue.enqueue(ins('a'))
    const r = await t.queue.flush('u1')
    expect(r.summary.failed.transient).toBe(1)
    expect(r.stoppedBy).toBeNull()
  })

  it('sender 丟例外：當 transient 留著，不判死、不讓整輪崩掉', async () => {
    const t = build(null, (e) => (e.rowId === 'a' ? 'throw' : 'ok'))
    await t.queue.enqueue(ins('a'))
    await t.queue.enqueue(ins('b'))
    const r = await t.queue.flush('u1')
    expect(r.summary.failed.transient).toBe(1)
    expect(t.mem.saved?.entries[0].lastError).toBe('boom')
    expect(t.server.rows.has('t/b')).toBe(true)
  })

  it('discard 放棄被卡住的一條，解開同一列後面的條目', async () => {
    const t = build(null, (e) => (e.op === 'insert' ? 422 : 'ok'))
    await t.queue.enqueue(ins('a'))
    await t.queue.enqueue(upd('a', { v: 2 }))
    await t.queue.flush('u1')
    expect(await t.queue.discard(1)).toBe(true)
    expect(await t.queue.discard(1)).toBe(false)
    const r = await t.queue.flush('u1')
    expect(r.sent).toBe(1)
    expect(t.sender.sent[t.sender.sent.length - 1].op).toBe('update')
  })
})

describe('送出前先落地', () => {
  it('sender 被呼叫時，儲存裡該條的 attempts 已經是 1（送到一半被殺掉也看得出可能已生效）', async () => {
    const server = fakeServer()
    const mem = memoryStore()
    let seen: QueueEntry | undefined
    const queue = createQueue({
      store: mem.store,
      send: async (e) => {
        seen = mem.saved?.entries.find((x) => x.seq === e.seq)
        server.apply(e)
        return { ok: true }
      },
    })
    await queue.enqueue(ins('a'))
    await queue.flush('u1')
    expect(seen?.attempts).toBe(1)
  })

  it('重送時 failure 先歸零：送出中的條目不帶上一輪的失敗標記', async () => {
    const server = fakeServer()
    const mem = memoryStore()
    let calls = 0
    let seen: QueueEntry | undefined
    const queue = createQueue({
      store: mem.store,
      send: async (e) => {
        if (++calls === 1) return { ok: false, status: 422, message: 'bad' }
        seen = mem.saved?.entries.find((x) => x.seq === e.seq)
        server.apply(e)
        return { ok: true }
      },
    })
    await queue.enqueue(ins('a'))
    await queue.flush('u1')
    expect(mem.saved?.entries[0].failure).toBe('rejected')
    await queue.flush('u1')
    expect(seen).toMatchObject({ attempts: 2, failure: null })
  })

  it('每條送完就存檔：第 2 條失敗時，第 1 條已移除、第 2 條 attempts=1（中途被殺不丟進度）', async () => {
    const t = build(null, (e) => (e.rowId === 'b' ? 0 : 'ok'))
    await t.queue.enqueue(ins('a'))
    await t.queue.enqueue(ins('b'))
    await t.queue.flush('u1')
    expect(t.mem.saved?.entries.map((e) => [e.rowId, e.attempts])).toEqual([['b', 1]])
  })
})

describe('登出分流與帳號隔離（AC 13）', () => {
  it('別的帳號登入：不上傳、不動它的條目、報出數量', async () => {
    const t = build()
    await t.queue.enqueue(ins('a', { v: 1 }, 'u1'))
    const r = await t.queue.flush('u2')
    expect(t.sender.sent).toHaveLength(0)
    expect(r.summary).toMatchObject({ total: 1, mine: 0, foreign: 1 })
    expect(t.mem.saved?.entries[0]).toMatchObject({ userId: 'u1', attempts: 0 })
  })

  it('別的帳號加進來的條目不會覆寫原帳號的，各送各的', async () => {
    const t = build()
    await t.queue.enqueue(ins('a', { v: 1 }, 'u1'))
    await t.queue.enqueue(ins('a', { v: 2 }, 'u2')) // 同一個 rowId
    await t.queue.enqueue(upd('a', { v: 3 }, 'u2'))
    await t.queue.enqueue(del('a', 'u2')) // u2 的整串被抵銷，u1 的不受影響
    expect(t.mem.saved?.entries.map((e) => `${e.userId}/${e.op}`)).toEqual(['u1/insert'])
    expect(t.mem.saved?.entries[0].payload).toEqual({ v: 1 })
  })

  it('clear 清空全部（主動登出）；seq 不歸零', async () => {
    const t = build()
    await t.queue.enqueue(ins('a'))
    await t.queue.enqueue(ins('b', { v: 1 }, 'u2'))
    await t.queue.clear()
    expect((await t.queue.summary('u1')).total).toBe(0)
    const e = await t.queue.enqueue(ins('c'))
    expect(e?.seq).toBe(3)
  })

  it('被動掉線＝不呼叫 clear：條目與卡住標記都留著，重開 App、重新登入後能續送', async () => {
    const t = build(null, () => 401)
    await t.queue.enqueue(ins('a'))
    await t.queue.flush('u1')
    const reopened = build(t.mem.saved, () => 'ok')
    expect((await reopened.queue.summary('u1')).failed.auth).toBe(1)
    const r = await reopened.queue.flush('u1')
    expect(r.sent).toBe(1)
  })
})

describe('並行', () => {
  it('前景與 TOKEN_REFRESHED 同時呼叫 flush：共用同一輪，每條只送一次（AC 15）', async () => {
    const t = build()
    await t.queue.enqueue(ins('a'))
    await t.queue.enqueue(ins('b'))
    const [r1, r2] = await Promise.all([t.queue.flush('u1'), t.queue.flush('u1')])
    expect(t.sender.sent).toHaveLength(2)
    expect(r1).toBe(r2)
  })

  it('上一輪結束後可以再開新的一輪', async () => {
    const t = build()
    await t.queue.enqueue(ins('a'))
    await t.queue.flush('u1')
    await t.queue.enqueue(ins('b'))
    const r = await t.queue.flush('u1')
    expect(r.sent).toBe(1)
  })

  it('送出途中進來的 enqueue 不被網路卡住，也不丟', async () => {
    const gate = deferred<void>()
    const server = fakeServer()
    const mem = memoryStore()
    const queue = createQueue({
      store: mem.store,
      send: async (e) => {
        if (e.rowId === 'a') await gate.promise
        server.apply(e)
        return { ok: true }
      },
    })
    await queue.enqueue(ins('a'))
    const flushing = queue.flush('u1')
    await tick()
    await queue.enqueue(ins('b')) // a 還卡在網路上，這裡不能死鎖
    gate.resolve()
    const report = await flushing
    expect(report.sent).toBe(2) // 同一輪就會撿到 b
    expect(server.rows.size).toBe(2)
  })

  it('送出中的 insert 回 504（上游稍後才落地）：同一輪的 delete 不得搶在它前面，列最後是刪掉的', async () => {
    const gate = deferred<void>()
    const server = fakeServer()
    const mem = memoryStore()
    const sent: string[] = []
    const late: { land: (() => void) | null } = { land: null } // 物件欄位：避開 TS 對 closure 內賦值的窄化
    let insertCalls = 0
    const queue = createQueue({
      store: mem.store,
      send: async (e) => {
        sent.push(e.op)
        if (e.op === 'insert' && ++insertCalls === 1) {
          await gate.promise
          late.land = () => server.apply(e) // 閘道已回 504，上游過一會兒才真的寫入
          return { ok: false, status: 504, message: 'gateway timeout' }
        }
        server.apply(e)
        return { ok: true }
      },
    })
    await queue.enqueue(ins('a'))
    const round1 = queue.flush('u1')
    await tick()
    await queue.enqueue(del('a')) // insert 正在送出：不清它
    gate.resolve()
    await round1
    expect(sent).toEqual(['insert']) // delete 這一輪被擋住，沒有搶先
    expect(mem.saved?.entries.map((e) => e.op)).toEqual(['insert', 'delete'])
    late.land?.() // 第一次請求這時才在伺服器落地
    await queue.flush('u1') // 重送 insert（冪等）→ 再 delete
    expect(sent).toEqual(['insert', 'insert', 'delete'])
    expect(server.rows.has('t/a')).toBe(false)
    expect(mem.saved?.entries).toEqual([])
  })

  it('送出中的條目回失敗後，同一列後面的 delete 照樣被它擋住一輪，下一輪依序送完', async () => {
    const gate = deferred<void>()
    const mem = memoryStore()
    const sent: string[] = []
    let calls = 0
    const queue = createQueue({
      store: mem.store,
      send: async (e) => {
        sent.push(e.op)
        if (++calls === 1) {
          await gate.promise
          return { ok: false, status: 503, message: 'late' }
        }
        return { ok: true }
      },
    })
    await queue.enqueue(upd('a', { v: 2 }))
    const round1 = queue.flush('u1')
    await tick()
    await queue.enqueue(del('a'))
    gate.resolve()
    await round1
    expect(sent).toEqual(['update'])
    await queue.flush('u1')
    expect(sent).toEqual(['update', 'update', 'delete'])
    expect(mem.saved?.entries).toEqual([])
  })

  it('send 永不結束：逾時當離線處理並 abort 傳給 sender 的 signal，條目留著，之後的 flush 不被拖死（F2）', async () => {
    const server = fakeServer()
    const mem = memoryStore()
    let calls = 0
    let firstSignal: AbortSignal | undefined
    const queue = createQueue({
      store: mem.store,
      sendTimeoutMs: 15,
      send: (e, signal) => {
        if (++calls === 1) {
          firstSignal = signal
          return new Promise<SendResult>(() => {}) // 凍結的 fetch：既不 resolve 也不 reject
        }
        server.apply(e)
        return Promise.resolve({ ok: true })
      },
    })
    await queue.enqueue(ins('a'))
    expect(firstSignal).toBeUndefined()
    const r1 = await queue.flush('u1')
    expect(firstSignal?.aborted).toBe(true) // 讓底層請求真的中止，晚到的落地才不會發生在記下失敗之後
    expect(r1.stoppedBy).toBe('offline')
    expect(mem.saved?.entries[0]).toMatchObject({ attempts: 1, failure: 'offline', lastError: '送出逾時' })
    const r2 = await queue.flush('u1')
    expect(r2.sent).toBe(1)
    expect(server.rows.has('t/a')).toBe(true)
  })

  it('flush resolve 時，呼叫當下已排進去的條目都試過了：不論 enqueue＋flush 落在上一輪的哪個時間點（F4）', async () => {
    // 掃描上一輪的各個微工作間隙：舊實作在「掃完、尚未釋放」的縫裡，併進去的 flush 會漏掉剛排進來的條目
    for (let hops = 0; hops <= 40; hops++) {
      const t = build()
      await t.queue.enqueue(ins('a'))
      const first = t.queue.flush('u1')
      for (let i = 0; i < hops; i++) await Promise.resolve()
      await t.queue.enqueue(ins('b'))
      const second = t.queue.flush('u1')
      await Promise.all([first, second])
      expect(t.server.rows.has('t/b'), `hops=${hops}`).toBe(true)
    }
  })

  it('送出途中該條被 discard：遲到的失敗不擋住同一列後面新排進來的條目', async () => {
    const gate = deferred<void>()
    const mem = memoryStore()
    const sent: number[] = []
    let calls = 0
    const queue = createQueue({
      store: mem.store,
      send: async (e) => {
        sent.push(e.seq)
        if (++calls === 1) {
          await gate.promise
          return { ok: false, status: 503, message: 'late' }
        }
        return { ok: true }
      },
    })
    await queue.enqueue(upd('a', { v: 2 })) // seq 1
    const round = queue.flush('u1')
    await tick()
    await queue.discard(1)
    await queue.enqueue(upd('a', { v: 3 })) // seq 2：前面已經沒有東西了
    gate.resolve()
    await round
    expect(sent).toEqual([1, 2]) // 同一輪就送了 seq 2，沒被已消失的 seq 1 擋住
    expect(mem.saved?.entries).toEqual([])
  })

  it('送出途中被 clear：遲到的結果作廢，不復活條目', async () => {
    const gate = deferred<void>()
    const mem = memoryStore()
    const queue = createQueue({
      store: mem.store,
      send: async () => {
        await gate.promise
        return { ok: false, status: 503, message: 'late' }
      },
    })
    await queue.enqueue(ins('a'))
    const flushing = queue.flush('u1')
    await tick()
    await queue.clear()
    gate.resolve()
    await flushing
    expect(mem.saved?.entries).toEqual([])
  })
})
