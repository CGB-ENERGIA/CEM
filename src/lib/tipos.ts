export type Grupo = "EPI" | "EPC";

export type StatusItem = "ok" | "nao_ok" | "faltante";

export interface TipoEquipe {
  id: string;
  nome: string;
}

export interface Item {
  id: number;
  grupo: Grupo;
  descricao: string;
  preco: number;
  tempoUtil: number;
  quantidades: Record<string, number>;
}

export interface Materiais {
  tipos: TipoEquipe[];
  itens: Item[];
}

// Item do catálogo no banco. Removido (ativo falso) sai das listas e das próximas blitz, mas fica no histórico.
export interface ItemCatalogo extends Item {
  ativo: boolean;
}

export interface MateriaisCatalogo {
  tipos: TipoEquipe[];
  itens: ItemCatalogo[];
  // Última alteração do catálogo (ISO). O app de campo a devolve na blitz, para a validação saber que lista ele viu.
  versao: string;
  // Falso enquanto a migração do catálogo não rodou: a lista vem do arquivo e não pode ser editada.
  noBanco: boolean;
}

// O que o app de campo precisa de cada item: sem preço nem tempo útil, que são dados de gestão.
export type ItemCampo = Pick<Item, "id" | "grupo" | "descricao" | "quantidades">;

export interface MateriaisCampo {
  tipos: TipoEquipe[];
  itens: ItemCampo[];
  versao: string | null;
}

// Campos editáveis de um item. As quantidades trazem um número por tipo de equipe.
export interface DadosItem {
  grupo: Grupo;
  descricao: string;
  tempoUtil: number;
  preco: number;
  quantidades: Record<string, number>;
}

export type StatusEquipe = "ativo" | "inativo";

export interface Equipe {
  prefixo: string;
  nome: string | null;
  responsavel: string | null;
  supervisor: string | null;
  coordenador: string | null;
  gerencia: string | null;
  base: string | null;
  processo: string | null;
  status: StatusEquipe;
  // Nulo nas equipes importadas da planilha, até o tipo ser definido.
  tipoId: string | null;
}

// Campos editáveis de uma equipe (o prefixo identifica a equipe e não muda).
export type DadosEquipe = Omit<Equipe, "prefixo">;

// Colaborador do cadastro. Pendente = pedido do app de campo, ainda sem aprovação.
export interface Colaborador {
  id: number;
  nome: string;
  status: "aprovado" | "pendente";
  criado_em: string;
  aprovado_em: string | null;
}

export interface ResultadoImportacaoColaboradores {
  processados: number;
  importados: number;
  ignorados: number;
}

// Resultado da importação da planilha de equipes: nunca remove, só cria e atualiza.
export interface ResultadoImportacaoEquipes {
  processadas: number;
  criadas: number;
  atualizadas: number;
  ignoradas: number;
  erros: string[];
}

// Como o inspetor informa cada item: quantos foram encontrados e quantos estão com defeito.
export interface NovoItemBlitz {
  itemId: number;
  encontrada: number;
  naoConforme: number;
  observacao?: string;
}

// Item já gravado: a situação é derivada das quantidades.
export interface ItemBlitz {
  itemId: number;
  status: StatusItem;
  exigida: number;
  encontrada: number;
  naoConforme: number;
  observacao?: string;
}

// EPI de um colaborador: EPI é individual, então cada colaborador tem a própria situação.
// OK = tem e está bom; Troca = tem, mas danificado e precisa trocar; Faltante = não tem.
export type { EscopoBlitz } from "./compartilhado";
import type { EscopoBlitz } from "./compartilhado";

export type SituacaoEpi = "ok" | "troca" | "faltante";

export interface PessoaItem {
  colaborador: string;
  itemId: number;
  status: SituacaoEpi;
}

export interface NovaBlitz {
  // Gerado no celular: impede que a mesma blitz seja gravada duas vezes após uma reconexão.
  idCliente?: string;
  data: string;
  // Nulo quando a blitz é feita pelo app de campo para uma equipe sem processo no cadastro.
  processo: string | null;
  prefixo: string;
  tipoId: string;
  colaboradores: string[];
  itens: NovoItemBlitz[];
  // Detalhe de EPI por colaborador, quando a blitz vem do app de campo.
  pessoas?: PessoaItem[];
  // Versão do catálogo de materiais que o app de campo usou. Itens criados depois dela não são exigidos desta blitz.
  catalogoVersao?: string;
  // O que esta blitz verifica. Sem o campo, vale "todos".
  escopo?: EscopoBlitz;
}

// Colaborador com um EPI em Troca ou Faltante, no detalhe de uma blitz feita pelo app de campo.
export interface PessoaPendente {
  colaborador: string;
  status: "troca" | "faltante";
}

export interface BlitzResumo {
  id: number;
  data: string;
  processo: string | null;
  prefixo: string;
  tipoId: string;
  colaboradores: string[];
  // Blitz só de EPI ou só de EPC não verificou o resto; o painel mostra isso.
  escopo: EscopoBlitz;
  totalItens: number;
  naoConformes: number;
  conforme: boolean;
  itensNaoConformes: (ItemBlitz & { descricao: string; grupo: Grupo; pessoas?: PessoaPendente[] })[];
}

// Controle de pendências: cada Troca ou Faltante registrado numa blitz, até alguém marcar como resolvido.
// EPI vem por colaborador; EPC (e EPI de blitz feita pelo painel) vem por equipe.
export interface Pendencia {
  // "epi:<id>" (EPI de um colaborador) ou "item:<blitz>:<item>" (item da equipe).
  chave: string;
  blitzId: number;
  itemId: number;
  descricao: string;
  grupo: Grupo;
  status: "troca" | "faltante";
  quantidade: number;
  colaborador: string | null;
  prefixo: string;
  processo: string | null;
  data: string;
  observacao: string | null;
  resolvidaEm: string | null;
  resolvidaPor: string | null;
}

// Usuário do sistema como a página Usuários o vê. A senha nunca sai do servidor.
export interface UsuarioGerenciado {
  id: number;
  login: string;
  nome: string;
  // Administrador: altera tudo, menos a página Usuários. Sem este perfil, o usuário só consulta.
  admin: boolean;
  // Proprietário: administrador que também abre a página Usuários. Não muda por ela.
  proprietario: boolean;
  ativo: boolean;
  criadoEm: string;
}

export interface DadosNovoUsuario {
  nome: string;
  login: string;
  senha: string;
  admin: boolean;
}

export type FiltroPendencias = "abertas" | "resolvidas" | "todas";

export interface ListaPendencias {
  pendencias: Pendencia[];
  abertas: number;
  resolvidas: number;
}

export interface RankingEquipe {
  prefixo: string;
  tipoId: string | null;
  processo: string | null;
  base: string | null;
  blitzes: number;
  ultimaData: string | null;
  conforme: boolean | null;
  // O que a última blitz da equipe verificou; "todos" quando ela olhou EPI e EPC.
  ultimoEscopo: EscopoBlitz | null;
}

export interface RankingItem {
  unidadesFaltantes: number;
  itemId: number;
  descricao: string;
  grupo: Grupo;
  faltantes: number;
  naoOk: number;
  total: number;
}

export interface Dashboard {
  mes: string;
  totalBlitzes: number;
  equipesParticipantes: number;
  equipesTotais: number;
  percentualConformes: number | null;
  // Trocas e Faltantes ainda não resolvidos; nulo se o controle não está ativo no banco.
  pendenciasAbertas: number | null;
  participantes: RankingEquipe[];
  naoParticipantes: RankingEquipe[];
  itensPendentes: RankingItem[];
}
