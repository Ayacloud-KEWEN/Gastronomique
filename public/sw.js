/* Gastronomique Service Worker：离线缓存与版本更新
 * VERSION 由服务器在返回本文件时替换为前端文件的哈希；文件一变，浏览器就会安装新版本，
 * 新版本先进入「等待」状态，用户点击页面上的「刷新」后才接管，避免页面中途被替换。 */
const VERSION = "__VERSION__";
const SHELL_CACHE = "shell-" + VERSION;
const API_CACHE = "api-v1", MEDIA_CACHE = "media-v1", RUNTIME_CACHE = "runtime-v1";
const LEAFLET = ["https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css", "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"];
const SHELL = ["/", "/app.js", "/share.js", "/styles.css", "/manifest.webmanifest",
  "/icons/logo-96.webp", "/icons/logo-192.png", "/icons/favicon-32.png", "/icons/favicon-48.png", "/icons/apple-touch-icon.png"];
const LIMITS = { [MEDIA_CACHE]: 400, [RUNTIME_CACHE]: 600 };

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL_CACHE);
    await c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })));
    await Promise.all(LEAFLET.map(u => fetch(u, { mode: "cors" }).then(r => r.ok && c.put(u, r)).catch(() => {})));
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("shell-") && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
  if (e.data === "CLEAR_PRIVATE") e.waitUntil(Promise.all([caches.delete(API_CACHE), caches.delete(MEDIA_CACHE)]));
});

async function trim(name) {
  const max = LIMITS[name]; if (!max) return;
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
const offlineJson = () => new Response(JSON.stringify({ error: "离线中，且没有缓存", offline: true }), { status: 503, headers: { "content-type": "application/json" } });

// 网络优先，失败或 6 秒无响应时用缓存（API 数据）；信号弱时不至于一直卡住
async function networkFirst(req, cacheName) {
  const net = fetch(req).then(async res => { if (res.ok) await (await caches.open(cacheName)).put(req, res.clone()); return res; });
  const cached = () => caches.match(req, { cacheName });
  try {
    return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000))]);
  } catch {
    const hit = await cached();
    if (hit) return hit;
    try { return await net; } catch { return offlineJson(); }   // 没有缓存时再多等一会儿网络
  }
}
// 缓存优先（媒体文件内容不变，地图瓦片、字体）
async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req, { cacheName });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") { (await caches.open(cacheName)).put(req, res.clone()); trim(cacheName); }
    return res;
  } catch { return new Response("", { status: 504 }); }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;     // 写操作与视频分段请求直接走网络
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname === "/api/version" || url.pathname === "/sw.js" || url.pathname.startsWith("/invite/")) return;
    if (req.mode === "navigate") {
      e.respondWith(fetch(req).catch(async () => (await caches.match("/", { cacheName: SHELL_CACHE })) || offlineJson()));
      return;
    }
    if (SHELL.includes(url.pathname)) { e.respondWith(caches.match(req, { cacheName: SHELL_CACHE }).then(r => r || fetch(req))); return; }
    if (/^\/api\/(items|me|prefs\/)/.test(url.pathname)) { e.respondWith(networkFirst(req, API_CACHE)); return; }
    if (url.pathname.startsWith("/media/")) { e.respondWith(cacheFirst(req, MEDIA_CACHE)); return; }
    return;
  }
  if (LEAFLET.includes(req.url)) { e.respondWith(caches.match(req.url).then(r => r || fetch(req))); return; }
  if (/(^|\.)tile\.openstreetmap\.org$|fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(cacheFirst(req, RUNTIME_CACHE));
});
