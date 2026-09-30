const CACHE="mmc-pwa-v10";
const CORE=["./","./index.html","./manifest.json","./icon.svg"];
self.addEventListener("install",e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);for(const u of CORE){try{const r=await fetch(u,{cache:"no-store"});if(r.ok)await c.put(u,r.clone())}catch{}}await self.skipWaiting()})()));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(new Request(e.request,{cache:"no-store"})).then(r=>{const p=r.clone();caches.open(CACHE).then(c=>c.put(e.request,p));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html"))))});