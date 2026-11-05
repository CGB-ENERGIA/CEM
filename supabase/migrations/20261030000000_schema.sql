-- Esquema do PAES (Programa de Acompanhamento de Equipamento de Segurança).
--
-- Acesso: o servidor Bun usa a chave service_role, que ignora o RLS. As tabelas têm RLS ligado
-- sem nenhuma policy, então a chave pública (anon) não consegue ler nem escrever nada.

-- ---------- Equipes ----------

create table if not exists equipes (
  prefixo text primary key,
  tipo_id text not null
);

-- ---------- Blitz ----------

create table if not exists blitzes (
  id bigint generated always as identity primary key,
  data date not null,
  processo text not null,
  prefixo text not null references equipes (prefixo),
  tipo_id text not null,
  colaboradores jsonb not null,
  criado_em timestamptz not null default now()
);

create index if not exists blitzes_data on blitzes (data);

create table if not exists blitz_itens (
  blitz_id bigint not null references blitzes (id) on delete cascade,
  item_id integer not null,
  status text not null check (status in ('ok', 'nao_ok', 'faltante')),
  observacao text,
  primary key (blitz_id, item_id)
);

-- ---------- Usuários e sessões ----------

create table if not exists usuarios (
  id bigint generated always as identity primary key,
  login text not null,
  nome text not null,
  senha_hash text not null,
  criado_em timestamptz not null default now()
);

-- Login sem diferenciar maiúsculas: o índice é sobre lower(login).
create unique index if not exists usuarios_login_minusculo on usuarios (lower(login));

-- Guarda só o hash do token; o token em si vai apenas no cookie do navegador.
create table if not exists sessoes (
  token_hash text primary key,
  usuario_id bigint not null references usuarios (id) on delete cascade,
  expira_em timestamptz not null
);

create index if not exists sessoes_expira on sessoes (expira_em);

-- ---------- Segurança ----------

alter table equipes enable row level security;
alter table blitzes enable row level security;
alter table blitz_itens enable row level security;
alter table usuarios enable row level security;
alter table sessoes enable row level security;

-- ---------- Registro atômico da blitz ----------
--
-- Cadastra a equipe (se for nova), grava a blitz e os itens numa única transação.
-- Se o tipo não bater com o cadastrado, lança TIPO_DIVERGENTE e nada é gravado.

create or replace function registrar_blitz(
  p_data date,
  p_processo text,
  p_prefixo text,
  p_tipo_id text,
  p_colaboradores jsonb,
  p_itens jsonb
) returns bigint
language plpgsql
as $$
declare
  v_tipo text;
  v_id bigint;
begin
  insert into equipes (prefixo, tipo_id)
  values (p_prefixo, p_tipo_id)
  on conflict (prefixo) do nothing;

  select tipo_id into v_tipo from equipes where prefixo = p_prefixo;
  if v_tipo <> p_tipo_id then
    raise exception 'TIPO_DIVERGENTE' using errcode = 'P0001';
  end if;

  insert into blitzes (data, processo, prefixo, tipo_id, colaboradores)
  values (p_data, p_processo, p_prefixo, p_tipo_id, p_colaboradores)
  returning id into v_id;

  insert into blitz_itens (blitz_id, item_id, status, observacao)
  select v_id,
         (item ->> 'itemId')::integer,
         item ->> 'status',
         item ->> 'observacao'
    from jsonb_array_elements(p_itens) as item;

  return v_id;
end;
$$;

-- Só o servidor (service_role) pode chamar a função.
revoke execute on function registrar_blitz(date, text, text, text, jsonb, jsonb) from public, anon, authenticated;
