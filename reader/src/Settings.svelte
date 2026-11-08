<script lang="ts">
  import { DEFAULT_NEW_PER_DAY, MAX_NEW_PER_DAY, type User } from "@skolia/shared/api";
  import { getSettings, saveSettings, signIn } from "./lib/api.ts";

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

<main class="container">
  <h1>Settings</h1>
  {#if user === null}
    <p class="muted">Sign in to change your settings.</p>
    <button type="button" class="primary" onclick={() => void signIn()}>Sign in</button>
  {:else if user}
    <form class="settings-form" onsubmit={submit}>
      <h2>Review</h2>
      <div class="field">
        <label for="new-per-day">New cards a day</label>
        <input
          id="new-per-day"
          type="number"
          inputmode="numeric"
          min="0"
          max={MAX_NEW_PER_DAY}
          step="1"
          required
          disabled={!loaded}
          aria-describedby="new-per-day-help"
          bind:value={newPerDay}
          oninput={() => (saved = false)}
        />
        <span id="new-per-day-help" class="muted"
          >How many cards you haven't reviewed before come up each day, in each language. The default is {DEFAULT_NEW_PER_DAY}.</span
        >
      </div>
      <div class="actions">
        <button type="submit" class="primary" disabled={saving || !loaded}>Save</button>
        <span role="status" class="muted">{saved ? "Saved" : ""}</span>
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </form>
  {/if}
</main>
