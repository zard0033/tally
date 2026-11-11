/* 設定頁選的主模型存在這支手機（localStorage），不進資料庫——進資料庫要加 profile 欄位（schema 改動，
   要使用者點頭；v2.128 先這樣，換手機要重選）。lib 禁碰 window，所以讀寫放在這一層；值的驗證在 lib/aiModels。 */
import { normalizeAiModel } from '@/lib/aiModels'

const KEY = 'tally.ai-model'

export function getAiModel(): string {
  try {
    return normalizeAiModel(localStorage.getItem(KEY))
  } catch {
    // Safari 封鎖網站資料時存取 localStorage 會丟 SecurityError：當作沒選，用預設
    return normalizeAiModel(null)
  }
}

/** 存不進去（同上）就丟出去，讓設定頁顯示沒存到，不假裝存了。 */
export function setAiModel(id: string): void {
  localStorage.setItem(KEY, normalizeAiModel(id))
}
