<script lang="ts">
  import type { DocumentSummary, Lang, User } from "@skolia/shared/api";
  import { LANGS, LANGUAGE_INFO, LICENCE_INFO } from "@skolia/shared/api";
  import { listDocuments } from "./lib/api.ts";
  import { badge } from "./lib/reading.ts";

  let { user }: { user: User | null | undefined } = $props();

  let documents = $state<DocumentSummary[] | null>(null);
  let error = $state<string | null>(null);
  let query = $state("");
  let lang = $state<Lang | "all">("all");
  let importer = $state<"all" | "mine" | `by:${string}`>("all");

  const importers = $derived(
    [...new Set((documents ?? []).filter((d) => !d.mine).map((d) => d.importerName))].sort((a, b) => a.localeCompare(b)),
  );

  function byImporter(d: DocumentSummary): boolean {
    if (importer === "all") return true;
    if (importer === "mine") return d.mine;
    return !d.mine && `by:${d.importerName}` === importer;
  }

  $effect(() => {
    if (!user && importer === "mine") importer = "all";
  });

  const shown = $derived.by(() => {
    const q = query.trim().toLocaleLowerCase();
    return (documents ?? []).filter(
      (d) => (lang === "all" || d.lang === lang) && byImporter(d) && (q === "" || d.title.toLocaleLowerCase().includes(q)),
    );
  });

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

  $effect(() => {
    listDocuments().then(
      (d) => (documents = d),
      (e: unknown) => (error = e instanceof Error ? e.message : String(e)),
    );
  });
</script>

<main class="container explore">
  <h1>Explore</h1>

  <label class="search">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4.5 4.5" /></svg>
    <input type="search" bind:value={query} placeholder="Search titles" aria-label="Search titles" />
  </label>

  {#if error}
    <p class="error">{error}</p>
  {:else}
    <section class="listing">
      <div class="listing-head">
        <span class="listing-count">
          {#if documents}
            {shown.length.toLocaleString()} {shown.length === 1 ? "text" : "texts"}
          {/if}
        </span>
        <select class="quiet" bind:value={lang} aria-label="Language" class:active={lang !== "all"}>
          <option value="all">All languages</option>
          {#each LANGS as code (code)}
            <option value={code} lang={code}>{LANGUAGE_INFO[code].flag} {LANGUAGE_INFO[code].endonym}</option>
          {/each}
        </select>
        <select class="quiet" bind:value={importer} aria-label="Imported by" class:active={importer !== "all"}>
          <option value="all">Anyone</option>
          {#if user}
            <option value="mine">You</option>
          {/if}
          {#each importers as name (name)}
            <option value={`by:${name}`}>{name}</option>
          {/each}
        </select>
      </div>

      {#if documents === null}
        <p class="listing-empty muted">Loading…</p>
      {:else if shown.length === 0}
        <p class="listing-empty muted">
          {#if documents.length === 0}
            Nothing imported yet.
          {:else if importer === "mine" && !documents.some((d) => d.mine)}
            You haven't imported anything yet. <a href="#/upload">Upload a text</a>.
          {:else}
            No texts match.
          {/if}
        </p>
      {:else}
        <ul class="entries">
          {#each shown as doc (doc.id)}
            {@const status = badge(doc)}
            <li>
              <a class="entry" href={`#/doc/${doc.id}`}>
                <span class="entry-head">
                  <span class="entry-title" lang={doc.lang}>{doc.title}</span>
                  {#if doc.visibility === "private"}
                    <span class="badge">private</span>
                  {/if}
                  {#if status}
                    <span class="badge" class:failed={status.failed}>{status.text}</span>
                  {/if}
                </span>
                <span class="entry-meta">
                  <span>{LANGUAGE_INFO[doc.lang].flag} {LANGUAGE_INFO[doc.lang].name}</span>
                  {#if doc.author}
                    <span class="entry-author">{doc.author}</span>
                  {/if}
                  <span>{doc.words.toLocaleString()} {doc.words === 1 ? "word" : "words"}</span>
                  <span>imported by {doc.mine ? "you" : doc.importerName}</span>
                  <span>{dateFormat.format(new Date(doc.imported))}</span>
                </span>
                <span class="licence">{LICENCE_INFO[doc.licence].short}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</main>
