<script lang="ts">
  import { tick } from "svelte";
  import {
    CARD_GROUPS,
    LANGUAGE_INFO,
    blankParts,
    RATINGS,
    isLang,
    type CardCounts,
    type CardGroup,
    type Cloze,
    type Due,
    type DueCard,
    type Lang,
    type Rating,
    type User,
  } from "@skolia/shared/api";
  import { LANGUAGES } from "@skolia/shared/lang";
  import { formTables, lemmaTables, type Table } from "@skolia/shared/paradigm";
  import { featureWords, UPOS_LABEL } from "@skolia/shared/ud";
  import Button from "../components/Button.svelte";
  import Page from "../components/Page.svelte";
  import ParadigmTable from "../components/ParadigmTable.svelte";
  import Pronunciations from "../components/Pronunciations.svelte";
  import { cardCounts, deleteCloze, dueCards, getSettings, review, signIn } from "../lib/api.ts";
  import { clue, keyTarget, shortcut } from "../lib/review.ts";
  import { setStatus } from "../lib/words.svelte.ts";

  /** lang and group are the URL's (#/review/pl/forms); without a language, the one with the
   * most to review. group only counts when the settings review forms on their own: without
   * one, words, unless only forms have something. */
  let { user, lang, group: wanted }: { user: User | null | undefined; lang: Lang | null; group: CardGroup | null } = $props();

  const GRADE_LABELS: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
  const GROUP_LABELS: Record<CardGroup, string> = { words: "Words", forms: "Forms" };
  const SHOWN_SENSES = 3;

  let counts = $state<CardCounts[] | null>(null);
  /** Whether forms have their own session; null until the settings have come. */
  let split = $state<boolean | null>(null);
  let due = $state<Due | null>(null);
  /** The language and group due's cards are from, so others' don't show while it loads. */
  let dueFor = $state<string | null>(null);
  let index = $state(0);
  let revealed = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let showButton = $state<HTMLButtonElement | null>(null);
  let goodButton = $state<HTMLButtonElement | null>(null);
  /** Bumped by each load, so an older response can't replace a newer one. */
  let generation = 0;

  /** Cards to review in one group, or with none in both. */
  function toReview(c: CardCounts, group: CardGroup | null = null): number {
    const groups: readonly CardGroup[] = group ? [group] : CARD_GROUPS;
    return groups.reduce((n, g) => n + c[g].due + c[g].new, 0);
  }

  const busiest = $derived(counts?.reduce<CardCounts | null>((best, c) => (toReview(c) > (best ? toReview(best) : 0) ? c : best), null)?.lang ?? null);
  const selected = $derived(lang ?? busiest);
  const withCards = $derived((counts ?? []).filter((c) => toReview(c) > 0));
  const selectedCounts = $derived(counts?.find((c) => c.lang === selected) ?? null);
  const group = $derived<CardGroup | null>(
    split ? (wanted ?? (selectedCounts && toReview(selectedCounts, "words") === 0 && toReview(selectedCounts, "forms") > 0 ? "forms" : "words")) : null,
  );
  const card = $derived(due?.cards[index]);
  const left = $derived(due ? due.cards.length - index : 0);

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function loadCounts(): Promise<void> {
    try {
      const [loaded, settings] = await Promise.all([cardCounts(), getSettings()]);
      counts = loaded;
      split = !settings.formsWithWords;
    } catch (e: unknown) {
      error = message(e);
    }
  }

  async function load(language: Lang, group: CardGroup | null): Promise<void> {
    const mine = ++generation;
    const key = `${language}/${group ?? ""}`;
    busy = true;
    error = null;
    if (dueFor !== key) due = null;
    try {
      const next = await dueCards(language, group);
      if (mine !== generation) return;
      due = next;
      dueFor = key;
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
    if (user && selected && split !== null) void load(selected, group);
  });

  function refresh(): void {
    void loadCounts();
    if (selected && split !== null) void load(selected, group);
  }

  function newLeft(left: Due["newLeft"]): string {
    if (group === "words") return `${left.words} new words left today`;
    if (group === "forms") return `${left.forms} new forms left today`;
    return `${left.words} new words and ${left.forms} new forms left today`;
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

  /** Known takes the word out of reviews, all its cards, and skips them in this session. */
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

  /** Deletes a cloze card, made from a sentence the parser got wrong or one not worth
   * practising, with its reviews. */
  async function removeCloze(): Promise<void> {
    if (!card || !due || busy || !confirm("Delete this card and its reviews?")) return;
    const { id } = card;
    busy = true;
    error = null;
    try {
      await deleteCloze(id);
      due.cards = due.cards.filter((c) => c.id !== id);
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
    const featsOf = (id: number) => sets[String(id)];
    return c.cloze
      ? formTables(featsOf, c.entry, { text: blankOf(c.cloze), feats: c.cloze.feats }, language.paradigm, language.mergeLabels)
      : lemmaTables(featsOf, c.entry, language.paradigm, language.mergeLabels);
  }

  function blankOf(cloze: Cloze): string {
    return blankParts(cloze).blank;
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

<!-- The sentence with the word left blank and its lemma to go on, or filled in -->
{#snippet sentence(c: DueCard, cloze: Cloze, filled: boolean)}
  {@const parts = blankParts(cloze)}
  <p class="sentence" lang={langOf(c)}>
    {parts.before}{#if filled}<mark>{parts.blank}</mark>{:else}<span class="blank"
        ><span class="visually-hidden">blank</span></span
      > <span class="base">({lemmaOf(c)})</span>{/if}{parts.after}
  </p>
{/snippet}

{#snippet why(cloze: Cloze)}
  {@const grammar = featureWords(cloze.feats)}
  {#if grammar.length > 0}<p class="muted">{grammar.join(" · ")}</p>{/if}
  {#if cloze.why}<p class="why">{cloze.why}</p>{/if}
  <p class="source"><a href="#/doc/{cloze.documentId}">Open the text</a></p>
{/snippet}

{#snippet answer(c: DueCard)}
  {@const lang = langOf(c)}
  {@const said = c.entry?.pronunciations ?? []}
  {#if said.length > 0}
    <Pronunciations {said} />
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

<Page title="Review">
  {#snippet actions()}
    {#if user && counts && (withCards.length > 0 || selected)}
      <select
        aria-label="Language"
        value={selected ?? ""}
        onchange={(event) => (location.hash = `#/review/${event.currentTarget.value}${wanted ? `/${wanted}` : ""}`)}
      >
        {#if !selected}
          <option value="" disabled>Choose a language</option>
        {:else if !withCards.some((c) => c.lang === selected)}
          <option value={selected}>{LANGUAGE_INFO[selected].flag} {LANGUAGE_INFO[selected].endonym}</option>
        {/if}
        {#each withCards as c (c.lang)}
          <option value={c.lang}
            >{LANGUAGE_INFO[c.lang].flag} {LANGUAGE_INFO[c.lang].endonym} · {c.words.due + c.forms.due} due · {c.words.new + c.forms.new} new</option
          >
        {/each}
      </select>
    {/if}
  {/snippet}
  <div class="review">
  {#if user === null}
    <p class="muted">Sign in to review your words.</p>
    <Button variant="primary" onclick={() => void signIn()}>Sign in</Button>
  {:else if !counts}
    {#if !error}<p class="muted">Loading…</p>{/if}
  {/if}
  {#if user && counts && !selected}
    <p>Nothing to review right now. Words you look up in the reader turn into cards here.</p>
    <Button variant="quiet" onclick={refresh}>Check again</Button>
  {/if}
  {#if user && selected && group}
    <nav class="groups" aria-label="Cards to review">
      {#each CARD_GROUPS as g (g)}
        <a href="#/review/{selected}/{g}" aria-current={g === group ? "page" : undefined}
          >{GROUP_LABELS[g]}{#if selectedCounts}{" "}<span class="count">{toReview(selectedCounts, g)}</span>{/if}</a
        >
      {/each}
    </nav>
  {/if}
  {#if user && selected && !due}
    {#if !error}<p class="muted">Loading…</p>{/if}
  {:else if user && due}
    <p class="counts muted">{left} to go · {newLeft(due.newLeft)} · <a href="#/settings">Settings</a></p>
    {#if card}
      <section class="flashcard" aria-live="polite" aria-atomic="true">
        <div class="known">
          {#if card.cloze}
            <Button variant="quiet" small disabled={busy} title="Delete this card and its reviews" onclick={removeCloze}>Delete</Button>
          {:else}
            <Button variant="quiet" small disabled={busy} title="You know this word: stop reviewing it" onclick={markKnown}>Known</Button>
          {/if}
        </div>
        {#if card.cloze}
          {@render sentence(card, card.cloze, revealed)}
        {:else if card.kind === "recognition"}
          {@render lemma(card)}
        {:else}
          {@render prompt(card)}
        {/if}
        {#if revealed}
          <hr />
          {#if card.cloze}
            {@render why(card.cloze)}
          {:else if card.kind === "production"}
            {@render lemma(card)}
          {/if}
          {@render answer(card)}
        {/if}
      </section>
      {#if revealed}
        <div class="grades">
          {#each RATINGS as rating (rating)}
            {#if rating === 3}
              <Button variant="primary" disabled={busy} aria-keyshortcuts={String(rating)} bind:element={goodButton} onclick={() => grade(rating)}
                >{GRADE_LABELS[rating]}</Button
              >
            {:else}
              <Button variant="quiet" disabled={busy} aria-keyshortcuts={String(rating)} onclick={() => grade(rating)}
                >{GRADE_LABELS[rating]}</Button
              >
            {/if}
          {/each}
        </div>
        <p class="hint">Keys 1 to 4 grade the card.</p>
      {:else}
        <Button variant="primary" disabled={busy} aria-keyshortcuts="Space Enter" bind:element={showButton} onclick={reveal}
          >Show answer</Button
        >
        <p class="hint">Space or Enter shows the answer.</p>
      {/if}
    {:else}
      <p>Nothing to review right now. Words you look up in the reader turn into cards here.</p>
      <Button variant="quiet" disabled={busy} onclick={refresh}>Check again</Button>
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
</Page>

<style>
  .review {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .counts,
  .hint {
    margin: 0;
  }

  .groups {
    display: flex;
    gap: 1.25rem;
    border-bottom: 1px solid var(--line);
  }

  .groups a {
    margin-bottom: -1px;
    padding: 0.55rem 0.1rem;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    text-decoration: none;
  }

  .groups a:hover {
    color: var(--text);
  }

  .groups a[aria-current="page"] {
    border-bottom-color: var(--accent);
    color: var(--text);
  }

  .groups .count {
    color: var(--muted);
    font-size: 0.85em;
  }

  .muted {
    color: var(--muted);
  }

  .error {
    color: var(--error);
  }

  .hint {
    color: var(--muted);
    font-size: 0.85rem;
    text-align: center;
  }

  .flashcard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 2rem var(--gutter);
    min-height: 12rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    text-align: center;
    position: relative;
  }

  .known {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    color: var(--muted);
  }

  .prompt {
    font-family: var(--reading);
    font-size: 2rem;
    margin: 0;
  }

  .sentence {
    font-family: var(--reading);
    font-size: 1.5rem;
    line-height: 1.6;
    margin: 0;
  }

  .blank {
    display: inline-block;
    width: 3em;
    border-bottom: 2px solid var(--muted);
  }

  .base {
    color: var(--muted);
  }

  mark {
    background: none;
    color: inherit;
    font-weight: 600;
    border-bottom: 2px solid var(--accent);
  }

  .why,
  .source {
    margin: 0;
  }

  .source {
    font-size: 0.85rem;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .glosses {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 1.1rem;
  }

  .tags {
    font-size: 0.75rem;
    color: var(--muted);
    margin-left: 0.3rem;
  }

  hr {
    width: 100%;
    border: 0;
    border-top: 1px solid var(--line);
  }

  .forms {
    margin-top: 0.75rem;
    text-align: left;
  }

  .forms summary {
    cursor: pointer;
    color: var(--muted);
  }

  .grades {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }

  .grades :global(button) {
    padding-inline: 0;
  }
</style>
