<script lang="ts">
  import materiaisJson from "../data/materiais.json";
  import { api } from "../api";
  import type { BlitzResumo, Materiais } from "../tipos";
  import { formatarData, formatarMes, mesHoje, normalizarTexto, numero } from "../format";
  import { cascata } from "../actions/animar";
  import { mostrarAviso } from "../avisos.svelte";
  import SeletorMes from "./SeletorMes.svelte";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  const materiais = materiaisJson as Materiais;

  type FiltroSituacao = "todas" | "pendencias" | "ok";

  let mes = $state(mesHoje());
  let historico = $state<BlitzResumo[]>([]);
  let carregando = $state(false);
  let carregou = $state(false);
  let erro = $state<string | null>(null);

  let busca = $state("");
  let situacao = $state<FiltroSituacao>("todas");

  const termo = $derived(normalizarTexto(busca).trim());

  const visiveis = $derived(
    historico.filter((blitz) => {
      if (situacao === "pendencias" && blitz.conforme) return false;
      if (situacao === "ok" && !blitz.conforme) return false;
      if (!termo) return true;
      const texto = [
        blitz.prefixo,
        blitz.colaboradores.join(" "),
        ...blitz.itensNaoConformes.map((item) => item.descricao),
      ].join(" ");
      return normalizarTexto(texto).includes(termo);
    }),
  );

  const comPendencias = $derived(historico.filter((blitz) => !blitz.conforme).length);

  $effect(() => {
    const mesSelecionado = mes;
    if (ativo) carregar(mesSelecionado);
  });

  async function carregar(mesSelecionado: string) {
    carregando = true;
    try {
      const lista = await api.blitzes(mesSelecionado);
      if (mesSelecionado !== mes) return;
      historico = lista;
      erro = null;
      carregou = true;
    } catch (falha) {
      erro = falha instanceof Error ? falha.message : "Não foi possível carregar as blitzes.";
    } finally {
      carregando = false;
    }
  }

  async function excluir(id: number) {
    if (!confirm("Excluir esta blitz? Essa ação não pode ser desfeita.")) return;
    try {
      await api.removerBlitz(id);
      mostrarAviso("ok", "Blitz excluída.");
      await carregar(mes);
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível excluir a blitz.");
    }
  }

  function nomeTipo(id: string): string {
    return materiais.tipos.find((tipo) => tipo.id === id)?.nome ?? id;
  }
</script>

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Blitzes</h2>
      <p>
        Blitzes de {formatarMes(mes)}, da mais recente para a mais antiga. O registro é feito no app de campo.
      </p>
    </div>
    <div class="cabecalho-acoes">
      <SeletorMes bind:mes />
      <a class="botao-secundario link-campo" href="/campo/" target="_blank" rel="noopener">Abrir app de campo</a>
    </div>
  </div>

  {#if erro}
    <p class="mensagem mensagem-erro" role="alert">{erro}</p>
  {/if}

  {#if carregou && historico.length > 0}
    <div class="filtros-blitzes">
      <label class="rotulo">
        Buscar
        <input type="search" bind:value={busca} placeholder="Equipe, colaborador ou material" />
      </label>
      <label class="rotulo">
        Mostrar
        <select bind:value={situacao}>
          <option value="todas">Todas</option>
          <option value="pendencias">Com Troca ou Faltante</option>
          <option value="ok">Só as com tudo OK</option>
        </select>
      </label>
      <p class="resumo texto-suave" aria-live="polite">
        <strong class="codigo">{numero.format(visiveis.length)}</strong> de {numero.format(historico.length)} blitzes
        · <strong class="codigo">{numero.format(comPendencias)}</strong> com Troca ou Faltante
      </p>
    </div>
  {/if}

  {#if carregando && !carregou}
    <div class="lista-blitz distancia" aria-busy="true" aria-label="Carregando blitzes">
      {#each [0, 1, 2] as linha (linha)}
        <div class="cartao-blitz esqueleto-cartao">
          <span class="esqueleto" style="width: 32%"></span>
          <span class="esqueleto" style="width: 58%"></span>
        </div>
      {/each}
    </div>
  {:else if carregou && historico.length === 0}
    <p class="texto-suave distancia">
      Nenhuma blitz registrada em {formatarMes(mes)}. As blitzes feitas no app de campo aparecem aqui.
    </p>
  {:else if carregou && visiveis.length === 0}
    <p class="texto-suave distancia">Nenhuma blitz encontrada com esses filtros.</p>
  {:else if visiveis.length > 0}
    <div class="lista-blitz distancia" use:cascata={`${mes}|${situacao}|${busca}|${visiveis.length}`}>
      {#each visiveis as blitz (blitz.id)}
        <details class="cartao-blitz">
          <summary>
            <span class="codigo data">{formatarData(blitz.data)}</span>
            <strong class="codigo">{blitz.prefixo}</strong>
            <span class="texto-suave">{nomeTipo(blitz.tipoId)}</span>
            {#if blitz.processo}
              <span class="chip">{blitz.processo}</span>
            {/if}
            {#if blitz.conforme}
              <span class="chip chip-ok">Todos OK</span>
            {:else}
              <span class="chip chip-atencao">{blitz.naoConformes} Troca ou Faltante</span>
            {/if}
          </summary>

          <div class="detalhe">
            <p><strong>Colaboradores:</strong> {blitz.colaboradores.join(", ")}</p>

            {#if blitz.itensNaoConformes.length > 0}
              <div class="tabela-wrap distancia">
                <table class="tabela tabela-responsiva">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Quem</th>
                      <th class="numerico">Exigidos</th>
                      <th class="numerico">Encontrados</th>
                      <th class="numerico">Faltam</th>
                      <th class="numerico">Troca</th>
                      <th>Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each blitz.itensNaoConformes as item (item.itemId)}
                      <tr>
                        <td class="titulo-cartao">{item.descricao}</td>
                        <td data-rotulo="Quem">
                          {#if item.pessoas && item.pessoas.length > 0}
                            <ul class="quem">
                              {#each item.pessoas as pessoa (pessoa.colaborador)}
                                <li>
                                  <span>{pessoa.colaborador}</span>
                                  <span class="chip" class:chip-atencao={pessoa.status === "troca"} class:chip-falta={pessoa.status === "faltante"}>
                                    {pessoa.status === "troca" ? "Troca" : "Faltante"}
                                  </span>
                                </li>
                              {/each}
                            </ul>
                          {:else}
                            <span class="texto-suave">Equipe</span>
                          {/if}
                        </td>
                        <td data-rotulo="Exigidos" class="numerico codigo">{item.exigida}</td>
                        <td data-rotulo="Encontrados" class="numerico codigo">{item.encontrada}</td>
                        <td data-rotulo="Faltam" class="numerico codigo">{Math.max(0, item.exigida - item.encontrada)}</td>
                        <td data-rotulo="Troca" class="numerico codigo">{item.naoConforme}</td>
                        <td data-rotulo="Observação">{item.observacao ?? "—"}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <p class="texto-suave">Todos os itens estão OK.</p>
            {/if}

            <div class="distancia">
              <button type="button" class="botao-perigo" onclick={() => excluir(blitz.id)}>Excluir blitz</button>
            </div>
          </div>
        </details>
      {/each}
    </div>
  {/if}
</section>

<style>
  .cabecalho-acoes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }

  .link-campo {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    text-decoration: none;
  }

  .filtros-blitzes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    align-items: end;
    gap: 14px;
  }

  .resumo {
    margin: 0;
    padding-bottom: 10px;
    font-size: 0.92rem;
  }

  .esqueleto-cartao {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .lista-blitz {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cartao-blitz {
    background: var(--superficie-elevada);
    border: 1px solid var(--borda);
    border-radius: var(--raio-etiqueta);
    padding: 12px 16px;
  }

  .cartao-blitz summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    align-items: center;
    min-height: 32px;
    cursor: pointer;
    list-style-position: outside;
  }

  .cartao-blitz summary:focus-visible {
    outline: 2px solid var(--primaria);
    outline-offset: 2px;
  }

  .data {
    color: var(--tinta-suave);
  }

  .detalhe {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--borda);
  }

  /* Colaboradores com Troca ou Faltante num EPI */
  .quem {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .quem li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }
</style>
