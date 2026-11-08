<script lang="ts">
  import type { Licence } from "@skolia/shared/api";
  import { LICENCES, LICENCE_INFO, MAX_AUTHOR_LENGTH, MAX_SOURCE_LENGTH, isShareable } from "@skolia/shared/api";

  /** A text's licence, author, source and whether it's shared in Explore, for Upload and
   * for editing a text. ownWork: the uploader wrote it, so they're its author. */
  let {
    licence = $bindable(),
    ownWork = $bindable(),
    author = $bindable(),
    source = $bindable(),
    share = $bindable(),
  }: { licence: Licence | ""; ownWork: boolean; author: string; source: string; share: boolean } = $props();

  const shareable = $derived(licence !== "" && isShareable(licence));
</script>

<fieldset>
  <legend>Where it's from</legend>
  <label>
    Licence
    <select bind:value={licence} required>
      <option value="" disabled>Choose a licence</option>
      {#each LICENCES.filter((l) => l !== "unknown") as l (l)}
        <option value={l}>{LICENCE_INFO[l].label}</option>
      {/each}
    </select>
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={ownWork} />
    I wrote this text
  </label>
  {#if !ownWork}
    <label>
      <span>Author <span class="muted">(optional)</span></span>
      <input bind:value={author} maxlength={MAX_AUTHOR_LENGTH} />
    </label>
  {/if}
  <label>
    <span>Source URL <span class="muted">(optional)</span></span>
    <input type="url" bind:value={source} placeholder="https://" maxlength={MAX_SOURCE_LENGTH} />
  </label>
  <label class="check" class:muted={!shareable}>
    <input type="checkbox" bind:checked={share} disabled={!shareable} />
    Share it in Explore. I confirm the text is under the licence above.
  </label>
  {#if licence !== "" && !shareable}
    <p class="muted small">Only public domain and Creative Commons texts can be shared. This one stays private to you.</p>
  {/if}
</fieldset>
