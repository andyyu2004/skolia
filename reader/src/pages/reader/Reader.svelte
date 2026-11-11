<script lang="ts">
  import type { DocumentSummary, ReadingNames } from "@skolia/shared/api";
  import { LICENCE_INFO } from "@skolia/shared/api";
  import type { Token } from "@skolia/shared/schema";
  import { getDocument, getText, loadReading, type Reading } from "../../lib/api.ts";
  import { layout, tokenKey, type Layout } from "@skolia/shared/doc";
  import { afterPoll, notice as noticeFor, queueText, retryAfter } from "../../lib/reading.ts";
  import Button from "../../components/Button.svelte";
  import EditDocument from "./EditDocument.svelte";
  import WordSheet from "./WordSheet.svelte";
  import { sheet } from "../../lib/sheet.svelte.ts";
  import { readLink, writeLink, type WordKey } from "../../lib/link.ts";
  import { onDestroy, tick, untrack } from "svelte";
  import { SAVE_AFTER_MS, firstBelow, onScreen, positionsOf, scrollToTop, snippet, wordElements, type Positions } from "../../lib/position.ts";
  import type { ReaderMode } from "../../lib/mode.ts";
  import { words as known } from "../../lib/words.svelte.ts";
  import { loadClozes } from "../../lib/clozes.svelte.ts";

  let { id }: { id: string } = $props();

  let summary = $state<DocumentSummary | null>(null);
  let reading = $state<Reading | null>(null);
  /** The plain text, shown until a reading is. */
  let plain = $state<string | null>(null);
  let error = $state<string | null>(null);
  let selected = $state<number | null>(null);
  let editing = $state(false);
  let mode = $state<ReaderMode>("reading");

  const notice = $derived(noticeFor(summary, reading !== null, error));

  const doc: Layout | null = $derived(reading ? layout(reading.text, reading.analysis) : null);
  const piece = $derived(doc && selected !== null ? doc.words[selected] : undefined);

  /** The piece holding the selected word's head, to mark it in the text. */
  const headPiece = $derived.by(() => {
    const word = piece?.words.find((w) => w.token.upos !== "PUNCT");
    if (!doc || !word || word.token.head === null) return null;
    return doc.pieceOf.get(tokenKey(word.sentence, word.token.head)) ?? null;
  });

  /** The piece holding the word that causes the selected word's case (Polish do, szukać, nie). */
  const triggerPiece = $derived.by(() => {
    const word = piece?.words.find((w) => w.token.case_reason?.trigger !== undefined);
    const trigger = word?.token.case_reason?.trigger;
    if (!doc || !word || trigger === undefined) return null;
    return doc.pieceOf.get(tokenKey(word.sentence, trigger)) ?? null;
  });

  function sentenceTokens(sentence: number): Token[] {
    return reading?.analysis.sentences[sentence]?.tokens ?? [];
  }

  /** A sentence's text and where it starts in the document, for a cloze card. */
  function sentenceText(sentence: number): { start: number; text: string } | null {
    const found = reading?.analysis.sentences[sentence];
    return reading && found ? { start: found.start, text: reading.text.slice(found.start, found.end) } : null;
  }

  // The cloze cards from this text, once signed in
  $effect(() => {
    if (known.byId !== null) void loadClozes(id).catch(() => undefined);
  });

  $effect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tried: ReadingNames | null = null;
    let failures = 0;
    async function poll(): Promise<void> {
      try {
        const current = await getDocument(id);
        if (cancelled) return;
        summary = current;
        const step = afterPoll(current, tried);
        if (step.load !== null) {
          const next = await loadReading(id, step.load);
          if (cancelled) return;
          tried = step.load;
          if (next !== "unsupported") {
            // Word ids come from the analysis, so a selection doesn't carry over
            if (reading !== null) selected = null;
            reading = next;
          }
        }
        // No reading yet, or only one this reader can't use (an old bundle schema)
        if (reading === null && plain === null) {
          const text = await getText(id);
          if (cancelled) return;
          plain = text;
        }
        failures = 0;
        error = null;
        if (step.pollAfter !== null) timer = setTimeout(() => void poll(), step.pollAfter);
      } catch (e: unknown) {
        if (cancelled) return;
        // Offline or the API restarting: keep what's on screen and try again
        failures += 1;
        error = e instanceof Error ? e.message : String(e);
        timer = setTimeout(() => void poll(), retryAfter(failures));
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  function toggle(id: number): void {
    selected = id === selected ? null : id;
  }

  function move(step: number): void {
    if (!doc) return;
    let next = selected ?? (step > 0 ? -1 : doc.words.length);
    do next += step;
    while (doc.words[next]?.punct);
    if (doc.words[next]) selected = next;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowRight") move(1);
    else if (event.key === "ArrowLeft") move(-1);
    else if (event.key === "Escape") selected = null;
    else return;
    event.preventDefault();
  }


  function headText(sentence: number, index: number): string | null {
    const id = doc?.pieceOf.get(tokenKey(sentence, index));
    return id === undefined ? null : (doc?.words[id]?.text ?? null);
  }

  /** Whether the link's word has been looked for: once the text is in, and on each new link. */
  let linked = $state(false);

  /** Opens the word the address links to, with its sheet as the link has it, and scrolls to it. */
  function followLink(): void {
    const link = readLink(location.hash, id);
    const found = link && doc?.pieceOf.get(tokenKey(...link.word));
    if (!link || found === undefined || found === null) return;
    selected = found;
    sheet.view = link.view;
    sheet.layout = link.layout;
    sheet.whole = link.whole;
    void tick().then(() => document.querySelector(".text .w.selected")?.scrollIntoView({ block: "center" }));
  }

  $effect(() => {
    if (!doc || linked) return;
    untrack(followLink);
    linked = true;
  });

  // The address follows the selection, so it can be shared; replaced, not added to the history
  $effect(() => {
    if (!doc || !linked || !location.hash.startsWith(`#/doc/${id}`)) return;
    const word = piece?.words.find((w) => w.token.upos !== "PUNCT") ?? piece?.words[0];
    const query = writeLink(
      word
        ? { word: [word.sentence, word.index], view: sheet.view, layout: sheet.layout, whole: sheet.whole }
        : null,
    );
    const hash = `#/doc/${id}${query}`;
    if (hash !== location.hash) history.replaceState(history.state, "", hash);
  });

  let article = $state<HTMLElement | undefined>();
  /** Where the reader was in this text and how to save it; null if that couldn't be loaded. */
  let positions = $state<Positions | null | undefined>(undefined);
  /** The sentence last saved, or loaded: 0, the start, if there's none. */
  let savedSentence: number | null = null;
  /** Whether the saved position has been offered, once the analysis is in. Nothing is
   * saved before, or the top of the text, where it opens, would replace it. */
  let restored = false;
  /** The saved word, offered until the reader goes there or closes the offer. */
  let resume = $state<WordKey | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const MEASURE_EVERY_MS = 200;

  $effect(() => {
    let cancelled = false;
    positionsOf(id).then(
      (loaded) => {
        if (cancelled) return;
        savedSentence = loaded.saved?.[0] ?? 0;
        positions = loaded;
      },
      () => {
        if (!cancelled) positions = null;
      },
    );
    return () => {
      cancelled = true;
    };
  });

  /** Below the sticky header: where the top of the screen's text is. */
  function topOfText(): number {
    return Math.max(0, document.querySelector("header")?.getBoundingClientRect().bottom ?? 0);
  }

  function elementOf(word: WordKey): HTMLElement | undefined {
    const piece = doc?.pieceOf.get(tokenKey(...word));
    return piece === undefined || !article ? undefined : wordElements(article)[piece];
  }

  // Once the analysis is shown, offer to go back to where the reader was, unless that's on
  // screen already or the address links a word
  $effect(() => {
    if (restored || positions === undefined || !doc || !article) return;
    restored = true;
    const word = positions?.saved ?? null;
    if (word === null || readLink(location.hash, id)) return;
    void tick().then(() => {
      const element = elementOf(word);
      if (element && !onScreen(element)) resume = word;
    });
  });

  /** Removes the offer without moving the text on screen, which is below it. */
  async function dropOffer(): Promise<void> {
    const before = article?.getBoundingClientRect().top;
    resume = null;
    await tick();
    const after = article?.getBoundingClientRect().top;
    if (before !== undefined && after !== undefined && window.scrollY > 0) window.scrollBy({ top: after - before, behavior: "instant" });
  }

  /** Goes to the saved position, once the offer is gone, so the text doesn't move after. */
  async function continueReading(): Promise<void> {
    const word = resume;
    resume = null;
    await tick();
    const element = word && elementOf(word);
    if (element) scrollToTop(element, topOfText());
  }

  /** The sentence at the top of the screen at the last scroll, to save. */
  let pending: number | null = null;
  let measuring = false;

  function measure(): void {
    measuring = false;
    if (!doc || !article?.isConnected) return;
    const piece = doc.words[firstBelow(wordElements(article), topOfText())];
    pending = piece?.words[0]?.sentence ?? null;
  }

  /** Saves the start of the sentence at the top of the screen. */
  function savePosition(keepalive: boolean): void {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const sentence = pending;
    if (!positions || sentence === null || sentence === savedSentence) return;
    // While Continue is offered, the saved place stands, unless the reader reads on past it
    if (resume !== null) {
      if (sentence <= resume[0]) return;
      void dropOffer();
    }
    const previous = savedSentence;
    savedSentence = sentence;
    positions.save([sentence, 0], keepalive).catch(() => {
      // Offline: try again after the next scroll
      if (savedSentence === sentence) savedSentence = previous;
    });
  }

  function onscroll(): void {
    if (!restored) return;
    if (!measuring) {
      measuring = true;
      setTimeout(measure, MEASURE_EVERY_MS);
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePosition(false), SAVE_AFTER_MS);
  }

  // Switching tabs, locking the phone and closing the page all hide it first
  function onvisibilitychange(): void {
    if (document.visibilityState === "hidden" && saveTimer !== undefined) savePosition(true);
  }

  onDestroy(() => {
    if (saveTimer !== undefined) savePosition(true);
  });
</script>

<svelte:window {onkeydown} {onscroll} onhashchange={followLink} />
<svelte:document {onvisibilitychange} />

<div
  class={["reader", { "sheet-open": piece !== undefined, "sentence-open": piece !== undefined && sheet.view === "sentence" }]}
  style:--sheet-width={sheet.width[sheet.view] === null ? undefined : `${sheet.width[sheet.view]}px`}
>
  <main>
    {#if summary}
      {@const licence = LICENCE_INFO[summary.licence]}
      <div class="title-row">
        <h1>{summary.title}</h1>
        <div class="title-actions">
          {#if known.byId}
            <div class="mode">
              <Button
                variant="quiet"
                small
                data-mode={mode}
                aria-describedby="mode-help"
                onclick={() => (mode = mode === "reading" ? "learning" : "reading")}
              >
                {#if mode === "reading"}
                  <svg viewBox="0 0 16 16" aria-hidden="true"
                    ><path d="M8 4.5C6.8 3.6 5 3.2 2.5 3.2v9c2.5 0 4.3.4 5.5 1.3 1.2-.9 3-1.3 5.5-1.3v-9c-2.5 0-4.3.4-5.5 1.3zM8 4.5v9" /></svg
                  >
                  Reading
                {:else}
                  <svg viewBox="0 0 16 16" aria-hidden="true"
                    ><path d="M3 5.5h7.5v7.5H3zM5.5 3H13v7.5" /></svg
                  >
                  Learning
                {/if}
              </Button>
              <span id="mode-help" role="tooltip" class="tip"
                >{mode === "reading"
                  ? "Reading: tapping a word only shows it, and its sheet has an Add to cards button. Click for learning, where tapping a word you haven't marked adds it to your cards."
                  : "Learning: tapping a word you haven't marked adds it to your cards. Click for reading, where tapping only shows the word."}</span
              >
            </div>
          {/if}
          {#if summary.mine}
            <Button variant="quiet" small onclick={() => (editing = true)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2.5 13.5 5 6 12.5 3 13l.5-3z" /></svg>
              Edit
            </Button>
          {/if}
        </div>
      </div>
      <p class="credit">
        {#if summary.author}<span>{summary.author}</span>{/if}
        <span>
          {#if licence.url}<a href={licence.url} rel="license noreferrer">{licence.short}</a>{:else}{licence.short}{/if}
        </span>
        {#if summary.source}<span><a href={summary.source} rel="noreferrer">source</a></span>{/if}
        {#if summary.visibility === "private"}<span>private</span>{/if}
        {#if notice.kind === "queued" || notice.kind === "updating"}
          {@const place = queueText(summary)}
          <em class="processing">{notice.kind === "queued" ? "Queued" : "Updating"}{place ? `: ${place}` : ""}</em>
        {:else if notice.kind === "analysing"}
          <em class="processing">Analysing</em>
        {/if}
      </p>
      {#if resume !== null}
        {@const start = reading?.analysis.sentences[resume[0]]?.tokens[resume[1]]?.start}
        <p class="continue">
          <Button variant="quiet" small onclick={() => void continueReading()}>Continue reading</Button>
          {#if reading && start !== undefined}<span class="from">{snippet(reading.text, start)}</span>{/if}
          <Button variant="icon" aria-label="Close" onclick={() => (resume = null)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </Button>
        </p>
      {/if}
      {#if editing}
        <EditDocument
          {summary}
          onsaved={(saved) => {
            summary = saved;
            editing = false;
          }}
          oncancel={() => (editing = false)}
        />
      {/if}
    {/if}

    {#if notice.kind === "unreachable"}
      <p class="error">Can't reach skolia ({notice.error}); trying again…</p>
    {:else if notice.kind === "failed"}
      <p class="error">
        {notice.previous ? "Updating the analysis failed, so this is the previous one" : "Analysis failed"}:
        {notice.error}
      </p>
    {/if}

    {#if doc}
      <article class="text" lang={reading?.lang} bind:this={article}>
        {#each doc.pieces as p, i (i)}
          <!-- Words are spans, not buttons: a button is laid out as an inline block, so a
               line could break between a word and the punctuation after it -->
          {#if p.kind === "gap"}{p.text}{:else if p.punct}<span class="punct">{p.text}</span>{:else}<span
              role="button"
              tabindex="0"
              class={["w", { selected: p.id === selected, head: p.id === headPiece, trigger: p.id === triggerPiece }]}
              onclick={() => toggle(p.id)}
              onkeydown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle(p.id);
                }
              }}>{p.text}</span
            >{/if}
        {/each}
      </article>
      {#if reading}
        <footer>{reading.bundle.attribution}</footer>
      {/if}
    {:else if plain !== null}
      <article class="text" lang={summary?.lang} bind:this={article}>{plain}</article>
    {/if}
  </main>

  {#if piece && reading}
    <!-- Not remade per word: focus, scroll and the sheet's height carry over -->
    <WordSheet
      lang={reading.lang}
      bundle={reading.bundle}
      {piece}
      {mode}
      {headText}
      {sentenceTokens}
      {sentenceText}
      documentId={id}
      onselectToken={(sentence, index) => (selected = doc?.pieceOf.get(tokenKey(sentence, index)) ?? selected)}
      onclose={() => (selected = null)}
    />
  {/if}
</div>

<!-- Phone first: the word sheet is a bottom sheet; above 900px it's a side panel. -->
<style>
  main {
    max-width: 38rem;
    margin: 0 auto;
    padding: var(--gutter);
  }

  .sheet-open main {
    /* keep the last lines reachable above the bottom sheet */
    padding-bottom: 55vh;
  }

  @media (min-width: 900px) {
    .reader {
      display: grid;
      grid-template-columns: minmax(0, 1fr) var(--sheet-width, 24rem);
    }

    /* A diagram needs more room than a dictionary entry */
    .sentence-open {
      grid-template-columns: minmax(0, 1fr) var(--sheet-width, minmax(24rem, 48vw));
    }

    .sheet-open main {
      padding-bottom: var(--gutter);
    }
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

  .title-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  /* Reading or learning: one button naming the mode, which switches it; what it does on hover
     or keyboard focus */
  .mode {
    position: relative;
  }

  .mode :global(button[data-mode="reading"]) {
    color: var(--muted);
  }

  .mode :global(button[data-mode="learning"]),
  .mode :global(button[data-mode="learning"]:hover:not(:disabled)) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface));
    color: var(--accent);
    font-weight: 600;
  }

  .tip {
    position: absolute;
    top: calc(100% + 0.4rem);
    left: 0;
    z-index: 5;
    width: max-content;
    max-width: min(16rem, calc(100vw - 2 * var(--gutter)));
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--card-shadow);
    color: var(--text);
    font-size: 0.8rem;
    line-height: 1.4;
    pointer-events: none;
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .mode:hover .tip,
  .mode:has(:global(button:focus-visible)) .tip {
    visibility: visible;
    opacity: 1;
    transition-delay: 0.3s;
  }

  @media (max-width: 600px) {
    .title-row {
      position: relative;
    }

    .mode {
      position: static;
    }

    .tip {
      right: 0;
      width: auto;
      max-width: none;
    }
  }

  .credit {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.4rem;
    margin: -0.5rem 0 1rem;
    color: var(--muted);
    font-size: 0.8rem;
  }

  .continue {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
    padding: 0.4rem 0.4rem 0.4rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
  }

  .from {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 0.85rem;
    font-style: italic;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .credit span + span::before {
    content: "·";
    margin-right: 0.4rem;
  }

  .processing {
    font-style: normal;
    margin-left: 0.25rem;
    padding: 0.05rem 0.5rem;
    border-radius: 99px;
    background: var(--line);
    color: var(--text);
    white-space: nowrap;
  }

  .processing::before {
    content: "";
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    margin-right: 0.35rem;
    border-radius: 50%;
    background: var(--accent);
    vertical-align: 0.05rem;
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .processing::before {
      animation: none;
    }
  }

  .error {
    color: var(--error);
  }

  .text {
    font-family: var(--reading);
    font-size: 1.2rem;
    line-height: 1.75;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }

  .w {
    cursor: pointer;
    border-radius: 3px;
    -webkit-tap-highlight-color: transparent;
  }

  .w:hover {
    background: color-mix(in srgb, var(--select) 45%, transparent);
  }

  .w:focus-visible {
    outline: 2px solid var(--accent);
  }

  .w.selected {
    background: var(--select);
  }

  .w.head {
    text-decoration: underline 2px var(--head);
    text-underline-offset: 4px;
  }

  .w.trigger {
    text-decoration: underline 2px dashed var(--trigger);
    text-underline-offset: 4px;
  }

  footer {
    margin-top: 3rem;
    color: var(--muted);
    font-size: 0.75rem;
  }
</style>
