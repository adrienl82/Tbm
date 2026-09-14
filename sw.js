// Service worker for the installable-PWA app shell (manifest.json is the
// other half). Only ever caches the app's own static files -- the HTML/CSS/
// JS/icons -- as a network-first offline fallback (see the fetch handler);
// live transit data (SIRI, GTFS-RT, route shapes) and map tiles are never
// cached at all, always fetched fresh regardless of connectivity.
//
// IMPORTANT: bump CACHE_VERSION whenever any file in PRECACHE_URLS changes.
// The browser only re-checks this file's own bytes for updates, so editing
// app.js/style.css/etc. without also bumping this constant leaves everyone
// already installed stuck on the old cached copy indefinitely.
const CACHE_VERSION = "v5";
const CACHE_NAME = `tbm-static-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/tbmApi.js",
  "./js/favorites.js",
  "./js/lineShapes.js",
  "./js/lineShapeOverrides.js",
  "./js/quartiers.js",
  "./js/tripUpdates.js",
  "./js/vehicleMotion.js",
  "./js/vehiclePositions.js",
  "./js/geoBounds.js",
  "./img/tbm-logo.png",
  "./img/icon-192.png",
  "./img/icon-512.png",
  "./img/icon-512-maskable.png",
  "./img/apple-touch-icon.png",
];

// Live data would go silently stale if a service worker ever served a
// cached copy of it -- these hosts are always fetched straight from the
// network, bypassing the cache entirely. Map tiles are excluded too: not
// live data exactly, but caching them here has no eviction, so it would
// just grow forever for a browser-native cache that already handles
// repeat tile requests reasonably well on its own.
const NEVER_CACHE_HOSTS = new Set([
  "bdx.mecatran.com",
  "opendata.bordeaux-metropole.fr",
  "server.arcgisonline.com",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // Take over from any previously-installed worker immediately rather
      // than waiting for every open tab to close first, so a deploy's fix
      // actually reaches the next page load instead of an indeterminate
      // number of visits later.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// This app changes often (many small fixes pushed per session) -- a
// cache-first app shell would keep serving whatever was cached at install
// time until a new service worker version happens to take over, which on
// some devices/browsers can take far longer than one reload to actually
// kick in. Network-first instead means "offline in the bus" (the actual
// point of caching this at all) is the only time the cache is ever used;
// with any connectivity at all, the latest deployed code always wins.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || NEVER_CACHE_HOSTS.has(url.hostname)) return; // let the browser handle it normally

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
