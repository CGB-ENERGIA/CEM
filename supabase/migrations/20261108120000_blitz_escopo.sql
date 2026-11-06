-- Escopo da blitz: o encarregado escolhe verificar tudo, só o EPI ou só o EPC.
--
--   todos: EPI (por colaborador) e EPC. É o comportamento de sempre e o valor das blitz já registradas.
--   epi:   só o EPI de cada colaborador. A blitz não grava itens de EPC.
--   epc:   só o EPC da equipe. A blitz não grava EPI por colaborador.
--
-- O painel usa a coluna para mostrar "só EPI" ou "só EPC" no histórico e no Dashboard, em vez de apresentar
-- uma blitz parcial como se tivesse verificado tudo.
--
-- A função de registro ganha o parâmetro p_escopo, com valor padrão 'todos'. Quem chama sem ele continua valendo.
--
-- Esta migração pode rodar de novo sem problemas. Roda depois de 20261105120000_epi_por_pessoa.sql.

alter table blitzes add column if not exists escopo text not null default 'todos'
  check (escopo in ('todos', 'epi', 'epc'));

-- A assinatura muda (novo parâmetro): as versões anteriores saem antes da nova entrar.
drop function if exists registrar_blitz(date, text, text, text, jsonb, jsonb, text, jsonb);
drop function if exists registrar_blitz(date, text, text, text, jsonb, jsonb, text, jsonb, text);

create or replace function registrar_blitz(
  p_data date,
  p_processo text,
  p_prefixo text,
  p_tipo_id text,
  p_colaboradores jsonb,
  p_itens jsonb,
  p_id_cliente text default null,
  p_pessoas jsonb default '[]'::jsonb,
  p_escopo text default 'todos'
) returns bigint
language plpgsql
as $$
declare
  v_tipo text;
  v_id bigint;
begin
  if p_escopo not in ('todos', 'epi', 'epc') then
    raise exception 'ESCOPO_INVALIDO' using errcode = 'P0001';
  end if;

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

  insert into blitzes (data, processo, prefixo, tipo_id, colaboradores, id_cliente, escopo)
  values (p_data, p_processo, p_prefixo, p_tipo_id, p_colaboradores, p_id_cliente, p_escopo)
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

revoke execute on function registrar_blitz(date, text, text, text, jsonb, jsonb, text, jsonb, text) from public, anon, authenticated;
