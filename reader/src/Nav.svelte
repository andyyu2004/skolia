<script lang="ts">
  import type { User } from "@skolia/shared/api";
  import { signIn, signOut } from "./lib/api.ts";

  let {
    page,
    user = $bindable(),
    onerror,
  }: {
    page: "explore" | "upload" | "review" | "reader";
    user: User | null | undefined;
    onerror: (message: string) => void;
  } = $props();

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e: unknown) {
      onerror(e instanceof Error ? e.message : String(e));
    }
  }
</script>

<header class="nav">
  <a class="brand" href="#/">skolia</a>
  <nav class="tabs">
    <a href="#/" aria-current={page === "explore" ? "page" : undefined}>Explore</a>
    {#if user}
      <a href="#/upload" aria-current={page === "upload" ? "page" : undefined}>Upload</a>
      <a href="#/review" aria-current={page === "review" ? "page" : undefined}>Review</a>
    {/if}
  </nav>
  <div class="account">
    {#if user}
      {#if user.image}
        <img class="avatar" src={user.image} alt="" referrerpolicy="no-referrer" />
      {/if}
      <span class="muted name">{user.name}</span>
      <button
        type="button"
        class="quiet"
        onclick={() =>
          run(async () => {
            await signOut();
            user = null;
            if (page === "upload" || page === "review") location.hash = "#/";
          })}>Sign out</button
      >
    {:else if user === null}
      <button type="button" class="primary" onclick={() => run(signIn)}>Sign in</button>
    {/if}
  </div>
</header>
