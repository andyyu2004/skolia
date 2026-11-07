<script lang="ts">
  import type { Lang, Licence, User } from "@skolia/shared/api";
  import { LANGS, LICENCES, MAX_AUTHOR_LENGTH, MAX_SOURCE_LENGTH, MAX_TEXT_LENGTH, isShareable } from "@skolia/shared/api";
  import { LANGUAGES } from "./lang/index.ts";
  import { importDocument, signIn } from "./lib/api.ts";
  import { LICENCE_INFO } from "./lib/licence.ts";

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
      <div class="muted small count">{text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}</div>

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
          <p class="muted small">
            Only public domain and Creative Commons texts can be shared. This one stays private to you.
          </p>
        {/if}
      </fieldset>

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
