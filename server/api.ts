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
  RankingEquipe,
  RankingItem,
  StatusItem,
} from "../src/lib/tipos";
import {
  cabecalhoCookie,
  criarSessao,
  encerrarSessao,
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
      "Content-Disposition": `attachment; filename="equipes-cem-${data}.xlsx"`,
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
async function listarColaboradoresAprovados(): Promise<string[]> {
  const { data, error } = await db.from("colaboradores").select("nome").eq("status", "aprovado").order("nome");
  if (error) throw error;
  return data.map((linha) => linha.nome as string);
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
  let consulta = db.from("colaboradores").select("id, nome, status, criado_em, aprovado_em").order("nome");
  if (status === "aprovado" || status === "pendente") consulta = consulta.eq("status", status);
  const { data, error } = await consulta;
  if (error) throw error;
  return resposta(data);
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

  return blitzes.map((blitz) => {
    const itensBlitz = itensPorBlitz.get(blitz.id) ?? [];
    const naoConformes = itensBlitz
      .filter((item) => item.status !== "ok")
      .map((item): ItemBlitz & { descricao: string; grupo: Item["grupo"] } => {
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
  const esperados = new Set(aplicaveis.map((item) => item.id));
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

  return {
    idCliente: idCliente ?? undefined,
    data,
    processo,
    prefixo,
    tipoId,
    colaboradores,
    itens: recebidos.map((item) => ({
      itemId: item.itemId,
      encontrada: item.encontrada,
      naoConforme: item.naoConforme,
      observacao: item.observacao?.trim() || undefined,
    })),
  };
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
    p_itens: blitz.itens.map((item) => ({
      itemId: item.itemId,
      exigida: itensPorId.get(item.itemId)?.quantidades[blitz.tipoId] ?? 0,
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

// ---------- Dashboard ----------

async function montarDashboard(mes: string): Promise<Dashboard> {
  const [blitzes, equipes] = await Promise.all([carregarBlitzes(mes), listarEquipes()]);

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
    participantes,
    naoParticipantes,
    itensPendentes,
  };
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
  if (!(await usuarioDaSessao(lerTokenDoCookie(req.headers.get("cookie"))))) {
    throw new ErroValidacao("Sessão expirada. Entre novamente.", 401);
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

  if (caminho === "/api/blitz") {
    if (metodo === "GET") return resposta(await carregarBlitzes(lerMes(url)));
    if (metodo === "POST") return registrarBlitz(await lerJson<Partial<NovaBlitz>>(req));
  }

  const matchBlitz = caminho.match(/^\/api\/blitz\/(\d+)$/);
  if (matchBlitz && metodo === "DELETE") return removerBlitz(Number(matchBlitz[1]));

  if (metodo === "GET" && caminho === "/api/dashboard") return resposta(await montarDashboard(lerMes(url)));

  throw new ErroValidacao("Rota não encontrada.", 404);
}
