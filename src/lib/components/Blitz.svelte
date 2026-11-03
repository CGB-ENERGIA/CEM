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

  const LIMITE_QUANTIDADE = 999;

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

  // Ao informar a quantidade encontrada, o defeito nunca passa dela.
  function definirEncontrada(item: Item, valor: number | string) {
    const resposta = garantirResposta(item.id);
    if (valor === "" || valor === null) {
      resposta.encontrada = null;
      resposta.naoConforme = 0;
      return;
    }
    const numero = typeof valor === "number" ? valor : Number(valor);
    if (Number.isNaN(numero)) return;
    resposta.encontrada = limitar(numero, 0, LIMITE_QUANTIDADE);
    resposta.naoConforme = Math.min(resposta.naoConforme, resposta.encontrada);
  }

  function definirDefeito(item: Item, valor: number | string) {
    const resposta = garantirResposta(item.id);
    const encontrada = resposta.encontrada ?? 0;
    const numero = typeof valor === "number" ? valor : Number(valor);
    if (Number.isNaN(numero)) return;
    resposta.naoConforme = limitar(numero, 0, encontrada);
  }

  function ajustar(item: Item, campo: "encontrada" | "naoConforme", delta: number) {
    const resposta = garantirResposta(item.id);
    if (campo === "encontrada") {
      definirEncontrada(item, (resposta.encontrada ?? 0) + delta);
    } else {
      definirDefeito(item, resposta.naoConforme + delta);
    }
  }

  // "Tudo ok": encontrou todas as unidades exigidas e nenhuma com defeito.
  function completarItem(item: Item) {
    const resposta = garantirResposta(item.id);
    resposta.encontrada = exigidaDe(item);
    resposta.naoConforme = 0;
  }

  function marcarTodosCompletos() {
    for (const item of itensDaBlitz) {
      completarItem(item);
    }
  }

  function limparRespostas() {
    respostas = {};
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
      const { id } = await api.registrarBlitz(payload);
      mostrarAviso("ok", `Blitz da equipe ${prefixoNormalizado} registrada (nº ${id}).`);
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

  const rotuloSituacao: Record<Situacao, string> = {
    pendente: "A verificar",
    ok: "Completo",
    faltante: "Faltando",
    nao_ok: "Com defeito",
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
          <span class="chip chip-ok">{completos} completos</span>
          <span class="chip chip-atencao">{comPendencia} com pendência</span>
          <span class="chip">{aVerificar} a verificar</span>
        </div>
      </div>

      <div class="trilho distancia">
        <div class="preenchimento preenchimento-ok" use:barra={percentualRespondido}></div>
      </div>

      <div class="barra-acoes distancia">
        <button type="button" class="botao-secundario" onclick={marcarTodosCompletos}>
          Marcar todos como completos
        </button>
        <button type="button" class="botao-secundario" onclick={limparRespostas}>Limpar respostas</button>
      </div>

      <ol class="checklist distancia">
        {#each itensDaBlitz as item, posicao (item.id)}
          {@const situacao = situacaoDe(item)}
          {@const exigida = exigidaDe(item)}
          {@const encontrada = respostas[item.id]?.encontrada ?? null}
          {@const naoConforme = respostas[item.id]?.naoConforme ?? 0}
          <li
            class="etiqueta item"
            class:item-ok={situacao === "ok"}
            class:item-pendente={situacao === "faltante" || situacao === "nao_ok"}
            use:assentar={`${situacao}|${encontrada}|${naoConforme}`}
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

            <div class="contagens">
              <div class="campo-contagem">
                <span class="campo-rotulo" id={`enc-${item.id}`}>Encontrados</span>
                <div class="stepper" role="group" aria-labelledby={`enc-${item.id}`}>
                  <button type="button" onclick={() => ajustar(item, "encontrada", -1)} disabled={!encontrada} aria-label="Diminuir encontrados">−</button>
                  <input
                    type="number"
                    inputmode="numeric"
                    min="0"
                    max={LIMITE_QUANTIDADE}
                    value={encontrada ?? ""}
                    oninput={(evento) => definirEncontrada(item, evento.currentTarget.value)}
                    aria-label={`Encontrados de ${item.descricao}`}
                  />
                  <button type="button" onclick={() => ajustar(item, "encontrada", 1)} aria-label="Aumentar encontrados">+</button>
                </div>
              </div>

              <div class="campo-contagem">
                <span class="campo-rotulo" id={`def-${item.id}`}>Com defeito</span>
                <div class="stepper" role="group" aria-labelledby={`def-${item.id}`}>
                  <button type="button" onclick={() => ajustar(item, "naoConforme", -1)} disabled={naoConforme === 0} aria-label="Diminuir defeitos">−</button>
                  <input
                    type="number"
                    inputmode="numeric"
                    min="0"
                    max={encontrada ?? 0}
                    value={naoConforme}
                    oninput={(evento) => definirDefeito(item, evento.currentTarget.value)}
                    disabled={!encontrada}
                    aria-label={`Unidades com defeito de ${item.descricao}`}
                  />
                  <button type="button" onclick={() => ajustar(item, "naoConforme", 1)} disabled={!encontrada || naoConforme >= (encontrada ?? 0)} aria-label="Aumentar defeitos">+</button>
                </div>
              </div>

              <button type="button" class="botao-secundario completo" onclick={() => completarItem(item)}>
                Tudo ok
              </button>
            </div>

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
      <div class="mensagens">
        {#if erro}
          <p class="mensagem mensagem-erro" role="alert">{erro}</p>
        {/if}
      </div>
      <div class="acao-envio">
        {#if respondidos !== itensDaBlitz.length}
          <span class="nota">Faltam {aVerificar} item(ns) para registrar.</span>
        {/if}
        <button class="botao" type="submit" disabled={!podeEnviar}>
          {enviando ? "Registrando..." : online ? "Registrar blitz" : "Guardar no celular"}
        </button>
      </div>
    </div>
  </form>

  <div class="cabecalho-painel distancia separador">
    <div>
      <h2>Blitzes de {formatarMes(mesHistorico)}</h2>
      <p>Pendências abertas para adequação, por equipe.</p>
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
              <span class="chip chip-ok">Conforme</span>
            {:else}
              <span class="chip chip-falta">{blitz.naoConformes} pendência(s)</span>
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
                      <th class="numerico">Com defeito</th>
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
                        <td data-rotulo="Com defeito" class="numerico codigo">{item.naoConforme}</td>
                        <td data-rotulo="Observação">{item.observacao ?? "—"}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <p class="texto-suave">Todos os itens estão completos.</p>
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

  /* Duas contagens lado a lado, com o botão "Tudo ok" ao lado */
  .contagens {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 12px;
    align-items: end;
  }

  .campo-contagem {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
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

  .stepper input {
    min-height: 44px;
    text-align: center;
    border-radius: 0;
    border-left: none;
    border-right: none;
    font-family: var(--fonte-codigo);
    font-size: 1.05rem;
    font-weight: 500;
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .stepper input::-webkit-outer-spin-button,
  .stepper input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .completo {
    min-height: 44px;
    white-space: nowrap;
  }

  .observacao {
    width: 100%;
    font-size: 0.95rem;
  }

  .vazio {
    padding: 12px 0;
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
    padding: 14px 18px;
    background: var(--envio-fundo);
    color: var(--envio-texto);
    border: 1px solid var(--borda);
    border-radius: var(--raio);
    box-shadow: var(--sombra-envio);
    transition: background-color 180ms ease;
  }

  .barra-envio .nota {
    margin: 0;
    color: var(--envio-suave);
  }

  .barra-envio .mensagens {
    flex: 1 1 100%;
  }

  .barra-envio .mensagem {
    margin: 0 0 8px;
  }

  .acao-envio {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-left: auto;
  }

  .barra-envio .botao {
    background: var(--atencao);
    border-color: var(--atencao);
    color: var(--atencao-tinta);
  }

  .barra-envio .botao:hover:not(:disabled) {
    background: var(--atencao);
    border-color: var(--atencao);
    filter: brightness(0.94);
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
    .contagens {
      grid-template-columns: 1fr 1fr;
    }

    .completo {
      grid-column: 1 / -1;
    }

    .item-topo {
      flex-wrap: wrap;
    }

    .linha-colaborador {
      flex-direction: column;
    }

    .acao-envio {
      width: 100%;
      flex-direction: column;
      align-items: stretch;
      margin-left: 0;
    }

    .acao-envio .botao {
      width: 100%;
    }

    .acao-envio .nota {
      text-align: center;
    }
  }
</style>
