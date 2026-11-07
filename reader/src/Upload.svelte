<script lang="ts">
  import type { Lang, User } from "@skolia/shared/api";
  import { LANGS, MAX_TEXT_LENGTH } from "@skolia/shared/api";
  import { LANGUAGES } from "./lang/index.ts";
  import { importDocument, signIn } from "./lib/api.ts";

  let { user }: { user: User | null | undefined } = $props();

  let title = $state("");
  let text = $state("");
  let lang = $state<Lang>("pl");
  let importing = $state(false);
  let error = $state<string | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    importing = true;
    try {
      const summary = await importDocument({ title, text, lang });
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
            <option value={code} lang={code}>{LANGUAGES[code].flag} {LANGUAGES[code].endonym}</option>
          {/each}
        </select>
      </div>
      <textarea
        bind:value={text}
        {lang}
        placeholder={`Paste ${LANGUAGES[lang].name} text here`}
        rows="14"
        maxlength={MAX_TEXT_LENGTH}
        required
      ></textarea>
      <div class="row end">
        <span class="muted small">{text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}</span>
        <button type="submit" class="primary" disabled={importing || title.trim() === "" || text.trim() === ""}>
          {importing ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  {/if}
</main>
