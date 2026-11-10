<script lang="ts">
  import type { AvailableTag, Tags } from "@skolia/shared/api";
  import { listTags } from "../lib/api.ts";
  import { byKind, kindLabel } from "../lib/tags.ts";
  import Field from "./Field.svelte";

  /** A select for each kind of tag skolia has, none of them required. */
  let { tags = $bindable(), id }: { tags: Tags; id: string } = $props();

  let available = $state<readonly AvailableTag[]>([]);

  $effect(() => {
    listTags().then(
      (t) => (available = t),
      // Without the tags there's nothing to choose; the rest of the form still works
      () => {},
    );
  });

  function set(kind: string, value: string): void {
    const { [kind]: _, ...rest } = tags;
    tags = value === "" ? rest : { ...rest, [kind]: value };
  }
</script>

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
