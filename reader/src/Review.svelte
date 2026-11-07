<script lang="ts">
  import { MAX_NEW_PER_DAY, RATINGS, isLang, type Due, type DueCard, type Lang, type Rating, type User } from "@skolia/shared/api";
  import { LANGUAGES } from "@skolia/shared/lang";
  import { UPOS_LABEL } from "@skolia/shared/ud";
  import { dueCards, getSettings, review, saveSettings, signIn } from "./lib/api.ts";

  let { user }: { user: User | null | undefined } = $props();

  const GRADE_LABELS: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
  const SHOWN_SENSES = 3;

  let due = $state<Due | null>(null);
  let index = $state(0);
  let revealed = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let newPerDay = $state<number | null>(null);

  const card = $derived(due?.cards[index]);
  const left = $derived(due ? due.cards.length - index : 0);

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function load(): Promise<void> {
    error = null;
    try {
      const [next, settings] = await Promise.all([dueCards(), getSettings()]);
      due = next;
      newPerDay = settings.newPerDay;
      index = 0;
      revealed = false;
    } catch (e: unknown) {
      error = message(e);
    }
  }

  $effect(() => {
    if (user) void load();
  });

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
  }

  async function saveNewPerDay(): Promise<void> {
    if (newPerDay === null) return;
    error = null;
    try {
      await saveSettings({ newPerDay });
      await load();
    } catch (e: unknown) {
      error = message(e);
    }
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

  function lemmaOf(c: DueCard): string {
    return c.entry?.lemma ?? c.lemmaId.split(":")[1] ?? c.lemmaId;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (!card || event.target instanceof HTMLInputElement) return;
    if (!revealed && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      revealed = true;
    } else if (revealed) {
      const rating = RATINGS.find((r) => String(r) === event.key);
      if (rating !== undefined) void grade(rating);
    }
  }
</script>

<svelte:window {onkeydown} />

{#snippet lemma(c: DueCard)}
  <p class="prompt" lang={langOf(c)}>{lemmaOf(c)}</p>
{/snippet}

{#snippet meanings(c: DueCard)}
  <p class="muted">{UPOS_LABEL[c.entry?.upos ?? "X"]}</p>
  {#if glosses(c).length > 0}
    <ul class="glosses">
      {#each glosses(c) as sense, i (i)}
        <li>{sense.gloss}{#if sense.tags.length > 0} <span class="tags">{sense.tags.join(", ")}</span>{/if}</li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No dictionary meaning yet.</p>
  {/if}
{/snippet}

<main class="container review">
  <h1>Review</h1>
  {#if user === null}
    <p class="muted">Sign in to review your words.</p>
    <button type="button" class="primary" onclick={() => void signIn()}>Sign in</button>
  {:else if due}
    <p class="counts muted">{left} to go · {due.newLeft} new left today</p>
    {#if card}
      <section class="flashcard" aria-live="polite">
        {#if card.kind === "recognition"}
          {@render lemma(card)}
        {:else}
          {@render meanings(card)}
        {/if}
        {#if revealed}
          <hr />
          {#if card.kind === "recognition"}
            {@render meanings(card)}
          {:else}
            {@render lemma(card)}
          {/if}
        {/if}
      </section>
      {#if revealed}
        <div class="grades">
          {#each RATINGS as rating (rating)}
            <button type="button" class={rating === 3 ? "primary" : "quiet"} disabled={busy} onclick={() => grade(rating)}
              >{GRADE_LABELS[rating]}</button
            >
          {/each}
        </div>
      {:else}
        <button type="button" class="primary" onclick={() => (revealed = true)}>Show answer</button>
      {/if}
    {:else}
      <p>Nothing to review right now. Words you choose to learn in the reader turn into cards here.</p>
      <button type="button" class="quiet" onclick={() => void load()}>Check again</button>
    {/if}
    {#if newPerDay !== null}
      <form
        class="settings"
        onsubmit={(event) => {
          event.preventDefault();
          void saveNewPerDay();
        }}
      >
        <label for="new-per-day">New cards a day</label>
        <input id="new-per-day" type="number" min="0" max={MAX_NEW_PER_DAY} step="1" bind:value={newPerDay} />
        <button type="submit" class="quiet">Save</button>
      </form>
    {/if}
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
</main>
