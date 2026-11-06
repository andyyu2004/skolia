<script lang="ts">
  import type { DocumentSummary, Lang, User } from "@skolia/shared/api";
  import { LANGS, MAX_TEXT_LENGTH } from "@skolia/shared/api";
  import { LANGUAGES } from "./lang/index.ts";
  import { currentUser, importDocument, listDocuments, signIn, signOut } from "./lib/api.ts";
  import { badge } from "./lib/reading.ts";

  let user = $state<User | null | undefined>(undefined);
  let documents = $state<DocumentSummary[] | null>(null);
  let error = $state<string | null>(null);
  let title = $state("");
  let text = $state("");
  let lang = $state<Lang>("pl");
  let importing = $state(false);

  async function refresh(): Promise<void> {
    try {
      documents = await listDocuments();
      error = null;
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

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

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    void refresh();
    void run(async () => {
      user = await currentUser();
    });
  });
</script>

<main class="library">
  <header>
    <h1>skolia</h1>
    {#if user}
      <span class="account">
        <span class="muted">{user.name}</span>
        <button
          type="button"
          onclick={() =>
            run(async () => {
              await signOut();
              user = null;
            })}>Sign out</button
        >
      </span>
    {:else if user === null}
      <button type="button" onclick={() => run(signIn)}>Sign in with Google</button>
    {/if}
  </header>

  <section>
    <h2>Import a text</h2>
    <form onsubmit={submit}>
      <input bind:value={title} placeholder="Title (optional)" maxlength="200" />
      <select bind:value={lang} aria-label="Language">
        {#each LANGS as code (code)}
          <option value={code}>{LANGUAGES[code].name}</option>
        {/each}
      </select>
      <textarea
        bind:value={text}
        {lang}
        placeholder={`Paste ${LANGUAGES[lang].name} text here`}
        rows="8"
        maxlength={MAX_TEXT_LENGTH}
        required
      ></textarea>
      <button type="submit" disabled={importing || text.trim() === ""}>
        {importing ? "Importing…" : "Import"}
      </button>
    </form>
  </section>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <section>
    <h2>Your texts</h2>
    {#if documents === null}
      <p class="muted">Loading…</p>
    {:else if documents.length === 0}
      <p class="muted">Nothing imported yet.</p>
    {:else}
      <ul class="documents">
        {#each documents as doc (doc.id)}
          <li>
            <a href={`#/doc/${doc.id}`}>{doc.title}</a>
            <span class="muted">{LANGUAGES[doc.lang].name} · {doc.words} words</span>
            {#if badge(doc)}
              {@const shown = badge(doc)}
              <span class="badge" class:failed={shown?.failed}>{shown?.text}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>
