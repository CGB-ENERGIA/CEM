import { randomInt } from "node:crypto";
import * as XLSX from "xlsx";
import materiaisJson from "../src/lib/data/materiais.json";
import { PROCESSOS } from "../src/lib/compartilhado";
import { normalizarTexto } from "../src/lib/format";
import type {
  BlitzResumo,
  Dashboard,
  Equipe,
  Item,
  ItemBlitz,
  Materiais,
  NovaBlitz,
  ListaPendencias,
  Pendencia,
  PessoaItem,
  PessoaPendente,
  RankingEquipe,
  RankingItem,
  StatusItem,
  UsuarioGerenciado,
} from "../src/lib/tipos";
import {
  cabecalhoCookie,
  criarSessao,
  encerrarSessao,
  encerrarSessoesDoUsuario,
  limparFalhasLogin,
  loginBloqueado,
  lerTokenDoCookie,
  registrarFalhaLogin,
  usuarioDaSessao,
  verificarCredenciais,
  type UsuarioSessao,
} from "./auth";
import { db } from "./db";

const materiais = materiaisJson as Materiais;
const itensPorId = new Map(materiais.itens.map((item) => [item.id, item]));
const tiposValidos = new Set(materiais.tipos.map((tipo) => tipo.id));

export class ErroValidacao extends Error {
  constructor(
    mensagem: string,
    readonly status = 400,
  ) {
    super(mensagem);
  }
}

function resposta(dados: unknown, status = 200): Response {
  return Response.json(dados, { status });
}

function semConteudo(): Response {
  return new Response(null, { status: 204 });
}

function itensAplicaveis(tipoId: string): Item[] {
  return materiais.itens.filter((item) => (item.quantidades[tipoId] ?? 0) > 0);
}

function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

function lerMes(url: URL): string {
  const mes = url.searchParams.get("mes") ?? mesAtual();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new ErroValidacao("Mês inválido. Use o formato AAAA-MM.");
  }
  return mes;
}

// Primeiro dia do mês e primeiro dia do mês seguinte: o intervalo é [inicio, fim).
function intervaloDoMes(mes: string): { inicio: string; fim: string } {
  const [ano, numero] = mes.split("-").map(Number);
  const proximoAno = numero === 12 ? ano + 1 : ano;
  const proximoMes = numero === 12 ? 1 : numero + 1;
  return {
    inicio: `${ano}-${String(numero).padStart(2, "0")}-01`,
    fim: `${proximoAno}-${String(proximoMes).padStart(2, "0")}-01`,
  };
}

function normalizarPrefixo(valor: unknown): string {
  const prefixo = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  if (!prefixo || prefixo.length > 20) {
    throw new ErroValidacao("Informe o prefixo da equipe (até 20 caracteres).");
  }
  return prefixo;
}

function validarTipo(tipoId: unknown): string {
  if (typeof tipoId !== "string" || !tiposValidos.has(tipoId)) {
    throw new ErroValidacao("Tipo de equipe inválido.");
  }
  return tipoId;
}

async function lerJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ErroValidacao("Corpo da requisição inválido.");
  }
}

// ---------- Equipes ----------

const COLUNAS_EQUIPE = "prefixo, nome, responsavel, supervisor, coordenador, gerencia, base, processo, status, tipo_id";

interface LinhaEquipe {
  prefixo: string;
  nome: string | null;
  responsavel: string | null;
  supervisor: string | null;
  coordenador: string | null;
  gerencia: string | null;
  base: string | null;
  processo: string | null;
  status: "ativo" | "inativo";
  tipo_id: string | null;
}

function paraEquipe(linha: LinhaEquipe): Equipe {
  return {
    prefixo: linha.prefixo,
    nome: linha.nome,
    responsavel: linha.responsavel,
    supervisor: linha.supervisor,
    coordenador: linha.coordenador,
    gerencia: linha.gerencia,
    base: linha.base,
    processo: linha.processo,
    status: linha.status,
    tipoId: linha.tipo_id,
  };
}

// Texto opcional: vazio vira nulo. Recusa valores acima do limite.
function textoOpcional(valor: unknown, rotulo: string, limite: number): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "string" || valor.trim().length > limite) {
    throw new ErroValidacao(`${rotulo} deve ter até ${limite} caracteres.`);
  }
  return valor.trim() || null;
}

// Campos que o cadastro pode alterar. O prefixo fica de fora: ele é a chave que liga as blitz à equipe.
function validarDadosEquipe(corpo: Record<string, unknown>) {
  const processo = textoOpcional(corpo.processo, "Processo", 20);
  if (processo !== null && !(PROCESSOS as readonly string[]).includes(processo)) {
    throw new ErroValidacao("Processo inválido.");
  }
  const status = corpo.status === undefined ? "ativo" : corpo.status;
  if (status !== "ativo" && status !== "inativo") throw new ErroValidacao("Status inválido.");
  const tipoId = corpo.tipoId === undefined || corpo.tipoId === null || corpo.tipoId === "" ? null : validarTipo(corpo.tipoId);
  return {
    nome: textoOpcional(corpo.nome, "Nome", 120),
    responsavel: textoOpcional(corpo.responsavel, "Responsável", 120),
    supervisor: textoOpcional(corpo.supervisor, "Supervisor", 120),
    coordenador: textoOpcional(corpo.coordenador, "Coordenador", 120),
    gerencia: textoOpcional(corpo.gerencia, "Gerência", 120),
    base: textoOpcional(corpo.base, "Base", 40),
    processo,
    status,
    tipo_id: tipoId,
  };
}

async function listarEquipes(): Promise<Equipe[]> {
  const { data, error } = await db.from("equipes").select(COLUNAS_EQUIPE).order("prefixo");
  if (error) throw error;
  return data.map(paraEquipe);
}

// ---------- Exportação e importação do cadastro de equipes ----------

const nomeTipoPorId = new Map(materiais.tipos.map((tipo) => [tipo.id, tipo.nome]));
const tipoIdPorNome = new Map(materiais.tipos.map((tipo) => [normalizarTexto(tipo.nome), tipo.id]));

// Colunas da planilha, na ordem em que aparecem. O mesmo texto é usado para ler de volta na importação.
const COLUNAS_PLANILHA = [
  "Prefixo",
  "Nome",
  "Responsável",
  "Supervisor",
  "Coordenador",
  "Gerência",
  "Base",
  "Processo",
  "Tipo de equipe",
  "Status",
] as const;

function equipeParaLinha(equipe: Equipe): Record<(typeof COLUNAS_PLANILHA)[number], string> {
  return {
    Prefixo: equipe.prefixo,
    Nome: equipe.nome ?? "",
    Responsável: equipe.responsavel ?? "",
    Supervisor: equipe.supervisor ?? "",
    Coordenador: equipe.coordenador ?? "",
    Gerência: equipe.gerencia ?? "",
    Base: equipe.base ?? "",
    Processo: equipe.processo ?? "",
    "Tipo de equipe": equipe.tipoId ? (nomeTipoPorId.get(equipe.tipoId) ?? equipe.tipoId) : "",
    Status: equipe.status === "inativo" ? "Inativa" : "Ativa",
  };
}

async function exportarEquipes(): Promise<Response> {
  const equipes = await listarEquipes();
  const linhas = equipes.map(equipeParaLinha);
  const planilha = XLSX.utils.json_to_sheet(linhas, { header: [...COLUNAS_PLANILHA] });
  planilha["!cols"] = COLUNAS_PLANILHA.map((coluna) => ({ wch: Math.max(coluna.length + 2, 14) }));
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Equipes");
  // O tipo de retorno do XLSX não bate com o BodyInit mais recente do TypeScript (ArrayBufferLike vs.
  // ArrayBuffer), mas o Bun aceita o Uint8Array normalmente como corpo da resposta.
  const bytes = XLSX.write(livro, { type: "buffer", bookType: "xlsx" }) as BodyInit;
  const data = new Date().toISOString().slice(0, 10);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="equipes-paes-${data}.xlsx"`,
    },
  });
}

// Lê os cabeçalhos da planilha sem exigir grafia exata: sem acento, sem maiúsculas, com variações aceitas.
const CABECALHOS_ACEITOS: Record<string, string> = {
  prefixo: "Prefixo",
  nome: "Nome",
  responsavel: "Responsável",
  supervisor: "Supervisor",
  coordenador: "Coordenador",
  gerencia: "Gerência",
  base: "Base",
  processo: "Processo",
  tipo: "Tipo de equipe",
  "tipo de equipe": "Tipo de equipe",
  status: "Status",
};

function linhaDaPlanilha(bruta: Record<string, unknown>): Partial<Record<(typeof COLUNAS_PLANILHA)[number], string>> {
  const linha: Partial<Record<(typeof COLUNAS_PLANILHA)[number], string>> = {};
  for (const [cabecalho, valor] of Object.entries(bruta)) {
    const canonico = CABECALHOS_ACEITOS[normalizarTexto(cabecalho).trim()];
    if (!canonico) continue;
    linha[canonico as (typeof COLUNAS_PLANILHA)[number]] = valor === null || valor === undefined ? "" : String(valor).trim();
  }
  return linha;
}

const TAMANHO_MAXIMO_IMPORTACAO = 10 * 1024 * 1024;
const LIMITE_LINHAS_IMPORTACAO = 5000;
const TAMANHO_LOTE_IMPORTACAO = 200;

interface ResultadoImportacaoEquipes {
  processadas: number;
  criadas: number;
  atualizadas: number;
  ignoradas: number;
  erros: string[];
}

// Cria e atualiza equipes a partir da planilha exportada (ou de uma planilha no mesmo formato).
// Nunca remove: uma equipe que sai da planilha continua cadastrada, até ser removida manualmente.
async function importarEquipes(req: Request): Promise<Response> {
  let formulario: FormData;
  try {
    formulario = await req.formData();
  } catch {
    throw new ErroValidacao("Não foi possível ler o arquivo enviado.");
  }

  const arquivo = formulario.get("arquivo");
  if (!(arquivo instanceof File)) {
    throw new ErroValidacao('Envie um arquivo .xlsx no campo "arquivo".');
  }
  if (arquivo.size > TAMANHO_MAXIMO_IMPORTACAO) {
    throw new ErroValidacao(`O arquivo não pode passar de ${Math.round(TAMANHO_MAXIMO_IMPORTACAO / 1_000_000)} MB.`);
  }

  let livro: XLSX.WorkBook;
  try {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    livro = XLSX.read(bytes, { type: "array" });
  } catch {
    throw new ErroValidacao("Não foi possível ler a planilha. Confira se é um arquivo .xlsx válido.");
  }

  const primeiraAba = livro.SheetNames[0];
  if (!primeiraAba) throw new ErroValidacao("A planilha não tem nenhuma aba.");
  const linhasBrutas = XLSX.utils.sheet_to_json<Record<string, unknown>>(livro.Sheets[primeiraAba], { defval: "" });
  if (linhasBrutas.length === 0) throw new ErroValidacao("A planilha não tem nenhuma linha de dados.");
  if (linhasBrutas.length > LIMITE_LINHAS_IMPORTACAO) {
    throw new ErroValidacao(`A planilha tem mais de ${LIMITE_LINHAS_IMPORTACAO} linhas. Importe em partes menores.`);
  }

  const { data: existentes, error: erroExistentes } = await db.from("equipes").select("prefixo");
  if (erroExistentes) throw erroExistentes;
  const prefixosExistentes = new Set((existentes ?? []).map((linha) => linha.prefixo as string));

  const erros: string[] = [];
  const prefixosNaPlanilha = new Set<string>();
  const registros: Array<{ prefixo: string } & ReturnType<typeof validarDadosEquipe>> = [];

  linhasBrutas.forEach((bruta, indice) => {
    const numeroLinha = indice + 2; // a linha 1 é o cabeçalho
    const linha = linhaDaPlanilha(bruta);

    const prefixo = (linha.Prefixo ?? "").toUpperCase();
    if (!prefixo) {
      erros.push(`Linha ${numeroLinha}: prefixo em branco.`);
      return;
    }
    if (prefixo.length > 20) {
      erros.push(`Linha ${numeroLinha}: prefixo "${prefixo}" passa de 20 caracteres.`);
      return;
    }
    if (prefixosNaPlanilha.has(prefixo)) {
      erros.push(`Linha ${numeroLinha}: prefixo "${prefixo}" repetido na planilha.`);
      return;
    }

    const tipoTexto = linha["Tipo de equipe"] ?? "";
    let tipoId: string | null = null;
    if (tipoTexto) {
      const encontrado = tipoIdPorNome.get(normalizarTexto(tipoTexto));
      if (!encontrado) {
        erros.push(`Linha ${numeroLinha}: tipo de equipe "${tipoTexto}" não existe.`);
        return;
      }
      tipoId = encontrado;
    }

    const statusTexto = normalizarTexto(linha.Status ?? "");
    let status: "ativo" | "inativo" = "ativo";
    if (statusTexto === "inativa" || statusTexto === "inativo") {
      status = "inativo";
    } else if (statusTexto && statusTexto !== "ativa" && statusTexto !== "ativo") {
      erros.push(`Linha ${numeroLinha}: status "${linha.Status}" inválido (use Ativa ou Inativa).`);
      return;
    }

    try {
      const dados = validarDadosEquipe({
        nome: linha.Nome,
        responsavel: linha.Responsável,
        supervisor: linha.Supervisor,
        coordenador: linha.Coordenador,
        gerencia: linha.Gerência,
        base: linha.Base,
        processo: linha.Processo,
        status,
        tipoId,
      });
      prefixosNaPlanilha.add(prefixo);
      registros.push({ prefixo, ...dados });
    } catch (falha) {
      const mensagem = falha instanceof ErroValidacao ? falha.message : "dados inválidos.";
      erros.push(`Linha ${numeroLinha}: ${mensagem}`);
    }
  });

  if (registros.length === 0) {
    throw new ErroValidacao(
      "Nenhuma linha válida para importar." + (erros.length > 0 ? ` ${erros[0]}` : ""),
    );
  }

  for (let inicio = 0; inicio < registros.length; inicio += TAMANHO_LOTE_IMPORTACAO) {
    const lote = registros.slice(inicio, inicio + TAMANHO_LOTE_IMPORTACAO);
    const { error } = await db.from("equipes").upsert(lote, { onConflict: "prefixo" });
    if (error) throw error;
  }

  const criadas = registros.filter((registro) => !prefixosExistentes.has(registro.prefixo)).length;
  const resultado: ResultadoImportacaoEquipes = {
    processadas: linhasBrutas.length,
    criadas,
    atualizadas: registros.length - criadas,
    ignoradas: erros.length,
    erros: erros.slice(0, 50),
  };
  return resposta(resultado);
}

// ---------- Colaboradores ----------

const LIMITE_NOME_COLABORADOR = 120;
const TAMANHO_MAXIMO_IMPORTACAO_COLABORADORES = 5 * 1024 * 1024;

function nomeColaboradorValido(valor: unknown): string {
  const nome = typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
  if (nome.length < 3) throw new ErroValidacao("Informe o nome completo do colaborador.");
  if (nome.length > LIMITE_NOME_COLABORADOR) {
    throw new ErroValidacao(`O nome passa de ${LIMITE_NOME_COLABORADOR} caracteres.`);
  }
  return nome;
}

// Chave para comparar nomes sem acento, sem maiúsculas e com espaços normalizados.
function chaveColaborador(nome: string): string {
  return normalizarTexto(nome).replace(/\s+/g, " ").trim();
}

// Sugestões do app de campo: só os aprovados, e só o nome.
// O Supabase devolve no máximo 1000 linhas por consulta, então lê em páginas.
const TAMANHO_PAGINA_COLABORADORES = 1000;

async function listarColaboradoresAprovados(): Promise<string[]> {
  const nomes: string[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA_COLABORADORES) {
    const { data, error } = await db
      .from("colaboradores")
      .select("nome")
      .eq("status", "aprovado")
      .order("nome")
      .range(inicio, inicio + TAMANHO_PAGINA_COLABORADORES - 1);
    if (error) throw error;
    nomes.push(...data.map((linha) => linha.nome as string));
    if (data.length < TAMANHO_PAGINA_COLABORADORES) break;
  }
  return nomes;
}

// Pedido do app de campo: o nome entra como pendente e só vira sugestão depois de aprovado.
async function solicitarColaborador(corpo: Record<string, unknown>): Promise<Response> {
  const nome = nomeColaboradorValido(corpo.nome);
  const chave = chaveColaborador(nome);
  const { data: existente, error: erroBusca } = await db
    .from("colaboradores")
    .select("nome, status")
    .eq("nome_normalizado", chave)
    .maybeSingle();
  if (erroBusca) throw erroBusca;
  if (existente) return resposta({ nome: existente.nome, status: existente.status });

  const { error } = await db.from("colaboradores").insert({ nome, nome_normalizado: chave, status: "pendente" });
  if (error?.code === "23505") return resposta({ nome, status: "pendente" });
  if (error) throw error;
  return resposta({ nome, status: "pendente" }, 201);
}

async function listarColaboradores(status: string | null): Promise<Response> {
  const linhas: unknown[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA_COLABORADORES) {
    let consulta = db
      .from("colaboradores")
      .select("id, nome, status, criado_em, aprovado_em")
      .order("nome")
      .range(inicio, inicio + TAMANHO_PAGINA_COLABORADORES - 1);
    if (status === "aprovado" || status === "pendente") consulta = consulta.eq("status", status);
    const { data, error } = await consulta;
    if (error) throw error;
    linhas.push(...data);
    if (data.length < TAMANHO_PAGINA_COLABORADORES) break;
  }
  return resposta(linhas);
}

async function atualizarColaborador(id: number, corpo: Record<string, unknown>): Promise<Response> {
  if (corpo.status !== "aprovado" && corpo.status !== "pendente") throw new ErroValidacao("Status inválido.");
  const { data, error } = await db
    .from("colaboradores")
    .update({
      status: corpo.status,
      aprovado_em: corpo.status === "aprovado" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("id, nome, status");
  if (error) throw error;
  if (data.length === 0) throw new ErroValidacao("Colaborador não encontrado.", 404);
  return resposta(data[0]);
}

// Recusar um pedido pendente é apagar o nome.
async function removerColaborador(id: number): Promise<Response> {
  const { data, error } = await db.from("colaboradores").delete().eq("id", id).select("id");
  if (error) throw error;
  if (data.length === 0) throw new ErroValidacao("Colaborador não encontrado.", 404);
  return semConteudo();
}

// Importa uma lista de nomes (coluna "Nome"), já aprovados. Nomes repetidos ou inválidos são ignorados.
async function importarColaboradores(req: Request): Promise<Response> {
  let formulario: FormData;
  try {
    formulario = await req.formData();
  } catch {
    throw new ErroValidacao("Não foi possível ler o arquivo enviado.");
  }
  const arquivo = formulario.get("arquivo");
  if (!(arquivo instanceof File)) throw new ErroValidacao('Envie um arquivo .xlsx no campo "arquivo".');
  if (arquivo.size > TAMANHO_MAXIMO_IMPORTACAO_COLABORADORES) throw new ErroValidacao("O arquivo é grande demais.");

  let livro: XLSX.WorkBook;
  try {
    livro = XLSX.read(new Uint8Array(await arquivo.arrayBuffer()), { type: "array" });
  } catch {
    throw new ErroValidacao("Não foi possível ler a planilha. Confira se é um .xlsx válido.");
  }
  const primeiraAba = livro.SheetNames[0];
  if (!primeiraAba) throw new ErroValidacao("A planilha não tem nenhuma aba.");
  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(livro.Sheets[primeiraAba], { defval: "" });

  const agora = new Date().toISOString();
  const vistos = new Set<string>();
  const registros: { nome: string; nome_normalizado: string; status: "aprovado"; aprovado_em: string }[] = [];
  let ignoradas = 0;
  for (const linha of linhas) {
    const coluna = Object.keys(linha).find((cabecalho) => normalizarTexto(cabecalho).trim() === "nome");
    const nome = coluna ? String(linha[coluna] ?? "").replace(/\s+/g, " ").trim() : "";
    if (nome.length < 3 || nome.length > LIMITE_NOME_COLABORADOR) {
      ignoradas++;
      continue;
    }
    const chave = chaveColaborador(nome);
    if (vistos.has(chave)) {
      ignoradas++;
      continue;
    }
    vistos.add(chave);
    registros.push({ nome, nome_normalizado: chave, status: "aprovado", aprovado_em: agora });
  }
  if (registros.length === 0) throw new ErroValidacao('Nenhum nome válido. A planilha precisa de uma coluna "Nome".');

  for (let inicio = 0; inicio < registros.length; inicio += TAMANHO_LOTE_IMPORTACAO) {
    const lote = registros.slice(inicio, inicio + TAMANHO_LOTE_IMPORTACAO);
    const { error } = await db.from("colaboradores").upsert(lote, { onConflict: "nome_normalizado" });
    if (error) throw error;
  }
  return resposta({ processados: linhas.length, importados: registros.length, ignorados: ignoradas });
}

// O app de campo recebe só o que usa para identificar a equipe. Responsável, supervisor, coordenador e
// gerência ficam de fora: são dados de gestão, que não precisam sair do sistema administrativo.
async function listarEquipesCampo(): Promise<Pick<Equipe, "prefixo" | "nome" | "base" | "processo" | "status" | "tipoId">[]> {
  const { data, error } = await db
    .from("equipes")
    .select("prefixo, nome, base, processo, status, tipo_id")
    .order("prefixo");
  if (error) throw error;
  return data.map((linha) => ({
    prefixo: linha.prefixo,
    nome: linha.nome,
    base: linha.base,
    processo: linha.processo,
    status: linha.status,
    tipoId: linha.tipo_id,
  }));
}

// Limite de envios por IP para o app de campo, que não tem login: evita que um laço ou um abuso
// encha a base de registros. Vale para cada instância da função.
const JANELA_ENVIOS_CAMPO_MS = 60_000;
const MAXIMO_ENVIOS_CAMPO = 30;
const enviosCampo = new Map<string, number[]>();

function limitarEnviosCampo(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "desconhecido").split(",")[0].trim();
  const agora = Date.now();
  const recentes = (enviosCampo.get(ip) ?? []).filter((momento) => agora - momento < JANELA_ENVIOS_CAMPO_MS);
  if (recentes.length >= MAXIMO_ENVIOS_CAMPO) {
    throw new ErroValidacao("Muitos envios em pouco tempo. Aguarde um minuto e tente de novo.", 429);
  }
  recentes.push(agora);
  enviosCampo.set(ip, recentes);
}

async function criarEquipe(corpo: Record<string, unknown>): Promise<Response> {
  const prefixo = normalizarPrefixo(corpo.prefixo);
  const dados = validarDadosEquipe(corpo);
  const { data, error } = await db.from("equipes").insert({ prefixo, ...dados }).select(COLUNAS_EQUIPE).single();
  if (error?.code === "23505") throw new ErroValidacao(`A equipe ${prefixo} já está cadastrada.`, 409);
  if (error) throw error;
  return resposta(paraEquipe(data), 201);
}

// Substitui os campos editáveis da equipe. Os campos não enviados ficam vazios.
async function atualizarEquipe(prefixoAtual: string, corpo: Record<string, unknown>): Promise<Response> {
  const dados = validarDadosEquipe(corpo);
  const { data, error } = await db
    .from("equipes")
    .update(dados)
    .eq("prefixo", prefixoAtual)
    .select(COLUNAS_EQUIPE);
  if (error) throw error;
  if (data.length === 0) throw new ErroValidacao("Equipe não encontrada.", 404);
  return resposta(paraEquipe(data[0]));
}

async function removerEquipe(prefixo: string): Promise<Response> {
  const { data, error } = await db.from("equipes").delete().eq("prefixo", prefixo).select("prefixo");
  // 23503: violação de chave estrangeira, a equipe ainda tem blitz registrada.
  if (error?.code === "23503") {
    throw new ErroValidacao(`A equipe ${prefixo} já possui blitz registrada e não pode ser removida.`, 409);
  }
  if (error) throw error;
  if (data.length === 0) throw new ErroValidacao("Equipe não encontrada.", 404);
  return semConteudo();
}

// ---------- Blitz ----------

interface LinhaItemBlitz {
  blitz_id: number;
  item_id: number;
  status: StatusItem;
  observacao: string | null;
  quantidade_exigida: number;
  quantidade_encontrada: number;
  quantidade_nao_conforme: number;
}

async function carregarBlitzes(mes: string): Promise<BlitzResumo[]> {
  const { inicio, fim } = intervaloDoMes(mes);
  const { data: blitzes, error } = await db
    .from("blitzes")
    .select("id, data, processo, prefixo, tipo_id, colaboradores")
    .gte("data", inicio)
    .lt("data", fim)
    .order("data", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  if (blitzes.length === 0) return [];

  const { data: itens, error: erroItens } = await db
    .from("blitz_itens")
    .select("blitz_id, item_id, status, observacao, quantidade_exigida, quantidade_encontrada, quantidade_nao_conforme")
    .in(
      "blitz_id",
      blitzes.map((b) => b.id),
    );
  if (erroItens) throw erroItens;

  const itensPorBlitz = new Map<number, LinhaItemBlitz[]>();
  for (const item of itens as LinhaItemBlitz[]) {
    const lista = itensPorBlitz.get(item.blitz_id) ?? [];
    lista.push(item);
    itensPorBlitz.set(item.blitz_id, lista);
  }

  // EPI por colaborador (blitz do app de campo): quem está com Troca ou Faltante em cada item.
  const { data: pessoasEpi, error: erroPessoas } = await db
    .from("blitz_epi_pessoas")
    .select("blitz_id, item_id, colaborador, status")
    .in(
      "blitz_id",
      blitzes.map((b) => b.id),
    )
    .neq("status", "ok");
  if (erroPessoas) throw erroPessoas;

  const pessoasPorItem = new Map<string, PessoaPendente[]>();
  for (const linha of pessoasEpi as { blitz_id: number; item_id: number; colaborador: string; status: "troca" | "faltante" }[]) {
    const chave = `${linha.blitz_id}:${linha.item_id}`;
    const lista = pessoasPorItem.get(chave) ?? [];
    lista.push({ colaborador: linha.colaborador, status: linha.status });
    pessoasPorItem.set(chave, lista);
  }

  return blitzes.map((blitz) => {
    const itensBlitz = itensPorBlitz.get(blitz.id) ?? [];
    const naoConformes = itensBlitz
      .filter((item) => item.status !== "ok")
      .map((item): ItemBlitz & { descricao: string; grupo: Item["grupo"]; pessoas?: PessoaPendente[] } => {
        const material = itensPorId.get(item.item_id);
        return {
          itemId: item.item_id,
          status: item.status,
          exigida: item.quantidade_exigida,
          encontrada: item.quantidade_encontrada,
          naoConforme: item.quantidade_nao_conforme,
          observacao: item.observacao ?? undefined,
          descricao: material?.descricao ?? `Item ${item.item_id}`,
          grupo: material?.grupo ?? "EPC",
          pessoas: pessoasPorItem
            .get(`${blitz.id}:${item.item_id}`)
            ?.sort((a, b) => a.colaborador.localeCompare(b.colaborador)),
        };
      });

    return {
      id: blitz.id,
      data: blitz.data,
      processo: blitz.processo,
      prefixo: blitz.prefixo,
      tipoId: blitz.tipo_id,
      colaboradores: blitz.colaboradores as string[],
      totalItens: itensBlitz.length,
      naoConformes: naoConformes.length,
      conforme: naoConformes.length === 0,
      itensNaoConformes: naoConformes,
    };
  });
}

function validarBlitz(corpo: Partial<NovaBlitz>): NovaBlitz {
  const data = corpo.data;
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data))) {
    throw new ErroValidacao("Data da blitz inválida.");
  }

  // Processo é opcional: o app de campo grava o tipo, e o processo vem do cadastro da equipe quando existe.
  const processo = corpo.processo === undefined || corpo.processo === null || corpo.processo === "" ? null : corpo.processo;
  if (processo !== null && (typeof processo !== "string" || !(PROCESSOS as readonly string[]).includes(processo))) {
    throw new ErroValidacao("Processo inválido.");
  }

  const prefixo = normalizarPrefixo(corpo.prefixo);
  const tipoId = validarTipo(corpo.tipoId);

  const colaboradores = Array.isArray(corpo.colaboradores)
    ? corpo.colaboradores
        .map((nome) => (typeof nome === "string" ? nome.trim() : ""))
        .filter((nome) => nome.length > 0)
    : [];
  if (colaboradores.length === 0) {
    throw new ErroValidacao("Informe ao menos um colaborador.");
  }
  if (colaboradores.length > 30) {
    throw new ErroValidacao("A equipe não pode ter mais de 30 colaboradores.");
  }

  const aplicaveis = itensAplicaveis(tipoId);
  // Com o detalhe por pessoa (app de campo), os EPIs vêm por colaborador e os itens enviados são só EPC.
  const porPessoa = Array.isArray(corpo.pessoas);
  const esperados = new Set(aplicaveis.filter((item) => !porPessoa || item.grupo === "EPC").map((item) => item.id));
  const recebidos = Array.isArray(corpo.itens) ? corpo.itens : [];
  const vistos = new Set<number>();

  for (const item of recebidos) {
    if (!esperados.has(item.itemId)) {
      throw new ErroValidacao(`O item ${item.itemId} não pertence ao tipo de equipe ${tipoId}.`);
    }
    if (vistos.has(item.itemId)) {
      throw new ErroValidacao(`O item ${item.itemId} foi informado mais de uma vez.`);
    }
    if (!Number.isInteger(item.encontrada) || item.encontrada < 0 || item.encontrada > 999) {
      throw new ErroValidacao(`Quantidade encontrada inválida para o item ${item.itemId}.`);
    }
    if (!Number.isInteger(item.naoConforme) || item.naoConforme < 0 || item.naoConforme > item.encontrada) {
      throw new ErroValidacao(
        `Unidades com defeito do item ${item.itemId} não podem ser negativas nem maiores que as encontradas.`,
      );
    }
    if (item.observacao != null && (typeof item.observacao !== "string" || item.observacao.length > 500)) {
      throw new ErroValidacao(`Observação inválida para o item ${item.itemId}.`);
    }
    vistos.add(item.itemId);
  }

  const faltando = [...esperados].filter((id) => !vistos.has(id));
  if (faltando.length > 0) {
    throw new ErroValidacao(`Informe a quantidade encontrada de ${faltando.length} item(ns).`);
  }

  const idCliente = typeof corpo.idCliente === "string" && corpo.idCliente.trim() ? corpo.idCliente.trim() : null;
  if (idCliente && idCliente.length > 64) {
    throw new ErroValidacao("Identificador da blitz inválido.");
  }

  const itensEnviados = recebidos.map((item) => ({
    itemId: item.itemId,
    encontrada: item.encontrada,
    naoConforme: item.naoConforme,
    observacao: item.observacao?.trim() || undefined,
  }));
  const base = { idCliente: idCliente ?? undefined, data, processo, prefixo, tipoId, colaboradores };
  if (!porPessoa) return { ...base, itens: itensEnviados };

  // Totais de EPI derivados do detalhe por pessoa: encontrado = presente (OK ou Troca), defeito = Troca.
  const pessoas = validarPessoas(corpo.pessoas, colaboradores, aplicaveis);
  const itensEpi = aplicaveis
    .filter((item) => item.grupo === "EPI")
    .map((item) => {
      const quantidade = item.quantidades[tipoId] ?? 0;
      const presentes = pessoas.filter((p) => p.itemId === item.id && p.status !== "faltante").length;
      const trocas = pessoas.filter((p) => p.itemId === item.id && p.status === "troca").length;
      return { itemId: item.id, encontrada: quantidade * presentes, naoConforme: quantidade * trocas };
    });
  return { ...base, itens: [...itensEnviados, ...itensEpi], pessoas };
}

// Valida o EPI de cada colaborador: nome da equipe, EPI do tipo, situação válida e nenhum EPI faltando.
function validarPessoas(bruto: unknown, colaboradores: string[], aplicaveis: Item[]): PessoaItem[] {
  if (!Array.isArray(bruto)) throw new ErroValidacao("Detalhe de EPI inválido.");
  const epis = new Set(aplicaveis.filter((item) => item.grupo === "EPI").map((item) => item.id));
  const nomes = new Set(colaboradores);
  const vistos = new Set<string>();
  const pessoas: PessoaItem[] = [];
  for (const registro of bruto as Array<Record<string, unknown>>) {
    const colaborador = typeof registro?.colaborador === "string" ? registro.colaborador.trim() : "";
    const itemId = registro?.itemId;
    const status = registro?.status;
    if (!nomes.has(colaborador)) throw new ErroValidacao("EPI informado para um colaborador que não está na equipe.");
    if (typeof itemId !== "number" || !epis.has(itemId)) {
      throw new ErroValidacao(`O item ${String(itemId)} não é um EPI deste tipo de equipe.`);
    }
    if (status !== "ok" && status !== "faltante" && status !== "troca") {
      throw new ErroValidacao("Situação de EPI inválida.");
    }
    const chave = `${colaborador}|${itemId}`;
    if (vistos.has(chave)) throw new ErroValidacao("Um EPI foi informado mais de uma vez para o mesmo colaborador.");
    vistos.add(chave);
    pessoas.push({ colaborador, itemId, status });
  }
  const faltando = [...nomes].flatMap((nome) => [...epis].filter((id) => !vistos.has(`${nome}|${id}`)));
  if (faltando.length > 0) {
    throw new ErroValidacao(`Falta informar ${faltando.length} EPI(s) de colaborador.`);
  }
  return pessoas;
}

async function registrarBlitz(corpo: Partial<NovaBlitz>): Promise<Response> {
  const blitz = validarBlitz(corpo);

  // A função do banco grava equipe (se for nova), blitz e itens numa única transação.
  const { data, error } = await db.rpc("registrar_blitz", {
    p_data: blitz.data,
    p_processo: blitz.processo,
    p_prefixo: blitz.prefixo,
    p_tipo_id: blitz.tipoId,
    p_colaboradores: blitz.colaboradores,
    p_id_cliente: blitz.idCliente ?? null,
    p_pessoas: blitz.pessoas ?? [],
    p_itens: blitz.itens.map((item) => ({
      itemId: item.itemId,
      // EPI por pessoa: a quantidade exigida é por colaborador, então o total é multiplicado pela equipe.
      exigida:
        (itensPorId.get(item.itemId)?.quantidades[blitz.tipoId] ?? 0) *
        (blitz.pessoas && itensPorId.get(item.itemId)?.grupo === "EPI" ? blitz.colaboradores.length : 1),
      encontrada: item.encontrada,
      naoConforme: item.naoConforme,
      observacao: item.observacao ?? null,
    })),
  });

  if (error) {
    if (error.message.includes("TIPO_DIVERGENTE")) {
      throw new ErroValidacao(
        `A equipe ${blitz.prefixo} está cadastrada com outro tipo de equipe. Ajuste o cadastro antes de registrar a blitz.`,
        409,
      );
    }
    throw error;
  }
  return resposta({ id: Number(data) }, 201);
}

async function removerBlitz(id: number): Promise<Response> {
  const { data, error } = await db.from("blitzes").delete().eq("id", id).select("id");
  if (error) throw error;
  if (data.length === 0) throw new ErroValidacao("Blitz não encontrada.", 404);
  return semConteudo();
}

// ---------- Controle de pendências ----------

const MENSAGEM_SEM_MIGRACAO =
  "O controle de pendências ainda não está ativo no banco. Rode a migração 20261106100000_pendencias_resolvidas.sql no Supabase.";

// Coluna inexistente: a migração do controle ainda não foi rodada.
function colunaAusente(erro: { code?: string } | null): boolean {
  return erro?.code === "42703" || erro?.code === "PGRST204";
}

const TAMANHO_PAGINA_PENDENCIAS = 1000;
const LOTE_BLITZES_PENDENCIAS = 200;

interface LinhaPessoaPendente {
  id: number;
  blitz_id: number;
  item_id: number;
  colaborador: string;
  status: "troca" | "faltante";
  resolvido_em: string | null;
  resolvido_por: string | null;
}

interface LinhaItemPendente {
  blitz_id: number;
  item_id: number;
  status: "nao_ok" | "faltante";
  observacao: string | null;
  quantidade_exigida: number;
  quantidade_encontrada: number;
  quantidade_nao_conforme: number;
  resolvido_em: string | null;
  resolvido_por: string | null;
}

// Todas as Trocas e Faltantes já registrados, em aberto ou resolvidos, do mais recente para o mais antigo.
async function carregarPendencias(): Promise<Pendencia[]> {
  const pessoas: LinhaPessoaPendente[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA_PENDENCIAS) {
    const { data, error } = await db
      .from("blitz_epi_pessoas")
      .select("id, blitz_id, item_id, colaborador, status, resolvido_em, resolvido_por")
      .neq("status", "ok")
      .order("id")
      .range(inicio, inicio + TAMANHO_PAGINA_PENDENCIAS - 1);
    if (colunaAusente(error)) throw new ErroValidacao(MENSAGEM_SEM_MIGRACAO, 503);
    if (error) throw error;
    pessoas.push(...(data as LinhaPessoaPendente[]));
    if (data.length < TAMANHO_PAGINA_PENDENCIAS) break;
  }

  const itens: LinhaItemPendente[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA_PENDENCIAS) {
    const { data, error } = await db
      .from("blitz_itens")
      .select(
        "blitz_id, item_id, status, observacao, quantidade_exigida, quantidade_encontrada, quantidade_nao_conforme, resolvido_em, resolvido_por",
      )
      .neq("status", "ok")
      .order("blitz_id")
      .order("item_id")
      .range(inicio, inicio + TAMANHO_PAGINA_PENDENCIAS - 1);
    if (colunaAusente(error)) throw new ErroValidacao(MENSAGEM_SEM_MIGRACAO, 503);
    if (error) throw error;
    itens.push(...(data as LinhaItemPendente[]));
    if (data.length < TAMANHO_PAGINA_PENDENCIAS) break;
  }

  // O EPI de blitz do app de campo já aparece por colaborador; a linha da equipe seria uma repetição.
  const coberto = new Set(pessoas.map((linha) => `${linha.blitz_id}:${linha.item_id}`));
  const itensDaEquipe = itens.filter((linha) => !coberto.has(`${linha.blitz_id}:${linha.item_id}`));

  const idsBlitz = [...new Set([...pessoas.map((l) => l.blitz_id), ...itensDaEquipe.map((l) => l.blitz_id)])];
  const blitzes = new Map<number, { data: string; prefixo: string; processo: string | null }>();
  for (let inicio = 0; inicio < idsBlitz.length; inicio += LOTE_BLITZES_PENDENCIAS) {
    const { data, error } = await db
      .from("blitzes")
      .select("id, data, prefixo, processo")
      .in("id", idsBlitz.slice(inicio, inicio + LOTE_BLITZES_PENDENCIAS));
    if (error) throw error;
    for (const blitz of data) blitzes.set(blitz.id, { data: blitz.data, prefixo: blitz.prefixo, processo: blitz.processo });
  }

  const pendencias: Pendencia[] = [];
  const base = (blitzId: number, itemId: number) => {
    const material = itensPorId.get(itemId);
    const blitz = blitzes.get(blitzId);
    return {
      blitzId,
      itemId,
      descricao: material?.descricao ?? `Item ${itemId}`,
      grupo: material?.grupo ?? ("EPC" as Item["grupo"]),
      prefixo: blitz?.prefixo ?? "",
      processo: blitz?.processo ?? null,
      data: blitz?.data ?? "",
    };
  };

  for (const linha of pessoas) {
    pendencias.push({
      ...base(linha.blitz_id, linha.item_id),
      chave: `epi:${linha.id}`,
      status: linha.status,
      quantidade: 1,
      colaborador: linha.colaborador,
      observacao: null,
      resolvidaEm: linha.resolvido_em,
      resolvidaPor: linha.resolvido_por,
    });
  }
  for (const linha of itensDaEquipe) {
    const faltante = linha.status === "faltante";
    pendencias.push({
      ...base(linha.blitz_id, linha.item_id),
      chave: `item:${linha.blitz_id}:${linha.item_id}`,
      status: faltante ? "faltante" : "troca",
      quantidade: Math.max(1, faltante ? linha.quantidade_exigida - linha.quantidade_encontrada : linha.quantidade_nao_conforme),
      colaborador: null,
      observacao: linha.observacao,
      resolvidaEm: linha.resolvido_em,
      resolvidaPor: linha.resolvido_por,
    });
  }

  return pendencias.sort(
    (a, b) =>
      b.data.localeCompare(a.data) ||
      a.prefixo.localeCompare(b.prefixo) ||
      a.descricao.localeCompare(b.descricao) ||
      (a.colaborador ?? "").localeCompare(b.colaborador ?? ""),
  );
}

type FiltroSituacao = "abertas" | "resolvidas" | "todas";

function lerFiltroPendencias(url: URL): FiltroSituacao {
  const valor = url.searchParams.get("situacao") ?? "abertas";
  if (valor !== "abertas" && valor !== "resolvidas" && valor !== "todas") {
    throw new ErroValidacao("Filtro de situação inválido.");
  }
  return valor;
}

function filtrarPendencias(todas: Pendencia[], filtro: FiltroSituacao): Pendencia[] {
  if (filtro === "abertas") return todas.filter((p) => p.resolvidaEm === null);
  if (filtro === "resolvidas") return todas.filter((p) => p.resolvidaEm !== null);
  return todas;
}

async function listarPendencias(filtro: FiltroSituacao): Promise<ListaPendencias> {
  const todas = await carregarPendencias();
  const abertas = todas.filter((p) => p.resolvidaEm === null).length;
  return { pendencias: filtrarPendencias(todas, filtro), abertas, resolvidas: todas.length - abertas };
}

// Marca como resolvida (item trocado ou entregue) ou reabre uma pendência.
async function resolverPendencia(corpo: Record<string, unknown>, usuario: UsuarioSessao): Promise<Response> {
  const chave = typeof corpo.chave === "string" ? corpo.chave : "";
  if (typeof corpo.resolvida !== "boolean") throw new ErroValidacao("Informe se a pendência foi resolvida.");
  const alteracao = corpo.resolvida
    ? { resolvido_em: new Date().toISOString(), resolvido_por: usuario.nome }
    : { resolvido_em: null, resolvido_por: null };

  const pessoa = chave.match(/^epi:(\d+)$/);
  const item = chave.match(/^item:(\d+):(\d+)$/);
  if (!pessoa && !item) throw new ErroValidacao("Pendência inválida.");

  const consulta = pessoa
    ? db.from("blitz_epi_pessoas").update(alteracao).eq("id", Number(pessoa[1])).neq("status", "ok").select("id")
    : db
        .from("blitz_itens")
        .update(alteracao)
        .eq("blitz_id", Number(item![1]))
        .eq("item_id", Number(item![2]))
        .neq("status", "ok")
        .select("blitz_id");
  const { data, error } = await consulta;
  if (colunaAusente(error)) throw new ErroValidacao(MENSAGEM_SEM_MIGRACAO, 503);
  if (error) throw error;
  if (data.length === 0) throw new ErroValidacao("Pendência não encontrada.", 404);
  return resposta({ chave, resolvidaEm: alteracao.resolvido_em, resolvidaPor: alteracao.resolvido_por });
}

const COLUNAS_PENDENCIAS = [
  "Data da blitz",
  "Equipe",
  "Processo",
  "Material",
  "Grupo",
  "Situação",
  "Quantidade",
  "Colaborador",
  "Observação",
  "Controle",
  "Resolvida em",
  "Resolvida por",
] as const;

async function exportarPendencias(filtro: FiltroSituacao): Promise<Response> {
  const lista = filtrarPendencias(await carregarPendencias(), filtro);
  const formatarDia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
  const linhas = lista.map((p) => ({
    "Data da blitz": formatarDia(p.data),
    Equipe: p.prefixo,
    Processo: p.processo ?? "",
    Material: p.descricao,
    Grupo: p.grupo,
    Situação: p.status === "faltante" ? "Faltante" : "Troca",
    Quantidade: p.quantidade,
    Colaborador: p.colaborador ?? "Equipe",
    Observação: p.observacao ?? "",
    Controle: p.resolvidaEm ? "Resolvida" : "Em aberto",
    "Resolvida em": p.resolvidaEm ? formatarDia(p.resolvidaEm) : "",
    "Resolvida por": p.resolvidaPor ?? "",
  }));
  const planilha = XLSX.utils.json_to_sheet(linhas, { header: [...COLUNAS_PENDENCIAS] });
  planilha["!cols"] = COLUNAS_PENDENCIAS.map((coluna) => ({ wch: coluna === "Material" ? 60 : Math.max(coluna.length + 2, 14) }));
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Pendências");
  const bytes = XLSX.write(livro, { type: "buffer", bookType: "xlsx" }) as BodyInit;
  const data = new Date().toISOString().slice(0, 10);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pendencias-paes-${data}.xlsx"`,
    },
  });
}

// ---------- Dashboard ----------

async function montarDashboard(mes: string): Promise<Dashboard> {
  const [blitzes, equipes, pendencias] = await Promise.all([
    carregarBlitzes(mes),
    listarEquipes(),
    // Nulo enquanto a migração do controle não foi rodada: o dashboard continua funcionando sem o número.
    carregarPendencias().catch(() => null),
  ]);

  const porEquipe = new Map<string, BlitzResumo[]>();
  for (const blitz of blitzes) {
    const lista = porEquipe.get(blitz.prefixo) ?? [];
    lista.push(blitz);
    porEquipe.set(blitz.prefixo, lista);
  }

  const ranking: RankingEquipe[] = equipes.map((equipe) => {
    // blitzes chegam em ordem decrescente de data: a primeira é a mais recente
    const lista = porEquipe.get(equipe.prefixo) ?? [];
    const ultima = lista[0];
    return {
      prefixo: equipe.prefixo,
      tipoId: equipe.tipoId,
      processo: equipe.processo,
      base: equipe.base,
      blitzes: lista.length,
      ultimaData: ultima?.data ?? null,
      conforme: ultima ? ultima.conforme : null,
    };
  });

  const participantes = ranking
    .filter((equipe) => equipe.blitzes > 0)
    .sort((a, b) => b.blitzes - a.blitzes || a.prefixo.localeCompare(b.prefixo));
  const naoParticipantes = ranking
    .filter((equipe) => equipe.blitzes === 0)
    .sort((a, b) => a.prefixo.localeCompare(b.prefixo));

  const conformes = participantes.filter((equipe) => equipe.conforme === true).length;
  const percentualConformes =
    participantes.length > 0 ? Math.round((conformes / participantes.length) * 1000) / 10 : null;

  const contagemItens = new Map<number, RankingItem>();
  for (const blitz of blitzes) {
    for (const item of blitz.itensNaoConformes) {
      const registro = contagemItens.get(item.itemId) ?? {
        itemId: item.itemId,
        descricao: item.descricao,
        grupo: item.grupo,
        unidadesFaltantes: 0,
        faltantes: 0,
        naoOk: 0,
        total: 0,
      };
      if (item.status === "faltante") registro.faltantes += 1;
      else registro.naoOk += 1;
      registro.unidadesFaltantes += Math.max(0, item.exigida - item.encontrada);
      registro.total = registro.faltantes + registro.naoOk;
      contagemItens.set(item.itemId, registro);
    }
  }

  const itensPendentes = [...contagemItens.values()].sort(
    (a, b) => b.total - a.total || b.faltantes - a.faltantes || a.descricao.localeCompare(b.descricao),
  );

  return {
    mes,
    totalBlitzes: blitzes.length,
    equipesParticipantes: participantes.length,
    equipesTotais: equipes.length,
    percentualConformes,
    pendenciasAbertas: pendencias ? pendencias.filter((p) => p.resolvidaEm === null).length : null,
    participantes,
    naoParticipantes,
    itensPendentes,
  };
}

// ---------- Usuários (só administrador) ----------

const COLUNAS_USUARIO = "id, login, nome, admin, ativo, criado_em";

const MENSAGEM_SEM_PERFIL =
  "A página Usuários ainda não está ativa no banco. Rode a migração 20261107100000_usuarios_perfil.sql no Supabase.";

interface LinhaUsuarioCompleta {
  id: number;
  login: string;
  nome: string;
  admin: boolean;
  ativo: boolean;
  criado_em: string;
}

function paraUsuarioGerenciado(linha: LinhaUsuarioCompleta): UsuarioGerenciado {
  return {
    id: linha.id,
    login: linha.login,
    nome: linha.nome,
    admin: linha.admin,
    ativo: linha.ativo,
    criadoEm: linha.criado_em,
  };
}

function loginDeUsuarioValido(bruto: unknown): string {
  const login = typeof bruto === "string" ? bruto.trim().toLowerCase() : "";
  if (!/^[a-z0-9._@+-]{3,120}$/.test(login)) {
    throw new ErroValidacao("Login inválido. Use de 3 a 120 caracteres: letras, números e . _ @ + -");
  }
  return login;
}

function nomeDeUsuarioValido(bruto: unknown): string {
  const nome = typeof bruto === "string" ? bruto.trim().replace(/\s+/g, " ") : "";
  if (nome.length < 2 || nome.length > 120) throw new ErroValidacao("Informe o nome, com 2 a 120 caracteres.");
  return nome;
}

function senhaDeUsuarioValida(bruto: unknown): string {
  if (typeof bruto !== "string" || bruto.length < 8 || bruto.length > 128) {
    throw new ErroValidacao("A senha precisa ter de 8 a 128 caracteres.");
  }
  return bruto;
}

function booleanoOpcional(corpo: Record<string, unknown>, campo: string): boolean | undefined {
  const valor = corpo[campo];
  if (valor === undefined) return undefined;
  if (typeof valor !== "boolean") throw new ErroValidacao(`Valor inválido para "${campo}".`);
  return valor;
}

// Senha gerada: 12 caracteres sem os que se confundem (0 O 1 l I), em grupos de quatro para ditar ou digitar.
function gerarSenha(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const caracteres = Array.from({ length: 12 }, () => alfabeto[randomInt(alfabeto.length)]);
  return [caracteres.slice(0, 4), caracteres.slice(4, 8), caracteres.slice(8, 12)].map((g) => g.join("")).join("-");
}

async function carregarUsuario(id: number): Promise<LinhaUsuarioCompleta> {
  const { data, error } = await db.from("usuarios").select(COLUNAS_USUARIO).eq("id", id).maybeSingle();
  if (error?.code === "42703") throw new ErroValidacao(MENSAGEM_SEM_PERFIL, 503);
  if (error) throw error;
  if (!data) throw new ErroValidacao("Usuário não encontrado.", 404);
  return data as unknown as LinhaUsuarioCompleta;
}

async function outrosAdministradoresAtivos(excluindoId: number): Promise<number> {
  const { count, error } = await db
    .from("usuarios")
    .select("id", { count: "exact", head: true })
    .eq("admin", true)
    .eq("ativo", true)
    .neq("id", excluindoId);
  if (error) throw error;
  return count ?? 0;
}

async function listarUsuarios(): Promise<Response> {
  const { data, error } = await db.from("usuarios").select(COLUNAS_USUARIO).order("nome");
  if (error?.code === "42703") throw new ErroValidacao(MENSAGEM_SEM_PERFIL, 503);
  if (error) throw error;
  return resposta((data as unknown as LinhaUsuarioCompleta[]).map(paraUsuarioGerenciado));
}

async function criarUsuario(corpo: Record<string, unknown>): Promise<Response> {
  const login = loginDeUsuarioValido(corpo.login);
  const nome = nomeDeUsuarioValido(corpo.nome);
  const senha = senhaDeUsuarioValida(corpo.senha);
  const admin = booleanoOpcional(corpo, "admin") ?? false;

  const { data, error } = await db
    .from("usuarios")
    .insert({ login, nome, senha_hash: await Bun.password.hash(senha), admin, ativo: true })
    .select(COLUNAS_USUARIO)
    .single();
  if (error?.code === "23505") throw new ErroValidacao("Já existe um usuário com este login.", 409);
  if (error?.code === "42703") throw new ErroValidacao(MENSAGEM_SEM_PERFIL, 503);
  if (error) throw error;
  return resposta(paraUsuarioGerenciado(data as unknown as LinhaUsuarioCompleta), 201);
}

// Edita nome, login, perfil e situação. A senha tem rota própria.
async function atualizarUsuario(id: number, corpo: Record<string, unknown>, quemEdita: UsuarioSessao): Promise<Response> {
  const alvo = await carregarUsuario(id);
  const nome = corpo.nome !== undefined ? nomeDeUsuarioValido(corpo.nome) : alvo.nome;
  const login = corpo.login !== undefined ? loginDeUsuarioValido(corpo.login) : alvo.login;
  const admin = booleanoOpcional(corpo, "admin") ?? alvo.admin;
  const ativo = booleanoOpcional(corpo, "ativo") ?? alvo.ativo;

  if (id === quemEdita.id && (!admin || !ativo)) {
    throw new ErroValidacao("Você não pode tirar o seu próprio perfil de administrador nem desativar a sua conta.", 409);
  }
  const deixaDeSerAdministradorAtivo = alvo.admin && alvo.ativo && (!admin || !ativo);
  if (deixaDeSerAdministradorAtivo && (await outrosAdministradoresAtivos(id)) === 0) {
    throw new ErroValidacao("É preciso manter pelo menos um administrador ativo.", 409);
  }

  const { data, error } = await db
    .from("usuarios")
    .update({ nome, login, admin, ativo })
    .eq("id", id)
    .select(COLUNAS_USUARIO)
    .single();
  if (error?.code === "23505") throw new ErroValidacao("Já existe um usuário com este login.", 409);
  if (error) throw error;

  // Desativar derruba as sessões abertas na hora.
  if (alvo.ativo && !ativo) await encerrarSessoesDoUsuario(id);
  return resposta(paraUsuarioGerenciado(data as unknown as LinhaUsuarioCompleta));
}

// Define a nova senha informada ou gera uma. A senha gerada volta uma única vez, na resposta.
async function redefinirSenhaUsuario(
  id: number,
  corpo: Record<string, unknown>,
  quemEdita: UsuarioSessao,
  tokenAtual: string | null,
): Promise<Response> {
  const gerar = corpo.gerar === true;
  const senha = gerar ? gerarSenha() : senhaDeUsuarioValida(corpo.senha);
  await carregarUsuario(id);

  const { error } = await db.from("usuarios").update({ senha_hash: await Bun.password.hash(senha) }).eq("id", id);
  if (error) throw error;

  // Quem perdeu a senha antiga não pode continuar logado com ela. Na própria conta, a sessão atual é mantida.
  await encerrarSessoesDoUsuario(id, id === quemEdita.id ? tokenAtual : null);
  return resposta({ senha: gerar ? senha : null });
}

async function excluirUsuario(id: number, quemEdita: UsuarioSessao): Promise<Response> {
  if (id === quemEdita.id) throw new ErroValidacao("Você não pode excluir a sua própria conta.", 409);
  const alvo = await carregarUsuario(id);
  if (alvo.admin && alvo.ativo && (await outrosAdministradoresAtivos(id)) === 0) {
    throw new ErroValidacao("É preciso manter pelo menos um administrador ativo.", 409);
  }
  // As sessões do usuário saem junto (chave estrangeira com exclusão em cascata).
  const { error } = await db.from("usuarios").delete().eq("id", id);
  if (error) throw error;
  return semConteudo();
}

// ---------- Autenticação ----------

function respostaComSessao(usuario: UsuarioSessao, token: string, seguro: boolean): Response {
  return Response.json(usuario, {
    headers: { "Set-Cookie": cabecalhoCookie(token, seguro) },
  });
}

async function entrar(req: Request, url: URL): Promise<Response> {
  const corpo = await lerJson<{ login?: unknown; senha?: unknown }>(req);
  const login = typeof corpo.login === "string" ? corpo.login.trim() : "";
  const senha = typeof corpo.senha === "string" ? corpo.senha : "";
  if (!login || !senha) throw new ErroValidacao("Informe login e senha.");

  if (loginBloqueado(login)) {
    throw new ErroValidacao("Muitas tentativas. Aguarde 15 minutos e tente de novo.", 429);
  }

  const usuario = await verificarCredenciais(login, senha);
  if (!usuario) {
    registrarFalhaLogin(login);
    throw new ErroValidacao("Login ou senha inválidos.", 401);
  }

  limparFalhasLogin(login);
  const token = await criarSessao(usuario.id);
  return respostaComSessao(usuario, token, url.protocol === "https:");
}

async function sair(req: Request, url: URL): Promise<Response> {
  const token = lerTokenDoCookie(req.headers.get("cookie"));
  if (token) await encerrarSessao(token);
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": cabecalhoCookie("", url.protocol === "https:", true) },
  });
}

// ---------- Roteamento ----------

export async function tratarApi(req: Request, url: URL): Promise<Response> {
  const caminho = url.pathname.replace(/\/+$/, "");
  const metodo = req.method;

  if (metodo === "POST" && caminho === "/api/auth/login") return entrar(req, url);
  if (metodo === "POST" && caminho === "/api/auth/logout") return sair(req, url);
  if (metodo === "GET" && caminho === "/api/auth/me") {
    const usuario = await usuarioDaSessao(lerTokenDoCookie(req.headers.get("cookie")));
    if (!usuario) throw new ErroValidacao("Sessão não iniciada.", 401);
    return resposta(usuario);
  }

  // App de campo (/campo): sem login. Só lê o prefixo, o tipo e o processo das equipes e grava blitz.
  if (metodo === "GET" && caminho === "/api/campo/equipes") return resposta(await listarEquipesCampo());
  if (metodo === "GET" && caminho === "/api/campo/colaboradores") return resposta(await listarColaboradoresAprovados());
  if (metodo === "POST" && caminho === "/api/campo/colaboradores") {
    limitarEnviosCampo(req);
    return solicitarColaborador(await lerJson(req));
  }
  if (metodo === "POST" && caminho === "/api/campo/blitz") {
    limitarEnviosCampo(req);
    return registrarBlitz(await lerJson<Partial<NovaBlitz>>(req));
  }

  // Daqui em diante, toda rota exige sessão válida.
  const usuario = await usuarioDaSessao(lerTokenDoCookie(req.headers.get("cookie")));
  if (!usuario) {
    throw new ErroValidacao("Sessão expirada. Entre novamente.", 401);
  }

  // Página Usuários: só administrador. A conferência é do servidor; esconder a aba no painel não basta.
  if (caminho === "/api/usuarios" || caminho.startsWith("/api/usuarios/")) {
    if (!usuario.admin) throw new ErroValidacao("Acesso restrito ao administrador.", 403);
    if (caminho === "/api/usuarios") {
      if (metodo === "GET") return listarUsuarios();
      if (metodo === "POST") return criarUsuario(await lerJson(req));
    }
    const matchUsuario = caminho.match(/^\/api\/usuarios\/(\d+)(\/senha)?$/);
    if (matchUsuario) {
      const id = Number(matchUsuario[1]);
      if (matchUsuario[2]) {
        if (metodo === "POST") {
          return redefinirSenhaUsuario(id, await lerJson(req), usuario, lerTokenDoCookie(req.headers.get("cookie")));
        }
      } else {
        if (metodo === "PUT") return atualizarUsuario(id, await lerJson(req), usuario);
        if (metodo === "DELETE") return excluirUsuario(id, usuario);
      }
    }
  }

  if (metodo === "GET" && caminho === "/api/materiais") return resposta(materiais);

  if (metodo === "GET" && caminho === "/api/colaboradores") return listarColaboradores(url.searchParams.get("status"));
  if (metodo === "POST" && caminho === "/api/colaboradores/importar") return importarColaboradores(req);
  const matchColaborador = caminho.match(/^\/api\/colaboradores\/(\d+)$/);
  if (matchColaborador) {
    const id = Number(matchColaborador[1]);
    if (metodo === "PUT") return atualizarColaborador(id, await lerJson(req));
    if (metodo === "DELETE") return removerColaborador(id);
  }

  if (metodo === "GET" && caminho === "/api/equipes/exportar") return exportarEquipes();
  if (metodo === "POST" && caminho === "/api/equipes/importar") return importarEquipes(req);

  if (caminho === "/api/equipes") {
    if (metodo === "GET") return resposta(await listarEquipes());
    if (metodo === "POST") return criarEquipe(await lerJson(req));
  }

  const matchEquipe = caminho.match(/^\/api\/equipes\/(.+)$/);
  if (matchEquipe) {
    const prefixo = decodeURIComponent(matchEquipe[1]).toUpperCase();
    if (metodo === "PUT") return atualizarEquipe(prefixo, await lerJson(req));
    if (metodo === "DELETE") return removerEquipe(prefixo);
  }

  // A blitz é registrada só pelo app de campo (/api/campo/blitz). O painel apenas consulta e exclui.
  if (caminho === "/api/blitz" && metodo === "GET") return resposta(await carregarBlitzes(lerMes(url)));

  const matchBlitz = caminho.match(/^\/api\/blitz\/(\d+)$/);
  if (matchBlitz && metodo === "DELETE") return removerBlitz(Number(matchBlitz[1]));

  if (metodo === "GET" && caminho === "/api/pendencias") return resposta(await listarPendencias(lerFiltroPendencias(url)));
  if (metodo === "GET" && caminho === "/api/pendencias/exportar") return exportarPendencias(lerFiltroPendencias(url));
  if (metodo === "POST" && caminho === "/api/pendencias/resolver") return resolverPendencia(await lerJson(req), usuario);

  if (metodo === "GET" && caminho === "/api/dashboard") return resposta(await montarDashboard(lerMes(url)));

  throw new ErroValidacao("Rota não encontrada.", 404);
}
