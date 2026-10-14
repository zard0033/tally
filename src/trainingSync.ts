/* 訓練記錄的瀏覽器端接線：把 IndexedDB 與 supabase client 注入 lib 的執行期。
 *
 * 放在 src/ 根而不是 lib/：lib 禁沾瀏覽器 API，這裡是唯一碰 IndexedDB 的地方。
 * 儲存是懶建立的——Safari 私密模式或被封鎖時 indexedDB.open 會失敗，那個錯誤要出現在第一次
 * 實際讀寫時（被執行期翻成明確的 QueueStorageError／cacheError），而不是模組載入時變成
 * 沒人接的 unhandled rejection。 */

import { createStore, get, set, type UseStore } from 'idb-keyval'
import { supabase } from '@/lib/api'
import { createTrainingRuntime, type TrainingClient } from '@/lib/trainingRuntime'

let store: UseStore | null = null
const getStore = (): UseStore => (store ??= createStore('tally', 'kv'))

/** 全 App 唯一一份。「同一份儲存只能有一個實例」（queue.ts 的契約）靠它在模組層只建一次保證。
 *  supabase-js 的 client 型別比執行期要的介面寬很多，這裡一次轉型成它要的最小形狀。 */
export const trainingRuntime = createTrainingRuntime({
  kv: {
    get: (key) => get(key, getStore()),
    set: (key, value) => set(key, value, getStore()),
  },
  client: supabase as unknown as TrainingClient,
})
