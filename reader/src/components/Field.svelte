<script lang="ts">
  import type { Snippet } from "svelte";

  /** A form control under its label. With `for`, the label names that control and the hint has the
   * id `{for}-hint` for aria-describedby; without it, a fieldset under a legend, for a group of
   * controls. aside sits at the label's end, such as a count or a checkbox. */
  let {
    label,
    for: id,
    optional = false,
    aside,
    hint,
    children,
  }: {
    label: string;
    for?: string;
    optional?: boolean;
    aside?: Snippet;
    hint?: Snippet | undefined;
    children: Snippet;
  } = $props();
</script>

{#snippet name()}
  {label}{#if optional}
    <span class="optional">optional</span>
  {/if}
{/snippet}

{#if id === undefined}
  <fieldset class="field">
    <legend>{@render name()}</legend>
    {@render children()}
    {#if hint}
      <p class="hint">{@render hint()}</p>
    {/if}
  </fieldset>
{:else}
  <div class="field">
    <div class="label-row">
      <label for={id}>{@render name()}</label>
      {@render aside?.()}
    </div>
    {@render children()}
    {#if hint}
      <p class="hint" id="{id}-hint">{@render hint()}</p>
    {/if}
  </div>
{/if}

<style>
  .field {
    display: grid;
    gap: 0.4rem;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  label,
  legend {
    padding: 0;
    font-size: 0.9rem;
    font-weight: 600;
  }

  legend {
    margin-bottom: 0.4rem;
  }

  .label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }

  .optional {
    margin-left: 0.25rem;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 400;
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
