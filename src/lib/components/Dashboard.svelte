<script lang="ts">
  import materiaisJson from "../data/materiais.json";
  import { api } from "../api";
  import { ROTULO_ESCOPO } from "../compartilhado";
  import type { Dashboard, Materiais, RankingEquipe } from "../tipos";
  import { formatarMes, formatarData, formatarPercentual, mesHoje, normalizarTexto, numero } from "../format";
  import { barra, cascata, numeroAnimado } from "../actions/animar";
  import SeletorMes from "./SeletorMes.svelte";

  interface Props {
    ativo: boolean;
    // Abre a aba Controle, para quem quer ver as pendências em aberto.
    abrirControle?: () => void;
  }

  let { ativo, abrirControle }: Props = $props();

  const materiais = materiaisJson as Materiais;

  let mes = $state(mesHoje());
  let dados = $state<Dashboard | null>(null);
  let erro = $state<string | null>(null);
  let carregando = $state(false);

  // Filtros da página: o processo vale para a tabela e para a lista de equipes sem blitz.
  // Nulo mostra todos; texto vazio é "Sem processo".
  let filtroProcesso = $state<string | null>(null);
  let busca = $state("");

  const maxBlitzes = $derived(Math.max(1, ...(dados?.participantes.map((equipe) => equipe.blitzes) ?? [])));
  const maxPendencias = $derived(Math.max(1, ...(dados?.itensPendentes.map((item) => item.total) ?? [])));
  const termoBusca = $derived(normalizarTexto(busca).trim());

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

  // Quantas equipes de cada processo já tiveram blitz no mês.
  interface Cobertura {
    chave: string;
    rotulo: string;
    total: number;
    participaram: number;
  }

  const cobertura = $derived.by((): Cobertura[] => {
    if (!dados) return [];
    const mapa = new Map<string, Cobertura>();
    const contar = (equipe: RankingEquipe, participou: boolean) => {
      const chave = equipe.processo ?? "";
      const item = mapa.get(chave) ?? { chave, rotulo: equipe.processo ?? "Sem processo", total: 0, participaram: 0 };
      item.total += 1;
      if (participou) item.participaram += 1;
      mapa.set(chave, item);
    };
    for (const equipe of dados.participantes) contar(equipe, true);
    for (const equipe of dados.naoParticipantes) contar(equipe, false);
    return [...mapa.values()].sort(
      (a, b) => Number(a.chave === "") - Number(b.chave === "") || a.rotulo.localeCompare(b.rotulo),
    );
  });

  const coberturaGeral = $derived(dados ? percentualDe(dados.equipesParticipantes, dados.equipesTotais) : 0);

  const passaFiltro = (equipe: RankingEquipe) => filtroProcesso === null || (equipe.processo ?? "") === filtroProcesso;

  // A tabela mostra as primeiras equipes; o resto abre sob demanda para a página não ficar longa.
  const LINHAS_INICIAIS = 10;
  let mostrarTodas = $state(false);

  const participantesFiltrados = $derived((dados?.participantes ?? []).filter(passaFiltro));
  const participantesVisiveis = $derived(
    mostrarTodas ? participantesFiltrados : participantesFiltrados.slice(0, LINHAS_INICIAIS),
  );
  const naoParticipantesVisiveis = $derived(
    (dados?.naoParticipantes ?? []).filter(
      (equipe) =>
        passaFiltro(equipe) &&
        (termoBusca === "" || normalizarTexto(`${equipe.prefixo} ${equipe.base ?? ""}`).includes(termoBusca)),
    ),
  );

  function alternarProcesso(chave: string) {
    filtroProcesso = filtroProcesso === chave ? null : chave;
  }

  const rotuloFiltro = $derived(
    filtroProcesso === null ? "" : filtroProcesso === "" ? "Sem processo" : filtroProcesso,
  );
</script>

{#snippet conteudoPendencias(abertas: number)}
  <span class="kpi-rotulo">Pendências em aberto</span>
  <div class="kpi-valor" use:numeroAnimado={{ valor: abertas, formatar: inteiro }}></div>
  <span class="nota">
    {abertas > 0 && abrirControle ? "Trocas e Faltantes sem solução. Abrir o controle" : "Trocas e Faltantes sem solução, de todos os meses"}
  </span>
{/snippet}

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Dashboard</h2>
      <p>Resumo de {formatarMes(mes)}: participação, conformidade e itens que mais faltam.</p>
    </div>
    <SeletorMes bind:mes />
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
        <div class="trilho trilho-kpi" aria-hidden="true">
          <div class="preenchimento" use:barra={coberturaGeral}></div>
        </div>
        <span class="nota">de {numero.format(dados.equipesTotais)} cadastradas ({formatarPercentual(coberturaGeral)})</span>
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
      {#if dados.pendenciasAbertas !== null}
        {#if abrirControle && dados.pendenciasAbertas > 0}
          <button type="button" class="kpi etiqueta kpi-acao" onclick={abrirControle}>
            {@render conteudoPendencias(dados.pendenciasAbertas)}
          </button>
        {:else}
          <div class="kpi etiqueta">
            {@render conteudoPendencias(dados.pendenciasAbertas)}
          </div>
        {/if}
      {/if}
    </div>

    {#if cobertura.length > 0}
      <div class="painel-interno distancia">
        <div class="cabecalho-secao">
          <h3>Cobertura por processo</h3>
          {#if filtroProcesso !== null}
            <button type="button" class="botao-secundario" onclick={() => (filtroProcesso = null)}>
              Filtrando por {rotuloFiltro}. Mostrar todos
            </button>
          {:else}
            <span class="texto-suave dica">Toque num processo para filtrar a página</span>
          {/if}
        </div>
        <ul class="cobertura" use:cascata={`${mes}|${cobertura.length}`}>
          {#each cobertura as item (item.chave)}
            {@const percentual = percentualDe(item.participaram, item.total)}
            <li>
              <button
                type="button"
                class="cobertura-linha"
                aria-pressed={filtroProcesso === item.chave}
                onclick={() => alternarProcesso(item.chave)}
              >
                <span class="codigo cobertura-rotulo">{item.rotulo}</span>
                <span class="trilho cobertura-trilho">
                  <span class="preenchimento" class:preenchimento-ok={percentual >= 100} use:barra={percentual}></span>
                </span>
                <span class="codigo cobertura-valor">{item.participaram}/{item.total}</span>
                <span class="texto-suave cobertura-pct">{formatarPercentual(percentual)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="painel-interno distancia">
      <h3>Equipes que participaram <span class="contador-secao">{participantesFiltrados.length}</span></h3>
      {#if participantesFiltrados.length === 0}
        <p class="texto-suave distancia">
          {dados.participantes.length === 0
            ? "Nenhuma equipe foi blitzada neste mês."
            : `Nenhuma equipe de ${rotuloFiltro} foi blitzada neste mês.`}
        </p>
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
            <tbody use:cascata={`${mes}|${filtroProcesso}|${participantesVisiveis.length}`}>
              {#each participantesVisiveis as equipe, posicao (equipe.prefixo)}
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
                    {#if equipe.ultimoEscopo && equipe.ultimoEscopo !== "todos"}
                      <span class="chip">{ROTULO_ESCOPO[equipe.ultimoEscopo]}</span>
                    {/if}
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
        {#if participantesFiltrados.length > LINHAS_INICIAIS}
          <div class="ver-todas">
            <button type="button" class="botao-secundario" aria-expanded={mostrarTodas} onclick={() => (mostrarTodas = !mostrarTodas)}>
              {mostrarTodas ? "Mostrar só as 10 primeiras" : `Mostrar as ${participantesFiltrados.length} equipes`}
            </button>
          </div>
        {/if}
      {/if}
    </div>

    <div class="grade-duas distancia">
      <div class="painel-interno">
        <div class="cabecalho-secao">
          <h3>Não participaram <span class="contador-secao">{naoParticipantesVisiveis.length}</span></h3>
          {#if dados.naoParticipantes.length > 0}
            <input
              type="search"
              class="busca-equipes"
              bind:value={busca}
              placeholder="Buscar prefixo ou base"
              aria-label="Buscar equipe que não participou"
            />
          {/if}
        </div>
        {#if dados.naoParticipantes.length === 0}
          <p class="texto-suave distancia">Todas as equipes cadastradas participaram.</p>
        {:else if naoParticipantesVisiveis.length === 0}
          <p class="texto-suave distancia">Nenhuma equipe encontrada com esses filtros.</p>
        {:else}
          {#each agruparPorProcesso(naoParticipantesVisiveis) as grupo (grupo.rotulo)}
            <details class="grupo-processo distancia" open={filtroProcesso !== null || termoBusca !== ""}>
              <summary>
                <span class="codigo">{grupo.rotulo}</span>
                <span class="contador-secao">{grupo.equipes.length}</span>
                <span class="texto-suave resumo-acao">Ver equipes</span>
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

  .trilho-kpi {
    margin-top: 10px;
  }

  /* Indicador que leva a outra aba: mesma etiqueta, com resposta ao toque */
  .kpi-acao {
    width: 100%;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 160ms ease, transform 160ms var(--ease-saida);
  }

  .kpi-acao:hover {
    border-color: var(--primaria);
  }

  .kpi-acao:active {
    transform: translateY(1px);
  }

  .kpi-acao:focus-visible {
    outline: 2px solid var(--primaria);
    outline-offset: 2px;
  }

  .cabecalho-secao {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
  }

  .cabecalho-secao h3 {
    margin: 0;
  }

  .dica {
    font-size: 0.88rem;
  }

  .busca-equipes {
    width: min(260px, 100%);
  }

  /* Cobertura por processo: cada linha é um filtro */
  .cobertura {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .cobertura-linha {
    display: grid;
    grid-template-columns: 14ch minmax(80px, 1fr) 7ch 6ch;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    font: inherit;
    color: inherit;
    text-align: left;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda);
    border-radius: var(--raio-etiqueta);
    cursor: pointer;
    transition: border-color 160ms ease, background-color 160ms ease;
  }

  .cobertura-linha:hover {
    border-color: var(--borda-forte);
  }

  .cobertura-linha[aria-pressed="true"] {
    border-color: var(--primaria);
    background: var(--primaria-suave);
  }

  .cobertura-linha:focus-visible {
    outline: 2px solid var(--primaria);
    outline-offset: 2px;
  }

  .cobertura-trilho {
    display: block;
  }

  .cobertura-trilho .preenchimento {
    display: block;
  }

  .ver-todas {
    display: flex;
    justify-content: center;
    margin-top: 14px;
  }

  .cobertura-valor,
  .cobertura-pct {
    text-align: right;
  }

  .cobertura-pct {
    font-size: 0.85rem;
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

  /* Cada processo é um grupo recolhível, fechado por padrão, com a contagem no cabeçalho */
  .grupo-processo summary {
    display: flex;
    gap: 10px;
    align-items: center;
    min-height: 44px;
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

  .resumo-acao {
    margin-left: auto;
    font-size: 0.8rem;
  }

  .grupo-processo[open] .resumo-acao {
    display: none;
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

  @media (max-width: 640px) {
    .cobertura-linha {
      grid-template-columns: 1fr auto auto;
      gap: 8px 12px;
    }

    .cobertura-trilho {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>
