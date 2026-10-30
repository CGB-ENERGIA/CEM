// Service worker do CEM.
//
// Estratégias:
// - casca do app (HTML, scripts, estilos, ícones): cache primeiro, atualizado em segundo plano
// - materiais e equipes: rede primeiro, com cópia em cache para uso sem conexão
// - login, sessão, blitz e dashboard: sempre pela rede, nunca em cache

const VERSAO = "cem-v1";
const CACHE_CASCA = `${VERSAO}-casca`;
const CACHE_DADOS = "cem-dados";
const CASCA = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

const ROTAS_DE_DADOS = ["/api/materiais", "/api/equipes"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE_CASCA).then((cache) => cache.addAll(CASCA)));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(
        chaves
          .filter((chave) => chave.startsWith("cem-v") && chave !== CACHE_CASCA)
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

async function cachePrimeiro(requisicao, cacheNome) {
  const emCache = await caches.match(requisicao);
  const atualizacao = fetch(requisicao)
    .then(async (resposta) => {
      if (resposta.ok) {
        const cache = await caches.open(cacheNome);
        cache.put(requisicao, resposta.clone());
      }
      return resposta;
    })
    .catch(() => undefined);
  return emCache ?? (await atualizacao) ?? new Response("", { status: 504 });
}

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== "GET") return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;

  // Dados da API: só materiais e equipes ficam em cache. O resto passa direto pela rede.
  if (url.pathname.startsWith("/api/")) {
    if (ROTAS_DE_DADOS.includes(url.pathname)) {
      evento.respondWith(redeDepoisCache(requisicao, CACHE_DADOS));
    }
    return;
  }

  // Navegação: a rede tem prioridade e, sem conexão, a casca guardada abre o app.
  if (requisicao.mode === "navigate") {
    evento.respondWith(
      fetch(requisicao).catch(() => caches.match("/index.html").then((r) => r ?? Response.error())),
    );
    return;
  }

  // Ativos estáticos com hash ou ícones e capas: cache primeiro.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname.endsWith(".jpg")) {
    evento.respondWith(cachePrimeiro(requisicao, CACHE_CASCA));
  }
});
