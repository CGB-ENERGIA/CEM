<script lang="ts">
  import materiaisJson from "../data/materiais.json";
  import { api, ErroApi, ErroSemConexao } from "../api";
  import { fila, type BlitzPendente } from "../fila";
  import { PROCESSOS } from "../compartilhado";
  import type { BlitzResumo, Equipe, Item, Materiais, NovaBlitz, NovoItemBlitz } from "../tipos";
  import { dataHoje, formatarData, formatarMes, mesHoje } from "../format";
  import { assentar, barra, cascata } from "../actions/animar";
  import { mostrarAviso } from "../avisos.svelte";
  import BuscaEquipe from "./BuscaEquipe.svelte";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  type Situacao = "pendente" | "ok" | "faltante" | "nao_ok";

  interface Resposta {
    encontrada: number | null;
    naoConforme: number;
    observacao: string;
  }

  const materiais = materiaisJson as Materiais;

  let data = $state(dataHoje());
  let processo = $state("");
  let prefixo = $state("");
  // Sem tipo padrão: o checklist só aparece depois que a equipe for identificada.
  let tipoEscolhido = $state("");
  let colaboradores = $state<string[]>([""]);
  let respostas = $state<Record<number, Resposta>>({});
  let equipes = $state<Equipe[]>([]);
  let enviando = $state(false);
  let erro = $state<string | null>(null);

  // Blitz guardadas no celular, à espera de conexão.
  let pendentes = $state<BlitzPendente[]>([]);
  let enviandoFila = $state(false);
  let online = $state(true);

  let mesHistorico = $state(mesHoje());
  let historico = $state<BlitzResumo[]>([]);
  let carregandoHistorico = $state(false);
  let erroHistorico = $state<string | null>(null);

  const prefixoNormalizado = $derived(prefixo.trim().toUpperCase());
  const equipeCadastrada = $derived(equipes.find((equipe) => equipe.prefixo === prefixoNormalizado));
  const tipoId = $derived(equipeCadastrada?.tipoId ?? tipoEscolhido);
  const tipoNome = $derived(tipoId ? nomeTipo(tipoId) : "");

  const itensDaBlitz = $derived(
    !tipoId
      ? []
      : materiais.itens
      .filter((item) => (item.quantidades[tipoId] ?? 0) > 0)
      .sort((a, b) => a.grupo.localeCompare(b.grupo) || a.descricao.localeCompare(b.descricao, "pt-BR")),
  );

  function exigidaDe(item: Item): number {
    return item.quantidades[tipoId] ?? 0;
  }

  // Situação derivada das quantidades: nada é marcado à mão.
  function situacaoDe(item: Item): Situacao {
    const resposta = respostas[item.id];
    if (!resposta || resposta.encontrada === null) return "pendente";
    if (resposta.encontrada < exigidaDe(item)) return "faltante";
    if (resposta.naoConforme > 0) return "nao_ok";
    return "ok";
  }

  function faltamDe(item: Item): number {
    const resposta = respostas[item.id];
    if (!resposta || resposta.encontrada === null) return 0;
    return Math.max(0, exigidaDe(item) - resposta.encontrada);
  }

  const respondidos = $derived(itensDaBlitz.filter((item) => respostas[item.id]?.encontrada != null).length);
  const completos = $derived(itensDaBlitz.filter((item) => situacaoDe(item) === "ok").length);
  const comPendencia = $derived(respondidos - completos);
  const aVerificar = $derived(itensDaBlitz.length - respondidos);
  const percentualRespondido = $derived(
    itensDaBlitz.length > 0 ? (respondidos / itensDaBlitz.length) * 100 : 0,
  );
  const colaboradoresValidos = $derived(
    colaboradores.map((nome) => nome.trim()).filter((nome) => nome.length > 0),
  );
  const podeEnviar = $derived(
    Boolean(processo) &&
      Boolean(tipoId) &&
      prefixoNormalizado.length > 0 &&
      colaboradoresValidos.length > 0 &&
      respondidos === itensDaBlitz.length &&
      !enviando,
  );

  $effect(() => {
    if (ativo) carregarEquipes();
  });

  $effect(() => {
    const mes = mesHistorico;
    if (ativo) carregarHistorico(mes);
  });

  $effect(() => {
    if (ativo) {
      carregarPendentes();
      enviarPendentes(false);
    }
  });

  function nomeTipo(id: string | null): string {
    if (!id) return "Sem tipo";
    return materiais.tipos.find((tipo) => tipo.id === id)?.nome ?? id;
  }

  function limitar(valor: number, minimo: number, maximo: number): number {
    return Math.min(maximo, Math.max(minimo, Math.trunc(valor)));
  }

  function garantirResposta(itemId: number): Resposta {
    if (!respostas[itemId]) {
      respostas[itemId] = { encontrada: null, naoConforme: 0, observacao: "" };
    }
    return respostas[itemId];
  }

  // Três situações exclusivas por item. Não há valor padrão: cada item precisa de uma escolha.
  const opcoesSituacao = [
    { valor: "ok", rotulo: "OK" },
    { valor: "nao_ok", rotulo: "Não OK" },
    { valor: "faltante", rotulo: "Faltante" },
  ] as const;

  // Unidades afetadas pela situação atual: faltam (Faltante) ou com defeito (Não OK).
  function quantidadeDe(item: Item): number {
    const situacao = situacaoDe(item);
    if (situacao === "faltante") return faltamDe(item);
    if (situacao === "nao_ok") return respostas[item.id]?.naoConforme ?? 0;
    return 0;
  }

  // Grava a situação nas duas contagens que o servidor usa para derivar o status.
  function escolherSituacao(item: Item, situacao: "ok" | "nao_ok" | "faltante") {
    const resposta = garantirResposta(item.id);
    const exigida = exigidaDe(item);
    if (situacao === "ok") {
      resposta.encontrada = exigida;
      resposta.naoConforme = 0;
      return;
    }
    // Ao trocar de situação, a quantidade anterior é mantida quando possível.
    const quantidade = limitar(quantidadeDe(item) || 1, 1, exigida);
    if (situacao === "nao_ok") {
      resposta.encontrada = exigida;
      resposta.naoConforme = quantidade;
    } else {
      resposta.encontrada = exigida - quantidade;
      resposta.naoConforme = 0;
    }
  }

  function ajustarQuantidade(item: Item, delta: number) {
    const situacao = situacaoDe(item);
    if (situacao !== "faltante" && situacao !== "nao_ok") return;
    const resposta = garantirResposta(item.id);
    const exigida = exigidaDe(item);
    const quantidade = limitar(quantidadeDe(item) + delta, 1, exigida);
    if (situacao === "nao_ok") {
      resposta.naoConforme = quantidade;
    } else {
      resposta.encontrada = exigida - quantidade;
    }
  }

  // Marca todos como OK e guarda as respostas anteriores por alguns segundos, para desfazer.
  let respostasAntes = $state<Record<number, Resposta> | null>(null);
  let temporizadorDesfazer: ReturnType<typeof setTimeout> | undefined;

  function marcarTodosOk() {
    respostasAntes = $state.snapshot(respostas) as Record<number, Resposta>;
    for (const item of itensDaBlitz) {
      escolherSituacao(item, "ok");
    }
    clearTimeout(temporizadorDesfazer);
    temporizadorDesfazer = setTimeout(() => (respostasAntes = null), 8000);
  }

  function desfazerMarcacao() {
    if (!respostasAntes) return;
    respostas = respostasAntes;
    respostasAntes = null;
    clearTimeout(temporizadorDesfazer);
  }

  function limparRespostas() {
    const quantidadeRespondida = respondidos;
    if (quantidadeRespondida === 0) return;
    if (!confirm(`Apagar as ${quantidadeRespondida} resposta(s) desta blitz?`)) return;
    respostas = {};
    respostasAntes = null;
  }

  async function carregarEquipes() {
    try {
      equipes = await api.equipes();
    } catch {
      equipes = [];
    }
  }

  async function carregarHistorico(mes: string) {
    carregandoHistorico = true;
    try {
      historico = await api.blitzes(mes);
      erroHistorico = null;
    } catch (falha) {
      erroHistorico = falha instanceof Error ? falha.message : "Não foi possível carregar o histórico.";
    } finally {
      carregandoHistorico = false;
    }
  }

  function adicionarColaborador() {
    colaboradores.push("");
  }

  function removerColaborador(indice: number) {
    colaboradores.splice(indice, 1);
  }

  function limparFormulario() {
    prefixo = "";
    tipoEscolhido = "";
    colaboradores = [""];
    respostas = {};
  }

  async function carregarPendentes() {
    try {
      pendentes = await fila.listar();
    } catch {
      pendentes = [];
    }
  }

  // Envia as blitz guardadas, em ordem. Sem conexão ou sem sessão, para e tenta na próxima vez.
  // Blitz rejeitadas pelo servidor ficam marcadas; só voltam a ser enviadas se o usuário pedir.
  async function enviarPendentes(manual: boolean) {
    if (enviandoFila) return;
    enviandoFila = true;
    let enviadas = 0;
    try {
      for (const item of await fila.listar()) {
        if (item.erro && !manual) continue;
        try {
          await api.registrarBlitz(item.payload);
          await fila.remover(item.id);
          enviadas++;
        } catch (falha) {
          const semConexao = falha instanceof ErroSemConexao;
          const semSessaoOuServidor =
            falha instanceof ErroApi && (falha.status === 401 || (falha.status ?? 500) >= 500);
          if (semConexao || semSessaoOuServidor) break;
          await fila.guardar({
            ...item,
            erro: falha instanceof Error ? falha.message : "Não foi possível enviar esta blitz.",
          });
        }
      }
    } catch {
      // Armazenamento do celular indisponível: nada a enviar.
    } finally {
      enviandoFila = false;
    }
    if (enviadas > 0) {
      mostrarAviso("ok", `${enviadas} blitz(es) enviada(s).`);
      await carregarHistorico(mesHistorico);
    }
    await carregarPendentes();
  }

  async function descartarPendente(id: string) {
    if (!confirm("Descartar esta blitz guardada? Ela não será enviada e não pode ser recuperada.")) return;
    await fila.remover(id);
    await carregarPendentes();
  }

  async function registrar() {
    erro = null;
    enviando = true;
    const idCliente = crypto.randomUUID();
    const payload: NovaBlitz = {
      idCliente,
      data,
      processo,
      prefixo: prefixoNormalizado,
      tipoId,
      colaboradores: colaboradoresValidos,
      itens: itensDaBlitz.map((item) => {
        const resposta = garantirResposta(item.id);
        return {
          itemId: item.id,
          encontrada: resposta.encontrada ?? 0,
          naoConforme: resposta.naoConforme,
          observacao: resposta.observacao.trim() || undefined,
        };
      }),
    };

    try {
      await api.registrarBlitz(payload);
      const contagem = { ok: 0, nao_ok: 0, faltante: 0 };
      for (const item of itensDaBlitz) {
        const situacao = situacaoDe(item);
        if (situacao !== "pendente") contagem[situacao]++;
      }
      mostrarAviso(
        "ok",
        `Equipe ${prefixoNormalizado} registrada: ${contagem.ok} OK, ${contagem.nao_ok} Não OK, ${contagem.faltante} Faltante.`,
      );
    } catch (falha) {
      if (!(falha instanceof ErroSemConexao)) {
        erro = falha instanceof Error ? falha.message : "Não foi possível registrar a blitz.";
        enviando = false;
        return;
      }
      // Sem sinal: guarda no celular com o mesmo identificador, para não duplicar no reenvio.
      try {
        await fila.guardar({ id: idCliente, criadaEm: Date.now(), payload });
        mostrarAviso(
          "info",
          `Sem conexão: a blitz da equipe ${prefixoNormalizado} foi guardada e será enviada quando houver sinal.`,
        );
      } catch {
        erro = "Sem conexão, e não foi possível guardar a blitz neste celular. Tente de novo com sinal.";
        enviando = false;
        return;
      }
    }

    enviando = false;
    limparFormulario();
    await Promise.all([carregarEquipes(), carregarHistorico(mesHistorico), carregarPendentes()]);
  }

  async function excluir(id: number) {
    if (!confirm("Excluir esta blitz? Essa ação não pode ser desfeita.")) return;
    try {
      await api.removerBlitz(id);
      mostrarAviso("ok", "Blitz excluída.");
      await carregarHistorico(mesHistorico);
    } catch (falha) {
      mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível excluir a blitz.");
    }
  }

  // Os mesmos nomes dos botões de situação, para não haver dois vocabulários na mesma tela.
  const rotuloSituacao: Record<Situacao, string> = {
    pendente: "A verificar",
    ok: "OK",
    faltante: "Faltante",
    nao_ok: "Não OK",
  };

  const classeSituacao: Record<Situacao, string> = {
    pendente: "",
    ok: "chip-ok",
    faltante: "chip-falta",
    nao_ok: "chip-atencao",
  };
</script>

<svelte:window bind:online ononline={() => enviarPendentes(false)} />

<section class="painel">
  {#if pendentes.length > 0}
    <section class="pendentes" aria-label="Blitz aguardando envio">
      <div class="cabecalho-painel">
        <div>
          <h3>Aguardando envio ({pendentes.length})</h3>
          <p>Guardadas neste celular. São enviadas automaticamente quando houver conexão.</p>
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
          <li class="etiqueta">
            <div class="pendente-topo">
              <strong class="codigo">{item.payload.prefixo}</strong>
              <span class="texto-suave">{item.payload.processo} · {formatarData(item.payload.data)}</span>
            </div>
            {#if item.erro}
              <p class="mensagem mensagem-erro">Não enviada: {item.erro}</p>
            {/if}
            <button type="button" class="botao-perigo" onclick={() => descartarPendente(item.id)}>Descartar</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="cabecalho-painel">
    <div>
      <h2>Blitz estática</h2>
      <p>Confira cada material exigido para a equipe: quantas unidades foram encontradas e quantas estão com defeito.</p>
    </div>
  </div>

  <form
    class="formulario"
    onsubmit={(evento) => {
      evento.preventDefault();
      registrar();
    }}
  >
    <div class="identificacao etiqueta-grande">
      <div class="grade-campos">
        <label class="rotulo">
          Data
          <input type="date" bind:value={data} required />
        </label>

        <label class="rotulo">
          Processo
          <select bind:value={processo} required>
            <option value="" disabled>Selecione</option>
            {#each PROCESSOS as sigla (sigla)}
              <option value={sigla}>{sigla}</option>
            {/each}
          </select>
        </label>

        <div class="rotulo">
          <span>Prefixo da equipe</span>
          <BuscaEquipe id="prefixo-equipe" bind:valor={prefixo} {equipes} {nomeTipo} />
        </div>

        <label class="rotulo">
          Tipo de equipe
          <select bind:value={tipoEscolhido} disabled={Boolean(equipeCadastrada?.tipoId)} required>
            <option value="" disabled>Selecione o tipo</option>
            {#each materiais.tipos as tipo (tipo.id)}
              <option value={tipo.id}>{tipo.nome}</option>
            {/each}
          </select>
        </label>
      </div>
      <p class="nota">
        {#if equipeCadastrada?.tipoId}
          Equipe cadastrada como <strong>{tipoNome}</strong>.
        {:else if equipeCadastrada}
          Equipe cadastrada sem tipo: escolha o tipo. Ele será gravado com esta blitz.
        {:else if prefixoNormalizado}
          Prefixo novo: será cadastrado com o tipo selecionado.
        {:else}
          Informe o prefixo para identificar a equipe.
        {/if}
      </p>
    </div>

    <div class="bloco">
      <h3>Colaboradores</h3>
      <div class="lista-colaboradores">
        {#each colaboradores as _nome, indice (indice)}
          <div class="linha-colaborador">
            <input
              bind:value={colaboradores[indice]}
              placeholder="Nome completo"
              aria-label={`Colaborador ${indice + 1}`}
              maxlength="120"
            />
            <button
              type="button"
              class="botao-perigo"
              onclick={() => removerColaborador(indice)}
              disabled={colaboradores.length === 1}
            >
              Remover
            </button>
          </div>
        {/each}
      </div>
      <button type="button" class="botao-secundario distancia" onclick={adicionarColaborador}>
        + Adicionar colaborador
      </button>
    </div>

    <div class="bloco">
      <!-- No celular, esta faixa fica presa abaixo do cabeçalho enquanto o checklist rola. -->
      <div class="contexto-fixo">
        <span class="codigo contexto-prefixo">{prefixoNormalizado || "Sem equipe"}</span>
        {#if tipoId}
          <span class="contexto-tipo">{tipoNome}</span>
        {/if}
        <span class="contexto-progresso codigo">{respondidos}/{itensDaBlitz.length}</span>
      </div>

      <div class="cabecalho-checklist">
        <div>
          <h3>{tipoId ? `Checklist · ${tipoNome}` : "Checklist"}</h3>
          <p class="nota">
            {#if tipoId}
              {itensDaBlitz.length} materiais exigidos para este tipo de equipe.
            {:else}
              Escolha o tipo da equipe para montar o checklist.
            {/if}
          </p>
        </div>
        <div class="contadores" aria-live="polite">
          <span class="chip chip-ok">{completos} OK</span>
          <span class="chip chip-atencao">{comPendencia} Não OK ou Faltante</span>
          <span class="chip">{aVerificar} a verificar</span>
        </div>
      </div>

      <div class="trilho distancia">
        <div class="preenchimento preenchimento-ok" use:barra={percentualRespondido}></div>
      </div>

      <div class="barra-acoes distancia">
        <button type="button" class="botao-secundario" onclick={marcarTodosOk}>Marcar todos como OK</button>
        <button type="button" class="botao-secundario" onclick={limparRespostas}>Limpar respostas</button>
      </div>

      {#if respostasAntes}
        <p class="desfazer-marcacao distancia" role="status">
          Todos marcados como OK.
          <button type="button" class="botao-secundario" onclick={desfazerMarcacao}>Desfazer</button>
        </p>
      {/if}

      <ol class="checklist distancia">
        {#each itensDaBlitz as item, posicao (item.id)}
          {@const situacao = situacaoDe(item)}
          {@const exigida = exigidaDe(item)}
          {@const quantidade = quantidadeDe(item)}
          <li
            class="etiqueta item"
            class:item-ok={situacao === "ok"}
            class:item-pendente={situacao === "faltante"}
            class:item-nao-ok={situacao === "nao_ok"}
            use:assentar={`${situacao}|${quantidade}`}
          >
            <div class="item-topo">
              <span class="numero codigo">{String(posicao + 1).padStart(2, "0")}</span>
              <div class="item-texto">
                <span class="item-descricao">{item.descricao}</span>
                <span class="item-meta">
                  <span class="chip" class:chip-epi={item.grupo === "EPI"} class:chip-epc={item.grupo === "EPC"}>{item.grupo}</span>
                  <span>Exigidos: <strong class="codigo">{exigida}</strong></span>
                </span>
              </div>
              <span class="chip situacao {classeSituacao[situacao]}">
                {#if situacao === "faltante"}
                  Faltam {faltamDe(item)}
                {:else}
                  {rotuloSituacao[situacao]}
                {/if}
              </span>
            </div>

            <div class="segmentos" role="group" aria-label={`Situação de ${item.descricao}`}>
              {#each opcoesSituacao as opcao (opcao.valor)}
                <button
                  type="button"
                  class="segmento"
                  data-situacao={opcao.valor}
                  class:ativo={situacao === opcao.valor}
                  aria-pressed={situacao === opcao.valor}
                  onclick={() => escolherSituacao(item, opcao.valor)}
                >
                  {opcao.rotulo}
                </button>
              {/each}
            </div>

            {#if (situacao === "faltante" || situacao === "nao_ok") && exigida > 1}
              <div class="quantidade-situacao">
                <span class="campo-rotulo" id={`qtd-${item.id}`}>
                  {situacao === "faltante" ? "Quantos faltam" : "Quantos com defeito"}
                </span>
                <div class="stepper" role="group" aria-labelledby={`qtd-${item.id}`}>
                  <button type="button" onclick={() => ajustarQuantidade(item, -1)} disabled={quantidade <= 1} aria-label="Diminuir quantidade">−</button>
                  <span class="quantidade-valor codigo" aria-live="polite">{quantidade}</span>
                  <button type="button" onclick={() => ajustarQuantidade(item, 1)} disabled={quantidade >= exigida} aria-label="Aumentar quantidade">+</button>
                </div>
              </div>
            {/if}

            {#if situacao === "faltante" || situacao === "nao_ok"}
              <input
                class="observacao"
                value={respostas[item.id]?.observacao ?? ""}
                oninput={(evento) => (garantirResposta(item.id).observacao = evento.currentTarget.value)}
                placeholder="Observação (opcional)"
                aria-label={`Observação sobre ${item.descricao}`}
                maxlength="500"
              />
            {/if}
          </li>
        {:else}
          <li class="vazio texto-suave">
            {#if tipoId}
              Nenhum material exigido para este tipo de equipe.
            {:else}
              Selecione o tipo de equipe ou um prefixo cadastrado para ver os materiais.
            {/if}
          </li>
        {/each}
      </ol>
    </div>

    <div class="barra-envio">
      <!-- Trilho de progresso colado à borda superior: lê-se de relance, mesmo com a tela rolada. -->
      <div class="progresso-envio" aria-hidden="true">
        <div class="progresso-envio-preenchido" use:barra={percentualRespondido}></div>
      </div>

      {#if erro}
        <p class="mensagem mensagem-erro" role="alert">{erro}</p>
      {/if}

      <div class="linha-envio">
        <div class="resumo-envio" aria-live="polite">
          <span class="contagem-envio codigo">{respondidos}/{itensDaBlitz.length}</span>
          <span class="rotulo-envio">
            {#if itensDaBlitz.length > 0 && aVerificar === 0}
              Pronto para registrar
            {:else if aVerificar === 1}
              1 item falta
            {:else}
              {aVerificar} itens faltam
            {/if}
          </span>
        </div>
        <button class="botao" type="submit" disabled={!podeEnviar}>
          {enviando ? "Registrando..." : online ? "Registrar blitz" : "Guardar no celular"}
        </button>
      </div>
    </div>
  </form>

  <div class="cabecalho-painel distancia separador">
    <div>
      <h2>Blitzes de {formatarMes(mesHistorico)}</h2>
      <p>Blitz registradas no mês, da mais recente para a mais antiga.</p>
    </div>
    <label class="rotulo">
      Mês
      <input type="month" bind:value={mesHistorico} />
    </label>
  </div>

  {#if erroHistorico}
    <p class="mensagem mensagem-erro" role="alert">{erroHistorico}</p>
  {/if}

  {#if carregandoHistorico && historico.length === 0}
    <div class="lista-blitz" aria-busy="true" aria-label="Carregando blitzes">
      {#each [0, 1, 2] as linha (linha)}
        <div class="cartao-blitz esqueleto-cartao">
          <span class="esqueleto" style="width: 32%"></span>
          <span class="esqueleto" style="width: 58%"></span>
        </div>
      {/each}
    </div>
  {:else if historico.length === 0}
    <p class="texto-suave">Nenhuma blitz registrada neste mês.</p>
  {:else}
    <div class="lista-blitz" use:cascata={`${mesHistorico}|${historico.length}`}>
      {#each historico as blitz (blitz.id)}
        <details class="cartao-blitz">
          <summary>
            <span class="codigo data">{formatarData(blitz.data)}</span>
            <strong class="codigo">{blitz.prefixo}</strong>
            <span class="texto-suave">{nomeTipo(blitz.tipoId)}</span>
            <span class="chip">{blitz.processo}</span>
            {#if blitz.conforme}
              <span class="chip chip-ok">Todos OK</span>
            {:else}
              <span class="chip chip-falta">{blitz.naoConformes} Não OK ou Faltante</span>
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
                      <th class="numerico">Exigidos</th>
                      <th class="numerico">Encontrados</th>
                      <th class="numerico">Faltam</th>
                      <th class="numerico">Não OK</th>
                      <th>Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each blitz.itensNaoConformes as item (item.itemId)}
                      <tr>
                        <td class="titulo-cartao">{item.descricao}</td>
                        <td data-rotulo="Exigidos" class="numerico codigo">{item.exigida}</td>
                        <td data-rotulo="Encontrados" class="numerico codigo">{item.encontrada}</td>
                        <td data-rotulo="Faltam" class="numerico codigo">{Math.max(0, item.exigida - item.encontrada)}</td>
                        <td data-rotulo="Não OK" class="numerico codigo">{item.naoConforme}</td>
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
  .formulario {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .identificacao {
    padding: 18px 18px 18px 38px;
  }

  .etiqueta-grande {
    position: relative;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda-forte);
    border-radius: var(--raio-etiqueta);
  }

  .etiqueta-grande::before {
    content: "";
    position: absolute;
    left: 14px;
    top: 14px;
    width: 12px;
    height: 5px;
    border-radius: 3px;
    background: var(--fundo);
    border: 1px solid var(--borda-forte);
  }

  .grade-campos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 14px;
  }

  .nota {
    margin-top: 12px;
    font-size: 0.9rem;
    color: var(--tinta-suave);
  }

  .bloco {
    background: var(--superficie);
    border: 1px solid var(--borda);
    border-radius: var(--raio);
    padding: 18px;
  }

  /* Faixa de identificação: só aparece no celular, onde o checklist é longo. */
  .contexto-fixo {
    display: none;
  }

  .bloco h3 {
    margin-bottom: 12px;
  }

  .linha-colaborador {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  .linha-colaborador input {
    flex: 1;
  }

  .cabecalho-checklist {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .cabecalho-checklist .nota {
    margin-top: 2px;
  }

  .contadores {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px 14px 34px;
    transition: border-color 200ms ease, background-color 200ms ease;
  }

  .item-ok {
    border-color: var(--ok);
  }

  .item-pendente {
    border-color: var(--falta);
    background: var(--falta-suave);
  }

  .item-nao-ok {
    border-color: var(--atencao);
    background: var(--atencao-suave);
  }

  .item-topo {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .numero {
    min-width: 2.2em;
    color: var(--tinta-suave);
    padding-top: 2px;
  }

  .item-texto {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .item-descricao {
    font-weight: 500;
  }

  .item-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 0.88rem;
    color: var(--tinta-suave);
  }

  .item-meta strong {
    color: var(--tinta);
  }

  .situacao {
    flex-shrink: 0;
  }

  /* Três situações exclusivas, uma por toque. Cada cor vem do status que ela representa. */
  .segmentos {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .segmento {
    min-height: 48px;
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

  .quantidade-situacao {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 260px;
  }

  .quantidade-valor {
    display: grid;
    place-items: center;
    min-height: 44px;
    font-weight: 500;
    border-top: 1px solid var(--borda);
    border-bottom: 1px solid var(--borda);
  }

  .desfazer-marcacao {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 10px 14px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda);
    border-radius: var(--raio-etiqueta);
    color: var(--tinta-suave);
  }

  .campo-rotulo {
    font-family: var(--fonte-titulo);
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--tinta-suave);
  }

  .stepper {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    align-items: stretch;
  }

  .stepper button {
    min-height: 44px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda-forte);
    color: var(--tinta);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
  }

  .stepper button:first-child {
    border-radius: var(--raio) 0 0 var(--raio);
  }

  .stepper button:last-child {
    border-radius: 0 var(--raio) var(--raio) 0;
  }

  .stepper button:hover:not(:disabled) {
    background: var(--primaria-suave);
  }

  .stepper button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .observacao {
    width: 100%;
    font-size: 0.95rem;
  }

  .vazio {
    padding: 12px 0;
  }

  /* Barra de envio: trilho de progresso no topo, resumo à esquerda e ação principal à direita. */
  .barra-envio {
    position: sticky;
    bottom: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 18px 12px;
    background: var(--envio-fundo);
    color: var(--envio-texto);
    border: 1px solid var(--borda);
    border-radius: var(--raio);
    box-shadow: var(--sombra-envio);
    overflow: hidden;
    transition: background-color 180ms ease;
  }

  .progresso-envio {
    height: 3px;
    margin: 0 -18px;
    background: color-mix(in srgb, var(--envio-texto) 14%, transparent);
  }

  .progresso-envio-preenchido {
    height: 100%;
    background: var(--primaria);
    width: 0;
  }

  .linha-envio {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 52px;
  }

  .resumo-envio {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }

  .contagem-envio {
    font-size: 1.3rem;
    font-weight: 500;
    color: var(--envio-texto);
  }

  .rotulo-envio {
    font-family: var(--fonte-titulo);
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--envio-suave);
    white-space: nowrap;
  }

  .barra-envio .mensagem {
    margin: 10px 0 0;
  }

  .barra-envio .botao {
    min-height: 44px;
    min-width: 200px;
  }

  /* Ação principal em azul, como nas demais telas. Âmbar fica reservado para status "Não OK". */
  .barra-envio .botao {
    background: var(--primaria);
    border-color: var(--primaria);
    color: var(--primaria-tinta);
  }

  .barra-envio .botao:hover:not(:disabled) {
    background: var(--primaria);
    border-color: var(--primaria);
    filter: brightness(1.08);
  }

  .barra-envio .botao:disabled {
    background: color-mix(in srgb, var(--envio-texto) 14%, var(--envio-fundo));
    border-color: color-mix(in srgb, var(--envio-texto) 14%, var(--envio-fundo));
    color: var(--envio-suave);
    opacity: 1;
  }

  .esqueleto-cartao {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .pendentes {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--atencao-suave);
    border: 1px solid var(--atencao);
    border-radius: var(--raio);
  }

  .lista-pendentes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .lista-pendentes .etiqueta {
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

  .separador {
    padding-top: 24px;
    border-top: 1px solid var(--borda);
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
    cursor: pointer;
    list-style-position: outside;
  }

  .data {
    color: var(--tinta-suave);
  }

  .detalhe {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--borda);
  }

  @media (max-width: 640px) {
    /* A barra de envio fica acima da barra de abas do rodapé (58px + área segura do aparelho). */
    .barra-envio {
      bottom: calc(58px + env(safe-area-inset-bottom));
    }

    .segmento {
      min-height: 52px;
    }

    .contexto-fixo {
      position: sticky;
      top: var(--altura-topo);
      z-index: 4;
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      align-items: center;
      margin: -18px -18px 12px;
      padding: 10px 18px;
      background: var(--superficie-elevada);
      border-bottom: 1px solid var(--borda);
      font-size: 0.9rem;
    }

    .contexto-prefixo {
      font-weight: 700;
    }

    .contexto-tipo {
      color: var(--tinta-suave);
    }

    .contexto-progresso {
      margin-left: auto;
      color: var(--tinta-suave);
    }

    .item-topo {
      flex-wrap: wrap;
    }

    .linha-colaborador {
      flex-direction: column;
    }

    .barra-envio {
      padding: 0 12px 10px;
    }

    .progresso-envio {
      margin: 0 -12px;
    }

    .barra-envio .botao {
      min-width: 0;
      padding: 10px 16px;
    }

    .rotulo-envio {
      white-space: normal;
    }
  }
</style>
