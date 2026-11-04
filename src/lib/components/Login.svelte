<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { alternarTema, tema } from "../tema.svelte";
  import IconeTema from "./IconeTema.svelte";
  import type { Usuario } from "../sessao.svelte";

  interface Props {
    aoEntrar: (usuario: Usuario) => void;
  }

  let { aoEntrar }: Props = $props();

  let login = $state("");
  let senha = $state("");
  let mostrarSenha = $state(false);
  let enviando = $state(false);
  let erro = $state<string | null>(null);
  let capsLock = $state(false);

  function verCapsLock(evento: KeyboardEvent) {
    capsLock = evento.getModifierState("CapsLock");
  }

  // Ao corrigir o que foi digitado, o erro some e os campos voltam ao normal.
  function limparErro() {
    erro = null;
  }

  let stage: HTMLElement | undefined = $state();

  // Com movimento reduzido, os vídeos não tocam: ficam as capas.
  const reduzir = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  onMount(() => {
    if (!stage || reduzir) return;
    const vids = Array.from(stage.querySelectorAll<HTMLVideoElement>("video"));

    // Os dois vídeos começam juntos, depois que ambos estão prontos para tocar.
    const prontos = vids.map(
      (v) =>
        new Promise<void>((resolver) => {
          if (v.readyState >= 4) resolver();
          else v.addEventListener("canplaythrough", () => resolver(), { once: true });
        }),
    );
    Promise.all(prontos).then(() => {
      vids.forEach((v) => {
        v.currentTime = 0;
      });
      vids.forEach((v) => v.play().catch(() => {}));
    });

    // Pausa quando a aba fica oculta e retoma ao voltar.
    const aoMudarVisibilidade = () =>
      vids.forEach((v) => (document.hidden ? v.pause() : v.play().catch(() => {})));
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  });

  async function entrar(evento: SubmitEvent) {
    evento.preventDefault();
    if (enviando) return;

    erro = null;
    enviando = true;
    try {
      const usuario = await api.entrar(login.trim(), senha);
      aoEntrar(usuario);
    } catch (falha) {
      erro = falha instanceof Error ? falha.message : "Não foi possível entrar. Tente de novo.";
      senha = "";
    } finally {
      enviando = false;
    }
  }
</script>

<div class="login" data-tema={tema.atual === "escuro" ? "escuro" : "claro"}>
  <!-- Fundo decorativo: some para leitores de tela -->
  <div class="stage" bind:this={stage} aria-hidden="true">
    <div class="half half--topo">
      <video muted loop playsinline preload="metadata" disablepictureinpicture tabindex="-1" poster="/media/poster-topo.jpg">
        <source src="/media/video-topo.mp4" type="video/mp4" />
        <source src="/media/video-topo.webm" type="video/webm" />
      </video>
    </div>
    <div class="half half--base">
      <video muted loop playsinline preload="metadata" disablepictureinpicture tabindex="-1" poster="/media/poster-base.jpg">
        <source src="/media/video-base.mp4" type="video/mp4" />
        <source src="/media/video-base.webm" type="video/webm" />
      </video>
    </div>
    <div class="tint"></div>
    <svg class="diag" viewBox="0 0 100 100" preserveAspectRatio="none">
      <line x1="0" y1="100" x2="100" y2="0" />
    </svg>
  </div>

  <button
    class="theme"
    type="button"
    onclick={alternarTema}
    aria-label={tema.atual === "escuro" ? "Ativar tema claro" : "Ativar tema escuro"}
  >
    <IconeTema />
  </button>

  <main>
    <form class="card" onsubmit={entrar} novalidate>
      <div class="brand">
        <b>CEM</b>
        <span>Consulta de Equipamentos e Materiais</span>
      </div>
      <h1>Entrar</h1>

      <div class="field">
        <label for="login">Login</label>
        <input
          id="login"
          bind:value={login}
          oninput={limparErro}
          placeholder="Usuário ou e-mail"
          type="text"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          disabled={enviando}
          aria-invalid={erro !== null}
        />
      </div>

      <div class="field">
        <label for="senha">Senha</label>
        <div class="row">
          <input
            id="senha"
            bind:value={senha}
            oninput={limparErro}
            onkeydown={verCapsLock}
            onkeyup={verCapsLock}
            onblur={() => (capsLock = false)}
            aria-describedby={capsLock ? "aviso-caps" : undefined}
            type={mostrarSenha ? "text" : "password"}
            autocomplete="current-password"
            required
            disabled={enviando}
            aria-invalid={erro !== null}
          />
          <button
            class="icon-btn"
            type="button"
            aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={mostrarSenha}
            onclick={() => (mostrarSenha = !mostrarSenha)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"
                stroke="currentColor"
                stroke-width="1.8"
                fill="none"
                stroke-linejoin="round"
              />
              <circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="1.8" fill="none" />
              {#if mostrarSenha}
                <path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              {/if}
            </svg>
          </button>
        </div>
        {#if capsLock}
          <p class="aviso-caps" id="aviso-caps">Caps Lock está ativado.</p>
        {/if}
      </div>

      {#if erro}
        <p class="erro" role="alert">{erro}</p>
      {/if}

      <button class="submit" type="submit" disabled={enviando || !login.trim() || !senha}>
        {enviando ? "Verificando" : "Entrar"}
      </button>
      <p class="note">Acesso restrito a usuários autorizados.</p>
    </form>
  </main>
</div>

<style>
  /* Usa os mesmos tokens do app, então o tema claro e o escuro valem também para o login. */
  .login {
    --bg: var(--fundo);
    --card: var(--superficie-elevada);
    --line: var(--borda);
    --field: var(--superficie);
    --text: var(--tinta);
    --muted: var(--tinta-suave);
    --accent: var(--primaria);
    --on-accent: var(--primaria-tinta);
    --tint: color-mix(in srgb, var(--fundo) 50%, transparent);
    --diag: 2px;
    --erro: var(--falta-texto);
    --aviso: var(--tinta-suave);

    position: fixed;
    inset: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--fonte-texto);
  }

  /* ---------- fundo: duas metades cortadas na diagonal ---------- */
  .stage {
    position: fixed;
    inset: 0;
    overflow: hidden;
    z-index: 0;
  }

  .half {
    position: absolute;
    inset: 0;
  }

  .half video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* diagonal de canto a canto: do canto inferior esquerdo ao superior direito */
  .half--topo {
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }

  .half--base {
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
  }

  /* a ação de cada vídeo fica num canto; isto mantém o canto certo à vista em telas de proporção diferente */
  .half--topo video {
    object-position: 15% 40%;
  }

  .half--base video {
    object-position: 85% 65%;
  }

  .tint {
    position: absolute;
    inset: 0;
    background: var(--tint);
  }

  .diag {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .diag line {
    stroke: var(--accent);
    stroke-width: var(--diag);
    vector-effect: non-scaling-stroke;
  }

  /* ---------- card ---------- */
  main {
    position: relative;
    z-index: 1;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 16px;
  }

  .card {
    width: min(500px, 100%);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--raio);
    padding: 36px 38px 30px;
    box-shadow: var(--sombra);
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 30px;
  }

  .brand b {
    font: 700 30px/1 "Barlow Condensed", sans-serif;
    letter-spacing: 0.02em;
  }

  .brand span {
    color: var(--muted);
    font-size: 15px;
  }

  h1 {
    margin: 0 0 24px;
    font: 700 40px/1 "Barlow Condensed", sans-serif;
    color: var(--text);
  }

  label {
    display: block;
    margin: 0 0 8px;
    color: var(--muted);
    font: 600 15px/1 "Barlow Condensed", sans-serif;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .field {
    margin-bottom: 20px;
  }

  .row {
    display: flex;
    gap: 10px;
  }

  input {
    width: 100%;
    height: 54px;
    padding: 0 14px;
    background: var(--field);
    color: var(--text);
    border: 1px solid transparent;
    border-radius: 6px;
    font: 400 17px "Barlow", sans-serif;
  }

  input::placeholder {
    color: var(--muted);
    opacity: 0.75;
  }

  /* Campo com erro: borda vermelha, além da mensagem */
  input[aria-invalid="true"] {
    border-color: var(--erro);
  }

  .aviso-caps {
    margin: 8px 0 0;
    font-size: 14px;
    color: var(--aviso);
  }

  input:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .icon-btn {
    flex: 0 0 50px;
    height: 50px;
    align-self: center;
    margin-top: 2px;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 6px;
    cursor: pointer;
  }

  .icon-btn[aria-pressed="true"] {
    color: var(--accent);
  }

  .submit {
    width: 100%;
    height: 68px;
    margin-top: 4px;
    background: var(--accent);
    color: var(--on-accent);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    font: 600 20px "Barlow Condensed", sans-serif;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transition: filter 0.15s, opacity 0.15s;
  }

  .submit:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .erro {
    margin: 0 0 16px;
    padding: 10px 12px;
    background: var(--falta-suave);
    color: var(--falta-texto);
    border: 1px solid var(--falta);
    border-radius: 6px;
    font-size: 0.95rem;
  }

  .note {
    margin: 24px 0 0;
    text-align: center;
    color: var(--muted);
    font-size: 15px;
  }

  .theme {
    position: fixed;
    top: 14px;
    right: 14px;
    z-index: 2;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    cursor: pointer;
    background: color-mix(in srgb, var(--card) 85%, transparent);
    color: var(--text);
    border: 1px solid var(--line);
    backdrop-filter: blur(6px);
  }

  .theme:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (max-width: 520px) {
    .card {
      padding: 28px 20px 24px;
    }

    h1 {
      font-size: 34px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .submit {
      transition: none;
    }
  }
</style>
