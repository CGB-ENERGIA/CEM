<script lang="ts">
  import { api } from "../api";
  import type { UsuarioGerenciado } from "../tipos";
  import { formatarData, normalizarTexto } from "../format";
  import { cascata } from "../actions/animar";
  import { mostrarAviso } from "../avisos.svelte";
  import { sessao } from "../sessao.svelte";

  interface Props {
    ativo: boolean;
  }

  let { ativo }: Props = $props();

  // O painel que está aberto acima da tabela: criar, editar ou redefinir a senha de alguém.
  type Modo = { tipo: "novo" } | { tipo: "editar"; usuario: UsuarioGerenciado } | { tipo: "senha"; usuario: UsuarioGerenciado };

  let usuarios = $state<UsuarioGerenciado[]>([]);
  let carregando = $state(false);
  let carregou = $state(false);
  let erro = $state<string | null>(null);
  let busca = $state("");

  let modo = $state<Modo | null>(null);
  let salvando = $state(false);
  let mostrarSenha = $state(false);

  let nome = $state("");
  let login = $state("");
  let senha = $state("");
  // Perfil escolhido no formulário. O proprietário não aparece aqui: ele vem da migração e não muda por esta página.
  let perfil = $state<"usuario" | "admin">("usuario");

  // Senha gerada pelo servidor: aparece uma única vez, e só aqui.
  let senhaGerada = $state<{ nome: string; senha: string } | null>(null);

  const meuId = $derived(sessao.usuario?.id);
  const termo = $derived(normalizarTexto(busca).trim());
  const visiveis = $derived(
    usuarios.filter((u) => !termo || normalizarTexto(`${u.nome} ${u.login}`).includes(termo)),
  );
  const totalAdmins = $derived(usuarios.filter((u) => u.admin && u.ativo).length);

  $effect(() => {
    if (ativo) carregar();
  });

  async function carregar() {
    carregando = true;
    erro = null;
    try {
      usuarios = await api.usuarios();
      carregou = true;
    } catch (falha) {
      erro = falha instanceof Error ? falha.message : "Não foi possível carregar os usuários.";
    } finally {
      carregando = false;
    }
  }

  function mostrarFalha(falha: unknown, padrao: string) {
    mostrarAviso("erro", falha instanceof Error ? falha.message : padrao);
  }

  function abrir(novoModo: Modo) {
    modo = novoModo;
    senha = "";
    mostrarSenha = false;
    if (novoModo.tipo === "novo") {
      nome = "";
      login = "";
      perfil = "usuario";
    } else if (novoModo.tipo === "editar") {
      nome = novoModo.usuario.nome;
      login = novoModo.usuario.login;
      perfil = novoModo.usuario.admin ? "admin" : "usuario";
    }
  }

  function fechar() {
    modo = null;
    senha = "";
    mostrarSenha = false;
  }

  async function salvar(evento: SubmitEvent) {
    evento.preventDefault();
    if (!modo || salvando) return;
    salvando = true;
    try {
      if (modo.tipo === "novo") {
        const criado = await api.criarUsuario({ nome, login, senha, admin: perfil === "admin" });
        mostrarAviso("ok", `Usuário ${criado.nome} criado.`);
      } else if (modo.tipo === "editar") {
        await api.atualizarUsuario(modo.usuario.id, { nome, login, admin: perfil === "admin" });
        mostrarAviso("ok", "Usuário atualizado.");
      } else {
        await api.redefinirSenha(modo.usuario.id, { senha });
        mostrarAviso("ok", `Senha de ${modo.usuario.nome} redefinida. As sessões dela foram encerradas.`);
      }
      fechar();
      await carregar();
    } catch (falha) {
      mostrarFalha(falha, "Não foi possível salvar.");
    } finally {
      salvando = false;
    }
  }

  // Redefinição com senha gerada pelo servidor. Também serve para criar a conta e entregar a senha depois.
  async function gerarSenhaPara(usuario: UsuarioGerenciado) {
    if (salvando) return;
    salvando = true;
    try {
      const resposta = await api.redefinirSenha(usuario.id, { gerar: true });
      if (resposta.senha) senhaGerada = { nome: usuario.nome, senha: resposta.senha };
      fechar();
    } catch (falha) {
      mostrarFalha(falha, "Não foi possível gerar a senha.");
    } finally {
      salvando = false;
    }
  }

  // Sugere uma senha forte no formulário de novo usuário. Fica visível para quem cria poder anotá-la.
  function sugerirSenha() {
    const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const sorteio = crypto.getRandomValues(new Uint32Array(12));
    const letras = Array.from(sorteio, (valor) => alfabeto[valor % alfabeto.length]);
    senha = [letras.slice(0, 4), letras.slice(4, 8), letras.slice(8, 12)].map((g) => g.join("")).join("-");
    mostrarSenha = true;
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      mostrarAviso("ok", "Senha copiada.");
    } catch {
      mostrarAviso("erro", "Não foi possível copiar. Selecione a senha e copie manualmente.");
    }
  }

  async function alternarAtivo(usuario: UsuarioGerenciado) {
    const desativar = usuario.ativo;
    if (
      desativar &&
      !confirm(`Desativar ${usuario.nome}? Ela perde o acesso e as sessões abertas são encerradas agora.`)
    ) {
      return;
    }
    try {
      await api.atualizarUsuario(usuario.id, { ativo: !desativar });
      mostrarAviso("ok", desativar ? `${usuario.nome} foi desativado.` : `${usuario.nome} foi reativado.`);
      await carregar();
    } catch (falha) {
      mostrarFalha(falha, "Não foi possível alterar a situação.");
    }
  }

  async function excluir(usuario: UsuarioGerenciado) {
    if (!confirm(`Excluir ${usuario.nome} (${usuario.login})? Essa ação não pode ser desfeita.`)) return;
    try {
      await api.excluirUsuario(usuario.id);
      mostrarAviso("ok", `${usuario.nome} foi excluído.`);
      await carregar();
    } catch (falha) {
      mostrarFalha(falha, "Não foi possível excluir o usuário.");
    }
  }

  const ehEu = (usuario: UsuarioGerenciado) => usuario.id === meuId;
</script>

<section class="painel">
  <div class="cabecalho-painel">
    <div>
      <h2>Usuários</h2>
      <p>Quem pode entrar no painel e com qual perfil. Só o proprietário vê esta página.</p>
    </div>
    <div class="cabecalho-acoes">
      <button type="button" class="botao" onclick={() => abrir({ tipo: "novo" })} disabled={modo?.tipo === "novo"}>
        Novo usuário
      </button>
    </div>
  </div>

  {#if erro}
    <p class="mensagem mensagem-erro" role="alert">{erro}</p>
  {/if}

  {#if senhaGerada}
    <div class="senha-gerada painel-interno" role="status">
      <div>
        <strong>Nova senha de {senhaGerada.nome}</strong>
        <p class="texto-suave">Anote ou copie agora: ela não aparece de novo.</p>
      </div>
      <code class="codigo senha-valor">{senhaGerada.senha}</code>
      <div class="acoes-formulario">
        <button type="button" class="botao" onclick={() => copiar(senhaGerada!.senha)}>Copiar senha</button>
        <button type="button" class="botao-secundario" onclick={() => (senhaGerada = null)}>Já anotei</button>
      </div>
    </div>
  {/if}

  {#if modo}
    <form class="formulario-usuario painel-interno" onsubmit={salvar} novalidate>
      <h3>
        {#if modo.tipo === "novo"}Novo usuário
        {:else if modo.tipo === "editar"}Editar {modo.usuario.nome}
        {:else}Redefinir a senha de {modo.usuario.nome}{/if}
      </h3>

      {#if modo.tipo !== "senha"}
        <div class="campos-usuario">
          <label class="rotulo">
            Nome
            <input bind:value={nome} maxlength="120" autocomplete="off" required />
          </label>
          <label class="rotulo">
            Login
            <input bind:value={login} maxlength="120" autocomplete="off" placeholder="nome.sobrenome@empresa.com.br" required />
          </label>
        </div>
        <div class="campo-perfil">
          <label class="rotulo">
            Perfil
            <select bind:value={perfil} disabled={modo.tipo === "editar" && modo.usuario.proprietario}>
              <option value="usuario">Usuário: só consulta</option>
              <option value="admin">Administrador: altera tudo, menos a página Usuários</option>
            </select>
          </label>
          {#if modo.tipo === "editar" && modo.usuario.proprietario}
            <p class="texto-suave">O proprietário tem todas as funcionalidades e não pode ser rebaixado.</p>
          {:else}
            <p class="texto-suave">A página Usuários é só do proprietário e não pode ser dada a outro perfil.</p>
          {/if}
        </div>
      {/if}

      {#if modo.tipo !== "editar"}
        <div class="campo-senha">
          <label class="rotulo">
            {modo.tipo === "novo" ? "Senha inicial" : "Nova senha"}
            <span class="entrada-senha">
              <input
                type={mostrarSenha ? "text" : "password"}
                bind:value={senha}
                minlength="8"
                maxlength="128"
                autocomplete="new-password"
                placeholder="Pelo menos 8 caracteres"
              />
              <button type="button" class="botao-secundario" onclick={() => (mostrarSenha = !mostrarSenha)}>
                {mostrarSenha ? "Ocultar" : "Mostrar"}
              </button>
            </span>
          </label>
          {#if modo.tipo === "novo"}
            <button type="button" class="botao-secundario" onclick={sugerirSenha}>Sugerir senha forte</button>
          {/if}
        </div>
      {/if}

      <div class="acoes-formulario">
        {#if modo.tipo === "senha"}
          {@const alvo = modo.usuario}
          <button type="button" class="botao-secundario" onclick={() => gerarSenhaPara(alvo)} disabled={salvando}>
            Gerar senha automática
          </button>
        {/if}
        <button type="button" class="botao-secundario" onclick={fechar}>Cancelar</button>
        <button type="submit" class="botao" disabled={salvando}>
          {salvando ? "Salvando..." : modo.tipo === "novo" ? "Criar usuário" : modo.tipo === "editar" ? "Salvar" : "Definir senha"}
        </button>
      </div>
    </form>
  {/if}

  {#if carregou && usuarios.length > 0}
    <div class="filtros-usuarios distancia">
      <label class="rotulo">
        Buscar
        <input type="search" bind:value={busca} placeholder="Nome ou login" />
      </label>
      <p class="resumo texto-suave" aria-live="polite">
        <strong class="codigo">{usuarios.length}</strong> usuário(s) ·
        <strong class="codigo">{totalAdmins}</strong> administrador(es) ativo(s)
      </p>
    </div>
  {/if}

  {#if carregando && !carregou}
    <p class="texto-suave distancia" aria-busy="true">Carregando usuários...</p>
  {:else if carregou && visiveis.length === 0}
    <p class="texto-suave distancia">Nenhum usuário encontrado.</p>
  {:else if visiveis.length > 0}
    <div class="tabela-wrap distancia">
      <table class="tabela tabela-responsiva">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Login</th>
            <th>Perfil</th>
            <th>Situação</th>
            <th>Criado em</th>
            <th class="numerico">Ações</th>
          </tr>
        </thead>
        <tbody use:cascata={`${visiveis.length}|${busca}`}>
          {#each visiveis as usuario (usuario.id)}
            <tr>
              <td class="titulo-cartao">
                <strong>{usuario.nome}</strong>
                {#if ehEu(usuario)}
                  <span class="chip chip-epi">Você</span>
                {/if}
              </td>
              <td data-rotulo="Login" class="codigo">{usuario.login}</td>
              <td data-rotulo="Perfil">
                {#if usuario.proprietario}
                  <span class="chip chip-epc">Proprietário</span>
                {:else if usuario.admin}
                  <span class="chip chip-epi">Administrador</span>
                {:else}
                  <span class="chip">Usuário</span>
                {/if}
              </td>
              <td data-rotulo="Situação">
                {#if usuario.ativo}
                  <span class="chip chip-ok">Ativo</span>
                {:else}
                  <span class="chip chip-atencao">Desativado</span>
                {/if}
              </td>
              <td data-rotulo="Criado em" class="codigo">{formatarData(usuario.criadoEm.slice(0, 10))}</td>
              <td data-rotulo="Ações">
                <div class="acoes-linha">
                  <button type="button" class="botao-secundario" onclick={() => abrir({ tipo: "editar", usuario })}>Editar</button>
                  <button type="button" class="botao-secundario" onclick={() => abrir({ tipo: "senha", usuario })}>Senha</button>
                  <button
                    type="button"
                    class="botao-secundario"
                    onclick={() => alternarAtivo(usuario)}
                    disabled={usuario.ativo && (ehEu(usuario) || usuario.proprietario)}
                    title={usuario.ativo && ehEu(usuario) ? "Você não pode desativar a sua própria conta." : undefined}
                  >
                    {usuario.ativo ? "Desativar" : "Reativar"}
                  </button>
                  <button
                    type="button"
                    class="botao-perigo"
                    onclick={() => excluir(usuario)}
                    disabled={ehEu(usuario) || usuario.proprietario}
                    title={ehEu(usuario) ? "Você não pode excluir a sua própria conta." : undefined}
                  >
                    Excluir
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .cabecalho-acoes {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .formulario-usuario,
  .senha-gerada {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 18px;
  }

  .formulario-usuario h3 {
    margin: 0;
  }

  .campos-usuario {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 14px;
  }

  .campo-perfil {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 520px;
  }

  .campo-perfil p {
    margin: 0;
    font-size: 0.88rem;
  }

  .campo-senha {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
  }

  .campo-senha .rotulo {
    flex: 1 1 280px;
  }

  .entrada-senha {
    display: flex;
    gap: 8px;
  }

  .entrada-senha input {
    flex: 1;
    min-width: 0;
  }

  .acoes-formulario {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 10px;
  }

  .senha-valor {
    align-self: flex-start;
    padding: 10px 14px;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda-forte);
    border-radius: var(--raio-etiqueta);
    font-size: 1.25rem;
    letter-spacing: 0.06em;
    user-select: all;
  }

  .filtros-usuarios {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    align-items: end;
    gap: 14px;
  }

  .resumo {
    margin: 0;
    padding-bottom: 10px;
    font-size: 0.92rem;
  }

  .acoes-linha {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  @media (max-width: 640px) {
    .acoes-linha {
      justify-content: flex-start;
    }

    .entrada-senha {
      flex-direction: column;
    }
  }
</style>
