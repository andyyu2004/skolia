<script lang="ts">
  import { DEFAULT_NEW_PER_DAY, MAX_NEW_PER_DAY, type User } from "@skolia/shared/api";
  import { getSettings, saveSettings, signIn } from "../lib/api.ts";
  import Button from "../components/Button.svelte";
  import Field from "../components/Field.svelte";
  import Page from "../components/Page.svelte";

  let { user }: { user: User | null | undefined } = $props();

  /** The field's value, null while it's empty; loaded once the settings have come. */
  let newPerDay = $state<number | null>(null);
  let loaded = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  let error = $state<string | null>(null);

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  $effect(() => {
    if (!user) return;
    let current = true;
    getSettings().then(
      (settings) => {
        if (!current) return;
        newPerDay = settings.newPerDay;
        loaded = true;
      },
      (e: unknown) => {
        if (current) error = message(e);
      },
    );
    return () => {
      current = false;
    };
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (newPerDay === null || saving) return;
    saving = true;
    saved = false;
    error = null;
    try {
      await saveSettings({ newPerDay });
      saved = true;
    } catch (e: unknown) {
      error = message(e);
    } finally {
      saving = false;
    }
  }
</script>

<Page title="Settings">
  {#if user === null}
    <p class="muted">Sign in to change your settings.</p>
    <Button variant="primary" onclick={() => void signIn()}>Sign in</Button>
  {:else if user}
    <form onsubmit={submit}>
      <h2>Review</h2>
      <Field label="New cards a day" for="new-per-day">
        <input
          id="new-per-day"
          type="number"
          inputmode="numeric"
          min="0"
          max={MAX_NEW_PER_DAY}
          step="1"
          required
          disabled={!loaded}
          aria-describedby="new-per-day-hint"
          bind:value={newPerDay}
          oninput={() => (saved = false)}
        />
        {#snippet hint()}
          How many cards you haven't reviewed before come up each day, in each language. The default is {DEFAULT_NEW_PER_DAY}.
        {/snippet}
      </Field>
      <div class="actions">
        <Button type="submit" variant="primary" disabled={saving || !loaded}>Save</Button>
        <span role="status" class="muted">{saved ? "Saved" : ""}</span>
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
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

  input {
    width: 8rem;
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
