<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import type { Tags } from "@skolia/shared/api";
  import { tagsQuery } from "../lib/queries.ts";
  import { byKind, kindLabel } from "../lib/tags.ts";
  import Field from "./Field.svelte";

  /** A select for each kind of tag skolia has, none of them required. */
  let { tags = $bindable(), id }: { tags: Tags; id: string } = $props();

  // Without the tags there's nothing to choose, but the rest of the form still works
  const available = createQuery(() => tagsQuery);

  function set(kind: string, value: string): void {
    const { [kind]: _, ...rest } = tags;
    tags = value === "" ? rest : { ...rest, [kind]: value };
  }
</script>

{#if available.error}
  <p class="error">Couldn't load tags: {available.error.message}</p>
{/if}
{#each byKind(available.data ?? []) as [kind, options] (kind)}
  <Field label={kindLabel(kind)} for="{id}-{kind}" optional>
    <select id="{id}-{kind}" value={tags[kind] ?? ""} onchange={(event) => set(kind, event.currentTarget.value)}>
      <option value="">Not given</option>
      {#each options as { value, description } (value)}
        <option {value}>{value}{description ? ` · ${description}` : ""}</option>
      {/each}
    </select>
  </Field>
{/each}

<style>
  .error {
    margin: 0;
    color: var(--error);
    font-size: 0.85rem;
  }
</style>
