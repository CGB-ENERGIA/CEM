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
