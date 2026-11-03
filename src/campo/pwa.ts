// Registra o service worker do app de campo, no próprio escopo (/campo/).
export function registrarPwaCampo() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/campo/sw.js", { scope: "/campo/" }).catch(() => {
    // Sem service worker, o app continua funcionando, só não abre sem sinal.
  });
}
