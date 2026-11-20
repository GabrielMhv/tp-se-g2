/**
 * Service Worker — Support PWA et mise en cache statique
 */

const NOM_CACHE = 'domotique-esp32-v1';
const FICHIERS_STATIQUES = [
  './',
  './index.html',
  './interface_web_domotique.html',
  './css/style.css',
  './manifest.json',
  './icons/icon.svg',
  './js/app.js',
  './js/firebase-config.js',
  './js/modules/journal.js',
  './js/modules/notifications.js',
  './js/modules/inactivite.js',
  './js/modules/planning.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(NOM_CACHE).then((cache) => cache.addAll(FICHIERS_STATIQUES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cles) =>
      Promise.all(
        cles.filter((cle) => cle !== NOM_CACHE).map((cle) => caches.delete(cle))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Les requêtes vers Firebase et Google Fonts passent toujours par le réseau
  if (
    event.request.url.includes('firebase') ||
    event.request.url.includes('firebasedatabase') ||
    event.request.url.includes('googleapis') ||
    event.request.url.includes('gstatic')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((reponseEnCache) => {
      return reponseEnCache || fetch(event.request);
    })
  );
});
