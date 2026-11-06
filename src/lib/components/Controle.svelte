<script lang="ts">
  import { tick } from "svelte";
  import { api } from "../api";
  import { PROCESSOS } from "../compartilhado";
  import type { FiltroPendencias, Pendencia } from "../tipos";
  import { cascata } from "../actions/animar";
  import { mostrarAviso } from "../avisos.svelte";
  import { podeEditar } from "../sessao.svelte";
  import { formatarData, normalizarTexto, numero } from "../format";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  // Duas etapas: a lista de equipes e, só depois de entrar numa equipe, os itens dela.
  let equipeAberta = $state<string | null>(null);

  // Filtros. "Mostrar", a busca e o processo valem nas duas etapas; situação e grupo, só dentro da equipe.
  let mostrar = $state<FiltroPendencias>("abertas");
  let busca = $state("");
  let filtroProcesso = $state("");
  let filtroStatus = $state<"" | "troca" | "faltante">("");
  let filtroGrupo = $state<"" | "EPI" | "EPC">("");

  // Sempre carrega tudo e filtra aqui: assim cada equipe mostra, ao mesmo tempo, o que está aberto e o que já foi resolvido.
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

  // ---- Etapa 1: equipes ----
  interface ResumoEquipe {
    prefixo: string;
    processo: string | null;
    abertas: number;
    faltantes: number;
    trocas: number;
    resolvidas: number;
    ultimaData: string;
  }

  const equipes = $derived.by((): ResumoEquipe[] => {
    const mapa = new Map<string, ResumoEquipe>();
    for (const p of pendencias) {
      if (filtroProcesso && p.processo !== filtroProcesso) continue;
      if (!casaBusca(p)) continue;
      const resumo = mapa.get(p.prefixo) ?? {
        prefixo: p.prefixo,
        processo: p.processo,
        abertas: 0,
        faltantes: 0,
        trocas: 0,
        resolvidas: 0,
        ultimaData: "",
      };
      if (aberta(p)) {
        resumo.abertas += 1;
        if (p.status === "faltante") resumo.faltantes += 1;
        else resumo.trocas += 1;
      } else {
        resumo.resolvidas += 1;
      }
      if (p.data > resumo.ultimaData) resumo.ultimaData = p.data;
      mapa.set(p.prefixo, resumo);
    }
    return [...mapa.values()]
      .filter((e) => (mostrar === "todas" ? true : mostrar === "abertas" ? e.abertas > 0 : e.resolvidas > 0))
      .sort((a, b) => b.abertas - a.abertas || a.prefixo.localeCompare(b.prefixo));
  });

  const totalAbertas = $derived(equipes.reduce((soma, e) => soma + e.abertas, 0));
  const totalResolvidas = $derived(equipes.reduce((soma, e) => soma + e.resolvidas, 0));

  // ---- Etapa 2: itens da equipe aberta ----
  const itensDaEquipe = $derived(
    pendencias.filter((p) => {
      if (p.prefixo !== equipeAberta) return false;
      if (mostrar === "abertas" && !aberta(p)) return false;
      if (mostrar === "resolvidas" && aberta(p)) return false;
      if (filtroStatus && p.status !== filtroStatus) return false;
      if (filtroGrupo && p.grupo !== filtroGrupo) return false;
      return casaBusca(p);
    }),
  );

  const resumoAberta = $derived.by(() => {
    const dela = pendencias.filter((p) => p.prefixo === equipeAberta);
    const abertasDela = dela.filter(aberta);
    return {
      processo: dela[0]?.processo ?? null,
      abertas: abertasDela.length,
      faltantes: abertasDela.filter((p) => p.status === "faltante").length,
      trocas: abertasDela.filter((p) => p.status === "troca").length,
      resolvidas: dela.length - abertasDela.length,
    };
  });

  async function entrar(prefixo: string) {
    equipeAberta = prefixo;
    filtroStatus = "";
    filtroGrupo = "";
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

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Controle de pendências</h2>
      <p>
        Cada Troca ou Faltante registrado numa blitz fica aqui até ser resolvido. Escolha uma equipe para ver os itens
        e marcar como resolvido quando o item for trocado ou entregue.
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
    <!-- Etapa 1: uma linha por equipe -->
    {#if carregou}
      <div class="grade-kpi resumo-controle">
        <div class="kpi etiqueta">
          <span class="kpi-rotulo">Equipes</span>
          <div class="kpi-valor">{numero.format(equipes.length)}</div>
          <span class="nota">com pendência {textoMostrar[mostrar]}</span>
        </div>
        <div class="kpi etiqueta">
          <span class="kpi-rotulo">Em aberto</span>
          <div class="kpi-valor">{numero.format(totalAbertas)}</div>
          <span class="nota">Trocas e Faltantes sem solução</span>
        </div>
        <div class="kpi etiqueta">
          <span class="kpi-rotulo">Resolvidas</span>
          <div class="kpi-valor">{numero.format(totalResolvidas)}</div>
          <span class="nota">já trocadas ou entregues</span>
        </div>
      </div>
    {/if}

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
      <ul class="equipes-lista distancia" use:cascata={`${mostrar}|${filtroProcesso}|${busca}|${equipes.length}`}>
        {#each equipes as equipe (equipe.prefixo)}
          <li>
            <button type="button" class="equipe-linha" onclick={() => entrar(equipe.prefixo)}>
              <span class="equipe-nome">
                <strong class="codigo">{equipe.prefixo}</strong>
                {#if equipe.processo}
                  <span class="chip">{equipe.processo}</span>
                {/if}
              </span>
              <span class="equipe-abertas" class:zerada={equipe.abertas === 0}>
                <strong class="codigo">{equipe.abertas}</strong>
                <span class="texto-suave">em aberto</span>
              </span>
              <span class="equipe-chips">
                {#if equipe.faltantes > 0}
                  <span class="chip chip-falta">{equipe.faltantes} Faltante</span>
                {/if}
                {#if equipe.trocas > 0}
                  <span class="chip chip-atencao">{equipe.trocas} Troca</span>
                {/if}
                {#if equipe.resolvidas > 0}
                  <span class="chip chip-ok">{equipe.resolvidas} resolvida{equipe.resolvidas === 1 ? "" : "s"}</span>
                {/if}
              </span>
              <span class="codigo equipe-data texto-suave">{formatarData(equipe.ultimaData)}</span>
              <span class="equipe-seta" aria-hidden="true">{@render seta("avancar")}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <!-- Etapa 2: itens da equipe escolhida -->
    <div class="cabecalho-equipe distancia">
      <button type="button" class="botao-secundario voltar" onclick={voltar}>
        {@render seta("voltar")}
        Todas as equipes
      </button>
      <h3 bind:this={tituloEquipe} tabindex="-1">
        <span class="codigo">{equipeAberta}</span>
        {#if resumoAberta.processo}
          <span class="chip">{resumoAberta.processo}</span>
        {/if}
      </h3>
      <div class="equipe-chips">
        <span class="chip" class:chip-atencao={resumoAberta.abertas > 0} class:chip-ok={resumoAberta.abertas === 0}>
          {resumoAberta.abertas} em aberto
        </span>
        {#if resumoAberta.faltantes > 0}
          <span class="chip chip-falta">{resumoAberta.faltantes} Faltante</span>
        {/if}
        {#if resumoAberta.trocas > 0}
          <span class="chip chip-atencao">{resumoAberta.trocas} Troca</span>
        {/if}
        {#if resumoAberta.resolvidas > 0}
          <span class="chip chip-ok">{resumoAberta.resolvidas} resolvida{resumoAberta.resolvidas === 1 ? "" : "s"}</span>
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

    {#if itensDaEquipe.length === 0}
      <p class="texto-suave distancia">
        Nenhum item {mostrar === "abertas" ? "em aberto" : mostrar === "resolvidas" ? "resolvido" : "registrado"} nesta equipe com esses filtros.
      </p>
    {:else}
      <div class="tabela-wrap distancia">
        <table class="tabela tabela-responsiva">
          <thead>
            <tr>
              <th>Material</th>
              <th>Quem</th>
              <th>Situação</th>
              <th class="numerico">Qtd.</th>
              <th>Blitz</th>
              <th>Controle</th>
            </tr>
          </thead>
          <tbody use:cascata={`${equipeAberta}|${mostrar}|${filtroStatus}|${filtroGrupo}|${busca}|${itensDaEquipe.length}`}>
            {#each itensDaEquipe as pendencia (pendencia.chave)}
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
                <td data-rotulo="Quem">{pendencia.colaborador ?? "Equipe"}</td>
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
    {/if}
  {/if}
</section>

<style>
  .nota {
    display: block;
    margin-top: 6px;
    font-size: 0.88rem;
    color: var(--tinta-suave);
  }

  .filtros-controle {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 14px;
  }

  /* Lista de equipes: cada linha abre a equipe */
  .equipes-lista {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .equipe-linha {
    display: grid;
    grid-template-columns: minmax(170px, 1.2fr) 110px minmax(0, 2fr) 96px 24px;
    align-items: center;
    gap: 12px 16px;
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

  .equipe-linha:hover {
    border-color: var(--primaria);
  }

  .equipe-linha:active {
    background: var(--primaria-suave);
  }

  .equipe-linha:focus-visible {
    outline: 2px solid var(--primaria);
    outline-offset: 2px;
  }

  .equipe-nome {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .equipe-abertas {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .equipe-abertas strong {
    font-size: 1.35rem;
  }

  .equipe-abertas.zerada strong {
    color: var(--tinta-suave);
  }

  .equipe-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .equipe-data {
    text-align: right;
    font-size: 0.85rem;
  }

  .equipe-seta {
    display: inline-flex;
    justify-content: flex-end;
    color: var(--tinta-suave);
  }

  /* Dentro da equipe */
  .cabecalho-equipe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
  }

  .cabecalho-equipe h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 1.4rem;
  }

  .cabecalho-equipe h3:focus {
    outline: none;
  }

  .cabecalho-equipe h3:focus-visible {
    outline: 2px solid var(--primaria);
    outline-offset: 4px;
  }

  .voltar {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
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

  @media (max-width: 900px) {
    .equipe-linha {
      grid-template-columns: minmax(0, 1fr) auto 24px;
    }

    .equipe-chips {
      grid-column: 1 / 3;
      grid-row: 2;
    }

    .equipe-data {
      grid-column: 1 / 3;
      grid-row: 3;
      text-align: left;
    }

    .equipe-seta {
      grid-column: 3;
      grid-row: 1;
    }
  }

  @media (max-width: 640px) {
    .filtros-controle {
      grid-template-columns: minmax(0, 1fr);
    }

    /* No celular, as equipes vêm primeiro: os totais já aparecem em cada linha. */
    .resumo-controle {
      display: none;
    }
  }
</style>
