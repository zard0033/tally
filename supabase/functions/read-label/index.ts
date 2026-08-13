/* Edge Function 進入點。只做兩件事：讀環境變數、把請求交給 handler。
   邏輯全在 handler.ts（本機沒有 Deno／Docker，可測試的那半必須不碰 Deno API，理由寫在該檔開頭）。

   SUPABASE_JWKS 是 Edge Function 執行環境預設就帶的變數，內容等同
   `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`——公鑰集，不是祕密，
   用它在本機驗即可，不必打那個 URL，更不必動用 service_role。 */
import { handleRequest } from './handler.ts'

Deno.serve((req) => handleRequest(req, Deno.env.get('SUPABASE_JWKS')))
