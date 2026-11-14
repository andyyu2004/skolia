<script lang="ts">
  import { createInfiniteQuery, createQuery, keepPreviousData } from "@tanstack/svelte-query";
  import type { DocumentKey, DocumentSummary, Lang, ReadingKey, ReadingStatus, User } from "@skolia/shared/api";
  import type { Cursor } from "@skolia/shared/page";
  import { LANGS, LANGUAGE_INFO, LICENCE_INFO, READING_STATUSES } from "@skolia/shared/api";
  import { listDocuments, listReading, type DocumentQuery } from "../lib/api.ts";
  import { READING_STATUS_LABELS, listKey } from "../lib/reading-list.ts";
  import ReadingStatusMenu from "../components/ReadingStatusMenu.svelte";
  import { tagsQuery } from "../lib/queries.ts";
  import { tagLabel } from "../lib/tags.ts";
  import TagFilter from "../components/TagFilter.svelte";
  import { badge } from "../lib/reading.ts";
  import Page from "../components/Page.svelte";

  let { user }: { user: User | null | undefined } = $props();

  /** How long typing in the search waits before it asks for the list again. */
  const SEARCH_DELAY_MS = 250;

  let query = $state("");
  let title = $state("");
  let lang = $state<Lang | "all">("all");
  /** Every text the filters keep, those the user imported, or those with a status on their reading list. */
  let shown = $state<"all" | "mine" | ReadingStatus>("all");
  const shelf = $derived(READING_STATUSES.find((s) => s === shown) ?? null);
  /** The tags kept, as kind:value: any of one kind, all of the kinds. */
  let tagged = $state<readonly string[]>([]);

  const request = $derived<DocumentQuery>({ lang: lang === "all" ? undefined : lang, title, mine: shown === "mine", tags: [...tagged] });
  const filtered = $derived(request.lang !== undefined || request.title.trim() !== "" || request.tags.length > 0);

  // Without them there's no tag filter, but the list still works
  const tags = createQuery(() => tagsQuery);

  /** A new query's list shows the last one's until it comes. */
  const everything = createInfiniteQuery(() => ({
    queryKey: ["documents", request] as const,
    queryFn: ({ queryKey: [, asked], pageParam }) => listDocuments(asked, pageParam),
    initialPageParam: undefined as Cursor<DocumentKey> | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    placeholderData: keepPreviousData,
    enabled: shelf === null,
  }));
  const onList = createInfiniteQuery(() => ({
    queryKey: listKey(shelf ?? "to-read", request.lang),
    queryFn: ({ queryKey: [, , , status, inLang], pageParam }) => listReading(status, inLang, pageParam),
    initialPageParam: undefined as Cursor<ReadingKey> | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    placeholderData: keepPreviousData,
    enabled: shelf !== null && !!user,
  }));
  const listing = $derived(shelf === null ? everything : onList);
  /** The pages loaded so far, each text with its status on the list when that's what's
   * shown; undefined while the first loads. */
  const documents = $derived<readonly { readonly doc: DocumentSummary; readonly status: ReadingStatus | null }[] | undefined>(
    shelf === null
      ? everything.data?.pages.flatMap((page) => page.items.map((doc) => ({ doc, status: null })))
      : onList.data?.pages.flatMap((page) => page.items.map(({ document, status }) => ({ doc: document, status }))),
  );

  $effect(() => {
    if (!user && shown !== "all") shown = "all";
  });

  $effect(() => {
    const typed = query;
    const timer = setTimeout(() => (title = typed), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
</script>

<Page title="Explore" wide>
  {#if shelf === null}
    <label class="search">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4.5 4.5" /></svg>
      <input type="search" bind:value={query} placeholder="Search titles" aria-label="Search titles" />
    </label>
  {/if}

  {#if listing.error}
    <p class="error">{listing.error.message}</p>
  {:else}
    <section class="listing">
      <div class="listing-head">
        <span class="listing-count">
          {#if documents}
            {documents.length.toLocaleString()}{listing.hasNextPage ? "+" : ""} {documents.length === 1 && !listing.hasNextPage ? "text" : "texts"}
          {/if}
        </span>
        <select class={{ active: lang !== "all" }} bind:value={lang} aria-label="Language">
          <option value="all">All languages</option>
          {#each LANGS as code (code)}
            <option value={code} lang={code}>{LANGUAGE_INFO[code].flag} {LANGUAGE_INFO[code].endonym}</option>
          {/each}
        </select>
        <select class={{ active: shown !== "all" }} bind:value={shown} aria-label="Show">
          <option value="all">All texts</option>
          {#if user}
            <option value="mine">Imported by you</option>
            <optgroup label="My list">
              {#each READING_STATUSES as s (s)}
                <option value={s}>{READING_STATUS_LABELS[s]}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
        {#if shelf === null}
          <TagFilter available={tags.data ?? []} error={tags.error?.message ?? null} bind:selected={tagged} />
        {/if}
      </div>

      {#if documents === undefined}
        <p class="empty">Loading…</p>
      {:else if documents.length === 0}
        <p class="empty">
          {#if shelf !== null}
            Nothing {READING_STATUS_LABELS[shelf].toLowerCase()}{request.lang ? ` in ${LANGUAGE_INFO[request.lang].name}` : ""}. Add a text
            from its page.
          {:else if filtered}
            No texts match.
          {:else if shown === "mine"}
            You haven't imported anything yet. <a href="#/upload">Upload a text</a>.
          {:else}
            Nothing imported yet.
          {/if}
        </p>
      {:else}
        <ul class="entries">
          {#each documents as { doc, status: onListAs } (`${doc.id}/${doc.importer.id}`)}
            {@const status = badge(doc)}
            <li class={{ "with-status": onListAs !== null }}>
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
              {#if onListAs !== null}
                <ReadingStatusMenu id={doc.id} status={onListAs} />
              {/if}
            </li>
          {/each}
        </ul>
        {#if listing.hasNextPage}
          <div class="more">
            <button type="button" onclick={() => void listing.fetchNextPage()} disabled={listing.isFetchingNextPage || listing.isPlaceholderData}
              >{listing.isFetchingNextPage ? "Loading…" : "More"}</button
            >
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

  .entries li.with-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    padding-right: 1rem;
  }

  .with-status .entry {
    flex: 1 1 20rem;
    min-width: 0;
  }

  @media (max-width: 600px) {
    .entries li.with-status {
      padding: 0 1rem 0.75rem;
    }

    .with-status .entry {
      padding: 0.75rem 0 0.4rem;
    }
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
