/* =========================================================
   Service worker de "Lo que No viste" · Más Que Cine

   Cómo funciona:
   - Con internet: SIEMPRE pide a la red la versión más nueva y guarda una copia.
   - Sin internet: abre la copia guardada (textos, cartas, crítica, diseño).
   - Los clips y vídeos de YouTube No se guardan: necesitan conexión.

   La versión llega desde index.html (APP_VERSION). Para forzar que todo se
   renueve, cambia APP_VERSION en index.html: este archivo se actualiza solo.
   ========================================================= */
const VERSION = new URL(self.location.href).searchParams.get("v") || "1.0";
const CACHE = "lqnv-" + VERSION;
const CACHE_FUENTES = "lqnv-fuentes";
const ARCHIVOS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

// Las mismas tipografías que pide index.html
const TIPOGRAFIAS = "https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Fraunces:ital,opsz,wght@0,9..144,600..900;1,9..144,600..900&family=Inter:wght@400;500;600;700&display=swap";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ARCHIVOS.map((ruta) => new Request(ruta, { cache: "reload" }))))
      .then(() => guardarTipografias().catch(() => { /* Si fallan, se guardan en la siguiente visita */ }))
      .then(() => self.skipWaiting())
  );
});

// Guarda las tipografías desde la primera visita, para que sin internet se vea igual
async function guardarTipografias() {
  const cache = await caches.open(CACHE_FUENTES);
  if (await cache.match(TIPOGRAFIAS, { ignoreVary: true })) return;
  const hoja = await fetch(TIPOGRAFIAS, { mode: "cors" });
  if (!hoja.ok) return;
  const texto = await hoja.clone().text();
  await cache.put(TIPOGRAFIAS, hoja);
  const archivos = Array.from(texto.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g), (m) => m[1]);
  await Promise.all(archivos.map(async (direccion) => {
    try {
      const fuente = await fetch(direccion, { mode: "cors" });
      if (fuente.ok) await cache.put(direccion, fuente);
    } catch (error) { /* Una que falle No impide las demás */ }
  }));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves
          .filter((clave) => clave.startsWith("lqnv-") && clave !== CACHE && clave !== CACHE_FUENTES)
          .map((clave) => caches.delete(clave))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const peticion = event.request;
  if (peticion.method !== "GET") return;
  const url = new URL(peticion.url);

  // Archivos del regalo: primero la red, si No hay conexión, la copia
  if (url.origin === self.location.origin) {
    event.respondWith(primeroLaRed(peticion, url));
    return;
  }

  // Tipografías de Google: se guardan la primera vez y se reutilizan
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(tipografias(peticion));
  }

  // YouTube y todo lo demás: directo a la red, sin guardar nada
});

async function primeroLaRed(peticion, url) {
  const cache = await caches.open(CACHE);
  const esPagina = peticion.mode === "navigate";
  // La copia se guarda sin "?directo" ni nada detrás, para que sirva para cualquier enlace
  const clave = url.origin + url.pathname;
  try {
    const respuesta = esPagina
      ? await fetch(url.href, { cache: "no-cache", credentials: "same-origin", redirect: "manual" })
      : await fetch(peticion, { cache: "no-cache" });
    if (respuesta.type === "opaqueredirect") return respuesta;
    if (respuesta.ok) cache.put(clave, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(clave, { ignoreSearch: true }) ||
      (esPagina ? (await cache.match("./index.html") || await cache.match("./")) : null);
    return guardada || Response.error();
  }
}

async function tipografias(peticion) {
  const cache = await caches.open(CACHE_FUENTES);
  const guardada = await cache.match(peticion, { ignoreVary: true });
  if (guardada) return guardada;
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok || respuesta.type === "opaque") cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch (error) {
    return Response.error();
  }
}
