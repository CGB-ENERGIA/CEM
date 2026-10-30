import { gsap } from "gsap";

// Quem pede menos movimento no sistema recebe o estado final sem animação.
export function reduzirMovimento(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Entrada em cascata dos filhos diretos (linhas de tabela, cards).
// Reexecuta sempre que o parâmetro muda, por exemplo ao trocar filtros.
export function cascata(node: HTMLElement, _chave: unknown) {
  const animar = () => {
    gsap.killTweensOf(node.children);
    if (reduzirMovimento()) {
      gsap.set(node.children, { opacity: 1, y: 0 });
      return;
    }
    gsap.fromTo(
      node.children,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.45, ease: "expo.out", stagger: 0.025, clearProps: "transform" },
    );
  };
  animar();
  return {
    update(novaChave: unknown) {
      void novaChave;
      animar();
    },
    destroy() {
      gsap.killTweensOf(node.children);
    },
  };
}

// Assinatura da blitz: a etiqueta "assenta" sempre que a situação de um item muda.
// A função update só roda após a montagem, então a linha não anima ao aparecer.
export function assentar(node: HTMLElement, _chave: unknown) {
  return {
    update(novaChave: unknown) {
      void novaChave;
      if (reduzirMovimento()) return;
      gsap.fromTo(
        node,
        { y: -4, opacity: 0.55 },
        { y: 0, opacity: 1, duration: 0.45, ease: "expo.out", clearProps: "transform,opacity" },
      );
    },
    destroy() {
      gsap.killTweensOf(node);
    },
  };
}

// Contador numérico que sai do valor atual até o novo valor.
export function numeroAnimado(
  node: HTMLElement,
  params: { valor: number | null; formatar: (valor: number) => string },
) {
  const estado = { valor: 0 };
  let tween: gsap.core.Tween | undefined;

  const atualizar = (proximo: { valor: number | null; formatar: (valor: number) => string }) => {
    tween?.kill();
    if (proximo.valor === null) {
      node.textContent = "—";
      return;
    }
    if (reduzirMovimento()) {
      node.textContent = proximo.formatar(proximo.valor);
      return;
    }
    // Mostra o valor de partida já na montagem: o número nunca fica em branco esperando o primeiro quadro.
    node.textContent = proximo.formatar(estado.valor);
    tween = gsap.to(estado, {
      valor: proximo.valor,
      duration: 1,
      ease: "expo.out",
      onUpdate: () => {
        node.textContent = proximo.formatar(estado.valor);
      },
    });
  };

  atualizar(params);
  return {
    update: atualizar,
    destroy() {
      tween?.kill();
    },
  };
}

// Barra de progresso que cresce até a porcentagem informada (0 a 100).
export function barra(node: HTMLElement, percentual: number) {
  const animarPara = (valor: number, inicio: boolean) => {
    gsap.killTweensOf(node);
    if (reduzirMovimento()) {
      node.style.width = `${valor}%`;
      return;
    }
    gsap.fromTo(
      node,
      { width: inicio ? "0%" : node.style.width || "0%" },
      { width: `${valor}%`, duration: inicio ? 0.9 : 0.6, ease: "expo.out" },
    );
  };

  animarPara(percentual, true);
  return {
    update(novo: number) {
      animarPara(novo, false);
    },
    destroy() {
      gsap.killTweensOf(node);
    },
  };
}

// Entrada de um aviso flutuante: desliza da lateral e aparece.
export function entrarAviso(node: HTMLElement) {
  if (!reduzirMovimento()) {
    gsap.from(node, { x: 40, opacity: 0, duration: 0.55, ease: "expo.out" });
  }
  return {};
}

// Desliza um painel lateralmente na direção da troca de aba (-1 esquerda, 1 direita).
export function deslizarPainel(node: HTMLElement, direcao: number) {
  if (reduzirMovimento()) return;
  gsap.fromTo(
    node,
    { x: direcao * 28, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.6, ease: "expo.out", clearProps: "transform,opacity" },
  );
}
