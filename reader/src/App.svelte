<script lang="ts">
  import Library from "./Library.svelte";
  import Reader from "./Reader.svelte";

  type Route = { page: "library" } | { page: "reader"; id: string };

  function parse(hash: string): Route {
    const match = /^#\/doc\/([0-9a-f]{64})$/.exec(hash);
    return match?.[1] ? { page: "reader", id: match[1] } : { page: "library" };
  }

  let route = $state(parse(location.hash));
</script>

<svelte:window onhashchange={() => (route = parse(location.hash))} />

{#if route.page === "reader"}
  {#key route.id}
    <Reader id={route.id} />
  {/key}
{:else}
  <Library />
{/if}

<footer class="version muted">{import.meta.env.VITE_VERSION ?? "dev"}</footer>
