/*
 * Chess Lords — version hors ligne : Service Worker.
 *
 * Deux caches :
 *  - « cl-core-<version> » : la page du jeu et ses dépendances (moteur Phaser, polices, icônes,
 *    manifeste, liste des ressources). Mis en cache dès l'installation, remplacé à chaque version.
 *  - « cl-assets » : toutes les ressources du jeu (musiques, portraits, décors, sprites…), remplies
 *    par le bouton « Télécharger » de la page. Ce cache n'est PAS vidé d'une version à l'autre :
 *    chaque fichier porte son empreinte (en-tête X-CL-Hash) et seuls les fichiers modifiés sont
 *    retéléchargés.
 * Tout est servi depuis le cache d'abord (aucune requête réseau nécessaire pendant une partie).
 * Les musiques sont lues par un élément <audio> : les requêtes partielles (Range, indispensables à
 * Safari sur iPhone) reçoivent une réponse 206 découpée dans le fichier en cache.
 */
const VERSION = 'c01c735f6e56';
const CORE = ["index.html","vendor/phaser.min.js","fonts/fonts.css","manifest.webmanifest","offline-assets.json","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","fonts/Aladin.woff","fonts/Almendra-Bold.woff","fonts/CinzelDecorative-Bold.woff","fonts/GrenzeGotisch.woff","fonts/IMFellEnglishSC.woff","fonts/PirataOne.woff","fonts/PixelifySans.woff","fonts/YujiBoku.woff"];
const CORE_CACHE = `cl-core-${VERSION}`;
const ASSET_CACHE = 'cl-assets';

const scopeUrl = (rel) => new URL(rel, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CORE_CACHE);
      // requêtes « fraîches » : jamais une copie intermédiaire périmée du navigateur
      await cache.addAll(CORE.map((u) => new Request(scopeUrl(u), { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('cl-core-') && key !== CORE_CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source?.postMessage({ type: 'version', version: VERSION });
});

async function lookup(request) {
  const url = new URL(request.url);
  url.hash = '';
  const index = scopeUrl('./');
  let key = url.href;
  if (request.mode === 'navigate' || key === index || key === scopeUrl('index.html')) key = scopeUrl('index.html');
  const core = await caches.open(CORE_CACHE);
  const hit = (await core.match(key, { ignoreSearch: true })) ?? (await (await caches.open(ASSET_CACHE)).match(key, { ignoreSearch: true }));
  return hit ?? null;
}

/** Réponse partielle (206) découpée dans une réponse complète en cache. */
async function partial(response, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  const blob = await response.blob();
  const size = blob.size;
  if (!m) return new Response(blob, { status: 200, headers: response.headers });
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2]);
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(blob.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // la version hors ligne n'appelle aucun autre site
  event.respondWith(
    (async () => {
      const cached = await lookup(request);
      if (cached) {
        const range = request.headers.get('range');
        return range ? partial(cached, range) : cached;
      }
      try {
        return await fetch(request);
      } catch (err) {
        if (request.mode === 'navigate') {
          return new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="background:#07060a;color:#eee;font:18px sans-serif;padding:24px">Chess Lords n’a pas encore été installé sur ce téléphone. Ouvrez cette adresse une première fois avec Internet.</body>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        }
        throw err;
      }
    })(),
  );
});
