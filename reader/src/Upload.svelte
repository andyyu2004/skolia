<script lang="ts">
  import type { Lang, Licence, User } from "@skolia/shared/api";
  import { LANGS, LANGUAGE_INFO, MAX_TEXT_LENGTH, isShareable } from "@skolia/shared/api";
  import { importDocument, signIn } from "./lib/api.ts";
  import SourceFields from "./SourceFields.svelte";

  let { user }: { user: User | null | undefined } = $props();

  let title = $state("");
  let text = $state("");
  let lang = $state<Lang | "">("");
  let licence = $state<Licence | "">("");
  let ownWork = $state(false);
  let author = $state("");
  let source = $state("");
  let share = $state(false);
  let importing = $state(false);
  let error = $state<string | null>(null);

  const shareable = $derived(licence !== "" && isShareable(licence));
  const ready = $derived(title.trim() !== "" && text.trim() !== "" && lang !== "" && licence !== "");

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (lang === "" || licence === "" || !user) return;
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
    <form class="form" onsubmit={submit}>
      <section class="panel">
        <div class="field-pair">
          <div class="field">
            <label for="upload-title">Title</label>
            <input id="upload-title" bind:value={title} maxlength="200" required />
          </div>
          <div class="field">
            <label for="upload-lang">Language</label>
            <select id="upload-lang" bind:value={lang} required>
              <option value="" disabled>Choose a language</option>
              {#each LANGS as code (code)}
                <option value={code} lang={code}>{LANGUAGE_INFO[code].flag} {LANGUAGE_INFO[code].endonym}</option>
              {/each}
            </select>
          </div>
        </div>
        <div class="field">
          <div class="field-label">
            <label for="upload-text">Text</label>
            <span class="hint">{text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}</span>
          </div>
          <textarea
            id="upload-text"
            bind:value={text}
            lang={lang || undefined}
            placeholder={lang === "" ? "Paste the text here" : `Paste ${LANGUAGE_INFO[lang].name} text here`}
            rows="14"
            maxlength={MAX_TEXT_LENGTH}
            required
          ></textarea>
        </div>
      </section>

      <section class="panel">
        <h2>Provenance</h2>
        <SourceFields bind:licence bind:ownWork bind:author bind:source bind:share />
      </section>

      {#if error}
        <p class="error">{error}</p>
      {/if}
      <div class="form-actions">
        <button type="submit" class="primary" disabled={importing || !ready}>
          {importing ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  {/if}
</main>
