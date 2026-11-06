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

export const STATUS_LABEL: Record<StatusItem, string> = {
  ok: "OK",
  nao_ok: "Troca",
  faltante: "Faltante",
};
