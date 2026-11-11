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
import { AI_MODELS, CATEGORIES, handleRequest, VISION_MODELS } from './handler.ts'
import { FOOD_CATEGORIES } from '../../../src/lib/categories.ts'
import * as front from '../../../src/lib/aiModels.ts'

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

const GOOD_READING = '{"name":"伯朗奶茶-減糖香濃原味(三合一)","basis":"per_serving","serving_g":17,"kcal":82,"protein_g":0.4,"fat_g":3.6,"carb_g":12.1}'

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
      ['basis', 'carb_g', 'fat_g', 'kcal', 'name', 'protein_g', 'serving_g'],
    )
    expect(body.basis).toBe('per_serving')
    expect(typeof body.kcal).toBe('number')
    expect(body.name).toBe('伯朗奶茶-減糖香濃原味(三合一)')
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
      /* 超過上限。**跟著 handler 的 MAX_IMAGE_CHARS 走**——上線第一天就是因為那個常數
         拿本機 Pillow 的量測去設、而真機 canvas 吐出三倍大而撞牆（見 handler 該常數的註解）。
         這裡刻意寫死一個「明顯超過」的量而不是 import 常數：測試要驗的是「有界」這個行為，
         不是「界在哪個數字」——import 進來的話常數改了測試永遠跟著綠，就驗不到東西了。 */
      { image: `data:image/jpeg;base64,${'A'.repeat(2_500_000)}` },
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
    // v2.129：跟分類一樣走主模型＋備援（預設 deepseek 先、qwen 備援），model 與 models 一起送語意不明，只送陣列
    expect(sent.models).toEqual(['deepseek/deepseek-v4.1-flash', 'qwen/qwen3.7-flash'])
    expect(sent).not.toHaveProperty('model')
    expect(sent.messages[0].content[0].text).toContain('一律讀「每份」那欄')
    expect(sent.messages[0].content[1].image_url.url).toBe(IMAGE)

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(await res.json()).toEqual({
      name: '伯朗奶茶-減糖香濃原味(三合一)',
      basis: 'per_serving', serving_g: 17, kcal: 82, protein_g: 0.4, fat_g: 3.6, carb_g: 12.1,
    })
  })

  it('⑰ 模型把 JSON 包在 ``` 裡也解得開；多出來的欄位不會跟著送給前端', async () => {
    stubUpstream(upstreamReply('```json\n{"name":"某某餅乾","basis":"per_100g","serving_g":null,"kcal":250,"protein_g":8,"fat_g":12,"carb_g":28,"note":"多的"}\n```'))
    const res = await handleRequest(post(await validToken(), { image: IMAGE }), JWKS, OR_KEY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      name: '某某餅乾',
      basis: 'per_100g', serving_g: null, kcal: 250, protein_g: 8, fat_g: 12, carb_g: 28,
    })
  })

  /* 品名是**唯一一個讀不到也不算失敗**的欄位：數字才是難的部分（小字、反光、兩欄並列），
     品名使用者自己打很快，為了它丟掉六個正確的數字是本末倒置。這條鎖住那個取捨。 */
  it('⑳ 品名讀不到／型別不對只留白，不讓整次辨識失敗', async () => {
    const token = await validToken()
    const nums = '"basis":"per_serving","serving_g":17,"kcal":82,"protein_g":0.4,"fat_g":3.6,"carb_g":12.1'
    const cases = [
      `{${nums}}`,                    // 整個欄位沒回
      `{"name":null,${nums}}`,        // 明確填 null
      `{"name":"",${nums}}`,          // 空字串
      `{"name":"   ",${nums}}`,       // 只有空白
      `{"name":123,${nums}}`,         // 型別不對
      `{"name":{"a":1},${nums}}`,     // 型別不對
    ]
    for (const content of cases) {
      stubUpstream(upstreamReply(content))
      const res = await handleRequest(post(token, { image: IMAGE }, SITE), JWKS, OR_KEY)
      expect(res.status, content).toBe(200)
      const body = await res.json()
      expect(body.name, content).toBeNull()
      expect(body.kcal, content).toBe(82)
    }
  })

  it('㉑ 品名前後的空白會被去掉（模型常多回幾個空格）', async () => {
    stubUpstream(upstreamReply('{"name":"  伯朗奶茶  ","basis":"per_serving","serving_g":17,"kcal":82,"protein_g":0.4,"fat_g":3.6,"carb_g":12.1}'))
    const res = await handleRequest(post(await validToken(), { image: IMAGE }), JWKS, OR_KEY)
    expect((await res.json()).name).toBe('伯朗奶茶')
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

/* 分類模式（spec.md C 節「第三版」）：body 帶 foods 時改成純文字分類。驗證閘與辨識共用，
   這裡只驗分類自己的東西：輸入的界、提示詞帶了清單與界線、輸出的收斂。 */
describe('read-label 分類模式', () => {
  const FOODS = [
    { id: 1, name: '叉燒飯', vendor: '燒臘店' },
    { id: 2, name: '乳清', vendor: null },
  ]

  it('㉒ 清單與前端 src/lib/categories.ts 同一份（Edge Function 不能 import src，只能比對）', () => {
    expect(CATEGORIES).toEqual([...FOOD_CATEGORIES])
  })

  it('㉓ 成功：送純文字（沒有圖片）、提示詞帶清單與三條界線與品名店家，回 {results}', async () => {
    const spy = stubUpstream(upstreamReply('{"results":[{"id":1,"category":"燒臘"},{"id":2,"category":"蛋白質補充"}]}'))
    const res = await handleRequest(post(await validToken(), { foods: FOODS }, SITE), JWKS, OR_KEY)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(await res.json()).toEqual({ results: [{ id: 1, category: '燒臘' }, { id: 2, category: '蛋白質補充' }] })

    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OR_KEY}`)
    const sent = JSON.parse(init.body as string)
    // deepseek 先（qwen 一批常逼近 45 秒逾時），出錯或限流才由 OpenRouter 換 qwen；model 與 models 一起送語意不明，只送陣列
    expect(sent.models).toEqual(['deepseek/deepseek-v4.1-flash', 'qwen/qwen3.7-flash'])
    expect(sent).not.toHaveProperty('model')
    const parts = sent.messages[0].content
    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe('text')
    const text: string = parts[0].text
    expect(text).toContain('燒臘、便當、健康餐盒、飯類、麵食、餃類、速食、早餐店、滷味／鹽水雞、鍋物、日式、其他正餐')
    expect(text).toContain('飲料、蛋白質補充、配菜、主食、點心')
    expect(text).toContain('便當＝')
    expect(text).toContain('飯類＝')
    expect(text).toContain('早餐店是一整類')
    expect(text).toContain('健康餐盒＝')
    expect(text).toContain('{"id":1,"name":"叉燒飯","vendor":"燒臘店"}')
    expect(text).toContain('{"id":2,"name":"乳清","vendor":null}')
  })

  it('㉔ 清單外的值一律「其他正餐」；半形斜線當全形；沒問過的 id 丟掉、重複的 id 取第一筆、漏回的不補', async () => {
    const token = await validToken()
    const asked = [...FOODS, { id: 3, name: '鹽水雞', vendor: null }, { id: 4, name: '某某', vendor: null }]
    stubUpstream(upstreamReply(JSON.stringify({
      results: [
        { id: 1, category: '炸物' },
        { id: 2, category: 5 },
        { id: 3, category: ' 滷味/鹽水雞 ' },
        { id: 1, category: '便當' },
        { id: 99, category: '便當' },
        { id: '4', category: '便當' },
      ],
    })))
    const res = await handleRequest(post(token, { foods: asked }), JWKS, OR_KEY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      results: [{ id: 1, category: '其他正餐' }, { id: 2, category: '其他正餐' }, { id: 3, category: '滷味／鹽水雞' }],
    })
  })

  it('㉕ 模型包 ``` 或省掉外層物件也解得開', async () => {
    const token = await validToken()
    for (const content of ['```json\n{"results":[{"id":1,"category":"燒臘"}]}\n```', '[{"id":1,"category":"燒臘"}]']) {
      stubUpstream(upstreamReply(content))
      const res = await handleRequest(post(token, { foods: FOODS }), JWKS, OR_KEY)
      expect(res.status, content).toBe(200)
      expect(await res.json()).toEqual({ results: [{ id: 1, category: '燒臘' }] })
    }
  })

  it('㉖ 輸入不合法 → 400，不外呼', async () => {
    const token = await validToken()
    const bad: unknown[] = [
      [],
      'abc',
      null,
      [{ id: 1.5, name: 'a', vendor: null }],
      [{ id: '1', name: 'a', vendor: null }],
      [{ id: 1, name: '', vendor: null }],
      [{ id: 1, name: '   ', vendor: null }],
      [{ id: 1, name: 3, vendor: null }],
      [{ id: 1, name: 'a' }], // vendor 要明確給 null
      [{ id: 1, name: 'a', vendor: 7 }],
      [{ id: 1, name: 'x'.repeat(101), vendor: null }],
      [{ id: 1, name: 'a', vendor: 'x'.repeat(101) }],
      Array.from({ length: 51 }, (_, i) => ({ id: i, name: 'a', vendor: null })),
      [null],
    ]
    for (const foods of bad) {
      const res = await handleRequest(post(token, { foods }, SITE), JWKS, OR_KEY)
      expect(res.status, JSON.stringify(foods)?.slice(0, 60)).toBe(400)
      expect(await res.json()).toEqual({ error: '請求格式不正確' })
      expect(globalThis.fetch).not.toHaveBeenCalled()
    }
  })

  it('㉗ 上限內最多 50 樣、品名 100 字都收', async () => {
    stubUpstream(upstreamReply('{"results":[]}'))
    const foods = Array.from({ length: 50 }, (_, i) => ({ id: i, name: 'x'.repeat(100), vendor: 'y'.repeat(100) }))
    const res = await handleRequest(post(await validToken(), { foods }), JWKS, OR_KEY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [] })
  })

  it('㉘ 驗證閘在分類模式一樣有效：偽造 token → 401、沒有 key → 500，都不外呼', async () => {
    const forged = await sign(foreignKeys.privateKey, validClaims, { iat: now(), exp: now() + 3600 })
    const res = await handleRequest(post(forged, { foods: FOODS }, SITE), JWKS, OR_KEY)
    expect(res.status).toBe(401)
    const noKey = await handleRequest(post(await validToken(), { foods: FOODS }), JWKS, undefined)
    expect(noKey.status).toBe(500)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('㉙ 模型回的不是 JSON／沒有陣列、上游壞掉 → 502，不轉發上游原文', async () => {
    const token = await validToken()
    const leaky = JSON.stringify({ error: { message: `Invalid API key: ${OR_KEY}` } })
    const cases: (() => void)[] = [
      () => stubUpstream(upstreamReply('看不懂')),
      () => stubUpstream(upstreamReply('{"results":"燒臘"}')),
      () => stubUpstream(upstreamReply('null')),
      () => stubUpstream(leaky, 500),
      () => stubUpstream(JSON.stringify({ choices: [] }), 200),
    ]
    for (const setup of cases) {
      setup()
      const res = await handleRequest(post(token, { foods: FOODS }, SITE), JWKS, OR_KEY)
      expect(res.status).toBe(502)
      const body = await res.json()
      expect(body).toEqual({ error: '辨識失敗' })
      expect(JSON.stringify(body)).not.toContain('sk-or')
    }
  })

  it('㉙b 回覆解析不了時 log 不留原文：模型可能整段回顯品名（使用者的資料）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubUpstream(upstreamReply('以下是分類：叉燒飯 屬於燒臘，乳清 屬於蛋白質補充'))
    const res = await handleRequest(post(await validToken(), { foods: FOODS }, SITE), JWKS, OR_KEY)
    expect(res.status).toBe(502)
    const logged = spy.mock.calls.flat().join(' ')
    expect(logged).toContain('classify-unparseable')
    expect(logged).not.toContain('叉燒飯')
    expect(logged).not.toContain('乳清')
    spy.mockRestore()
  })

  it('㉚ 帶 foods 就走分類，不看 image（同時帶也一樣，不會把圖送出去）', async () => {
    const spy = stubUpstream(upstreamReply('{"results":[{"id":1,"category":"燒臘"}]}'))
    const res = await handleRequest(post(await validToken(), { foods: FOODS, image: IMAGE }), JWKS, OR_KEY)
    expect(res.status).toBe(200)
    const sent = JSON.parse((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(JSON.stringify(sent)).not.toContain('image_url')
  })
})

/* 全站 AI 統一（v2.128，使用者 2026-11-11）：一份 AI_MODELS（主模型＋備援），請求可帶 model 指定主模型。
   辨識只用讀得了圖的模型（VISION_MODELS）。 */
describe('read-label 模型設定（全站統一）', () => {
  const FOODS = [{ id: 1, name: '叉燒飯', vendor: '燒臘店' }]
  const DS = 'deepseek/deepseek-v4.1-flash'
  const QW = 'qwen/qwen3.7-flash'
  const sentBody = (spy: ReturnType<typeof stubUpstream>) => JSON.parse((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)

  it('㉛ 白名單與讀圖清單跟前端 src/lib/aiModels.ts 同一份（Edge Function 不能 import src，只能比對）', () => {
    expect([...AI_MODELS]).toEqual(front.AI_MODELS.map((m) => m.id))
    expect([...VISION_MODELS]).toEqual([...front.VISION_MODELS])
    expect(front.DEFAULT_AI_MODEL).toBe(AI_MODELS[0])
  })

  it('㉛b 白名單與讀圖清單一定有交集——沒有的話辨識會變成沒指定模型（函式那端也會直接回 500，不外呼）', () => {
    expect(AI_MODELS.some((m) => VISION_MODELS.includes(m))).toBe(true)
  })

  it('㉜ 分類：指定的主模型排第一、另一個當備援；沒指定或白名單外照預設順序（不 400）', async () => {
    const cases: [unknown, string[]][] = [
      [QW, [QW, DS]],
      [DS, [DS, QW]],
      [undefined, [DS, QW]],
      ['openai/gpt-9-ultra', [DS, QW]],
      [42, [DS, QW]],
    ]
    for (const [model, chain] of cases) {
      const spy = stubUpstream(upstreamReply('{"results":[{"id":1,"category":"燒臘"}]}'))
      const res = await handleRequest(post(await validToken(), { foods: FOODS, model }), JWKS, OR_KEY)
      expect(res.status).toBe(200)
      expect(sentBody(spy).models, String(model)).toEqual(chain)
    }
  })

  it('㉝ 辨識：跟分類同一串（指定的主模型第一、另一個備援）；兩個都讀得了圖', async () => {
    const cases: [unknown, string[]][] = [
      [QW, [QW, DS]],
      [DS, [DS, QW]],
      [undefined, [DS, QW]],
      ['openai/gpt-9-ultra', [DS, QW]],
    ]
    for (const [model, chain] of cases) {
      const spy = stubUpstream(upstreamReply(GOOD_READING))
      const res = await handleRequest(post(await validToken(), { image: IMAGE, model }), JWKS, OR_KEY)
      expect(res.status).toBe(200)
      const sent = sentBody(spy)
      expect(sent.models, String(model)).toEqual(chain)
      expect(sent).not.toHaveProperty('model')
    }
  })
})

/* 額度模式（v2.128，設定頁的 AI 額度）：body `{credits:true}`，代查 OpenRouter 的 credits 與 key 兩個端點。 */
describe('read-label 額度模式', () => {
  /** 依網址回不同的假上游；回傳 spy。 */
  function stubCredits(credits: unknown, key: unknown, status = 200) {
    const spy = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith('/credits') ? credits : key), { status }),
    )
    globalThis.fetch = spy as unknown as typeof fetch
    return spy
  }

  it('㉞ 成功：打 credits 與 key 兩個端點（key 只在 header），只回數字欄位，label 等其他欄位不轉發', async () => {
    const spy = stubCredits(
      { data: { total_credits: 10, total_usage: 2.5 } },
      { data: { label: `sk-or-v1-abc…${OR_KEY.slice(-4)}`, usage_daily: 0.01, usage_monthly: 0.3, limit_remaining: null, is_free_tier: false } },
    )
    const res = await handleRequest(post(await validToken(), { credits: true }, SITE), JWKS, OR_KEY)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    const body = await res.json()
    expect(body).toEqual({ total_credits: 10, total_usage: 2.5, usage_daily: 0.01, usage_monthly: 0.3, limit_remaining: null })
    expect(JSON.stringify(body)).not.toContain('sk-or')

    const urls = spy.mock.calls.map((c) => (c as unknown as [string])[0]).sort()
    expect(urls).toEqual(['https://openrouter.ai/api/v1/credits', 'https://openrouter.ai/api/v1/key'])
    for (const c of spy.mock.calls) {
      const init = (c as unknown as [string, RequestInit])[1]
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OR_KEY}`)
      expect(init.method ?? 'GET').toBe('GET')
    }
  })

  it('㉞b 只有一個端點壞了：另一邊的數字照給、壞的那邊是 null；兩邊都壞才 502', async () => {
    const spy = vi.fn(async (url: string) =>
      url.endsWith('/credits')
        ? new Response('forbidden', { status: 403 })
        : new Response(JSON.stringify({ data: { usage_daily: 0.01, usage_monthly: 0.3, limit_remaining: 5 } }), { status: 200 }),
    )
    globalThis.fetch = spy as unknown as typeof fetch
    const res = await handleRequest(post(await validToken(), { credits: true }), JWKS, OR_KEY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ total_credits: null, total_usage: null, usage_daily: 0.01, usage_monthly: 0.3, limit_remaining: 5 })
  })

  it('㉟ 上游欄位不是數字（字串、NaN、缺）→ null，不把怪值交給前端', async () => {
    stubCredits({ data: { total_credits: '10', total_usage: null } }, { data: {} })
    const res = await handleRequest(post(await validToken(), { credits: true }), JWKS, OR_KEY)
    expect(await res.json()).toEqual({ total_credits: null, total_usage: null, usage_daily: null, usage_monthly: null, limit_remaining: null })
  })

  it('㊱ 上游壞掉 → 502 {error}，不含金鑰與上游原文；驗證閘一樣有效（偽造 token 401、沒 key 500，都不外呼）', async () => {
    const token = await validToken()
    const leaky = { error: { message: `Invalid API key: ${OR_KEY}` } }
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const setup of [
      () => stubCredits(leaky, leaky, 401),
      () => stubCredits('<html>', '<html>', 500),
      // 200 但不是 JSON：兩邊都解析失敗＝兩邊都壞（stubCredits 會先 JSON 編碼，這裡要回原始文字）
      () => {
        globalThis.fetch = vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 200 })) as unknown as typeof fetch
      },
      () => {
        globalThis.fetch = vi.fn(() => {
          throw new Error(`fetch failed: Bearer ${OR_KEY}`)
        }) as unknown as typeof fetch
      },
    ]) {
      setup()
      const res = await handleRequest(post(token, { credits: true }), JWKS, OR_KEY)
      expect(res.status).toBe(502)
      const text = JSON.stringify(await res.json())
      expect(text).not.toContain(OR_KEY)
      expect(text).not.toContain('Invalid API key')
    }
    // log 也不能有 key：丟出來的錯誤訊息夾著 key，進 log 前要遮掉（security review L2）
    expect(JSON.stringify(logs.mock.calls)).not.toContain(OR_KEY)
    expect(JSON.stringify(logs.mock.calls)).toContain('[redacted]')
    logs.mockRestore()

    globalThis.fetch = vi.fn(() => {
      throw new Error('測試中不得有任何對外呼叫')
    }) as unknown as typeof fetch
    const forged = await sign(foreignKeys.privateKey, validClaims, { iat: now(), exp: now() + 3600 })
    expect((await handleRequest(post(forged, { credits: true }), JWKS, OR_KEY)).status).toBe(401)
    expect((await handleRequest(post(token, { credits: true }), JWKS, undefined)).status).toBe(500)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('㊲ credits 不是 true（字串、1）不算額度查詢：照原本的辨識路徑驗 body', async () => {
    for (const credits of ['true', 1]) {
      const res = await handleRequest(post(await validToken(), { credits }), JWKS, OR_KEY)
      expect(res.status).toBe(400)
    }
  })
})
