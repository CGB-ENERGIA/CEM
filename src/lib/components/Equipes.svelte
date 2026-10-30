<script lang="ts">
  import materiaisJson from "../data/materiais.json";
  import { api } from "../api";
  import type { Equipe, Materiais } from "../tipos";
  import { cascata } from "../actions/animar";
  import { mostrarAviso } from "../avisos.svelte";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  const materiais = materiaisJson as Materiais;

  let equipes = $state<Equipe[]>([]);
  let novoPrefixo = $state("");
  let novoTipo = $state(materiais.tipos[0].id);
  let filtro = $state("");
  let carregando = $state(false);

  const filtradas = $derived(
    equipes.filter((equipe) => equipe.prefixo.includes(filtro.trim().toUpperCase())),
  );

  $effect(() => {
    if (ativo) carregar();
  });

  function nomeTipo(id: string): string {
    return materiais.tipos.find((tipo) => tipo.id === id)?.nome ?? id;
  }

  function mostrarErro(falha: unknown) {
    mostrarAviso("erro", falha instanceof Error ? falha.message : "Erro inesperado.");
  }

  async function carregar() {
    carregando = true;
    try {
      equipes = await api.equipes();
    } catch (falha) {
      mostrarErro(falha);
    } finally {
      carregando = false;
    }
  }

  async function adicionar() {
    try {
      await api.criarEquipe({ prefixo: novoPrefixo.trim().toUpperCase(), tipoId: novoTipo });
      mostrarAviso("ok", `Equipe ${novoPrefixo.trim().toUpperCase()} cadastrada.`);
      novoPrefixo = "";
      await carregar();
    } catch (falha) {
      mostrarErro(falha);
    }
  }

  async function alterarTipo(prefixo: string, tipoId: string) {
    try {
      await api.atualizarEquipe(prefixo, tipoId);
      mostrarAviso("ok", `Tipo da equipe ${prefixo} atualizado.`);
      await carregar();
    } catch (falha) {
      mostrarErro(falha);
      await carregar();
    }
  }

  async function remover(prefixo: string) {
    if (!confirm(`Remover a equipe ${prefixo} do cadastro?`)) return;
    try {
      await api.removerEquipe(prefixo);
      mostrarAviso("ok", `Equipe ${prefixo} removida.`);
      await carregar();
    } catch (falha) {
      mostrarErro(falha);
    }
  }
</script>

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Equipes cadastradas</h2>
      <p>
        Todas as equipes do cadastro aparecem no dashboard, inclusive as que ainda não foram inspecionadas.
      </p>
    </div>
    <span class="chip chip-epi">{equipes.length} equipe(s)</span>
  </div>

  <form
    class="linha-cadastro"
    onsubmit={(evento) => {
      evento.preventDefault();
      adicionar();
    }}
  >
    <label class="rotulo">
      Prefixo
      <input bind:value={novoPrefixo} maxlength="20" placeholder="Ex.: 1234" required />
    </label>
    <label class="rotulo">
      Tipo de equipe
      <select bind:value={novoTipo}>
        {#each materiais.tipos as tipo (tipo.id)}
          <option value={tipo.id}>{tipo.nome}</option>
        {/each}
      </select>
    </label>
    <button class="botao" type="submit" disabled={novoPrefixo.trim().length === 0}>Cadastrar equipe</button>
  </form>

  <label class="rotulo distancia">
    Filtrar por prefixo
    <input type="search" bind:value={filtro} placeholder="Digite parte do prefixo" />
  </label>

  <div class="tabela-wrap distancia">
    <table class="tabela">
      <thead>
        <tr>
          <th>Prefixo</th>
          <th>Tipo de equipe</th>
          <th class="numerico">Ações</th>
        </tr>
      </thead>
      <tbody use:cascata={`${filtro}|${equipes.length}`}>
        {#each filtradas as equipe (equipe.prefixo)}
          <tr>
            <td><strong>{equipe.prefixo}</strong></td>
            <td>
              <select
                aria-label={`Tipo da equipe ${equipe.prefixo}`}
                value={equipe.tipoId}
                onchange={(evento) => alterarTipo(equipe.prefixo, evento.currentTarget.value)}
              >
                {#each materiais.tipos as tipo (tipo.id)}
                  <option value={tipo.id}>{tipo.nome}</option>
                {/each}
              </select>
            </td>
            <td class="numerico">
              <button type="button" class="botao-perigo" onclick={() => remover(equipe.prefixo)}>Remover</button>
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="3" class="texto-suave">
              {#if carregando}
                <span class="esqueleto" style="width: 40%"></span>
              {:else}
                {equipes.length === 0 ? "Nenhuma equipe cadastrada ainda." : "Nenhuma equipe encontrada."}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .linha-cadastro {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: flex-end;
    padding: 16px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda);
    border-radius: var(--raio-etiqueta);
  }

  .linha-cadastro .rotulo {
    flex: 1 1 200px;
  }

  .linha-cadastro .botao {
    flex: 0 0 auto;
  }

  .tabela select {
    min-width: 200px;
  }
</style>
