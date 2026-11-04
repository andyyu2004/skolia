<script lang="ts">
  import type { Table } from "./lib/paradigm.ts";

  let { table }: { table: Table } = $props();

  const isList = $derived(table.columns.length === 1 && table.columns[0] === "" && table.rows.length === 1);
</script>

<div class="paradigm">
  <h3>{table.title}</h3>
  {#if isList}
    <p lang="pl" class="form-list">
      {#each table.rows[0]?.cells[0] ?? [] as form, i (i)}
        {i > 0 ? ", " : ""}<span class:current={form.current}>{form.text}</span>
      {/each}
    </p>
  {:else}
    <div class="scroll">
      <table lang="pl">
        <thead>
          <tr>
            <th></th>
            {#each table.columns as column, i (i)}
              <th scope="col">{column}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each table.rows as row, r (r)}
            <tr>
              <th scope="row">{row.label}</th>
              {#each row.cells as cell, c (c)}
                <td class:current={cell.some((f) => f.current)}>
                  {cell.map((f) => f.text).join(" / ")}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
