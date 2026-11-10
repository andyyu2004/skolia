<script lang="ts">
  import type { TagKind, TagValue, Tags } from "@skolia/shared/api";
  import { TAGS, TAG_INFO, TAG_KINDS } from "@skolia/shared/api";
  import Field from "./Field.svelte";

  /** A select for each kind of tag, none of them required. */
  let { tags = $bindable(), id }: { tags: Tags; id: string } = $props();

  function set(kind: TagKind, value: string): void {
    const { [kind]: _, ...rest } = tags;
    tags = value === "" ? rest : { ...rest, [kind]: value as TagValue };
  }
</script>

{#each TAG_KINDS as kind (kind)}
  <Field label={TAG_INFO[kind].label} for="{id}-{kind}" optional>
    <select id="{id}-{kind}" value={tags[kind] ?? ""} onchange={(event) => set(kind, event.currentTarget.value)}>
      <option value="">Not given</option>
      {#each TAGS[kind] as value (value)}
        <option {value}>{value} · {TAG_INFO[kind].values[value]}</option>
      {/each}
    </select>
  </Field>
{/each}
