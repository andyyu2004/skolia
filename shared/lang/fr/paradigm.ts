// French paradigm tables: a noun's number, an adjective's gender and number, a verb's
// simple tenses by person and number, its imperative, infinitive and participles.
import type { Entry, Feats, Mood, Tense } from "@skolia/shared/schema";
import {
  compact,
  numberColumn,
  numberLabels,
  ONE_ROW,
  oneRow,
  personLabels,
  personRow,
  type Builder,
  type Form,
  type Labels,
  type Shown,
  type Table,
} from "../../paradigm.ts";

const GENDER_LABELS: Labels = [
  ["Masc", "m."],
  ["Fem", "f."],
];

function genderRow(f: Feats): string | undefined {
  return f.Gender;
}

// The simple tenses, in the order French grammars give them
const FINITE: readonly { title: string; mood: Mood; tense: Tense }[] = [
  { title: "Present", mood: "Ind", tense: "Pres" },
  { title: "Imperfect", mood: "Ind", tense: "Imp" },
  { title: "Simple past", mood: "Ind", tense: "Past" },
  { title: "Future", mood: "Ind", tense: "Fut" },
  { title: "Conditional", mood: "Cnd", tense: "Pres" },
  { title: "Present subjunctive", mood: "Sub", tense: "Pres" },
  { title: "Imperfect subjunctive", mood: "Sub", tense: "Imp" },
  { title: "Imperative", mood: "Imp", tense: "Pres" },
];

export function layout(builder: Builder, forms: Form[], entry: Pick<Entry, "upos">, _shown: Shown): Table[] {
  switch (entry.upos) {
    case "NOUN":
    case "PROPN":
      return compact([builder.table("Number", forms, oneRow, ONE_ROW, numberColumn, numberLabels())]);
    case "ADJ":
      return compact([builder.table("Forms", forms, genderRow, GENDER_LABELS, numberColumn, numberLabels())]);
    case "VERB":
    case "AUX":
      return verbTables(builder, forms);
    default:
      return compact([builder.list("Forms", forms)]);
  }
}

function verbTables(builder: Builder, forms: Form[]): Table[] {
  const finite = FINITE.map(({ title, mood, tense }) =>
    builder.table(
      title,
      forms.filter((f) => f.feats.VerbForm === "Fin" && f.feats.Mood === mood && f.feats.Tense === tense),
      personRow,
      personLabels(),
      numberColumn,
      numberLabels(),
    ),
  );
  const participles = forms.filter((f) => f.feats.VerbForm === "Part");
  return compact([
    builder.list(
      "Infinitive",
      forms.filter((f) => f.feats.VerbForm === "Inf"),
    ),
    ...finite,
    builder.list(
      "Present participle",
      participles.filter((f) => f.feats.Gender === undefined),
    ),
    builder.table(
      "Past participle",
      participles.filter((f) => f.feats.Gender !== undefined),
      genderRow,
      GENDER_LABELS,
      numberColumn,
      numberLabels(),
    ),
  ]);
}
