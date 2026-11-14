<script lang="ts">
  import { createMutation, createQuery } from "@tanstack/svelte-query";
  import { DEFAULT_NEW_FORMS_PER_DAY, DEFAULT_NEW_LEMMAS_PER_DAY, MAX_NEW_PER_DAY, type Settings, type User } from "@skolia/shared/api";
  import { saveSettings, signIn } from "../lib/api.ts";
  import { settingsQuery } from "../lib/queries.ts";
  import Button from "../components/Button.svelte";
  import Field from "../components/Field.svelte";
  import Page from "../components/Page.svelte";

  let { user }: { user: User | null | undefined } = $props();

  /** The fields' values, a number null while it's empty; loaded once the settings have come. */
  let newLemmasPerDay = $state<number | null>(null);
  let newFormsPerDay = $state<number | null>(null);
  let formsWithWords = $state(true);
  let loaded = $state(false);

  const settings = createQuery(() => ({ ...settingsQuery, enabled: !!user }));
  const save = createMutation(() => ({
    mutationFn: saveSettings,
    onSuccess: (_saved, sent: Settings, _held, { client }) => client.setQueryData(settingsQuery.queryKey, sent),
  }));
  const error = $derived((save.error ?? settings.error)?.message ?? null);

  $effect(() => {
    if (!settings.data || loaded) return;
    ({ newLemmasPerDay, newFormsPerDay, formsWithWords } = settings.data);
    loaded = true;
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (newLemmasPerDay === null || newFormsPerDay === null || save.isPending) return;
    save.mutate({ newLemmasPerDay, newFormsPerDay, formsWithWords });
  }
</script>

<Page title="Settings">
  {#if user === null}
    <p class="muted">Sign in to change your settings.</p>
    <Button variant="primary" onclick={() => void signIn()}>Sign in</Button>
  {:else if user}
    <form onsubmit={submit}>
      <h2>Review</h2>
      <Field label="New words a day" for="new-lemmas-per-day">
        <input
          id="new-lemmas-per-day"
          type="number"
          inputmode="numeric"
          min="0"
          max={MAX_NEW_PER_DAY}
          step="1"
          required
          disabled={!loaded}
          aria-describedby="new-lemmas-per-day-hint"
          bind:value={newLemmasPerDay}
          oninput={() => save.reset()}
        >
        {#snippet hint()}
          How many words you haven't reviewed before come up each day, in each language, each with its cards for recognising and recalling
          it. The default is {DEFAULT_NEW_LEMMAS_PER_DAY}.
        {/snippet}
      </Field>
      <Field label="New forms a day" for="new-forms-per-day">
        <input
          id="new-forms-per-day"
          type="number"
          inputmode="numeric"
          min="0"
          max={MAX_NEW_PER_DAY}
          step="1"
          required
          disabled={!loaded}
          aria-describedby="new-forms-per-day-hint"
          bind:value={newFormsPerDay}
          oninput={() => save.reset()}
        >
        {#snippet hint()}
          How many new sentences, with a form of a word to fill in, come up each day, in each language. A word's forms wait until you've
          reviewed the word. The default is {DEFAULT_NEW_FORMS_PER_DAY}.
        {/snippet}
      </Field>
      <label class="check">
        <input type="checkbox" disabled={!loaded} bind:checked={formsWithWords} onchange={() => save.reset()}>
        Review forms with words
      </label>
      <div class="actions">
        <Button type="submit" variant="primary" disabled={save.isPending || !loaded}>Save</Button>
        <span role="status" class="muted">{save.isSuccess ? "Saved" : ""}</span>
      </div>
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}
    </form>
  {/if}
</Page>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 28rem;
  }

  input[type="number"] {
    width: 8rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .muted {
    color: var(--muted);
  }

  .error {
    color: var(--error);
  }
</style>
