export type TipoAviso = "ok" | "erro" | "info";

export interface Aviso {
  id: number;
  tipo: TipoAviso;
  texto: string;
}

export const avisos = $state<{ lista: Aviso[] }>({ lista: [] });

let sequencia = 0;

export function fecharAviso(id: number) {
  avisos.lista = avisos.lista.filter((aviso) => aviso.id !== id);
}

export function mostrarAviso(tipo: TipoAviso, texto: string, duracao = 4500) {
  const id = ++sequencia;
  avisos.lista = [...avisos.lista, { id, tipo, texto }].slice(-4);
  setTimeout(() => fecharAviso(id), duracao);
}
