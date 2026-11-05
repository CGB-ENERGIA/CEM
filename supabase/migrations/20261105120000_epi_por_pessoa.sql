-- EPI por colaborador.
--
-- EPI é individual: cada colaborador tem a própria situação (OK, Troca ou Faltante). A tabela guarda o
-- detalhe por pessoa, e a função de registro grava esse detalhe junto com a blitz. Os totais de EPI
-- continuam nas colunas de sempre, então o dashboard e o histórico não mudam.
--
-- "Troca" é o item danificado que precisa ser trocado. Ele conta como presente (não é falta) e como defeito.
--
-- Esta migração pode rodar de novo sem problemas. Roda depois de 20261030180000_cadastro_equipes.sql.

create table if not exists blitz_epi_pessoas (
  id bigint generated always as identity primary key,
  blitz_id bigint not null references blitzes (id) on delete cascade,
  colaborador text not null,
  item_id integer not null,
  status text not null check (status in ('ok', 'troca', 'faltante')),
  unique (blitz_id, colaborador, item_id)
);

create index if not exists blitz_epi_pessoas_blitz on blitz_epi_pessoas (blitz_id);

alter table blitz_epi_pessoas enable row level security;

-- A assinatura muda (novo parâmetro com valor padrão): a versão antiga sai antes da nova entrar.
drop function if exists registrar_blitz(date, text, text, text, jsonb, jsonb, text);

create or replace function registrar_blitz(
  p_data date,
  p_processo text,
  p_prefixo text,
  p_tipo_id text,
  p_colaboradores jsonb,
  p_itens jsonb,
  p_id_cliente text default null,
  p_pessoas jsonb default '[]'::jsonb
) returns bigint
language plpgsql
as $$
declare
  v_tipo text;
  v_id bigint;
begin
  if p_id_cliente is not null then
    select id into v_id from blitzes where id_cliente = p_id_cliente;
    if found then
      return v_id;
    end if;
  end if;

  insert into equipes (prefixo, tipo_id)
  values (p_prefixo, p_tipo_id)
  on conflict (prefixo) do nothing;

  select tipo_id into v_tipo from equipes where prefixo = p_prefixo;
  if v_tipo is null then
    update equipes set tipo_id = p_tipo_id where prefixo = p_prefixo;
  elsif v_tipo <> p_tipo_id then
    raise exception 'TIPO_DIVERGENTE' using errcode = 'P0001';
  end if;

  insert into blitzes (data, processo, prefixo, tipo_id, colaboradores, id_cliente)
  values (p_data, p_processo, p_prefixo, p_tipo_id, p_colaboradores, p_id_cliente)
  returning id into v_id;

  insert into blitz_itens (
    blitz_id, item_id, status, observacao,
    quantidade_exigida, quantidade_encontrada, quantidade_nao_conforme
  )
  select v_id,
         (item ->> 'itemId')::integer,
         case
           when (item ->> 'exigida')::integer > (item ->> 'encontrada')::integer then 'faltante'
           when (item ->> 'naoConforme')::integer > 0 then 'nao_ok'
           else 'ok'
         end,
         item ->> 'observacao',
         (item ->> 'exigida')::integer,
         (item ->> 'encontrada')::integer,
         (item ->> 'naoConforme')::integer
    from jsonb_array_elements(p_itens) as item;

  insert into blitz_epi_pessoas (blitz_id, colaborador, item_id, status)
  select v_id,
         pessoa ->> 'colaborador',
         (pessoa ->> 'itemId')::integer,
         pessoa ->> 'status'
    from jsonb_array_elements(p_pessoas) as pessoa;

  return v_id;
end;
$$;

revoke execute on function registrar_blitz(date, text, text, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
