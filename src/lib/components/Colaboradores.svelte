<script lang="ts">
  import { api } from "../api";
  import type { Colaborador } from "../tipos";
  import { mostrarAviso } from "../avisos.svelte";
  import { podeEditar } from "../sessao.svelte";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  let colaboradores = $state<Colaborador[]>([]);
  let carregando = $state(false);
  let importando = $state(false);
  let entradaArquivo: HTMLInputElement | undefined = $state();

  const pendentes = $derived(colaboradores.filter((colaborador) => colaborador.status === "pendente"));
  const aprovados = $derived(colaboradores.filter((colaborador) => colaborador.status === "aprovado").length);

  $effect(() => {
    if (ativo) carregar();
  });

  async function carregar() {
    carregando = true;
    try {
      colaboradores = await api.colaboradores();
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível carregar os colaboradores.");
    } finally {
      carregando = false;
    }
  }

  async function aprovar(colaborador: Colaborador) {
    try {
      await api.aprovarColaborador(colaborador.id);
      mostrarAviso("ok", `${colaborador.nome} aprovado. Agora aparece como sugestão no campo.`);
      await carregar();
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível aprovar.");
    }
  }

  async function recusar(colaborador: Colaborador) {
    if (!confirm(`Recusar o pedido de cadastro de ${colaborador.nome}? O nome será apagado.`)) return;
    try {
      await api.recusarColaborador(colaborador.id);
      mostrarAviso("ok", `Pedido de ${colaborador.nome} recusado.`);
      await carregar();
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível recusar.");
    }
  }

  // Importa uma base de nomes (coluna "Nome"). Os nomes entram já aprovados, porque a importação é feita por você.
  async function importarArquivo(evento: Event) {
    const campo = evento.currentTarget as HTMLInputElement;
    const arquivo = campo.files?.[0];
    campo.value = "";
    if (!arquivo) return;
    if (!confirm(`Importar os colaboradores de "${arquivo.name}"? Os nomes entram aprovados.`)) return;

    importando = true;
    try {
      const resultado = await api.importarColaboradores(arquivo);
      mostrarAviso(
        "ok",
        `Importação concluída: ${resultado.importados} colaborador(es)${resultado.ignorados > 0 ? `, ${resultado.ignorados} linha(s) ignorada(s)` : ""}.`,
      );
      await carregar();
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível importar.");
    } finally {
      importando = false;
    }
  }
</script>

<section class="painel distancia">
  <div class="cabecalho-painel">
    <div>
      <h2>Colaboradores</h2>
      <p>
        {aprovados} aprovado(s). Os nomes aprovados aparecem como sugestão no app de campo. Pedidos feitos no campo
        ficam aguardando sua aprovação.
      </p>
    </div>
    {#if podeEditar()}
      <div class="cabecalho-acoes">
        <input
          bind:this={entradaArquivo}
          type="file"
          accept=".xlsx"
          class="entrada-arquivo-oculta"
          onchange={importarArquivo}
        />
        <button class="botao-secundario" type="button" onclick={() => entradaArquivo?.click()} disabled={importando}>
          {importando ? "Importando..." : "Importar base"}
        </button>
      </div>
    {/if}
  </div>

  <h3>Aguardando aprovação ({pendentes.length})</h3>

  {#if carregando}
    <span class="esqueleto" style="width: 40%"></span>
  {:else if pendentes.length === 0}
    <p class="texto-suave">Nenhum pedido pendente.</p>
  {:else}
    <ul class="lista-pedidos">
      {#each pendentes as colaborador (colaborador.id)}
        <li class="etiqueta pedido">
          <span class="nome">{colaborador.nome}</span>
          {#if podeEditar()}
            <div class="acoes-pedido">
              <button class="botao" type="button" onclick={() => aprovar(colaborador)}>Aprovar</button>
              <button class="botao-perigo" type="button" onclick={() => recusar(colaborador)}>Recusar</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .cabecalho-acoes {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  .entrada-arquivo-oculta {
    display: none;
  }

  .lista-pedidos {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .pedido {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: center;
    justify-content: space-between;
  }

  .nome {
    font-weight: 500;
  }

  .acoes-pedido {
    display: flex;
    gap: 12px;
    align-items: center;
  }
</style>
