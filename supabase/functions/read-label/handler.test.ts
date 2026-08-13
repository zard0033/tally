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

function post(token?: string): Request {
  return new Request('https://example.test/read-label', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

/* 「不呼叫外部服務」用機器證明，不靠讀 code 宣稱：任何路徑只要碰 fetch 就炸。 */
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
    const res = await handleRequest(post(), JWKS)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未授權' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('② 亂寫的 token → 401', async () => {
    // 亂寫的 token 只能是 ASCII：HTTP header 是 ByteString，塞中文根本組不出 Request（實測撞到）。
    const res = await handleRequest(post('not.a.valid.jwt'), JWKS)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未授權' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('③ 過期的 token（同一把有效 key 簽，只有 exp 不同）→ 401', async () => {
    const expired = await sign(projectKeys.privateKey, validClaims, { iat: now() - 7200, exp: now() - 3600 })
    const res = await handleRequest(post(expired), JWKS)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未授權' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('④ 別的 key 簽出來的合法格式 token → 401（簽章驗證真的有在做）', async () => {
    const forged = await sign(foreignKeys.privateKey, validClaims, { iat: now(), exp: now() + 3600 })
    const res = await handleRequest(post(forged), JWKS)
    expect(res.status).toBe(401)
  })

  it('⑤ 沒有 sub 的 token → 401（不是某個使用者就不放行）', async () => {
    const noSub = await sign(projectKeys.privateKey, { aud: 'authenticated', role: 'anon' }, { iat: now(), exp: now() + 3600 })
    const res = await handleRequest(post(noSub), JWKS)
    expect(res.status).toBe(401)
  })

  it('⑥ 有效 token → 200 且回固定形狀的 stub', async () => {
    const valid = await sign(projectKeys.privateKey, validClaims, { iat: now(), exp: now() + 3600 })
    const res = await handleRequest(post(valid), JWKS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(
      ['basis', 'carb_g', 'fat_g', 'kcal', 'protein_g', 'serving_g'],
    )
    expect(body.basis).toBe('per_serving')
    expect(typeof body.kcal).toBe('number')
    // 這一輪不接外部服務：連成功路徑都不該碰 fetch。
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('⑦ SUPABASE_JWKS 缺／壞 → 500 而不是 401（讓 401 只剩驗證失敗一個成因）', async () => {
    const valid = await sign(projectKeys.privateKey, validClaims, { iat: now(), exp: now() + 3600 })
    const missing = await handleRequest(post(valid), undefined)
    expect(missing.status).toBe(500)
    expect(await missing.json()).toEqual({ error: '服務設定不完整' })

    const broken = await handleRequest(post(valid), '{ 不是 JSON')
    expect(broken.status).toBe(500)
  })

  it('⑧ 錯誤回應只有一個 error 欄位，不夾帶 stack／環境變數內容', async () => {
    const res = await handleRequest(post('broken-token'), JWKS)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['error'])
    const text = JSON.stringify(body)
    expect(text).not.toContain('at ')
    expect(text).not.toContain(JWKS.slice(0, 20))
  })
})
