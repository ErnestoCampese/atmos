/* αtmos — service worker.
   It keeps a copy of the app's own files so the app opens without an internet connection.
   It never touches your sounds or compositions: those live in the folder you chose, which a
   service worker cannot see. It never touches Freesound either — those requests pass straight
   through, so a search is always live and a download is never cached.

   When a new version is published, the page itself is fetched from the network first, so anyone
   who already has the app gets the new one as soon as they are online. */

const VERSION = 'atmos-v10';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'manifest.webmanifest',
  'assets/fonts/literata-italic.woff2',
  'assets/fonts/literata-italic-alpha.woff2',
  'assets/fonts/hanken-grotesk.woff2',
  'assets/icons/icon.svg',
  'assets/icons/favicon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // one missing file must not stop the rest from being kept
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // anything that is not this app — Freesound above all — is left completely alone
  if (url.origin !== self.location.origin) return;

  // The page itself comes from the network when there is one, so a new release reaches
  // everyone who already has the app; the kept copy is the fallback when there is not.
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('index.html', fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match('index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // everything else: the kept copy first, and quietly refreshed in the background
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const live = fetch(req).then(res => {
      if (res && res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return hit || (await live) || Response.error();
  })());
});
