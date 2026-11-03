<script lang="ts">
  import materiaisJson from "../data/materiais.json";
  import { api } from "../api";
  import { PROCESSOS } from "../compartilhado";
  import type { DadosEquipe, Equipe, Materiais, StatusEquipe } from "../tipos";
  import { cascata, reduzirMovimento } from "../actions/animar";
  import { mostrarAviso } from "../avisos.svelte";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  const materiais = materiaisJson as Materiais;

  // Valores do formulário em texto. Vazio vira nulo ao salvar.
  interface Rascunho {
    prefixo: string;
    nome: string;
    responsavel: string;
    supervisor: string;
    coordenador: string;
    gerencia: string;
    base: string;
    processo: string;
    status: StatusEquipe;
    tipoId: string;
  }

  function rascunhoVazio(): Rascunho {
    return {
      prefixo: "",
      nome: "",
      responsavel: "",
      supervisor: "",
      coordenador: "",
      gerencia: "",
      base: "",
      processo: "",
      status: "ativo",
      tipoId: "",
    };
  }

  let equipes = $state<Equipe[]>([]);
  let carregando = $state(false);
  let salvando = $state(false);

  let formAberto = $state(false);
  let modoEdicao = $state(false);
  let rascunho = $state<Rascunho>(rascunhoVazio());
  let formulario: HTMLElement | undefined = $state();

  let busca = $state("");
  let filtroProcesso = $state("");
  let filtroBase = $state("");
  let filtroStatus = $state("");
  let filtroTipo = $state("");

  const bases = $derived(
    [...new Set(equipes.map((equipe) => equipe.base).filter((base): base is string => Boolean(base)))].sort(),
  );

  const filtradas = $derived(
    equipes.filter((equipe) => {
      const termo = busca.trim().toUpperCase();
      if (
        termo &&
        !equipe.prefixo.includes(termo) &&
        !(equipe.nome ?? "").toUpperCase().includes(termo) &&
        !(equipe.responsavel ?? "").toUpperCase().includes(termo)
      ) {
        return false;
      }
      if (filtroProcesso && equipe.processo !== filtroProcesso) return false;
      if (filtroBase && equipe.base !== filtroBase) return false;
      if (filtroStatus && equipe.status !== filtroStatus) return false;
      if (filtroTipo === "sem") return !equipe.tipoId;
      if (filtroTipo) return equipe.tipoId === filtroTipo;
      return true;
    }),
  );

  $effect(() => {
    if (ativo) carregar();
  });

  function nomeTipo(id: string | null): string {
    if (!id) return "Sem tipo";
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

  function abrirNovo() {
    rascunho = rascunhoVazio();
    modoEdicao = false;
    abrirFormulario();
  }

  function abrirEdicao(equipe: Equipe) {
    rascunho = {
      prefixo: equipe.prefixo,
      nome: equipe.nome ?? "",
      responsavel: equipe.responsavel ?? "",
      supervisor: equipe.supervisor ?? "",
      coordenador: equipe.coordenador ?? "",
      gerencia: equipe.gerencia ?? "",
      base: equipe.base ?? "",
      processo: equipe.processo ?? "",
      status: equipe.status,
      tipoId: equipe.tipoId ?? "",
    };
    modoEdicao = true;
    abrirFormulario();
  }

  function abrirFormulario() {
    formAberto = true;
    // Espera o formulário aparecer para levar a tela até ele.
    queueMicrotask(() => {
      formulario?.scrollIntoView({ behavior: reduzirMovimento() ? "auto" : "smooth", block: "start" });
    });
  }

  function fecharFormulario() {
    formAberto = false;
  }

  function dadosDoRascunho(): DadosEquipe {
    const texto = (valor: string) => valor.trim() || null;
    return {
      nome: texto(rascunho.nome),
      responsavel: texto(rascunho.responsavel),
      supervisor: texto(rascunho.supervisor),
      coordenador: texto(rascunho.coordenador),
      gerencia: texto(rascunho.gerencia),
      base: texto(rascunho.base),
      processo: texto(rascunho.processo),
      status: rascunho.status,
      tipoId: rascunho.tipoId || null,
    };
  }

  async function salvar() {
    salvando = true;
    const prefixo = rascunho.prefixo.trim().toUpperCase();
    try {
      if (modoEdicao) {
        await api.atualizarEquipe(prefixo, dadosDoRascunho());
        mostrarAviso("ok", `Equipe ${prefixo} atualizada.`);
      } else {
        await api.criarEquipe({ prefixo, ...dadosDoRascunho() });
        mostrarAviso("ok", `Equipe ${prefixo} cadastrada.`);
      }
      formAberto = false;
      await carregar();
    } catch (falha) {
      mostrarErro(falha);
    } finally {
      salvando = false;
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
    <div class="cabecalho-acoes">
      <span class="chip chip-epi">{equipes.length} equipe(s)</span>
      <button class="botao" type="button" onclick={abrirNovo}>Nova equipe</button>
    </div>
  </div>

  {#if formAberto}
    <form
      class="formulario-equipe"
      bind:this={formulario}
      onsubmit={(evento) => {
        evento.preventDefault();
        salvar();
      }}
    >
      <h3>{modoEdicao ? `Editar equipe ${rascunho.prefixo}` : "Nova equipe"}</h3>

      <div class="campos-equipe">
        <label class="rotulo">
          Prefixo
          <input
            bind:value={rascunho.prefixo}
            maxlength="20"
            placeholder="Ex.: MA-BCB-C001M"
            disabled={modoEdicao}
            required
          />
        </label>
        <label class="rotulo">
          Nome
          <input bind:value={rascunho.nome} maxlength="120" />
        </label>
        <label class="rotulo">
          Responsável
          <input bind:value={rascunho.responsavel} maxlength="120" />
        </label>
        <label class="rotulo">
          Supervisor
          <input bind:value={rascunho.supervisor} maxlength="120" />
        </label>
        <label class="rotulo">
          Coordenador
          <input bind:value={rascunho.coordenador} maxlength="120" />
        </label>
        <label class="rotulo">
          Gerência
          <input bind:value={rascunho.gerencia} maxlength="120" />
        </label>
        <label class="rotulo">
          Base
          <input bind:value={rascunho.base} maxlength="40" list="lista-bases" />
          <datalist id="lista-bases">
            {#each bases as base (base)}
              <option value={base}></option>
            {/each}
          </datalist>
        </label>
        <label class="rotulo">
          Processo
          <select bind:value={rascunho.processo}>
            <option value="">Sem processo</option>
            {#each PROCESSOS as processo (processo)}
              <option value={processo}>{processo}</option>
            {/each}
          </select>
        </label>
        <label class="rotulo">
          Tipo de equipe
          <select bind:value={rascunho.tipoId}>
            <option value="">Sem tipo</option>
            {#each materiais.tipos as tipo (tipo.id)}
              <option value={tipo.id}>{tipo.nome}</option>
            {/each}
          </select>
        </label>
        <label class="rotulo">
          Status
          <select bind:value={rascunho.status}>
            <option value="ativo">Ativa</option>
            <option value="inativo">Inativa</option>
          </select>
        </label>
      </div>

      <div class="acoes-formulario">
        <button class="botao-secundario" type="button" onclick={fecharFormulario}>Cancelar</button>
        <button class="botao" type="submit" disabled={salvando || rascunho.prefixo.trim().length === 0}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  {/if}

  <div class="filtros-equipe distancia">
    <label class="rotulo">
      Buscar
      <input type="search" bind:value={busca} placeholder="Prefixo, nome ou responsável" />
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
      Base
      <select bind:value={filtroBase}>
        <option value="">Todas</option>
        {#each bases as base (base)}
          <option value={base}>{base}</option>
        {/each}
      </select>
    </label>
    <label class="rotulo">
      Tipo
      <select bind:value={filtroTipo}>
        <option value="">Todos</option>
        <option value="sem">Sem tipo</option>
        {#each materiais.tipos as tipo (tipo.id)}
          <option value={tipo.id}>{tipo.nome}</option>
        {/each}
      </select>
    </label>
    <label class="rotulo">
      Status
      <select bind:value={filtroStatus}>
        <option value="">Todos</option>
        <option value="ativo">Ativas</option>
        <option value="inativo">Inativas</option>
      </select>
    </label>
  </div>

  <div class="tabela-wrap distancia">
    <table class="tabela">
      <thead>
        <tr>
          <th>Prefixo</th>
          <th>Nome</th>
          <th>Responsável</th>
          <th>Supervisor</th>
          <th>Coordenador</th>
          <th>Gerência</th>
          <th>Base</th>
          <th>Processo</th>
          <th>Tipo de equipe</th>
          <th>Status</th>
          <th class="numerico">Ações</th>
        </tr>
      </thead>
      <tbody use:cascata={`${busca}|${filtroProcesso}|${filtroBase}|${filtroTipo}|${filtroStatus}|${equipes.length}`}>
        {#each filtradas as equipe (equipe.prefixo)}
          <tr>
            <td><strong>{equipe.prefixo}</strong></td>
            <td>{equipe.nome ?? "—"}</td>
            <td>{equipe.responsavel ?? "—"}</td>
            <td>{equipe.supervisor ?? "—"}</td>
            <td>{equipe.coordenador ?? "—"}</td>
            <td>{equipe.gerencia ?? "—"}</td>
            <td>{equipe.base ?? "—"}</td>
            <td>{equipe.processo ?? "—"}</td>
            <td class:texto-suave={!equipe.tipoId}>{nomeTipo(equipe.tipoId)}</td>
            <td class:texto-suave={equipe.status === "inativo"}>{equipe.status === "ativo" ? "Ativa" : "Inativa"}</td>
            <td class="numerico">
              <div class="acoes-linha">
                <button type="button" class="botao-secundario" onclick={() => abrirEdicao(equipe)}>Editar</button>
                <button type="button" class="botao-perigo" onclick={() => remover(equipe.prefixo)}>Remover</button>
              </div>
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="11" class="texto-suave">
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
  .cabecalho-acoes {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  .formulario-equipe {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda);
    border-radius: var(--raio-etiqueta);
  }

  .formulario-equipe h3 {
    margin: 0;
  }

  .campos-equipe,
  .filtros-equipe {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 14px;
  }

  .acoes-formulario {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 10px;
  }

  .acoes-linha {
    display: flex;
    flex-wrap: nowrap;
    justify-content: flex-end;
    gap: 8px;
    white-space: nowrap;
  }
</style>
