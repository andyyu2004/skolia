<script lang="ts">
  import { untrack } from "svelte";
  import type { Lang } from "@skolia/shared/api";
  import type { Bundle, Token } from "@skolia/shared/schema";
  import { LANGUAGES } from "@skolia/shared/lang";
  import type { Piece } from "@skolia/shared/doc";
  import type { LemmaId } from "@skolia/shared/api";
  import {
    entryFor,
    entryIdFor,
    mainPronunciations,
    pronunciationsOf,
    rankSenses,
    recordingsOf,
  } from "@skolia/shared/lexicon";
  import type { Recording } from "@skolia/shared/schema";
  import { LemmaId as LemmaIdSchema } from "@skolia/shared/schemas";
  import { setStatus, words as known } from "./lib/words.svelte.ts";
  import { paradigmTables } from "@skolia/shared/paradigm";
  import { CASE_NAME, featureWords, roleLabel, UPOS_LABEL } from "@skolia/shared/ud";
  import ParadigmTable from "./ParadigmTable.svelte";

  type WordPiece = Extract<Piece, { kind: "word" }>;

  let {
    lang,
    bundle,
    piece,
    headText,
    sentenceTokens,
    onclose,
  }: {
    /** The document's language, also for the lang attribute of its text */
    lang: Lang;
    bundle: Bundle;
    piece: WordPiece;
    headText: (sentence: number, index: number) => string | null;
    sentenceTokens: (sentence: number) => Token[];
    onclose: () => void;
  } = $props();
  const language = $derived(LANGUAGES[lang]);

  const SHOWN_SENSES = 3;

  function visibleTags(tags: string[]): string[] {
    return tags.filter((t) => !language.grammarTags.has(t));
  }

  /** On a phone the sheet starts at half height; tapping the handle gives it the screen. */
  let expanded = $state(false);
  let allSenses = $state(false);
  let allUses = $state(false);
  const SHOWN_USES = 5;

  /** "kogoś/czegoś [gen.]" -> the words, and the bracketed labels to style apart. */
  function patternParts(pattern: string): { text: string; label: boolean }[] {
    return pattern
      .split(/(\[[^\]]+\])/u)
      .filter((part) => part !== "")
      .map((part) => ({ text: part, label: part.startsWith("[") }));
  }

  const words = $derived(
    piece.words
      .filter((w) => w.token.upos !== "PUNCT")
      .map((w) => {
        const entry = entryFor(bundle, w.token);
        const partOfWord = language.partOfWord(w.token);
        const role = roleLabel(w.token.deprel);
        const head = w.token.head === null ? null : headText(w.sentence, w.token.head);
        const tokens = sentenceTokens(w.sentence);
        const uses = entry && partOfWord === null ? language.uses(entry, tokens, w.index) : [];
        const parsedId = LemmaIdSchema.safeParse(entryIdFor(bundle, w.token));
        const said = mainPronunciations(pronunciationsOf(bundle, w.token.text, w.token.upos));
        return {
          ref: w,
          entry,
          lemmaId: parsedId.success ? parsedId.data : null,
          said,
          lemmaSaid:
            said.length === 0 && entry && !sameWord(entry.lemma, w.token.text)
              ? mainPronunciations(pronunciationsOf(bundle, entry.lemma, entry.upos))
              : [],
          heard: recordingsOf(bundle, w.token.text, w.token.upos).slice(0, 1),
          partOfWord,
          role: role && head ? { role, head } : null,
          caseWhy: language.explainCase(tokens, w.index),
          senses: entry ? rankSenses(entry, w.token.feats) : [],
          uses: uses.filter((u) => !u.idiom),
          idioms: uses.filter((u) => u.idiom),
          tables:
            entry && partOfWord === null
              ? paradigmTables(bundle, entry, w.token, language.paradigm, language.mergeLabels)
              : [],
        };
      }),
  );

  let playing: HTMLAudioElement | null = null;

  function play(recording: Recording): void {
    playing?.pause();
    playing = new Audio(recording.mp3_url);
    void playing.play();
  }

  /** Cześć at the start of a sentence is still the lemma cześć */
  function sameWord(a: string, b: string): boolean {
    return a.toLocaleLowerCase() === b.toLocaleLowerCase();
  }

  /** Not added on a tap: names, numbers and symbols aren't vocabulary. */
  const UNLEARNABLE: ReadonlySet<string> = new Set(["PROPN", "NUM", "SYM", "PUNCT", "X"]);

  /** The last failure to add a word, by lemma id. */
  let statusError = $state<{ lemmaId: LemmaId; message: string } | null>(null);

  /** Tried in this sheet: a failed save shows its error rather than being retried. */
  const tried = new Set<LemmaId>();

  /** A word you tap and have never marked goes into your cards; Known while reviewing
   * takes it out. */
  $effect(() => {
    if (!known.byId) return;
    const fresh = words.flatMap((w) =>
      w.lemmaId &&
      w.partOfWord === null &&
      !UNLEARNABLE.has(w.ref.token.upos) &&
      known.byId?.[w.lemmaId] === undefined &&
      !tried.has(w.lemmaId)
        ? [w.lemmaId]
        : [],
    );
    for (const lemmaId of fresh) tried.add(lemmaId);
    untrack(() => {
      void (async () => {
        for (const lemmaId of fresh) await learn(lemmaId);
      })();
    });
  });

  async function learn(lemmaId: LemmaId): Promise<void> {
    try {
      await setStatus(lemmaId, "active");
    } catch (e: unknown) {
      statusError = { lemmaId, message: `Couldn't add it to your cards: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
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
        <span {lang}>{token.text}</span>
        {@render speakers(word.heard, token.text)}
        {#if token.lemma && !sameWord(token.lemma, token.text)}
          <span class="lemma">(<span {lang}>{word.entry?.lemma ?? token.lemma}</span>)</span>
        {/if}
      </h2>
      {#if word.lemmaId && statusError?.lemmaId === word.lemmaId}
        <p class="error" role="alert">{statusError.message}</p>
      {/if}
      {#snippet speakers(recordings: Recording[], word: string)}
        {#each recordings as r (r.audio)}
          <button
            type="button"
            class="speaker"
            aria-label={`Play ${word}${r.tags ? ` (${r.tags.join(", ")})` : ""}`}
            title={r.tags?.join(", ")}
            onclick={() => play(r)}>🔊</button
          >
        {/each}
      {/snippet}
      {#if word.said.length > 0 || word.lemmaSaid.length > 0}
        <p class="pronunciation">
          {#each word.said as p (p.ipa)}
            <span class="ipa">{#if p.accents}<span class="accent">{p.accents.join(", ")}</span> {/if}{p.ipa}</span>
          {/each}
          {#if word.lemmaSaid.length > 0 && word.entry}
            <span class="lemma-said"
              ><span {lang}>{word.entry.lemma}</span>
              {#each word.lemmaSaid as p (p.ipa)}
                <span class="ipa">{#if p.accents}<span class="accent">{p.accents.join(", ")}</span> {/if}{p.ipa}</span>
              {/each}</span
            >
          {/if}
        </p>
      {/if}
      <p class="grammar">
        {[word.partOfWord ?? UPOS_LABEL[token.upos], ...featureWords(token.feats)].join(
          " · ",
        )}
      </p>
      {#if word.role}
        <p class="role muted">{word.role.role} <span {lang} class="mark-head">{word.role.head}</span></p>
      {/if}
      {#if word.caseWhy && token.feats.Case}
        <p class="why">
          <span class="why-label">Why {CASE_NAME[token.feats.Case]}?</span>
          <span {lang}
            >{#each word.caseWhy.parts as part, j (j)}{#if part.trigger}<span class="mark-trigger">{part.text}</span
                >{:else}{part.text}{/if}{/each}</span
          >
        </p>
      {/if}

      {#if word.partOfWord === null}
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
                    <span {lang}>{example.text}</span>
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
                {language.relationLabel?.(relation) ?? `from (${relation.note ?? "derived"})`}:
                <span {lang}>{relation.lemma}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if word.uses.length > 0}
          <div class="frames">
            <h3>Used with</h3>
            <ul {lang}>
              {#each allUses ? word.uses : word.uses.slice(0, SHOWN_USES) as frame, i (i)}
                <li class:here={frame.here}>
                  {#if frame.here}<span class="here-label" lang="en">in this sentence</span>{/if}
                  <span class="frame-head">{frame.head}</span>
                  {#each patternParts(frame.pattern) as part, j (j)}
                    {#if part.label}<span class="case-label">{part.text}</span>{:else}{part.text}{/if}
                  {/each}
                  {#if frame.tags.length > 0}<span class="tags">{frame.tags.join(", ")}</span>{/if}
                </li>
              {/each}
            </ul>
            {#if word.uses.length > SHOWN_USES}
              <button type="button" class="link" onclick={() => (allUses = !allUses)}>
                {allUses ? "Fewer" : `All ${word.uses.length} uses`}
              </button>
            {/if}
          </div>
        {/if}

        {#if word.idioms.length > 0}
          <details class="frames">
            <summary>Idioms ({word.idioms.length})</summary>
            <ul {lang}>
              {#each word.idioms as frame, i (i)}
                <li class:here={frame.here}>
                  {#if frame.here}<span class="here-label" lang="en">in this sentence</span>{/if}
                  <span class="frame-head">{frame.head}</span>
                  {#each patternParts(frame.pattern) as part, j (j)}
                    {#if part.label}<span class="case-label">{part.text}</span>{:else}{part.text}{/if}
                  {/each}
                  {#if frame.tags.length > 0}<span class="tags">{frame.tags.join(", ")}</span>{/if}
                </li>
              {/each}
            </ul>
            <p class="muted small">Fixed words are shown in their dictionary form.</p>
          </details>
        {/if}

        {#each word.tables as table (table.title)}
          <ParadigmTable {lang} {table} />
        {/each}
      {/if}
    </section>
  {/each}
</aside>
