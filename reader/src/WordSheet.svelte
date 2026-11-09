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
  import SentenceDiagram from "./SentenceDiagram.svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { sheet, type SheetView } from "./lib/sheet.svelte.ts";
  import { clauseOf, parseSentence } from "@skolia/shared/tree";

  type WordPiece = Extract<Piece, { kind: "word" }>;

  let {
    lang,
    bundle,
    piece,
    headText,
    sentenceTokens,
    onselectToken,
    onclose,
  }: {
    /** The document's language, also for the lang attribute of its text */
    lang: Lang;
    bundle: Bundle;
    piece: WordPiece;
    headText: (sentence: number, index: number) => string | null;
    sentenceTokens: (sentence: number) => Token[];
    onselectToken: (sentence: number, index: number) => void;
    onclose: () => void;
  } = $props();

  /** Longer sentences start with the clause around the word, not all of it */
  const LONG_SENTENCE = 15;
  const sentence = $derived(piece.words[0]?.sentence ?? 0);
  const selectedTokens = $derived(new Set(piece.words.map((w) => w.index)));
  const language = $derived(LANGUAGES[lang]);

  const SHOWN_SENSES = 3;

  function visibleTags(tags: string[]): string[] {
    return tags.filter((t) => !language.grammarTags.has(t));
  }

  /** On a phone the sheet starts at half height; tapping the handle gives it the screen. */
  let expanded = $state(sheet.view === "sentence");

  /** Too narrow for a diagram read left to right: it's turned to read top to bottom */
  const narrow = new MediaQuery("max-width: 599px");

  const VIEWS = [
    ["word", "Word"],
    ["sentence", "Sentence"],
  ] as const;

  /** "Link copied" for a moment after sharing; the address already names the word (lib/link.ts). */
  let shared = $state("");
  async function share(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      shared = "Link copied";
    } catch {
      shared = "Couldn't copy: the address bar has the link";
    }
    setTimeout(() => (shared = ""), 2000);
  }

  function show(view: SheetView): void {
    sheet.view = view;
    // A diagram needs the height on a phone
    if (view === "sentence") expanded = true;
  }
  /** The word whose full lists are shown: another word starts with them folded. */
  let sensesFor = $state<WordPiece | null>(null);
  let usesFor = $state<WordPiece | null>(null);
  const allSenses = $derived(sensesFor === piece);
  const allUses = $derived(usesFor === piece);
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
    <div class="sheet-actions">
      <span class="share-note" role="status">{shared}</span>
      <button type="button" class="share" aria-label="Copy a link to this word" title="Copy link" onclick={share}
        ><svg viewBox="0 0 16 16" aria-hidden="true"
          ><path
            d="M6.5 9.5a3 3 0 0 0 4.2 0l2.1-2.1a3 3 0 0 0-4.2-4.2l-.9.9M9.5 6.5a3 3 0 0 0-4.2 0L3.2 8.6a3 3 0 0 0 4.2 4.2l.9-.9"
          /></svg
        ></button
      >
      <button type="button" class="close" aria-label="Close" onclick={onclose}
        ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button
      >
    </div>
    <div class="sheet-tabs" role="tablist" aria-label="Show">
      {#each VIEWS as [view, label] (view)}
        <button
          type="button"
          role="tab"
          id="sheet-tab-{view}"
          aria-selected={sheet.view === view}
          tabindex={sheet.view === view ? 0 : -1}
          onclick={() => show(view)}
          onkeydown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const other = sheet.view === "word" ? "sentence" : "word";
            show(other);
            document.getElementById(`sheet-tab-${other}`)?.focus();
          }}>{label}</button
        >
      {/each}
    </div>
  </div>

  {#if sheet.view === "sentence"}
    {@const tokens = sentenceTokens(sentence)}
    {@const total = tokens.filter((t) => t.upos !== "PUNCT").length}
    {@const clause = total > LONG_SENTENCE ? clauseOf(tokens, piece.words[0]?.index ?? 0) : null}
    <div class="diagram-bar">
      {#if clause}
        <p class="clause-note muted small">
          {#if sheet.whole}
            All {total} words.
            <button type="button" class="link" onclick={() => (sheet.whole = false)}>Just this clause</button>
          {:else}
            This clause, {[...clause].filter((i) => tokens[i]?.upos !== "PUNCT").length} of {total} words.
            <button type="button" class="link" onclick={() => (sheet.whole = true)}>Whole sentence</button>
          {/if}
        </p>
      {/if}
      <div class="layout-switch" role="group" aria-label="Draw the sentence as">
        <button type="button" aria-pressed={sheet.layout === "arcs"} onclick={() => (sheet.layout = "arcs")}
          >Arcs</button
        >
        <button type="button" aria-pressed={sheet.layout === "tree"} onclick={() => (sheet.layout = "tree")}
          >Tree</button
        >
      </div>
    </div>
    <SentenceDiagram
      {lang}
      sentence={parseSentence(tokens, {
        keep: clause && !sheet.whole ? clause : undefined,
        cases: language.cases,
        partOfWord: language.partOfWord,
      })}
      shape={sheet.layout}
      direction={narrow.current ? "down" : "across"}
      selected={selectedTokens}
      onselect={(index) => onselectToken(sentence, index)}
    />
  {/if}

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
      {#if word.role && token.head !== null}
        {@const head = token.head}
        <p class="role muted">
          {word.role.role}
          <button
            type="button"
            {lang}
            class="word-link mark-head"
            title="Show {word.role.head}"
            onclick={() => onselectToken(word.ref.sentence, head)}>{word.role.head}</button
          >
        </p>
      {/if}
      {#if word.caseWhy && token.feats.Case}
        {@const trigger = word.caseWhy.trigger}
        <p class="why">
          <span class="why-label">Why {CASE_NAME[token.feats.Case]}?</span>
          <span {lang}
            >{#each word.caseWhy.parts as part, j (j)}{#if part.trigger && trigger !== null}<button
                  type="button"
                  class="word-link mark-trigger"
                  title="Show {part.text}"
                  onclick={() => onselectToken(word.ref.sentence, trigger)}>{part.text}</button
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
            <button type="button" class="link" onclick={() => (sensesFor = allSenses ? null : piece)}>
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
              <button type="button" class="link" onclick={() => (usesFor = allUses ? null : piece)}>
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
          <ParadigmTable
            {lang}
            {table}
            bind:open={() => sheet.forms[table.title] ?? false, (open) => (sheet.forms[table.title] = open ?? false)}
          />
        {/each}
      {/if}
    </section>
  {/each}
</aside>
