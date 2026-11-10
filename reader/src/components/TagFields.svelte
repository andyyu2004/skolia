<script lang="ts">
  import type { AvailableTag, Tags } from "@skolia/shared/api";
  import { listTags } from "../lib/api.ts";
  import { byKind, kindLabel } from "../lib/tags.ts";
  import Field from "./Field.svelte";

  /** A select for each kind of tag skolia has, none of them required. */
  let { tags = $bindable(), id }: { tags: Tags; id: string } = $props();

  let available = $state<readonly AvailableTag[]>([]);
  let error = $state<string | null>(null);

  $effect(() => {
    // Without the tags there's nothing to choose, but the rest of the form still works
    listTags().then(
      (t) => (available = t),
      (e: unknown) => (error = e instanceof Error ? e.message : String(e)),
    );
  });

  function set(kind: string, value: string): void {
    const { [kind]: _, ...rest } = tags;
    tags = value === "" ? rest : { ...rest, [kind]: value };
  }
</script>

{#if error !== null}
  <p class="error">Couldn't load tags: {error}</p>
{/if}
{#each byKind(available) as [kind, options] (kind)}
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
