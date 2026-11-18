const CACHE = 'noan-sermon-v2.1-20261119';
const CORE = ['/', '/index.html', '/app.js', '/app.css', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  if(url.pathname === '/version.json') { event.respondWith(fetch(event.request)); return; }
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('/index.html'))));
});
