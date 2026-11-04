<script lang="ts">
  import { tema } from "../tema.svelte";
</script>

<!-- Ícone do alternador de tema: sol no tema escuro (para ir ao claro), lua no claro. -->
{#if tema.atual === "escuro"}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8" />
    <path
      d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      fill="none"
    />
  </svg>
{:else}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linejoin="round"
      fill="none"
    />
  </svg>
{/if}
