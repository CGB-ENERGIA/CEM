<script lang="ts">
  import type { Equipe } from "../tipos";

  // Só prefixo e tipo são usados na busca, então o app de campo também pode usar este componente.
  type EquipeBusca = Pick<Equipe, "prefixo" | "tipoId">;

  interface Props {
    valor?: string;
    equipes: EquipeBusca[];
    nomeTipo: (id: string | null) => string;
    id?: string;
    aoSelecionar?: (equipe: EquipeBusca) => void;
  }

  let { valor = $bindable(""), equipes, nomeTipo, id = "busca-equipe", aoSelecionar }: Props = $props();

  const LIMITE_SUGESTOES = 50;

  let aberto = $state(false);
  let destacado = $state(0);

  const consulta = $derived(valor.trim().toUpperCase());

  // Prefixos que começam com o texto digitado vêm antes dos que apenas contêm.
  const sugestoes = $derived(
    equipes
      .filter((equipe) => equipe.prefixo.includes(consulta))
      .sort((a, b) => {
        const inicioA = a.prefixo.startsWith(consulta) ? 0 : 1;
        const inicioB = b.prefixo.startsWith(consulta) ? 0 : 1;
        return inicioA - inicioB || a.prefixo.localeCompare(b.prefixo);
      })
      .slice(0, LIMITE_SUGESTOES),
  );

  const indiceAtivo = $derived(Math.min(destacado, Math.max(0, sugestoes.length - 1)));

  function selecionar(equipe: EquipeBusca) {
    valor = equipe.prefixo;
    aberto = false;
    aoSelecionar?.(equipe);
  }

  function aoDigitar() {
    aberto = true;
    destacado = 0;
  }

  function teclar(evento: KeyboardEvent) {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      if (!aberto) {
        aberto = true;
        return;
      }
      destacado = Math.min(sugestoes.length - 1, indiceAtivo + 1);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      destacado = Math.max(0, indiceAtivo - 1);
    } else if (evento.key === "Enter" && aberto && sugestoes.length > 0) {
      // Com a lista aberta, Enter escolhe a sugestão em vez de enviar o formulário.
      evento.preventDefault();
      selecionar(sugestoes[indiceAtivo]);
    } else if (evento.key === "Escape") {
      aberto = false;
    }
  }
</script>

<div class="busca">
  <input
    {id}
    type="text"
    role="combobox"
    autocomplete="off"
    spellcheck="false"
    maxlength="20"
    placeholder="Ex.: 1234"
    class="codigo"
    required
    bind:value={valor}
    oninput={aoDigitar}
    onfocus={() => (aberto = true)}
    onblur={() => (aberto = false)}
    onkeydown={teclar}
    aria-autocomplete="list"
    aria-expanded={aberto}
    aria-controls={`${id}-lista`}
    aria-activedescendant={aberto && sugestoes.length > 0 ? `${id}-opcao-${indiceAtivo}` : undefined}
    aria-label="Prefixo da equipe"
  />

  {#if aberto}
    <ul class="sugestoes" id={`${id}-lista`} role="listbox" aria-label="Equipes cadastradas">
      {#each sugestoes as equipe, indice (equipe.prefixo)}
        <li
          id={`${id}-opcao-${indice}`}
          role="option"
          aria-selected={indice === indiceAtivo}
          class="sugestao"
          class:ativa={indice === indiceAtivo}
          onmousedown={(evento) => {
            // Evita que o campo perca o foco antes da seleção.
            evento.preventDefault();
            selecionar(equipe);
          }}
          onmouseenter={() => (destacado = indice)}
        >
          <span class="codigo prefixo">{equipe.prefixo}</span>
          <span class="tipo">{nomeTipo(equipe.tipoId)}</span>
        </li>
      {:else}
        <li class="sugestao vazio" role="presentation">
          {#if consulta}
            Nenhuma equipe com esse prefixo. Ao registrar, ela será cadastrada com o tipo escolhido.
          {:else}
            Nenhuma equipe cadastrada ainda. Digite o prefixo para cadastrar.
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .busca {
    position: relative;
  }

  .busca input {
    width: 100%;
  }

  .sugestoes {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 30;
    max-height: min(320px, 50vh);
    margin: 0;
    padding: 6px;
    list-style: none;
    overflow-y: auto;
    background: var(--superficie-elevada);
    border: 1px solid var(--borda-forte);
    border-radius: var(--raio);
    box-shadow: var(--sombra-envio);
  }

  .sugestao {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
  }

  .sugestao.ativa {
    background: var(--primaria-suave);
  }

  .sugestao .prefixo {
    font-weight: 500;
    color: var(--tinta);
  }

  .sugestao .tipo {
    font-size: 0.88rem;
    color: var(--tinta-suave);
    text-align: right;
  }

  .sugestao.vazio {
    display: block;
    cursor: default;
    font-size: 0.9rem;
    color: var(--tinta-suave);
  }

  .sugestao.vazio:hover {
    background: transparent;
  }
</style>
