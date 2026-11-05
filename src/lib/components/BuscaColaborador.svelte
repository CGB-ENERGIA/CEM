<script lang="ts">
  import { normalizarTexto } from "../format";

  interface Props {
    valor?: string;
    sugestoes: string[];
    id: string;
    rotulo: string;
  }

  let { valor = $bindable(""), sugestoes, id, rotulo }: Props = $props();

  const LIMITE_SUGESTOES = 8;

  let aberto = $state(false);
  let destacado = $state(0);

  const consulta = $derived(normalizarTexto(valor.trim()));

  // Nomes que começam com o texto vêm primeiro; depois, os que o contêm. Um nome igual ao digitado não aparece.
  const sugestoesVisiveis = $derived.by(() => {
    if (consulta.length === 0) return [];
    const comecam: string[] = [];
    const contem: string[] = [];
    for (const nome of sugestoes) {
      const normalizado = normalizarTexto(nome);
      if (normalizado === consulta) continue;
      if (normalizado.startsWith(consulta)) comecam.push(nome);
      else if (normalizado.includes(consulta)) contem.push(nome);
      if (comecam.length >= LIMITE_SUGESTOES) break;
    }
    return [...comecam, ...contem].slice(0, LIMITE_SUGESTOES);
  });

  const mostrar = $derived(aberto && sugestoesVisiveis.length > 0);

  function escolher(nome: string) {
    valor = nome;
    aberto = false;
    destacado = 0;
  }

  function teclas(evento: KeyboardEvent) {
    if (!mostrar) return;
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      destacado = Math.min(destacado + 1, sugestoesVisiveis.length - 1);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      destacado = Math.max(destacado - 1, 0);
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      escolher(sugestoesVisiveis[destacado]);
    } else if (evento.key === "Escape") {
      aberto = false;
    }
  }
</script>

<div class="busca-colaborador">
  <input
    {id}
    type="text"
    role="combobox"
    aria-label={rotulo}
    aria-autocomplete="list"
    aria-expanded={mostrar}
    aria-controls={`${id}-lista`}
    aria-activedescendant={mostrar ? `${id}-opcao-${destacado}` : undefined}
    autocomplete="off"
    autocapitalize="words"
    spellcheck="false"
    maxlength="120"
    placeholder="Nome completo"
    bind:value={valor}
    oninput={() => {
      aberto = true;
      destacado = 0;
    }}
    onfocus={() => (aberto = true)}
    onblur={() => (aberto = false)}
    onkeydown={teclas}
  />

  {#if mostrar}
    <ul id={`${id}-lista`} role="listbox" class="lista" aria-label={`Sugestões para ${rotulo}`}>
      {#each sugestoesVisiveis as nome, indice (nome)}
        <li
          id={`${id}-opcao-${indice}`}
          role="option"
          aria-selected={indice === destacado}
          class:destacado={indice === destacado}
          onmousedown={(evento) => {
            evento.preventDefault();
            escolher(nome);
          }}
          onmouseenter={() => (destacado = indice)}
        >
          {nome}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .busca-colaborador {
    position: relative;
    min-width: 0;
  }

  .busca-colaborador input {
    width: 100%;
  }

  .lista {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 30;
    max-height: 280px;
    overflow-y: auto;
    margin: 0;
    padding: 6px;
    list-style: none;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda-forte);
    border-radius: var(--raio);
    box-shadow: var(--sombra-envio);
  }

  .lista li {
    padding: 11px 12px;
    border-radius: var(--raio-chip);
    color: var(--tinta);
    font-size: 0.95rem;
    cursor: pointer;
  }

  .lista li.destacado {
    background: var(--primaria-suave);
    color: var(--tinta);
  }
</style>
