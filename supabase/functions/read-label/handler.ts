/* read-label 的安全外殼：這一輪**只做身分驗證**，不接任何外部服務、不處理圖片。
   存在的理由是 spec.md「安全（不可妥協）」——repo 是 public，辨識用的 API key 不能進前端 bundle，
   所以必須有一層「先確認呼叫者是誰、再動作」的後端代理。這裡先把「先確認」那半交付並測綠，
   下一輪才在 200 那條路的末端接上辨識。

   handler 與 index.ts 分開的唯一理由是可測試性：index.ts 碰 Deno 專屬 API（Deno.serve／Deno.env），
   本機沒有 Deno 也沒有 Docker 跑 `supabase functions serve`，把純邏輯留在這裡才驗得動
   （測試在同目錄 handler.test.ts，跟著專案既有的 `npx vitest run` 跑）。
   **本檔不得出現任何 Deno 專屬 API**，環境變數由 index.ts 讀好了傳進來。

   jose 用裸 specifier 匯入：Deno 那邊靠同目錄 deno.json 的 import map 對到 npm:jose，
   Node/vitest 那邊直接解析 node_modules——同一份原始碼兩個 runtime 都吃得下，不必為測試另開一份。
   選 jose 而不自己拆 JWT：簽章驗證、alg 混淆、exp 判讀這些密碼學細節有成熟實作就不手刻。 */
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'

/** 成功回傳的固定形狀（spec.md AC4）。這一輪值是假資料，接上辨識後由模型輸出填。 */
export interface LabelReading {
  basis: 'per_serving' | 'per_100g'
  serving_g: number | null
  kcal: number
  protein_g: number
  fat_g: number
  carb_g: number
}

/** 佔位讀數：驗證通過後回它，證明 200 這條路通了。下一輪換成真實辨識結果。 */
const STUB_READING: LabelReading = {
  basis: 'per_serving',
  serving_g: 100,
  kcal: 250,
  protein_g: 8,
  fat_g: 12,
  carb_g: 28,
}

/* 錯誤訊息一律是這幾句固定字串：不回 stack trace、不回環境變數內容、不回上游原始錯誤（AC4）。
   三種驗證失敗（沒帶 header／亂寫／過期）刻意回同一句——對呼叫端而言「為什麼不過」沒有正當用途，
   要區分是測試的事（同一把 key、只換 token 做差分），不是回應的事。 */
const UNAUTHORIZED = '未授權'
const MISCONFIGURED = '服務設定不完整'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * 驗證呼叫者的 Supabase user JWT，通過才回 stub 讀數。
 *
 * @param jwksJson Edge Function 執行環境預設就帶的 `SUPABASE_JWKS`（公鑰集，非祕密）。
 *                 用它在本機驗、不打 jwks.json 端點、也不碰 service_role——這支函式不需要那把 key，
 *                 多帶一把祕密只是把爆炸半徑做大。
 */
export async function handleRequest(req: Request, jwksJson: string | undefined): Promise<Response> {
  /* 1. 設定不全就 fail closed，而且**回 500 不回 401**：401 必須只有一個成因（驗證失敗），
        否則「缺環境變數也碰巧回 401」會讓那三條測試變成假綠。 */
  let keySet: ReturnType<typeof createLocalJWKSet>
  try {
    if (!jwksJson) throw new Error('SUPABASE_JWKS 未設定')
    keySet = createLocalJWKSet(JSON.parse(jwksJson) as JSONWebKeySet)
  } catch {
    return json({ error: MISCONFIGURED }, 500)
  }

  // 2. 取 Bearer token。scheme 名稱依 RFC 7235 大小寫不敏感，token 本身當然敏感。
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')
  if (!match) return json({ error: UNAUTHORIZED }, 401)
  const token = match[1]

  // 3. 驗簽章與 claim。這一步之前、以及失敗的所有路徑，都沒有任何對外呼叫。
  try {
    const { payload } = await jwtVerify(token, keySet, {
      /* 白名單演算法：JWKS 裡是非對稱公鑰，本來就擋得掉 HS256 那類 alg 混淆，
         明列一次是不倚賴函式庫的隱含行為。Supabase 的 JWT signing key 目前是 ES256／RS256。 */
      algorithms: ['ES256', 'RS256'],
      // Supabase 已登入使用者的 token 固定 aud=authenticated；擋掉非使用者身分的專案 token。
      audience: 'authenticated',
    })
    // sub＝使用者 id。沒有 sub 的 token 不是「某個使用者」，一律不放行。
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      return json({ error: UNAUTHORIZED }, 401)
    }
  } catch {
    // 簽章錯、kid 找不到、過期、aud 不符，全部收斂成同一個 401，不往外洩漏是哪一種。
    return json({ error: UNAUTHORIZED }, 401)
  }

  // 4. 驗過才動作。下一輪接辨識時，新增的程式碼只會長在這一行以下。
  return json(STUB_READING, 200)
}
