import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bundle, Entry, Feats, Token } from "@skolia/shared/schema";
import { paradigmTables, type Table } from "../../paradigm.ts";
import { english } from "./index.ts";

function token(text: string, lemma: string, upos: Token["upos"], feats: Feats): Token {
  return {
    start: 0,
    end: text.length,
    text,
    lemma,
    lemma_id: `en:${lemma}:${upos}`,
    upos,
    xpos: null,
    feats,
    head: null,
    deprel: "root",
  };
}

function current(tables: Table[]): string[] {
  return tables.flatMap((t) => t.rows.flatMap((r) => r.cells.flat().filter((f) => f.current).map((f) => f.text)));
}

const PRES_1SG: Feats = { Mood: "Ind", Number: "Sing", Person: "1", Tense: "Pres", VerbForm: "Fin" };
const PRES_3SG: Feats = { Mood: "Ind", Number: "Sing", Person: "3", Tense: "Pres", VerbForm: "Fin" };

const BE: Entry = {
  lemma: "be",
  upos: "VERB",
  senses: [{ gloss: "to exist", tags: [] }],
  relations: [],
  frames: [],
  paradigms: [
    {
      homonym: "",
      forms: [
        ["am", [0]],
        ["'m", [0]],
        ["is", [1]],
        ["be", [2]],
      ],
    },
  ],
};

const FIRST: Entry = {
  lemma: "first",
  upos: "ADJ",
  senses: [{ gloss: "preceding all others", tags: [] }],
  relations: [],
  frames: [],
  paradigms: [
    {
      homonym: "",
      forms: [
        ["first", [3]],
        ["firstmost", [4]],
      ],
    },
  ],
};

const BUNDLE: Bundle = {
  schema: 1,
  lang: "en",
  lexicon: "t",
  attribution: "",
  entries: { "en:be:VERB": BE, "en:first:ADJ": FIRST },
  lookup: { "en:be:AUX": "en:be:VERB" },
  match: {},
  feats: [PRES_1SG, PRES_3SG, { VerbForm: "Inf" }, { Degree: "Pos" }, { Degree: "Sup" }],
};

test("a curly apostrophe matches the lexicon's straight one", () => {
  const m = token("’m", "be", "AUX", PRES_1SG);
  assert.deepEqual(current(paradigmTables(BUNDLE, BE, m, english.paradigm)), ["'m"]);
});

const PAST = (person: "1" | "2" | "3", number: "Sing" | "Plur"): Feats => ({
  Mood: "Ind",
  Number: number,
  Person: person,
  Tense: "Past",
  VerbForm: "Fin",
});
const PAST_ALL = (["1", "2", "3"] as const).flatMap((p) => [PAST(p, "Sing"), PAST(p, "Plur")]);
const PART_PAST: Feats = { Tense: "Past", VerbForm: "Part" };
const PART_PASS: Feats = { Tense: "Past", VerbForm: "Part", Voice: "Pass" };

const BURN: Entry = {
  lemma: "burn",
  upos: "VERB",
  senses: [{ gloss: "to be on fire", tags: [] }],
  relations: [],
  frames: [],
  paradigms: [
    {
      homonym: "",
      forms: [
        ["burn", [0]],
        ["burned", [1, 2, 3, 4, 5, 6, 7, 8]],
        ["burnt", [1, 2, 3, 4, 5, 6, 7, 8]],
      ],
    },
  ],
};

const BURN_BUNDLE: Bundle = {
  ...BUNDLE,
  entries: { "en:burn:VERB": BURN },
  feats: [{ VerbForm: "Inf" }, ...PAST_ALL, PART_PAST, PART_PASS],
};

test("in merged rows only the token's own variant is marked", () => {
  const burned = token("burned", "burn", "VERB", PAST("3", "Plur"));
  const past = paradigmTables(BURN_BUNDLE, BURN, burned, english.paradigm).find((t) => t.title === "Past");
  assert.ok(past);
  assert.deepEqual(current([past]), ["burned"]);
});

test("a passive participle is marked among the past participles", () => {
  const burned = token("burned", "burn", "VERB", PART_PASS);
  const participle = paradigmTables(BURN_BUNDLE, BURN, burned, english.paradigm).find(
    (t) => t.title === "Past participle",
  );
  assert.ok(participle);
  assert.deepEqual(current([participle]), ["burned"]);
});

test("features no form has don't stop a match", () => {
  const first = token("first", "first", "ADJ", { Degree: "Pos", NumForm: "Word", NumType: "Ord" });
  assert.deepEqual(current(paradigmTables(BUNDLE, FIRST, first, english.paradigm)), ["first"]);
});
