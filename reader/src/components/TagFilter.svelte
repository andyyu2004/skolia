<script lang="ts">
  import type { AvailableTag } from "@skolia/shared/api";
  import { formatTag } from "@skolia/shared/api";
  import { byKind, tagLabel } from "../lib/tags.ts";

  /** A menu of every tag, grouped by kind, to tick the ones a list keeps: selected holds
   * them as kind:value. error: why the tags couldn't be had. */
  let {
    available,
    error = null,
    selected = $bindable(),
  }: { available: readonly AvailableTag[]; error?: string | null; selected: readonly string[] } = $props();

  let menu = $state<HTMLDetailsElement | null>(null);

  const summary = $derived.by(() => {
    if (selected.length === 0) return "Any tag";
    const [first] = selected;
    const tag = available.find((t) => formatTag(t) === first);
    return selected.length === 1 && tag ? tagLabel(tag) : `${selected.length} tags`;
  });

  function toggle(tag: string, on: boolean): void {
    selected = on ? [...selected, tag] : selected.filter((t) => t !== tag);
  }

  function closeOutside(event: MouseEvent): void {
    if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  }
</script>

<svelte:window onclick={closeOutside} onkeydown={(event) => event.key === "Escape" && menu?.open && (menu.open = false)} />

<details class="tag-filter" bind:this={menu}>
  <summary class={{ active: selected.length > 0 }} aria-label="Tags">{summary}</summary>
  <div class="menu">
    {#each byKind(available) as [kind, tags] (kind)}
      <fieldset>
        <legend>{kind}</legend>
        {#each tags as tag (formatTag(tag))}
          {@const key = formatTag(tag)}
          <label>
            <input type="checkbox" checked={selected.includes(key)} onchange={(event) => toggle(key, event.currentTarget.checked)} />
            <span class="tag">{tagLabel(tag)}</span>
            {#if tag.description}<span class="description">{tag.description}</span>{/if}
          </label>
        {/each}
      </fieldset>
    {:else}
      <p class={["none", { failed: error !== null }]}>{error === null ? "No tags yet." : `Couldn't load tags: ${error}`}</p>
    {/each}
    {#if selected.length > 0}
      <button type="button" class="clear" onclick={() => (selected = [])}>Clear</button>
    {/if}
  </div>
</details>

<style>
  .tag-filter {
    position: relative;
  }

  summary {
    padding: 0.3rem 1.6rem 0.3rem 0.6rem;
    border-radius: 6px;
    color: var(--muted);
    font-size: 0.9rem;
    list-style: none;
    cursor: pointer;
    background: var(--chevron) no-repeat right 0.45rem center / 0.75rem;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    background-color: var(--surface);
    color: var(--text);
  }

  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  summary.active {
    color: var(--accent);
    font-weight: 600;
  }

  .menu {
    position: absolute;
    right: 0;
    z-index: 10;
    display: grid;
    gap: 0.6rem;
    min-width: 15rem;
    max-width: calc(100vw - 2 * var(--gutter, 1rem));
    margin-top: 0.3rem;
    padding: 0.6rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--card-shadow);
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0 0.4rem 0.2rem;
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.4rem;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
  }

  label:hover {
    background: var(--bg);
  }

  .tag {
    font-weight: 600;
    white-space: nowrap;
  }

  .description {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .none {
    margin: 0;
    padding: 0.3rem 0.4rem;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .none.failed {
    color: var(--error);
  }

  .clear {
    justify-self: start;
    padding: 0.2rem 0.4rem;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 0.85rem;
    cursor: pointer;
  }
</style>
