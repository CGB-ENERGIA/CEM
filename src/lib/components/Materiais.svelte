<script lang="ts">
  import materiaisJson from "../data/materiais.json";
  import type { Grupo, Materiais } from "../tipos";
  import { moeda, normalizarTexto, numero } from "../format";
  import { cascata } from "../actions/animar";

  const materiais = materiaisJson as Materiais;

  // Sem tipo escolhido, nenhum material é mostrado: a tela não presume um tipo de equipe.
  let tipoId = $state("");
  let grupo = $state<"Todos" | Grupo>("Todos");
  let busca = $state("");

  const itens = $derived.by(() => {
    const termo = normalizarTexto(busca.trim());
    return materiais.itens
      .filter((item) => (item.quantidades[tipoId] ?? 0) > 0)
      .filter((item) => grupo === "Todos" || item.grupo === grupo)
      .filter((item) => !termo || normalizarTexto(item.descricao).includes(termo))
      .sort(
        (a, b) =>
          a.grupo.localeCompare(b.grupo) || a.descricao.localeCompare(b.descricao, "pt-BR"),
      );
  });

  const totais = $derived.by(() => {
    let unidadesEpi = 0;
    let unidadesEpc = 0;
    for (const item of itens) {
      const quantidade = item.quantidades[tipoId] ?? 0;
      if (item.grupo === "EPI") unidadesEpi += quantidade;
      else unidadesEpc += quantidade;
    }
    return { linhas: itens.length, unidadesEpi, unidadesEpc };
  });

  // Resumo de cada tipo, para a grade de escolha: quantos materiais EPI e EPC ele exige.
  const resumoTipos = materiais.tipos.map((tipo) => {
    let epi = 0;
    let epc = 0;
    for (const item of materiais.itens) {
      if ((item.quantidades[tipo.id] ?? 0) <= 0) continue;
      if (item.grupo === "EPI") epi += 1;
      else epc += 1;
    }
    return { id: tipo.id, nome: tipo.nome, epi, epc };
  });

  const nomeTipoAtual = $derived(materiais.tipos.find((tipo) => tipo.id === tipoId)?.nome ?? "");

  function tempoUtil(meses: number): string {
    return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  }
</script>

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Materiais de segurança</h2>
      <p>EPI e EPC exigidos por tipo de equipe, com a quantidade de cada material.</p>
    </div>
  </div>

  <div class="filtros">
    <label class="rotulo">
      Tipo de equipe
      <select bind:value={tipoId}>
        <option value="" disabled>Selecione o tipo</option>
        {#each materiais.tipos as tipo (tipo.id)}
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

  <div class="tabela-wrap distancia">
    <table class="tabela tabela-responsiva">
      <thead>
        <tr>
          <th>Grupo</th>
          <th>Descrição</th>
          <th class="numerico">Qtd. exigida</th>
          <th class="numerico">Tempo útil</th>
          <th class="numerico">Preço homologado</th>
        </tr>
      </thead>
      <tbody use:cascata={`${tipoId}|${grupo}|${busca}`}>
        {#each itens as item (item.id)}
          <tr>
            <td data-rotulo="Grupo">
              <span class="chip" class:chip-epi={item.grupo === "EPI"} class:chip-epc={item.grupo === "EPC"}>
                {item.grupo}
              </span>
            </td>
            <td class="titulo-cartao">{item.descricao}</td>
            <td data-rotulo="Qtd. exigida" class="numerico"><span class="quantidade">{numero.format(item.quantidades[tipoId] ?? 0)}</span></td>
            <td data-rotulo="Tempo útil" class="numerico">{tempoUtil(item.tempoUtil)}</td>
            <td data-rotulo="Preço" class="numerico codigo">{moeda.format(item.preco)}</td>
          </tr>
        {:else}
          <tr>
            <td colspan="5" class="texto-suave sem-rotulo">Nenhum material encontrado com os filtros atuais.</td>
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
</style>
