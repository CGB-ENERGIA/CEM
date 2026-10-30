<script lang="ts">
  import materiaisJson from "../data/materiais.json";
  import type { Grupo, Materiais } from "../tipos";
  import { moeda, normalizarTexto, numero } from "../format";
  import { cascata } from "../actions/animar";

  const materiais = materiaisJson as Materiais;

  let tipoId = $state(materiais.tipos[0].id);
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
        {#each materiais.tipos as tipo (tipo.id)}
          <option value={tipo.id}>{tipo.nome}</option>
        {/each}
      </select>
    </label>

    <label class="rotulo">
      Grupo
      <select bind:value={grupo}>
        <option value="Todos">Todos</option>
        <option value="EPI">EPI</option>
        <option value="EPC">EPC</option>
      </select>
    </label>

    <label class="rotulo">
      Buscar material
      <input type="search" bind:value={busca} placeholder="Ex.: capacete, luva, talabarte" />
    </label>
  </div>

  <div class="grade-kpi distancia">
    <div class="kpi">
      <span class="kpi-rotulo">Materiais · {nomeTipoAtual}</span>
      <div class="kpi-valor">{numero.format(totais.linhas)}</div>
    </div>
    <div class="kpi">
      <span class="kpi-rotulo">Unidades EPI</span>
      <div class="kpi-valor">{numero.format(totais.unidadesEpi)}</div>
    </div>
    <div class="kpi">
      <span class="kpi-rotulo">Unidades EPC</span>
      <div class="kpi-valor">{numero.format(totais.unidadesEpc)}</div>
    </div>
  </div>

  <div class="tabela-wrap distancia">
    <table class="tabela">
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
            <td>
              <span class="chip" class:chip-epi={item.grupo === "EPI"} class:chip-epc={item.grupo === "EPC"}>
                {item.grupo}
              </span>
            </td>
            <td>{item.descricao}</td>
            <td class="numerico"><span class="quantidade">{numero.format(item.quantidades[tipoId] ?? 0)}</span></td>
            <td class="numerico">{tempoUtil(item.tempoUtil)}</td>
            <td class="numerico codigo">{moeda.format(item.preco)}</td>
          </tr>
        {:else}
          <tr>
            <td colspan="5" class="texto-suave">Nenhum material encontrado com os filtros atuais.</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .filtros {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
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
