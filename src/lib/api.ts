import type {
  BlitzResumo,
  Dashboard,
  DadosEquipe,
  Equipe,
  FiltroPendencias,
  ListaPendencias,
  Materiais,
  Colaborador,
  ResultadoImportacaoColaboradores,
  ResultadoImportacaoEquipes,
} from "./tipos";
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

// Baixa um arquivo binário (não JSON): a planilha de equipes.
async function baixar(caminho: string): Promise<Blob> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho);
  } catch {
    throw new ErroSemConexao(MENSAGEM_SEM_CONEXAO);
  }
  if (!resposta.ok) {
    if (resposta.status === 401) encerrarSessaoLocal();
    const corpo = await resposta.json().catch(() => null);
    if (corpo === null) throw new ErroSemConexao(MENSAGEM_SEM_CONEXAO);
    const erro = new ErroApi(corpo.erro ?? "Não foi possível baixar o arquivo.");
    erro.status = resposta.status;
    throw erro;
  }
  return resposta.blob();
}

// Envia um arquivo (multipart), diferente do JSON que o resto da API usa.
async function enviarArquivo<T>(caminho: string, campo: string, arquivo: File): Promise<T> {
  const corpoFormulario = new FormData();
  corpoFormulario.append(campo, arquivo);
  let resposta: Response;
  try {
    resposta = await fetch(caminho, { method: "POST", body: corpoFormulario });
  } catch {
    throw new ErroSemConexao(MENSAGEM_SEM_CONEXAO);
  }
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    if (resposta.status === 401) encerrarSessaoLocal();
    if (corpo === null) throw new ErroSemConexao(MENSAGEM_SEM_CONEXAO);
    const erro = new ErroApi(corpo.erro ?? "Não foi possível enviar o arquivo.");
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
  exportarEquipes: () => baixar("/api/equipes/exportar"),
  importarEquipes: (arquivo: File) =>
    enviarArquivo<ResultadoImportacaoEquipes>("/api/equipes/importar", "arquivo", arquivo),

  colaboradores: () => requisitar<Colaborador[]>("/api/colaboradores"),
  aprovarColaborador: (id: number) =>
    requisitar<void>(`/api/colaboradores/${id}`, { method: "PUT", body: JSON.stringify({ status: "aprovado" }) }),
  recusarColaborador: (id: number) => requisitar<void>(`/api/colaboradores/${id}`, { method: "DELETE" }),
  importarColaboradores: (arquivo: File) =>
    enviarArquivo<ResultadoImportacaoColaboradores>("/api/colaboradores/importar", "arquivo", arquivo),

  blitzes: (mes: string) => requisitar<BlitzResumo[]>(`/api/blitz?mes=${mes}`),
  removerBlitz: (id: number) => requisitar<void>(`/api/blitz/${id}`, { method: "DELETE" }),

  pendencias: (situacao: FiltroPendencias) => requisitar<ListaPendencias>(`/api/pendencias?situacao=${situacao}`),
  resolverPendencia: (chave: string, resolvida: boolean) =>
    requisitar<{ chave: string; resolvidaEm: string | null; resolvidaPor: string | null }>("/api/pendencias/resolver", {
      method: "POST",
      body: JSON.stringify({ chave, resolvida }),
    }),
  exportarPendencias: (situacao: FiltroPendencias) => baixar(`/api/pendencias/exportar?situacao=${situacao}`),

  dashboard: (mes: string) => requisitar<Dashboard>(`/api/dashboard?mes=${mes}`),
};
