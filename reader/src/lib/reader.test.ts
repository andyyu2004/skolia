import assert from "node:assert/strict";
import { test } from "node:test";
import type { Blob, Bundle, Entry, Feats, Token } from "@skolia/shared/schema";
import { explainCase } from "./cases.ts";
import { layout } from "./doc.ts";
import { rankSenses } from "./lexicon.ts";
import { paradigmTables } from "./paradigm.ts";

function token(start: number, end: number, text: string, extra: Partial<Token> = {}): Token {
  return {
    start,
    end,
    text,
    lemma: text,
    lemma_id: `pl:${text}:NOUN`,
    upos: "NOUN",
    xpos: null,
    feats: {},
    head: null,
    deprel: "root",
    ...extra,
  };
}

test("layout keeps gaps and groups the words of a fused token", () => {
  const text = "Zrobiłem to.";
  const analysis: Blob = {
    schema: 2,
    analyzer: "t",
    lang: "pl",
    hash: "",
    sentences: [
      {
        start: 0,
        end: 12,
        expressions: [],
        tokens: [
          token(0, 8, "Zrobił", { mwt: "Zrobiłem" }),
          token(0, 8, "em", { mwt: "Zrobiłem", upos: "AUX" }),
          token(9, 11, "to"),
          token(11, 12, ".", { upos: "PUNCT" }),
        ],
      },
    ],
  };
  const { pieces, words } = layout(text, analysis);
  assert.deepEqual(
    pieces.map((p) => (p.kind === "gap" ? `[${p.text}]` : p.text)),
    ["Zrobiłem", "[ ]", "to", "."],
  );
  assert.equal(words[0]?.words.length, 2);
  assert.equal(words[2]?.punct, true);
});

const NOM_SG: Feats = { Case: "Nom", Number: "Sing", Gender: "Masc", Animacy: "Nhum" };
const GEN_SG: Feats = { Case: "Gen", Number: "Sing", Gender: "Masc", Animacy: "Nhum" };
const ACC_SG: Feats = { Case: "Acc", Number: "Sing", Gender: "Masc", Animacy: "Nhum" };
const NOM_PL: Feats = { Case: "Nom", Number: "Plur", Gender: "Masc", Animacy: "Nhum" };

const PIES: Entry = {
  lemma: "pies",
  upos: "NOUN",
  senses: [
    { gloss: "cop", tags: [], when: [{ Gender: "Masc", Animacy: "Hum" }] },
    { gloss: "dog", tags: [], when: [{ Gender: "Masc", Animacy: "Nhum" }] },
  ],
  relations: [],
  paradigms: [
    {
      homonym: "Sm2",
      forms: [
        ["pies", [0]],
        ["psa", [1, 2]],
        ["psy", [3]],
      ],
    },
  ],
};

const BUNDLE: Bundle = {
  lang: "pl",
  lexicon: "t",
  attribution: "",
  entries: { "pl:pies:NOUN": PIES },
  lookup: {},
  match: {},
  feats: [NOM_SG, GEN_SG, ACC_SG, NOM_PL],
};

test("the token's features pick the sense", () => {
  assert.deepEqual(
    rankSenses(PIES, GEN_SG).map((r) => [r.sense.gloss, r.fits]),
    [
      ["dog", true],
      ["cop", false],
    ],
  );
});

test("the declension marks the token's own form and case", () => {
  const psa = token(0, 3, "psa", { lemma: "pies", lemma_id: "pl:pies:NOUN", feats: GEN_SG });
  const [table] = paradigmTables(BUNDLE, PIES, psa);
  assert.ok(table);
  assert.deepEqual(table.columns, ["sg", "pl"]);
  const current = table.rows.flatMap((row) =>
    row.cells.flatMap((cell) => cell.filter((f) => f.current).map(() => row.label)),
  );
  // psa is also the accusative, but the token is genitive
  assert.deepEqual(current, ["gen."]);
});

test("case explanations: governor, two-case prepositions, agreement chains", () => {
  // Szukam starego psa w domu
  const tokens: Token[] = [
    token(0, 6, "Szukam", { lemma: "szukać", upos: "VERB" }),
    token(7, 14, "starego", { upos: "ADJ", head: 2, deprel: "amod", feats: GEN_SG, case_reason: { rule: "agreement", trigger: 2 } }),
    token(15, 18, "psa", { head: 0, deprel: "obj", feats: GEN_SG, case_reason: { rule: "verb", trigger: 0, governor: "szukać" } }),
    token(19, 20, "w", { upos: "ADP", head: 4, deprel: "case" }),
    token(21, 25, "domu", { head: 0, deprel: "obl", feats: { Case: "Loc" }, case_reason: { rule: "preposition", trigger: 3, governor: "w" } }),
  ];
  assert.deepEqual(explainCase(tokens, 2), { text: "szukać takes the genitive.", trigger: 0 });
  assert.equal(explainCase(tokens, 1)?.text, "It agrees with psa. psa: szukać takes the genitive.");
  assert.equal(explainCase(tokens, 4)?.text, "w + locative means where (w domu).");
  assert.equal(explainCase(tokens, 0), null);
});
