-- Cadastro de colaboradores.
--
-- Colaboradores aprovados aparecem como sugestão no app de campo. O app de campo também pode pedir o
-- cadastro de um nome novo: ele entra como "pendente" e só vira sugestão depois que um administrador aprova.
--
-- Esta migração pode rodar de novo sem problemas.

create table if not exists colaboradores (
  id bigint generated always as identity primary key,
  nome text not null,
  nome_normalizado text not null unique,
  status text not null default 'pendente' check (status in ('aprovado', 'pendente')),
  criado_em timestamptz not null default now(),
  aprovado_em timestamptz
);

alter table colaboradores enable row level security;
