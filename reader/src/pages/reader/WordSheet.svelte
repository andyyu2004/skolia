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
  import { createSetStatus, createWords } from "../../lib/words.ts";
  import { createAddCloze, createClozes, createRemoveCloze } from "../../lib/clozes.ts";
  import { MAX_CLOZE_SENTENCE, MAX_CLOZE_WHY, blankOut } from "@skolia/shared/api";
  import type { ReaderMode } from "../../lib/mode.ts";
  import { paradigmTables } from "@skolia/shared/paradigm";
  import { CASE_NAME, featureWords, roleLabel, UPOS_LABEL } from "@skolia/shared/ud";
  import Button from "../../components/Button.svelte";
  import ParadigmTable from "../../components/ParadigmTable.svelte";
  import Pronunciations from "../../components/Pronunciations.svelte";
  import SentenceDiagram from "./SentenceDiagram.svelte";
  import { sheet, type SheetView } from "../../lib/sheet.svelte.ts";
  import { clauseOf, parseSentence } from "@skolia/shared/tree";

  type WordPiece = Extract<Piece, { kind: "word" }>;

  let {
    lang,
    bundle,
    piece,
    mode,
    headText,
    sentenceTokens,
    sentenceText,
    documentId,
    onselectToken,
    onclose,
  }: {
    /** The document's language, also for the lang attribute of its text */
    lang: Lang;
    bundle: Bundle;
    piece: WordPiece;
    mode: ReaderMode;
    headText: (sentence: number, index: number) => string | null;
    sentenceTokens: (sentence: number) => Token[];
    /** A sentence's text and where it starts in the document. */
    sentenceText: (sentence: number) => { start: number; text: string } | null;
    documentId: string;
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

  let aside = $state<HTMLElement | null>(null);
  /** The text keeps at least this much of the screen */
  const TEXT_ROOM = 320;
  const NARROWEST = 288;
  let windowWidth = $state(0);
  const widest = $derived(Math.max(NARROWEST, windowWidth - TEXT_ROOM));
  /** The sheet's width as drawn, dragged or not, for the edge to report */
  let shown = $state(0);
  function resize(width: number): void {
    sheet.width[sheet.view] = Math.round(Math.max(NARROWEST, Math.min(width, widest)));
  }

  /** On a wide screen the sheet's left edge drags; a double click puts it back. */
  function ondrag(event: PointerEvent): void {
    const edge = event.currentTarget;
    if (!(edge instanceof HTMLElement) || !aside || event.button !== 0) return;
    event.preventDefault();
    edge.setPointerCapture(event.pointerId);
    const right = aside.getBoundingClientRect().right;
    const move = (e: PointerEvent): void => resize(right - e.clientX);
    edge.addEventListener("pointermove", move);
    edge.addEventListener("lostpointercapture", () => edge.removeEventListener("pointermove", move), { once: true });
  }

  /** The keys of a window splitter (WAI-ARIA authoring practices): the sheet is on the right, so left widens it */
  const EDGE_KEYS: Record<string, (width: number) => number> = {
    ArrowLeft: (width) => width + 16,
    ArrowRight: (width) => width - 16,
    Home: () => NARROWEST,
    End: () => widest,
  };
  function onedgekey(event: KeyboardEvent): void {
    const to = EDGE_KEYS[event.key];
    if (!to) return;
    event.preventDefault();
    resize(to(shown));
  }

  /** On a phone the sheet starts at half height; tapping the handle gives it the screen. */
  let expanded = $state(sheet.view === "sentence");


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

  /** Not offered for your cards: names, numbers and symbols aren't vocabulary. */
  const UNLEARNABLE: ReadonlySet<string> = new Set(["PROPN", "NUM", "SYM", "PUNCT", "X"]);

  function learnable(w: (typeof words)[number]): w is (typeof words)[number] & { lemmaId: LemmaId } {
    return w.lemmaId !== null && w.partOfWord === null && !UNLEARNABLE.has(w.ref.token.upos);
  }

  const known = createWords();
  const clozes = createClozes(() => documentId);
  const setStatus = createSetStatus();
  const addCloze = createAddCloze();
  const removeCloze = createRemoveCloze();

  /** The last failure to add a word, by lemma id. */
  let statusError = $state<{ lemmaId: LemmaId; message: string } | null>(null);

  /** The word being added from its +, by where it starts. */
  let adding = $state<number | null>(null);

  /** Tried in this sheet, words and cloze cards by where they start: a failed save shows
   * its error rather than being retried. */
  const tried = new Set<LemmaId>();
  const triedClozes = new Set<number>();

  /** In learning mode a word you tap goes into your cards if you've never marked it, and
   * so does its form in this sentence; Known while reviewing takes them out. In reading
   * mode the word's + adds them. */
  $effect(() => {
    if (!known.data || mode !== "learning") return;
    const fresh = words.flatMap((w): Addition[] => {
      const { lemmaId, cloze } = additionOf(w);
      const addition = {
        lemmaId: lemmaId !== null && !tried.has(lemmaId) ? lemmaId : null,
        cloze: cloze !== null && !triedClozes.has(w.ref.token.start) ? cloze : null,
      };
      return addition.lemmaId || addition.cloze ? [addition] : [];
    });
    for (const { lemmaId, cloze } of fresh) {
      if (lemmaId) tried.add(lemmaId);
      if (cloze) triedClozes.add(cloze.blankStart);
    }
    untrack(() => {
      void (async () => {
        for (const addition of fresh) await add(addition);
      })();
    });
  });

  /** Whether it was added. */
  async function learn(lemmaId: LemmaId): Promise<boolean> {
    try {
      await setStatus.mutateAsync({ lemmaId, status: "active" });
      return true;
    } catch (e: unknown) {
      statusError = { lemmaId, message: `Couldn't add it to your cards: ${e instanceof Error ? e.message : String(e)}` };
      return false;
    }
  }

  /** A cloze card practises a form: offered for a word that isn't its lemma (pracy, not
   * praca), or that is but has a reason for a case other than the nominative (widzę dom),
   * in a sentence short enough to keep, unless the word is known or ignored, which takes
   * its cloze cards out of reviews too, or is part of a fused word (du is de + le), whose
   * parts share its span. */
  function clozeOf(w: (typeof words)[number]) {
    if (!learnable(w) || w.ref.token.mwt !== undefined) return null;
    const isLemma = sameWord(w.entry?.lemma ?? w.ref.token.lemma ?? w.ref.token.text, w.ref.token.text);
    if (isLemma && (w.caseWhy === null || w.ref.token.feats.Case === "Nom")) return null;
    const found = sentenceText(w.ref.sentence);
    if (!found || found.text.length > MAX_CLOZE_SENTENCE) return null;
    const why = w.caseWhy && w.caseWhy.text.length <= MAX_CLOZE_WHY ? w.caseWhy.text : null;
    return {
      lemmaId: w.lemmaId,
      documentId,
      ...blankOut(found, w.ref.token),
      why,
    };
  }

  type ClozeRequest = NonNullable<ReturnType<typeof clozeOf>>;

  /** What a word's + adds: the word, if it has no status, and a cloze card of its form in
   * this sentence, if it can have one and hasn't. No cloze card until the text's have
   * loaded, so one it has isn't offered again. */
  interface Addition {
    readonly lemmaId: LemmaId | null;
    readonly cloze: ClozeRequest | null;
  }

  function additionOf(w: (typeof words)[number]): Addition {
    if (!known.data || !learnable(w)) return { lemmaId: null, cloze: null };
    const status = known.data[w.lemmaId]?.status;
    const cards = clozes.data ?? null;
    const request = status === "known" || status === "ignored" || cards === null ? null : clozeOf(w);
    return {
      lemmaId: status === undefined ? w.lemmaId : null,
      cloze: request && !cards?.has(w.ref.token.start) ? request : null,
    };
  }

  /** Unticking a word takes away what its + added: this sentence's cloze card, then the
   * word's status, which takes its other cards out of reviews. */
  async function removeFromCards(w: (typeof words)[number]): Promise<void> {
    if (!learnable(w)) return;
    const { start } = w.ref.token;
    const cardId = clozes.data?.get(start);
    adding = start;
    statusError = null;
    clozeError = null;
    try {
      if (cardId) await removeCloze.mutateAsync({ documentId, start, cardId });
      await setStatus.mutateAsync({ lemmaId: w.lemmaId, status: null });
    } catch (e: unknown) {
      statusError = { lemmaId: w.lemmaId, message: `Couldn't take it out of your cards: ${e instanceof Error ? e.message : String(e)}` };
    }
    adding = null;
  }

  /** The last failure to make a cloze card, by where its word starts. */
  let clozeError = $state<{ start: number; message: string } | null>(null);

  async function cloze(request: ClozeRequest): Promise<void> {
    const start = request.blankStart;
    try {
      await addCloze.mutateAsync(request);
    } catch (e: unknown) {
      clozeError = { start, message: `Couldn't make the card: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async function add({ lemmaId, cloze: request }: Addition): Promise<void> {
    if (lemmaId && !(await learn(lemmaId))) return;
    if (request) await cloze(request);
  }

  async function addFromButton(start: number, addition: Addition): Promise<void> {
    adding = start;
    statusError = null;
    clozeError = null;
    await add(addition);
    adding = null;
  }
</script>

<svelte:window bind:innerWidth={windowWidth} />

<aside id="word-sheet" class={["sheet", { expanded }]} aria-label="Word details" bind:this={aside} bind:offsetWidth={shown}>
  <div class="sheet-bar">
    <!-- A focusable separator with a value is a widget in ARIA, which Svelte's check doesn't know -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Width of word details"
      aria-controls="word-sheet"
      aria-valuenow={shown}
      aria-valuemin={NARROWEST}
      aria-valuemax={widest}
      aria-valuetext="{shown} pixels"
      tabindex="0"
      onpointerdown={ondrag}
      onkeydown={onedgekey}
      ondblclick={() => (sheet.width[sheet.view] = null)}
    ></div>
    <button type="button" class="handle" aria-label={expanded ? "Shrink" : "Expand"} onclick={() => (expanded = !expanded)}
    ></button>
    <div class="sheet-head">
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
            <Button variant="link" onclick={() => (sheet.whole = false)}>Just this clause</Button>
          {:else}
            This clause, {[...clause].filter((i) => tokens[i]?.upos !== "PUNCT").length} of {total} words.
            <Button variant="link" onclick={() => (sheet.whole = true)}>Whole sentence</Button>
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
      selected={selectedTokens}
      onselect={(index) => onselectToken(sentence, index)}
    />
  {/if}

  {#each words as word (word.ref.index)}
    {@const token = word.ref.token}
    <section class="word">
      <div class="head">
        <h2>
          <span {lang}>{token.text}</span>
          {@render speakers(word.heard, token.text)}
          {#if token.lemma && !sameWord(token.lemma, token.text)}
            <span class="lemma">(<span {lang}>{word.entry?.lemma ?? token.lemma}</span>)</span>
          {/if}
        </h2>
        {#if known.data && learnable(word)}
          {@const addition = additionOf(word)}
          {@const lemma = word.entry?.lemma ?? token.lemma ?? token.text}
          {#if addition.lemmaId || addition.cloze}
            {@const label = addition.lemmaId
              ? `Add ${lemma} to your cards${addition.cloze ? `, with this sentence to practise ${token.text}` : ""}`
              : `Practise ${token.text} in this sentence`}
            <button
              type="button"
              class="card-action"
              aria-label={label}
              title={label}
              disabled={adding === token.start}
              onclick={() => void addFromButton(token.start, addition)}
              ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg></button
            >
          {:else if known.data[word.lemmaId]?.status === "active"}
            {@const label = clozeOf(word) ? `${lemma} is in your cards, with this sentence` : `${lemma} is in your cards`}
            <button
              type="button"
              class="card-action done"
              aria-label="{label}. Take it out"
              title="{label}. Click to take it out"
              disabled={adding === token.start}
              onclick={() => void removeFromCards(word)}
              ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.5 3.5L13 4.5" /></svg></button
            >
          {/if}
        {/if}
      </div>
      {#if word.lemmaId && statusError?.lemmaId === word.lemmaId}
        <p class="error" role="alert">{statusError.message}</p>
      {/if}
      {#if clozeError?.start === token.start}
        <p class="error" role="alert">{clozeError.message}</p>
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
      {#if word.said.length > 0 || (word.lemmaSaid.length > 0 && word.entry)}
        <Pronunciations
          said={word.said}
          lemma={word.entry ? { text: word.entry.lemma, lang, said: word.lemmaSaid } : undefined}
        />
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
              <li class={{ other: !fits }}>
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
            <Button variant="link" onclick={() => (sensesFor = allSenses ? null : piece)}>
              {allSenses ? "Fewer meanings" : `All ${word.senses.length} meanings`}
            </Button>
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
                <li class={{ here: frame.here }}>
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
              <Button variant="link" onclick={() => (usesFor = allUses ? null : piece)}>
                {allUses ? "Fewer" : `All ${word.uses.length} uses`}
              </Button>
            {/if}
          </div>
        {/if}

        {#if word.idioms.length > 0}
          <details class="frames">
            <summary>Idioms ({word.idioms.length})</summary>
            <ul {lang}>
              {#each word.idioms as frame, i (i)}
                <li class={{ here: frame.here }}>
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

<!-- A bottom sheet on a phone; above 900px a side panel in the reader's grid -->
<style>
  .sheet {
    position: fixed;
    inset: auto 0 0 0;
    max-height: 50vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Below the sticky tab bar when something in the sheet is scrolled to */
    scroll-padding-top: 4.5rem;
    background: var(--surface);
    border-top: 1px solid var(--line);
    border-radius: 14px 14px 0 0;
    box-shadow: var(--shadow);
    padding: 0 var(--gutter) calc(var(--gutter) + env(safe-area-inset-bottom));
    transition: max-height 0.2s ease;
  }

  .sheet.expanded {
    max-height: 88vh;
  }

  .sheet-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    padding-top: 0.5rem;
    margin-bottom: 0.5rem;
    background: var(--surface);
  }

  .resizer {
    display: none;
  }

  /* The tabs, then copy link and close, centred on one row over one rule */
  .sheet-head {
    display: flex;
    align-items: center;
    flex-basis: 100%;
    margin-top: 0.15rem;
    border-bottom: 1px solid var(--line);
  }

  .sheet-tabs {
    display: flex;
    align-self: stretch;
    gap: 1.25rem;
  }

  .sheet-tabs button {
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 0.55rem 0.1rem;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .sheet-tabs button[aria-selected="true"] {
    border-bottom-color: var(--accent);
    color: var(--text);
  }

  .handle {
    width: 3rem;
    height: 0.9rem;
    border: 0;
    background: transparent;
    cursor: pointer;
    position: relative;
  }

  .handle::after {
    content: "";
    position: absolute;
    inset: 0.3rem 0;
    border-radius: 99px;
    background: var(--line);
  }

  .sheet-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .share,
  .close {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .share:hover,
  .close:hover {
    color: var(--text);
  }

  .share svg,
  .close svg {
    width: 1.1rem;
    height: 1.1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .share-note {
    font-size: 0.8rem;
    color: var(--muted);
  }

  @media (min-width: 900px) {
    .sheet {
      position: sticky;
      inset: auto;
      top: var(--nav-height);
      height: calc(100vh - var(--nav-height));
      max-height: none;
      border-top: 0;
      border-left: 1px solid var(--line);
      border-radius: 0;
      box-shadow: none;
    }

    .sheet.expanded {
      max-height: none;
    }

    .handle {
      display: none;
    }

    /* Down the sheet's left edge: the bar it sits in stays at the top, and the sheet clips it at the bottom */
    .resizer {
      display: block;
      position: absolute;
      top: 0;
      left: calc(-1 * var(--gutter));
      width: 7px;
      height: calc(100vh - var(--nav-height));
      cursor: col-resize;
      touch-action: none;
    }

    .resizer:hover,
    .resizer:active,
    .resizer:focus-visible {
      background: color-mix(in srgb, var(--accent) 35%, transparent);
      outline: none;
    }

    .sheet-head {
      margin-top: 0;
    }
  }

  .diagram-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .clause-note {
    margin: 0;
  }

  .layout-switch {
    margin-left: auto;
    flex-shrink: 0;
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 99px;
  }

  .layout-switch button {
    border: 0;
    border-radius: 99px;
    background: transparent;
    color: var(--muted);
    font-size: 0.8rem;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }

  .layout-switch button[aria-pressed="true"] {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .muted {
    color: var(--muted);
  }

  .small {
    font-size: 0.8rem;
  }

  .error {
    color: var(--error);
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .head h2 {
    flex: 1;
  }

  .card-action {
    flex: none;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    margin-top: 0.25rem;
    border: 1px solid var(--line);
    border-radius: 50%;
    padding: 0;
    background: none;
    color: var(--muted);
  }

  .card-action svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  button.card-action {
    cursor: pointer;
  }

  button.card-action:hover,
  button.card-action:focus-visible {
    color: var(--text);
    border-color: var(--muted);
  }

  button.card-action:disabled {
    cursor: progress;
    opacity: 0.6;
  }

  .card-action.done {
    border-color: transparent;
  }

  .word + .word {
    border-top: 1px solid var(--line);
    margin-top: 1rem;
  }

  h2 {
    font-family: var(--reading);
    font-size: 1.4rem;
    font-weight: 600;
    margin: 0.25rem 0;
  }

  .lemma {
    color: var(--muted);
    font-weight: 400;
  }

  .speaker {
    border: none;
    background: none;
    padding: 0;
    font-size: 0.6em;
    vertical-align: middle;
    cursor: pointer;
  }

  .grammar {
    margin: 0.2rem 0;
  }

  .role {
    margin: 0.2rem 0 0.6rem;
    font-size: 0.9rem;
  }

  /* A word in the sheet's text that selects it, styled as the text marks it */
  .word-link {
    border: 0;
    padding: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-underline-offset: 4px;
  }

  .mark-head {
    color: var(--text);
    text-decoration: underline 2px var(--head);
  }

  .mark-trigger {
    text-decoration: underline 2px dashed var(--trigger);
  }

  .word-link:hover {
    text-decoration-thickness: 3px;
  }

  .word-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }

  .why {
    margin: 0.4rem 0 0.8rem;
    padding: 0.5rem 0.7rem;
    border-left: 3px solid var(--trigger);
    background: color-mix(in srgb, var(--trigger) 10%, transparent);
    border-radius: 0 6px 6px 0;
  }

  .why-label {
    font-weight: 600;
    margin-right: 0.3rem;
  }

  .senses {
    padding-left: 1.4rem;
    margin: 0.6rem 0;
  }

  .senses li {
    margin-bottom: 0.4rem;
  }

  .senses li.other {
    color: var(--muted);
  }

  .tags {
    font-size: 0.75rem;
    color: var(--muted);
    margin-left: 0.3rem;
  }

  .example {
    font-size: 0.9rem;
    font-style: italic;
    margin-top: 0.15rem;
  }

  .relations {
    padding-left: 1.2rem;
    font-size: 0.95rem;
  }

  .frames h3,
  .frames summary {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin: 1rem 0 0.3rem;
    cursor: default;
  }

  .frames summary {
    cursor: pointer;
  }

  .frames ul {
    list-style: none;
    padding: 0;
    margin: 0.2rem 0;
  }

  .frames li {
    padding: 0.15rem 0;
    line-height: 1.5;
  }

  .frames li.here {
    border-left: 3px solid var(--trigger);
    padding-left: 0.5rem;
    background: color-mix(in srgb, var(--trigger) 10%, transparent);
    border-radius: 0 6px 6px 0;
  }

  .here-label {
    display: block;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--trigger);
  }

  .frame-head {
    font-weight: 600;
  }

  .case-label {
    font-size: 0.75rem;
    color: var(--accent);
    margin-left: 0.15rem;
  }
</style>
