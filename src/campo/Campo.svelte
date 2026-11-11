<script lang="ts">
  import { onMount } from "svelte";
  import materiaisJson from "../lib/data/materiais.json";
  import { dataHoje, formatarData } from "../lib/format";
  import {
    ESCOPOS,
    FOTOS_MAXIMO,
    FOTOS_MINIMO,
    INSPETOR_MAXIMO,
    INSPETOR_MINIMO,
    PROCESSOS,
    ROTULO_ESCOPO,
  } from "../lib/compartilhado";
  import { mostrarAviso } from "../lib/avisos.svelte";
  import { fila, type BlitzPendente, type FotoPendente } from "../lib/fila";
  import { reduzirFoto } from "./foto";
  import type { EscopoBlitz, ItemCampo, Materiais, MateriaisCampo, NovaBlitz, NovoItemBlitz, SituacaoEpi } from "../lib/tipos";
  import BuscaEquipe from "../lib/components/BuscaEquipe.svelte";
  import BuscaColaborador from "../lib/components/BuscaColaborador.svelte";
  import Avisos from "../lib/components/Avisos.svelte";
  import { apiCampo, envioAdiavel, type EquipeCampo } from "./api";
  import { guardarPedido, listarPedidos, removerPedido } from "./pedidos";
  import { aoTerNovaVersao } from "./pwa";

  type Situacao = "ok" | "nao_ok" | "faltante";
  interface Escolha {
    situacao: Situacao;
    quantidade: number;
    observacao: string;
  }

  // A lista de materiais vem da API e muda quando um administrador edita o catálogo. Até ela chegar (ou sem sinal e
  // sem cópia guardada), vale a do arquivo do código. A versão vai junto com a blitz, para o servidor saber qual lista
  // o celular viu.
  const arquivo = materiaisJson as Materiais;
  let materiais = $state<MateriaisCampo>({ tipos: arquivo.tipos, itens: arquivo.itens, versao: null });
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

  // Quem faz a inspeção. O nome fica guardado no celular: o encarregado costuma ser o mesmo a cada blitz.
  const CHAVE_INSPETOR = "paes:inspetor";
  function lerInspetor(): string {
    try {
      return localStorage.getItem(CHAVE_INSPETOR) ?? "";
    } catch {
      return "";
    }
  }
  let inspetor = $state(lerInspetor());
  const inspetorNormalizado = $derived(inspetor.replace(/\s+/g, " ").trim());
  const inspetorValido = $derived(
    inspetorNormalizado.length >= INSPETOR_MINIMO && inspetorNormalizado.length <= INSPETOR_MAXIMO,
  );

  $effect(() => {
    const nome = inspetorNormalizado;
    try {
      if (nome) localStorage.setItem(CHAVE_INSPETOR, nome);
    } catch {
      // Sem armazenamento: o nome só precisa ser digitado de novo na próxima blitz.
    }
  });

  // Fotos de evidência, tiradas ao final da inspeção. Cada uma já é um JPEG reduzido; a miniatura usa um endereço
  // temporário do navegador, que é liberado quando a foto sai da tela.
  interface FotoTirada {
    id: string;
    blob: Blob;
    url: string;
  }
  let fotos = $state.raw<FotoTirada[]>([]);
  let processandoFoto = $state(false);
  let erroFoto = $state("");

  async function aoEscolherFotos(evento: Event) {
    const entrada = evento.currentTarget as HTMLInputElement;
    const arquivos = Array.from(entrada.files ?? []);
    entrada.value = "";
    if (arquivos.length === 0) return;
    erroFoto = "";
    processandoFoto = true;
    try {
      for (const arquivo of arquivos) {
        if (fotos.length >= FOTOS_MAXIMO) {
          erroFoto = `No máximo ${FOTOS_MAXIMO} fotos por blitz.`;
          break;
        }
        try {
          const blob = await reduzirFoto(arquivo);
          fotos = [...fotos, { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) }];
        } catch (falha) {
          erroFoto = falha instanceof Error ? falha.message : "Não foi possível preparar a foto.";
        }
      }
    } finally {
      processandoFoto = false;
    }
  }

  function removerFoto(id: string) {
    const foto = fotos.find((f) => f.id === id);
    if (foto) URL.revokeObjectURL(foto.url);
    fotos = fotos.filter((f) => f.id !== id);
    erroFoto = "";
  }

  function limparFotos() {
    for (const foto of fotos) URL.revokeObjectURL(foto.url);
    fotos = [];
    erroFoto = "";
  }

  const caminhoDaFoto = (id: string) => `campo/${id}.jpg`;

  // Envia as fotos antes da blitz. O identificador vem do celular, então reenviar a mesma foto não duplica.
  async function enviarFotos(lista: FotoPendente[]) {
    for (const foto of lista) await apiCampo.enviarFoto(foto.id, foto.blob);
  }

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

  // O que esta blitz verifica: tudo, só o EPI ou só o EPC. Só o escolhido é exigido e enviado.
  let escopo = $state<EscopoBlitz>("todos");
  const incluiEpi = $derived(escopo !== "epc");
  const incluiEpc = $derived(escopo !== "epi");
  const faltam = $derived(
    (incluiEpc ? itensEpc.length - respondidosEpc : 0) + (incluiEpi ? totalEpi - respondidosEpi : 0),
  );
  const itensNoEscopo = $derived((incluiEpi ? itensEpi.length : 0) + (incluiEpc ? itensEpc.length : 0));

  // EPI e EPC são mostrados um de cada vez, para a pessoa escolher por onde começar.
  let grupoAtual = $state<"EPI" | "EPC">("EPI");
  const GRUPOS = ["EPI", "EPC"] as const;

  function escolherEscopo(novo: EscopoBlitz) {
    escopo = novo;
    antesDaMarcacao = null;
    // O grupo mostrado acompanha a escolha: só EPI mostra o EPI, só EPC mostra o EPC.
    if (novo === "epi") grupoAtual = "EPI";
    if (novo === "epc") grupoAtual = "EPC";
  }

  const itensDoGrupo = $derived(grupoAtual === "EPI" ? itensEpi : itensEpc);
  const restantesDoGrupo = $derived(
    grupoAtual === "EPI"
      ? itensEpi.filter((item) => !escolhasEpi[pessoaMostrada]?.[item.id]).length
      : itensEpc.filter((item) => !escolhas[item.id]).length,
  );

  function itensDoTipo(grupo: "EPI" | "EPC"): number {
    return grupo === "EPI" ? itensEpi.length : itensEpc.length;
  }

  // Sem colaboradores ainda, o total de EPI mostra o de uma pessoa (e não "0/0"); com eles, vira itens vezes pessoas.
  function totalDoGrupo(grupo: "EPI" | "EPC"): number {
    return grupo === "EPI" ? Math.max(colaboradoresValidos.length, 1) * itensEpi.length : itensEpc.length;
  }

  function respondidosDoGrupo(grupo: "EPI" | "EPC"): number {
    return grupo === "EPI" ? respondidosEpi : respondidosEpc;
  }

  // Situação mostrada para um item: a da pessoa atual (EPI) ou a da equipe (EPC).
  function escolhaDo(item: ItemCampo): Escolha | undefined {
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
      itensNoEscopo > 0 &&
      faltam === 0 &&
      inspetorValido &&
      fotos.length >= FOTOS_MINIMO &&
      !processandoFoto,
  );

  // O que ainda impede o envio, em termos curtos. Fica sempre visível na barra de envio.
  const faltando = $derived.by(() => {
    const lista: string[] = [];
    if (prefixoNormalizado.length === 0) lista.push("prefixo");
    if (prefixoNormalizado && !tipoId) lista.push("tipo");
    if (prefixoNormalizado && !processoDaBlitz) lista.push("processo");
    if (colaboradoresValidos.length === 0) lista.push("colaborador");
    if (!inspetorValido) lista.push("inspetor");
    if (tipoId && faltam > 0) lista.push(`${faltam} ${faltam === 1 ? "item" : "itens"}`);
    if (fotos.length < FOTOS_MINIMO || processandoFoto) lista.push("foto");
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

  function exigidaDe(item: ItemCampo): number {
    return tipoId ? (item.quantidades[tipoId] ?? 0) : 0;
  }

  // Converte a escolha da tela nas duas contagens que o servidor usa para derivar o status do item.
  function paraEnvio(item: ItemCampo): NovoItemBlitz | null {
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
  let caixaEpi = $state<{ item: ItemCampo; situacao: "nao_ok" | "faltante"; selecionadas: string[] } | null>(null);

  function abrirCaixaEpi(item: ItemCampo, situacao: "nao_ok" | "faltante") {
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

  function escolher(item: ItemCampo, situacao: Situacao) {
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
    for (const item of incluiEpc ? itensEpc : []) {
      const escolha = escolhas[item.id];
      if (escolha) contagem[escolha.situacao]++;
    }
    for (const nome of incluiEpi ? colaboradoresValidos : []) {
      for (const item of itensEpi) {
        const situacao = escolhasEpi[nome]?.[item.id];
        if (situacao) contagem[situacao]++;
      }
    }
    return `${contagem.ok} OK, ${contagem.nao_ok} Troca, ${contagem.faltante} Faltante`;
  }

  function ajustar(item: ItemCampo, delta: number) {
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
    escopo = "todos";
    grupoAtual = "EPI";
    // O nome do inspetor fica: a próxima equipe costuma ser inspecionada por quem acabou de registrar.
    limparFotos();
  }

  async function carregarEquipes() {
    try {
      equipes = await apiCampo.equipes();
    } catch {
      // Sem sinal: a lista guardada pelo navegador continua valendo; o prefixo também pode ser digitado.
    }
  }

  async function carregarMateriais() {
    try {
      materiais = await apiCampo.materiais();
    } catch {
      // Sem sinal: vale a última lista guardada pelo navegador ou, na falta dela, a do arquivo do código.
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
      if (envioAdiavel(falha)) {
        // Sem sinal: o pedido fica guardado e vai sozinho quando a conexão voltar.
        guardarPedido(nome);
        mostrarAviso(
          "info",
          `Sem conexão: o pedido de cadastro de ${nome} foi guardado e será enviado quando houver sinal. Você pode usar o nome nesta blitz.`,
        );
      } else {
        mostrarAviso("erro", falha instanceof Error ? falha.message : "Não foi possível enviar o pedido.");
      }
    } finally {
      solicitando = false;
    }
  }

  // Envia os pedidos de cadastro guardados sem sinal. Para ao primeiro sinal de que ainda não há conexão.
  async function enviarPedidosGuardados() {
    for (const nome of listarPedidos()) {
      try {
        const resultado = await apiCampo.solicitarColaborador(nome);
        removerPedido(nome);
        if (resultado.status === "aprovado" && !sugestoes.includes(resultado.nome)) {
          sugestoes = [...sugestoes, resultado.nome];
        }
      } catch (falha) {
        if (envioAdiavel(falha)) return;
        // Recusado pelo servidor (nome inválido): não adianta tentar de novo.
        removerPedido(nome);
      }
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
          // Blitz guardada antes da exigência de fotos não tem nenhuma para enviar.
          await enviarFotos(item.fotos ?? []);
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
    const fotosParaEnvio: FotoPendente[] = fotos.map((foto) => ({ id: foto.id, blob: foto.blob }));
    const blitz: NovaBlitz = {
      idCliente: crypto.randomUUID(),
      inspetor: inspetorNormalizado,
      // O caminho de cada foto vem do identificador gerado aqui, então vale igual enviando agora ou depois.
      fotos: fotosParaEnvio.map((foto) => caminhoDaFoto(foto.id)),
      // A lista de materiais que este celular usou. Itens criados depois dela não são exigidos desta blitz.
      catalogoVersao: materiais.versao ?? undefined,
      data,
      processo: processoDaBlitz,
      prefixo: prefixoNormalizado,
      tipoId,
      colaboradores: colaboradoresValidos,
      escopo,
      itens: incluiEpc
        ? itensEpc.map((item) => paraEnvio(item)).filter((item): item is NovoItemBlitz => item !== null)
        : [],
      pessoas: incluiEpi
        ? colaboradoresValidos.flatMap((nome) =>
            itensEpi.map((item) => ({
              colaborador: nome,
              itemId: item.id,
              status: situacaoEpi(escolhasEpi[nome]?.[item.id] ?? "faltante"),
            })),
          )
        : [],
    };

    enviando = true;
    try {
      await enviarFotos(fotosParaEnvio);
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
        await fila.guardar({ id: blitz.idCliente!, criadaEm: Date.now(), payload: blitz, fotos: fotosParaEnvio });
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

  // As listas de equipes e de colaboradores seguem o que foi feito no painel: o app confere sozinho a cada
  // meio minuto enquanto está aberto e visível, e de novo ao voltar para o app.
  const INTERVALO_LISTAS_MS = 30_000;

  function atualizarListas() {
    if (document.visibilityState !== "visible" || !navigator.onLine) return;
    carregarEquipes();
    carregarSugestoes();
    carregarMateriais();
  }

  // Versão nova do app instalada em segundo plano. Recarrega sozinho quando não há blitz em andamento;
  // com blitz em andamento, mostra um aviso e deixa o encarregado terminar antes.
  let versaoNova = $state(false);
  const formularioVazio = $derived(prefixo.trim() === "" && colaboradores.every((nome) => nome.trim() === ""));

  $effect(() => {
    if (!versaoNova || !formularioVazio || enviando || caixaEpi) return;
    // Espera o aviso de "blitz registrada" aparecer antes de recarregar.
    const espera = setTimeout(() => location.reload(), 5000);
    return () => clearTimeout(espera);
  });

  onMount(() => {
    carregarEquipes();
    carregarSugestoes();
    carregarMateriais();
    carregarPendentes();
    enviarPendentes(false);
    enviarPedidosGuardados();

    const intervalo = setInterval(atualizarListas, INTERVALO_LISTAS_MS);
    const aoVoltar = () => atualizarListas();
    document.addEventListener("visibilitychange", aoVoltar);
    const pararAvisoDeVersao = aoTerNovaVersao(() => (versaoNova = true));

    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
      pararAvisoDeVersao();
    };
  });
</script>

<svelte:window
  bind:online
  ononline={() => {
    enviarPendentes(false);
    enviarPedidosGuardados();
    carregarEquipes();
    carregarSugestoes();
    carregarMateriais();
  }}
  onkeydown={(evento) => {
    if (evento.key === "Escape" && caixaEpi) caixaEpi = null;
  }}
/>

<header class="topo-campo">
  <div class="marca">
    <span class="marca-sigla">PAES</span>
    <span class="marca-nome">Programa de Acompanhamento de Equipamento de Segurança</span>
  </div>
  {#if !online}
    <span class="chip chip-atencao">Sem conexão</span>
  {/if}
</header>

{#if versaoNova && !formularioVazio}
  <div class="aviso-versao" role="status">
    <span>Há uma versão nova do PAES. Termine a blitz em andamento e atualize.</span>
    <button type="button" class="botao-secundario" onclick={() => location.reload()}>Atualizar agora</button>
  </div>
{/if}

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
            {#if item.payload.inspetor}
              <p class="texto-suave pendente-detalhe">
                Inspetor {item.payload.inspetor} · {item.fotos?.length ?? 0}
                {(item.fotos?.length ?? 0) === 1 ? "foto" : "fotos"}
              </p>
            {/if}
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

    <label class="rotulo">
      Inspetor
      <input
        type="text"
        bind:value={inspetor}
        maxlength={INSPETOR_MAXIMO}
        autocomplete="name"
        placeholder="Nome de quem faz a inspeção"
        required
      />
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
      {#if itensEpi.length > 0 && itensEpc.length > 0}
        <fieldset class="escopo">
          <legend>O que verificar nesta blitz</legend>
          <div class="escopo-opcoes" role="radiogroup" aria-label="O que verificar nesta blitz">
            {#each ESCOPOS as opcao (opcao)}
              <label class="escopo-opcao" class:ativo={escopo === opcao}>
                <input
                  type="radio"
                  name="escopo-blitz"
                  value={opcao}
                  checked={escopo === opcao}
                  onchange={() => escolherEscopo(opcao)}
                />
                {opcao === "todos" ? ROTULO_ESCOPO.todos : opcao.toUpperCase()}
              </label>
            {/each}
          </div>
          {#if escopo !== "todos"}
            <p class="nota">
              Esta blitz registra só o {escopo === "epi" ? "EPI" : "EPC"}. O {escopo === "epi" ? "EPC" : "EPI"} não entra.
            </p>
          {/if}
        </fieldset>
      {/if}

      <div class="grupos" role="tablist" aria-label="Grupo de materiais">
        {#each GRUPOS as grupo (grupo)}
          {#if itensDoTipo(grupo) > 0 && (grupo === "EPI" ? incluiEpi : incluiEpc)}
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
          {#if grupoAtual === "EPI" && !pessoaMostrada}
            EPI de cada colaborador: informe os colaboradores acima.
          {:else}
            {#if grupoAtual === "EPI"}
              EPI de {pessoaMostrada}:
            {:else}
              EPC:
            {/if}
            <span class="codigo">{grupoAtual === "EPI" ? respondidosEpiDe(pessoaMostrada) : respondidosEpc}/{itensDoGrupo.length}</span> respondidos
          {/if}
        </span>
        <button
          type="button"
          class="botao-secundario"
          onclick={marcarRestantesOk}
          disabled={restantesDoGrupo === 0 || (grupoAtual === "EPI" && !pessoaMostrada)}
        >
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

    <section class="evidencia" aria-labelledby="evidencia-titulo">
      <h3 id="evidencia-titulo">Evidência da inspeção</h3>
      <p class="texto-suave">
        Ao terminar, tire de {FOTOS_MINIMO} a {FOTOS_MAXIMO} fotos da equipe e dos materiais.
      </p>
      {#if fotos.length > 0}
        <ul class="fotos">
          {#each fotos as foto, posicao (foto.id)}
            <li class="foto">
              <img src={foto.url} alt={`Foto ${posicao + 1} da inspeção`} />
              <button
                type="button"
                class="foto-remover"
                aria-label={`Remover foto ${posicao + 1}`}
                onclick={() => removerFoto(foto.id)}
              >
                Remover
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if fotos.length < FOTOS_MAXIMO}
        <label class="botao-secundario botao-foto" class:desativado={processandoFoto}>
          {processandoFoto ? "Preparando foto..." : fotos.length === 0 ? "Tirar foto" : "Tirar outra foto"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={processandoFoto}
            onchange={aoEscolherFotos}
          />
        </label>
      {/if}
      {#if erroFoto}
        <p class="mensagem mensagem-erro" role="alert">{erroFoto}</p>
      {/if}
    </section>

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
  /* Evidência: fotos tiradas ao final, em miniaturas quadradas, com o botão de tirar mais embaixo */
  .evidencia {
    display: grid;
    gap: 0.6rem;
  }

  .evidencia h3 {
    margin: 0;
    font-family: var(--fonte-titulo);
    font-size: 1rem;
  }

  .evidencia p {
    margin: 0;
  }

  .fotos {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    gap: 0.6rem;
  }

  .foto {
    display: grid;
    gap: 0.3rem;
  }

  .foto img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border: 1px solid var(--tinta-suave);
    border-radius: 4px;
    background: #0001;
  }

  .foto-remover {
    min-height: 2.75rem;
    border: 1px solid var(--tinta-suave);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .botao-foto {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 3rem;
    cursor: pointer;
  }

  .botao-foto.desativado {
    opacity: 0.6;
    cursor: progress;
  }

  /* O seletor de arquivo fica escondido; o rótulo inteiro é o botão, e o teclado ainda alcança o campo. */
  .botao-foto input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: inherit;
  }

  .botao-foto:focus-within {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  .pendente-detalhe {
    margin: 0;
  }

  /* Escolha do que verificar: três opções lado a lado, no mesmo desenho das abas de EPI e EPC */
  .escopo {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  .escopo legend {
    padding: 0;
    margin-bottom: 8px;
    font-family: var(--fonte-titulo);
    font-size: 0.92rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--tinta-suave);
  }

  .escopo-opcoes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .escopo-opcao {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 8px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda-forte);
    border-radius: var(--raio-etiqueta);
    color: var(--tinta);
    font-family: var(--fonte-titulo);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    text-align: center;
    cursor: pointer;
    transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
  }

  .escopo-opcao.ativo {
    background: var(--primaria);
    border-color: var(--primaria);
    color: var(--primaria-tinta);
  }

  .escopo-opcao input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .escopo-opcao:focus-within {
    outline: 2px solid var(--primaria);
    outline-offset: 2px;
  }

  .escopo .nota {
    margin: 8px 0 0;
  }

  .aviso-versao {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 10px 16px;
    background: var(--superficie-elevada);
    border-bottom: 1px solid var(--borda-forte);
    font-size: 0.92rem;
  }

  .aviso-versao button {
    min-height: 44px;
  }

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

  /* Sigla e nome por extenso lado a lado, com um fio separando; o nome quebra em linhas equilibradas */
  .marca {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .marca-sigla {
    font-family: var(--fonte-titulo);
    font-weight: 700;
    font-size: 1.5rem;
    line-height: 1;
    letter-spacing: 0.05em;
  }

  .marca-nome {
    min-width: 0;
    padding-left: 12px;
    border-left: 1px solid var(--topo-borda);
    font-size: 0.64rem;
    font-weight: 500;
    line-height: 1.35;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-wrap: balance;
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
