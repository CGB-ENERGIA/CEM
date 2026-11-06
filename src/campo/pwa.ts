// Service worker do app de campo, no próprio escopo (/campo/), e a atualização do app instalado.

type Ouvinte = () => void;

const ouvintes = new Set<Ouvinte>();
let versaoNovaPronta = false;

// Avisa quando uma versão nova do app foi instalada e já assumiu o controle. O app decide quando recarregar,
// para não perder uma blitz que está sendo preenchida.
export function aoTerNovaVersao(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  if (versaoNovaPronta) ouvinte();
  return () => ouvintes.delete(ouvinte);
}

// Um app aberto por dias não procura versão nova sozinho: o navegador só confere ao abrir a página.
// Por isso confere de tempos em tempos, ao voltar para o app e ao recuperar o sinal.
const INTERVALO_VERIFICACAO_MS = 5 * 60 * 1000;

export function registrarPwaCampo() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  // Na primeira instalação o service worker também assume a página, mas isso não é uma versão nova.
  const jaTinhaControlador = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!jaTinhaControlador || versaoNovaPronta) return;
    versaoNovaPronta = true;
    for (const ouvinte of ouvintes) ouvinte();
  });

  navigator.serviceWorker
    .register("/campo/sw.js", { scope: "/campo/" })
    .then((registro) => {
      const procurar = () => {
        if (navigator.onLine) registro.update().catch(() => {});
      };
      setInterval(procurar, INTERVALO_VERIFICACAO_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") procurar();
      });
      window.addEventListener("online", procurar);
    })
    .catch(() => {
      // Sem service worker, o app continua funcionando, só não abre sem sinal.
    });

  // Pede ao navegador para não apagar os dados do app (blitz guardadas, listas) quando faltar espaço.
  // O navegador decide sozinho; se negar, nada muda.
  navigator.storage?.persist?.().catch(() => {});
}
