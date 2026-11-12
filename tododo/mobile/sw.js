const CACHE='tqm-shell-v9-4';
const ASSETS=['./','./index.html','./mobile.css','./js/01-core.js','./js/02-catalogue.js','./js/03-storage.js','./js/04-task-components.js','./js/05-application.js','./style.css','./stylekoala.css','./styletest.css','./firebase-config.js','./sport-catalog-v67.js','./sync-merge-v72.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('tqm-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)))});
