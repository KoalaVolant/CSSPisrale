/* Todo Quest Mobile V10: versioned shell, network first, offline fallback. */
const CACHE = 'tqm-shell-v10-0-rc';
const ASSETS = ['./','./index.html','./mobile.css','./nonsticky-v9-5.css',
  './js/01-core.js','./js/02-catalogue.js','./js/03-storage.js',
  './js/04-task-components.js','./js/05-application.js',
  './style.css','./stylekoala.css','./styletest.css',
  './firebase-config.js','./sport-catalog-v67.js','./sync-merge-v72.js',
  './manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('tqm-shell-') && key !== CACHE)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE);
    const found = await cache.match(request, {ignoreSearch:true});
    if (found) return found;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  }));
});
