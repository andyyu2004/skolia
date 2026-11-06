import assert from "node:assert/strict";
import { test } from "node:test";
import type { Blob, Bundle, Entry, Feats, Schema, Token } from "@skolia/shared/schema";
import { layout } from "../../lib/doc.ts";
import { rankSenses } from "../../lib/lexicon.ts";
import { paradigmTables } from "../../lib/paradigm.ts";
import { explainCase } from "./cases.ts";
import { argumentsOf, describePhrase, frames } from "./frames.ts";
import { polish } from "./index.ts";

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
  frames: [],
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
  schema: 1,
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
  const [table] = paradigmTables(BUNDLE, PIES, psa, polish.paradigm, polish.mergeLabels);
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
  assert.deepEqual(explainCase(tokens, 2), {
    text: "szukać governs the genitive for its object.",
    trigger: 0,
    parts: [
      { text: "szukać", trigger: true },
      { text: " governs the genitive for its object.", trigger: false },
    ],
  });
  assert.equal(explainCase(tokens, 1)?.text, "It agrees with psa. psa: szukać governs the genitive for its object.");
  assert.deepEqual(
    explainCase(tokens, 1)?.parts.filter((p) => p.trigger).map((p) => p.text),
    ["psa"],
  );
  assert.deepEqual(explainCase(tokens, 4)?.parts[0], { text: "w", trigger: true });
  assert.equal(explainCase(tokens, 4)?.text, "w + locative means where (w domu).");
  assert.equal(explainCase(tokens, 0), null);
});

function schema(positions: Schema["positions"], extra: Partial<Schema> = {}): Schema {
  return {
    pos: "verb",
    lemma: "szukać",
    reflexive: false,
    certainty: "certain",
    negation: "any",
    predicative: false,
    aspect: "imperf",
    positions,
    ...extra,
  };
}

const SUBJECT = { labels: ["subj" as const], phrases: [{ kind: "np" as const, case: "str" as const }] };

test("frame phrases read like dictionary patterns", () => {
  assert.equal(describePhrase({ kind: "np", case: "gen" }), "kogoś/czegoś [gen.]");
  assert.equal(describePhrase({ kind: "np", case: "str" }), "kogoś/coś [acc.; gen. with nie]");
  assert.equal(describePhrase({ kind: "prepnp", prep: "na", case: "acc" }), "na kogoś/coś [acc.]");
  assert.equal(describePhrase({ kind: "prepadjp", prep: "ku", case: "dat" }), "ku jakiemuś [dat.]");
  assert.equal(describePhrase({ kind: "cp", complementizer: "że", words: [] }), "że …");
  assert.equal(
    describePhrase({ kind: "ncp", case: "gen", complementizer: "że", words: [] }),
    "tego, że … [gen.]",
  );
});

test("frames drop the plain subject, merge duplicates, and put idioms last", () => {
  const object = { labels: [], phrases: [{ kind: "np" as const, case: "gen" as const }] };
  const idiom = {
    labels: [],
    phrases: [
      {
        kind: "lex" as const,
        phrase: { kind: "np" as const, case: "gen" as const },
        form: { shape: "nominal" as const, number: "sg" as const },
        lemmas: { kind: "one" as const, lemma: "guz" },
        modification: { kind: "natr" as const, positions: [] },
      },
    ],
  };
  const shown = frames([
    schema([SUBJECT, idiom]),
    schema([SUBJECT, object], { certainty: "colloquial" }),
    schema([SUBJECT, object]),
    schema([{ labels: ["subj"], phrases: [{ kind: "E" }] }, object], { negation: "neg" }),
  ]);
  assert.deepEqual(
    shown.map((f) => [f.pattern, f.tags, f.idiom]),
    [
      ["kogoś/czegoś [gen.]", [], false],
      ["(impersonal) + kogoś/czegoś [gen.]", ["with nie"], false],
      ["guz [gen.]", [], true],
    ],
  );
});

test("an idiom fits only when its fixed word is in the sentence", () => {
  // mieć na oku: na + loc. with the fixed word oko
  const naOku: Schema["positions"][number] = {
    labels: [],
    phrases: [
      {
        kind: "lex",
        phrase: { kind: "prepnp", prep: "na", case: "loc" },
        form: { shape: "nominal", number: "sg" },
        lemmas: { kind: "one", lemma: "oko" },
        modification: { kind: "natr", positions: [] },
      },
    ],
  };
  const idiom = schema([SUBJECT, naOku], { lemma: "mieć" });
  const withOko = frames([idiom], [{ prep: "na", case: "Loc", lemma: "oko" }]);
  const withStole = frames([idiom], [{ prep: "na", case: "Loc", lemma: "stół" }]);
  assert.equal(withOko[0]?.here, true);
  assert.equal(withStole[0]?.here, false);
});

test("the frame the sentence uses comes first, and clause alternatives are grouped", () => {
  // Wiele osób czeka na autobus: czeka's complement is na + accusative
  const sentence: Token[] = [
    token(0, 5, "czeka", { lemma: "czekać", upos: "VERB" }),
    token(6, 8, "na", { lemma: "na", upos: "ADP", head: 2, deprel: "case" }),
    token(9, 16, "autobus", { lemma: "autobus", head: 0, deprel: "obl:arg", feats: { Case: "Acc" } }),
  ];
  const args = argumentsOf(sentence, 0);
  assert.deepEqual(args, [{ prep: "na", case: "Acc", lemma: "autobus" }]);
  const genitive = { labels: [], phrases: [{ kind: "np" as const, case: "gen" as const }] };
  const naOrClause: Schema["positions"][number] = {
    labels: [],
    phrases: [
      { kind: "prepnp", prep: "na", case: "acc" },
      { kind: "cp", complementizer: "że", words: [] },
      { kind: "cp", complementizer: "żeby", words: [] },
      { kind: "prepncp", prep: "na", case: "acc", complementizer: "że", words: [] },
      { kind: "prepncp", prep: "na", case: "acc", complementizer: "żeby", words: [] },
    ],
  };
  const shown = frames([schema([SUBJECT, genitive]), schema([SUBJECT, naOrClause])], args);
  assert.deepEqual(
    shown.map((f) => [f.pattern, f.here]),
    [
      ["na kogoś/coś [acc.] / że/żeby … / na to, że/żeby …", true],
      ["kogoś/czegoś [gen.]", false],
    ],
  );
});
