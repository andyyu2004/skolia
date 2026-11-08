<script lang="ts">
  import { untrack } from "svelte";
  import type { DocumentSummary, Licence } from "@skolia/shared/api";
  import { MAX_TITLE_LENGTH, isShareable } from "@skolia/shared/api";
  import { deleteDocument, updateDocument } from "./lib/api.ts";
  import SourceFields from "./SourceFields.svelte";

  /** The importer changes a text's title, licence, author, source and whether it's
   * shared, or deletes it, in a modal dialog. */
  let {
    summary,
    onsaved,
    oncancel,
  }: { summary: DocumentSummary; onsaved: (summary: DocumentSummary) => void; oncancel: () => void } = $props();

  // The form starts from the summary as it is when opened
  const initial = untrack(() => summary);
  let title = $state(initial.title);
  let licence = $state<Licence | "">(initial.licence === "unknown" ? "" : initial.licence);
  let ownWork = $state(initial.author !== null && initial.author === initial.importerName);
  let author = $state(initial.author ?? "");
  let source = $state(initial.source ?? "");
  let share = $state(initial.visibility === "public");
  let busy = $state(false);
  let confirmingDelete = $state(false);
  let error = $state<string | null>(null);
  let dialog = $state<HTMLDialogElement | null>(null);

  const shareable = $derived(licence !== "" && isShareable(licence));
  const ready = $derived(title.trim() !== "" && licence !== "");

  $effect(() => {
    dialog?.showModal();
  });

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (licence === "") return;
    busy = true;
    error = null;
    try {
      const by = ownWork ? summary.importerName : author.trim();
      onsaved(
        await updateDocument(summary.id, {
          title: title.trim(),
          licence,
          author: by === "" ? null : by,
          source: source.trim() === "" ? null : source.trim(),
          visibility: share && shareable ? "public" : "private",
        }),
      );
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    busy = true;
    error = null;
    try {
      await deleteDocument(summary.id);
      location.hash = "#/";
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="modal"
  aria-labelledby="edit-heading"
  onclose={oncancel}
  onclick={(event) => {
    if (event.target === dialog && !busy) dialog?.close();
  }}
>
  <form onsubmit={save}>
    <header class="modal-head">
      <h2 id="edit-heading">Edit text</h2>
      <button type="button" class="icon" aria-label="Close" onclick={() => dialog?.close()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </button>
    </header>

    <div class="modal-body">
      <div class="field">
        <label for="edit-title">Title</label>
        <input id="edit-title" bind:value={title} maxlength={MAX_TITLE_LENGTH} required />
      </div>
      <SourceFields bind:licence bind:ownWork bind:author bind:source bind:share />

      <div class="danger-zone">
        {#if confirmingDelete}
          <div>
            <strong>Delete “{summary.title}”?</strong>
            <p class="hint">It's gone for everyone, and links to it stop working. This can't be undone.</p>
          </div>
          <div class="danger-actions">
            <button type="button" class="quiet" disabled={busy} onclick={() => (confirmingDelete = false)}>Keep it</button>
            <button type="button" class="destructive" disabled={busy} onclick={() => void remove()}>Delete</button>
          </div>
        {:else}
          <div>
            <strong>Delete this text</strong>
            <p class="hint">It's gone for everyone, and links to it stop working.</p>
          </div>
          <button type="button" class="quiet danger" disabled={busy} onclick={() => (confirmingDelete = true)}>Delete…</button>
        {/if}
      </div>

      {#if error}
        <p class="error">{error}</p>
      {/if}
    </div>

    <footer class="modal-foot">
      <button type="button" class="quiet" disabled={busy} onclick={() => dialog?.close()}>Cancel</button>
      <button type="submit" class="primary" disabled={busy || !ready}>{busy && !confirmingDelete ? "Saving…" : "Save"}</button>
    </footer>
  </form>
</dialog>
