// Service worker do app de campo (/campo). Escopo próprio, separado do sistema administrativo.
//
// - casca do app: cache primeiro, para abrir sem sinal
// - lista de equipes: rede primeiro, com cópia guardada para usar sem sinal
// - outros arquivos do próprio app: rede primeiro, com cópia guardada
// - blitz: sempre pela rede (o envio sem sinal é feito pela fila do próprio app)

const VERSAO = "cem-campo-v1";
const CACHE_CASCA = `${VERSAO}-casca`;
const CACHE_ARQUIVOS = "cem-campo-arquivos";
const CASCA = [
  "/campo/",
  "/campo/index.html",
  "/campo/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const ROTA_EQUIPES = "/api/campo/equipes";

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE_CASCA).then((cache) => cache.addAll(CASCA)));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(
        chaves
          .filter((chave) => chave.startsWith("cem-campo-v") && chave !== CACHE_CASCA)
          .map((chave) => caches.delete(chave)),
      ),
    ),
  );
  self.clients.claim();
});

async function redeDepoisCache(requisicao, cacheNome) {
  try {
    const resposta = await fetch(requisicao);
    if (resposta.ok) {
      const cache = await caches.open(cacheNome);
      cache.put(requisicao, resposta.clone());
    }
    return resposta;
  } catch {
    const emCache = await caches.match(requisicao);
    if (emCache) return emCache;
    throw new Error("sem conexão e sem cópia guardada");
  }
}

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== "GET") return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === ROTA_EQUIPES) {
    evento.respondWith(redeDepoisCache(requisicao, CACHE_ARQUIVOS));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  if (requisicao.mode === "navigate") {
    evento.respondWith(
      fetch(requisicao).catch(() => caches.match("/campo/index.html").then((r) => r ?? Response.error())),
    );
    return;
  }

  evento.respondWith(redeDepoisCache(requisicao, CACHE_ARQUIVOS));
});
