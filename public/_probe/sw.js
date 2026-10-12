/* 階段 0 探針用 SW，暫時檔案。scope 只在 /tally/_probe/，不碰正式站。
   cache-first，ping.txt 一律走網路（拿來判斷真的有沒有網路）。 */
const CACHE = 'probe-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return
  if (req.url.includes('ping.txt')) return
  /* 頁面本身網路優先：改版後手機下次連線就拿到新的；離線才退回快取。
     其餘資源 cache-first。 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)) }
          return res
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    }),
  )
})
