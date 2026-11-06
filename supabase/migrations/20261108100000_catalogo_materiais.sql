-- Catálogo de materiais no banco.
--
-- Até aqui a lista de materiais (EPI e EPC por tipo de equipe) vivia num arquivo do código. Com esta tabela,
-- administradores adicionam, editam e removem itens pela aba Materiais, e o app de campo recebe a lista pela API.
--
--   id: o mesmo número que as blitz já gravadas usam em blitz_itens.item_id. Itens novos continuam a sequência.
--   quantidades: quantas unidades cada tipo de equipe exige (jsonb: { "plantao": 2, "gere": 0, ... }).
--   ativo: falso = item removido. Ele sai das listas e das próximas blitz, mas continua no histórico e nas pendências.
--
-- Os tipos de equipe continuam fixos no código. A carga inicial (os 224 itens do arquivo atual) é feita pelo próprio
-- servidor na primeira consulta, quando a tabela está vazia, então não há INSERT aqui.
--
-- Esta migração pode rodar de novo sem problemas.

create table if not exists materiais_itens (
  id integer primary key,
  grupo text not null check (grupo in ('EPI', 'EPC')),
  descricao text not null,
  tempo_util integer not null default 0 check (tempo_util >= 0),
  preco numeric(12, 2) not null default 0 check (preco >= 0),
  quantidades jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Entre os itens ativos, a mesma descrição não repete no mesmo grupo. Um item removido libera a descrição.
create unique index if not exists materiais_itens_descricao_ativa
  on materiais_itens (grupo, lower(descricao))
  where ativo;

alter table materiais_itens enable row level security;
