// Paradigm tables for the word sheet, with the token's own form marked.
import type { Bundle, Entry, Feats, Token } from "@skolia/shared/schema";
import { featsMatch } from "./lexicon.ts";
import { CASE_ORDER, CASE_SHORT } from "./ud.ts";

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

interface Form {
  text: string;
  feats: Feats;
}

type Key = (feats: Feats) => string | undefined;

const NUMBER_LABEL: Record<string, string> = { Sing: "sg", Plur: "pl", Ptan: "pl. only" };
const PERSON_ORDER = ["1", "2", "3"];
const PERSON_LABEL: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };
const DEGREE_ORDER = ["Pos", "Cmp", "Sup"];
const DEGREE_LABEL: Record<string, string> = {
  Pos: "positive",
  Cmp: "comparative",
  Sup: "superlative",
};
const GENDER_ORDER = [
  "sg m. pers.",
  "sg m. anim.",
  "sg m. inan.",
  "sg m.",
  "sg f.",
  "sg n.",
  "sg",
  "pl m. pers.",
  "pl other",
  "pl",
  "pl. only",
  "",
];

const GENDER_ROWS = ["m. pers.", "m. anim.", "m. inan.", "m.", "f.", "n."];
const MASCULINES = ["m. pers.", "m. anim.", "m. inan."];

function genderRow(f: Feats): string | undefined {
  if (f.Gender === "Masc") {
    if (f.Animacy === "Hum") return "m. pers.";
    if (f.Animacy === "Nhum") return "m. anim.";
    if (f.Animacy === "Inan") return "m. inan.";
    return "m.";
  }
  if (f.Gender === "Fem") return "f.";
  if (f.Gender === "Neut") return "n.";
  return undefined;
}

/** The column for a form that inflects for gender: Polish plurals only split
 * masculine-personal ("virile": ci studenci) from the rest (te kobiety, te psy). */
function genderColumn(f: Feats): string {
  if (f.Number === "Ptan") return "pl. only";
  if (f.Number === "Plur") {
    if (f.Gender === undefined) return "pl";
    return f.Gender === "Masc" && f.Animacy === "Hum" ? "pl m. pers." : "pl other";
  }
  if (f.Number === undefined) return "";
  if (f.Gender === "Masc") {
    if (f.Animacy === "Hum") return "sg m. pers.";
    if (f.Animacy === "Nhum") return "sg m. anim.";
    if (f.Animacy === "Inan") return "sg m. inan.";
    return "sg m.";
  }
  if (f.Gender === "Fem") return "sg f.";
  if (f.Gender === "Neut") return "sg n.";
  return "sg";
}

export function paradigmTables(bundle: Bundle, entry: Entry, token: Token): Table[] {
  const forms = chooseParadigm(bundle, entry, token);
  if (forms.length <= 1) return [];
  const isCurrent = (f: Form): boolean =>
    f.text.toLowerCase() === token.text.toLowerCase() && featsMatch(f.feats, token.feats);
  const builder = new Builder(isCurrent);
  // Show the token's own degree and polarity (stary/starszy, robiony/nierobiony)
  const sameGrade = (f: Form): boolean =>
    (f.feats.Degree === undefined || f.feats.Degree === (token.feats.Degree ?? "Pos")) &&
    (f.feats.Polarity === undefined || f.feats.Polarity === (token.feats.Polarity ?? "Pos"));
  const graded = forms.filter(sameGrade);
  const caseRow: Key = (f) => f.Case;
  const caseLabels = CASE_ORDER.map((c) => [c, CASE_SHORT[c]] as const);

  switch (entry.upos) {
    case "NOUN":
    case "PROPN":
      return compact([
        builder.table("Declension", graded, caseRow, caseLabels, numberColumn, numberLabels()),
      ]);
    case "ADJ":
    case "DET":
    case "PRON":
    case "NUM":
      return compact([
        builder.table("Declension", graded, caseRow, caseLabels, genderColumn, genderLabels()),
        entry.upos === "ADJ" ? comparison(builder, forms) : null,
      ]);
    case "ADV":
      return compact([comparison(builder, forms)]);
    case "VERB":
    case "AUX":
      return verbTables(builder, forms, token);
    default:
      return compact([builder.list("Forms", forms)]);
  }
}

function chooseParadigm(bundle: Bundle, entry: Entry, token: Token): Form[] {
  const expanded = entry.paradigms.map((p) =>
    p.forms.flatMap(([text, ids]) =>
      ids.flatMap((id) => {
        const feats = bundle.feats[id];
        return feats ? [{ text, feats }] : [];
      }),
    ),
  );
  // Homonyms (pies the dog vs the cop) inflect differently: use the one with this form
  const own = expanded.find((forms) =>
    forms.some(
      (f) => f.text.toLowerCase() === token.text.toLowerCase() && featsMatch(f.feats, token.feats),
    ),
  );
  return own ?? expanded[0] ?? [];
}

function verbTables(builder: Builder, forms: Form[], token: Token): Table[] {
  const t = token.feats;
  const positive = forms.filter((f) => f.feats.Polarity !== "Neg" || t.Polarity === "Neg");
  const finite = positive.filter((f) => f.feats.VerbForm === "Fin");
  const personRow: Key = (f) => f.Person;
  const persons = PERSON_ORDER.map((p) => [p, PERSON_LABEL[p] ?? p] as const);
  const indicative = (tense: string) =>
    finite.filter(
      (f) => f.feats.Mood === "Ind" && f.feats.Tense === tense && PERSON_ORDER.includes(f.feats.Person ?? ""),
    );
  const participle = (voice: "Act" | "Pass", title: string): Table | null => {
    const all = positive.filter((f) => f.feats.VerbForm === "Part" && f.feats.Voice === voice);
    if (t.VerbForm === "Part" && t.Voice === voice) {
      const caseLabels = CASE_ORDER.map((c) => [c, CASE_SHORT[c]] as const);
      return builder.table(title, all, (f) => f.Case, caseLabels, genderColumn, genderLabels());
    }
    return builder.list(
      title,
      all.filter((f) => isCitationForm(f, "Masc")),
    );
  };
  const gerund = positive.filter((f) => f.feats.VerbForm === "Vnoun");
  return compact([
    builder.list(
      "Infinitive",
      positive.filter((f) => f.feats.VerbForm === "Inf"),
    ),
    builder.table("Present", indicative("Pres"), personRow, persons, numberColumn, numberLabels()),
    builder.table("Future", indicative("Fut"), personRow, persons, numberColumn, numberLabels()),
    builder.table(
      "Past",
      finite.filter((f) => f.feats.Tense === "Past" && f.feats.Person === undefined),
      genderRow,
      GENDER_ROWS.map((g) => [g, g] as const),
      numberColumn,
      numberLabels(),
      { mergeRows: true },
    ),
    builder.table(
      "Imperative",
      finite.filter((f) => f.feats.Mood === "Imp"),
      personRow,
      persons,
      numberColumn,
      numberLabels(),
    ),
    builder.list(
      "Impersonal",
      finite.filter((f) => f.feats.Person === "0"),
    ),
    builder.list(
      "Adverbial participle",
      positive.filter((f) => f.feats.VerbForm === "Conv"),
    ),
    participle("Act", "Active participle"),
    participle("Pass", "Passive participle"),
    t.VerbForm === "Vnoun"
      ? builder.table(
          "Verbal noun",
          gerund,
          (f) => f.Case,
          CASE_ORDER.map((c) => [c, CASE_SHORT[c]] as const),
          numberColumn,
          numberLabels(),
        )
      : builder.list(
          "Verbal noun",
          gerund.filter((f) => f.feats.Case === "Nom" && f.feats.Number === "Sing"),
        ),
  ]);
}

function comparison(builder: Builder, forms: Form[]): Table | null {
  const citation = forms.filter((f) => f.feats.Polarity !== "Neg" && isCitationForm(f, "Masc"));
  if (!citation.some((f) => f.feats.Degree === "Cmp")) return null;
  const degrees = DEGREE_ORDER.map((d) => [d, DEGREE_LABEL[d] ?? d] as const);
  return builder.table("Comparison", citation, () => "", [["", ""]], (f) => f.Degree, degrees);
}

/** The dictionary form of a declining word: nominative singular of the given gender
 * (inanimate, for masculine); for indeclinables (adverbs) every form. */
function isCitationForm(f: Form, gender: "Masc" | "Neut"): boolean {
  if (f.feats.Case === undefined) return true;
  const ofGender =
    f.feats.Gender === gender &&
    (gender !== "Masc" || (f.feats.Animacy !== "Hum" && f.feats.Animacy !== "Nhum"));
  return f.feats.Case === "Nom" && f.feats.Number === "Sing" && ofGender;
}

function numberColumn(f: Feats): string | undefined {
  return f.Number;
}

function numberLabels(): (readonly [string, string])[] {
  return Object.entries(NUMBER_LABEL);
}

function genderLabels(): (readonly [string, string])[] {
  return GENDER_ORDER.map((g) => [g, g] as const);
}

function compact(tables: (Table | null)[]): Table[] {
  return tables.filter((t): t is Table => t !== null);
}

class Builder {
  private readonly isCurrent: (f: Form) => boolean;

  constructor(isCurrent: (f: Form) => boolean) {
    this.isCurrent = isCurrent;
  }

  /** Forms laid out by row and column keys, in the given orders. Columns whose cells are
   * all the same merge (sg m. pers./m. anim./m. inan. are often identical). */
  table(
    title: string,
    forms: Form[],
    rowOf: Key,
    rowOrder: readonly (readonly [string, string])[],
    columnOf: Key,
    columnOrder: readonly (readonly [string, string])[],
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
    const table = mergeColumns(
      title,
      columns.map(([, label]) => label),
      rows.map(([, label]) => label),
      grid,
    );
    return options.mergeRows ? mergeRows(table) : table;
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
}

function cellText(cell: FormCell[]): string {
  return cell.map((c) => c.text).join("/");
}

function mergeColumns(
  title: string,
  columns: string[],
  rowLabels: string[],
  grid: FormCell[][][],
): Table {
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
    columns: groups.map((g) => mergeLabels(g.labels)),
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
function mergeRows(table: Table): Table {
  const rows: Row[] = [];
  for (const row of table.rows) {
    const signature = row.cells.map(cellText).join("|");
    const same = rows.find((r) => r.cells.map(cellText).join("|") === signature);
    if (same) {
      same.label = mergeLabels([...same.label.split("/"), row.label]);
      same.cells = same.cells.map((cell, i) =>
        cell.map((c) => ({ ...c, current: c.current || (row.cells[i]?.some((x) => x.current) ?? false) })),
      );
    } else {
      rows.push({ ...row });
    }
  }
  return { ...table, rows };
}

/** "sg m. pers." + "sg m. anim." -> "sg m. pers./m. anim."; all three masculines -> "m." */
function mergeLabels(labels: string[]): string {
  const [first, ...rest] = labels;
  if (first === undefined) return "";
  const prefix = /^(sg|pl) /.exec(first)?.[0] ?? "";
  if (!rest.every((l) => l.startsWith(prefix))) return labels.join(", ");
  const parts = labels.map((l) => l.slice(prefix.length));
  if (MASCULINES.every((m) => parts.includes(m))) {
    return prefix + ["m.", ...parts.filter((p) => !MASCULINES.includes(p))].join("/");
  }
  return prefix + parts.join("/");
}
