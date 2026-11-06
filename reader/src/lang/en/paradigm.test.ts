import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bundle, Entry, Feats, Token } from "@skolia/shared/schema";
import { paradigmTables, type Table } from "../../lib/paradigm.ts";
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

test("features no form has don't stop a match", () => {
  const first = token("first", "first", "ADJ", { Degree: "Pos", NumForm: "Word", NumType: "Ord" });
  assert.deepEqual(current(paradigmTables(BUNDLE, FIRST, first, english.paradigm)), ["first"]);
});
