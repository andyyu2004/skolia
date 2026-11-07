<script lang="ts">
  import type { DocumentSummary, Lang } from "@skolia/shared/api";
  import { LANGS } from "@skolia/shared/api";
  import { LANGUAGES } from "./lang/index.ts";
  import { listDocuments } from "./lib/api.ts";
  import { badge } from "./lib/reading.ts";

  let documents = $state<DocumentSummary[] | null>(null);
  let error = $state<string | null>(null);
  let query = $state("");
  let lang = $state<Lang | "all">("all");

  const shown = $derived.by(() => {
    const q = query.trim().toLocaleLowerCase();
    return (documents ?? []).filter(
      (d) => (lang === "all" || d.lang === lang) && (q === "" || d.title.toLocaleLowerCase().includes(q)),
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

<main class="container">
  <h1>Explore</h1>

  <div class="filters">
    <select bind:value={lang} aria-label="Language">
      <option value="all">All languages</option>
      {#each LANGS as code (code)}
        <option value={code} lang={code}>{LANGUAGES[code].flag} {LANGUAGES[code].endonym}</option>
      {/each}
    </select>
    <input type="search" bind:value={query} placeholder="Search titles" aria-label="Search titles" />
  </div>

  {#if error}
    <p class="error">{error}</p>
  {:else if documents === null}
    <p class="muted">Loading…</p>
  {:else if shown.length === 0}
    <p class="muted">{documents.length === 0 ? "Nothing imported yet." : "No texts match."}</p>
  {:else}
    <ul class="cards">
      {#each shown as doc (doc.id)}
        {@const status = badge(doc)}
        <li>
          <a class="card" href={`#/doc/${doc.id}`}>
            <span class="card-title">{doc.title}</span>
            <span class="muted small">
              {LANGUAGES[doc.lang].name} · {doc.words.toLocaleString()} {doc.words === 1 ? "word" : "words"} · {doc.importerName} ·
              {dateFormat.format(new Date(doc.imported))}
            </span>
            {#if status}
              <span class="badge" class:failed={status.failed}>{status.text}</span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
