/* read-label 的安全外殼：先確認呼叫者是誰，通過了才把圖片轉給 OpenRouter 讀營養標示。
   存在的理由是 spec.md「安全（不可妥協）」——repo 是 public，辨識用的 API key 不能進前端 bundle，
   所以必須有一層「先確認呼叫者是誰、再動作」的後端代理。金鑰只活在這一層，
   而且**永遠不出現在任何回應裡**：上游的錯誤原文一律不轉發，只回固定字串。

   handler 與 index.ts 分開的唯一理由是可測試性：index.ts 碰 Deno 專屬 API（Deno.serve／Deno.env），
   本機沒有 Deno 也沒有 Docker 跑 `supabase functions serve`，把純邏輯留在這裡才驗得動
   （測試在同目錄 handler.test.ts，跟著專案既有的 `npx vitest run` 跑）。
   **本檔不得出現任何 Deno 專屬 API**，環境變數由 index.ts 讀好了傳進來。

   jose 用裸 specifier 匯入：Deno 那邊靠同目錄 deno.json 的 import map 對到 npm:jose，
   Node/vitest 那邊直接解析 node_modules——同一份原始碼兩個 runtime 都吃得下，不必為測試另開一份。
   選 jose 而不自己拆 JWT：簽章驗證、alg 混淆、exp 判讀這些密碼學細節有成熟實作就不手刻。 */
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'

/** 成功回傳的固定形狀（spec.md AC4）。值由模型輸出填，逐欄驗過才組出來。 */
export interface LabelReading {
  /** 包裝上的正式完整品名。**讀不到是 null，不是失敗**——理由見 parseReading。 */
  name: string | null
  basis: 'per_serving' | 'per_100g'
  serving_g: number | null
  kcal: number
  protein_g: number
  fat_g: number
  carb_g: number
}

/* CORS 白名單：正式站與本機 dev server（5500 綁死 OAuth 白名單，不可換）。
   **不用 `*`**——這支函式會拿使用者的 token 做事，放任何 origin 帶著 credential 打進來沒有正當用途。
   回應裡填的是這個陣列裡的常數，不是請求帶來的 Origin 字串。 */
const ALLOWED_ORIGINS = ['https://zard0033.github.io', 'http://localhost:5500']

/* OpenRouter 的 OpenAI 相容端點。模型與提示詞照抄 dev-flow 校準階段實測通過的那份，
   兩條不可省的規則寫在提示詞裡：兩欄並列時一律讀「每份」、serving_g 沒印就填 null 不回推。 */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'qwen/qwen3.7-flash'
const PROMPT = `這是一張台灣包裝食品的營養標示照片。只回一個 JSON 物件，不要任何其他文字：
{"name":"字串或null","basis":"per_serving 或 per_100g","serving_g":數字或null,"kcal":數字,"protein_g":數字,"fat_g":數字,"carb_g":數字}
name 填包裝上的**正式完整品名**（通常標在成分欄前面的「品名:」後面，例如「伯朗奶茶-減糖香濃原味(三合一)」），
不要只填商標大字。同一品牌常有多種口味，只填品牌名會讓不同營養的品項變成同名。找不到就填 null。
標示同時有「每份」與「每100公克」兩欄時，一律讀「每份」那欄，basis 填 per_serving。
serving_g 只填標示上明寫的每份公克數，沒印就填 null，不要用兩欄比值回推。
看不清楚的欄位填 null，不要猜。`

/* 圖片上限。**必須有界**——理由不是省流量，是不替人把任意大的東西轉發給上游。

   數字的由來要講清楚，因為第一版錯得很典型：原本設 700_000，是拿**本機 Pillow 壓同一張照片**
   得到的 244,667 字元推的。上線第一天就撞牆——真機的 **iOS Safari canvas 吐出 752,775 字元**
   （同樣 1200px、同樣 q0.85、同樣是合法 JPEG），瀏覽器的編碼器沒有 Pillow 的 optimize，
   同樣的像素大三倍。**教訓是方法不是數字：拿 A 工具的量測去設 B 工具的門檻。**

   重設的時候沒有再拿某張照片來推——那正是上一版錯的形狀。改成量**這個格式的上界**：
   前端一律先壓到最長邊 1200px、q0.85 才送，所以合法的裝載不可能超過「1200×1200 的 q0.85 JPEG
   最大能有多大」。用專案既有的 WebKit（跟 iOS Safari 同一家引擎，不是 Pillow）實跑 toDataURL：

     1200×1200 純亂數（JPEG 壓不動雜訊＝理論最壞）  1,368,887
     1200×1200 密集小字（營養標示的內容型態）          554,907
     真機那張照片（對照組）                            752,775

   亂數那條是任何真實照片都到不了的天花板。取 2_000_000（約 1.5MB）＝上界再 1.46 倍——
   餘裕留給「我這台的 WebKit 終究不是 iPhone 上那份編碼器」，不是留給沒想清楚。
   **加大不影響辨識成本**：token 由像素數決定，位元組數完全不進 token 公式（spec AC2 那段）。 */
const MAX_IMAGE_CHARS = 2_000_000
/** 只收 data: 開頭的 base64 影像——**絕不接受 http(s) URL**，否則這支函式就成了替人打任意網址的代理。 */
const IMAGE_DATA_URI = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/* 錯誤訊息一律是這幾句固定字串：不回 stack trace、不回環境變數內容、不回上游原始錯誤（AC4）。
   三種驗證失敗（沒帶 header／亂寫／過期）刻意回同一句——對呼叫端而言「為什麼不過」沒有正當用途，
   要區分是測試的事（同一把 key、只換 token 做差分），不是回應的事。 */
const UNAUTHORIZED = '未授權'
const MISCONFIGURED = '服務設定不完整'
const METHOD_NOT_ALLOWED = '只接受 POST'
const BAD_REQUEST = '請求格式不正確'
/** 上游壞掉、逾時、回的東西讀不出讀數，全部收斂成這一句：前端只需要知道「失敗了，改手打」。 */
const READ_FAILED = '辨識失敗'

/**
 * 取這次請求該回的 CORS header。origin 不在白名單就不給 `Access-Control-Allow-Origin`
 * （瀏覽器那端等同拒絕），但仍帶 `Vary: Origin` 免得中間層把某個 origin 的回應快取給另一個。
 */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  const allowed = ALLOWED_ORIGINS.find((o) => o === origin)
  return allowed ? { Vary: 'Origin', 'Access-Control-Allow-Origin': allowed } : { Vary: 'Origin' }
}

/* 診斷 log。**只寫進 Supabase 的函式 log（後台才看得到），永遠不進回應**——當初 spec
   砍掉的是「回傳給呼叫端的錯誤細節」，不是「伺服器自己留線索」。第一次上線除錯時發現
   沒有這個等於把眼睛蒙起來：前端把所有失敗收斂成同一句，而 Supabase 預設的 log 只有
   boot/shutdown，看不出函式回了什麼。**永遠不要把 openrouterKey 或完整 token 放進來。** */
function diag(tag: string, extra?: Record<string, unknown>): void {
  console.error(`[read-label] ${tag}`, extra ? JSON.stringify(extra) : '')
}

function json(body: unknown, status: number, extra: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  })
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * 把模型回的文字解成讀數。**半殘的物件一律當失敗**（AC4）——寧可讓使用者手打，
 * 不要把缺一半的數字交給前端，那比沒有更糟（提示詞本身也會叫模型讀不到就填 null）。
 */
function parseReading(content: string): LabelReading | null {
  // 模型有時會用 ```json 把 JSON 包起來（校準階段實測），剝掉再解。
  const text = content.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim()
  let got: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    got = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const { name, basis, serving_g, kcal, protein_g, fat_g, carb_g } = got
  if (basis !== 'per_serving' && basis !== 'per_100g') return null
  if (!(serving_g === null || isNum(serving_g))) return null
  if (!isNum(kcal) || !isNum(protein_g) || !isNum(fat_g) || !isNum(carb_g)) return null
  /* name 讀不到只是留白，**不讓整次辨識失敗**：數字才是難的部分（小字、反光、兩欄並列），
     品名使用者自己打很快。為了一個空欄位丟掉六個正確的數字是本末倒置。
     型別不對（模型回了數字或物件）也一律當沒讀到，而不是 return null 整組作廢。 */
  const trimmed = typeof name === 'string' ? name.trim() : ''
  // 逐欄重建，不把模型回的物件原樣往前端送——多出來的欄位沒有理由跟著出去。
  return { name: trimmed || null, basis, serving_g, kcal, protein_g, fat_g, carb_g }
}

/**
 * 驗證呼叫者的 Supabase user JWT，通過才把圖片送去辨識。
 *
 * @param jwksJson Edge Function 執行環境預設就帶的 `SUPABASE_JWKS`（公鑰集，非祕密）。
 *                 用它在本機驗、不打 jwks.json 端點、也不碰 service_role——這支函式不需要那把 key，
 *                 多帶一把祕密只是把爆炸半徑做大。
 * @param openrouterKey `OPENROUTER_API_KEY`（祕密）。只用在對 OpenRouter 的 Authorization header，
 *                      不進回應、不進錯誤訊息。
 */
export async function handleRequest(
  req: Request,
  jwksJson: string | undefined,
  openrouterKey: string | undefined,
): Promise<Response> {
  const cors = corsHeaders(req)

  /* 0. preflight 走在驗證之前——瀏覽器送 OPTIONS 時**不會**帶 Authorization，
        擋在這裡等於整個跨網域呼叫都不通。preflight 不做任何事、也不透露任何東西。 */
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        // Supabase 標準那組：走 supabase-js 的 functions.invoke() 會多送 apikey／x-client-info。
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  // 1. 只收 POST。圖片在 body 裡，任何其他 method 都沒有正當用途（帶著有效 token 也一樣）。
  if (req.method !== 'POST') {
    return json({ error: METHOD_NOT_ALLOWED }, 405, { ...cors, Allow: 'POST, OPTIONS' })
  }

  /* 2. 設定不全就 fail closed，而且**回 500 不回 401**：401 必須只有一個成因（驗證失敗），
        否則「缺環境變數也碰巧回 401」會讓那三條測試變成假綠。 */
  let keySet: ReturnType<typeof createLocalJWKSet>
  try {
    if (!jwksJson) throw new Error('SUPABASE_JWKS 未設定')
    keySet = createLocalJWKSet(JSON.parse(jwksJson) as JSONWebKeySet)
  } catch {
    return json({ error: MISCONFIGURED }, 500, cors)
  }

  // 3. 取 Bearer token。scheme 名稱依 RFC 7235 大小寫不敏感，token 本身當然敏感。
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')
  if (!match) {
    diag('401 no-bearer', { hasAuthHeader: req.headers.has('Authorization') })
    return json({ error: UNAUTHORIZED }, 401, cors)
  }
  const token = match[1]

  // 4. 驗簽章與 claim。這一步之前、以及失敗的所有路徑，都沒有任何對外呼叫。
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
      diag('401 no-sub')
      return json({ error: UNAUTHORIZED }, 401, cors)
    }
  } catch (e) {
    diag('401 verify-failed', { reason: e instanceof Error ? e.message : String(e) })
    // 簽章錯、kid 找不到、過期、aud 不符，全部收斂成同一個 401，不往外洩漏是哪一種。
    return json({ error: UNAUTHORIZED }, 401, cors)
  }

  /* 5. 驗過才碰祕密。key 的檢查刻意排在驗證之後：沒通過驗證的人不該從回應分辨出服務有沒有設好，
        401 也才維持只有「驗證失敗」一個成因。 */
  if (!openrouterKey) return json({ error: MISCONFIGURED }, 500, cors)

  // 6. 取圖。只認前端那個形狀的 data URI，其餘一律 400——這是不當轉發任意網址的那道閘。
  let image: unknown
  try {
    image = ((await req.json()) as { image?: unknown }).image
  } catch (e) {
    // 這條原本沒加診斷，害得第一次上線除錯時「log 是空的」也是一種可能，等於白跑一趟
    diag('400 body-not-json', {
      reason: e instanceof Error ? e.message : String(e),
      contentType: req.headers.get('Content-Type'),
    })
    return json({ error: BAD_REQUEST }, 400, cors)
  }
  if (typeof image !== 'string' || image.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URI.test(image)) {
    diag('400 bad-image', {
      type: typeof image,
      len: typeof image === 'string' ? image.length : null,
      head: typeof image === 'string' ? image.slice(0, 40) : null,
    })
    return json({ error: BAD_REQUEST }, 400, cors)
  }

  /* 7. 辨識。不重試、不換模型、不降級（spec.md「明確不做」有列理由）——失敗的路已經存在且免費：
        前端讓使用者手打。上游的任何原文（含 error message、stack）都不轉發，一律收斂成 READ_FAILED。 */
  let content: string
  let usage: string | undefined
  const t0 = Date.now()
  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        /* **不要加 `provider` 路由參數**（2026-08-13 查證後撤掉）：這個模型在 OpenRouter 上
           只有阿里巴巴一家在供（`/api/v1/models/qwen/qwen3.7-flash/endpoints` 回 1 筆），
           `sort: 'throughput'` 沒有第二家可選、是空話；而 `data_collection: 'deny'` 更危險
           ——唯一那家若不符合就沒有 provider 可用，等於把功能關掉。
           **「照片不被拿去訓練」這個保證在哪裡**：OpenRouter 帳號的 Privacy 設定（付費／免費各一個
           開關），關掉之後它本來就不會把請求路由給會訓練的 provider，不必在每個請求裡再講一次。
           **動那個設定要立刻測一張**——只有一家 provider，被那個設定擋掉就是全滅、沒有備援。
           推論：耗時的波動（同圖 12.9／22.4 秒）是那一家自己的排隊，這邊沒有旋鈕可轉。 */
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
      /* 逾時不是重試：只是不讓一個掛住的上游把這支函式一起拖住。
         **這個數字必須比前端的 `SCAN_TIMEOUT`（55 秒）小，而且要小得夠多**（前端的計時含上傳，
         這裡的不含）——誰先放棄，誰就決定失敗留不留得下
         紀錄：函式先放棄會走下面的 catch 寫一行 diag，前端先放棄則連 `edge_logs` 都不會有那一列
         （那列是回應送出時才寫的）。2026-08-13 追一次真機「辨識失敗」追了大半天，就是因為前端
         15 秒先切，函式這邊從頭到尾安靜。45 秒對實測 13–22 秒是兩倍餘裕。 */
      signal: AbortSignal.timeout(45_000),
    })
    if (!upstream.ok) {
      diag('502 upstream-not-ok', { status: upstream.status, body: (await upstream.text()).slice(0, 300) })
      return json({ error: READ_FAILED }, 502, cors)
    }
    const data = (await upstream.json()) as {
      choices?: { message?: { content?: unknown } }[]
      /** OpenRouter 的用量回報。只進 log，不進回應——用途見下方 `200 ok` 那行的註解。 */
      usage?: unknown
    }
    /* 先字串化再截斷，**不整包透傳**：這個物件的形狀由上游決定（型別是 `unknown` 不是我們定的），
       今天只有 token 計數，哪天上游在裡面多塞了請求回顯，就會不聲不響地多留一份在 log 裡。
       截斷保住診斷價值（要看的數字都在前面），同時把「形狀漂移」的爆炸半徑封在 200 字內。 */
    usage = JSON.stringify(data.usage ?? null).slice(0, 200)
    const raw = data.choices?.[0]?.message?.content
    if (typeof raw !== 'string') {
      diag('502 no-content', { shape: Object.keys(data) })
      return json({ error: READ_FAILED }, 502, cors)
    }
    content = raw
  } catch (e) {
    // 連不上、逾時、回的不是 JSON。catch 到的 error 可能夾帶請求內容甚至 header，絕不進回應。
    diag('502 fetch-threw', { reason: e instanceof Error ? e.message : String(e) })
    return json({ error: READ_FAILED }, 502, cors)
  }

  const reading = parseReading(content)
  if (!reading) {
    diag('502 unparseable', { content: content.slice(0, 300) })
    return json({ error: READ_FAILED }, 502, cors)
  }
  /* **成功路徑也要留一行**。原本只有失敗分支寫 log，於是「函式好好跑完、前端已經放棄」
     這種情況長得跟「什麼都沒發生」一模一樣——2026-08-13 那次就是這樣查了大半天。
     記兩件事：**耗時**是訂前後端逾時的唯一依據（要照最壞情況訂，所以需要一段時間的分布）；
     **用量**是為了回答「那十幾秒花在哪」——這是個 reasoning 模型，預設會思考，
     `usage.completion_tokens_details.reasoning_tokens` 直接顯示思考佔了多少，
     決定要不要送 `reasoning: { enabled: false }`（會影響準確度，要有數字才動）。
     **不記讀數內容**，那是使用者的資料，診斷用不到。 */
  diag('200 ok', { ms: Date.now() - t0, usage })
  return json(reading, 200, cors)
}
