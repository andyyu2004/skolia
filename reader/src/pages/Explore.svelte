<script lang="ts">
  import type { AvailableTag, DocumentKey, DocumentSummary, Lang, User } from "@skolia/shared/api";
  import type { Cursor } from "@skolia/shared/page";
  import { LANGS, LANGUAGE_INFO, LICENCE_INFO } from "@skolia/shared/api";
  import { listDocuments, listTags, type DocumentQuery } from "../lib/api.ts";
  import { tagLabel } from "../lib/tags.ts";
  import TagFilter from "../components/TagFilter.svelte";
  import { badge } from "../lib/reading.ts";
  import Page from "../components/Page.svelte";

  let { user }: { user: User | null | undefined } = $props();

  /** How long typing in the search waits before it asks for the list again. */
  const SEARCH_DELAY_MS = 250;

  /** The pages loaded so far, null while the first loads. */
  let documents = $state<readonly DocumentSummary[] | null>(null);
  /** The cursor for the page after them, null when they're all of them. */
  let next = $state<Cursor<DocumentKey> | null>(null);
  let loadingMore = $state(false);
  let error = $state<string | null>(null);
  let query = $state("");
  let title = $state("");
  let lang = $state<Lang | "all">("all");
  let importer = $state<"all" | "mine">("all");
  /** The tags kept, as kind:value: any of one kind, all of the kinds. */
  let tagged = $state<readonly string[]>([]);
  let available = $state<readonly AvailableTag[]>([]);
  let tagsError = $state<string | null>(null);

  const request = $derived<DocumentQuery>({ lang: lang === "all" ? undefined : lang, title, mine: importer === "mine", tags: [...tagged] });
  const filtered = $derived(request.lang !== undefined || request.title.trim() !== "" || request.tags.length > 0);

  /** Bumped by each new query, so a page for an older one isn't added to the list. */
  let generation = 0;

  $effect(() => {
    if (!user && importer === "mine") importer = "all";
  });

  $effect(() => {
    const typed = query;
    const timer = setTimeout(() => (title = typed), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

  $effect(() => {
    // Without them there's no tag filter, but the list still works
    listTags().then(
      (t) => (available = t),
      (e: unknown) => (tagsError = e instanceof Error ? e.message : String(e)),
    );
  });

  $effect(() => {
    const asked = request;
    const mine = ++generation;
    error = null;
    listDocuments(asked).then(
      (page) => {
        if (mine !== generation) return;
        documents = page.items;
        next = page.next;
      },
      (e: unknown) => {
        if (mine === generation) error = e instanceof Error ? e.message : String(e);
      },
    );
  });

  async function more(): Promise<void> {
    if (next === null || loadingMore) return;
    const mine = generation;
    loadingMore = true;
    try {
      const page = await listDocuments(request, next);
      if (mine !== generation) return;
      documents = [...(documents ?? []), ...page.items];
      next = page.next;
    } catch (e: unknown) {
      if (mine === generation) error = e instanceof Error ? e.message : String(e);
    } finally {
      loadingMore = false;
    }
  }
</script>

<Page title="Explore" wide>
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
            {documents.length.toLocaleString()}{next === null ? "" : "+"} {documents.length === 1 && next === null ? "text" : "texts"}
          {/if}
        </span>
        <select class={{ active: lang !== "all" }} bind:value={lang} aria-label="Language">
          <option value="all">All languages</option>
          {#each LANGS as code (code)}
            <option value={code} lang={code}>{LANGUAGE_INFO[code].flag} {LANGUAGE_INFO[code].endonym}</option>
          {/each}
        </select>
        <select class={{ active: importer !== "all" }} bind:value={importer} aria-label="Imported by">
          <option value="all">Anyone</option>
          {#if user}
            <option value="mine">You</option>
          {/if}
        </select>
        <TagFilter {available} error={tagsError} bind:selected={tagged} />
      </div>

      {#if documents === null}
        <p class="empty">Loading…</p>
      {:else if documents.length === 0}
        <p class="empty">
          {#if filtered}
            No texts match.
          {:else if importer === "mine"}
            You haven't imported anything yet. <a href="#/upload">Upload a text</a>.
          {:else}
            Nothing imported yet.
          {/if}
        </p>
      {:else}
        <ul class="entries">
          {#each documents as doc (`${doc.id}/${doc.importer.id}`)}
            {@const status = badge(doc)}
            <li>
              <a class="entry" href={`#/doc/${doc.id}`}>
                <span class="entry-head">
                  <span class="entry-title" lang={doc.lang}>{doc.title}</span>
                  {#if doc.visibility === "private"}
                    <span class="badge">private</span>
                  {/if}
                  {#if status}
                    <span class={["badge", { failed: status.failed }]}>{status.text}</span>
                  {/if}
                  {#each Object.entries(doc.tags) as [kind, value] (kind)}
                    <span class="badge tag">{tagLabel({ kind, value })}</span>
                  {/each}
                </span>
                <span class="entry-meta">
                  <span>{LANGUAGE_INFO[doc.lang].flag} {LANGUAGE_INFO[doc.lang].name}</span>
                  {#if doc.author}
                    <span class="entry-author">{doc.author}</span>
                  {/if}
                  <span>{doc.words.toLocaleString()} {doc.words === 1 ? "word" : "words"}</span>
                  <span>imported by {doc.mine ? "you" : doc.importer.name}</span>
                  <span>{dateFormat.format(new Date(doc.imported))}</span>
                </span>
                <span class="licence">{LICENCE_INFO[doc.licence].short}</span>
              </a>
            </li>
          {/each}
        </ul>
        {#if next !== null}
          <div class="more">
            <button type="button" onclick={more} disabled={loadingMore}>{loadingMore ? "Loading…" : "More"}</button>
          </div>
        {/if}
      {/if}
    </section>
  {/if}
</Page>

<style>
  .error {
    color: var(--error);
  }

  .search {
    position: relative;
    display: block;
    margin-bottom: 1rem;
  }

  .search svg {
    position: absolute;
    left: 0.85rem;
    top: 50%;
    width: 1.1rem;
    height: 1.1rem;
    translate: 0 -50%;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.8;
    stroke-linecap: round;
    pointer-events: none;
  }

  .search input {
    width: 100%;
    height: 2.5rem;
    padding: 0 1rem 0 2.5rem;
    border-radius: 8px;
    box-shadow: var(--card-shadow);
  }

  .listing {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--card-shadow);
  }

  /* Rounded here rather than clipped by .listing, so the tag menu can hang below it */
  .listing-head {
    border-radius: 10px 10px 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    padding: 0.4rem 0.6rem 0.4rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }

  .listing-count {
    margin-right: auto;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .listing-head select {
    padding: 0.3rem 1.6rem 0.3rem 0.6rem;
    border-color: transparent;
    background-color: transparent;
    background-position: right 0.45rem center;
    background-size: 0.75rem;
    color: var(--muted);
    font-size: 0.9rem;
    field-sizing: content;
  }

  .listing-head select:hover {
    border-color: transparent;
    background-color: var(--surface);
    color: var(--text);
  }

  .listing-head select.active {
    color: var(--accent);
    font-weight: 600;
  }

  .empty {
    margin: 0;
    padding: 3rem 1rem;
    color: var(--muted);
    text-align: center;
  }

  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .entries li + li {
    border-top: 1px solid var(--line);
  }

  .entry {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.3rem 1rem;
    padding: 0.75rem 1rem;
    color: inherit;
    text-decoration: none;
  }

  .entry:hover {
    background: var(--bg);
  }

  .entries li:last-child .entry {
    border-radius: 0 0 10px 10px;
  }

  .more {
    display: flex;
    justify-content: center;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--line);
  }

  .entry:hover .entry-title {
    color: var(--accent);
  }

  .entry:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .entry-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    grid-column: 1;
  }

  .entry-title {
    margin-right: 0.2rem;
    font-family: var(--reading);
    font-size: 1.1rem;
    font-weight: 600;
    line-height: 1.3;
  }

  .badge {
    font-size: 0.8rem;
    padding: 0.05rem 0.45rem;
    border-radius: 99px;
    background: var(--line);
  }

  .badge.tag {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    font-weight: 600;
  }

  .badge.failed {
    color: var(--error);
  }

  .entry-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 0.45rem;
    grid-column: 1;
    color: var(--muted);
    font-size: 0.8rem;
  }

  .entry-meta > span:not(:last-child)::after {
    content: "·";
    margin-left: 0.45rem;
  }

  .entry-author {
    font-style: italic;
  }

  .licence {
    grid-column: 2;
    grid-row: 1 / span 2;
    padding: 0.05rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 4px;
    color: var(--muted);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  @media (max-width: 600px) {
    .entry {
      grid-template-columns: 1fr;
    }

    .licence {
      grid-column: 1;
      grid-row: auto;
      justify-self: start;
    }
  }
</style>
