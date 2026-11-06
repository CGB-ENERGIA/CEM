// Catálogo de materiais: a lista de EPI e EPC por tipo de equipe.
//
// Fica na tabela materiais_itens (migração 20261108100000_catalogo_materiais.sql). Na primeira consulta com a
// tabela vazia, o servidor carrega os itens do arquivo src/lib/data/materiais.json, com os mesmos ids que as blitz
// já gravadas usam. Enquanto a migração não rodou, o sistema continua funcionando com o arquivo, só que sem edição.
//
// Os tipos de equipe são fixos (vêm do arquivo). Remover um item só o desativa: ele sai das listas e das próximas
// blitz, mas continua no histórico, nas pendências e nas descrições das blitz antigas.

import materiaisJson from "../src/lib/data/materiais.json";
import type {
  DadosItem,
  Grupo,
  ItemCampo,
  ItemCatalogo,
  Materiais,
  MateriaisCampo,
  MateriaisCatalogo,
  TipoEquipe,
} from "../src/lib/tipos";
import { db } from "./db";
import { ErroValidacao } from "./erros";

const ARQUIVO = materiaisJson as Materiais;

export const TIPOS: TipoEquipe[] = ARQUIVO.tipos;
const IDS_DOS_TIPOS = new Set(TIPOS.map((tipo) => tipo.id));

const PAGINA = 1000;
const DURACAO_CACHE_MS = 15_000;
const DATA_DA_CARGA_INICIAL = "2000-01-01T00:00:00.000Z";

const MENSAGEM_SEM_TABELA =
  "O catálogo de materiais ainda não está no banco. Rode a migração 20261108100000_catalogo_materiais.sql no Supabase.";

interface LinhaItem {
  id: number;
  grupo: Grupo;
  descricao: string;
  tempo_util: number;
  preco: number | string;
  quantidades: Record<string, number> | null;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface Catalogo extends MateriaisCatalogo {
  porId: Map<number, ItemCatalogo>;
  // Quando cada item entrou no catálogo (ms). Serve para saber o que uma blitz antiga já devia conter.
  criadoEmMs: Map<number, number>;
}

const COLUNAS = "id, grupo, descricao, tempo_util, preco, quantidades, ativo, criado_em, atualizado_em";

// Tabela inexistente: 42P01 no Postgres, PGRST205 quando o PostgREST ainda não a conhece.
function semTabela(erro: { code?: string } | null): boolean {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

function completarQuantidades(bruto: Record<string, number> | null | undefined): Record<string, number> {
  const quantidades: Record<string, number> = {};
  for (const tipo of TIPOS) quantidades[tipo.id] = Number(bruto?.[tipo.id] ?? 0);
  return quantidades;
}

function paraItem(linha: LinhaItem): ItemCatalogo {
  return {
    id: linha.id,
    grupo: linha.grupo,
    descricao: linha.descricao,
    preco: Number(linha.preco),
    tempoUtil: linha.tempo_util,
    quantidades: completarQuantidades(linha.quantidades),
    ativo: linha.ativo,
  };
}

function montar(linhas: LinhaItem[], noBanco: boolean): Catalogo {
  const itens = linhas.map(paraItem).sort((a, b) => a.id - b.id);
  const criadoEmMs = new Map(linhas.map((l) => [l.id, Date.parse(l.criado_em)]));
  const ultima = linhas.reduce((maior, l) => Math.max(maior, Date.parse(l.atualizado_em), Date.parse(l.criado_em)), 0);
  return {
    tipos: TIPOS,
    itens,
    versao: new Date(ultima || Date.parse(DATA_DA_CARGA_INICIAL)).toISOString(),
    noBanco,
    porId: new Map(itens.map((item) => [item.id, item])),
    criadoEmMs,
  };
}

function doArquivo(): Catalogo {
  const linhas: LinhaItem[] = ARQUIVO.itens.map((item) => ({
    id: item.id,
    grupo: item.grupo,
    descricao: item.descricao,
    tempo_util: item.tempoUtil,
    preco: item.preco,
    quantidades: item.quantidades,
    ativo: true,
    criado_em: DATA_DA_CARGA_INICIAL,
    atualizado_em: DATA_DA_CARGA_INICIAL,
  }));
  return montar(linhas, false);
}

async function lerLinhas(): Promise<LinhaItem[] | null> {
  const linhas: LinhaItem[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await db
      .from("materiais_itens")
      .select(COLUNAS)
      .order("id")
      .range(inicio, inicio + PAGINA - 1);
    if (semTabela(error)) return null;
    if (error) throw error;
    linhas.push(...(data as unknown as LinhaItem[]));
    if (data.length < PAGINA) break;
  }
  return linhas;
}

// Carga inicial: os itens do arquivo entram com os mesmos ids. Duas instâncias podem tentar ao mesmo tempo; o
// segundo grupo de linhas é ignorado.
async function semear() {
  const linhas = ARQUIVO.itens.map((item) => ({
    id: item.id,
    grupo: item.grupo,
    descricao: item.descricao,
    tempo_util: item.tempoUtil,
    preco: item.preco,
    quantidades: completarQuantidades(item.quantidades),
    ativo: true,
    criado_em: DATA_DA_CARGA_INICIAL,
    atualizado_em: DATA_DA_CARGA_INICIAL,
  }));
  for (let inicio = 0; inicio < linhas.length; inicio += 100) {
    const { error } = await db
      .from("materiais_itens")
      .upsert(linhas.slice(inicio, inicio + 100), { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
}

let cache: { catalogo: Catalogo; expira: number } | null = null;

export function invalidarCatalogo() {
  cache = null;
}

// Catálogo completo, inclusive os itens removidos (as blitz antigas ainda os citam). Vale por poucos segundos.
export async function obterCatalogo(): Promise<Catalogo> {
  if (cache && cache.expira > Date.now()) return cache.catalogo;

  let linhas = await lerLinhas();
  let catalogo: Catalogo;
  if (linhas === null) {
    catalogo = doArquivo();
  } else {
    if (linhas.length === 0) {
      await semear();
      linhas = (await lerLinhas()) ?? [];
    }
    catalogo = montar(linhas, true);
  }
  cache = { catalogo, expira: Date.now() + DURACAO_CACHE_MS };
  return catalogo;
}

// O que o app de campo recebe: só os itens ativos, sem preço nem tempo útil.
export function catalogoParaCampo(catalogo: Catalogo): MateriaisCampo {
  const itens: ItemCampo[] = catalogo.itens
    .filter((item) => item.ativo)
    .map(({ id, grupo, descricao, quantidades }) => ({ id, grupo, descricao, quantidades }));
  return { tipos: catalogo.tipos, itens, versao: catalogo.versao };
}

// ---------- Edição ----------

export function validarDadosItem(corpo: Record<string, unknown>): DadosItem {
  const grupo = corpo.grupo;
  if (grupo !== "EPI" && grupo !== "EPC") throw new ErroValidacao("Escolha o grupo do item: EPI ou EPC.");

  const descricao = typeof corpo.descricao === "string" ? corpo.descricao.trim().replace(/\s+/g, " ") : "";
  if (descricao.length < 3 || descricao.length > 200) {
    throw new ErroValidacao("Informe a descrição do item, com 3 a 200 caracteres.");
  }

  const tempoUtil = corpo.tempoUtil;
  if (typeof tempoUtil !== "number" || !Number.isInteger(tempoUtil) || tempoUtil < 0 || tempoUtil > 600) {
    throw new ErroValidacao("O tempo útil é um número inteiro de meses, de 0 a 600.");
  }

  const preco = corpo.preco;
  if (typeof preco !== "number" || !Number.isFinite(preco) || preco < 0 || preco > 1_000_000) {
    throw new ErroValidacao("O preço precisa ser um valor de 0 a 1.000.000.");
  }

  const bruto = corpo.quantidades;
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    throw new ErroValidacao("Informe as quantidades por tipo de equipe.");
  }
  const quantidades: Record<string, number> = {};
  for (const chave of Object.keys(bruto)) {
    if (!IDS_DOS_TIPOS.has(chave)) throw new ErroValidacao(`Tipo de equipe desconhecido: ${chave}.`);
  }
  for (const tipo of TIPOS) {
    const valor = (bruto as Record<string, unknown>)[tipo.id] ?? 0;
    if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0 || valor > 999) {
      throw new ErroValidacao(`Quantidade inválida para ${tipo.nome}: use um número inteiro de 0 a 999.`);
    }
    quantidades[tipo.id] = valor;
  }
  if (!Object.values(quantidades).some((quantidade) => quantidade > 0)) {
    throw new ErroValidacao("O item precisa ser exigido por pelo menos um tipo de equipe.");
  }

  return { grupo, descricao, tempoUtil, preco: Math.round(preco * 100) / 100, quantidades };
}

async function exigirBanco() {
  const catalogo = await obterCatalogo();
  if (!catalogo.noBanco) throw new ErroValidacao(MENSAGEM_SEM_TABELA, 503);
}

function repetida(erro: { code?: string; message?: string } | null): boolean {
  return erro?.code === "23505" && (erro.message ?? "").includes("materiais_itens_descricao_ativa");
}

const MENSAGEM_REPETIDA = "Já existe um item ativo com esta descrição neste grupo.";

export async function criarItem(dados: DadosItem): Promise<ItemCatalogo> {
  await exigirBanco();
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const { data: ultimo, error: erroUltimo } = await db
      .from("materiais_itens")
      .select("id")
      .order("id", { ascending: false })
      .limit(1);
    if (erroUltimo) throw erroUltimo;
    const id = ((ultimo as { id: number }[])[0]?.id ?? 0) + 1;

    const agora = new Date().toISOString();
    const { data, error } = await db
      .from("materiais_itens")
      .insert({
        id,
        grupo: dados.grupo,
        descricao: dados.descricao,
        tempo_util: dados.tempoUtil,
        preco: dados.preco,
        quantidades: dados.quantidades,
        ativo: true,
        criado_em: agora,
        atualizado_em: agora,
      })
      .select(COLUNAS)
      .single();
    if (repetida(error)) throw new ErroValidacao(MENSAGEM_REPETIDA, 409);
    // Outra pessoa pegou o mesmo número no mesmo instante: tenta de novo com o seguinte.
    if (error?.code === "23505") continue;
    if (error) throw error;
    invalidarCatalogo();
    return paraItem(data as unknown as LinhaItem);
  }
  throw new ErroValidacao("Não foi possível reservar um número para o item. Tente de novo.", 409);
}

async function alterar(id: number, campos: Record<string, unknown>): Promise<ItemCatalogo> {
  await exigirBanco();
  const { data, error } = await db
    .from("materiais_itens")
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .select(COLUNAS);
  if (repetida(error)) throw new ErroValidacao(MENSAGEM_REPETIDA, 409);
  if (error) throw error;
  if (data.length === 0) throw new ErroValidacao("Item não encontrado.", 404);
  invalidarCatalogo();
  return paraItem(data[0] as unknown as LinhaItem);
}

export function atualizarItem(id: number, dados: DadosItem): Promise<ItemCatalogo> {
  return alterar(id, {
    grupo: dados.grupo,
    descricao: dados.descricao,
    tempo_util: dados.tempoUtil,
    preco: dados.preco,
    quantidades: dados.quantidades,
  });
}

export const removerItem = (id: number) => alterar(id, { ativo: false });
export const restaurarItem = (id: number) => alterar(id, { ativo: true });
