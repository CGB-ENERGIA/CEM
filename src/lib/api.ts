import type { BlitzResumo, Dashboard, DadosEquipe, Equipe, Materiais, NovaBlitz } from "./tipos";
import { encerrarSessaoLocal, type Usuario } from "./sessao.svelte";

export class ErroApi extends Error {
  status?: number;
}

// Sem resposta do servidor (sem sinal, servidor fora do ar). Diferente de um erro de validação.
export class ErroSemConexao extends ErroApi {}

const MENSAGEM_SEM_CONEXAO = "Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.";

async function requisitar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ErroSemConexao(MENSAGEM_SEM_CONEXAO);
  }

  if (resposta.status === 204) return undefined as T;

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    // Sessão expirada em qualquer tela volta para o login. Erros de senha não passam por aqui.
    if (resposta.status === 401 && caminho !== "/api/auth/login") encerrarSessaoLocal();
    // Um 5xx sem corpo JSON costuma ser o proxy sem o servidor da API por trás.
    if (corpo === null) throw new ErroSemConexao(MENSAGEM_SEM_CONEXAO);
    const erro = new ErroApi(corpo.erro ?? "Não foi possível concluir a operação.");
    erro.status = resposta.status;
    throw erro;
  }
  return corpo as T;
}

export const api = {
  entrar: (login: string, senha: string) =>
    requisitar<Usuario>("/api/auth/login", { method: "POST", body: JSON.stringify({ login, senha }) }),
  sair: () => requisitar<void>("/api/auth/logout", { method: "POST" }),
  eu: () => requisitar<Usuario>("/api/auth/me"),

  materiais: () => requisitar<Materiais>("/api/materiais"),

  equipes: () => requisitar<Equipe[]>("/api/equipes"),
  criarEquipe: (equipe: DadosEquipe & { prefixo: string }) =>
    requisitar<Equipe>("/api/equipes", { method: "POST", body: JSON.stringify(equipe) }),
  atualizarEquipe: (prefixo: string, dados: DadosEquipe) =>
    requisitar<Equipe>(`/api/equipes/${encodeURIComponent(prefixo)}`, {
      method: "PUT",
      body: JSON.stringify(dados),
    }),
  removerEquipe: (prefixo: string) =>
    requisitar<void>(`/api/equipes/${encodeURIComponent(prefixo)}`, { method: "DELETE" }),

  blitzes: (mes: string) => requisitar<BlitzResumo[]>(`/api/blitz?mes=${mes}`),
  registrarBlitz: (blitz: NovaBlitz) =>
    requisitar<{ id: number }>("/api/blitz", { method: "POST", body: JSON.stringify(blitz) }),
  removerBlitz: (id: number) => requisitar<void>(`/api/blitz/${id}`, { method: "DELETE" }),

  dashboard: (mes: string) => requisitar<Dashboard>(`/api/dashboard?mes=${mes}`),
};
