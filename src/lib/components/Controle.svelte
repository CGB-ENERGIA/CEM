<script lang="ts">
  import { api } from "../api";
  import { PROCESSOS } from "../compartilhado";
  import type { FiltroPendencias, Pendencia } from "../tipos";
  import { cascata } from "../actions/animar";
  import { mostrarAviso } from "../avisos.svelte";
  import { formatarData, normalizarTexto, numero } from "../format";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  let situacao = $state<FiltroPendencias>("abertas");
  let busca = $state("");
  let filtroProcesso = $state("");
  let filtroStatus = $state<"" | "troca" | "faltante">("");
  let filtroGrupo = $state<"" | "EPI" | "EPC">("");

  let pendencias = $state<Pendencia[]>([]);
  let abertas = $state(0);
  let resolvidas = $state(0);
  let carregando = $state(false);
  let carregou = $state(false);
  let erro = $state<string | null>(null);
  let exportando = $state(false);
  // Pendências com a ação em andamento, para travar o botão e evitar clique duplo.
  let ocupadas = $state<string[]>([]);

  async function carregar(filtro: FiltroPendencias) {
    carregando = true;
    erro = null;
    try {
      const lista = await api.pendencias(filtro);
      if (filtro !== situacao) return;
      pendencias = lista.pendencias;
      abertas = lista.abertas;
      resolvidas = lista.resolvidas;
      carregou = true;
    } catch (falha) {
      erro = falha instanceof Error ? falha.message : "Não foi possível carregar as pendências.";
    } finally {
      carregando = false;
    }
  }

  $effect(() => {
    const filtro = situacao;
    if (ativo) carregar(filtro);
  });

  const visiveis = $derived.by(() => {
    const termo = normalizarTexto(busca).trim();
    return pendencias.filter((p) => {
      if (filtroProcesso && p.processo !== filtroProcesso) return false;
      if (filtroStatus && p.status !== filtroStatus) return false;
      if (filtroGrupo && p.grupo !== filtroGrupo) return false;
      if (!termo) return true;
      return normalizarTexto(`${p.prefixo} ${p.descricao} ${p.colaborador ?? ""}`).includes(termo);
    });
  });

  const faltantesNaLista = $derived(visiveis.filter((p) => p.status === "faltante").length);
  const trocasNaLista = $derived(visiveis.length - faltantesNaLista);

  async function alterar(pendencia: Pendencia, resolvida: boolean) {
    if (ocupadas.includes(pendencia.chave)) return;
    ocupadas = [...ocupadas, pendencia.chave];
    try {
      await api.resolverPendencia(pendencia.chave, resolvida);
      mostrarAviso("ok", resolvida ? "Pendência marcada como resolvida." : "Pendência reaberta.");
      await carregar(situacao);
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível atualizar a pendência.");
    } finally {
      ocupadas = ocupadas.filter((chave) => chave !== pendencia.chave);
    }
  }

  async function exportar() {
    exportando = true;
    try {
      const arquivo = await api.exportarPendencias(situacao);
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

  const textoSituacao: Record<FiltroPendencias, string> = {
    abertas: "em aberto",
    resolvidas: "resolvidas",
    todas: "no total",
  };
</script>

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Controle de pendências</h2>
      <p>
        Cada Troca ou Faltante registrado numa blitz fica aqui até ser resolvido. Marque como resolvido quando o
        item for trocado ou entregue.
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

  {#if carregou}
    <div class="grade-kpi">
      <div class="kpi etiqueta">
        <span class="kpi-rotulo">Em aberto</span>
        <div class="kpi-valor">{numero.format(abertas)}</div>
        <span class="nota">Trocas e Faltantes sem solução</span>
      </div>
      <div class="kpi etiqueta">
        <span class="kpi-rotulo">Resolvidas</span>
        <div class="kpi-valor">{numero.format(resolvidas)}</div>
        <span class="nota">já trocadas ou entregues</span>
      </div>
      <div class="kpi etiqueta">
        <span class="kpi-rotulo">Na lista</span>
        <div class="kpi-valor">{numero.format(visiveis.length)}</div>
        <span class="nota">{numero.format(faltantesNaLista)} Faltante, {numero.format(trocasNaLista)} Troca</span>
      </div>
    </div>
  {/if}

  <div class="filtros-controle distancia">
    <label class="rotulo">
      Mostrar
      <select bind:value={situacao}>
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

  {#if carregando && !carregou}
    <p class="texto-suave distancia" aria-busy="true">Carregando pendências...</p>
  {:else if carregou && visiveis.length === 0}
    <p class="texto-suave distancia">
      {pendencias.length === 0
        ? `Nenhuma pendência ${textoSituacao[situacao]}.`
        : "Nenhuma pendência com esses filtros."}
    </p>
  {:else if visiveis.length > 0}
    <div class="tabela-wrap distancia">
      <table class="tabela tabela-responsiva">
        <thead>
          <tr>
            <th>Equipe</th>
            <th>Material</th>
            <th>Quem</th>
            <th>Situação</th>
            <th class="numerico">Qtd.</th>
            <th>Blitz</th>
            <th>Controle</th>
          </tr>
        </thead>
        <tbody use:cascata={`${situacao}|${visiveis.length}|${busca}`}>
          {#each visiveis as pendencia (pendencia.chave)}
            <tr>
              <td class="titulo-cartao">
                <strong class="codigo">{pendencia.prefixo}</strong>
                {#if pendencia.processo}
                  <span class="chip">{pendencia.processo}</span>
                {/if}
              </td>
              <td data-rotulo="Material">
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
                  <button
                    type="button"
                    class="botao-secundario"
                    disabled={ocupadas.includes(pendencia.chave)}
                    onclick={() => alterar(pendencia, false)}
                  >
                    Reabrir
                  </button>
                {:else}
                  <button
                    type="button"
                    class="botao"
                    disabled={ocupadas.includes(pendencia.chave)}
                    onclick={() => alterar(pendencia, true)}
                  >
                    Marcar como resolvido
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
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

  .filtros-controle {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 14px;
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

  @media (max-width: 640px) {
    .filtros-controle {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
