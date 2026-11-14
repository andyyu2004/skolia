<script lang="ts">
  import { createInfiniteQuery, createQuery, keepPreviousData } from "@tanstack/svelte-query";
  import type { DocumentKey, Lang, User } from "@skolia/shared/api";
  import type { Cursor } from "@skolia/shared/page";
  import { LANGS, LANGUAGE_INFO } from "@skolia/shared/api";
  import { listDocuments, type DocumentQuery } from "../lib/api.ts";
  import { tagsQuery } from "../lib/queries.ts";
  import TagFilter from "../components/TagFilter.svelte";
  import DocumentList from "../components/DocumentList.svelte";
  import Page from "../components/Page.svelte";

  let { user }: { user: User | null | undefined } = $props();

  /** How long typing in the search waits before it asks for the list again. */
  const SEARCH_DELAY_MS = 250;

  let query = $state("");
  let title = $state("");
  let lang = $state<Lang | "all">("all");
  let importer = $state<"all" | "mine">("all");
  /** The tags kept, as kind:value: any of one kind, all of the kinds. */
  let tagged = $state<readonly string[]>([]);

  const request = $derived<DocumentQuery>({ lang: lang === "all" ? undefined : lang, title, mine: importer === "mine", tags: [...tagged] });
  const filtered = $derived(request.lang !== undefined || request.title.trim() !== "" || request.tags.length > 0);

  // Without them there's no tag filter, but the list still works
  const tags = createQuery(() => tagsQuery);

  /** A new query's list shows the last one's until it comes. */
  const listing = createInfiniteQuery(() => ({
    queryKey: ["documents", request] as const,
    queryFn: ({ queryKey: [, asked], pageParam }) => listDocuments(asked, pageParam),
    initialPageParam: undefined as Cursor<DocumentKey> | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    placeholderData: keepPreviousData,
  }));

  $effect(() => {
    if (!user && importer === "mine") importer = "all";
  });

  $effect(() => {
    const typed = query;
    const timer = setTimeout(() => (title = typed), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  });
</script>

<Page title="Explore" wide>
  <label class="search">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4.5 4.5" /></svg>
    <input type="search" bind:value={query} placeholder="Search titles" aria-label="Search titles" />
  </label>

  {#if listing.error}
    <p class="error">{listing.error.message}</p>
  {:else}
    <DocumentList
      documents={listing.data?.pages.flatMap((page) => page.items)}
      hasMore={listing.hasNextPage}
      loadingMore={listing.isFetchingNextPage || listing.isPlaceholderData}
      onmore={() => void listing.fetchNextPage()}
    >
      {#snippet controls()}
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
        <TagFilter available={tags.data ?? []} error={tags.error?.message ?? null} bind:selected={tagged} />
      {/snippet}
      {#snippet empty()}
        {#if filtered}
          No texts match.
        {:else if importer === "mine"}
          You haven't imported anything yet. <a href="#/upload">Upload a text</a>.
        {:else}
          Nothing imported yet.
        {/if}
      {/snippet}
    </DocumentList>
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
</style>
