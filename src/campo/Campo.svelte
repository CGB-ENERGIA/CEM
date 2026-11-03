<script lang="ts">
  import { onMount } from "svelte";
  import materiaisJson from "../lib/data/materiais.json";
  import { PROCESSOS } from "../lib/compartilhado";
  import { dataHoje } from "../lib/format";
  import { mostrarAviso } from "../lib/avisos.svelte";
  import { fila, type BlitzPendente } from "../lib/fila";
  import type { Item, Materiais, NovaBlitz, NovoItemBlitz } from "../lib/tipos";
  import BuscaEquipe from "../lib/components/BuscaEquipe.svelte";
  import Avisos from "../lib/components/Avisos.svelte";
  import { apiCampo, envioAdiavel, type EquipeCampo } from "./api";

  type Situacao = "ok" | "nao_ok" | "faltante";
  interface Escolha {
    situacao: Situacao;
    quantidade: number;
    observacao: string;
  }

  const materiais = materiaisJson as Materiais;
  const LIMITE_COLABORADORES = 30;
  const opcoes: { valor: Situacao; rotulo: string }[] = [
    { valor: "ok", rotulo: "OK" },
    { valor: "nao_ok", rotulo: "Não OK" },
    { valor: "faltante", rotulo: "Faltante" },
  ];

  let equipes = $state<EquipeCampo[]>([]);
  let online = $state(navigator.onLine);

  let data = $state(dataHoje());
  let processo = $state("");
  let prefixo = $state("");
  let tipoEscolhido = $state("");
  let colaboradores = $state<string[]>([""]);
  let escolhas = $state<Record<number, Escolha>>({});

  let pendentes = $state<BlitzPendente[]>([]);
  let enviando = $state(false);
  let enviandoFila = $state(false);

  const prefixoNormalizado = $derived(prefixo.trim().toUpperCase());
  const equipeCadastrada = $derived(equipes.find((equipe) => equipe.prefixo === prefixoNormalizado));
  // Equipe cadastrada com tipo usa o tipo do cadastro. Equipe nova, ou sem tipo, usa o tipo escolhido na tela.
  const tipoId = $derived(equipeCadastrada?.tipoId ?? (tipoEscolhido || null));
  const itens = $derived(
    tipoId ? materiais.itens.filter((item) => (item.quantidades[tipoId] ?? 0) > 0) : [],
  );
  const colaboradoresValidos = $derived(colaboradores.map((nome) => nome.trim()).filter(Boolean));
  const respondidos = $derived(itens.filter((item) => escolhas[item.id]).length);
  const faltam = $derived(itens.length - respondidos);
  const podeEnviar = $derived(
    Boolean(processo) &&
      prefixoNormalizado.length > 0 &&
      prefixoNormalizado.length <= 20 &&
      Boolean(tipoId) &&
      colaboradoresValidos.length > 0 &&
      itens.length > 0 &&
      faltam === 0,
  );

  function nomeTipo(id: string | null): string {
    if (!id) return "Sem tipo";
    return materiais.tipos.find((tipo) => tipo.id === id)?.nome ?? id;
  }

  function exigidaDe(item: Item): number {
    return tipoId ? (item.quantidades[tipoId] ?? 0) : 0;
  }

  // Converte a escolha da tela nas duas contagens que o servidor usa para derivar o status do item.
  function paraEnvio(item: Item): NovoItemBlitz | null {
    const escolha = escolhas[item.id];
    if (!escolha) return null;
    const exigida = exigidaDe(item);
    const observacao = escolha.observacao.trim() || undefined;
    if (escolha.situacao === "ok") return { itemId: item.id, encontrada: exigida, naoConforme: 0 };
    if (escolha.situacao === "nao_ok") {
      return { itemId: item.id, encontrada: exigida, naoConforme: escolha.quantidade, observacao };
    }
    return { itemId: item.id, encontrada: exigida - escolha.quantidade, naoConforme: 0, observacao };
  }

  function escolher(item: Item, situacao: Situacao) {
    const atual = escolhas[item.id];
    const exigida = exigidaDe(item);
    const quantidade = Math.min(Math.max(atual?.quantidade ?? 1, 1), exigida);
    escolhas[item.id] = {
      situacao,
      quantidade: situacao === "ok" ? 1 : quantidade,
      observacao: atual?.observacao ?? "",
    };
  }

  function ajustar(item: Item, delta: number) {
    const atual = escolhas[item.id];
    if (!atual || atual.situacao === "ok") return;
    atual.quantidade = Math.min(Math.max(atual.quantidade + delta, 1), exigidaDe(item));
  }

  // Marca como OK só os itens ainda sem resposta. Os que já têm situação não são alterados.
  function marcarRestantesOk() {
    for (const item of itens) {
      if (!escolhas[item.id]) escolher(item, "ok");
    }
  }

  function limparFormulario() {
    prefixo = "";
    tipoEscolhido = "";
    colaboradores = [""];
    escolhas = {};
  }

  async function carregarEquipes() {
    try {
      equipes = await apiCampo.equipes();
    } catch {
      // Sem sinal: a lista guardada pelo navegador continua valendo; o prefixo também pode ser digitado.
    }
  }

  async function carregarPendentes() {
    try {
      pendentes = await fila.listar();
    } catch {
      pendentes = [];
    }
  }

  // Envia as blitz guardadas, na ordem em que foram feitas. Para ao primeiro sinal de que ainda não há conexão.
  async function enviarPendentes(manual: boolean) {
    if (enviandoFila) return;
    enviandoFila = true;
    let enviadas = 0;
    try {
      for (const item of await fila.listar()) {
        if (item.erro && !manual) continue;
        try {
          await apiCampo.registrarBlitz(item.payload);
          await fila.remover(item.id);
          enviadas++;
        } catch (falha) {
          if (envioAdiavel(falha)) break;
          await fila.guardar({
            ...item,
            erro: falha instanceof Error ? falha.message : "Não foi possível enviar esta blitz.",
          });
        }
      }
    } catch {
      // Armazenamento do celular indisponível: nada a enviar agora.
    } finally {
      enviandoFila = false;
    }
    if (enviadas > 0) mostrarAviso("ok", `${enviadas} blitz(es) enviada(s).`);
    await carregarPendentes();
  }

  async function descartar(id: string) {
    if (!confirm("Descartar esta blitz guardada? Ela não será enviada e não pode ser recuperada.")) return;
    await fila.remover(id);
    await carregarPendentes();
  }

  async function registrar() {
    if (!podeEnviar || !tipoId) return;
    const blitz: NovaBlitz = {
      idCliente: crypto.randomUUID(),
      data,
      processo,
      prefixo: prefixoNormalizado,
      tipoId,
      colaboradores: colaboradoresValidos,
      itens: itens.map((item) => paraEnvio(item)).filter((item): item is NovoItemBlitz => item !== null),
    };

    enviando = true;
    try {
      const { id } = await apiCampo.registrarBlitz(blitz);
      mostrarAviso("ok", `Blitz da equipe ${blitz.prefixo} registrada (nº ${id}).`);
    } catch (falha) {
      if (!envioAdiavel(falha)) {
        mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível registrar a blitz.");
        enviando = false;
        return;
      }
      // Sem sinal: guarda no celular com o mesmo identificador, para não duplicar no reenvio.
      try {
        await fila.guardar({ id: blitz.idCliente!, criadaEm: Date.now(), payload: blitz });
        mostrarAviso(
          "info",
          `Sem conexão: a blitz da equipe ${blitz.prefixo} foi guardada e será enviada quando houver sinal.`,
        );
      } catch {
        mostrarAviso("erro", "Sem conexão, e não foi possível guardar a blitz neste celular.");
        enviando = false;
        return;
      }
    }

    enviando = false;
    limparFormulario();
    await Promise.all([carregarEquipes(), carregarPendentes()]);
  }

  onMount(() => {
    carregarEquipes();
    carregarPendentes();
    enviarPendentes(false);
  });
</script>

<svelte:window
  bind:online
  ononline={() => enviarPendentes(false)}
/>

<header class="topo-campo">
  <div class="marca">
    <span class="marca-sigla">CEM</span>
    <span class="marca-nome">Blitz de campo</span>
  </div>
  {#if !online}
    <span class="chip chip-atencao">Sem conexão</span>
  {/if}
</header>

<main class="campo">
  {#if pendentes.length > 0}
    <section class="painel pendentes" aria-label="Blitz aguardando envio">
      <div class="cabecalho-painel">
        <div>
          <h2>Aguardando envio ({pendentes.length})</h2>
          <p>Guardadas neste celular. Serão enviadas quando houver conexão.</p>
        </div>
        <button
          type="button"
          class="botao-secundario"
          disabled={enviandoFila || !online}
          onclick={() => enviarPendentes(true)}
        >
          {enviandoFila ? "Enviando..." : "Enviar agora"}
        </button>
      </div>
      <ul class="lista-pendentes">
        {#each pendentes as item (item.id)}
          <li class="etiqueta pendente">
            <div class="pendente-topo">
              <strong class="codigo">{item.payload.prefixo}</strong>
              <span class="texto-suave">{item.payload.processo} · {item.payload.data}</span>
            </div>
            {#if item.erro}
              <p class="mensagem mensagem-erro">Não enviada: {item.erro}</p>
            {/if}
            <button type="button" class="botao-perigo" onclick={() => descartar(item.id)}>Descartar</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <form
    class="painel formulario"
    onsubmit={(evento) => {
      evento.preventDefault();
      registrar();
    }}
  >
    <div class="cabecalho-painel">
      <div>
        <h2>Nova blitz</h2>
        <p>Confira cada material exigido para a equipe e marque a situação de todos.</p>
      </div>
    </div>

    <div class="grade-campos">
      <label class="rotulo">
        Data
        <input type="date" bind:value={data} required />
      </label>
      <label class="rotulo">
        Processo
        <select bind:value={processo} required>
          <option value="" disabled>Selecione o processo</option>
          {#each PROCESSOS as nome (nome)}
            <option value={nome}>{nome}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="rotulo">
      <span>Prefixo da equipe</span>
      <BuscaEquipe id="prefixo-campo" bind:valor={prefixo} {equipes} {nomeTipo} />
    </div>

    {#if prefixoNormalizado && !equipeCadastrada?.tipoId}
      <label class="rotulo">
        Tipo de equipe
        <select bind:value={tipoEscolhido} required>
          <option value="" disabled>Selecione o tipo</option>
          {#each materiais.tipos as tipo (tipo.id)}
            <option value={tipo.id}>{tipo.nome}</option>
          {/each}
        </select>
      </label>
    {:else if tipoId}
      <p class="nota">Tipo: <strong>{nomeTipo(tipoId)}</strong></p>
    {/if}

    <div class="bloco-colaboradores">
      <span class="rotulo-texto">Colaboradores da equipe</span>
      {#each colaboradores as _nome, indice (indice)}
        <div class="linha-colaborador">
          <input
            bind:value={colaboradores[indice]}
            placeholder="Nome completo"
            aria-label={`Colaborador ${indice + 1}`}
            maxlength="120"
          />
          {#if colaboradores.length > 1}
            <button
              type="button"
              class="botao-perigo"
              onclick={() => (colaboradores = colaboradores.filter((_item, posicao) => posicao !== indice))}
            >
              Remover
            </button>
          {/if}
        </div>
      {/each}
      {#if colaboradores.length < LIMITE_COLABORADORES}
        <button type="button" class="botao-secundario" onclick={() => (colaboradores = [...colaboradores, ""])}>
          Adicionar colaborador
        </button>
      {/if}
    </div>

    {#if tipoId}
      <div class="progresso">
        <span class="codigo">{respondidos}/{itens.length}</span>
        <span class="texto-suave">respondidos</span>
        <button type="button" class="botao-secundario" onclick={marcarRestantesOk} disabled={faltam === 0}>
          Marcar restantes como OK
        </button>
      </div>

      <ol class="checklist">
        {#each itens as item, posicao (item.id)}
          {@const escolha = escolhas[item.id]}
          {@const exigida = exigidaDe(item)}
          <li class="etiqueta item">
            <div class="item-topo">
              <span class="numero codigo">{String(posicao + 1).padStart(2, "0")}</span>
              <div class="item-texto">
                <span class="item-descricao">{item.descricao}</span>
                <span class="item-meta">
                  <span class="chip">{item.grupo}</span>
                  <span>Exigidos: <strong class="codigo">{exigida}</strong></span>
                </span>
              </div>
            </div>

            <div class="segmentos" role="group" aria-label={`Situação de ${item.descricao}`}>
              {#each opcoes as opcao (opcao.valor)}
                <button
                  type="button"
                  class="segmento"
                  data-situacao={opcao.valor}
                  class:ativo={escolha?.situacao === opcao.valor}
                  aria-pressed={escolha?.situacao === opcao.valor}
                  onclick={() => escolher(item, opcao.valor)}
                >
                  {opcao.rotulo}
                </button>
              {/each}
            </div>

            {#if escolha && escolha.situacao !== "ok" && exigida > 1}
              <div class="quantidade-situacao">
                <span class="rotulo-texto">
                  {escolha.situacao === "faltante" ? "Quantos faltam" : "Quantos com defeito"}
                </span>
                <div class="stepper" role="group" aria-label="Quantidade">
                  <button type="button" onclick={() => ajustar(item, -1)} disabled={escolha.quantidade <= 1} aria-label="Diminuir quantidade">−</button>
                  <span class="quantidade-valor codigo" aria-live="polite">{escolha.quantidade}</span>
                  <button type="button" onclick={() => ajustar(item, 1)} disabled={escolha.quantidade >= exigida} aria-label="Aumentar quantidade">+</button>
                </div>
              </div>
            {/if}

            {#if escolha && escolha.situacao !== "ok"}
              <input
                class="observacao"
                bind:value={escolhas[item.id].observacao}
                placeholder="Observação (opcional)"
                aria-label={`Observação sobre ${item.descricao}`}
                maxlength="500"
              />
            {/if}
          </li>
        {:else}
          <li class="texto-suave">Nenhum material exigido para este tipo de equipe.</li>
        {/each}
      </ol>
    {:else}
      <p class="nota">Escolha a equipe, ou o tipo da equipe nova, para ver os materiais exigidos.</p>
    {/if}

    <div class="barra-envio">
      <span class="nota">
        {#if tipoId && faltam > 0}
          Faltam {faltam} item(ns) para registrar.
        {/if}
      </span>
      <button class="botao" type="submit" disabled={!podeEnviar || enviando}>
        {enviando ? "Registrando..." : online ? "Registrar blitz" : "Guardar no celular"}
      </button>
    </div>
  </form>
</main>

<Avisos />

<style>
  .topo-campo {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: var(--altura-topo);
    padding: 0 16px;
    background: var(--topo-fundo);
    color: var(--topo-texto);
  }

  .marca {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .marca-sigla {
    font-family: var(--fonte-titulo);
    font-weight: 700;
    font-size: 1.4rem;
    letter-spacing: 0.04em;
  }

  .marca-nome {
    font-size: 0.9rem;
    color: var(--topo-suave);
  }

  .campo {
    max-width: 640px;
    margin: 0 auto;
    padding: 16px 12px calc(120px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .formulario,
  .pendentes {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .grade-campos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 14px;
  }

  .bloco-colaboradores,
  .progresso,
  .quantidade-situacao {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .progresso {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .rotulo-texto {
    font-family: var(--fonte-titulo);
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--tinta-suave);
  }

  .linha-colaborador {
    display: flex;
    gap: 8px;
  }

  .linha-colaborador input {
    flex: 1;
  }

  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .item-topo {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .numero {
    color: var(--tinta-suave);
  }

  .item-texto {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .item-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    font-size: 0.88rem;
    color: var(--tinta-suave);
  }

  .segmentos {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .segmento {
    min-height: 52px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda-forte);
    border-radius: var(--raio-etiqueta);
    color: var(--tinta);
    font-family: var(--fonte-titulo);
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
  }

  .segmento[data-situacao="ok"].ativo {
    background: var(--ok-suave);
    border-color: var(--ok);
    color: var(--ok-texto);
  }

  .segmento[data-situacao="nao_ok"].ativo {
    background: var(--atencao-suave);
    border-color: var(--atencao);
    color: var(--tinta);
  }

  .segmento[data-situacao="faltante"].ativo {
    background: var(--falta-suave);
    border-color: var(--falta);
    color: var(--falta);
  }

  .stepper {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) 52px;
    align-items: stretch;
    max-width: 260px;
  }

  .stepper button {
    min-height: 44px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda-forte);
    color: var(--tinta);
    font-size: 1.2rem;
  }

  .stepper button:disabled {
    opacity: 0.35;
  }

  .quantidade-valor {
    display: grid;
    place-items: center;
    font-weight: 500;
    border-top: 1px solid var(--borda);
    border-bottom: 1px solid var(--borda);
  }

  .observacao {
    width: 100%;
  }

  .barra-envio {
    position: sticky;
    bottom: 0;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px calc(14px + env(safe-area-inset-bottom));
    margin: 0 -16px -16px;
    background: var(--envio-fundo);
    color: var(--envio-texto);
    border-top: 1px solid var(--borda);
  }

  .lista-pendentes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pendente {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .pendente-topo {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
  }

  @media (min-width: 641px) {
    .campo {
      padding-top: 24px;
    }
  }
</style>
