<script lang="ts">
  import type { Licence } from "@skolia/shared/api";
  import { LICENCES, LICENCE_INFO, MAX_AUTHOR_LENGTH, MAX_SOURCE_LENGTH, isShareable } from "@skolia/shared/api";
  import Field from "./Field.svelte";

  /** A text's licence, author, source and whether it's shared in Explore, for Upload and
   * for editing a text. ownWork: the uploader wrote it, so they're its author. */
  let {
    licence = $bindable(),
    ownWork = $bindable(),
    author = $bindable(),
    source = $bindable(),
    share = $bindable(),
  }: { licence: Licence | ""; ownWork: boolean; author: string; source: string; share: boolean } = $props();

  const id = $props.id();
  const shareable = $derived(licence !== "" && isShareable(licence));
  const licenceUrl = $derived(licence === "" ? null : LICENCE_INFO[licence].url);
</script>

{#snippet allows()}
  {#if licence !== "" && licenceUrl}
    <a href={licenceUrl} target="_blank" rel="license noreferrer">What {LICENCE_INFO[licence].short} allows</a>
  {/if}
{/snippet}

{#snippet onlyFree()}
  Only public domain and Creative Commons texts can be shared.
{/snippet}

<Field label="Licence" for="{id}-licence" hint={licenceUrl ? allows : undefined}>
  <select id="{id}-licence" bind:value={licence} required>
    <option value="" disabled>Choose a licence</option>
    {#each LICENCES.filter((l) => l !== "unknown") as l (l)}
      <option value={l}>{LICENCE_INFO[l].label}</option>
    {/each}
  </select>
</Field>

<Field label="Author" for="{id}-author" optional>
  {#snippet aside()}
    <label class="check"> <input type="checkbox" bind:checked={ownWork}> I wrote it </label>
  {/snippet}
  {#if ownWork}
    <input id="{id}-author" placeholder="You" disabled>
  {:else}
    <input id="{id}-author" bind:value={author} maxlength={MAX_AUTHOR_LENGTH}>
  {/if}
</Field>

<Field label="Source" for="{id}-source" optional>
  <input id="{id}-source" type="url" bind:value={source} placeholder="https://" maxlength={MAX_SOURCE_LENGTH}>
</Field>

<Field label="Visibility" hint={licence !== "" && !shareable ? onlyFree : undefined}>
  <div class="choices">
    <label class="choice">
      <input type="radio" name="{id}-visibility" checked={!(share && shareable)} onchange={() => (share = false)}>
      <span>
        <strong>Private</strong>
        <span class="hint">Left out of Explore. Anyone with its link can still open it.</span>
      </span>
    </label>
    <label class={["choice", { disabled: !shareable }]}>
      <input type="radio" name="{id}-visibility" checked={share && shareable} disabled={!shareable} onchange={() => (share = true)}>
      <span>
        <strong>Public</strong>
        <span class="hint">Listed in Explore. You confirm the text is under the licence above.</span>
      </span>
    </label>
  </div>
</Field>

<style>
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.6rem;
  }

  .choice {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }

  .choice > span {
    display: grid;
    gap: 0.15rem;
  }

  .choice input {
    margin: 0.2rem 0 0;
    accent-color: var(--accent);
  }

  .choice:hover:not(.disabled) {
    border-color: color-mix(in srgb, var(--line) 50%, var(--muted));
  }

  .choice:has(input:checked) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--current) 60%, var(--surface));
  }

  .choice:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .choice.disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .hint {
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
