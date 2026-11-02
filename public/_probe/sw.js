/* 探針退場用（spec「探針頁收尾順序」）：手機開過一次探針頁，瀏覽器就會換上這支，它清掉探針自己的快取、解除自己。
   只刪 probe-v1：CacheStorage 是整個源站共用，正式站的離線快取也在裡面，不能全清。 */
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.delete('probe-v1').then(() => self.registration.unregister()))
})
