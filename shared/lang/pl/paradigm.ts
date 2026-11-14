// Polish paradigm tables: declension by case and gender, and the verb's tenses, moods,
// participles and verbal noun.
import type { Entry, Feats } from "@skolia/shared/schema";
import {
  compact,
  type Shown,
  degreeLabels,
  numberColumn,
  numberLabels,
  ONE_ROW,
  oneRow,
  PERSON_ORDER,
  personLabels,
  personRow,
  type Builder,
  type Form,
  type Labels,
  type Table,
} from "../../paradigm.ts";

const CASE_ORDER = ["Nom", "Gen", "Dat", "Acc", "Ins", "Loc", "Voc"] as const;
const CASE_SHORT: Record<(typeof CASE_ORDER)[number], string> = {
  Nom: "nom.",
  Gen: "gen.",
  Dat: "dat.",
  Acc: "acc.",
  Ins: "ins.",
  Loc: "loc.",
  Voc: "voc.",
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

function caseRow(f: Feats): string | undefined {
  return f.Case;
}

function caseLabels(): Labels {
  return CASE_ORDER.map((c) => [c, CASE_SHORT[c]] as const);
}

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

function genderLabels(): Labels {
  return GENDER_ORDER.map((g) => [g, g] as const);
}

export function layout(builder: Builder, forms: Form[], entry: Pick<Entry, "upos">, token: Shown): Table[] {
  // Show the token's own degree and polarity (stary/starszy, robiony/nierobiony)
  const sameGrade = (f: Form): boolean =>
    (f.feats.Degree === undefined || f.feats.Degree === (token.feats.Degree ?? "Pos")) &&
    (f.feats.Polarity === undefined || f.feats.Polarity === (token.feats.Polarity ?? "Pos"));
  const graded = forms.filter(sameGrade);

  switch (entry.upos) {
    case "NOUN":
    case "PROPN":
      return compact([builder.table("Declension", graded, caseRow, caseLabels(), numberColumn, numberLabels())]);
    case "ADJ":
    case "DET":
    case "PRON":
    case "NUM":
      return compact([
        builder.table("Declension", graded, caseRow, caseLabels(), genderColumn, genderLabels()),
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

function verbTables(builder: Builder, forms: Form[], token: Shown): Table[] {
  const t = token.feats;
  const positive = forms.filter((f) => f.feats.Polarity !== "Neg" || t.Polarity === "Neg");
  const finite = positive.filter((f) => f.feats.VerbForm === "Fin");
  const persons = personLabels();
  const indicative = (tense: string) =>
    finite.filter((f) => f.feats.Mood === "Ind" && f.feats.Tense === tense && PERSON_ORDER.includes(f.feats.Person ?? ""));
  const participle = (voice: "Act" | "Pass", title: string): Table | null => {
    const all = positive.filter((f) => f.feats.VerbForm === "Part" && f.feats.Voice === voice);
    if (t.VerbForm === "Part" && t.Voice === voice) {
      return builder.table(title, all, caseRow, caseLabels(), genderColumn, genderLabels());
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
      ? builder.table("Verbal noun", gerund, caseRow, caseLabels(), numberColumn, numberLabels())
      : builder.list(
          "Verbal noun",
          gerund.filter((f) => f.feats.Case === "Nom" && f.feats.Number === "Sing"),
        ),
  ]);
}

function comparison(builder: Builder, forms: Form[]): Table | null {
  const citation = forms.filter((f) => f.feats.Polarity !== "Neg" && isCitationForm(f, "Masc"));
  if (!citation.some((f) => f.feats.Degree === "Cmp")) return null;
  return builder.table("Comparison", citation, oneRow, ONE_ROW, (f) => f.Degree, degreeLabels());
}

/** The dictionary form of a declining word: nominative singular of the given gender
 * (inanimate, for masculine); for indeclinables (adverbs) every form. */
function isCitationForm(f: Form, gender: "Masc" | "Neut"): boolean {
  if (f.feats.Case === undefined) return true;
  const ofGender = f.feats.Gender === gender && (gender !== "Masc" || (f.feats.Animacy !== "Hum" && f.feats.Animacy !== "Nhum"));
  return f.feats.Case === "Nom" && f.feats.Number === "Sing" && ofGender;
}

/** "sg m. pers." + "sg m. anim." -> "sg m. pers./m. anim."; all three masculines -> "m." */
export function mergeLabels(labels: string[]): string {
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
