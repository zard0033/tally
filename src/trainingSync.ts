/* 訓練記錄的瀏覽器端接線：把 IndexedDB 與 supabase client 注入 lib 的執行期。
 *
 * 放在 src/ 根而不是 lib/：lib 禁沾瀏覽器 API，這裡是唯一碰 IndexedDB 的地方。
 * 儲存是懶建立的——Safari 私密模式或被封鎖時 indexedDB.open 會失敗，那個錯誤要出現在第一次
 * 實際讀寫時（被執行期翻成明確的 QueueStorageError／cacheError），而不是模組載入時變成
 * 沒人接的 unhandled rejection。 */

import { createStore, get, set, type UseStore } from 'idb-keyval'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from '@/lib/api'
import { createTrainingRuntime, type TrainingClient } from '@/lib/trainingRuntime'

let store: UseStore | null = null
const getStore = (): UseStore => (store ??= createStore('tally', 'kv'))

/** 全 App（這個分頁）唯一一份；跨分頁靠 crossLock，兩者合起來才滿足 queue.ts「同一份儲存一次只有一個在寫」的契約。
 *  supabase-js 的 client 型別比執行期要的介面寬很多，這裡一次轉型成它要的最小形狀。 */
export const trainingRuntime = createTrainingRuntime({
  kv: {
    get: (key) => get(key, getStore()),
    set: (key, value) => set(key, value, getStore()),
  },
  client: supabase as unknown as TrainingClient,
  // getSession 在 access token 過期時會先試 refresh，失敗回 { session: null, error }。
  // 失敗原因是網路（健身房斷網＋token 過期是常態）就丟出去：執行期把丟錯當「連不上」，
  // 不能回 null——那會被標成「登入失效、要重新登入」，而使用者只是需要網路
  sessionUserId: async () => {
    const { data, error } = await supabase.auth.getSession()
    if (!data.session && error && isAuthRetryableFetchError(error)) throw error
    return data.session?.user.id ?? null
  },
  // 桌機多分頁共用同一份 IndexedDB：沒有跨分頁鎖，兩邊各自整份寫回會互相蓋掉條目（Safari 15.4 起有）
  crossLock: <T>(name: string, fn: () => Promise<T>) => navigator.locks.request(name, fn),
})
