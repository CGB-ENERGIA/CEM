<script lang="ts">
  import { onMount } from "svelte";
  import materiaisJson from "../lib/data/materiais.json";
  import { dataHoje, formatarData } from "../lib/format";
  import { PROCESSOS } from "../lib/compartilhado";
  import { mostrarAviso } from "../lib/avisos.svelte";
  import { fila, type BlitzPendente } from "../lib/fila";
  import type { Item, Materiais, NovaBlitz, NovoItemBlitz, SituacaoEpi } from "../lib/tipos";
  import BuscaEquipe from "../lib/components/BuscaEquipe.svelte";
  import BuscaColaborador from "../lib/components/BuscaColaborador.svelte";
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
    { valor: "nao_ok", rotulo: "Troca" },
    { valor: "faltante", rotulo: "Faltante" },
  ];

  let equipes = $state<EquipeCampo[]>([]);
  let online = $state(navigator.onLine);

  let data = $state(dataHoje());
  let prefixo = $state("");
  let tipoEscolhido = $state("");
  let processoEscolhido = $state("");
  let colaboradores = $state<string[]>([""]);
  // Nomes aprovados, para sugestão. Vazio enquanto não carrega ou se o servidor não responder.
  let sugestoes = $state<string[]>([]);
  let solicitando = $state(false);
  // EPC é por equipe. EPI é por colaborador: cada pessoa tem a própria situação de cada EPI.
  let escolhas = $state<Record<number, Escolha>>({});
  let escolhasEpi = $state<Record<string, Record<number, Situacao>>>({});
  let pessoaAtual = $state("");

  let pendentes = $state<BlitzPendente[]>([]);
  let enviando = $state(false);
  let enviandoFila = $state(false);

  const prefixoNormalizado = $derived(prefixo.trim().toUpperCase());
  const equipeCadastrada = $derived(equipes.find((equipe) => equipe.prefixo === prefixoNormalizado));
  // Equipe cadastrada com tipo usa o tipo do cadastro. Equipe nova, ou sem tipo, usa o tipo escolhido na tela.
  const tipoId = $derived(equipeCadastrada?.tipoId ?? (tipoEscolhido || null));
  // Processo do cadastro quando existe; equipe nova precisa escolher um.
  const processoDaBlitz = $derived(equipeCadastrada?.processo ?? (processoEscolhido || null));
  const itens = $derived(
    tipoId ? materiais.itens.filter((item) => (item.quantidades[tipoId] ?? 0) > 0) : [],
  );
  const colaboradoresValidos = $derived(colaboradores.map((nome) => nome.trim()).filter(Boolean));
  const itensEpi = $derived(itens.filter((item) => item.grupo === "EPI"));
  const itensEpc = $derived(itens.filter((item) => item.grupo === "EPC"));

  // Pessoa mostrada nas abas de EPI: a escolhida, ou a primeira da equipe.
  const pessoaMostrada = $derived(
    colaboradoresValidos.includes(pessoaAtual) ? pessoaAtual : (colaboradoresValidos[0] ?? ""),
  );

  function respondidosEpiDe(nome: string): number {
    return itensEpi.filter((item) => escolhasEpi[nome]?.[item.id]).length;
  }

  const respondidosEpi = $derived(colaboradoresValidos.reduce((soma, nome) => soma + respondidosEpiDe(nome), 0));
  const totalEpi = $derived(colaboradoresValidos.length * itensEpi.length);
  const respondidosEpc = $derived(itensEpc.filter((item) => escolhas[item.id]).length);
  const faltam = $derived(itensEpc.length - respondidosEpc + (totalEpi - respondidosEpi));

  // EPI e EPC são mostrados um de cada vez, para a pessoa escolher por onde começar.
  let grupoAtual = $state<"EPI" | "EPC">("EPI");
  const GRUPOS = ["EPI", "EPC"] as const;

  const itensDoGrupo = $derived(grupoAtual === "EPI" ? itensEpi : itensEpc);
  const restantesDoGrupo = $derived(
    grupoAtual === "EPI"
      ? itensEpi.filter((item) => !escolhasEpi[pessoaMostrada]?.[item.id]).length
      : itensEpc.filter((item) => !escolhas[item.id]).length,
  );

  function itensDoTipo(grupo: "EPI" | "EPC"): number {
    return grupo === "EPI" ? itensEpi.length : itensEpc.length;
  }

  function totalDoGrupo(grupo: "EPI" | "EPC"): number {
    return grupo === "EPI" ? totalEpi : itensEpc.length;
  }

  function respondidosDoGrupo(grupo: "EPI" | "EPC"): number {
    return grupo === "EPI" ? respondidosEpi : respondidosEpc;
  }

  // Situação mostrada para um item: a da pessoa atual (EPI) ou a da equipe (EPC).
  function escolhaDo(item: Item): Escolha | undefined {
    if (item.grupo === "EPI") {
      const situacao = escolhasEpi[pessoaMostrada]?.[item.id];
      return situacao ? { situacao, quantidade: 1, observacao: "" } : undefined;
    }
    return escolhas[item.id];
  }

  const podeEnviar = $derived(
    prefixoNormalizado.length > 0 &&
      prefixoNormalizado.length <= 20 &&
      Boolean(tipoId) &&
      Boolean(processoDaBlitz) &&
      colaboradoresValidos.length > 0 &&
      itens.length > 0 &&
      faltam === 0,
  );

  // O que ainda impede o envio, em termos curtos. Fica sempre visível na barra de envio.
  const faltando = $derived.by(() => {
    const lista: string[] = [];
    if (prefixoNormalizado.length === 0) lista.push("prefixo");
    if (prefixoNormalizado && !tipoId) lista.push("tipo");
    if (prefixoNormalizado && !processoDaBlitz) lista.push("processo");
    if (colaboradoresValidos.length === 0) lista.push("colaborador");
    if (tipoId && faltam > 0) lista.push(`${faltam} ${faltam === 1 ? "item" : "itens"}`);
    return lista;
  });
  const resumoFalta = $derived(
    faltando.length === 0 ? "Pronto para registrar" : `Falta: ${faltando.join(", ")}`,
  );
  // Respostas de antes de "Marcar restantes como OK", para desfazer até a próxima ação.
  let antesDaMarcacao = $state<{
    escolhas: Record<number, Escolha>;
    escolhasEpi: Record<string, Record<number, Situacao>>;
  } | null>(null);

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

  // Situação de EPI no formato do servidor: Não OK vira Troca.
  function situacaoEpi(situacao: Situacao): SituacaoEpi {
    return situacao === "nao_ok" ? "troca" : situacao;
  }

  // Caixa para escolher quem está com o EPI faltando ou com troca. Quem não for marcado fica OK.
  let caixaEpi = $state<{ item: Item; situacao: "nao_ok" | "faltante"; selecionadas: string[] } | null>(null);

  function abrirCaixaEpi(item: Item, situacao: "nao_ok" | "faltante") {
    const selecionadas = colaboradoresValidos.filter((nome) => escolhasEpi[nome]?.[item.id] === situacao);
    caixaEpi = { item, situacao, selecionadas };
  }

  function alternarPessoaCaixa(nome: string) {
    if (!caixaEpi) return;
    const selecionadas = caixaEpi.selecionadas.includes(nome)
      ? caixaEpi.selecionadas.filter((n) => n !== nome)
      : [...caixaEpi.selecionadas, nome];
    caixaEpi = { ...caixaEpi, selecionadas };
  }

  function confirmarCaixaEpi() {
    if (!caixaEpi) return;
    const { item, situacao, selecionadas } = caixaEpi;
    const novas = { ...escolhasEpi };
    for (const nome of colaboradoresValidos) {
      novas[nome] = { ...novas[nome], [item.id]: selecionadas.includes(nome) ? situacao : "ok" };
    }
    escolhasEpi = novas;
    antesDaMarcacao = null;
    caixaEpi = null;
  }

  function escolher(item: Item, situacao: Situacao) {
    antesDaMarcacao = null;
    if (item.grupo === "EPI") {
      if (situacao !== "ok") {
        if (colaboradoresValidos.length === 0) return;
        abrirCaixaEpi(item, situacao);
        return;
      }
      const nome = pessoaMostrada;
      if (!nome) return;
      escolhasEpi = { ...escolhasEpi, [nome]: { ...escolhasEpi[nome], [item.id]: situacao } };
      return;
    }
    const atual = escolhas[item.id];
    const exigida = exigidaDe(item);
    const quantidade = Math.min(Math.max(atual?.quantidade ?? 1, 1), exigida);
    escolhas[item.id] = {
      situacao,
      quantidade: situacao === "ok" ? 1 : quantidade,
      observacao: atual?.observacao ?? "",
    };
  }

  // Contagem das situações escolhidas, para a mensagem de sucesso: "12 OK, 2 Troca, 1 Faltante".
  function resumoDasEscolhas(): string {
    const contagem = { ok: 0, nao_ok: 0, faltante: 0 };
    for (const item of itensEpc) {
      const escolha = escolhas[item.id];
      if (escolha) contagem[escolha.situacao]++;
    }
    for (const nome of colaboradoresValidos) {
      for (const item of itensEpi) {
        const situacao = escolhasEpi[nome]?.[item.id];
        if (situacao) contagem[situacao]++;
      }
    }
    return `${contagem.ok} OK, ${contagem.nao_ok} Troca, ${contagem.faltante} Faltante`;
  }

  function ajustar(item: Item, delta: number) {
    antesDaMarcacao = null;
    const atual = escolhas[item.id];
    if (!atual || atual.situacao === "ok") return;
    atual.quantidade = Math.min(Math.max(atual.quantidade + delta, 1), exigidaDe(item));
  }

  // Marca como OK só os itens ainda sem resposta, depois de confirmar a quantidade.
  // Os que já têm situação não são alterados. Um desfazer fica disponível até a próxima ação.
  function marcarRestantesOk() {
    const restantes = restantesDoGrupo;
    if (restantes === 0) return;
    const alvo = grupoAtual === "EPI" ? `de EPI de ${pessoaMostrada}` : "de EPC";
    if (!confirm(`Marcar ${restantes} ${restantes === 1 ? "item" : "itens"} ${alvo} como OK?`)) return;
    const anteriores = {
      escolhas: $state.snapshot(escolhas) as Record<number, Escolha>,
      escolhasEpi: $state.snapshot(escolhasEpi) as Record<string, Record<number, Situacao>>,
    };
    for (const item of itensDoGrupo) {
      if (!escolhaDo(item)) escolher(item, "ok");
    }
    antesDaMarcacao = anteriores;
  }

  function desfazerMarcacao() {
    if (!antesDaMarcacao) return;
    escolhas = antesDaMarcacao.escolhas;
    escolhasEpi = antesDaMarcacao.escolhasEpi;
    antesDaMarcacao = null;
  }

  function limparFormulario() {
    prefixo = "";
    tipoEscolhido = "";
    processoEscolhido = "";
    colaboradores = [""];
    escolhas = {};
    escolhasEpi = {};
    pessoaAtual = "";
    antesDaMarcacao = null;
  }

  async function carregarEquipes() {
    try {
      equipes = await apiCampo.equipes();
    } catch {
      // Sem sinal: a lista guardada pelo navegador continua valendo; o prefixo também pode ser digitado.
    }
  }

  async function carregarSugestoes() {
    try {
      sugestoes = await apiCampo.colaboradores();
    } catch {
      // Sem sugestões, o nome continua podendo ser digitado.
    }
  }

  // Envia o pedido de cadastro de um nome novo. Ele pode ser usado nesta blitz enquanto espera aprovação.
  async function solicitarCadastro(nome: string) {
    solicitando = true;
    try {
      const resultado = await apiCampo.solicitarColaborador(nome);
      if (resultado.status === "aprovado") {
        mostrarAviso("ok", `${resultado.nome} já está cadastrado.`);
        if (!sugestoes.includes(resultado.nome)) sugestoes = [...sugestoes, resultado.nome];
      } else {
        mostrarAviso(
          "info",
          `Pedido enviado para ${resultado.nome}. Você pode usar o nome nesta blitz; ele vira sugestão depois da aprovação.`,
        );
      }
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível enviar o pedido.");
    } finally {
      solicitando = false;
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
    // O botão só fica ativo com tudo preenchido; o que falta aparece ao lado, na barra.
    if (!podeEnviar || !tipoId) return;
    const blitz: NovaBlitz = {
      idCliente: crypto.randomUUID(),
      data,
      processo: processoDaBlitz,
      prefixo: prefixoNormalizado,
      tipoId,
      colaboradores: colaboradoresValidos,
      itens: itensEpc.map((item) => paraEnvio(item)).filter((item): item is NovoItemBlitz => item !== null),
      pessoas: colaboradoresValidos.flatMap((nome) =>
        itensEpi.map((item) => ({
          colaborador: nome,
          itemId: item.id,
          status: situacaoEpi(escolhasEpi[nome]?.[item.id] ?? "faltante"),
        })),
      ),
    };

    enviando = true;
    try {
      await apiCampo.registrarBlitz(blitz);
      mostrarAviso("ok", `Equipe ${blitz.prefixo} registrada: ${resumoDasEscolhas()}.`);
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
    // Volta ao topo: o formulário começa de novo e o encarregado vê a próxima equipe desde o início.
    window.scrollTo({ top: 0, behavior: "smooth" });
    await Promise.all([carregarEquipes(), carregarPendentes()]);
  }

  onMount(() => {
    carregarEquipes();
    carregarSugestoes();
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
              <span class="texto-suave">{nomeTipo(item.payload.tipoId)} · {formatarData(item.payload.data)}</span>
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
    novalidate
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

    <label class="rotulo">
      Data
      <input type="date" bind:value={data} required />
    </label>

    <div class="rotulo">
      <span>Prefixo da equipe</span>
      <BuscaEquipe id="prefixo-campo" bind:valor={prefixo} {equipes} {nomeTipo} />
    </div>

    <label class="rotulo">
      Tipo de equipe
      <select
        value={tipoId ?? ""}
        onchange={(evento) => (tipoEscolhido = evento.currentTarget.value)}
        disabled={Boolean(equipeCadastrada?.tipoId)}
        required
      >
        <option value="" disabled>Selecione o tipo</option>
        {#each materiais.tipos as tipo (tipo.id)}
          <option value={tipo.id}>{tipo.nome}</option>
        {/each}
      </select>
    </label>
    {#if equipeCadastrada?.tipoId}
      <p class="nota">Equipe cadastrada como <strong>{nomeTipo(tipoId)}</strong>. O tipo vem do cadastro.</p>
    {:else if prefixoNormalizado && tipoId}
      <p class="nota">Equipe nova: o tipo escolhido vai para o cadastro com esta blitz.</p>
    {/if}

    {#if prefixoNormalizado}
      <label class="rotulo">
        Processo
        <select
          value={processoDaBlitz ?? ""}
          onchange={(evento) => (processoEscolhido = evento.currentTarget.value)}
          disabled={Boolean(equipeCadastrada?.processo)}
          required
        >
          <option value="" disabled>Selecione o processo</option>
          {#each PROCESSOS as nome (nome)}
            <option value={nome}>{nome}</option>
          {/each}
        </select>
      </label>
    {/if}

    <div class="bloco-colaboradores">
      <span class="rotulo-texto">Colaboradores da equipe</span>
      {#each colaboradores as _nome, indice (indice)}
        <div class="linha-colaborador">
          <BuscaColaborador
            id={`colaborador-${indice}`}
            rotulo={`Colaborador ${indice + 1}`}
            {sugestoes}
            bind:valor={colaboradores[indice]}
          />
          {#if colaboradores[indice]?.trim().length >= 3 && !sugestoes.includes(colaboradores[indice].trim()) || colaboradores.length > 1}
            <div class="acoes-colaborador">
              {#if colaboradores[indice]?.trim().length >= 3 && !sugestoes.includes(colaboradores[indice].trim())}
                <button
                  type="button"
                  class="botao-secundario"
                  disabled={solicitando}
                  onclick={() => solicitarCadastro(colaboradores[indice].trim())}
                >
                  Solicitar cadastro
                </button>
              {/if}
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
      <div class="grupos" role="tablist" aria-label="Grupo de materiais">
        {#each GRUPOS as grupo (grupo)}
          {#if itensDoTipo(grupo) > 0}
            <button
              type="button"
              role="tab"
              class="grupo"
              class:ativo={grupoAtual === grupo}
              aria-selected={grupoAtual === grupo}
              onclick={() => (grupoAtual = grupo)}
            >
              {grupo}
              <span class="codigo">{respondidosDoGrupo(grupo)}/{totalDoGrupo(grupo)}</span>
            </button>
          {/if}
        {/each}
      </div>

      {#if grupoAtual === "EPI"}
        {#if colaboradoresValidos.length > 0}
          <div class="pessoas" role="tablist" aria-label="Colaboradores">
            {#each colaboradoresValidos as nome (nome)}
              <button
                type="button"
                role="tab"
                class="pessoa"
                class:ativo={pessoaMostrada === nome}
                aria-selected={pessoaMostrada === nome}
                onclick={() => (pessoaAtual = nome)}
              >
                <span class="pessoa-nome">{nome}</span>
                <span class="codigo">{respondidosEpiDe(nome)}/{itensEpi.length}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}

      <div class="progresso">
        <span class="texto-suave">
          {#if grupoAtual === "EPI"}
            EPI de {pessoaMostrada || "—"}:
          {:else}
            EPC:
          {/if}
          <span class="codigo">{grupoAtual === "EPI" ? respondidosEpiDe(pessoaMostrada) : respondidosEpc}/{itensDoGrupo.length}</span> respondidos
        </span>
        <button type="button" class="botao-secundario" onclick={marcarRestantesOk} disabled={restantesDoGrupo === 0}>
          Marcar restantes como OK
        </button>
      </div>

      <details class="legenda-situacoes">
        <summary>O que significa cada situação?</summary>
        <dl>
          <dt>OK</dt>
          <dd>a quantidade exigida está na equipe, sem defeito.</dd>
          <dt>Faltante</dt>
          <dd>a unidade não está na equipe.</dd>
          <dt>Troca</dt>
          <dd>a unidade está na equipe, mas danificada e precisa ser trocada.</dd>
        </dl>
      </details>

      {#if antesDaMarcacao}
        <p class="desfazer" role="status">
          Itens marcados como OK.
          <button type="button" class="botao-secundario" onclick={desfazerMarcacao}>Desfazer</button>
        </p>
      {/if}

      <ol class="checklist">
        {#if grupoAtual === "EPI" && colaboradoresValidos.length === 0}
          <li class="texto-suave">Informe os colaboradores da equipe para marcar os EPIs de cada um.</li>
        {/if}
        {#each itensDoGrupo as item (item.id)}
          {@const escolha = escolhaDo(item)}
          {@const exigida = exigidaDe(item)}
          <li class="etiqueta item">
            <div class="item-topo">
              <span class="numero codigo">{String(itens.indexOf(item) + 1).padStart(2, "0")}</span>
              <div class="item-texto">
                <span class="item-descricao">{item.descricao}</span>
                <span class="item-meta">
                  <span class="chip" class:chip-epi={item.grupo === "EPI"} class:chip-epc={item.grupo === "EPC"}>{item.grupo}</span>
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

            {#if escolha && escolha.situacao !== "ok" && exigida > 1 && item.grupo === "EPC"}
              <div class="quantidade-situacao">
                <span class="rotulo-texto">
                  {escolha.situacao === "faltante" ? "Quantos faltam" : "Quantas com troca"}
                </span>
                <div class="stepper" role="group" aria-label="Quantidade">
                  <button type="button" onclick={() => ajustar(item, -1)} disabled={escolha.quantidade <= 1} aria-label="Diminuir quantidade">−</button>
                  <span class="quantidade-valor codigo" aria-live="polite">{escolha.quantidade}</span>
                  <button type="button" onclick={() => ajustar(item, 1)} disabled={escolha.quantidade >= exigida} aria-label="Aumentar quantidade">+</button>
                </div>
              </div>
            {/if}

            {#if escolha && escolha.situacao !== "ok" && item.grupo === "EPC"}
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

    <div class="barra-envio" aria-live="polite">
      <span class="falta" class:pronto={faltando.length === 0}>{resumoFalta}</span>
      <button class="botao" type="submit" disabled={!podeEnviar || enviando}>
        {enviando ? "Registrando..." : online ? "Registrar blitz" : "Guardar no celular"}
      </button>
    </div>
  </form>
</main>

{#if caixaEpi}
  <div class="caixa-fundo" role="presentation" onclick={() => (caixaEpi = null)}></div>
  <div
    class="caixa-epi"
    role="dialog"
    aria-modal="true"
    aria-labelledby="caixa-epi-titulo"
    tabindex="-1"
    onkeydown={(evento) => {
      if (evento.key === "Escape") caixaEpi = null;
    }}
  >
    <h3 id="caixa-epi-titulo">
      Quem está com {caixaEpi.situacao === "faltante" ? "falta" : "troca"} de {caixaEpi.item.descricao}?
    </h3>
    <p class="texto-suave">Quem não for marcado fica OK.</p>
    <ul class="caixa-lista">
      {#each colaboradoresValidos as nome (nome)}
        <li>
          <label class="caixa-opcao">
            <input
              type="checkbox"
              checked={caixaEpi.selecionadas.includes(nome)}
              onchange={() => alternarPessoaCaixa(nome)}
            />
            <span>{nome}</span>
          </label>
        </li>
      {/each}
    </ul>
    <div class="caixa-acoes">
      <button type="button" class="botao-secundario" onclick={() => (caixaEpi = null)}>Cancelar</button>
      <button type="button" class="botao" onclick={confirmarCaixaEpi}>Confirmar</button>
    </div>
  </div>
{/if}

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

  /* Nome ocupa a largura toda; as ações ficam numa linha abaixo, sem apertar o campo no celular */
  .linha-colaborador {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .linha-colaborador :global(.busca-colaborador) {
    flex: 1 1 100%;
    min-width: 0;
  }

  .acoes-colaborador {
    display: flex;
    flex: 1 1 100%;
    gap: 8px;
  }

  .acoes-colaborador > button {
    min-height: 44px;
  }

  .acoes-colaborador > button:first-child:not(:last-child) {
    flex: 1 1 0;
  }

  .acoes-colaborador > button:last-child {
    margin-left: auto;
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

  .falta {
    min-width: 0;
    font-size: 0.92rem;
    color: var(--envio-suave);
  }

  .falta.pronto {
    color: var(--envio-texto);
    font-family: var(--fonte-titulo);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .desfazer {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin: 0;
    padding: 10px 14px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda);
    border-radius: var(--raio-etiqueta);
    color: var(--tinta-suave);
  }

  @media (min-width: 641px) {
    .campo {
      padding-top: 24px;
    }
  }
</style>
