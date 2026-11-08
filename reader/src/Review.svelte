<script lang="ts">
  import { tick } from "svelte";
  import { LANGUAGE_INFO, RATINGS, isLang, type CardCounts, type Due, type DueCard, type Lang, type Rating, type User } from "@skolia/shared/api";
  import { LANGUAGES } from "@skolia/shared/lang";
  import { lemmaTables, type Table } from "@skolia/shared/paradigm";
  import { UPOS_LABEL } from "@skolia/shared/ud";
  import ParadigmTable from "./ParadigmTable.svelte";
  import { cardCounts, dueCards, review, signIn } from "./lib/api.ts";
  import { clue, keyTarget, shortcut } from "./lib/review.ts";
  import { setStatus } from "./lib/words.svelte.ts";

  /** lang is the URL's (#/review/pl); without one, the language with the most to review. */
  let { user, lang }: { user: User | null | undefined; lang: Lang | null } = $props();

  const GRADE_LABELS: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
  const SHOWN_SENSES = 3;

  let counts = $state<CardCounts[] | null>(null);
  let due = $state<Due | null>(null);
  /** The language due's cards are in, so another language's don't show while it loads. */
  let dueLang = $state<Lang | null>(null);
  let index = $state(0);
  let revealed = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let showButton = $state<HTMLButtonElement | null>(null);
  let goodButton = $state<HTMLButtonElement | null>(null);
  /** Bumped by each load, so an older response can't replace a newer one. */
  let generation = 0;

  const busiest = $derived(
    counts?.reduce<CardCounts | null>((best, c) => (c.due + c.new > (best ? best.due + best.new : 0) ? c : best), null)?.lang ?? null,
  );
  const selected = $derived(lang ?? busiest);
  const card = $derived(due?.cards[index]);
  const left = $derived(due ? due.cards.length - index : 0);

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function loadCounts(): Promise<void> {
    try {
      counts = await cardCounts();
    } catch (e: unknown) {
      error = message(e);
    }
  }

  async function load(language: Lang): Promise<void> {
    const mine = ++generation;
    busy = true;
    error = null;
    if (dueLang !== language) due = null;
    try {
      const next = await dueCards(language);
      if (mine !== generation) return;
      due = next;
      dueLang = language;
      index = 0;
      revealed = false;
    } catch (e: unknown) {
      if (mine === generation) error = message(e);
    } finally {
      if (mine === generation) busy = false;
    }
  }

  $effect(() => {
    if (user) void loadCounts();
  });

  $effect(() => {
    if (user && selected) void load(selected);
  });

  function refresh(): void {
    void loadCounts();
    if (selected) void load(selected);
  }

  async function reveal(): Promise<void> {
    revealed = true;
    await tick();
    goodButton?.focus();
  }

  async function grade(rating: Rating): Promise<void> {
    if (!card || busy) return;
    busy = true;
    error = null;
    try {
      await review(card.id, rating);
      index += 1;
      revealed = false;
    } catch (e: unknown) {
      error = message(e);
    } finally {
      busy = false;
    }
    await tick();
    showButton?.focus();
  }

  /** Known takes the word out of reviews, both its cards, and skips them in this session. */
  async function markKnown(): Promise<void> {
    if (!card || !due || busy) return;
    const { lemmaId } = card;
    busy = true;
    error = null;
    try {
      await setStatus(lemmaId, "known");
      due.cards = [...due.cards.slice(0, index), ...due.cards.slice(index).filter((c) => c.lemmaId !== lemmaId)];
      revealed = false;
    } catch (e: unknown) {
      error = message(e);
    } finally {
      busy = false;
    }
    await tick();
    showButton?.focus();
  }

  function langOf(c: DueCard): Lang | undefined {
    const lang = c.lemmaId.split(":")[0];
    return isLang(lang) ? lang : undefined;
  }

  function glosses(c: DueCard): { gloss: string; tags: string[] }[] {
    const lang = langOf(c);
    const hidden = lang ? LANGUAGES[lang].grammarTags : new Set<string>();
    return (c.entry?.senses ?? []).slice(0, SHOWN_SENSES).map((s) => ({ gloss: s.gloss, tags: s.tags.filter((t) => !hidden.has(t)) }));
  }

  /** Aspect tells apart verbs a clue can't, like pisać and napisać ("to write"). */
  const ASPECTS = new Set(["perfective", "imperfective"]);

  function hintOf(c: DueCard): string {
    const first = c.entry?.senses[0];
    return [UPOS_LABEL[c.entry?.upos ?? "X"], ...(first?.tags.filter((t) => ASPECTS.has(t)) ?? [])].join(" · ");
  }

  function tablesOf(c: DueCard): Table[] {
    const lang = langOf(c);
    if (!lang || !c.entry || !due) return [];
    const sets = due.featureSets;
    const language = LANGUAGES[lang];
    return lemmaTables((id) => sets[String(id)], c.entry, language.paradigm, language.mergeLabels);
  }

  function lemmaOf(c: DueCard): string {
    return c.entry?.lemma ?? c.lemmaId.split(":")[1] ?? c.lemmaId;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (!card || busy) return;
    // KeyboardEvent's fields are getters on its prototype, which a spread wouldn't copy
    const { key, repeat, altKey, ctrlKey, metaKey } = event;
    const action = shortcut({ key, repeat, altKey, ctrlKey, metaKey, target: keyTarget(event.target) }, revealed);
    if (action === null) return;
    event.preventDefault();
    if (action.kind === "reveal") void reveal();
    else void grade(action.rating);
  }
</script>

<svelte:window {onkeydown} />

{#snippet lemma(c: DueCard)}
  <p class="prompt" lang={langOf(c)}>{lemmaOf(c)}</p>
{/snippet}

{#snippet prompt(c: DueCard)}
  {@const first = c.entry?.senses[0]}
  {#if first}
    <p class="prompt">{clue(first.gloss)}</p>
    <p class="muted">{hintOf(c)}</p>
  {:else}
    <p class="muted">No dictionary meaning yet, so this card has no clue.</p>
  {/if}
{/snippet}

{#snippet answer(c: DueCard)}
  {@const lang = langOf(c)}
  {@const said = c.entry?.pronunciations ?? []}
  {#if said.length > 0}
    <p class="pronunciation">
      {#each said as p (p.ipa)}
        <span class="ipa">{#if p.accents}<span class="accent">{p.accents.join(", ")}</span> {/if}{p.ipa}</span>
      {/each}
    </p>
  {/if}
  {@render meanings(c)}
  {@const tables = tablesOf(c)}
  {#if lang && tables.length > 0}
    <details class="forms">
      <summary>Forms</summary>
      {#each tables as table (table.title)}
        <ParadigmTable {lang} {table} />
      {/each}
    </details>
  {/if}
{/snippet}

{#snippet meanings(c: DueCard)}
  {@const senses = glosses(c)}
  <p class="muted">{UPOS_LABEL[c.entry?.upos ?? "X"]}</p>
  {#if senses.length > 0}
    <ul class="glosses">
      {#each senses as sense, i (i)}
        <li>{sense.gloss}{#if sense.tags.length > 0} <span class="tags">{sense.tags.join(", ")}</span>{/if}</li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No dictionary meaning yet.</p>
  {/if}
{/snippet}

<main class="container review">
  <div class="title-row">
    <h1>Review</h1>
    {#if user && counts && counts.length > 0}
      <select
        aria-label="Language"
        value={selected ?? ""}
        onchange={(event) => (location.hash = `#/review/${event.currentTarget.value}`)}
      >
        {#if !selected}
          <option value="" disabled>Choose a language</option>
        {:else if !counts.some((c) => c.lang === selected)}
          <option value={selected}>{LANGUAGE_INFO[selected].flag} {LANGUAGE_INFO[selected].endonym}</option>
        {/if}
        {#each counts as c (c.lang)}
          <option value={c.lang}>{LANGUAGE_INFO[c.lang].flag} {LANGUAGE_INFO[c.lang].endonym} · {c.due} due · {c.new} new</option>
        {/each}
      </select>
    {/if}
  </div>
  {#if user === null}
    <p class="muted">Sign in to review your words.</p>
    <button type="button" class="primary" onclick={() => void signIn()}>Sign in</button>
  {:else if !counts}
    {#if !error}<p class="muted">Loading…</p>{/if}
  {/if}
  {#if user && counts && !selected}
    <p>Nothing to review right now. Words you look up in the reader turn into cards here.</p>
    <button type="button" class="quiet" onclick={refresh}>Check again</button>
  {:else if user && selected && !due}
    {#if !error}<p class="muted">Loading…</p>{/if}
  {:else if user && due}
    <p class="counts muted">{left} to go · {due.newLeft} new left today · <a href="#/settings">Settings</a></p>
    {#if card}
      <section class="flashcard" aria-live="polite" aria-atomic="true">
        <button type="button" class="known quiet" disabled={busy} title="You know this word: stop reviewing it" onclick={markKnown}
          >Known</button
        >
        {#if card.kind === "recognition"}
          {@render lemma(card)}
        {:else}
          {@render prompt(card)}
        {/if}
        {#if revealed}
          <hr />
          {#if card.kind === "production"}{@render lemma(card)}{/if}
          {@render answer(card)}
        {/if}
      </section>
      {#if revealed}
        <div class="grades">
          {#each RATINGS as rating (rating)}
            {#if rating === 3}
              <button type="button" class="primary" disabled={busy} aria-keyshortcuts={String(rating)} bind:this={goodButton} onclick={() => grade(rating)}
                >{GRADE_LABELS[rating]}</button
              >
            {:else}
              <button type="button" class="quiet" disabled={busy} aria-keyshortcuts={String(rating)} onclick={() => grade(rating)}
                >{GRADE_LABELS[rating]}</button
              >
            {/if}
          {/each}
        </div>
        <p class="muted hint">Keys 1 to 4 grade the card.</p>
      {:else}
        <button type="button" class="primary" disabled={busy} aria-keyshortcuts="Space Enter" bind:this={showButton} onclick={reveal}
          >Show answer</button
        >
        <p class="muted hint">Space or Enter shows the answer.</p>
      {/if}
    {:else}
      <p>Nothing to review right now. Words you look up in the reader turn into cards here.</p>
      <button type="button" class="quiet" disabled={busy} onclick={refresh}>Check again</button>
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</main>
