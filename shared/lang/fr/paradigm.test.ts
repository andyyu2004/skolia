import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bundle, Entry, Feats, Token } from "@skolia/shared/schema";
import { paradigmTables, type Table } from "../../paradigm.ts";
import { french } from "./index.ts";

function token(text: string, lemma: string, upos: Token["upos"], feats: Feats): Token {
  return {
    start: 0,
    end: text.length,
    text,
    lemma,
    lemma_id: `fr:${lemma}:${upos}`,
    upos,
    xpos: null,
    feats,
    head: null,
    deprel: "root",
  };
}

function current(tables: Table[]): string[] {
  return tables.flatMap((t) =>
    t.rows.flatMap((r) =>
      r.cells
        .flat()
        .filter((f) => f.current)
        .map((f) => f.text),
    ),
  );
}

const FEATS: Feats[] = [
  { VerbForm: "Inf" },
  { Mood: "Ind", Number: "Sing", Person: "1", Tense: "Pres", VerbForm: "Fin" },
  { Mood: "Ind", Number: "Sing", Person: "2", Tense: "Pres", VerbForm: "Fin" },
  { Mood: "Ind", Number: "Sing", Person: "3", Tense: "Imp", VerbForm: "Fin" },
  { Mood: "Cnd", Number: "Plur", Person: "3", Tense: "Pres", VerbForm: "Fin" },
  { VerbForm: "Part" },
  { Gender: "Masc", Number: "Sing", VerbForm: "Part" },
  { Gender: "Masc", Number: "Plur", VerbForm: "Part" },
  { Gender: "Fem", Number: "Sing", VerbForm: "Part" },
  { Gender: "Fem", Number: "Plur", VerbForm: "Part" },
  { Gender: "Masc", Number: "Sing" },
  { Gender: "Fem", Number: "Sing" },
  { Gender: "Masc", Number: "Plur" },
  { Gender: "Fem", Number: "Plur" },
];

const PRENDRE: Entry = {
  lemma: "prendre",
  upos: "VERB",
  senses: [{ gloss: "to take", tags: [] }],
  relations: [],
  frames: [],
  paradigms: [
    {
      homonym: "",
      forms: [
        ["prendre", [0]],
        ["prends", [1, 2]],
        ["prenait", [3]],
        ["prendraient", [4]],
        ["prenant", [5]],
        ["pris", [6, 7]],
        ["prise", [8]],
        ["prises", [9]],
      ],
    },
  ],
};

const BEAU: Entry = {
  lemma: "beau",
  upos: "ADJ",
  senses: [{ gloss: "handsome", tags: [] }],
  relations: [],
  frames: [],
  paradigms: [
    {
      homonym: "",
      forms: [
        ["beau", [10]],
        ["bel", [10]],
        ["belle", [11]],
        ["beaux", [12]],
        ["belles", [13]],
      ],
    },
  ],
};

const BUNDLE: Bundle = {
  schema: 1,
  lang: "fr",
  lexicon: "t",
  attribution: "",
  entries: { "fr:prendre:VERB": PRENDRE, "fr:beau:ADJ": BEAU },
  lookup: {},
  match: {},
  feats: FEATS,
};

function titles(tables: Table[]): string[] {
  return tables.map((t) => t.title);
}

test("a verb has a table per simple tense it has forms for, then its participles", () => {
  const prends = token("prends", "prendre", "VERB", FEATS[2] ?? {});
  const tables = paradigmTables(BUNDLE, PRENDRE, prends, french.paradigm);
  assert.deepEqual(titles(tables), ["Infinitive", "Present", "Imperfect", "Conditional", "Present participle", "Past participle"]);
  // prends is the 1st and 2nd person singular; only the token's own (2nd) is marked
  const present = tables.find((t) => t.title === "Present");
  assert.ok(present);
  assert.deepEqual(
    present.rows.map((r) => [r.label, r.cells.map((c) => c.map((f) => `${f.text}${f.current ? "*" : ""}`).join())]),
    [
      ["1st", ["prends"]],
      ["2nd", ["prends*"]],
    ],
  );
});

test("a past participle is marked by its gender and number, without Voice or Tense", () => {
  // GSD gives participles Voice; the lexicon's forms don't have it, so it doesn't count
  const prises = token("prises", "prendre", "VERB", { Gender: "Fem", Number: "Plur", VerbForm: "Part", Voice: "Pass" });
  const participle = paradigmTables(BUNDLE, PRENDRE, prises, french.paradigm).find((t) => t.title === "Past participle");
  assert.ok(participle);
  assert.deepEqual(participle.columns, ["sg", "pl"]);
  assert.deepEqual(
    participle.rows.map((r) => r.label),
    ["m.", "f."],
  );
  assert.deepEqual(current([participle]), ["prises"]);
});

test("an adjective's table is gender by number, with bel beside beau", () => {
  const bel = token("bel", "beau", "ADJ", { Gender: "Masc", Number: "Sing" });
  const tables = paradigmTables(BUNDLE, BEAU, bel, french.paradigm);
  assert.equal(tables.length, 1);
  assert.deepEqual(
    tables[0]?.rows.map((r) => r.cells.map((c) => c.map((f) => f.text).join("/"))),
    [
      ["beau/bel", "beaux"],
      ["belle", "belles"],
    ],
  );
  assert.deepEqual(current(tables), ["bel"]);
});
