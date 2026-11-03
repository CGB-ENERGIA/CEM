-- Processo opcional na blitz.
--
-- O app de campo registra o tipo da equipe. O processo vem do cadastro da equipe quando ele existe;
-- equipe nova entra sem processo, até ele ser definido. Por isso a coluna deixa de ser obrigatória.
--
-- Esta migração roda depois de 20261030180000_cadastro_equipes.sql. Pode rodar de novo sem problemas.

alter table blitzes alter column processo drop not null;
