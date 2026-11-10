// Paradigm tables for the word sheet, with the token's own form marked, and for review
// cards, with the lemma marked (a cloze card's: its blanked form). Each language lays out its tables (lang/*/paradigm.ts) with
// the Builder here.
import type { Bundle, Entry, Feats, Token } from "@skolia/shared/schema";
import { featsMatch } from "./lexicon.ts";

export interface FormCell {
  text: string;
  current: boolean;
}

export interface Row {
  label: string;
  cells: FormCell[][];
}

export interface Table {
  title: string;
  columns: string[];
  rows: Row[];
}

export interface Form {
  text: string;
  feats: Feats;
}

export type Key = (feats: Feats) => string | undefined;
export type Labels = readonly (readonly [string, string])[];

/** The word a table is for: a token in a sentence, or a card's lemma. */
export type Shown = Pick<Token, "text" | "feats">;

/** A language's tables for an entry's forms, laid out with the builder. */
export type Layout = (builder: Builder, forms: Form[], entry: Pick<Entry, "upos">, shown: Shown) => Table[];

/** A feature set by its id: the bundle's feats, or a lexicon response's. */
export type FeatsOf = (id: number) => Feats | undefined;

/** One label for merged rows or columns: "sg m. pers." + "sg m. anim." -> a shorter one. */
export type MergeLabels = (labels: string[]) => string;

/** The rows of a table with a single unlabelled row, for builder.table. */
export const ONE_ROW: Labels = [["", ""]];
export const oneRow: Key = () => "";

const NUMBER_LABEL: Record<string, string> = { Sing: "sg", Plur: "pl", Ptan: "pl. only" };
export const PERSON_ORDER = ["1", "2", "3"];
const PERSON_LABEL: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };
const DEGREE_ORDER = ["Pos", "Cmp", "Sup"];
const DEGREE_LABEL: Record<string, string> = {
  Pos: "positive",
  Cmp: "comparative",
  Sup: "superlative",
};

export function paradigmTables(
  bundle: Bundle,
  entry: Entry,
  token: Token,
  layout: Layout,
  mergeLabels: MergeLabels = (labels) => labels.join("/"),
): Table[] {
  return tables((id) => bundle.feats[id], entry, token, layout, mergeLabels);
}

/** A card's tables: the lemma's own paradigm, with the lemma marked. */
export function lemmaTables(
  featsOf: FeatsOf,
  entry: Pick<Entry, "lemma" | "upos" | "paradigms">,
  layout: Layout,
  mergeLabels: MergeLabels = (labels) => labels.join("/"),
): Table[] {
  return tables(featsOf, entry, { text: entry.lemma, feats: {} }, layout, mergeLabels);
}

/** A cloze card's tables: the lemma's paradigm, with the blanked form marked. */
export function formTables(
  featsOf: FeatsOf,
  entry: Pick<Entry, "upos" | "paradigms">,
  shown: Shown,
  layout: Layout,
  mergeLabels: MergeLabels = (labels) => labels.join("/"),
): Table[] {
  return tables(featsOf, entry, shown, layout, mergeLabels);
}

function tables(
  featsOf: FeatsOf,
  entry: Pick<Entry, "upos" | "paradigms">,
  shown: Shown,
  layout: Layout,
  mergeLabels: MergeLabels,
): Table[] {
  const forms = chooseParadigm(featsOf, entry, shown);
  if (forms.length <= 1) return [];
  return layout(new Builder(isTokenForm(forms, shown), mergeLabels), forms, entry, shown);
}

/** Matches the token's own form: the same text (ignoring case and the apostrophe's
 * shape, ’m for 'm) with the token's features, counting only features the paradigm's
 * forms have. A feature none of them has doesn't tell forms apart (English first is
 * NumType=Ord, its forms only have Degree). */
function isTokenForm(forms: Form[], token: Shown): (f: Form) => boolean {
  const used = new Set(forms.flatMap((f) => Object.keys(f.feats)));
  const feats = Object.fromEntries(Object.entries(token.feats).filter(([key]) => used.has(key))) as Feats;
  const text = foldText(token.text);
  return (f) => foldText(f.text) === text && featsMatch(f.feats, feats);
}

function foldText(text: string): string {
  return text.toLowerCase().replaceAll("’", "'");
}

function chooseParadigm(featsOf: FeatsOf, entry: Pick<Entry, "paradigms">, token: Shown): Form[] {
  const expanded = entry.paradigms.map((p) =>
    p.forms.flatMap(([text, ids]) =>
      ids.flatMap((id) => {
        const feats = featsOf(id);
        return feats ? [{ text, feats }] : [];
      }),
    ),
  );
  // Homonyms (pies the dog vs the cop) inflect differently: use the one with this form
  const own = expanded.find((forms) => forms.some(isTokenForm(forms, token)));
  return own ?? expanded[0] ?? [];
}

export function personRow(f: Feats): string | undefined {
  return f.Person;
}

export function personLabels(): Labels {
  return PERSON_ORDER.map((p) => [p, PERSON_LABEL[p] ?? p] as const);
}

export function numberColumn(f: Feats): string | undefined {
  return f.Number;
}

export function numberLabels(): Labels {
  return Object.entries(NUMBER_LABEL);
}

export function degreeLabels(): Labels {
  return DEGREE_ORDER.map((d) => [d, DEGREE_LABEL[d] ?? d] as const);
}

export function compact(tables: (Table | null)[]): Table[] {
  return tables.filter((t): t is Table => t !== null);
}

export class Builder {
  private readonly isCurrent: (f: Form) => boolean;
  private readonly mergeLabels: MergeLabels;

  constructor(isCurrent: (f: Form) => boolean, mergeLabels: MergeLabels) {
    this.isCurrent = isCurrent;
    this.mergeLabels = mergeLabels;
  }

  /** Forms laid out by row and column keys, in the given orders. Columns whose cells are
   * all the same merge (sg m. pers./m. anim./m. inan. are often identical). */
  table(
    title: string,
    forms: Form[],
    rowOf: Key,
    rowOrder: Labels,
    columnOf: Key,
    columnOrder: Labels,
    options: { mergeRows?: boolean } = {},
  ): Table | null {
    const cells = new Map<string, Map<string, FormCell[]>>();
    for (const form of forms) {
      const row = rowOf(form.feats);
      const column = columnOf(form.feats);
      if (row === undefined || column === undefined) continue;
      const byColumn = cells.get(row) ?? new Map<string, FormCell[]>();
      cells.set(row, byColumn);
      const cell = byColumn.get(column) ?? [];
      byColumn.set(column, cell);
      const existing = cell.find((c) => c.text === form.text);
      if (existing) existing.current ||= this.isCurrent(form);
      else cell.push({ text: form.text, current: this.isCurrent(form) });
    }
    const rows = rowOrder.filter(([key]) => cells.has(key));
    const present = new Set([...cells.values()].flatMap((byColumn) => [...byColumn.keys()]));
    const columns = columnOrder.filter(([key]) => present.has(key));
    if (rows.length === 0 || columns.length === 0) return null;
    const grid = rows.map(([row]) => columns.map(([column]) => cells.get(row)?.get(column) ?? []));
    const table = this.mergeColumns(
      title,
      columns.map(([, label]) => label),
      rows.map(([, label]) => label),
      grid,
    );
    return options.mergeRows ? this.mergeRows(table) : table;
  }

  list(title: string, forms: Form[]): Table | null {
    if (forms.length === 0) return null;
    const cell: FormCell[] = [];
    for (const form of forms) {
      const existing = cell.find((c) => c.text === form.text);
      if (existing) existing.current ||= this.isCurrent(form);
      else cell.push({ text: form.text, current: this.isCurrent(form) });
    }
    return { title, columns: [""], rows: [{ label: "", cells: [cell] }] };
  }

  private mergeColumns(title: string, columns: string[], rowLabels: string[], grid: FormCell[][][]): Table {
    const groups: { labels: string[]; index: number }[] = [];
    columns.forEach((label, index) => {
      const signature = grid.map((row) => cellText(row[index] ?? [])).join("|");
      const same = groups.find(
        (g) => grid.map((row) => cellText(row[g.index] ?? [])).join("|") === signature,
      );
      if (same) same.labels.push(label);
      else groups.push({ labels: [label], index });
    });
    return {
      title,
      columns: groups.map((g) => this.mergeLabels(g.labels)),
      rows: rowLabels.map((label, r) => ({
        label,
        cells: groups.map((g) => {
          const members = g.labels.map((l) => columns.indexOf(l));
          const cell = grid[r]?.[g.index] ?? [];
          // A merged cell is current if the token's form is in any of its columns
          return cell.map((c) => ({
            text: c.text,
            current: members.some((m) => grid[r]?.[m]?.some((x) => x.text === c.text && x.current)),
          }));
        }),
      })),
    };
  }

  /** Rows whose cells are all the same (past tense: m. anim. and m. inan.) become one. */
  private mergeRows(table: Table): Table {
    const rows: Row[] = [];
    for (const row of table.rows) {
      const signature = row.cells.map(cellText).join("|");
      const same = rows.find((r) => r.cells.map(cellText).join("|") === signature);
      if (same) {
        same.label = this.mergeLabels([...same.label.split("/"), row.label]);
        same.cells = same.cells.map((cell, i) =>
          cell.map((c) => ({
            ...c,
            current: c.current || (row.cells[i]?.some((x) => x.text === c.text && x.current) ?? false),
          })),
        );
      } else {
        rows.push({ ...row });
      }
    }
    return { ...table, rows };
  }
}

function cellText(cell: FormCell[]): string {
  return cell.map((c) => c.text).join("/");
}
