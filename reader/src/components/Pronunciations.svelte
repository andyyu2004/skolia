<script lang="ts">
  import type { Lang } from "@skolia/shared/api";
  import type { Pronunciation } from "@skolia/shared/schema";

  /** A word's IPA, each under its accents. lemma: the dictionary form's, when the word has none of its own. */
  let {
    said,
    lemma,
  }: {
    said: readonly Pronunciation[];
    lemma?: { text: string; lang: Lang; said: readonly Pronunciation[] } | undefined;
  } = $props();
</script>

{#snippet ipa(p: Pronunciation)}
  <span class="ipa"
    >{#if p.accents}
      <span class="accent">{p.accents.join(", ")}</span>
    {/if}{p.ipa}</span
  >
{/snippet}

<p>
  {#each said as p (p.ipa)}
    {@render ipa(p)}
  {/each}
  {#if lemma && lemma.said.length > 0}
    <span class="lemma"
      ><span lang={lemma.lang}>{lemma.text}</span>
      {#each lemma.said as p (p.ipa)}
        {@render ipa(p)}
      {/each}</span
    >
  {/if}
</p>

<style>
  p {
    margin: 0.2rem 0;
    display: flex;
    flex-wrap: wrap;
    column-gap: 0.75rem;
  }

  .ipa {
    white-space: nowrap;
  }

  .accent {
    color: var(--muted);
    font-size: 0.8em;
  }

  .lemma {
    display: contents;
    color: var(--muted);
  }
</style>
