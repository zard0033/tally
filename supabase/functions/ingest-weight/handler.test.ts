/* ingest-weight 的驗證。跟著專案既有的 `npx vitest run` 跑（同 read-label，本機沒有 Deno／Docker）。
   AC 編號對應 spec.md「體重自動同步」節。

   兩個設計重點：
   1. **差分**：401 的測試只換 token，其餘（設定、payload、時鐘）全同——擋下的原因因此只可能是 token。
      設定不全回 500 不回 401（AC9），401 才只有一個成因，不會有「別的錯誤碰巧也回 401」的假綠。
   2. **「沒寫入」用機器證明**：每條失敗路徑都斷言 upsert 零次呼叫，不靠讀 code 宣稱。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRequest, timingSafeEqual, type IngestDeps, type WeightRow } from './handler.ts'

/** 測試用祕密：任何回應或 log 含到它就是洩漏。 */
const TOKEN = 'ingest-token-for-tests-0123456789abcdef'
const OWNER = '11111111-2222-3333-4444-555555555555'
const TODAY = '2026-10-12'

function makeDeps(over: Partial<IngestDeps> = {}) {
  const upsert = vi.fn(async (_rows: WeightRow[]): Promise<void> => {})
  const deps: IngestDeps = { token: TOKEN, ownerId: OWNER, today: TODAY, upsert, ...over }
  return { deps, upsert: deps.upsert as typeof upsert }
}

/** token 傳 null＝完全不帶 Authorization。**不能用 undefined**：預設參數會把它換回 TOKEN，
 *  「沒帶 token」的測試就會悄悄送出對的 token（寫完第一版才發現）。 */
function post(body: unknown, token: string | null = TOKEN, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/ingest-weight', {
    method: 'POST',
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      'Content-Type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const reading = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-09',
  weight_kg: 77.35,
  body_fat_pct: 24.6,
  ...over,
})

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  // diag 走 console.error；靜音，同時留著給「log 不含 token」那條斷言用。
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

describe('驗證（AC1、AC9）', () => {
  it('沒帶 Authorization → 401，不寫入', async () => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(post(reading(), null), deps)
    expect(res.status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('scheme 不是 Bearer → 401，不寫入', async () => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(post(reading(), null, { Authorization: `Basic ${TOKEN}` }), deps)
    expect(res.status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('token 只差一個字元 → 401，不寫入', async () => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(post(reading(), TOKEN.slice(0, -1) + 'X'), deps)
    expect(res.status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('差分：同一份 payload、同一組設定，只換 token——對的 200、錯的 401', async () => {
    const good = makeDeps()
    const bad = makeDeps()
    const okRes = await handleRequest(post(reading()), good.deps)
    const noRes = await handleRequest(post(reading(), 'wrong-' + TOKEN), bad.deps)
    expect(okRes.status).toBe(200)
    expect(noRes.status).toBe(401)
    expect(good.upsert).toHaveBeenCalledTimes(1)
    expect(bad.upsert).not.toHaveBeenCalled()
  })

  it('三種驗證失敗回同一句固定訊息', async () => {
    const { deps } = makeDeps()
    const bodies = await Promise.all([
      handleRequest(post(reading(), null), deps),
      handleRequest(post(reading(), null, { Authorization: `Basic ${TOKEN}` }), deps),
      handleRequest(post(reading(), 'x'.repeat(40)), deps),
    ].map(async (p) => (await p).text()))
    expect(new Set(bodies).size).toBe(1)
  })

  it.each([
    ['token 未設', { token: undefined }],
    ['token 太短（31 字元）', { token: 'x'.repeat(31) }],
    ['ownerId 不是 UUID', { ownerId: 'not-a-uuid' }],
    ['today 不是日期', { today: 'tomorrow' }],
  ] as [string, Partial<IngestDeps>][])('設定不全：%s → 500 而不是 401，不寫入', async (_name, over) => {
    const { deps, upsert } = makeDeps(over)
    // 帶一個「看起來合法」的 Bearer：若實作漏了設定檢查，空 token 比對可能意外放行
    const res = await handleRequest(post(reading(), over.token ?? TOKEN), deps)
    expect(res.status).toBe(500)
    expect(upsert).not.toHaveBeenCalled()
  })

  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS'])('%s → 405（即使帶對的 token）', async (method) => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(
      new Request('https://example.test/ingest-weight', { method, headers: { Authorization: `Bearer ${TOKEN}` } }),
      deps,
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull() // AC10：不加 CORS
    expect(upsert).not.toHaveBeenCalled()
  })

  it('log 與回應都不含 token（對的與錯的都不含）', async () => {
    const { deps } = makeDeps()
    const wrong = 'attacker-guess-' + 'z'.repeat(30)
    const res = await handleRequest(post(reading(), wrong), deps)
    const text = await res.text()
    const logs = JSON.stringify(errorSpy.mock.calls)
    for (const secret of [TOKEN, wrong]) {
      expect(text).not.toContain(secret)
      expect(logs).not.toContain(secret)
    }
  })
})

describe('寫入（AC2、AC3、AC6、AC7、AC8）', () => {
  it('單筆物件 → 200 {written:1}，列的內容正確', async () => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(post(reading()), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ written: 1 })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toEqual([
      { user_id: OWNER, measured_on: '2026-10-09', weight_kg: 77.35, body_fat_pct: 24.6 },
    ])
  })

  it('批次兩筆不同日期 → 一次 upsert、按日期排序', async () => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(
      post({ readings: [reading({ date: '2026-10-09' }), reading({ date: '2026-10-02', weight_kg: 77.0, body_fat_pct: 24.2 })] }),
      deps,
    )
    expect(await res.json()).toEqual({ written: 2 })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0].map((r) => r.measured_on)).toEqual(['2026-10-02', '2026-10-09'])
  })

  it('user_id 不取自請求：payload 夾帶 user_id 也一律寫 OWNER', async () => {
    const { deps, upsert } = makeDeps()
    await handleRequest(post(reading({ user_id: 'attacker-chosen-id' })), deps)
    expect(upsert.mock.calls[0][0][0].user_id).toBe(OWNER)
  })

  it('重送同一份 payload → 兩次寫入列完全相同（冪等的前提：鍵只有 user_id＋日期）', async () => {
    const { deps, upsert } = makeDeps()
    await handleRequest(post(reading()), deps)
    await handleRequest(post(reading()), deps)
    expect(upsert.mock.calls[1][0]).toEqual(upsert.mock.calls[0][0])
  })

  it('回應只有 written，不含 owner id', async () => {
    const { deps } = makeDeps()
    const text = await (await handleRequest(post(reading()), deps)).text()
    expect(text).not.toContain(OWNER)
    expect(JSON.parse(text)).toEqual({ written: 1 })
  })

  it('體脂小數 0.246 → 24.6（浮點誤差已收掉）', async () => {
    const { deps, upsert } = makeDeps()
    await handleRequest(post(reading({ body_fat_pct: 0.246 })), deps)
    expect(upsert.mock.calls[0][0][0].body_fat_pct).toBe(24.6)
  })

  it('帶單位的字串："24.6%" 與 "77.35 kg" 都能解', async () => {
    const { deps, upsert } = makeDeps()
    await handleRequest(post(reading({ weight_kg: '77.35 kg', body_fat_pct: '24.6%' })), deps)
    expect(upsert.mock.calls[0][0][0]).toMatchObject({ weight_kg: 77.35, body_fat_pct: 24.6 })
  })

  it('沒有體脂 → body_fat_pct 是 null（key 存在）', async () => {
    const { deps, upsert } = makeDeps()
    await handleRequest(post({ date: '2026-10-09', weight_kg: 77.35 }), deps)
    expect(upsert.mock.calls[0][0][0]).toHaveProperty('body_fat_pct', null)
  })

  it('日期帶時間 → 只取前十碼，不做時區換算', async () => {
    const { deps, upsert } = makeDeps()
    await handleRequest(post(reading({ date: '2026-10-09T23:40:00+08:00' })), deps)
    expect(upsert.mock.calls[0][0][0].measured_on).toBe('2026-10-09')
  })

  it('同一天多筆：時間字串較大者勝', async () => {
    const { deps, upsert } = makeDeps()
    await handleRequest(
      post({
        readings: [
          reading({ date: '2026-10-09T21:00:00+08:00', weight_kg: 78 }),
          reading({ date: '2026-10-09T08:00:00+08:00', weight_kg: 77 }),
        ],
      }),
      deps,
    )
    expect(upsert.mock.calls[0][0]).toHaveLength(1)
    expect(upsert.mock.calls[0][0][0].weight_kg).toBe(78)
  })

  it('同一天多筆且都沒時間：後面那筆勝', async () => {
    const { deps, upsert } = makeDeps()
    await handleRequest(post({ readings: [reading({ weight_kg: 77 }), reading({ weight_kg: 78 })] }), deps)
    expect(upsert.mock.calls[0][0][0].weight_kg).toBe(78)
  })

  it('「明天」可以（跨時區的緩衝）、後天不行', async () => {
    const a = makeDeps()
    const b = makeDeps()
    expect((await handleRequest(post(reading({ date: '2026-10-13' })), a.deps)).status).toBe(200)
    expect((await handleRequest(post(reading({ date: '2026-10-14' })), b.deps)).status).toBe(400)
    expect(b.upsert).not.toHaveBeenCalled()
  })
})

describe('不合法的 payload（AC4、AC5）→ 400，整批不寫入', () => {
  it.each([
    ['體重低於 30', { weight_kg: 29.99 }],
    ['體重高於 250', { weight_kg: 250.01 }],
    ['缺體重', { weight_kg: undefined }],
    ['體重不是數字', { weight_kg: 'abc' }],
    ['體重是負數字串', { weight_kg: '-70' }],
    ['體重是 null', { weight_kg: null }],
    ['體脂換算後低於 2（1.5）', { body_fat_pct: 1.5 }],
    ['體脂高於 70', { body_fat_pct: 70.1 }],
    ['體脂不是數字', { body_fat_pct: 'x' }],
    ['日期不存在（2/30）', { date: '2026-02-30' }],
    ['日期格式錯', { date: '10/09/2026' }],
    ['缺日期', { date: undefined }],
    ['日期早於 2015', { date: '2014-12-31' }],
    ['日期是後天', { date: '2026-10-14' }],
  ] as [string, Record<string, unknown>][])('%s', async (_name, over) => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(post(reading(over)), deps)
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('批次裡有一筆壞 → 整批不寫（好的那幾筆也不寫）', async () => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(
      post({ readings: [reading({ date: '2026-10-02' }), reading({ weight_kg: 5 }), reading({ date: '2026-10-05' })] }),
      deps,
    )
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('61 筆 → 400；60 筆 → 200', async () => {
    const mk = (n: number) => ({
      readings: Array.from({ length: n }, (_, i) => reading({ date: `2026-${i < 30 ? '08' : '09'}-${String((i % 30) + 1).padStart(2, '0')}` })),
    })
    const over = makeDeps()
    const ok = makeDeps()
    expect((await handleRequest(post(mk(61)), over.deps)).status).toBe(400)
    expect(over.upsert).not.toHaveBeenCalled()
    expect((await handleRequest(post(mk(60)), ok.deps)).status).toBe(200)
  })

  it.each([
    ['不是 JSON', 'not json at all'],
    ['頂層是陣列', '[1,2,3]'],
    ['頂層是 null', 'null'],
    ['空的 readings', '{"readings":[]}'],
  ])('%s', async (_name, raw) => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(post(raw), deps)
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('body 超過 20,000 字元 → 400', async () => {
    const { deps, upsert } = makeDeps()
    const res = await handleRequest(post({ readings: [reading()], pad: 'x'.repeat(20_001) }), deps)
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('寫庫失敗 → 502，細節不外洩', () => {
  it('upsert 丟錯 → 固定訊息，不含錯誤文字與 token', async () => {
    const { deps } = makeDeps({
      upsert: vi.fn(async () => {
        throw new Error(`pg exploded near ${TOKEN}`)
      }),
    })
    const res = await handleRequest(post(reading()), deps)
    const text = await res.text()
    expect(res.status).toBe(502)
    expect(text).not.toContain('exploded')
    expect(text).not.toContain(TOKEN)
  })
})

describe('timingSafeEqual', () => {
  it.each([
    ['相同', 'abc', 'abc', true],
    ['差一個字元', 'abc', 'abd', false],
    ['長度不同（前綴）', 'abc', 'abcd', false],
    ['長度不同（空）', '', 'a', false],
    ['都是空', '', '', true],
    ['非 ASCII', '令牌', '令牌', true],
  ] as [string, string, string, boolean][])('%s', (_n, a, b, want) => {
    expect(timingSafeEqual(a, b)).toBe(want)
  })
})
