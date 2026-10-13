/* 註冊 service worker（階段 1 甲；設計見 spec.md「SW 工具」）。
 *
 * 只在 production build 註冊：dev server（5500）沒有 sw.js，註冊只會 404；e2e 跑的是 build 後的
 * preview，由 playwright.config 的 `serviceWorkers: 'block'` 擋掉，避免快取污染既有測試。
 * 等 load 之後再註冊，不跟首屏搶頻寬。
 *
 * 註冊失敗不擋 App：沒有 SW 只是少了離線開機，其餘功能照舊——所以只警告、不丟錯。 */
export function registerSW(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e: unknown) => {
      console.warn('[sw] 註冊失敗，離線開機不可用', e)
    })
  })
}
