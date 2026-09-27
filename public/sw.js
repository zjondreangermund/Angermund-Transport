const CACHE='angermund-ops-v18-trip-persistence-uploads';
const ASSETS=['/','/index.html','/styles.css','/app.js','/manifest.json','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(ASSETS);await self.skipWaiting()})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET')return;
  if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/api/')||url.pathname==='/login')return;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req,{cache:'no-store'}).then(r=>r).catch(()=>caches.match('/index.html')));
    return;
  }
  e.respondWith(fetch(req,{cache:'no-store'}).then(r=>{if(ASSETS.includes(url.pathname)){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return r}).catch(()=>caches.match(req)));
});