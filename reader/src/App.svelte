<script lang="ts">
  import type { User } from "@skolia/shared/api";
  import Explore from "./Explore.svelte";
  import { currentUser } from "./lib/api.ts";
  import Nav from "./Nav.svelte";
  import Reader from "./Reader.svelte";
  import Upload from "./Upload.svelte";
  import { versionUrl } from "./lib/version.ts";

  type Route = { page: "explore" } | { page: "upload" } | { page: "reader"; id: string };

  function parse(hash: string): Route {
    if (hash === "#/upload") return { page: "upload" };
    const match = /^#\/doc\/([0-9a-f]{64})$/.exec(hash);
    return match?.[1] ? { page: "reader", id: match[1] } : { page: "explore" };
  }

  let route = $state(parse(location.hash));
  const version = import.meta.env.VITE_VERSION ?? "dev";
  const versionLink = versionUrl(version);
  /** undefined while loading, null when signed out. */
  let user = $state<User | null | undefined>(undefined);
  let error = $state<string | null>(null);

  $effect(() => {
    currentUser().then(
      (u) => (user = u),
      (e: unknown) => (error = e instanceof Error ? e.message : String(e)),
    );
  });
</script>

<svelte:window onhashchange={() => (route = parse(location.hash))} />

<Nav page={route.page} bind:user onerror={(message) => (error = message)} />

{#if error}
  <p class="error banner">{error}</p>
{/if}

{#if route.page === "reader"}
  {#key route.id}
    <Reader id={route.id} />
  {/key}
{:else if route.page === "upload"}
  <Upload {user} />
{:else}
  <Explore />
{/if}

{#if versionLink}
  <footer class="version muted"><a href={versionLink} rel="noreferrer">{version}</a></footer>
{:else}
  <footer class="version muted">{version}</footer>
{/if}
