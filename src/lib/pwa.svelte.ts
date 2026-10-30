// Instalação do app na tela inicial e registro do service worker.

interface EventoInstalacao extends Event {
  prompt(): Promise<void>;
}

let eventoInstalacao: EventoInstalacao | null = null;

export const instalacao = $state({ disponivel: false });

export function registrarPwa() {
  window.addEventListener("beforeinstallprompt", (evento) => {
    // Guarda o evento para mostrar o botão "Instalar" no momento certo.
    evento.preventDefault();
    eventoInstalacao = evento as EventoInstalacao;
    instalacao.disponivel = true;
  });

  window.addEventListener("appinstalled", () => {
    eventoInstalacao = null;
    instalacao.disponivel = false;
  });

  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sem service worker o app continua funcionando, só não abre sem conexão.
    });
  }
}

export async function instalarApp() {
  if (!eventoInstalacao) return;
  await eventoInstalacao.prompt();
  eventoInstalacao = null;
  instalacao.disponivel = false;
}

// Remove os dados de materiais e equipes guardados no celular (usado ao sair).
export async function limparDadosGuardados() {
  if ("caches" in window) {
    await caches.delete("cem-dados");
  }
}
