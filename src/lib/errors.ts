/* 錯誤訊息的呈現。純函式，禁沾 DOM。 */

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** 原始錯誤訊息（'Failed to fetch'、'signal timed out'、TimeoutError…）對使用者沒有意義，
 *  換成看得懂的話。AbortSignal.timeout 產生的是 DOMException{name:'TimeoutError'}，
 *  postgrest-js 組出的 message 形如 'TimeoutError: signal timed out'——三種寫法都要接住
 *  （precommit review 抓到只認 AbortError 會讓逾時原文直接見人）。
 *  只換網路類；伺服器回的業務訊息（RLS、約束、自訂錯誤）原樣放行，使用者才知道是哪裡不對。 */
export function friendlyError(message: string): string {
  if (message.includes('TimeoutError') || message.includes('AbortError') || message.includes('signal timed out')) {
    return '網路沒回應，請確認連線是否正常'
  }
  if (message.includes('Failed to fetch') || message.includes('Load failed') || message.includes('TypeError')) {
    return '連不上網路，請確認 Wi-Fi 或行動網路'
  }
  return message
}
