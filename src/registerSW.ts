/* 註冊 service worker（階段 1 甲；設計見 spec.md「SW 工具」）。
 *
 * 只在 production build 註冊：dev server（5500）沒有 sw.js，註冊只會 404；e2e 跑的是 build 後的
 * preview，由 playwright.config 的 `serviceWorkers: 'block'` 擋掉，避免快取污染既有測試。
 * 等 load 之後再註冊，不跟首屏搶頻寬。
 *
 * 註冊失敗不擋 App：沒有 SW 只是少了離線開機，其餘功能照舊——所以只警告、不丟錯。
 * 更新策略見 vite.config.ts（新版裝好就接手）與下面的 controllerchange。 */
export function registerSW(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  // 註冊當下已經有 SW 在控制這個頁面＝這是「更新」；第一次安裝（原本沒人控制）接手時不用重載
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  // 新版 SW 裝好就接手（vite.config.ts 的 skipWaiting／clientsClaim），舊頁面手上的舊雜湊 lazy chunk 之後會 404，
  // 所以接手的當下就把頁面換成新版。進行中的訓練與離線佇列都在 IndexedDB，重載不會丟；只有開著的 sheet 與打到一半的字會沒。
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        // iOS 主畫面 App 常駐背景、很少冷啟動：回到前景時主動問一次有沒有新版，不等瀏覽器自己的檢查
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => undefined)
        })
      })
      .catch((e: unknown) => {
        console.warn('[sw] 註冊失敗，離線開機不可用', e)
      })
  })
}
