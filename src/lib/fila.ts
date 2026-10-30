import type { NovaBlitz } from "./tipos";

// Blitz guardadas no celular enquanto não há conexão. Ficam no IndexedDB do navegador.

export interface BlitzPendente {
  id: string;
  criadaEm: number;
  payload: NovaBlitz;
  erro?: string;
}

const NOME_BANCO = "cem";
const NOME_LOJA = "blitz-pendentes";

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.open(NOME_BANCO, 1);
    pedido.onupgradeneeded = () => {
      pedido.result.createObjectStore(NOME_LOJA, { keyPath: "id" });
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rejeitar(pedido.error);
  });
}

async function operar<T>(modo: IDBTransactionMode, operacao: (loja: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const banco = await abrirBanco();
  return new Promise((resolver, rejeitar) => {
    const transacao = banco.transaction(NOME_LOJA, modo);
    const pedido = operacao(transacao.objectStore(NOME_LOJA));
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rejeitar(pedido.error);
    transacao.oncomplete = () => banco.close();
  });
}

export const fila = {
  async listar(): Promise<BlitzPendente[]> {
    const itens = await operar<BlitzPendente[]>("readonly", (loja) => loja.getAll());
    return itens.sort((a, b) => a.criadaEm - b.criadaEm);
  },
  async guardar(item: BlitzPendente): Promise<void> {
    await operar("readwrite", (loja) => loja.put(item));
  },
  async remover(id: string): Promise<void> {
    await operar("readwrite", (loja) => loja.delete(id));
  },
};
