<script lang="ts">
  import type { DocumentSummary, ReadingNames } from "@skolia/shared/api";
  import { LICENCE_INFO } from "@skolia/shared/api";
  import type { Token } from "@skolia/shared/schema";
  import { getDocument, getText, loadReading, type Reading } from "./lib/api.ts";
  import { layout, tokenKey, type Layout } from "@skolia/shared/doc";
  import { afterPoll, notice as noticeFor, retryAfter } from "./lib/reading.ts";
  import WordSheet from "./WordSheet.svelte";

  let { id }: { id: string } = $props();

  let summary = $state<DocumentSummary | null>(null);
  let reading = $state<Reading | null>(null);
  /** The plain text, shown until a reading is. */
  let plain = $state<string | null>(null);
  let error = $state<string | null>(null);
  let selected = $state<number | null>(null);

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
        if (step.load === null && reading === null && plain === null) {
          const text = await getText(id);
          if (cancelled) return;
          plain = text;
        }
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
</script>

<svelte:window {onkeydown} />

<div class="reader" class:sheet-open={piece !== undefined}>
  <main class="page">
    {#if summary}
      {@const licence = LICENCE_INFO[summary.licence]}
      <h1>{summary.title}</h1>
      <p class="credit muted small">
        {#if summary.author}<span>{summary.author}</span>{/if}
        <span>
          {#if licence.url}<a href={licence.url} rel="license noreferrer">{licence.short}</a>{:else}{licence.short}{/if}
        </span>
        {#if summary.source}<span><a href={summary.source} rel="noreferrer">source</a></span>{/if}
        {#if summary.visibility === "private"}<span>private</span>{/if}
        {#if notice.kind === "processing" || notice.kind === "updating"}
          <em class="processing">{notice.kind === "processing" ? "Processing…" : "Updating…"}</em>
        {/if}
      </p>
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
    <!-- Keyed, so a new word starts with its lists folded -->
    {#key selected}
      <WordSheet
        lang={reading.lang}
        bundle={reading.bundle}
        {piece}
        {headText}
        {sentenceTokens}
        onclose={() => (selected = null)}
      />
    {/key}
  {/if}
</div>
