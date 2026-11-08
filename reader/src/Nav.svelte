<script lang="ts">
  import type { User } from "@skolia/shared/api";
  import { signIn, signOut } from "./lib/api.ts";

  let {
    page,
    user = $bindable(),
    onerror,
  }: {
    page: "explore" | "upload" | "review" | "settings" | "reader";
    user: User | null | undefined;
    onerror: (message: string) => void;
  } = $props();

  /** The account menu: a popover, so the browser closes it on Escape or a click outside
   * and gives focus back to its button. */
  let menu = $state<HTMLElement | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e: unknown) {
      onerror(e instanceof Error ? e.message : String(e));
    }
  }

  function initial(name: string): string {
    return name.trim().charAt(0).toUpperCase() || "?";
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
      <button type="button" class="avatar-button" popovertarget="account-menu" aria-label="Account: {user.name}">
        {#if user.image}
          <img class="avatar" src={user.image} alt="" referrerpolicy="no-referrer" />
        {:else}
          <span class="avatar initial" aria-hidden="true">{initial(user.name)}</span>
        {/if}
      </button>
      <div id="account-menu" class="account-menu" popover bind:this={menu}>
        <p class="who">
          <span class="muted">Signed in as</span>
          <strong>{user.name}</strong>
          <span class="muted email">{user.email}</span>
        </p>
        <ul>
          <li>
            <a href="#/settings" aria-current={page === "settings" ? "page" : undefined} onclick={() => menu?.hidePopover()}
              >Settings</a
            >
          </li>
          <li>
            <button
              type="button"
              onclick={() =>
                run(async () => {
                  menu?.hidePopover();
                  await signOut();
                  user = null;
                  if (page === "upload" || page === "review" || page === "settings") location.hash = "#/";
                })}>Sign out</button
            >
          </li>
        </ul>
      </div>
    {:else if user === null}
      <button type="button" class="primary" onclick={() => run(signIn)}>Sign in</button>
    {/if}
  </div>
</header>
