import type { StatusItem } from "./tipos";

// Processos que aparecem no formulário da blitz. Completar com a lista oficial.
export const PROCESSOS = ["GSTC", "GOMAN", "GERE"] as const;

// O que uma blitz verificou: tudo (EPI e EPC), só o EPI ou só o EPC.
export const ESCOPOS = ["todos", "epi", "epc"] as const;
export type EscopoBlitz = (typeof ESCOPOS)[number];

export const ROTULO_ESCOPO: Record<EscopoBlitz, string> = {
  todos: "Tudo",
  epi: "Só EPI",
  epc: "Só EPC",
};

// Evidência da blitz: quem inspecionou e de 1 a 3 fotos tiradas ao final.
export const FOTOS_MINIMO = 1;
export const FOTOS_MAXIMO = 3;
export const INSPETOR_MINIMO = 3;
export const INSPETOR_MAXIMO = 80;
// Cada foto é reduzida no celular antes do envio; o servidor recusa acima disto (a Vercel limita o corpo a ~4,5 MB).
export const FOTO_TAMANHO_MAXIMO = 3 * 1024 * 1024;

export const STATUS_LABEL: Record<StatusItem, string> = {
  ok: "OK",
  nao_ok: "Troca",
  faltante: "Faltante",
};
