/* Service worker – network first (always the latest version when online), cache only as offline fallback; web push. */
const CACHE = 'plt-v13';
const ASSETS = ['./', 'index.html', 'config.js', 'engine.js', 'forecast.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'track.js', 'vendor/supabase.js', 'vendor/fonts/nunito-sans.css', 'confidentialitate.html'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(a => fetch(new Request(a, { cache: 'reload' })).then(r => r.ok && c.put(a, r)).catch(() => { })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // API calls are never cached
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const url = './' + (d.speak ? '?speak=' + encodeURIComponent(d.speak) : '');
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Pleacă la timp', { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || 'plt', renotify: !!d.urgent, requireInteraction: !!d.urgent, vibrate: d.urgent ? [400, 150, 400, 150, 800] : [200], data: { url } }),
    // dacă aplicația e deschisă pe ecran, anunță mesajul cu voce imediat
    d.speak ? clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs.forEach(c => c.postMessage({ type: 'speak', text: d.speak }))) : null
  ]));
});
self.addEventListener('notificationclick', e => { e.notification.close(); const url = e.notification.data.url || './'; e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const c = cs.find(x => 'focus' in x); if (c) { c.postMessage({ type: 'speak', text: new URL(url, self.location).searchParams.get('speak') }); return c.focus(); } return clients.openWindow(url); })); });
