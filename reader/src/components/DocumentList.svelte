<script lang="ts">
  import type { Snippet } from "svelte";
  import type { DocumentSummary } from "@skolia/shared/api";
  import { LANGUAGE_INFO, LICENCE_INFO } from "@skolia/shared/api";
  import { badge } from "../lib/reading.ts";
  import { tagLabel } from "../lib/tags.ts";

  /** A list of texts, a page at a time, each linking to its reader: a head with how many
   * are loaded and the list's controls, and More while there are more pages. */
  let {
    documents,
    hasMore,
    loadingMore,
    onmore,
    label,
    controls,
    empty,
    aside,
  }: {
    /** The pages loaded so far, undefined while the first loads. */
    documents: readonly DocumentSummary[] | undefined;
    hasMore: boolean;
    /** A page is loading, or the list shown is the last query's while the next comes. */
    loadingMore: boolean;
    onmore: () => void;
    /** What the list is, before its count. */
    label?: string;
    controls?: Snippet;
    /** What an empty list says. */
    empty: Snippet;
    /** Beside each text, outside its link. */
    aside?: Snippet<[DocumentSummary]>;
  } = $props();

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
</script>

<section class="listing">
  <div class="listing-head">
    <span class="listing-count">
      {#if label}{label}{documents ? " · " : ""}{/if}
      {#if documents}
        {documents.length.toLocaleString()}{hasMore ? "+" : ""} {documents.length === 1 && !hasMore ? "text" : "texts"}
      {/if}
    </span>
    {@render controls?.()}
  </div>

  {#if documents === undefined}
    <p class="empty">Loading…</p>
  {:else if documents.length === 0}
    <p class="empty">{@render empty()}</p>
  {:else}
    <ul class="entries">
      {#each documents as doc (`${doc.id}/${doc.importer.id}`)}
        {@const status = badge(doc)}
        <li class={{ "with-aside": aside !== undefined }}>
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
          {@render aside?.(doc)}
        </li>
      {/each}
    </ul>
    {#if hasMore}
      <div class="more">
        <button type="button" onclick={onmore} disabled={loadingMore}>{loadingMore ? "Loading…" : "More"}</button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .listing {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--card-shadow);
  }

  /* Rounded here rather than clipped by .listing, so a menu in the head can hang below it */
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

  .listing-head :global(select) {
    padding: 0.3rem 1.6rem 0.3rem 0.6rem;
    border-color: transparent;
    background-color: transparent;
    background-position: right 0.45rem center;
    background-size: 0.75rem;
    color: var(--muted);
    font-size: 0.9rem;
    field-sizing: content;
  }

  .listing-head :global(select:hover) {
    border-color: transparent;
    background-color: var(--surface);
    color: var(--text);
  }

  .listing-head :global(select.active) {
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

  .entries li.with-aside {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    padding-right: 1rem;
  }

  .with-aside .entry {
    flex: 1 1 20rem;
    min-width: 0;
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

    .entries li.with-aside {
      padding: 0 1rem 0.75rem;
    }

    .with-aside .entry {
      padding: 0.75rem 0 0.4rem;
    }
  }
</style>
