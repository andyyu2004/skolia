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
  let whose = $state<"all" | "mine">("all");

  const shown = $derived.by(() => {
    const q = query.trim().toLocaleLowerCase();
    return (documents ?? []).filter(
      (d) =>
        (lang === "all" || d.lang === lang) &&
        (whose === "all" || !user || d.mine) &&
        (q === "" || d.title.toLocaleLowerCase().includes(q)),
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
        <option value={code} lang={code}>{LANGUAGE_INFO[code].flag} {LANGUAGE_INFO[code].endonym}</option>
      {/each}
    </select>
    {#if user}
      <select bind:value={whose} aria-label="Whose texts">
        <option value="all">All texts</option>
        <option value="mine">Your texts</option>
      </select>
    {/if}
    <input type="search" bind:value={query} placeholder="Search titles" aria-label="Search titles" />
  </div>

  {#if error}
    <p class="error">{error}</p>
  {:else if documents === null}
    <p class="muted">Loading…</p>
  {:else if shown.length === 0}
    <p class="muted">
      {#if documents.length === 0}
        Nothing imported yet.
      {:else if whose === "mine" && !documents.some((d) => d.mine)}
        You haven't imported anything yet. <a href="#/upload">Upload a text</a>.
      {:else}
        No texts match.
      {/if}
    </p>
  {:else}
    <ul class="cards">
      {#each shown as doc (doc.id)}
        {@const status = badge(doc)}
        <li>
          <a class="card" href={`#/doc/${doc.id}`}>
            <span class="card-title">{doc.title}</span>
            <span class="muted small">
              {LANGUAGE_INFO[doc.lang].name} · {doc.words.toLocaleString()} {doc.words === 1 ? "word" : "words"} · {doc.importerName} ·
              {dateFormat.format(new Date(doc.imported))} · {LICENCE_INFO[doc.licence].short}
            </span>
            {#if doc.visibility === "private"}
              <span class="badge">private</span>
            {/if}
            {#if status}
              <span class="badge" class:failed={status.failed}>{status.text}</span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
