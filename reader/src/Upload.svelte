<script lang="ts">
  import type { Lang, Licence, User } from "@skolia/shared/api";
  import { LANGS, LANGUAGE_INFO, MAX_TEXT_LENGTH, isShareable } from "@skolia/shared/api";
  import { importDocument, signIn } from "./lib/api.ts";
  import Button from "./Button.svelte";
  import Field from "./Field.svelte";
  import Page from "./Page.svelte";
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

<Page title="Upload">
  {#if user === null}
    <p class="muted">Sign in to upload a text.</p>
    <Button variant="primary" onclick={() => void signIn()}>Sign in</Button>
  {:else if user}
    <form onsubmit={submit}>
      <section class="panel">
        <div class="pair">
          <Field label="Title" for="upload-title">
            <input id="upload-title" bind:value={title} maxlength="200" required />
          </Field>
          <Field label="Language" for="upload-lang">
            <select id="upload-lang" bind:value={lang} required>
              <option value="" disabled>Choose a language</option>
              {#each LANGS as code (code)}
                <option value={code} lang={code}>{LANGUAGE_INFO[code].flag} {LANGUAGE_INFO[code].endonym}</option>
              {/each}
            </select>
          </Field>
        </div>
        <Field label="Text" for="upload-text">
          {#snippet aside()}
            <span class="count">{text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}</span>
          {/snippet}
          <textarea
            id="upload-text"
            bind:value={text}
            lang={lang || undefined}
            placeholder={lang === "" ? "Paste the text here" : `Paste ${LANGUAGE_INFO[lang].name} text here`}
            rows="14"
            maxlength={MAX_TEXT_LENGTH}
            required
          ></textarea>
        </Field>
      </section>

      <section class="panel">
        <h2>Provenance</h2>
        <SourceFields bind:licence bind:ownWork bind:author bind:source bind:share />
      </section>

      {#if error}
        <p class="error">{error}</p>
      {/if}
      <div class="actions">
        <Button type="submit" variant="primary" disabled={importing || !ready}>
          {importing ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  {/if}
</Page>

<style>
  form {
    display: grid;
    gap: 1rem;
  }

  .panel {
    display: grid;
    gap: 1.1rem;
    padding: 1.25rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--card-shadow);
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr minmax(9rem, auto);
    gap: 0.75rem;
  }

  @media (max-width: 500px) {
    .pair {
      grid-template-columns: 1fr;
    }
  }

  .count {
    color: var(--muted);
    font-size: 0.8rem;
  }

  textarea {
    width: 100%;
    resize: vertical;
    line-height: 1.5;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  .muted {
    color: var(--muted);
  }

  .error {
    color: var(--error);
  }
</style>
