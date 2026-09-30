const CACHE="mmc-pwa-v7";
const CORE=["./","./index.html","./manifest.json","./icon.svg"];
self.addEventListener("install",event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const url of CORE){try{const req=new Request(url,{cache:"no-store"});const res=await fetch(req);if(res.ok)await cache.put(req,res.clone())}catch(e){}}await self.skipWaiting()})()));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
 if(event.request.method!=="GET")return;
 const isHTML=event.request.mode==="navigate"||event.request.destination==="document"||event.request.url.endsWith("/index.html");
 if(isHTML){event.respondWith(fetch(new Request(event.request,{cache:"no-store"})).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put("./index.html",copy)).catch(()=>{});return res}).catch(()=>caches.match("./index.html")));return}
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return res}).catch(()=>caches.match("./index.html"))));
});