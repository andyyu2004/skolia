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

  const id = $props.id();
  const shareable = $derived(licence !== "" && isShareable(licence));
  const licenceUrl = $derived(licence === "" ? null : LICENCE_INFO[licence].url);
</script>

<div class="field">
  <label for="{id}-licence">Licence</label>
  <select id="{id}-licence" bind:value={licence} required>
    <option value="" disabled>Choose a licence</option>
    {#each LICENCES.filter((l) => l !== "unknown") as l (l)}
      <option value={l}>{LICENCE_INFO[l].label}</option>
    {/each}
  </select>
  {#if licence !== "" && licenceUrl}
    <p class="hint"><a href={licenceUrl} target="_blank" rel="license noreferrer">What {LICENCE_INFO[licence].short} allows</a></p>
  {/if}
</div>

<div class="field">
  <div class="field-label">
    <label for="{id}-author">Author <span class="optional">optional</span></label>
    <label class="check">
      <input type="checkbox" bind:checked={ownWork} />
      I wrote it
    </label>
  </div>
  {#if ownWork}
    <input id="{id}-author" placeholder="You" disabled />
  {:else}
    <input id="{id}-author" bind:value={author} maxlength={MAX_AUTHOR_LENGTH} />
  {/if}
</div>

<div class="field">
  <label for="{id}-source">Source <span class="optional">optional</span></label>
  <input id="{id}-source" type="url" bind:value={source} placeholder="https://" maxlength={MAX_SOURCE_LENGTH} />
</div>

<fieldset class="field">
  <legend>Visibility</legend>
  <div class="choices">
    <label class="choice">
      <input type="radio" name="{id}-visibility" checked={!(share && shareable)} onchange={() => (share = false)} />
      <span>
        <strong>Private</strong>
        <span class="hint">Left out of Explore. Anyone with its link can still open it.</span>
      </span>
    </label>
    <label class="choice" class:disabled={!shareable}>
      <input
        type="radio"
        name="{id}-visibility"
        checked={share && shareable}
        disabled={!shareable}
        onchange={() => (share = true)}
      />
      <span>
        <strong>Public</strong>
        <span class="hint">Listed in Explore. You confirm the text is under the licence above.</span>
      </span>
    </label>
  </div>
  {#if licence !== "" && !shareable}
    <p class="hint">Only public domain and Creative Commons texts can be shared.</p>
  {/if}
</fieldset>
