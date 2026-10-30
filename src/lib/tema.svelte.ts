export type Tema = "claro" | "escuro";

const CHAVE = "cem-tema";

function lerTemaSalvo(): Tema | null {
  try {
    const salvo = localStorage.getItem(CHAVE);
    return salvo === "claro" || salvo === "escuro" ? salvo : null;
  } catch {
    return null;
  }
}

function temaDoSistema(): Tema {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

export const tema = $state({ atual: lerTemaSalvo() ?? temaDoSistema() });

export function aplicarTema(valor: Tema) {
  tema.atual = valor;
  document.documentElement.dataset.theme = valor === "escuro" ? "dark" : "light";
  try {
    localStorage.setItem(CHAVE, valor);
  } catch {
    // Sem armazenamento (modo privado, bloqueio): o tema vale só nesta sessão.
  }
}

export function alternarTema() {
  aplicarTema(tema.atual === "escuro" ? "claro" : "escuro");
}

// Aplica já na carga, antes da primeira pintura, para não haver flash do tema errado.
aplicarTema(tema.atual);
