<script lang="ts">
  import { useQueryClient } from "@tanstack/svelte-query";
  import type { User } from "@skolia/shared/api";
  import { signIn, signOut } from "../lib/api.ts";
  import { forgetUser } from "../lib/queries.ts";
  import Button from "./Button.svelte";

  let {
    page,
    user,
    onerror,
  }: {
    page: "explore" | "list" | "upload" | "review" | "settings" | "reader";
    user: User | null | undefined;
    onerror: (message: string) => void;
  } = $props();

  /** The account menu: a popover, so the browser closes it on Escape or a click outside
   * and gives focus back to its button. */
  let menu = $state<HTMLElement | null>(null);
  const client = useQueryClient();

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

<header>
  <a class="brand" href="#/">skolia</a>
  <nav>
    <a href="#/" aria-current={page === "explore" ? "page" : undefined}>Explore</a>
    {#if user}
      <a href="#/list" aria-current={page === "list" ? "page" : undefined}>My list</a>
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
                  if (page === "list" || page === "upload" || page === "review" || page === "settings") location.hash = "#/";
                  await forgetUser(client);
                })}>Sign out</button
            >
          </li>
        </ul>
      </div>
    {:else if user === null}
      <Button variant="primary" onclick={() => run(signIn)}>Sign in</Button>
    {/if}
  </div>
</header>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 1rem;
    height: var(--nav-height);
    padding: 0 var(--gutter);
    background: color-mix(in srgb, var(--bg) 90%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line);
  }

  .brand {
    font-family: var(--reading);
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
  }

  nav {
    display: flex;
    gap: 0.25rem;
    height: 100%;
  }

  nav a {
    display: flex;
    align-items: center;
    padding: 0 0.6rem;
    color: var(--muted);
    text-decoration: none;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
  }

  @media (max-width: 480px) {
    header {
      gap: 0.5rem;
    }

    nav {
      gap: 0;
    }

    nav a {
      padding: 0 0.45rem;
    }
  }

  nav a:hover {
    color: var(--text);
  }

  nav a[aria-current="page"] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .account {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .avatar {
    display: block;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
  }

  .initial {
    display: grid;
    place-items: center;
    background: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }

  .avatar-button {
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }

  .avatar-button:hover,
  .avatar-button:focus-visible {
    border-color: var(--accent);
  }

  /* The popover sits in the top layer, under the nav's right edge */
  .account-menu {
    position: fixed;
    inset: calc(var(--nav-height) + 0.25rem) var(--gutter) auto auto;
    margin: 0;
    min-width: 14rem;
    max-width: calc(100vw - 2 * var(--gutter));
    padding: 0.25rem 0;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.15);
  }

  .who {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0.5rem 1rem 0.6rem;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }

  .muted {
    color: var(--muted);
  }

  .email {
    font-size: 0.85rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
  }

  .account-menu a,
  .account-menu button {
    display: block;
    width: 100%;
    padding: 0.5rem 1rem;
    border: 0;
    background: none;
    color: var(--text);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .account-menu a:hover,
  .account-menu a:focus-visible,
  .account-menu button:hover,
  .account-menu button:focus-visible {
    background: var(--current);
    outline: none;
  }
</style>
