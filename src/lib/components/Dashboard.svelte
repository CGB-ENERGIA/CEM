<script lang="ts">
  import materiaisJson from "../data/materiais.json";
  import { api } from "../api";
  import type { Dashboard, Materiais, RankingEquipe } from "../tipos";
  import { formatarMes, formatarData, formatarPercentual, mesHoje, numero } from "../format";
  import { barra, cascata, numeroAnimado } from "../actions/animar";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  const materiais = materiaisJson as Materiais;

  let mes = $state(mesHoje());
  let dados = $state<Dashboard | null>(null);
  let erro = $state<string | null>(null);
  let carregando = $state(false);

  const maxBlitzes = $derived(Math.max(1, ...(dados?.participantes.map((equipe) => equipe.blitzes) ?? [])));
  const maxPendencias = $derived(Math.max(1, ...(dados?.itensPendentes.map((item) => item.total) ?? [])));

  $effect(() => {
    const mesSelecionado = mes;
    if (ativo) carregar(mesSelecionado);
  });

  async function carregar(mesSelecionado: string) {
    carregando = true;
    erro = null;
    try {
      const resultado = await api.dashboard(mesSelecionado);
      if (mesSelecionado === mes) dados = resultado;
    } catch (falha) {
      erro = falha instanceof Error ? falha.message : "Não foi possível carregar o dashboard.";
    } finally {
      carregando = false;
    }
  }

  function nomeTipo(id: string | null): string {
    if (!id) return "Sem tipo";
    return materiais.tipos.find((tipo) => tipo.id === id)?.nome ?? id;
  }

  // Agrupa as equipes pelo processo (GSTC, GOMAN, GERE...). Equipes sem processo ficam à parte.
  function agruparPorProcesso(equipes: RankingEquipe[]): { rotulo: string; equipes: RankingEquipe[] }[] {
    const grupos = new Map<string, RankingEquipe[]>();
    for (const equipe of equipes) {
      const rotulo = equipe.processo ?? "Sem processo";
      grupos.set(rotulo, [...(grupos.get(rotulo) ?? []), equipe]);
    }
    return [...grupos]
      .map(([rotulo, lista]) => ({ rotulo, equipes: lista }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo));
  }

  function percentualDe(valor: number, maximo: number): number {
    return maximo > 0 ? (valor / maximo) * 100 : 0;
  }

  const inteiro = (valor: number) => numero.format(Math.round(valor));
</script>

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Dashboard</h2>
      <p>Resumo de {formatarMes(mes)}: participação, conformidade e itens que mais faltam.</p>
    </div>
    <label class="rotulo">
      Mês de referência
      <input type="month" bind:value={mes} />
    </label>
  </div>

  {#if erro}
    <p class="mensagem mensagem-erro" role="alert">{erro}</p>
  {/if}

  {#if dados}
    <div class="grade-kpi">
      <div class="kpi etiqueta">
        <span class="kpi-rotulo">Blitzes no mês</span>
        <div class="kpi-valor" use:numeroAnimado={{ valor: dados.totalBlitzes, formatar: inteiro }}></div>
      </div>
      <div class="kpi etiqueta">
        <span class="kpi-rotulo">Equipes que participaram</span>
        <div class="kpi-valor" use:numeroAnimado={{ valor: dados.equipesParticipantes, formatar: inteiro }}></div>
        <span class="nota">de {numero.format(dados.equipesTotais)} cadastradas</span>
      </div>
      <div class="kpi etiqueta">
        <span class="kpi-rotulo">Equipes com todos OK</span>
        <div
          class="kpi-valor"
          use:numeroAnimado={{ valor: dados.percentualConformes, formatar: formatarPercentual }}
        ></div>
        <span class="nota">
          {dados.percentualConformes === null
            ? "nenhuma equipe foi blitzada neste mês"
            : "pela última blitz de cada equipe"}
        </span>
      </div>
    </div>

    <div class="painel-interno distancia">
      <h3>Equipes que participaram</h3>
      {#if dados.participantes.length === 0}
        <p class="texto-suave distancia">Nenhuma equipe foi blitzada neste mês.</p>
      {:else}
        <div class="tabela-wrap distancia">
          <table class="tabela tabela-responsiva">
            <thead>
              <tr>
                <th>#</th>
                <th>Equipe</th>
                <th>Tipo</th>
                <th>Blitzes</th>
                <th>Última blitz</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody use:cascata={`${mes}|${dados.participantes.length}`}>
              {#each dados.participantes as equipe, posicao (equipe.prefixo)}
                <tr>
                  <td class="codigo sem-rotulo">#{String(posicao + 1).padStart(2, "0")}</td>
                  <td class="titulo-cartao"><strong class="codigo">{equipe.prefixo}</strong></td>
                  <td data-rotulo="Tipo">{nomeTipo(equipe.tipoId)}</td>
                  <td class="contagem-barra" data-rotulo="Blitzes">
                    <span class="codigo contagem">{equipe.blitzes}</span>
                    <div class="trilho">
                      <div class="preenchimento" use:barra={percentualDe(equipe.blitzes, maxBlitzes)}></div>
                    </div>
                  </td>
                  <td class="codigo" data-rotulo="Última blitz">{equipe.ultimaData ? formatarData(equipe.ultimaData) : "—"}</td>
                  <td data-rotulo="Situação">
                    {#if equipe.conforme === true}
                      <span class="chip chip-ok">Todos OK</span>
                    {:else if equipe.conforme === false}
                      <span class="chip chip-atencao">Troca ou Faltante</span>
                    {:else}
                      <span class="chip">Sem dados</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <div class="grade-duas distancia">
      <div class="painel-interno">
        <h3>Não participaram <span class="contador-secao">{dados.naoParticipantes.length}</span></h3>
        {#if dados.naoParticipantes.length === 0}
          <p class="texto-suave distancia">Todas as equipes cadastradas participaram.</p>
        {:else}
          {#each agruparPorProcesso(dados.naoParticipantes) as grupo (grupo.rotulo)}
            <details class="grupo-processo distancia" open>
              <summary>
                <span class="codigo">{grupo.rotulo}</span>
                <span class="contador-secao">{grupo.equipes.length}</span>
              </summary>
              <ul class="pilha distancia" use:cascata={`${mes}|${grupo.rotulo}|${grupo.equipes.length}`}>
                {#each grupo.equipes as equipe (equipe.prefixo)}
                  <li class="etiqueta-mini">
                    <span class="codigo">{equipe.prefixo}</span>
                    {#if equipe.base}
                      <span class="texto-suave">{equipe.base}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </details>
          {/each}
        {/if}
      </div>

      <div class="painel-interno">
        <h3>Itens faltantes ou não conformes</h3>
        {#if dados.itensPendentes.length === 0}
          <p class="texto-suave distancia">Nenhum item pendente no mês.</p>
        {:else}
          <ol class="ranking distancia" use:cascata={`${mes}|${dados.itensPendentes.length}`}>
            {#each dados.itensPendentes as item, posicao (item.itemId)}
              <li class="ranking-linha">
                <div class="ranking-topo">
                  <span class="codigo posicao">{String(posicao + 1).padStart(2, "0")}</span>
                  <span class="ranking-descricao">{item.descricao}</span>
                  <span class="chip" class:chip-epi={item.grupo === "EPI"} class:chip-epc={item.grupo === "EPC"}>{item.grupo}</span>
                  <strong class="codigo total">{item.total}</strong>
                </div>
                <div class="trilho distancia">
                  <div class="preenchimento preenchimento-alerta" use:barra={percentualDe(item.total, maxPendencias)}></div>
                </div>
                <span class="texto-suave detalhe">{numero.format(item.unidadesFaltantes)} unidade(s) faltando em {item.faltantes} blitz(es) · {item.naoOk} com troca</span>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    </div>
  {:else if !erro && carregando}
    <div class="grade-kpi" aria-busy="true" aria-label="Carregando dashboard">
      {#each [0, 1, 2] as indicador (indicador)}
        <div class="kpi esqueleto-kpi">
          <span class="esqueleto" style="width: 60%"></span>
          <span class="esqueleto" style="width: 30%; height: 28px"></span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .nota {
    display: block;
    margin-top: 6px;
    font-size: 0.88rem;
    color: var(--tinta-suave);
  }

  .esqueleto-kpi {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .contador-secao {
    display: inline-block;
    margin-left: 6px;
    padding: 0 8px;
    border: 1px solid var(--borda-forte);
    border-radius: 3px;
    font-family: var(--fonte-codigo);
    font-size: 0.8rem;
    font-weight: 500;
    vertical-align: middle;
  }

  .contagem-barra {
    min-width: 200px;
  }

  .contagem {
    display: inline-block;
    min-width: 2ch;
    margin-right: 10px;
    font-weight: 500;
    vertical-align: middle;
  }

  .contagem-barra .trilho {
    display: inline-block;
    width: calc(100% - 3ch - 10px);
    vertical-align: middle;
  }

  /* Pilha de etiquetas: equipes que ainda não foram inspecionadas */
  .pilha {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* Cada processo é um grupo recolhível, com a contagem no cabeçalho */
  .grupo-processo summary {
    display: flex;
    gap: 10px;
    align-items: center;
    cursor: pointer;
    font-family: var(--fonte-titulo);
    font-weight: 600;
    font-size: 0.95rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--tinta-suave);
  }

  .grupo-processo summary:focus-visible {
    outline: 2px solid var(--primaria);
    outline-offset: 2px;
  }

  .etiqueta-mini {
    position: relative;
    display: inline-flex;
    gap: 10px;
    align-items: baseline;
    padding: 6px 12px 6px 22px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda-forte);
    border-radius: 3px;
    font-size: 0.92rem;
  }

  /* Ilhó da etiqueta de equipe, o mesmo furo das etiquetas de item */
  .etiqueta-mini::before {
    content: "";
    position: absolute;
    left: 6px;
    top: 50%;
    width: 8px;
    height: 4px;
    margin-top: -2px;
    border-radius: var(--raio-chip);
    background: var(--fundo);
    border: 1px solid var(--borda-forte);
  }



  /* Ranking de itens: maior pendência no topo, barra em cor de alerta */
  .ranking {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .ranking-topo {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .posicao {
    min-width: 2.2em;
    color: var(--tinta-suave);
  }

  .ranking-descricao {
    flex: 1;
    min-width: 0;
    font-size: 0.95rem;
  }

  .total {
    min-width: 2.5ch;
    text-align: right;
    font-size: 1.1rem;
  }

  .detalhe {
    display: block;
    margin-top: 6px;
    font-size: 0.84rem;
  }
</style>
