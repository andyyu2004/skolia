// English paradigm tables: a noun's number, an adjective's comparison, a verb's present
// and past by person, its infinitive and participles.
import type { Entry, Feats, Token } from "@skolia/shared/schema";
import {
  compact,
  degreeLabels,
  numberColumn,
  numberLabels,
  personLabels,
  personRow,
  type Builder,
  type Form,
  type Table,
} from "../../lib/paradigm.ts";

const ONE_ROW = [["", ""]] as const;

function oneRow(): string {
  return "";
}

function degreeColumn(f: Feats): string | undefined {
  return f.Degree;
}

export function layout(builder: Builder, forms: Form[], entry: Entry, _token: Token): Table[] {
  switch (entry.upos) {
    case "NOUN":
    case "PROPN":
      return compact([builder.table("Number", forms, oneRow, ONE_ROW, numberColumn, numberLabels())]);
    case "ADJ":
    case "ADV":
      return compact([builder.table("Comparison", forms, oneRow, ONE_ROW, degreeColumn, degreeLabels())]);
    case "VERB":
    case "AUX":
      return verbTables(builder, forms);
    default:
      return compact([builder.list("Forms", forms)]);
  }
}

function verbTables(builder: Builder, forms: Form[]): Table[] {
  const indicative = (tense: "Pres" | "Past") =>
    forms.filter((f) => f.feats.Mood === "Ind" && f.feats.Tense === tense && f.feats.VerbForm === "Fin");
  const byPerson = (title: string, tense: "Pres" | "Past") =>
    builder.table(title, indicative(tense), personRow, personLabels(), numberColumn, numberLabels(), {
      mergeRows: true,
    });
  return compact([
    builder.list(
      "Infinitive",
      forms.filter((f) => f.feats.VerbForm === "Inf"),
    ),
    byPerson("Present", "Pres"),
    byPerson("Past", "Past"),
    builder.list(
      "Present participle",
      forms.filter((f) => f.feats.VerbForm === "Ger"),
    ),
    builder.list(
      "Past participle",
      forms.filter((f) => f.feats.VerbForm === "Part" && f.feats.Tense === "Past" && f.feats.Voice === undefined),
    ),
  ]);
}
