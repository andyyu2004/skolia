<script lang="ts">
  import type { Lang } from "@skolia/shared/api";
  import type { Table } from "@skolia/shared/paradigm";

  let {
    lang,
    table,
    open = $bindable(),
  }: {
    lang: Lang;
    table: Table;
    /** Given, the table folds under its title; the review card folds its tables itself. */
    open?: boolean;
  } = $props();

  const isList = $derived(table.columns.length === 1 && table.columns[0] === "" && table.rows.length === 1);
</script>

{#snippet body()}
  {#if isList}
    <p {lang} class="form-list">
      {#each table.rows[0]?.cells[0] ?? [] as form, i (i)}
        {i > 0 ? ", " : ""}<span class={{ current: form.current }}>{form.text}</span>
      {/each}
    </p>
  {:else}
    <div class="scroll">
      <table {lang}>
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
                <td class={{ current: cell.some((f) => f.current) }}>
                  {cell.map((f) => f.text).join(" / ")}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/snippet}

{#if open === undefined}
  <div class="paradigm">
    <h3>{table.title}</h3>
    {@render body()}
  </div>
{:else}
  <details class="paradigm" bind:open>
    <summary>{table.title}</summary>
    {@render body()}
  </details>
{/if}

<style>
  h3,
  summary {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin: 1rem 0 0.3rem;
  }

  summary {
    cursor: pointer;
  }

  .scroll {
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    font-size: 0.95rem;
  }

  th,
  td {
    padding: 0.2rem 0.6rem 0.2rem 0;
    text-align: left;
    white-space: nowrap;
  }

  th {
    font-weight: 400;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .current {
    background: var(--current);
    font-weight: 600;
    border-radius: 3px;
    padding-left: 0.3rem;
  }

  .form-list {
    margin: 0.2rem 0;
  }
</style>
