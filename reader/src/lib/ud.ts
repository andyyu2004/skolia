// Universal Dependencies labels in plain English, for the word sheet.
import type { Deprel, Feats, Upos } from "@skolia/shared/schema";

export const UPOS_LABEL: Record<Upos, string> = {
  ADJ: "adjective",
  ADP: "preposition",
  ADV: "adverb",
  AUX: "auxiliary",
  CCONJ: "conjunction",
  DET: "determiner",
  INTJ: "interjection",
  NOUN: "noun",
  NUM: "numeral",
  PART: "particle",
  PRON: "pronoun",
  PROPN: "proper noun",
  PUNCT: "punctuation",
  SCONJ: "conjunction",
  SYM: "symbol",
  VERB: "verb",
  X: "other",
};

// Feature values shown on the sheet, in reading order. Features not listed (AdpType,
// Variant, PrepCase, ...) are shown only in the raw view.
const SHOWN: { [K in keyof Feats]?: Partial<Record<NonNullable<Feats[K]>, string>> } = {
  VerbForm: {
    Part: "participle",
    Vnoun: "verbal noun",
    Inf: "infinitive",
    Conv: "adverbial participle",
  },
  Voice: { Pass: "passive", Act: "" },
  Mood: { Imp: "imperative" },
  Tense: { Pres: "present", Past: "past", Fut: "future" },
  Person: { "0": "impersonal", "1": "1st person", "2": "2nd person", "3": "3rd person" },
  Case: {
    Nom: "nominative",
    Gen: "genitive",
    Dat: "dative",
    Acc: "accusative",
    Ins: "instrumental",
    Loc: "locative",
    Voc: "vocative",
  },
  Number: { Sing: "singular", Plur: "plural", Ptan: "plural only" },
  Gender: { Masc: "masculine", Fem: "feminine", Neut: "neuter" },
  Animacy: { Hum: "personal", Nhum: "animate", Inan: "inanimate" },
  Aspect: { Imp: "imperfective", Perf: "perfective" },
  Degree: { Cmp: "comparative", Sup: "superlative" },
  Polarity: { Neg: "negated" },
  PronType: {
    Prs: "personal",
    Int: "interrogative",
    Rel: "relative",
    Dem: "demonstrative",
    Ind: "indefinite",
    Tot: "total",
    Neg: "negative",
  },
};

export function featureWords(feats: Feats): string[] {
  const words: string[] = [];
  const values = feats as Record<string, string | undefined>;
  for (const [key, labels] of Object.entries(SHOWN) as [string, Record<string, string>][]) {
    const value = values[key];
    const label = value === undefined ? undefined : labels[value];
    if (label) words.push(label);
  }
  return words;
}

export const CASE_ORDER = ["Nom", "Gen", "Dat", "Acc", "Ins", "Loc", "Voc"] as const;
export const CASE_SHORT: Record<(typeof CASE_ORDER)[number], string> = {
  Nom: "nom.",
  Gen: "gen.",
  Dat: "dat.",
  Acc: "acc.",
  Ins: "ins.",
  Loc: "loc.",
  Voc: "voc.",
};

// Dependency relations as "the word is the ___ of its head"
const DEPREL_LABEL: Partial<Record<string, string>> = {
  nsubj: "subject of",
  "nsubj:pass": "subject of",
  obj: "object of",
  iobj: "indirect object of",
  obl: "adverbial phrase of",
  "obl:arg": "complement of",
  nmod: "modifier of",
  "nmod:arg": "complement of",
  amod: "adjective describing",
  det: "determiner of",
  "det:poss": "possessive of",
  advmod: "adverb modifying",
  case: "preposition of",
  cc: "conjunction joining",
  conj: "coordinated with",
  mark: "introduces",
  aux: "auxiliary of",
  "aux:pass": "passive auxiliary of",
  cop: "copula of",
  expl: "reflexive marker of",
  "expl:pv": "reflexive marker of",
  xcomp: "complement of",
  ccomp: "clause complement of",
  acl: "clause modifying",
  "acl:relcl": "relative clause on",
  advcl: "clause modifying",
  nummod: "number modifying",
  flat: "part of the name",
  fixed: "part of the phrase",
  appos: "apposition to",
  parataxis: "aside to",
};

export function roleLabel(deprel: Deprel | null): string | null {
  if (deprel === null || deprel === "root" || deprel === "punct") return null;
  return DEPREL_LABEL[deprel] ?? DEPREL_LABEL[deprel.split(":")[0] ?? ""] ?? `${deprel} of`;
}
