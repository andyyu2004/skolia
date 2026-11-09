<script lang="ts">
  import type { Snippet } from "svelte";

  /** A page's column with its title; actions sit at the title's end, wrapping under it on a phone. */
  let {
    title,
    wide = false,
    actions,
    children,
  }: { title: string; wide?: boolean; actions?: Snippet; children: Snippet } = $props();
</script>

<main class={{ wide }}>
  <div class="title-row">
    <h1>{title}</h1>
    {@render actions?.()}
  </div>
  {@render children()}
</main>

<style>
  main {
    max-width: 48rem;
    margin: 0 auto;
    padding: var(--gutter);
  }

  .wide {
    max-width: 56rem;
  }

  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    margin: 0.5rem 0 1rem;
  }

  h1 {
    margin: 0;
  }
</style>
