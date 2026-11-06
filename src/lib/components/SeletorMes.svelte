<script lang="ts">
  import { mesHoje } from "../format";

  interface Props {
    // Mês no formato AAAA-MM.
    mes: string;
  }

  let { mes = $bindable() }: Props = $props();

  const noMesAtual = $derived(mes >= mesHoje());

  function deslocar(passo: number) {
    if (!/^\d{4}-\d{2}$/.test(mes)) return;
    const [ano, numeroMes] = mes.split("-").map(Number);
    const novo = new Date(ano, numeroMes - 1 + passo, 1);
    mes = `${novo.getFullYear()}-${String(novo.getMonth() + 1).padStart(2, "0")}`;
  }
</script>

{#snippet seta(direcao: "anterior" | "proximo")}
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d={direcao === "anterior" ? "M12.5 4.5 7 10l5.5 5.5" : "M7.5 4.5 13 10l-5.5 5.5"} />
  </svg>
{/snippet}

<!-- Seletor de mês com setas dos dois lados; a seta de avançar trava no mês atual. -->
<div class="seletor-mes" role="group" aria-label="Mês de referência">
  <button type="button" class="botao-secundario" aria-label="Mês anterior" onclick={() => deslocar(-1)}>
    {@render seta("anterior")}
  </button>
  <input type="month" bind:value={mes} aria-label="Mês de referência" />
  <button type="button" class="botao-secundario" aria-label="Próximo mês" disabled={noMesAtual} onclick={() => deslocar(1)}>
    {@render seta("proximo")}
  </button>
</div>

<style>
  .seletor-mes {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .seletor-mes button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    min-height: 44px;
    padding: 0;
  }
</style>
