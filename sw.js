/* Fa funzionare l'app senza internet: salva i file dell'app nel telefono.
   Quando cambi qualcosa nell'app, aumenta il numero di VERSIONE qui sotto
   (così il telefono scarica i file nuovi). */
const VERSIONE = 'v1';
const NOME_CACHE = 'confronto-finanziamenti-' + VERSIONE;
const FILE = [
  './', './index.html', './stile.css', './motore.js', './app.js', './manifest.webmanifest',
  './icone/icona-192.png', './icone/icona-512.png', './icone/icona-maskable-512.png'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(NOME_CACHE).then(function (c) { return c.addAll(FILE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (nomi) {
      return Promise.all(nomi.filter(function (n) { return n.indexOf('confronto-finanziamenti-') === 0 && n !== NOME_CACHE; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Prima i file salvati (veloce e offline); se mancano, internet.
self.addEventListener('fetch', function (ev) {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(caches.match(ev.request, { ignoreSearch: true }).then(function (r) { return r || fetch(ev.request); }));
});
