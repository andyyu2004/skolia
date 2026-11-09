<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  /** danger: a quiet button in the error colour; destructive: a filled one, for the last step. */
  type Variant = "primary" | "quiet" | "danger" | "destructive" | "icon" | "link";

  let {
    variant,
    small = false,
    element = $bindable(null),
    type = "button",
    children,
    ...rest
  }: Omit<HTMLButtonAttributes, "class" | "children"> & {
    variant: Variant;
    small?: boolean;
    element?: HTMLButtonElement | null;
    children: Snippet;
  } = $props();
</script>

<button bind:this={element} {type} class={[variant, { small }]} {...rest}>{@render children()}</button>

<style>
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
  }

  .primary,
  .quiet,
  .danger,
  .destructive {
    padding: 0.45rem 1rem;
    border-radius: 8px;
    font-weight: 500;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }

  .primary {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--bg);
  }

  .primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 85%, var(--text));
  }

  .quiet,
  .danger {
    border: 1px solid var(--line);
    background: transparent;
  }

  .quiet:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--line) 50%, var(--muted));
    background: var(--surface);
  }

  .danger {
    color: var(--error);
  }

  .danger:hover:not(:disabled) {
    border-color: var(--error);
    background: color-mix(in srgb, var(--error) 8%, var(--surface));
  }

  .destructive {
    border: 1px solid var(--error);
    background: var(--error);
    color: var(--bg);
  }

  .small {
    padding: 0.25rem 0.7rem;
    font-size: 0.85rem;
  }

  .icon {
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--muted);
  }

  .icon:hover {
    background: var(--bg);
    color: var(--text);
  }

  .link {
    display: inline;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
  }

  button:not(.link):focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  button :global(svg) {
    width: 0.95em;
    height: 0.95em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
