/* 「已經預填過整份目錄（150 個動作）」的帳號 fixture。
   動作示意圖、著作權標示那一批測試只需要「動作庫裡有 150 個動作」當前置條件；走真的預填要把 150 筆 insert 排進佇列、
   逐筆上傳，每條測試光這段就約 15 秒（整套 e2e 約十二條，加起來近 200 秒）。直接給整份目錄，載入完就不需要補、不會寫。
   **預填本身的行為由 training.spec 的「第一次開、伺服器上沒有任何動作」與「已經有 16 個預設動作的既有帳號」兩條守**，
   那兩條仍走真的預填，不用這份 fixture。
   這裡是整個 e2e 唯一從 src 匯入的地方：列 id 是 userId＋key 的 uuid v5，手抄 150 列會與目錄脫鉤；
   用 catalogInsertOps 算出來的就是 App 預填時會送的那 150 列（payload 相同）。 */
import { catalogInsertOps } from '../src/lib/exerciseCatalog'
import { FIX, USER_ID } from './fixtures'

export const SEEDED_FIX: typeof FIX = {
  ...FIX,
  exercises: catalogInsertOps(USER_ID, []).map((o) => ({ ...o.payload })) as typeof FIX.exercises,
}
