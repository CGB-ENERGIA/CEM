<script lang="ts">
  import { tick } from "svelte";
  import materiaisJson from "../data/materiais.json";
  import { api } from "../api";
  import type { Grupo, ItemCatalogo, Materiais, MateriaisCatalogo } from "../tipos";
  import { moeda, normalizarTexto, numero } from "../format";
  import { cascata } from "../actions/animar";
  import { mostrarAviso } from "../avisos.svelte";
  import { podeEditar } from "../sessao.svelte";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  // A lista começa com a do arquivo do código e passa para a do banco assim que ela chega. Assim a tela abre na hora,
  // e também funciona sem conexão (a resposta da API fica guardada no celular e no navegador).
  const arquivo = materiaisJson as Materiais;
  let catalogo = $state<MateriaisCatalogo>({
    tipos: arquivo.tipos,
    itens: arquivo.itens.map((item) => ({ ...item, ativo: true })),
    versao: "",
    noBanco: true,
  });
  let carregou = $state(false);

  // Sem tipo escolhido, nenhum material é mostrado: a tela não presume um tipo de equipe.
  let tipoId = $state("");
  let grupo = $state<"Todos" | Grupo>("Todos");
  let busca = $state("");
  let mostrarRemovidos = $state(false);

  async function carregar() {
    try {
      catalogo = await api.materiais();
      carregou = true;
    } catch {
      // Sem conexão ou sem resposta: continua com a lista que já está na tela.
    }
  }

  $effect(() => {
    if (ativo) carregar();
  });

  const edicaoDisponivel = $derived(podeEditar() && catalogo.noBanco);
  const verRemovidos = $derived(mostrarRemovidos && podeEditar());

  const itens = $derived.by(() => {
    const termo = normalizarTexto(busca.trim());
    return catalogo.itens
      .filter((item) => item.ativo || verRemovidos)
      .filter((item) => (item.quantidades[tipoId] ?? 0) > 0)
      .filter((item) => grupo === "Todos" || item.grupo === grupo)
      .filter((item) => !termo || normalizarTexto(item.descricao).includes(termo))
      .sort(
        (a, b) =>
          Number(b.ativo) - Number(a.ativo) ||
          a.grupo.localeCompare(b.grupo) ||
          a.descricao.localeCompare(b.descricao, "pt-BR"),
      );
  });

  const removidosNoTipo = $derived(
    catalogo.itens.filter((item) => !item.ativo && (item.quantidades[tipoId] ?? 0) > 0).length,
  );

  const totais = $derived.by(() => {
    let unidadesEpi = 0;
    let unidadesEpc = 0;
    let linhas = 0;
    for (const item of itens) {
      if (!item.ativo) continue;
      linhas += 1;
      const quantidade = item.quantidades[tipoId] ?? 0;
      if (item.grupo === "EPI") unidadesEpi += quantidade;
      else unidadesEpc += quantidade;
    }
    return { linhas, unidadesEpi, unidadesEpc };
  });

  // Resumo de cada tipo, para a grade de escolha: quantos materiais EPI e EPC ele exige.
  const resumoTipos = $derived(
    catalogo.tipos.map((tipo) => {
      let epi = 0;
      let epc = 0;
      for (const item of catalogo.itens) {
        if (!item.ativo || (item.quantidades[tipo.id] ?? 0) <= 0) continue;
        if (item.grupo === "EPI") epi += 1;
        else epc += 1;
      }
      return { id: tipo.id, nome: tipo.nome, epi, epc };
    }),
  );

  const nomeTipoAtual = $derived(catalogo.tipos.find((tipo) => tipo.id === tipoId)?.nome ?? "");

  function tempoUtil(meses: number): string {
    return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  }

  // ---------- Edição ----------
  type Modo = { tipo: "novo" } | { tipo: "editar"; item: ItemCatalogo };

  let modo = $state<Modo | null>(null);
  let salvando = $state(false);
  let formulario: HTMLElement | undefined = $state();

  let formGrupo = $state<Grupo>("EPC");
  let formDescricao = $state("");
  let formTempoUtil = $state<number | null>(12);
  let formPreco = $state<number | null>(0);
  let formQuantidades = $state<Record<string, number | null>>({});

  async function abrir(novoModo: Modo) {
    modo = novoModo;
    if (novoModo.tipo === "editar") {
      const item = novoModo.item;
      formGrupo = item.grupo;
      formDescricao = item.descricao;
      formTempoUtil = item.tempoUtil;
      formPreco = item.preco;
      formQuantidades = { ...item.quantidades };
    } else {
      formGrupo = grupo === "EPI" ? "EPI" : "EPC";
      formDescricao = "";
      formTempoUtil = 12;
      formPreco = 0;
      // O tipo que está aberto já vem com 1 unidade, que é o caso mais comum.
      formQuantidades = Object.fromEntries(catalogo.tipos.map((tipo) => [tipo.id, tipo.id === tipoId ? 1 : 0]));
    }
    await tick();
    formulario?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function fechar() {
    modo = null;
  }

  async function salvar(evento: SubmitEvent) {
    evento.preventDefault();
    if (!modo || salvando) return;
    salvando = true;
    const dados = {
      grupo: formGrupo,
      descricao: formDescricao,
      tempoUtil: formTempoUtil ?? 0,
      preco: formPreco ?? 0,
      quantidades: Object.fromEntries(catalogo.tipos.map((tipo) => [tipo.id, formQuantidades[tipo.id] ?? 0])),
    };
    try {
      if (modo.tipo === "novo") {
        const criado = await api.criarItem(dados);
        mostrarAviso("ok", `Item ${criado.id} criado.`);
      } else {
        await api.atualizarItem(modo.item.id, dados);
        mostrarAviso("ok", "Item atualizado.");
      }
      fechar();
      await carregar();
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível salvar o item.");
    } finally {
      salvando = false;
    }
  }

  async function remover(item: ItemCatalogo) {
    if (
      !confirm(
        `Remover "${item.descricao}"? Ele sai das listas e das próximas blitz, mas continua no histórico e nas pendências.`,
      )
    ) {
      return;
    }
    try {
      await api.removerItem(item.id);
      mostrarAviso("ok", "Item removido.");
      await carregar();
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível remover o item.");
    }
  }

  async function restaurar(item: ItemCatalogo) {
    try {
      await api.restaurarItem(item.id);
      mostrarAviso("ok", "Item restaurado.");
      await carregar();
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível restaurar o item.");
    }
  }
</script>

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Materiais de segurança</h2>
      <p>EPI e EPC exigidos por tipo de equipe, com a quantidade de cada material.</p>
    </div>
    {#if podeEditar()}
      <div class="cabecalho-acoes">
        <button type="button" class="botao" onclick={() => abrir({ tipo: "novo" })} disabled={!edicaoDisponivel || modo?.tipo === "novo"}>
          Novo item
        </button>
      </div>
    {/if}
  </div>

  {#if podeEditar() && carregou && !catalogo.noBanco}
    <p class="mensagem mensagem-erro" role="alert">
      A edição do catálogo ainda não está ativa no banco. Rode a migração 20261108100000_catalogo_materiais.sql no
      Supabase. Enquanto isso, a lista vem do arquivo e não pode ser alterada.
    </p>
  {/if}

  {#if modo}
    <form class="formulario-item painel-interno" bind:this={formulario} onsubmit={salvar} novalidate>
      <h3>{modo.tipo === "novo" ? "Novo item" : `Editar item ${modo.item.id}`}</h3>

      <div class="campos-item">
        <label class="rotulo">
          Grupo
          <select bind:value={formGrupo}>
            <option value="EPI">EPI</option>
            <option value="EPC">EPC</option>
          </select>
        </label>
        <label class="rotulo campo-descricao">
          Descrição
          <input bind:value={formDescricao} maxlength="200" autocomplete="off" required />
        </label>
        <label class="rotulo">
          Tempo útil (meses)
          <input type="number" min="0" max="600" step="1" bind:value={formTempoUtil} />
        </label>
        <label class="rotulo">
          Preço homologado (R$)
          <input type="number" min="0" max="1000000" step="0.01" bind:value={formPreco} />
        </label>
      </div>

      <fieldset class="quantidades">
        <legend>Quantidade exigida por tipo de equipe</legend>
        <p class="texto-suave">Deixe 0 nos tipos que não exigem este item. Ele entra na blitz só dos tipos com 1 ou mais.</p>
        <div class="grade-quantidades">
          {#each catalogo.tipos as tipo (tipo.id)}
            <label class="rotulo quantidade-tipo" class:com-valor={(formQuantidades[tipo.id] ?? 0) > 0}>
              {tipo.nome}
              <input type="number" min="0" max="999" step="1" bind:value={formQuantidades[tipo.id]} />
            </label>
          {/each}
        </div>
      </fieldset>

      <div class="acoes-formulario">
        <button type="button" class="botao-secundario" onclick={fechar}>Cancelar</button>
        <button type="submit" class="botao" disabled={salvando}>
          {salvando ? "Salvando..." : modo.tipo === "novo" ? "Criar item" : "Salvar"}
        </button>
      </div>
    </form>
  {/if}

  <div class="filtros">
    <label class="rotulo">
      Tipo de equipe
      <select bind:value={tipoId}>
        <option value="" disabled>Selecione o tipo</option>
        {#each catalogo.tipos as tipo (tipo.id)}
          <option value={tipo.id}>{tipo.nome}</option>
        {/each}
      </select>
    </label>

    <label class="rotulo">
      Grupo
      <select bind:value={grupo} disabled={!tipoId}>
        <option value="Todos">Todos</option>
        <option value="EPI">EPI</option>
        <option value="EPC">EPC</option>
      </select>
    </label>

    <label class="rotulo">
      Buscar material
      <input type="search" bind:value={busca} disabled={!tipoId} placeholder="Ex.: capacete, luva, talabarte" />
    </label>
  </div>

  {#if tipoId}
  <div class="grade-kpi distancia">
    <div class="kpi etiqueta">
      <span class="kpi-rotulo">Materiais · {nomeTipoAtual}</span>
      <div class="kpi-valor">{numero.format(totais.linhas)}</div>
    </div>
    <div class="kpi etiqueta">
      <span class="kpi-rotulo">Unidades EPI</span>
      <div class="kpi-valor">{numero.format(totais.unidadesEpi)}</div>
    </div>
    <div class="kpi etiqueta">
      <span class="kpi-rotulo">Unidades EPC</span>
      <div class="kpi-valor">{numero.format(totais.unidadesEpc)}</div>
    </div>
  </div>

  {#if podeEditar() && removidosNoTipo > 0}
    <label class="opcao-removidos distancia">
      <input type="checkbox" bind:checked={mostrarRemovidos} />
      Mostrar {removidosNoTipo} item(ns) removido(s) deste tipo
    </label>
  {/if}

  <div class="tabela-wrap distancia">
    <table class="tabela tabela-responsiva">
      <thead>
        <tr>
          <th>Grupo</th>
          <th>Descrição</th>
          <th class="numerico">Qtd. exigida</th>
          <th class="numerico">Tempo útil</th>
          <th class="numerico">Preço homologado</th>
          {#if podeEditar()}
            <th class="numerico">Ações</th>
          {/if}
        </tr>
      </thead>
      <tbody use:cascata={`${tipoId}|${grupo}|${busca}|${verRemovidos}|${itens.length}`}>
        {#each itens as item (item.id)}
          <tr class:removido={!item.ativo}>
            <td data-rotulo="Grupo">
              <span class="chip" class:chip-epi={item.grupo === "EPI"} class:chip-epc={item.grupo === "EPC"}>
                {item.grupo}
              </span>
            </td>
            <td class="titulo-cartao">
              {item.descricao}
              {#if !item.ativo}
                <span class="chip">Removido</span>
              {/if}
            </td>
            <td data-rotulo="Qtd. exigida" class="numerico"><span class="quantidade">{numero.format(item.quantidades[tipoId] ?? 0)}</span></td>
            <td data-rotulo="Tempo útil" class="numerico">{tempoUtil(item.tempoUtil)}</td>
            <td data-rotulo="Preço" class="numerico codigo">{moeda.format(item.preco)}</td>
            {#if podeEditar()}
              <td class="numerico sem-rotulo">
                <div class="acoes-linha">
                  {#if item.ativo}
                    <button type="button" class="botao-secundario" onclick={() => abrir({ tipo: "editar", item })} disabled={!edicaoDisponivel}>Editar</button>
                    <button type="button" class="botao-perigo" onclick={() => remover(item)} disabled={!edicaoDisponivel}>Remover</button>
                  {:else}
                    <button type="button" class="botao-secundario" onclick={() => restaurar(item)} disabled={!edicaoDisponivel}>Restaurar</button>
                  {/if}
                </div>
              </td>
            {/if}
          </tr>
        {:else}
          <tr>
            <td colspan={podeEditar() ? 6 : 5} class="texto-suave sem-rotulo">Nenhum material encontrado com os filtros atuais.</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {:else}
  <h3 class="distancia">Escolha o tipo de equipe</h3>
  <p class="texto-suave">Toque num tipo para ver os materiais exigidos e as quantidades de cada um.</p>
  <div class="grade-tipos distancia" use:cascata={"tipos"}>
    {#each resumoTipos as tipo (tipo.id)}
      <button type="button" class="tipo-etiqueta etiqueta" onclick={() => (tipoId = tipo.id)}>
        <span class="tipo-nome">{tipo.nome}</span>
        <span class="texto-suave tipo-contagem">{tipo.epi} EPI · {tipo.epc} EPC</span>
      </button>
    {/each}
  </div>
  {/if}
</section>

<style>
  .filtros {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
  }

  .cabecalho-acoes {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  /* Formulário de item: fica acima da lista, sem janela por cima */
  .formulario-item {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 20px;
  }

  .formulario-item h3 {
    margin: 0;
  }

  .campos-item {
    display: grid;
    grid-template-columns: 120px minmax(260px, 1fr) 160px 180px;
    gap: 14px;
  }

  .quantidades {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  .quantidades legend {
    padding: 0;
    font-family: var(--fonte-titulo);
    font-size: 0.92rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .quantidades p {
    margin: 4px 0 12px;
    font-size: 0.9rem;
  }

  .grade-quantidades {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    align-items: end;
    gap: 12px;
  }

  /* O tipo que exige o item ganha destaque, para ler de relance onde ele entra */
  .quantidade-tipo.com-valor {
    color: var(--tinta);
  }

  .quantidade-tipo.com-valor :global(input) {
    border-color: var(--primaria);
    font-weight: 600;
  }

  .acoes-formulario {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 10px;
  }

  .opcao-removidos {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    cursor: pointer;
  }

  .opcao-removidos input {
    width: 20px;
    height: 20px;
  }

  tr.removido td {
    opacity: 0.6;
  }

  .acoes-linha {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  /* Grade de tipos de equipe: cada tipo é uma etiqueta que abre a lista de materiais */
  .grade-tipos {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }

  .tipo-etiqueta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 76px;
    padding: 16px 18px 16px 34px;
    font: inherit;
    color: inherit;
    text-align: left;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda);
    cursor: pointer;
    transition: border-color 160ms ease, transform 160ms var(--ease-saida);
  }

  .tipo-etiqueta:hover {
    border-color: var(--primaria);
  }

  .tipo-etiqueta:active {
    transform: translateY(1px);
  }

  .tipo-etiqueta:focus-visible {
    outline: 2px solid var(--primaria);
    outline-offset: 2px;
  }

  .tipo-nome {
    font-family: var(--fonte-titulo);
    font-weight: 700;
    font-size: 1.05rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .tipo-contagem {
    font-family: var(--fonte-codigo);
    font-size: 0.82rem;
  }

  .quantidade {
    display: inline-block;
    min-width: 2.2em;
    padding: 2px 8px;
    border: 1px solid var(--borda-forte);
    border-radius: 3px;
    font-family: var(--fonte-codigo);
    font-weight: 500;
    text-align: center;
    background: var(--superficie-elevada);
  }

  @media (max-width: 900px) {
    .campos-item {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    .campo-descricao {
      grid-column: 1 / -1;
      order: -1;
    }
  }

  @media (max-width: 640px) {
    .campos-item {
      grid-template-columns: minmax(0, 1fr);
    }

    .grade-quantidades {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .acoes-linha {
      justify-content: flex-start;
    }
  }
</style>
