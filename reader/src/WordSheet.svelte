<script lang="ts">
  import type { Bundle, Token } from "@skolia/shared/schema";
  import { CASE_NAME, explainCase } from "./lib/cases.ts";
  import type { Piece } from "./lib/doc.ts";
  import { entryFor, rankSenses } from "./lib/lexicon.ts";
  import { paradigmTables } from "./lib/paradigm.ts";
  import { featureWords, roleLabel, UPOS_LABEL } from "./lib/ud.ts";
  import ParadigmTable from "./ParadigmTable.svelte";

  type WordPiece = Extract<Piece, { kind: "word" }>;

  let {
    bundle,
    piece,
    headText,
    sentenceTokens,
    onclose,
  }: {
    bundle: Bundle;
    piece: WordPiece;
    headText: (sentence: number, index: number) => string | null;
    sentenceTokens: (sentence: number) => Token[];
    onclose: () => void;
  } = $props();

  const SHOWN_SENSES = 3;
  // Wiktionary tags the grammar line already shows (gender, animacy, aspect)
  const GRAMMAR_TAGS = new Set([
    "masculine",
    "feminine",
    "neuter",
    "animal-not-person",
    "person",
    "personal",
    "inanimate",
    "animate",
    "perfective",
    "imperfective",
  ]);

  function visibleTags(tags: string[]): string[] {
    return tags.filter((t) => !GRAMMAR_TAGS.has(t));
  }

  /** On a phone the sheet starts at half height; tapping the handle gives it the screen. */
  let expanded = $state(false);
  let allSenses = $state(false);

  const words = $derived(
    piece.words
      .filter((w) => w.token.upos !== "PUNCT")
      .map((w) => {
        const entry = entryFor(bundle, w.token);
        const isPersonEnding = (w.token.xpos ?? "").startsWith("aglt");
        const role = roleLabel(w.token.deprel);
        const head = w.token.head === null ? null : headText(w.sentence, w.token.head);
        return {
          ref: w,
          entry,
          isPersonEnding,
          role: role && head ? `${role} ${head}` : null,
          caseWhy: explainCase(sentenceTokens(w.sentence), w.index),
          senses: entry ? rankSenses(entry, w.token.feats) : [],
          tables: entry && !isPersonEnding ? paradigmTables(bundle, entry, w.token) : [],
        };
      }),
  );
</script>

<aside class="sheet" class:expanded aria-label="Word details">
  <div class="sheet-bar">
    <button type="button" class="handle" aria-label={expanded ? "Shrink" : "Expand"} onclick={() => (expanded = !expanded)}
    ></button>
    <button type="button" class="close" aria-label="Close" onclick={onclose}>×</button>
  </div>

  {#each words as word (word.ref.index)}
    {@const token = word.ref.token}
    <section class="word">
      <h2>
        <span lang="pl">{token.text}</span>
        {#if token.lemma && token.lemma !== token.text}
          <span class="arrow">→</span> <span lang="pl" class="lemma">{word.entry?.lemma ?? token.lemma}</span>
        {/if}
      </h2>
      <p class="grammar">
        {[word.isPersonEnding ? "person ending" : UPOS_LABEL[token.upos], ...featureWords(token.feats)].join(
          " · ",
        )}
      </p>
      {#if word.role}
        <p class="role muted" lang="pl">{word.role}</p>
      {/if}
      {#if word.caseWhy && token.feats.Case}
        <p class="why">
          <span class="why-label">Why {CASE_NAME[token.feats.Case]}?</span>
          <span lang="pl">{word.caseWhy.text}</span>
        </p>
      {/if}

      {#if !word.isPersonEnding}
        {#if word.senses.length > 0}
          <ol class="senses">
            {#each allSenses ? word.senses : word.senses.slice(0, SHOWN_SENSES) as { sense, fits }, i (i)}
              <li class:other={!fits}>
                {sense.gloss}
                {#if visibleTags(sense.tags).length > 0}
                  <span class="tags">{visibleTags(sense.tags).join(", ")}</span>
                {/if}
                {#each sense.examples ?? [] as example, j (j)}
                  <div class="example">
                    <span lang="pl">{example.text}</span>
                    {#if example.translation}<span class="muted"> — {example.translation}</span>{/if}
                  </div>
                {/each}
              </li>
            {/each}
          </ol>
          {#if word.senses.length > SHOWN_SENSES}
            <button type="button" class="link" onclick={() => (allSenses = !allSenses)}>
              {allSenses ? "Fewer meanings" : `All ${word.senses.length} meanings`}
            </button>
          {/if}
        {:else}
          <p class="muted">No dictionary meaning yet.</p>
        {/if}

        {#if word.entry && word.entry.relations.length > 0}
          <ul class="relations">
            {#each word.entry.relations as relation (relation.type + relation.lemma)}
              <li>
                {relation.type === "aspect-partner" ? `${relation.note ?? "aspect"} partner` : `from (${relation.note ?? "derived"})`}:
                <span lang="pl">{relation.lemma}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#each word.tables as table (table.title)}
          <ParadigmTable {table} />
        {/each}
      {/if}
    </section>
  {/each}
</aside>
