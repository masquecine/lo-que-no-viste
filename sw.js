/* =========================================================
   Service worker de "Lo que No viste" · Más Que Cine

   Cómo funciona:
   - Con internet: pide a la red la versión más nueva y guarda una copia.
   - Si internet tarda más de 3 segundos (conexión lenta, VPN, wifi débil),
     abre la copia guardada al momento y descarga la nueva por detrás,
     para la próxima vez. Así la app nunca se queda pegada en el logo.
   - Sin internet: abre la copia guardada (textos, cartas, crítica, diseño).
   - Los clips y vídeos de YouTube No se guardan: necesitan conexión.

   La versión llega desde index.html (APP_VERSION). Para forzar que todo se
   renueve, cambia APP_VERSION en index.html: este archivo se actualiza solo.
   ========================================================= */
const VERSION = new URL(self.location.href).searchParams.get("v") || "1.0";
const CACHE = "lqnv-" + VERSION;
const CACHE_FUENTES = "lqnv-fuentes";
const ESPERA_RED = 3000; // milisegundos que se espera a internet antes de abrir la copia guardada
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

function esperar(ms) { return new Promise((listo) => setTimeout(listo, ms)); }

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

  // Archivos del regalo: primero la red (máximo 3 segundos); si No, la copia
  if (url.origin === self.location.origin) {
    const r = primeroLaRed(peticion, url);
    event.respondWith(r.respuesta);
    event.waitUntil(r.actualizar);
    return;
  }

  // Tipografías de Google: se guardan la primera vez y se reutilizan
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    const r = tipografias(peticion);
    event.respondWith(r.respuesta);
    event.waitUntil(r.actualizar);
  }

  // YouTube y todo lo demás: directo a la red, sin guardar nada
});

function primeroLaRed(peticion, url) {
  const esPagina = peticion.mode === "navigate";
  // La copia se guarda sin "?directo" ni nada detrás, para que sirva para cualquier enlace
  const clave = url.origin + url.pathname;
  const cacheAbierta = caches.open(CACHE);

  const pedir = esPagina
    ? fetch(url.href, { cache: "no-cache", credentials: "same-origin", redirect: "manual" })
    : fetch(peticion, { cache: "no-cache" });

  // Guarda la versión nueva en cuanto llegue (aunque ya se haya abierto la copia)
  const actualizar = pedir.then((respuesta) => {
    if (!respuesta.ok || respuesta.type === "opaqueredirect") return;
    const copia = respuesta.clone();
    return cacheAbierta.then((cache) => cache.put(clave, copia));
  }).catch(() => { /* Sin conexión: se queda la copia que había */ });

  const copiaGuardada = () => cacheAbierta.then((cache) =>
    cache.match(clave, { ignoreSearch: true }).then((guardada) =>
      guardada || (esPagina ? cache.match("./index.html").then((indice) => indice || cache.match("./")) : undefined)));

  const respuesta = new Promise((entregar) => {
    let entregada = false;
    const usar = (r) => {
      if (entregada || !r) return false;
      entregada = true;
      entregar(r);
      return true;
    };
    // 1. Si internet responde a tiempo: la versión más nueva
    pedir.then(usar, () => {
      // 2. Sin conexión: la copia guardada
      copiaGuardada().then((guardada) => { if (!usar(guardada)) usar(Response.error()); },
                           () => usar(Response.error()));
    });
    // 3. Si internet tarda más de 3 segundos: la copia guardada (si No hay copia, se sigue esperando)
    esperar(ESPERA_RED).then(() => {
      if (!entregada) copiaGuardada().then(usar, () => {});
    });
  });

  return { respuesta: respuesta, actualizar: actualizar };
}

function tipografias(peticion) {
  let guardar = Promise.resolve();
  const respuesta = caches.open(CACHE_FUENTES).then((cache) =>
    cache.match(peticion, { ignoreVary: true }).then((guardada) => {
      if (guardada) return guardada;
      const pedir = fetch(peticion);
      guardar = pedir.then((r) => {
        if (r.ok || r.type === "opaque") return cache.put(peticion, r.clone());
      }).catch(() => {});
      // Si tarda más de 3 segundos, la página sigue con la letra del móvil y No se queda esperando
      return Promise.race([pedir, esperar(ESPERA_RED).then(() => Response.error())]);
    })
  ).catch(() => Response.error());
  return { respuesta: respuesta, actualizar: respuesta.then(() => guardar, () => guardar) };
}
