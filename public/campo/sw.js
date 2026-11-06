// Service worker do app de campo (/campo). Escopo próprio, separado do sistema administrativo.
//
// - casca do app (página, JS, CSS e fontes): guardada na instalação, para abrir sem sinal já na primeira vez
// - listas de equipes, de colaboradores e de materiais: rede primeiro, com cópia guardada para usar sem sinal
// - outros arquivos do próprio app: rede primeiro, com cópia guardada
// - blitz: sempre pela rede (o envio sem sinal é feito pela fila do próprio app)

const VERSAO = "cem-campo-v5";
const CACHE_CASCA = `${VERSAO}-casca`;
const CACHE_ARQUIVOS = "cem-campo-arquivos";
const CASCA = [
  "/campo/",
  "/campo/index.html",
  "/campo/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Respostas de leitura que ficam guardadas para o app funcionar sem sinal.
const ROTAS_COM_COPIA = ["/api/campo/equipes", "/api/campo/colaboradores", "/api/campo/materiais"];

// Arquivos com hash que a página de entrada usa (JS, CSS) e as fontes citadas nos estilos.
// Sem isso, só abriria sem sinal depois de uma segunda visita.
async function guardarArquivosDoApp(cache) {
  const resposta = await fetch("/campo/index.html", { cache: "reload" });
  const html = await resposta.text();
  const arquivos = new Set(
    [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((achado) => achado[1]),
  );

  for (const arquivo of [...arquivos]) {
    if (!arquivo.endsWith(".css")) continue;
    try {
      const css = await (await fetch(arquivo)).text();
      for (const achado of css.matchAll(/url\((\/assets\/[^)]+\.woff2)\)/g)) arquivos.add(achado[1]);
    } catch {
      // Um estilo que não leu não impede o resto.
    }
  }

  await Promise.all(
    [...arquivos].map((arquivo) =>
      cache.add(arquivo).catch(() => {
        // Se um arquivo falhar, ele ainda é guardado na primeira vez que o app o usar.
      }),
    ),
  );
}

async function instalar() {
  const cache = await caches.open(CACHE_CASCA);
  await cache.addAll(CASCA);
  try {
    await guardarArquivosDoApp(cache);
  } catch {
    // Sem esses arquivos a instalação continua; eles entram no cache a partir do uso normal.
  }
}

self.addEventListener("install", (evento) => {
  evento.waitUntil(instalar());
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

  if (ROTAS_COM_COPIA.includes(url.pathname)) {
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
