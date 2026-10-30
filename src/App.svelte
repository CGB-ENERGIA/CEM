<script lang="ts">
  import { gsap } from "gsap";
  import { onMount } from "svelte";
  import Materiais from "./lib/components/Materiais.svelte";
  import Blitz from "./lib/components/Blitz.svelte";
  import Dashboard from "./lib/components/Dashboard.svelte";
  import Equipes from "./lib/components/Equipes.svelte";
  import Avisos from "./lib/components/Avisos.svelte";
  import Login from "./lib/components/Login.svelte";
  import { api, ErroSemConexao } from "./lib/api";
  import { fila } from "./lib/fila";
  import { instalacao, instalarApp, limparDadosGuardados } from "./lib/pwa.svelte";
  import { deslizarPainel, reduzirMovimento } from "./lib/actions/animar";
  import { definirUsuario, encerrarSessaoLocal, lerUsuarioGuardado, sessao } from "./lib/sessao.svelte";
  import { alternarTema, tema } from "./lib/tema.svelte";

  type Aba = "materiais" | "blitz" | "dashboard" | "equipes";

  const abas: { id: Aba; rotulo: string }[] = [
    { id: "dashboard", rotulo: "Dashboard" },
    { id: "blitz", rotulo: "Blitz Estática" },
    { id: "materiais", rotulo: "Materiais" },
    { id: "equipes", rotulo: "Equipes" },
  ];

  let aba = $state<Aba>("dashboard");
  let listaAbas: HTMLElement | undefined = $state();
  let indicador: HTMLElement | undefined = $state();
  let posicaoAnterior = 0;
  let primeiraPintura = true;

  onMount(() => {
    api
      .eu()
      .then(definirUsuario)
      .catch((falha) => {
        // Sem conexão, o app abre com o último usuário guardado; as blitz ficam na fila do celular.
        const guardado = falha instanceof ErroSemConexao ? lerUsuarioGuardado() : null;
        if (guardado) definirUsuario(guardado);
        else encerrarSessaoLocal();
      });
  });

  async function sair() {
    const pendentes = await fila.listar().catch(() => []);
    if (
      pendentes.length > 0 &&
      !confirm(
        `Há ${pendentes.length} blitz não enviada(s) neste celular. Elas continuam guardadas e serão enviadas no próximo login. Sair mesmo assim?`,
      )
    ) {
      return;
    }
    try {
      await api.sair();
    } finally {
      await limparDadosGuardados();
      encerrarSessaoLocal();
    }
  }

  // Os painéis ficam montados para preservar o formulário ao trocar de aba.
  // Cada troca desliza na direção da aba nova, e o indicador acompanha a aba ativa.
  $effect(() => {
    const posicao = abas.findIndex((item) => item.id === aba);
    const painel = document.querySelector<HTMLElement>(`[data-aba="${aba}"]`);
    if (painel && !primeiraPintura) {
      deslizarPainel(painel, posicao >= posicaoAnterior ? 1 : -1);
    }
    posicaoAnterior = posicao;
    primeiraPintura = false;
  });

  $effect(() => {
    void aba;
    const botao = listaAbas?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!botao || !indicador) return;
    const destino = { x: botao.offsetLeft, width: botao.offsetWidth };
    if (reduzirMovimento()) {
      gsap.set(indicador, destino);
      return;
    }
    gsap.to(indicador, { ...destino, duration: 0.6, ease: "expo.out" });
  });
</script>

{#snippet botaoTema()}
  <button
    type="button"
    class="alternar-tema"
    onclick={alternarTema}
    aria-label={tema.atual === "escuro" ? "Ativar tema claro" : "Ativar tema escuro"}
    title={tema.atual === "escuro" ? "Tema claro" : "Tema escuro"}
  >
    {#if tema.atual === "escuro"}
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8" />
        <path
          d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          fill="none"
        />
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
    {/if}
  </button>
{/snippet}

{#if sessao.estado === "carregando"}
  <div class="carregando" aria-busy="true" aria-label="Carregando"></div>
{:else if sessao.estado === "saiu"}
  <Login aoEntrar={definirUsuario} />
  {#if instalacao.disponivel}
    <button type="button" class="instalar instalar-login" onclick={instalarApp}>Instalar app</button>
  {/if}
{:else}
  <header class="topo">
    <div class="topo-interno">
      <div class="marca">
        <span class="marca-sigla">CEM</span>
        <span class="marca-nome">Consulta de Equipamentos e Materiais</span>
      </div>

      <div class="comandos">
        <div class="abas" role="tablist" aria-label="Seções" bind:this={listaAbas}>
          {#each abas as item (item.id)}
            <button
              type="button"
              role="tab"
              class="aba"
              class:ativa={aba === item.id}
              aria-selected={aba === item.id}
              onclick={() => (aba = item.id)}
            >
              {item.rotulo}
            </button>
          {/each}
          <span class="indicador" bind:this={indicador} aria-hidden="true"></span>
        </div>

        {#if instalacao.disponivel}
          <button type="button" class="instalar" onclick={instalarApp}>Instalar app</button>
        {/if}

        {@render botaoTema()}

        <div class="sessao">
          <span class="usuario" title={sessao.usuario?.login}>{sessao.usuario?.nome}</span>
          <button type="button" class="sair" onclick={sair}>Sair</button>
        </div>
      </div>
    </div>
  </header>

  <main class="conteudo">
    <div data-aba="dashboard" class:oculto={aba !== "dashboard"}>
      <Dashboard ativo={aba === "dashboard"} />
    </div>
    <div data-aba="blitz" class:oculto={aba !== "blitz"}>
      <Blitz ativo={aba === "blitz"} />
    </div>
    <div data-aba="materiais" class:oculto={aba !== "materiais"}>
      <Materiais />
    </div>
    <div data-aba="equipes" class:oculto={aba !== "equipes"}>
      <Equipes ativo={aba === "equipes"} />
    </div>
  </main>
{/if}

<Avisos />

<style>
  .carregando {
    min-height: 100dvh;
    background: var(--fundo);
  }

  .topo {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--topo-fundo);
    color: var(--topo-texto);
    box-shadow: 0 1px 0 var(--topo-borda);
    transition: background-color 180ms ease;
  }

  .topo-interno {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
    min-height: 60px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    align-items: center;
    justify-content: space-between;
  }

  .marca {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 12px 0;
  }

  .marca-sigla {
    font-family: var(--fonte-titulo);
    font-weight: 700;
    font-size: 1.5rem;
    letter-spacing: 0.04em;
    color: var(--topo-texto);
  }

  .marca-nome {
    font-size: 0.85rem;
    color: var(--topo-suave);
  }

  .comandos {
    display: flex;
    align-items: stretch;
    gap: 12px;
    align-self: stretch;
  }

  .abas {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-self: stretch;
  }

  /* Abas com formato de etiqueta de pasta: a ativa "assenta" sobre o painel */
  .aba {
    position: relative;
    background: transparent;
    border: 0;
    border-radius: 4px 4px 0 0;
    padding: 0 16px;
    min-height: 44px;
    color: var(--topo-suave);
    font-family: var(--fonte-titulo);
    font-weight: 600;
    font-size: 1.02rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    transition: color 180ms ease, background-color 180ms ease;
  }

  .aba:hover {
    color: var(--topo-texto);
    background: color-mix(in srgb, var(--topo-texto) 8%, transparent);
  }

  .aba.ativa {
    color: var(--tinta);
    background: var(--fundo);
  }

  .aba:focus-visible {
    outline-color: var(--atencao);
  }

  /* Indicador deslizante: uma faixa azul no topo da aba ativa, animada pelo GSAP */
  .indicador {
    position: absolute;
    top: 0;
    left: 0;
    height: 3px;
    width: 0;
    background: var(--primaria);
    border-radius: 0 0 3px 3px;
    pointer-events: none;
  }

  .alternar-tema {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    align-self: center;
    padding: 0;
    background: transparent;
    border: 1px solid var(--topo-borda);
    border-radius: var(--raio);
    color: var(--topo-texto);
    transition: background-color 160ms ease, transform 160ms ease;
  }

  .alternar-tema:hover {
    background: color-mix(in srgb, var(--topo-texto) 10%, transparent);
  }

  .alternar-tema:active {
    transform: scale(0.96);
  }

  .sessao {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-left: 12px;
    border-left: 1px solid var(--topo-borda);
  }

  .usuario {
    font-size: 0.9rem;
    color: var(--topo-suave);
    white-space: nowrap;
  }

  .sair {
    padding: 7px 12px;
    background: transparent;
    border: 1px solid var(--topo-borda);
    border-radius: var(--raio);
    color: var(--topo-texto);
    font-family: var(--fonte-titulo);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    transition: background-color 160ms ease;
  }

  .instalar {
    padding: 7px 12px;
    background: var(--atencao);
    border: 1px solid var(--atencao);
    border-radius: var(--raio);
    color: var(--atencao-tinta);
    font-family: var(--fonte-titulo);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .instalar-login {
    position: fixed;
    top: 14px;
    left: 14px;
    z-index: 20;
  }

  .sair:hover {
    background: color-mix(in srgb, var(--topo-texto) 10%, transparent);
  }

  .conteudo {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 20px 56px;
  }

  @media (max-width: 640px) {
    .topo-interno {
      padding: 0 12px;
    }

    .marca-nome {
      display: none;
    }

    .comandos {
      width: 100%;
      align-items: center;
    }

    .abas {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 2px;
    }

    .aba {
      padding: 6px 4px;
      min-height: 44px;
      font-size: 0.86rem;
      line-height: 1.1;
    }

    .usuario {
      display: none;
    }

    .conteudo {
      padding: 16px 12px 40px;
    }
  }
</style>
