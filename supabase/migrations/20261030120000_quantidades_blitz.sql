-- Quantidades por item da blitz.
--
-- Para cada material, a blitz guarda quantas unidades eram exigidas (snapshot da planilha),
-- quantas foram encontradas e quantas estão com defeito. A situação do item é derivada disso:
--   faltante  -> faltam unidades (exigida > encontrada)
--   nao_ok    -> nenhuma falta, mas há unidades com defeito
--   ok        -> tudo encontrado e sem defeito
--
-- Esta migração roda depois de 20261030000000_schema.sql.

alter table blitz_itens
  add column if not exists quantidade_exigida integer not null default 0 check (quantidade_exigida >= 0),
  add column if not exists quantidade_encontrada integer not null default 0 check (quantidade_encontrada >= 0),
  add column if not exists quantidade_nao_conforme integer not null default 0 check (quantidade_nao_conforme >= 0);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'blitz_itens_defeito_limitado') then
    alter table blitz_itens
      add constraint blitz_itens_defeito_limitado check (quantidade_nao_conforme <= quantidade_encontrada);
  end if;
end;
$$;

-- Mesma assinatura da versão anterior: o servidor continua chamando registrar_blitz(...).
-- O status não vem do cliente: a própria função o calcula a partir das quantidades.
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

revoke execute on function registrar_blitz(date, text, text, text, jsonb, jsonb) from public, anon, authenticated;
