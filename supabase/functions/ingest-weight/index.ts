/* Edge Function 進入點。只做三件事：讀環境變數、組出「寫庫」動作、把請求交給 handler。
   邏輯全在 handler.ts（本機沒有 Deno／Docker，可測試的那半必須不碰 Deno API）。

   環境變數兩類：
   - 自己設的祕密（Dashboard → Edge Functions → Secrets，名稱不能以 SUPABASE_ 開頭）：
     INGEST_TOKEN（捷徑帶的共用祕密，≥32 字元）、OWNER_USER_ID（寫入列的 user_id）。
   - Supabase 預設注入：SUPABASE_URL、SUPABASE_SECRET_KEYS（secret key 的 JSON 字典）。
     用它寫庫、不另設 DB 密碼。這把 key 繞過 RLS，所以它**只在這個檔案裡**，
     handler 看不到它，函式也只對 `weight` 這一張表做 upsert。 */
import { handleRequest, type WeightRow } from './handler.ts'

/** 台北時區（UTC+8，無日光節約）的今天，YYYY-MM-DD。 */
function taipeiToday(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
}

/**
 * SUPABASE_SECRET_KEYS 是 `{名稱: "sb_secret_…"}` 的 JSON 字典。優先取名為 default 的，
 * 其次任一把字串值；都沒有才退回舊制的 SUPABASE_SERVICE_ROLE_KEY。
 * （字典的確切形狀以文件為準——這裡寫得寬鬆，是不押注只有 default 這一把。）
 */
function secretKey(): string | undefined {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (raw) {
    try {
      const dict = JSON.parse(raw) as Record<string, unknown>
      const pick = typeof dict.default === 'string' ? dict.default : Object.values(dict).find((v) => typeof v === 'string')
      if (typeof pick === 'string' && pick) return pick
    } catch {
      // 字典壞掉就往下退回舊 key，不在這裡 throw——讓缺 key 的錯誤統一從 upsertWeights 出去
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
}

/**
 * 寫 `weight`。**有體脂與沒體脂的列分開送**：沒體脂的列要省略 body_fat_pct 這個 key，
 * merge-duplicates 才不會把同一天已有的體脂值洗成 null。兩次請求不是原子的——
 * 部分失敗時留下的是「較舊但合法」的資料，重送同一份就補齊（冪等）。
 */
async function upsertWeights(rows: WeightRow[]): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = secretKey()
  if (!url || !key) throw new Error('SUPABASE_URL 或 secret key 未注入')

  const headers: Record<string, string> = {
    apikey: key,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  }
  // sb_secret_ 不是 JWT，只放 apikey；舊制 service_role 是 JWT，兩個 header 都帶。
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`

  const withBodyFat = rows.filter((r) => r.body_fat_pct !== null)
  const withoutBodyFat = rows
    .filter((r) => r.body_fat_pct === null)
    .map(({ body_fat_pct: _omit, ...rest }) => rest)

  for (const batch of [withBodyFat, withoutBodyFat]) {
    if (batch.length === 0) continue
    const res = await fetch(`${url}/rest/v1/weight?on_conflict=user_id,measured_on`, {
      method: 'POST',
      headers,
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`weight upsert HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

Deno.serve((req) =>
  handleRequest(req, {
    token: Deno.env.get('INGEST_TOKEN'),
    ownerId: Deno.env.get('OWNER_USER_ID'),
    today: taipeiToday(),
    upsert: upsertWeights,
  }),
)
