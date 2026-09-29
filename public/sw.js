const CACHE='angermund-ops-v34-startup-repair';
const ASSETS=['/','/index.html','/styles.css','/app.js','/manifest.json','/angermund-logo.webp','/angermund-truck.webp','/angermund-app-logo.jpg'];
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
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let data={};
    try{data=event.data?event.data.json():{}}catch{data={body:event.data?event.data.text():'New Angermund Transport alert'}}
    const title=data.title||'Angermund Transport';
    const options={
      body:data.body||'You have a new notification.',
      icon:'/angermund-app-logo.jpg',
      badge:'/angermund-app-logo.jpg',
      tag:data.linkedId?('angermund-'+data.linkedId):('angermund-'+Date.now()),
      renotify:true,
      requireInteraction:Boolean(data.requireInteraction),
      data:{linkedType:data.linkedType||null,linkedId:data.linkedId||null,url:data.url||'/'}
    };
    await self.registration.showNotification(title,options)
  })())
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=event.notification.data?.url||'/';
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if('focus' in client){await client.focus();try{client.postMessage({type:'push-click',data:event.notification.data||{}})}catch{}return}
    }
    if(self.clients.openWindow)return self.clients.openWindow(target)
  })())
});
