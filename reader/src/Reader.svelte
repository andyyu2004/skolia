<script lang="ts">
  import type { DocumentSummary } from "@skolia/shared/api";
  import { getDocument, loadReading, type Reading } from "./lib/api.ts";
  import { layout, tokenKey, type Layout } from "./lib/doc.ts";
  import WordSheet from "./WordSheet.svelte";

  let { id }: { id: string } = $props();

  const POLL_MS = 1500;

  let summary = $state<DocumentSummary | null>(null);
  let reading = $state<Reading | null>(null);
  let error = $state<string | null>(null);
  let selected = $state<number | null>(null);

  const doc: Layout | null = $derived(reading ? layout(reading.text, reading.analysis) : null);
  const piece = $derived(doc && selected !== null ? doc.words[selected] : undefined);

  /** The piece holding the selected word's head, to mark it in the text. */
  const headPiece = $derived.by(() => {
    const word = piece?.words.find((w) => w.token.upos !== "PUNCT");
    if (!doc || !word || word.token.head === null) return null;
    return doc.pieceOf.get(tokenKey(word.sentence, word.token.head)) ?? null;
  });

  $effect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(): Promise<void> {
      try {
        const current = await getDocument(id);
        if (cancelled) return;
        summary = current;
        if (current.state === "ready") {
          reading = await loadReading(current);
        } else if (current.state !== "failed") {
          timer = setTimeout(() => void poll(), POLL_MS);
        }
      } catch (e: unknown) {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

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
    <nav><a href="#/">← Library</a></nav>
    {#if summary}
      <h1>{summary.title}</h1>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {:else if summary?.state === "failed"}
      <p class="error">Analysis failed: {summary.error ?? "unknown error"}</p>
    {:else if !doc}
      <p class="muted">{summary?.state === "analysing" ? "Analysing…" : summary ? "Queued…" : "Loading…"}</p>
    {:else}
      <article class="text" lang="pl">
        {#each doc.pieces as p, i (i)}
          {#if p.kind === "gap"}{p.text}{:else if p.punct}<span class="punct">{p.text}</span>{:else}<button
              type="button"
              class="w"
              class:selected={p.id === selected}
              class:head={p.id === headPiece}
              onclick={() => (selected = p.id === selected ? null : p.id)}>{p.text}</button
            >{/if}
        {/each}
      </article>
      {#if reading}
        <footer class="attribution muted">{reading.bundle.attribution}</footer>
      {/if}
    {/if}
  </main>

  {#if piece && reading}
    <WordSheet bundle={reading.bundle} {piece} {headText} onclose={() => (selected = null)} />
  {/if}
</div>
