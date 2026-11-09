<script lang="ts">
  import type { DocumentSummary, ReadingNames } from "@skolia/shared/api";
  import { LICENCE_INFO } from "@skolia/shared/api";
  import type { Token } from "@skolia/shared/schema";
  import { getDocument, getText, loadReading, type Reading } from "./lib/api.ts";
  import { layout, tokenKey, type Layout } from "@skolia/shared/doc";
  import { afterPoll, notice as noticeFor, queueText, retryAfter } from "./lib/reading.ts";
  import EditDocument from "./EditDocument.svelte";
  import WordSheet from "./WordSheet.svelte";
  import { sheet } from "./lib/sheet.svelte.ts";
  import { readLink, writeLink } from "./lib/link.ts";
  import { tick, untrack } from "svelte";
  import type { ReaderMode } from "./lib/mode.ts";
  import { words as known } from "./lib/words.svelte.ts";

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
</script>

<svelte:window {onkeydown} onhashchange={followLink} />

<div
  class="reader"
  class:sheet-open={piece !== undefined}
  class:sentence-open={piece !== undefined && sheet.view === "sentence"}
  style:--sheet-width={sheet.width[sheet.view] === null ? undefined : `${sheet.width[sheet.view]}px`}
>
  <main class="page">
    {#if summary}
      {@const licence = LICENCE_INFO[summary.licence]}
      <div class="title-row">
        <h1>{summary.title}</h1>
        <div class="title-actions">
          {#if known.byId}
            <div class="mode">
              <button
                type="button"
                class="quiet small with-icon {mode}"
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
              </button>
              <span id="mode-help" role="tooltip" class="tip"
                >{mode === "reading"
                  ? "Reading: tapping a word only shows it, and its sheet has an Add to cards button. Click for learning, where tapping a word you haven't marked adds it to your cards."
                  : "Learning: tapping a word you haven't marked adds it to your cards. Click for reading, where tapping only shows the word."}</span
              >
            </div>
          {/if}
          {#if summary.mine}
            <button type="button" class="quiet small with-icon" onclick={() => (editing = true)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2.5 13.5 5 6 12.5 3 13l.5-3z" /></svg>
              Edit
            </button>
          {/if}
        </div>
      </div>
      <p class="credit muted small">
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
      <article class="text" lang={reading?.lang}>
        {#each doc.pieces as p, i (i)}
          <!-- Words are spans, not buttons: a button is laid out as an inline block, so a
               line could break between a word and the punctuation after it -->
          {#if p.kind === "gap"}{p.text}{:else if p.punct}<span class="punct">{p.text}</span>{:else}<span
              role="button"
              tabindex="0"
              class="w"
              class:selected={p.id === selected}
              class:head={p.id === headPiece}
              class:trigger={p.id === triggerPiece}
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
        <footer class="attribution muted">{reading.bundle.attribution}</footer>
      {/if}
    {:else if plain !== null}
      <article class="text" lang={summary?.lang}>{plain}</article>
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
      onselectToken={(sentence, index) => (selected = doc?.pieceOf.get(tokenKey(sentence, index)) ?? selected)}
      onclose={() => (selected = null)}
    />
  {/if}
</div>
