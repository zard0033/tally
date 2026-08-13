/* read-label 安全外殼的驗證。跟著專案既有的 `npx vitest run` 跑（vitest 預設 include 撿得到本檔），
   CI 的那一步也會跑到——測試住在真正會被執行的地方，不是另開一支要人記得跑的腳本。

   為什麼是 vitest 而不是 `supabase functions serve` 或 `deno test`：本機三樣都沒有
   （deno、supabase CLI、docker 皆未安裝，`which` 實測），起不了那條路。改為直接 import handler
   驗，行為差別只在少了 Deno.serve 的 HTTP 傳輸層——被驗的判斷邏輯是同一份。

   差分設計（這才是重點）：四條路只有 **token 不一樣**，key、JWKS、handler 全同。
   過期那條刻意用**同一把有效 key** 簽，所以它被擋下只可能是 exp；缺／壞 JWKS 回的是 500 不是 401，
   401 因此只剩「驗證失敗」一個成因，不會有「別的錯誤碰巧也回 401」的假綠。 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose'
import { handleRequest } from './handler.ts'

const now = () => Math.floor(Date.now() / 1000)

/** 專案的真 key（模擬 Supabase 的 JWT signing key），與它對應的 JWKS。 */
const projectKeys = await generateKeyPair('ES256')
/** 攻擊者自備的 key：格式完全正確、簽得漂亮，但不在 JWKS 裡。 */
const foreignKeys = await generateKeyPair('ES256')

async function toJwks(publicKey: CryptoKey): Promise<string> {
  const jwk: JWK = await exportJWK(publicKey)
  // kid／alg 是 createLocalJWKSet 選 key 的依據，缺了會選不到。
  return JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', alg: 'ES256', use: 'sig' }] })
}

const JWKS = await toJwks(projectKeys.publicKey)

function sign(
  key: CryptoKey,
  claims: Record<string, unknown>,
  { iat, exp }: { iat: number; exp: number },
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key)
}

const validClaims = { sub: '11111111-2222-3333-4444-555555555555', aud: 'authenticated', role: 'authenticated' }

/** 測試用的 OpenRouter key。它是這份測試裡的「祕密」：任何回應含到它就是洩漏。 */
const OR_KEY = 'sk-or-v1-test-secret-must-never-leak'
/** 前端會送的那個形狀（長度無所謂，形狀才是被驗的東西）。 */
const IMAGE = `data:image/jpeg;base64,${'A'.repeat(120)}`
const SITE = 'https://zard0033.github.io'

function post(token?: string, body?: unknown, origin?: string): Request {
  return new Request('https://example.test/read-label', {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}

/** 非 POST 的請求（method 閘用）。 */
function request(method: string, token?: string, origin?: string): Request {
  return new Request('https://example.test/read-label', {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
  })
}

const validToken = () => sign(projectKeys.privateKey, validClaims, { iat: now(), exp: now() + 3600 })

/** 把 fetch 換成回指定 body／status 的假上游，回傳 spy 供斷言「打了什麼出去」。 */
function stubUpstream(body: string, status = 200) {
  const spy = vi.fn(async () => new Response(body, { status }))
  globalThis.fetch = spy as unknown as typeof fetch
  return spy
}

/** OpenRouter 成功回應的形狀：模型的字串塞在 choices[0].message.content。 */
const upstreamReply = (content: string) => JSON.stringify({ choices: [{ message: { content } }] })

const GOOD_READING = '{"basis":"per_serving","serving_g":17,"kcal":82,"protein_g":0.4,"fat_g":3.6,"carb_g":12.1}'

/* 「不呼叫外部服務」用機器證明，不靠讀 code 宣稱：任何路徑只要碰 fetch 就炸。
   要驗成功路徑的測試自己用 stubUpstream 換掉它——換不掉就代表那條路真的不該外呼。 */
const originalFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = vi.fn(() => {
    throw new Error('測試中不得有任何對外呼叫')
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('read-label 安全外殼', () => {
  it('① 完全沒有 Authorization header → 401，且沒有對外呼叫', async () => {
    const res = await handleRequest(post(), JWKS, OR_KEY)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未授權' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('② 亂寫的 token → 401', async () => {
    // 亂寫的 token 只能是 ASCII：HTTP header 是 ByteString，塞中文根本組不出 Request（實測撞到）。
    const res = await handleRequest(post('not.a.valid.jwt'), JWKS, OR_KEY)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未授權' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('③ 過期的 token（同一把有效 key 簽，只有 exp 不同）→ 401', async () => {
    const expired = await sign(projectKeys.privateKey, validClaims, { iat: now() - 7200, exp: now() - 3600 })
    const res = await handleRequest(post(expired), JWKS, OR_KEY)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未授權' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('④ 別的 key 簽出來的合法格式 token → 401（簽章驗證真的有在做）', async () => {
    const forged = await sign(foreignKeys.privateKey, validClaims, { iat: now(), exp: now() + 3600 })
    const res = await handleRequest(post(forged), JWKS, OR_KEY)
    expect(res.status).toBe(401)
  })

  it('⑤ 沒有 sub 的 token → 401（不是某個使用者就不放行）', async () => {
    const noSub = await sign(projectKeys.privateKey, { aud: 'authenticated', role: 'anon' }, { iat: now(), exp: now() + 3600 })
    const res = await handleRequest(post(noSub), JWKS, OR_KEY)
    expect(res.status).toBe(401)
  })

  /* ⑥ 原本斷言的是「驗過→回佔位假資料」。佔位那半正是這一輪被換掉的東西，所以這條測試跟著它走：
     形狀斷言原樣保留，資料來源從 STUB_READING 換成（被 stub 的）模型輸出。 */
  it('⑥ 有效 token → 200 且回固定形狀的讀數', async () => {
    stubUpstream(upstreamReply(GOOD_READING))
    const res = await handleRequest(post(await validToken(), { image: IMAGE }), JWKS, OR_KEY)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(
      ['basis', 'carb_g', 'fat_g', 'kcal', 'protein_g', 'serving_g'],
    )
    expect(body.basis).toBe('per_serving')
    expect(typeof body.kcal).toBe('number')
  })

  it('⑦ SUPABASE_JWKS 缺／壞 → 500 而不是 401（讓 401 只剩驗證失敗一個成因）', async () => {
    const valid = await sign(projectKeys.privateKey, validClaims, { iat: now(), exp: now() + 3600 })
    const missing = await handleRequest(post(valid), undefined, OR_KEY)
    expect(missing.status).toBe(500)
    expect(await missing.json()).toEqual({ error: '服務設定不完整' })

    const broken = await handleRequest(post(valid), '{ 不是 JSON', OR_KEY)
    expect(broken.status).toBe(500)
  })

  it('⑧ 錯誤回應只有一個 error 欄位，不夾帶 stack／環境變數內容', async () => {
    const res = await handleRequest(post('broken-token'), JWKS, OR_KEY)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['error'])
    const text = JSON.stringify(body)
    expect(text).not.toContain('at ')
    expect(text).not.toContain(JWKS.slice(0, 20))
  })
})

/* CORS 與 method 閘。這兩件是前端要從 GitHub Pages 跨網域打進來才需要的，
   跟身分驗證是兩回事：CORS 只是瀏覽器端的輔助，真正的邊界永遠是上面那把 JWT。 */
describe('read-label 跨網域與 method', () => {
  it('⑨ OPTIONS preflight 不帶 Authorization 也要通，且回得出瀏覽器要的三個 header', async () => {
    for (const origin of ['https://zard0033.github.io', 'http://localhost:5500']) {
      const res = await handleRequest(request('OPTIONS', undefined, origin), JWKS, OR_KEY)
      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin)
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
      expect(globalThis.fetch).not.toHaveBeenCalled()
    }
  })

  it('⑩ 白名單外的 origin 拿不到 Access-Control-Allow-Origin（preflight 與正式請求都是）', async () => {
    // origin 只能是 ASCII：header 是 ByteString。
    for (const origin of ['https://evil.example', 'http://localhost:5501', 'null']) {
      const pre = await handleRequest(request('OPTIONS', undefined, origin), JWKS, OR_KEY)
      expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull()

      const real = await handleRequest(post(await validToken(), { image: IMAGE }, origin), JWKS, OR_KEY)
      expect(real.headers.get('Access-Control-Allow-Origin')).toBeNull()
    }
  })

  it('⑪ 錯誤回應也要帶 CORS header，否則瀏覽器讀不到 {error}、前端的手打退路就斷了', async () => {
    const res = await handleRequest(post(undefined, undefined, SITE), JWKS, OR_KEY)
    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
  })

  it('⑫ 非 POST 一律 405——帶著有效 token 的 GET 也一樣，且不呼叫 OpenRouter', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await handleRequest(request(method, await validToken(), SITE), JWKS, OR_KEY)
      expect(res.status).toBe(405)
      expect(await res.json()).toEqual({ error: '只接受 POST' })
      expect(globalThis.fetch).not.toHaveBeenCalled()
    }
  })
})

/* 辨識這一段。上面的 fetch stub（一碰就炸）在這裡是主角：所有失敗路徑都必須在它面前活下來。 */
describe('read-label 辨識', () => {
  it('⑬ 偽造 token ＋ 完全合法的圖片 body → 401，且**一次 OpenRouter 都沒打**', async () => {
    const forged = await sign(foreignKeys.privateKey, validClaims, { iat: now(), exp: now() + 3600 })
    const res = await handleRequest(post(forged, { image: IMAGE }, SITE), JWKS, OR_KEY)
    expect(res.status).toBe(401)
    // 這條是驗證閘的機器證明：把 handler 的 jwtVerify 拿掉，這行就會轉紅（已實測）。
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('⑭ 驗過但 OPENROUTER_API_KEY 沒設 → 500 服務設定不完整，不外呼', async () => {
    const res = await handleRequest(post(await validToken(), { image: IMAGE }), JWKS, undefined)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: '服務設定不完整' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('⑮ body 不合法 → 400，尤其 image 不是 data: 影像時絕不代打（SSRF 閘）', async () => {
    const token = await validToken()
    const bad: unknown[] = [
      undefined, // 沒有 body
      '不是 JSON',
      {}, // 沒有 image
      { image: 'http://169.254.169.254/latest/meta-data/' }, // 要它去打內網
      { image: 'https://example.test/a.jpg' },
      { image: 'data:text/html;base64,PHNjcmlwdD4=' }, // 不是影像
      { image: 'data:image/svg+xml;base64,PHN2Zz4=' }, // SVG 不收
      { image: 123 },
      { image: `data:image/jpeg;base64,${'A'.repeat(700_001)}` }, // 超過上限
    ]
    for (const body of bad) {
      const res = await handleRequest(post(token, body, SITE), JWKS, OR_KEY)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: '請求格式不正確' })
      expect(globalThis.fetch).not.toHaveBeenCalled()
    }
  })

  it('⑯ 成功路徑：打對端點與模型、圖片原樣帶上、key 只出現在對上游的 header', async () => {
    const spy = stubUpstream(upstreamReply(GOOD_READING))
    const res = await handleRequest(post(await validToken(), { image: IMAGE }, SITE), JWKS, OR_KEY)

    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OR_KEY}`)
    const sent = JSON.parse(init.body as string)
    expect(sent.model).toBe('qwen/qwen3.7-flash')
    expect(sent.messages[0].content[0].text).toContain('一律讀「每份」那欄')
    expect(sent.messages[0].content[1].image_url.url).toBe(IMAGE)

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(await res.json()).toEqual({
      basis: 'per_serving', serving_g: 17, kcal: 82, protein_g: 0.4, fat_g: 3.6, carb_g: 12.1,
    })
  })

  it('⑰ 模型把 JSON 包在 ``` 裡也解得開；多出來的欄位不會跟著送給前端', async () => {
    stubUpstream(upstreamReply('```json\n{"basis":"per_100g","serving_g":null,"kcal":250,"protein_g":8,"fat_g":12,"carb_g":28,"note":"多的"}\n```'))
    const res = await handleRequest(post(await validToken(), { image: IMAGE }), JWKS, OR_KEY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      basis: 'per_100g', serving_g: null, kcal: 250, protein_g: 8, fat_g: 12, carb_g: 28,
    })
  })

  it('⑱ 模型回的讀數半殘或不是 JSON → 502 {error}，不把半組數字交給前端', async () => {
    const token = await validToken()
    const bad = [
      '看不清楚耶，這張圖太模糊了',
      '{"basis":"per_serving","serving_g":17,"kcal":82}', // 缺三個欄位
      '{"basis":"每份","serving_g":17,"kcal":82,"protein_g":0.4,"fat_g":3.6,"carb_g":12.1}', // basis 不在列舉內
      '{"basis":"per_serving","serving_g":17,"kcal":null,"protein_g":0.4,"fat_g":3.6,"carb_g":12.1}', // 讀不到就填 null
      '{"basis":"per_serving","serving_g":17,"kcal":"82","protein_g":0.4,"fat_g":3.6,"carb_g":12.1}', // 字串不是數字
      '[1,2,3]',
      'null',
    ]
    for (const content of bad) {
      stubUpstream(upstreamReply(content))
      const res = await handleRequest(post(token, { image: IMAGE }, SITE), JWKS, OR_KEY)
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: '辨識失敗' })
    }
  })

  it('⑲ 上游壞掉時，回給前端的 body 不含金鑰、不含上游原文、不含 stack', async () => {
    const token = await validToken()
    // 上游的錯誤訊息刻意把 key 和一段像 stack 的東西夾在裡面——只要有轉發就會被抓到。
    const leaky = JSON.stringify({
      error: { message: `Invalid API key: ${OR_KEY}`, stack: 'at handler (file:///x.ts:1:1)' },
    })
    const cases: (() => void)[] = [
      () => stubUpstream(leaky, 401),
      () => stubUpstream(leaky, 500),
      () => stubUpstream('<html>Bad Gateway</html>', 200), // 上游回的不是 JSON
      () => stubUpstream(JSON.stringify({ choices: [] }), 200), // 形狀不對
      () => {
        globalThis.fetch = vi.fn(() => {
          throw new Error(`fetch failed: Authorization: Bearer ${OR_KEY}`)
        }) as unknown as typeof fetch
      },
    ]
    for (const setup of cases) {
      setup()
      const res = await handleRequest(post(token, { image: IMAGE }, SITE), JWKS, OR_KEY)
      expect(res.status).toBe(502)
      const body = await res.json()
      expect(Object.keys(body)).toEqual(['error'])
      const text = JSON.stringify(body)
      expect(text).not.toContain(OR_KEY)
      expect(text).not.toContain('sk-or')
      expect(text).not.toContain('Invalid API key')
      expect(text).not.toContain('at ')
    }
  })
})
