// Registra o service worker do app de campo, no próprio escopo (/campo/).
export function registrarPwaCampo() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/campo/sw.js", { scope: "/campo/" }).catch(() => {
    // Sem service worker, o app continua funcionando, só não abre sem sinal.
  });

  // Pede ao navegador para não apagar os dados do app (blitz guardadas, listas) quando faltar espaço.
  // O navegador decide sozinho; se negar, nada muda.
  navigator.storage?.persist?.().catch(() => {});
}
