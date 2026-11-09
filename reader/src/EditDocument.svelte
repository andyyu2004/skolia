<script lang="ts">
  import { untrack } from "svelte";
  import type { DocumentSummary, Licence } from "@skolia/shared/api";
  import { MAX_TITLE_LENGTH, isShareable } from "@skolia/shared/api";
  import { deleteDocument, updateDocument } from "./lib/api.ts";
  import Button from "./Button.svelte";
  import Field from "./Field.svelte";
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
      <Button variant="icon" aria-label="Close" onclick={() => dialog?.close()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </Button>
    </header>

    <div class="modal-body">
      <Field label="Title" for="edit-title">
        <input id="edit-title" bind:value={title} maxlength={MAX_TITLE_LENGTH} required />
      </Field>
      <SourceFields bind:licence bind:ownWork bind:author bind:source bind:share />

      <div class="danger-zone">
        {#if confirmingDelete}
          <div>
            <strong>Delete “{summary.title}”?</strong>
            <p class="hint">It's gone for everyone, and links to it stop working. This can't be undone.</p>
          </div>
          <div class="danger-actions">
            <Button variant="quiet" disabled={busy} onclick={() => (confirmingDelete = false)}>Keep it</Button>
            <Button variant="destructive" disabled={busy} onclick={() => void remove()}>Delete</Button>
          </div>
        {:else}
          <div>
            <strong>Delete this text</strong>
            <p class="hint">It's gone for everyone, and links to it stop working.</p>
          </div>
          <Button variant="danger" disabled={busy} onclick={() => (confirmingDelete = true)}>Delete…</Button>
        {/if}
      </div>

      {#if error}
        <p class="error">{error}</p>
      {/if}
    </div>

    <footer class="modal-foot">
      <Button variant="quiet" disabled={busy} onclick={() => dialog?.close()}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={busy || !ready}>{busy && !confirmingDelete ? "Saving…" : "Save"}</Button>
    </footer>
  </form>
</dialog>

<style>
  .modal {
    width: min(34rem, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100dvh - 2 * var(--gutter));
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.25);
  }

  .modal::backdrop {
    background: rgb(20 15 10 / 0.45);
    backdrop-filter: blur(2px);
  }

  form {
    display: flex;
    flex-direction: column;
    max-height: inherit;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .modal-head,
  .modal-foot {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 0.75rem 0.75rem 1.25rem;
  }

  .modal-head {
    justify-content: space-between;
    border-bottom: 1px solid var(--line);
  }

  .modal-foot {
    justify-content: flex-end;
    padding-right: 1.25rem;
    border-top: 1px solid var(--line);
    background: var(--bg);
  }

  .modal-body {
    display: grid;
    gap: 1.1rem;
    padding: 1.25rem;
    overflow-y: auto;
  }

  .danger-zone {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1rem;
    padding: 0.85rem 1rem;
    border: 1px solid color-mix(in srgb, var(--error) 40%, var(--line));
    border-radius: 8px;
  }

  .danger-zone strong {
    font-size: 0.9rem;
  }

  .danger-actions {
    display: flex;
    gap: 0.5rem;
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.8rem;
  }

  .error {
    color: var(--error);
  }
</style>
