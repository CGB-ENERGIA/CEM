-- Idempotência do registro de blitz.
--
-- O celular gera um identificador para cada blitz. Se a conexão cair depois que o servidor gravou
-- mas antes da resposta chegar, o celular reenvia a mesma blitz. Com o identificador único, a
-- função devolve a blitz já gravada em vez de criar uma duplicata.
--
-- Esta migração roda depois de 20261030120000_quantidades_blitz.sql.

alter table blitzes add column if not exists id_cliente text unique;

-- A assinatura muda (novo parâmetro com valor padrão): a versão antiga sai antes da nova entrar.
drop function if exists registrar_blitz(date, text, text, text, jsonb, jsonb);

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
  if v_tipo <> p_tipo_id then
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
