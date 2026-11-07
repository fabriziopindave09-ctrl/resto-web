const V='resto-v4',CORE=['./','./index.html','./core.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.pathname.startsWith('/api/'))return;
 if(u.origin===location.origin){/* red primero (siempre la versión nueva), caché si no hay conexión */
  e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(V).then(c=>c.put(r.mode==='navigate'?'./index.html':r,cp))}return res}).catch(()=>caches.match(r.mode==='navigate'?'./index.html':r)));return}
 e.respondWith(caches.match(r).then(hit=>{const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==='opaque'))caches.open(V).then(c=>c.put(r,res.clone()));return res}).catch(()=>hit);return hit||net}))});
