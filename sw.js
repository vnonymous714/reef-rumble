/* Reef Rumble service worker — installability + light caching.
   Never cache Cloudflare Worker API. Network-first for HTML so updates aren't stuck. */
const CACHE = 'rr-static-tg20-authoritative';
const API_HOST = 'reef-rumble-tg.ea-vnonymous.workers.dev';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('rr-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Coordinated cutover: active legacy documents must reload the new gated
    // shell rather than continue unsupported client-authoritative paid play.
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const scope=new URL(self.registration.scope);
    for(const client of clients){const url=new URL(client.url);if(url.origin===scope.origin&&url.pathname.startsWith(scope.pathname))await client.navigate(url.href);}

  })());
});

function isApi(url) {
  return url.hostname === API_HOST || url.pathname.startsWith('/api/') || url.pathname==='/events' || url.pathname.startsWith('/rpc/');
}

function isHtml(req, url) {
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  const path = url.pathname;
  return path.endsWith('.html') || path.endsWith('/') || /\/reef-rumble\/?$/.test(path);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  /* Never touch cross-origin Worker API (auth, balances, Stars). */
  if (isApi(url)) return;

  /* Same-origin only. */
  if (url.origin !== self.location.origin) return;

  /* Network-first for HTML documents so cache-bust / deploys apply quickly. */
  if (isHtml(req, url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  /* Images remain cache-first. Code/manifest are network-first; cached v2 code still requires live protocol/auth authority. */
  if(/\.(?:js|css|webmanifest)$/.test(url.pathname)){event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const fresh=await fetch(req,{cache:'no-store'});if(fresh.ok)await cache.put(req,fresh.clone());return fresh;}catch(e){const cached=await cache.match(req);if(cached)return cached;throw e;}})());return;}
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && url.protocol.startsWith('http')) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      throw err;
    }
  })());
});
