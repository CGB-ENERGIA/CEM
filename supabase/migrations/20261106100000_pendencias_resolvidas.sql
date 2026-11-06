-- Controle de pendências do PAES.
--
-- Cada Troca ou Faltante registrado numa blitz vira uma pendência. Esta migração guarda quando e por quem
-- a pendência foi resolvida (item trocado ou entregue), para o painel listar só o que ainda está em aberto.
--
-- EPI de blitz do app de campo fica em blitz_epi_pessoas (por colaborador); EPC e EPI de blitz feita pelo
-- painel ficam em blitz_itens (por equipe). As duas tabelas ganham as mesmas colunas.
--
-- Esta migração pode rodar de novo sem problemas. Roda depois de 20261105120000_epi_por_pessoa.sql.

alter table blitz_epi_pessoas add column if not exists resolvido_em timestamptz;
alter table blitz_epi_pessoas add column if not exists resolvido_por text;

alter table blitz_itens add column if not exists resolvido_em timestamptz;
alter table blitz_itens add column if not exists resolvido_por text;

-- A lista do painel busca só o que não está OK; índice parcial mantém a consulta rápida com o tempo.
create index if not exists blitz_epi_pessoas_pendentes on blitz_epi_pessoas (blitz_id) where status <> 'ok';
create index if not exists blitz_itens_pendentes on blitz_itens (blitz_id) where status <> 'ok';
