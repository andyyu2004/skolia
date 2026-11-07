<script lang="ts">
  import type { Lang } from "@skolia/shared/api";
  import type { Bundle, Token } from "@skolia/shared/schema";
  import { LANGUAGES } from "@skolia/shared/lang";
  import type { Piece } from "@skolia/shared/doc";
  import type { LemmaId, WordStatus } from "@skolia/shared/api";
  import { entryFor, entryIdFor, pronunciationsOf, rankSenses } from "@skolia/shared/lexicon";
  import { LemmaId as LemmaIdSchema } from "@skolia/shared/schemas";
  import { loadWords, setStatus, words as known } from "./lib/words.svelte.ts";
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
        return {
          ref: w,
          entry,
          lemmaId: parsedId.success ? parsedId.data : null,
          said: pronunciationsOf(bundle, w.token.text, w.token.upos),
          lemmaSaid:
            entry && entry.lemma !== w.token.text ? pronunciationsOf(bundle, entry.lemma, entry.upos) : [],
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

  const STATUS_LABELS: [WordStatus, string][] = [
    ["active", "Learn"],
    ["known", "Known"],
    ["ignored", "Ignore"],
  ];
  let statusError = $state<string | null>(null);

  $effect(() => {
    loadWords().catch((e: unknown) => (statusError = e instanceof Error ? e.message : String(e)));
  });

  async function mark(lemmaId: LemmaId, status: WordStatus): Promise<void> {
    statusError = null;
    try {
      await setStatus(lemmaId, status);
    } catch (e: unknown) {
      statusError = e instanceof Error ? e.message : String(e);
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
        {#if token.lemma && token.lemma !== token.text}
          <span class="lemma">(<span {lang}>{word.entry?.lemma ?? token.lemma}</span>)</span>
        {/if}
      </h2>
      {#if word.said.length > 0 || word.lemmaSaid.length > 0}
        <p class="pronunciation">
          {#each word.said as p (p.ipa)}
            <span class="ipa">{#if p.accents}<span class="accent">{p.accents.join(", ")}</span> {/if}{p.ipa}</span>
          {/each}
          {#if word.lemmaSaid.length > 0 && word.entry}
            <span class="muted"
              ><span {lang}>{word.entry.lemma}</span>
              {#each word.lemmaSaid as p (p.ipa)}
                <span class="ipa">{#if p.accents}<span class="accent">{p.accents.join(", ")}</span> {/if}{p.ipa}</span>
              {/each}</span
            >
          {/if}
        </p>
      {/if}
      {#if known.byId && word.lemmaId && word.partOfWord === null}
        {@const lemmaId = word.lemmaId}
        {@const current = known.byId[lemmaId]}
        <div class="word-status" role="group" aria-label="Your word">
          {#each STATUS_LABELS as [status, label] (status)}
            <button
              type="button"
              class="quiet"
              aria-pressed={current?.status === status}
              onclick={() => mark(lemmaId, status)}>{label}</button
            >
          {/each}
          {#if current?.status === "active"}
            <span class="muted">{current.mature ? "known from your cards" : "learning"}</span>
          {/if}
        </div>
        {#if statusError}<p class="error">{statusError}</p>{/if}
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
