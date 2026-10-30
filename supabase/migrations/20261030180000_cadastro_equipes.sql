-- Cadastro de equipes vindo da planilha de equipes.
--
-- Acrescenta os dados da planilha à tabela de equipes e deixa o tipo opcional: a planilha não traz o
-- tipo de equipe, então ele é preenchido depois, na aba Equipes. A primeira blitz de uma equipe sem
-- tipo grava o tipo informado.
--
-- Esta migração roda depois de 20261030150000_idempotencia_blitz.sql. Pode rodar de novo sem problemas.

alter table equipes add column if not exists nome text;
alter table equipes add column if not exists responsavel text;
alter table equipes add column if not exists supervisor text;
alter table equipes add column if not exists coordenador text;
alter table equipes add column if not exists gerencia text;
alter table equipes add column if not exists base text;
alter table equipes add column if not exists processo text;
alter table equipes add column if not exists status text not null default 'ativo';

alter table equipes drop constraint if exists equipes_status_check;
alter table equipes add constraint equipes_status_check check (status in ('ativo', 'inativo'));

alter table equipes alter column tipo_id drop not null;

-- Mesma assinatura da versão anterior, então basta substituir. Equipe sem tipo recebe o tipo da blitz.
create or replace function registrar_blitz(
  p_data date,
  p_processo text,
  p_prefixo text,
  p_tipo_id text,
  p_colaboradores jsonb,
  p_itens jsonb,
  p_id_cliente text default null
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

  return v_id;
end;
$$;

revoke execute on function registrar_blitz(date, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
