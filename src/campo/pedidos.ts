// Pedidos de cadastro de colaborador feitos sem sinal. Ficam guardados no celular até haver conexão.
// São poucos nomes, então o localStorage basta.

const CHAVE = "paes-pedidos-colaborador";

export function listarPedidos(): string[] {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    return Array.isArray(bruto) ? bruto.filter((nome): nome is string => typeof nome === "string") : [];
  } catch {
    return [];
  }
}

function gravar(nomes: string[]) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(nomes));
  } catch {
    // Armazenamento cheio ou bloqueado: o pedido se perde, mas o nome segue valendo na blitz.
  }
}

export function guardarPedido(nome: string) {
  const nomes = listarPedidos();
  if (!nomes.includes(nome)) gravar([...nomes, nome]);
}

export function removerPedido(nome: string) {
  gravar(listarPedidos().filter((guardado) => guardado !== nome));
}
