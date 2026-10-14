import { describe, expect, it } from 'vitest'
import type { KeyValueStore } from './queueStore'
import type { SenderChain } from './sender'
import { BASE_STORAGE_KEY, createTrainingRuntime, type ReaderBuilder, type TrainingClient } from './trainingRuntime'
import { presetExerciseId, type Row } from './training'

/* ═══════════ 測試替身 ═══════════ */

/** 記憶體版 key-value。failKeys 內的 key 寫入會丟錯（模擬容量滿）。 */
function memoryKv() {
  const data = new Map<string, unknown>()
  const failKeys = new Set<string>()
  const kv: KeyValueStore = {
    get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : undefined),
    set: async (k, v) => {
      if (failKeys.has(k)) throw new DOMException('quota', 'QuotaExceededError')
      data.set(k, structuredClone(v))
    },
  }
  return { kv, data, failKeys }
}

/** 假後端：讀（select/order/range）與寫（upsert/update/delete）共用同一份資料。
 *  online=false 時一切請求都像斷網一樣 reject。 */
function fakeBackend() {
  const tables = new Map<string, Map<string, Row>>()
  const store = (t: string) => {
    let m = tables.get(t)
    if (!m) tables.set(t, (m = new Map()))
    return m
  }
  const state = { online: true, fetches: 0, writes: [] as string[], readError: false }
  const down = () => Promise.reject(new TypeError('Load failed'))

  const writeChain = (apply: (id: string) => unknown[]): SenderChain => {
    let id = ''
    const c: SenderChain = {
      select: () => c,
      eq: (_col, v) => ((id = v), c),
      abortSignal: () => c,
      then: (f, r) => {
        const p = state.online ? Promise.resolve({ data: apply(id), error: null, status: 200 }) : down()
        return p.then(f, r)
      },
    }
    return c
  }

  const client: TrainingClient = {
    from: (table) => ({
      select: () => {
        let lo = 0
        let hi = Number.POSITIVE_INFINITY
        const b: ReaderBuilder = {
          order: () => b,
          range: (a, z) => ((lo = a), (hi = z), b),
          abortSignal: () => b,
          then: (f, r) => {
            state.fetches++
            let p: Promise<{ data: unknown; error: { message: string } | null }>
            if (!state.online) p = down()
            else if (state.readError) p = Promise.resolve({ data: null, error: { message: 'permission denied' } })
            else {
              const rows = [...store(table).values()].sort((x, y) => x.id.localeCompare(y.id))
              p = Promise.resolve({ data: rows.slice(lo, hi + 1), error: null })
            }
            return p.then(f, r)
          },
        }
        return b
      },
      upsert: (values, options) =>
        writeChain(() => {
          const id = String(values.id)
          state.writes.push(`upsert ${table}/${id}`)
          if (options.ignoreDuplicates && store(table).has(id)) return []
          store(table).set(id, { ...store(table).get(id), ...values, id })
          return [{ id }]
        }),
      update: (values) =>
        writeChain((id) => {
          state.writes.push(`update ${table}/${id}`)
          const cur = store(table).get(id)
          if (!cur) return []
          store(table).set(id, { ...cur, ...values, id })
          return [{ id }]
        }),
      delete: () =>
        writeChain((id) => {
          state.writes.push(`delete ${table}/${id}`)
          store(table).delete(id)
          return []
        }),
    }),
  }
  const seed = (table: string, ...rows: Row[]) => rows.forEach((r) => store(table).set(r.id, r))
  return { client, state, seed, store }
}

const U1 = 'user-1'
const exercise = (id: string, name = id): Row => ({ id, name, muscle_group: 'legs', tips: null, archived: false })

function setup(opts: { pageSize?: number } = {}) {
  const backend = fakeBackend()
  const mem = memoryKv()
  const open = () => createTrainingRuntime({ kv: mem.kv, client: backend.client, ...opts })
  return { backend, mem, open, rt: open() }
}

/* ═══════════ 讀取與本機底 ═══════════ */

describe('load', () => {
  it('分頁拉完全部列（單次上限 1000 的保護）', async () => {
    const t = setup({ pageSize: 2 })
    t.backend.seed('exercises', ...['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => exercise(id)))
    const v = await t.rt.load(U1)
    expect(v.db.exercises.map((r) => r.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])
    expect(v.source).toBe('server')
    expect(t.backend.state.fetches).toBe(3 + 6) // exercises 三頁、其餘六張各一頁
  })

  it('讀到後寫進本機：離線重開（新實例、同一份儲存）仍讀得到，標示為 cache', async () => {
    const t = setup()
    t.backend.seed('exercises', exercise('e1', '腿推舉'))
    await t.rt.load(U1)
    t.backend.state.online = false
    const reopened = t.open()
    const v = await reopened.view(U1)
    expect(v.source).toBe('cache')
    expect(v.db.exercises.map((r) => r.name)).toEqual(['腿推舉'])
  })

  it('離線載入退回本機底，而且不會把本機底蓋掉', async () => {
    const t = setup()
    t.backend.seed('exercises', exercise('e1'))
    await t.rt.load(U1)
    t.backend.state.online = false
    const reopened = t.open()
    const v = await reopened.load(U1)
    expect(v.source).toBe('cache')
    expect(v.db.exercises).toHaveLength(1)
    expect((t.mem.data.get(BASE_STORAGE_KEY) as { tables: { exercises: Row[] } }).tables.exercises).toHaveLength(1)
  })

  it('伺服器回錯誤（例如 RLS 擋下）同樣退回本機底，不當成「沒有資料」', async () => {
    const t = setup()
    t.backend.seed('exercises', exercise('e1'))
    await t.rt.load(U1)
    t.backend.state.readError = true
    const v = await t.open().load(U1)
    expect(v.source).toBe('cache')
    expect(v.db.exercises).toHaveLength(1)
  })

  it('別的帳號的底不借用', async () => {
    const t = setup()
    t.backend.seed('exercises', exercise('e1'))
    await t.rt.load(U1)
    t.backend.state.online = false
    const v = await t.open().view('user-2')
    expect(v.source).toBe('empty')
    expect(v.db.exercises).toEqual([])
  })

  it('底的內容壞掉：當沒有，不丟錯', async () => {
    const t = setup()
    t.mem.data.set(BASE_STORAGE_KEY, 'garbage')
    t.backend.state.online = false
    const v = await t.rt.view(U1)
    expect(v.source).toBe('empty')
  })

  it('本機底寫不進去：不丟錯，資料仍可用，cacheError 為 true', async () => {
    const t = setup()
    t.backend.seed('exercises', exercise('e1'))
    t.mem.failKeys.add(BASE_STORAGE_KEY)
    const v = await t.rt.load(U1)
    expect(v.db.exercises).toHaveLength(1)
    expect(v.cacheError).toBe(true)
  })
})

/* ═══════════ 預填（AC 1） ═══════════ */

describe('預填動作', () => {
  it('第一次就離線、連底都沒有：預填 16 個排進佇列（insert-ignore、無父列），畫面立刻看得到', async () => {
    const t = setup()
    t.backend.state.online = false
    const v = await t.rt.load(U1)
    expect(v.source).toBe('empty')
    expect(v.db.exercises).toHaveLength(16)
    expect(v.summary.mine).toBe(16)
    const entries = await t.rt.queue.entries()
    expect(entries.every((e) => e.ignoreDuplicates === true && e.parents === undefined)).toBe(true)
  })

  it('伺服器上已經有動作：不預填', async () => {
    const t = setup()
    t.backend.seed('exercises', exercise('mine'))
    await t.rt.load(U1)
    expect(await t.rt.queue.entries()).toHaveLength(0)
  })

  it('連線時伺服器一個都沒有：預填後 flush，伺服器上有 16 列；重複載入不會再預填', async () => {
    const t = setup()
    await t.rt.load(U1)
    const { report } = await t.rt.flush(U1)
    expect(report.sent).toBe(16)
    expect(t.backend.store('exercises').size).toBe(16)
    await t.rt.load(U1)
    expect(await t.rt.queue.entries()).toHaveLength(0)
  })

  it('預填不蓋掉伺服器上已被改過的同 id 列（離線預填、回線才上傳的情形）', async () => {
    const t = setup()
    t.backend.state.online = false
    await t.rt.load(U1) // 離線：本機以為是空的，預填 16 個
    const legPress = presetExerciseId(U1, 'leg-press')
    t.backend.seed('exercises', { ...exercise(legPress, '我改過的名字'), muscle_group: 'legs' })
    t.backend.state.online = true
    await t.rt.flush(U1)
    expect(t.backend.store('exercises').get(legPress)?.name).toBe('我改過的名字')
    expect(t.backend.store('exercises').size).toBe(16)
  })
})

/* ═══════════ 寫入與同步 ═══════════ */

describe('write／flush', () => {
  const tree = (e: string) => [
    { op: 'insert' as const, table: 'workouts' as const, rowId: 'w1', payload: { performed_on: '2026-10-14', started_at: '2026-10-14T10:00:00.000Z' } },
    { op: 'insert' as const, table: 'workout_exercises' as const, rowId: 'we1', payload: { workout_id: 'w1', exercise_id: e, position: 0 } },
    { op: 'insert' as const, table: 'workout_sets' as const, rowId: 's1', payload: { workout_exercise_id: 'we1', set_no: 1, weight_kg: 60, reps: 10, done: true } },
  ]

  async function withExercise() {
    const t = setup()
    t.backend.seed('exercises', exercise('e1'))
    await t.rt.load(U1)
    return t
  }

  it('寫入後畫面立刻看得到；父列依賴由 parentRefs 自動補齊', async () => {
    const t = await withExercise()
    const v = await t.rt.write(U1, tree('e1'))
    expect(v.db.workouts.map((r) => r.id)).toEqual(['w1'])
    expect(v.db.workout_sets).toHaveLength(1)
    expect(v.summary.mine).toBe(3)
    const entries = await t.rt.queue.entries()
    expect(entries[1].parents).toEqual([
      { table: 'workouts', rowId: 'w1' },
      { table: 'exercises', rowId: 'e1' },
    ])
    expect(entries[2].parents).toEqual([{ table: 'workout_exercises', rowId: 'we1' }])
  })

  it('flush 依父→子順序送出，伺服器上三列都在，佇列清空', async () => {
    const t = await withExercise()
    await t.rt.write(U1, tree('e1'))
    const { report, view } = await t.rt.flush(U1)
    expect(report.sent).toBe(3)
    expect(t.backend.state.writes).toEqual([
      'upsert workouts/w1', 'upsert workout_exercises/we1', 'upsert workout_sets/s1',
    ])
    expect(view.summary.mine).toBe(0)
    expect(view.db.workout_sets).toHaveLength(1) // 已併進底，沒有因為離開佇列而消失
  })

  it('送出後離線重開：剛送出的列還在（併進了本機底），佇列是空的', async () => {
    const t = await withExercise()
    await t.rt.write(U1, tree('e1'))
    await t.rt.flush(U1)
    t.backend.state.online = false
    const v = await t.open().view(U1)
    expect(v.db.workouts.map((r) => r.id)).toEqual(['w1'])
    expect(v.summary.mine).toBe(0)
  })

  it('離線時寫入：記在佇列、畫面看得到、重開還在，回線後送出', async () => {
    const t = await withExercise()
    t.backend.state.online = false
    await t.rt.write(U1, tree('e1'))
    const reopened = t.open() // 重開：記憶體清空，只剩儲存
    const offline = await reopened.view(U1)
    expect(offline.db.workouts).toHaveLength(1)
    expect(offline.summary.mine).toBe(3)
    t.backend.state.online = true
    const { report } = await reopened.flush(U1)
    expect(report.sent).toBe(3)
    expect(t.backend.store('workout_sets').size).toBe(1)
  })

  it('什麼都沒送出就不重拉伺服器', async () => {
    const t = await withExercise()
    const before = t.backend.state.fetches
    await t.rt.flush(U1)
    expect(t.backend.state.fetches).toBe(before)
  })

  it('第一次就離線記錄、底不存在：回線 flush 後重拉，送出的列不消失', async () => {
    const t = setup()
    t.backend.state.online = false
    await t.rt.load(U1) // 預填 16 個，沒有底
    await t.rt.write(U1, tree(presetExerciseId(U1, 'leg-press')))
    t.backend.state.online = true
    const { view } = await t.rt.flush(U1)
    expect(view.source).toBe('server')
    expect(view.db.workouts.map((r) => r.id)).toEqual(['w1'])
    expect(view.db.exercises).toHaveLength(16)
    expect(view.summary.mine).toBe(0)
  })

  it('update 與 delete：就地合併／級聯隱藏，送出後伺服器一致', async () => {
    const t = await withExercise()
    await t.rt.write(U1, tree('e1'))
    await t.rt.flush(U1)
    const v1 = await t.rt.write(U1, [
      { op: 'update', table: 'workouts', rowId: 'w1', payload: { ended_at: '2026-10-14T11:00:00.000Z' } },
    ])
    expect(v1.db.workouts[0].ended_at).toBe('2026-10-14T11:00:00.000Z')
    const v2 = await t.rt.write(U1, [{ op: 'delete', table: 'workouts', rowId: 'w1' }])
    expect(v2.db.workouts).toEqual([])
    expect(v2.db.workout_sets).toEqual([]) // 級聯隱藏
    await t.rt.flush(U1)
    expect(t.backend.store('workouts').size).toBe(0)
  })
})

/* ═══════════ 登出 ═══════════ */

describe('clearAll', () => {
  it('清掉佇列與本機底：離線重開什麼都沒有', async () => {
    const t = setup()
    t.backend.seed('exercises', exercise('e1'))
    await t.rt.load(U1)
    await t.rt.write(U1, [{ op: 'insert', table: 'workouts', rowId: 'w1', payload: { performed_on: '2026-10-14' } }])
    await t.rt.clearAll()
    t.backend.state.online = false
    const v = await t.open().view(U1)
    expect(v.source).toBe('empty')
    expect(v.db.exercises).toEqual([])
    expect(v.summary.total).toBe(0)
  })
})
