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

export interface NovaBlitz {
  // Gerado no celular: impede que a mesma blitz seja gravada duas vezes após uma reconexão.
  idCliente?: string;
  data: string;
  processo: string;
  prefixo: string;
  tipoId: string;
  colaboradores: string[];
  itens: NovoItemBlitz[];
}

export interface BlitzResumo {
  id: number;
  data: string;
  processo: string;
  prefixo: string;
  tipoId: string;
  colaboradores: string[];
  totalItens: number;
  naoConformes: number;
  conforme: boolean;
  itensNaoConformes: (ItemBlitz & { descricao: string; grupo: Grupo })[];
}

export interface RankingEquipe {
  prefixo: string;
  tipoId: string | null;
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
  participantes: RankingEquipe[];
  naoParticipantes: RankingEquipe[];
  itensPendentes: RankingItem[];
}
