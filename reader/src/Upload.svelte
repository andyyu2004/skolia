<script lang="ts">
  import type { Lang, Licence, User } from "@skolia/shared/api";
  import { LANGS, LANGUAGE_INFO, MAX_TEXT_LENGTH, isShareable } from "@skolia/shared/api";
  import { importDocument, signIn } from "./lib/api.ts";
  import SourceFields from "./SourceFields.svelte";

  let { user }: { user: User | null | undefined } = $props();

  let title = $state("");
  let text = $state("");
  let lang = $state<Lang>("pl");
  let licence = $state<Licence | "">("");
  let ownWork = $state(false);
  let author = $state("");
  let source = $state("");
  let share = $state(false);
  let importing = $state(false);
  let error = $state<string | null>(null);

  const shareable = $derived(licence !== "" && isShareable(licence));
  const ready = $derived(title.trim() !== "" && text.trim() !== "" && licence !== "");

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (licence === "" || !user) return;
    importing = true;
    try {
      const by = ownWork ? user.name : author.trim();
      const summary = await importDocument({
        title,
        text,
        lang,
        licence,
        visibility: share && shareable ? "public" : "private",
        ...(by === "" ? {} : { author: by }),
        ...(source.trim() === "" ? {} : { source: source.trim() }),
      });
      location.hash = `#/doc/${summary.id}`;
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      importing = false;
    }
  }
</script>

<main class="container">
  <h1>Upload</h1>
  {#if user === null}
    <p class="muted">Sign in to upload a text.</p>
    <button type="button" class="primary" onclick={() => void signIn()}>Sign in</button>
  {:else if user}
    <form class="upload" onsubmit={submit}>
      <div class="row">
        <input bind:value={title} placeholder="Title" aria-label="Title" maxlength="200" required />
        <select bind:value={lang} aria-label="Language">
          {#each LANGS as code (code)}
            <option value={code} lang={code}>{LANGUAGE_INFO[code].flag} {LANGUAGE_INFO[code].endonym}</option>
          {/each}
        </select>
      </div>
      <textarea
        bind:value={text}
        {lang}
        placeholder={`Paste ${LANGUAGE_INFO[lang].name} text here`}
        rows="14"
        maxlength={MAX_TEXT_LENGTH}
        required
      ></textarea>
      <div class="muted small count">{text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}</div>

      <SourceFields bind:licence bind:ownWork bind:author bind:source bind:share />

      <div class="row end">
        <button type="submit" class="primary" disabled={importing || !ready}>
          {importing ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  {/if}
</main>
