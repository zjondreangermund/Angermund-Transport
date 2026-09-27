const CACHE='angermund-ops-v15-visible-logout';
const ASSETS=['/','/index.html','/styles.css','/app.js','/manifest.json','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil((async()=>{await caches.open(CACHE).then(c=>c.addAll(ASSETS));await self.skipWaiting()})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request))));
