<script lang="ts">
  import { fly } from "svelte/transition";
  import { avisos, fecharAviso } from "../avisos.svelte";
  import { entrarAviso } from "../actions/animar";

  const rotulos = { ok: "Feito", erro: "Atenção", info: "Aviso" } as const;
</script>

<div class="pilha" aria-live="polite">
  {#each avisos.lista as aviso (aviso.id)}
    <div class="aviso" data-tipo={aviso.tipo} role={aviso.tipo === "erro" ? "alert" : "status"} use:entrarAviso out:fly={{ x: 40, duration: 220 }}>
      <span class="chip" class:chip-ok={aviso.tipo === "ok"} class:chip-erro={aviso.tipo === "erro"}>
        {rotulos[aviso.tipo]}
      </span>
      <p class="texto">{aviso.texto}</p>
      <button type="button" class="fechar" aria-label="Fechar aviso" onclick={() => fecharAviso(aviso.id)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
        </svg>
      </button>
    </div>
  {/each}
</div>

<style>
  .pilha {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(380px, calc(100vw - 32px));
    pointer-events: none;
  }

  .aviso {
    pointer-events: auto;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: start;
    padding: 12px 12px 12px 14px;
    background: var(--superficie-elevada);
    color: var(--tinta);
    border: 1px solid var(--borda-forte);
    border-radius: var(--raio-etiqueta);
    box-shadow: var(--sombra-envio);
  }

  .aviso[data-tipo="erro"] {
    border-color: var(--tinta);
  }

  .chip-erro {
    background: var(--tinta);
    color: var(--superficie-elevada);
  }

  .aviso .chip {
    margin-top: 1px;
  }

  .texto {
    font-size: 0.95rem;
    line-height: 1.4;
    padding-top: 1px;
  }

  .fechar {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: -8px -8px -8px 0;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--tinta-suave);
  }

  .fechar:hover {
    color: var(--tinta);
    border-color: var(--borda);
  }

  /* No celular, os avisos descem do topo, logo abaixo do cabeçalho. Assim não cobrem a barra de abas
     nem a barra de envio, que ficam na parte de baixo da tela. */
  @media (max-width: 640px) {
    .pilha {
      top: calc(var(--altura-topo) + 10px);
      right: 12px;
      left: 12px;
      bottom: auto;
      width: auto;
    }
  }
</style>
