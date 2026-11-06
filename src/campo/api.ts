import type { Equipe, MateriaisCampo, NovaBlitz } from "../lib/tipos";

// Equipe como o app de campo recebe: sem os dados de gestão (responsável, supervisor, coordenador, gerência).
export type EquipeCampo = Pick<Equipe, "prefixo" | "nome" | "base" | "processo" | "status" | "tipoId">;

// Sem resposta do servidor (sem sinal, servidor fora do ar). A blitz pode ser guardada no celular.
export class ErroSemConexao extends Error {}

// O servidor respondeu com recusa. O status diz se vale tentar de novo mais tarde.
export class ErroRecusado extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
  }
}

const MENSAGEM_SEM_CONEXAO = "Não foi possível conectar ao servidor.";

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new ErroSemConexao(MENSAGEM_SEM_CONEXAO);
  }

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    // Um 5xx sem corpo JSON costuma ser a função fora do ar: trata como falta de conexão.
    if (corpo === null) throw new ErroSemConexao(MENSAGEM_SEM_CONEXAO);
    throw new ErroRecusado(corpo.erro ?? "Não foi possível registrar a blitz.", resposta.status);
  }
  return corpo as T;
}

export const apiCampo = {
  equipes: () => pedir<EquipeCampo[]>("/api/campo/equipes"),
  // Lista de materiais do catálogo: só os itens ativos, sem preço, e a versão que a blitz devolve ao ser enviada.
  materiais: () => pedir<MateriaisCampo>("/api/campo/materiais"),
  registrarBlitz: (blitz: NovaBlitz) =>
    pedir<{ id: number }>("/api/campo/blitz", { method: "POST", body: JSON.stringify(blitz) }),
  // Nomes de colaboradores já aprovados, para sugestão.
  colaboradores: () => pedir<string[]>("/api/campo/colaboradores"),
  // Pedido de cadastro de um nome novo. Entra como pendente até um administrador aprovar.
  solicitarColaborador: (nome: string) =>
    pedir<{ nome: string; status: "aprovado" | "pendente" }>("/api/campo/colaboradores", {
      method: "POST",
      body: JSON.stringify({ nome }),
    }),
};

// Vale a pena guardar no celular e tentar de novo: sem conexão, servidor fora do ar ou limite de envios.
export function envioAdiavel(falha: unknown): boolean {
  if (falha instanceof ErroSemConexao) return true;
  return falha instanceof ErroRecusado && (falha.status >= 500 || falha.status === 429);
}
