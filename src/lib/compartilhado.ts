import type { StatusItem } from "./tipos";

// Processos que aparecem no formulário da blitz. Completar com a lista oficial.
export const PROCESSOS = ["GSTC", "GOMAN", "GERE"] as const;

export const STATUS_LABEL: Record<StatusItem, string> = {
  ok: "OK",
  nao_ok: "Não OK",
  faltante: "Faltante",
};
