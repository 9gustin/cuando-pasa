// Service worker: la app abre sin conexión y, si no hay red, muestra el último JSON de la parada.
const VERSION = 'cp-v3';
const SHELL = [
  '/', '/estilos.css', '/manifest.webmanifest', '/iconos/icono.svg',
  '/js/app.js', '/js/home.js', '/js/nuevo.js', '/js/api.js', '/js/estado.js', '/js/util.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Próximos de una parada: red primero; sin red, el último que se vio (la app lo marca como desactualizado).
  if (/^\/api\/parada\/[^/]+$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const r = await fetch(req);
        if (r.ok) cache.put(req, r.clone());
        return r;
      } catch {
        const viejo = await cache.match(req);
        if (!viejo) return new Response(JSON.stringify({ error: 'Sin conexión.' }), { status: 503, headers: { 'content-type': 'application/json' } });
        const datos = await viejo.json();
        return Response.json({ ...datos, desactualizado: true });
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname === '/salud') return; // el resto de la API, siempre en vivo

  // Archivos de la app: del caché al toque y se actualizan por detrás (stale-while-revalidate).
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const guardado = await cache.match(req, { ignoreSearch: true });
    const red = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    return guardado ?? (await red) ?? (req.mode === 'navigate' ? cache.match('/') : Response.error());
  })());
});
