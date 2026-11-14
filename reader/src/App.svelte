<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { isLang, type CardGroup, type DocumentId, type Lang } from "@skolia/shared/api";
  import * as schemas from "@skolia/shared/schemas";
  import Explore from "./pages/Explore.svelte";
  import { userQuery } from "./lib/queries.ts";
  import { createWords } from "./lib/words.ts";
  import Button from "./components/Button.svelte";
  import Nav from "./components/Nav.svelte";
  import Reader from "./pages/reader/Reader.svelte";
  import Review from "./pages/Review.svelte";
  import Settings from "./pages/Settings.svelte";
  import Upload from "./pages/Upload.svelte";
  import { versionUrl } from "./lib/version.ts";

  type Route = { page: "explore" } | { page: "upload" } | { page: "review"; lang: Lang | null; group: CardGroup | null } | { page: "settings" } | { page: "reader"; id: DocumentId };

  function parse(hash: string): Route {
    if (hash === "#/upload") return { page: "upload" };
    if (hash === "#/review") return { page: "review", lang: null, group: null };
    const [, review, group] = /^#\/review\/([a-z]+)(?:\/(words|forms))?$/.exec(hash) ?? [];
    if (review !== undefined && isLang(review)) return { page: "review", lang: review, group: group === "words" || group === "forms" ? group : null };
    if (hash === "#/settings") return { page: "settings" };
    // After the id, a word in the text (lib/link.ts), which Reader reads
    const [, doc] = /^#\/doc\/([^?]+)(?:\?.*)?$/.exec(hash) ?? [];
    const id = schemas.DocumentId.safeParse(doc);
    return id.success ? { page: "reader", id: id.data } : { page: "explore" };
  }

  let route = $state(parse(location.hash));
  const version = import.meta.env.VITE_VERSION ?? "dev";
  const versionLink = versionUrl(version);
  const signedIn = createQuery(() => userQuery);
  /** undefined while loading, null when signed out. */
  const user = $derived(signedIn.data);
  // The word sheet's statuses, loaded once someone signs in
  const words = createWords();
  let error = $state<string | null>(null);

  $effect(() => {
    const failed = signedIn.error ?? words.error;
    if (failed) error = failed.message;
  });
</script>

<svelte:window
  onhashchange={() => {
    // Only a new page is a new route: a new word in the same text (lib/link.ts) is the
    // reader's to follow, and replacing the route would rerun everything that reads it
    const next = parse(location.hash);
    if (JSON.stringify(next) !== JSON.stringify(route)) {
      route = next;
      error = null;
    }
  }}
/>

<Nav page={route.page} {user} onerror={(message) => (error = message)} />

<div class="content">
  {#if error}
    <div class="banner" role="alert">
      <p>{error}</p>
      <Button variant="icon" aria-label="Dismiss" onclick={() => (error = null)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </Button>
    </div>
  {/if}

  {#if route.page === "reader"}
    {#key route.id}
      <Reader id={route.id} />
    {/key}
  {:else if route.page === "upload"}
    <Upload {user} />
  {:else if route.page === "review"}
    <Review {user} lang={route.lang} group={route.group} />
  {:else if route.page === "settings"}
    <Settings {user} />
  {:else}
    <Explore {user} />
  {/if}
</div>

{#if versionLink}
  <footer><a href={versionLink} rel="noreferrer">{version}</a></footer>
{:else}
  <footer>{version}</footer>
{/if}

<style>
  .content {
    flex: 1;
  }

  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    max-width: 48rem;
    margin: 0.75rem auto 0;
    padding: 0 var(--gutter);
    color: var(--error);
  }

  .banner p {
    margin: 0;
  }

  footer {
    padding: 2rem 1rem 1rem;
    color: var(--muted);
    font-size: 0.75rem;
    text-align: center;
  }
</style>
