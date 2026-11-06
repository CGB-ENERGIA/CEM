<script lang="ts">
  import { tick } from "svelte";
  import { api } from "../api";
  import { PROCESSOS } from "../compartilhado";
  import type { FiltroPendencias, Pendencia } from "../tipos";
  import { cascata } from "../actions/animar";
  import { mostrarAviso } from "../avisos.svelte";
  import { podeEditar } from "../sessao.svelte";
  import { formatarData, normalizarTexto } from "../format";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  // Duas etapas: a lista de equipes e, só depois de entrar numa equipe, os membros e os itens dela.
  let equipeAberta = $state<string | null>(null);

  // Filtros. "Mostrar", a busca e o processo valem nas duas etapas; situação e grupo, só dentro da equipe.
  let mostrar = $state<FiltroPendencias>("abertas");
  let busca = $state("");
  let filtroProcesso = $state("");
  let filtroStatus = $state<"" | "troca" | "faltante">("");
  let filtroGrupo = $state<"" | "EPI" | "EPC">("");

  // Sempre carrega tudo e filtra aqui: assim cada linha mostra, ao mesmo tempo, o que está aberto e o que já foi resolvido.
  let pendencias = $state<Pendencia[]>([]);
  let carregando = $state(false);
  let carregou = $state(false);
  let erro = $state<string | null>(null);
  let exportando = $state(false);
  // Pendências com a ação em andamento, para travar o botão e evitar clique duplo.
  let ocupadas = $state<string[]>([]);
  let tituloEquipe: HTMLElement | undefined = $state();

  async function carregar() {
    carregando = true;
    erro = null;
    try {
      pendencias = (await api.pendencias("todas")).pendencias;
      carregou = true;
    } catch (falha) {
      erro = falha instanceof Error ? falha.message : "Não foi possível carregar as pendências.";
    } finally {
      carregando = false;
    }
  }

  $effect(() => {
    if (ativo) carregar();
  });

  const termo = $derived(normalizarTexto(busca).trim());

  const casaBusca = (p: Pendencia) =>
    termo === "" || normalizarTexto(`${p.prefixo} ${p.descricao} ${p.colaborador ?? ""}`).includes(termo);

  const aberta = (p: Pendencia) => p.resolvidaEm === null;

  // Os quatro números que aparecem em toda linha e no total: em aberto, Faltante, Troca e resolvidas.
  interface Metricas {
    abertas: number;
    faltantes: number;
    trocas: number;
    resolvidas: number;
  }

  const zerar = (): Metricas => ({ abertas: 0, faltantes: 0, trocas: 0, resolvidas: 0 });

  function contar(metricas: Metricas, p: Pendencia) {
    if (aberta(p)) {
      metricas.abertas += 1;
      if (p.status === "faltante") metricas.faltantes += 1;
      else metricas.trocas += 1;
    } else {
      metricas.resolvidas += 1;
    }
  }

  function somar(linhas: Metricas[]): Metricas {
    const total = zerar();
    for (const linha of linhas) {
      total.abertas += linha.abertas;
      total.faltantes += linha.faltantes;
      total.trocas += linha.trocas;
      total.resolvidas += linha.resolvidas;
    }
    return total;
  }

  // ---- Etapa 1: equipes ----
  interface ResumoEquipe extends Metricas {
    prefixo: string;
    processo: string | null;
    ultimaData: string;
  }

  const equipes = $derived.by((): ResumoEquipe[] => {
    const mapa = new Map<string, ResumoEquipe>();
    for (const p of pendencias) {
      if (filtroProcesso && p.processo !== filtroProcesso) continue;
      if (!casaBusca(p)) continue;
      const resumo = mapa.get(p.prefixo) ?? { ...zerar(), prefixo: p.prefixo, processo: p.processo, ultimaData: "" };
      contar(resumo, p);
      if (p.data > resumo.ultimaData) resumo.ultimaData = p.data;
      mapa.set(p.prefixo, resumo);
    }
    return [...mapa.values()]
      .filter((e) => (mostrar === "todas" ? true : mostrar === "abertas" ? e.abertas > 0 : e.resolvidas > 0))
      .sort((a, b) => b.abertas - a.abertas || a.prefixo.localeCompare(b.prefixo));
  });

  const totalEquipes = $derived(somar(equipes));

  // ---- Etapa 2: membros da equipe aberta, cada um com os totais; os itens só aparecem ao abrir o membro ----
  interface GrupoMembro extends Metricas {
    // Nome do colaborador; vazio para os itens que são da equipe (EPC e EPI sem colaborador).
    chave: string;
    nome: string;
    itens: Pendencia[];
  }

  let membrosAbertos = $state<string[]>([]);

  const gruposDaEquipe = $derived.by((): GrupoMembro[] => {
    const mapa = new Map<string, GrupoMembro>();
    for (const p of pendencias) {
      if (p.prefixo !== equipeAberta) continue;
      if (filtroStatus && p.status !== filtroStatus) continue;
      if (filtroGrupo && p.grupo !== filtroGrupo) continue;
      if (!casaBusca(p)) continue;
      const chave = p.colaborador ?? "";
      const grupo = mapa.get(chave) ?? { ...zerar(), chave, nome: p.colaborador ?? "Itens da equipe", itens: [] };
      contar(grupo, p);
      grupo.itens.push(p);
      mapa.set(chave, grupo);
    }
    return [...mapa.values()]
      .filter((g) => (mostrar === "todas" ? true : mostrar === "abertas" ? g.abertas > 0 : g.resolvidas > 0))
      .sort((a, b) => b.abertas - a.abertas || a.nome.localeCompare(b.nome));
  });

  const totalGrupos = $derived(somar(gruposDaEquipe));

  // Dentro do membro aberto, os itens seguem o filtro "Mostrar".
  const itensDoGrupo = (grupo: GrupoMembro) =>
    grupo.itens.filter((p) => (mostrar === "todas" ? true : mostrar === "abertas" ? aberta(p) : !aberta(p)));

  const membroAberto = (chave: string) => membrosAbertos.includes(chave);

  function alternarMembro(chave: string) {
    membrosAbertos = membroAberto(chave) ? membrosAbertos.filter((c) => c !== chave) : [...membrosAbertos, chave];
  }

  const todosAbertos = $derived(gruposDaEquipe.length > 0 && gruposDaEquipe.every((g) => membroAberto(g.chave)));

  function alternarTodos() {
    membrosAbertos = todosAbertos ? [] : gruposDaEquipe.map((g) => g.chave);
  }

  const dadosDaEquipe = $derived.by(() => {
    const dela = pendencias.filter((p) => p.prefixo === equipeAberta);
    return {
      processo: dela[0]?.processo ?? null,
      ultimaData: dela.reduce((maior, p) => (p.data > maior ? p.data : maior), ""),
    };
  });

  async function entrar(prefixo: string) {
    equipeAberta = prefixo;
    filtroStatus = "";
    filtroGrupo = "";
    membrosAbertos = [];
    await tick();
    tituloEquipe?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function voltar() {
    equipeAberta = null;
  }

  // Se a equipe deixou de existir nos dados (por exemplo, a blitz foi excluída), volta para a lista.
  $effect(() => {
    if (carregou && equipeAberta !== null && !pendencias.some((p) => p.prefixo === equipeAberta)) {
      equipeAberta = null;
    }
  });

  async function alterar(pendencia: Pendencia, resolvida: boolean) {
    if (ocupadas.includes(pendencia.chave)) return;
    ocupadas = [...ocupadas, pendencia.chave];
    try {
      await api.resolverPendencia(pendencia.chave, resolvida);
      mostrarAviso("ok", resolvida ? "Pendência marcada como resolvida." : "Pendência reaberta.");
      await carregar();
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível atualizar a pendência.");
    } finally {
      ocupadas = ocupadas.filter((chave) => chave !== pendencia.chave);
    }
  }

  async function exportar() {
    exportando = true;
    try {
      const arquivo = await api.exportarPendencias(mostrar);
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pendencias-paes-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível exportar.");
    } finally {
      exportando = false;
    }
  }

  const textoMostrar: Record<FiltroPendencias, string> = {
    abertas: "em aberto",
    resolvidas: "resolvida",
    todas: "registrada",
  };
</script>

{#snippet seta(direcao: "voltar" | "avancar")}
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d={direcao === "voltar" ? "M12.5 4.5 7 10l5.5 5.5" : "M7.5 4.5 13 10l-5.5 5.5"} />
  </svg>
{/snippet}

<!-- Os quatro números de uma linha. No computador o nome da coluna fica no cabeçalho; no celular cada número leva o seu rótulo. -->
{#snippet numeros(m: Metricas)}
  <span class="metrica metrica-aberta" class:zero={m.abertas === 0}>
    <strong class="codigo">{m.abertas}</strong><small>em aberto</small>
  </span>
  <span class="metrica" class:zero={m.faltantes === 0}>
    <strong class="codigo">{m.faltantes}</strong><small>Faltante</small>
  </span>
  <span class="metrica" class:zero={m.trocas === 0}>
    <strong class="codigo">{m.trocas}</strong><small>Troca</small>
  </span>
  <span class="metrica" class:zero={m.resolvidas === 0}>
    <strong class="codigo">{m.resolvidas}</strong><small>{m.resolvidas === 1 ? "resolvida" : "resolvidas"}</small>
  </span>
{/snippet}

{#snippet colunas(primeira: string, comData: boolean)}
  <div class="colunas" class:com-data={comData} aria-hidden="true">
    <span>{primeira}</span>
    <span class="num">Em aberto</span>
    <span class="num"><i class="marca marca-falta"></i>Faltante</span>
    <span class="num"><i class="marca marca-atencao"></i>Troca</span>
    <span class="num"><i class="marca marca-ok"></i>Resolvidas</span>
    {#if comData}
      <span class="num">Última blitz</span>
    {/if}
    <span></span>
  </div>
{/snippet}

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Controle de pendências</h2>
      <p>
        Cada Troca ou Faltante registrado numa blitz fica aqui até ser resolvido. Escolha uma equipe, depois um membro,
        para ver os itens e marcar como resolvido quando o item for trocado ou entregue.
      </p>
    </div>
    <div class="cabecalho-acoes">
      <button class="botao-secundario" type="button" onclick={exportar} disabled={exportando || !carregou}>
        {exportando ? "Exportando..." : "Exportar planilha"}
      </button>
    </div>
  </div>

  {#if erro}
    <p class="mensagem mensagem-erro" role="alert">{erro}</p>
  {/if}

  {#if equipeAberta === null}
    <!-- Etapa 1: uma linha por equipe, com os mesmos quatro números do total -->
    <div class="filtros-controle">
      <label class="rotulo">
        Mostrar
        <select bind:value={mostrar}>
          <option value="abertas">Em aberto</option>
          <option value="resolvidas">Resolvidas</option>
          <option value="todas">Todas</option>
        </select>
      </label>
      <label class="rotulo">
        Buscar
        <input type="search" bind:value={busca} placeholder="Equipe, colaborador ou material" />
      </label>
      <label class="rotulo">
        Processo
        <select bind:value={filtroProcesso}>
          <option value="">Todos</option>
          {#each PROCESSOS as processo (processo)}
            <option value={processo}>{processo}</option>
          {/each}
        </select>
      </label>
    </div>

    {#if carregando && !carregou}
      <p class="texto-suave distancia" aria-busy="true">Carregando pendências...</p>
    {:else if carregou && equipes.length === 0}
      <p class="texto-suave distancia">
        {pendencias.length === 0
          ? "Nenhuma pendência registrada ainda."
          : `Nenhuma equipe com pendência ${textoMostrar[mostrar]} com esses filtros.`}
      </p>
    {:else if equipes.length > 0}
      <div class="quadro distancia">
        {@render colunas("Equipe", true)}
        <div class="linha-total com-data" role="group" aria-label="Total de todas as equipes">
          <span class="linha-nome">
            <strong>Total</strong>
            <span class="texto-suave">{equipes.length} {equipes.length === 1 ? "equipe" : "equipes"}</span>
          </span>
          {@render numeros(totalEquipes)}
          <span class="vazio"></span>
          <span class="vazio"></span>
        </div>
        <ul class="linhas" use:cascata={`${mostrar}|${filtroProcesso}|${busca}|${equipes.length}`}>
          {#each equipes as equipe (equipe.prefixo)}
            <li>
              <button type="button" class="linha-quadro com-data" onclick={() => entrar(equipe.prefixo)}>
                <span class="linha-nome">
                  <strong class="codigo">{equipe.prefixo}</strong>
                  {#if equipe.processo}
                    <span class="chip">{equipe.processo}</span>
                  {/if}
                </span>
                {@render numeros(equipe)}
                <span class="metrica-data codigo texto-suave">{formatarData(equipe.ultimaData)}</span>
                <span class="seta" aria-hidden="true">{@render seta("avancar")}</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {:else}
    <!-- Etapa 2: a equipe escolhida, com um grupo por membro -->
    <div class="cabecalho-equipe">
      <button type="button" class="botao-secundario voltar" onclick={voltar}>
        {@render seta("voltar")}
        Todas as equipes
      </button>
      <div class="titulo-equipe">
        <h3 bind:this={tituloEquipe} tabindex="-1">
          <span class="codigo">{equipeAberta}</span>
          {#if dadosDaEquipe.processo}
            <span class="chip">{dadosDaEquipe.processo}</span>
          {/if}
        </h3>
        {#if dadosDaEquipe.ultimaData}
          <p class="texto-suave">Última blitz em {formatarData(dadosDaEquipe.ultimaData)}</p>
        {/if}
      </div>
    </div>

    <div class="filtros-controle distancia">
      <label class="rotulo">
        Mostrar
        <select bind:value={mostrar}>
          <option value="abertas">Em aberto</option>
          <option value="resolvidas">Resolvidas</option>
          <option value="todas">Todas</option>
        </select>
      </label>
      <label class="rotulo">
        Buscar
        <input type="search" bind:value={busca} placeholder="Colaborador ou material" />
      </label>
      <label class="rotulo">
        Situação
        <select bind:value={filtroStatus}>
          <option value="">Troca e Faltante</option>
          <option value="troca">Só Troca</option>
          <option value="faltante">Só Faltante</option>
        </select>
      </label>
      <label class="rotulo">
        Grupo
        <select bind:value={filtroGrupo}>
          <option value="">EPI e EPC</option>
          <option value="EPI">Só EPI</option>
          <option value="EPC">Só EPC</option>
        </select>
      </label>
    </div>

    {#if gruposDaEquipe.length === 0}
      <p class="texto-suave distancia">
        Nenhum {mostrar === "abertas" ? "item em aberto" : mostrar === "resolvidas" ? "item resolvido" : "item registrado"} nesta equipe com esses filtros.
      </p>
    {:else}
      <div class="cabecalho-membros distancia">
        <p class="texto-suave">Toque num membro para ver os itens dele.</p>
        <button type="button" class="botao-secundario" onclick={alternarTodos}>
          {todosAbertos ? "Recolher todos" : "Abrir todos"}
        </button>
      </div>

      <div class="quadro">
        {@render colunas("Membro", false)}
        <div class="linha-total" role="group" aria-label="Total da equipe">
          <span class="linha-nome">
            <strong>Total da equipe</strong>
            <span class="texto-suave">{gruposDaEquipe.length} {gruposDaEquipe.length === 1 ? "grupo" : "grupos"}</span>
          </span>
          {@render numeros(totalGrupos)}
          <span class="vazio"></span>
        </div>

        <ul class="linhas" use:cascata={`${equipeAberta}|${mostrar}|${filtroStatus}|${filtroGrupo}|${busca}|${gruposDaEquipe.length}`}>
          {#each gruposDaEquipe as grupo (grupo.chave)}
            {@const aberto = membroAberto(grupo.chave)}
            {@const itens = itensDoGrupo(grupo)}
            <li class="membro" class:membro-aberto={aberto}>
              <button
                type="button"
                class="linha-quadro"
                aria-expanded={aberto}
                aria-controls={`itens-${equipeAberta}-${grupo.chave || "equipe"}`}
                onclick={() => alternarMembro(grupo.chave)}
              >
                <span class="linha-nome">
                  <strong>{grupo.nome}</strong>
                  {#if grupo.chave === ""}
                    <span class="texto-suave">EPC e itens sem colaborador</span>
                  {/if}
                </span>
                {@render numeros(grupo)}
                <span class="seta" class:girada={aberto} aria-hidden="true">{@render seta("avancar")}</span>
              </button>

              {#if aberto}
                <div class="membro-itens" id={`itens-${equipeAberta}-${grupo.chave || "equipe"}`}>
                  <div class="tabela-wrap">
                    <table class="tabela tabela-responsiva">
                      <thead>
                        <tr>
                          <th>Material</th>
                          <th>Situação</th>
                          <th class="numerico">Qtd.</th>
                          <th>Blitz</th>
                          <th>Controle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each itens as pendencia (pendencia.chave)}
                          <tr>
                            <td class="titulo-cartao">
                              <span class="material">{pendencia.descricao}</span>
                              <span class="chip" class:chip-epi={pendencia.grupo === "EPI"} class:chip-epc={pendencia.grupo === "EPC"}>
                                {pendencia.grupo}
                              </span>
                              {#if pendencia.observacao}
                                <span class="texto-suave observacao">{pendencia.observacao}</span>
                              {/if}
                            </td>
                            <td data-rotulo="Situação">
                              {#if pendencia.status === "faltante"}
                                <span class="chip chip-falta">Faltante</span>
                              {:else}
                                <span class="chip chip-atencao">Troca</span>
                              {/if}
                            </td>
                            <td data-rotulo="Qtd." class="numerico codigo">{pendencia.quantidade}</td>
                            <td data-rotulo="Blitz" class="codigo">{formatarData(pendencia.data)}</td>
                            <td data-rotulo="Controle">
                              {#if pendencia.resolvidaEm}
                                <span class="chip chip-ok">Resolvida</span>
                                <span class="texto-suave observacao">
                                  {formatarData(pendencia.resolvidaEm)}{pendencia.resolvidaPor ? ` · ${pendencia.resolvidaPor}` : ""}
                                </span>
                                {#if podeEditar()}
                                  <button
                                    type="button"
                                    class="botao-secundario"
                                    disabled={ocupadas.includes(pendencia.chave)}
                                    onclick={() => alterar(pendencia, false)}
                                  >
                                    Reabrir
                                  </button>
                                {/if}
                              {:else if podeEditar()}
                                <button
                                  type="button"
                                  class="botao"
                                  disabled={ocupadas.includes(pendencia.chave)}
                                  onclick={() => alterar(pendencia, true)}
                                >
                                  Marcar como resolvido
                                </button>
                              {:else}
                                <span class="chip">Em aberto</span>
                              {/if}
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</section>

<style>
  .filtros-controle {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 14px;
  }

  /* ---------- Quadro: cabeçalho de colunas, linha de total e uma linha por equipe ou membro ---------- */
  .quadro {
    --colunas: minmax(0, 1fr) repeat(4, 96px) 24px;
    --colunas-com-data: minmax(0, 1fr) repeat(4, 96px) 112px 24px;
    display: flex;
    flex-direction: column;
  }

  .colunas,
  .linha-total,
  .linha-quadro {
    display: grid;
    grid-template-columns: var(--colunas);
    align-items: center;
    gap: 12px;
  }

  .colunas.com-data,
  .linha-total.com-data,
  .linha-quadro.com-data {
    grid-template-columns: var(--colunas-com-data);
  }

  .colunas {
    padding: 0 14px 8px;
    font-family: var(--fonte-titulo);
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--tinta-suave);
  }

  .colunas .num {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    white-space: nowrap;
  }

  /* Quadradinho com a cor da situação, ao lado do nome da coluna (a cor nunca vai sozinha: o nome está ao lado) */
  .marca {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }

  .marca-falta {
    background: var(--falta);
  }

  .marca-atencao {
    background: var(--atencao);
  }

  .marca-ok {
    background: var(--ok);
  }

  /* A linha de total fecha a conta: é a soma das linhas logo abaixo */
  .linha-total {
    padding: 10px 14px;
    margin-bottom: 8px;
    background: var(--fundo);
    border: 1px solid var(--borda-forte);
    border-radius: var(--raio-etiqueta);
  }

  .linhas {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .linha-quadro {
    width: 100%;
    min-height: 60px;
    padding: 10px 14px;
    font: inherit;
    color: inherit;
    text-align: left;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda);
    border-radius: var(--raio-etiqueta);
    cursor: pointer;
    transition: border-color 160ms ease, background-color 160ms ease;
  }

  .linha-quadro:hover {
    border-color: var(--primaria);
  }

  .linha-quadro:active {
    background: var(--primaria-suave);
  }

  .linha-quadro:focus-visible {
    outline: 2px solid var(--primaria);
    outline-offset: 2px;
  }

  .linha-nome {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    min-width: 0;
  }

  .linha-nome > .texto-suave {
    flex-basis: 100%;
    font-size: 0.82rem;
  }

  /* Números alinhados à direita, em coluna; o nome da coluna só aparece no celular */
  .metrica {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
  }

  .metrica strong {
    font-size: 1.05rem;
  }

  .metrica-aberta strong {
    font-size: 1.35rem;
  }

  .metrica.zero strong {
    font-weight: 400;
    color: var(--tinta-suave);
    opacity: 0.7;
  }

  .metrica small {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .metrica-data {
    text-align: right;
    font-size: 0.85rem;
  }

  .seta {
    display: inline-flex;
    justify-content: flex-end;
    color: var(--tinta-suave);
    transition: transform 200ms ease;
  }

  .seta.girada {
    transform: rotate(90deg);
  }

  /* ---------- Dentro da equipe ---------- */
  .cabecalho-equipe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 20px;
    margin-top: 4px;
  }

  .titulo-equipe h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 1.5rem;
  }

  .titulo-equipe h3:focus {
    outline: none;
  }

  .titulo-equipe h3:focus-visible {
    outline: 2px solid var(--primaria);
    outline-offset: 4px;
  }

  .titulo-equipe p {
    margin: 2px 0 0;
    font-size: 0.9rem;
  }

  .voltar {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
  }

  .cabecalho-membros {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    margin-bottom: 14px;
  }

  .cabecalho-membros p {
    margin: 0;
  }

  /* Membro aberto: a linha e os itens formam um bloco só */
  .membro {
    background: var(--superficie-elevada);
    border: 1px solid var(--borda);
    border-radius: var(--raio-etiqueta);
    transition: border-color 160ms ease;
  }

  .membro-aberto {
    border-color: var(--borda-forte);
  }

  .membro .linha-quadro {
    border: 0;
    background: transparent;
  }

  .membro .linha-quadro:hover {
    background: var(--primaria-suave);
  }

  .membro .linha-quadro:focus-visible {
    outline-offset: -2px;
  }

  .membro-itens {
    padding: 0 14px 12px;
    border-top: 1px solid var(--borda);
  }

  .membro-itens :global(.tabela-wrap) {
    margin-top: 8px;
  }

  .material {
    display: block;
    margin-bottom: 4px;
  }

  .observacao {
    display: block;
    margin-top: 4px;
    font-size: 0.85rem;
  }

  td :global(.botao),
  td :global(.botao-secundario) {
    margin-top: 6px;
  }

  /* ---------- Celular e telas estreitas: cada linha vira um cartão com os quatro números rotulados ---------- */
  @media (max-width: 900px) {
    .colunas {
      display: none;
    }

    .colunas.com-data,
    .linha-total,
    .linha-total.com-data,
    .linha-quadro,
    .linha-quadro.com-data {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px 8px;
      position: relative;
    }

    .linha-nome {
      grid-column: 1 / -1;
      padding-right: 28px;
    }

    .metrica {
      align-items: flex-start;
      text-align: left;
    }

    .metrica small {
      position: static;
      width: auto;
      height: auto;
      overflow: visible;
      clip: auto;
      margin-top: 2px;
      font-size: 0.72rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--tinta-suave);
    }

    .metrica-data {
      grid-column: 1 / -1;
      text-align: left;
    }

    .vazio {
      display: none;
    }

    .seta {
      position: absolute;
      top: 12px;
      right: 12px;
    }
  }

  @media (max-width: 640px) {
    .filtros-controle {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
