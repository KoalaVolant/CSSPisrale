const CACHE='tqm-shell-v2';const ASSETS=['./index.html','./mobile.css','../app.js','../style.css','../stylekoala.css','../styletest.css','../firebase-config.js','../sport-catalog-v67.js','./icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tqm-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;e.respondWith(fetch(r).catch(()=>caches.match(r)))});
