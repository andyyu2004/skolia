<script lang="ts">
  import { untrack } from "svelte";
  import type { DocumentSummary, Licence } from "@skolia/shared/api";
  import { MAX_TITLE_LENGTH, isShareable } from "@skolia/shared/api";
  import { deleteDocument, updateDocument } from "./lib/api.ts";
  import SourceFields from "./SourceFields.svelte";

  /** The importer changes a text's title, licence, author, source and whether it's
   * shared, or deletes it. */
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
  let error = $state<string | null>(null);

  const shareable = $derived(licence !== "" && isShareable(licence));
  const ready = $derived(title.trim() !== "" && licence !== "");

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
    if (!confirm(`Delete “${summary.title}”? It's gone for everyone, and links to it stop working.`)) return;
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

<form class="upload edit" onsubmit={save}>
  <input bind:value={title} placeholder="Title" aria-label="Title" maxlength={MAX_TITLE_LENGTH} required />
  <SourceFields bind:licence bind:ownWork bind:author bind:source bind:share />
  <div class="row">
    <button type="button" class="quiet danger" disabled={busy} onclick={() => void remove()}>Delete</button>
    <span class="spacer"></span>
    <button type="button" class="quiet" disabled={busy} onclick={oncancel}>Cancel</button>
    <button type="submit" class="primary" disabled={busy || !ready}>{busy ? "Saving…" : "Save"}</button>
  </div>
  {#if error}
    <p class="error">{error}</p>
  {/if}
</form>
