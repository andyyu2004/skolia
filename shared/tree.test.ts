import assert from "node:assert/strict";
import { test } from "node:test";
import { SENTENCE, token } from "./tree.fixtures.ts";
import { caseChain, clauseOf, focusOn, parseSentence, relationName, spokenLabel } from "./tree.ts";

test("leaves out punctuation and builds the tree from the main word", () => {
  const sentence = parseSentence(SENTENCE);
  assert.deepEqual(
    sentence.words.map((w) => [w.form, w.root, w.depth, w.relation, w.caseName]),
    [
      ["Kot", false, 1, "subject", "nominative"],
      ["je", true, 0, "main word", null],
      ["małą", false, 2, "adjective", "accusative"],
      ["rybę", false, 1, "object", "accusative"],
    ],
  );
  assert.deepEqual(
    sentence.tops.map((w) => w.form),
    ["je"],
  );
  assert.deepEqual(
    sentence.words[1]?.children.map((w) => w.form),
    ["Kot", "rybę"],
  );
  assert.equal(sentence.words[2]?.head?.form, "rybę");
});

test("links run from head to dependent, and from the word causing a case to the word with it", () => {
  const sentence = parseSentence(SENTENCE);
  assert.deepEqual(
    sentence.dependencies.map((l) => [l.from.form, l.to.form, l.label]),
    [
      ["je", "Kot", "subject"],
      ["rybę", "małą", "adjective"],
      ["je", "rybę", "object"],
    ],
  );
  assert.deepEqual(
    sentence.cases.map((l) => [l.from.form, l.to.form, l.label]),
    [
      ["je", "Kot", "subject"],
      ["rybę", "małą", "agrees"],
      ["je", "rybę", "object"],
    ],
  );
});

test("cases are left out for languages that don't show them", () => {
  const sentence = parseSentence(SENTENCE, { cases: false });
  assert.ok(sentence.words.every((w) => w.caseName === null));
});

test("a person ending fused to the word before is drawn as an ending", () => {
  // powróciłaś: powróciła + ś share the characters of one word
  const fused = [
    { ...token("powróciła", "VERB", null, "root"), start: 0, end: 10 },
    { ...token("ś", "AUX", 0, "aux"), start: 0, end: 10 },
  ];
  const sentence = parseSentence(fused, { partOfWord: (t) => (t.upos === "AUX" ? "person ending" : null) });
  assert.deepEqual(
    sentence.words.map((w) => [w.form, w.ending, w.pos]),
    [
      ["powróciła", false, "verb"],
      ["-ś", true, "person ending"],
    ],
  );
});

test("a head chain that loops is cut so every word has a depth", () => {
  const sentence = parseSentence([token("a", "NOUN", 1, "nmod"), token("b", "NOUN", 0, "nmod")]);
  assert.equal(sentence.tops.length, 1);
  assert.deepEqual(
    sentence.words.map((w) => w.depth).sort(),
    [0, 1],
  );
});

test("an agreeing word's chain includes the case of the word it agrees with", () => {
  const sentence = parseSentence(SENTENCE);
  const chain = (index: number): string[] => caseChain(sentence, new Set([index])).map((l) => l.raw);
  assert.deepEqual(chain(2), ["agreement", "structural"]);
  assert.deepEqual(chain(0), ["subject"]);
  assert.deepEqual(chain(1), []);
});

test("focus marks the selected word's head and dependents and what causes its case", () => {
  const sentence = parseSentence(SENTENCE);
  const focus = focusOn(sentence, new Set([3]));
  assert.deepEqual([...focus.linked].sort(), [1, 2]);
  assert.equal(focus.trigger, 1);
});

test("a word is spoken with its relation to its head", () => {
  const sentence = parseSentence(SENTENCE);
  assert.equal(spokenLabel(sentence.words[3]!), "rybę, noun, object of je, accusative");
  assert.equal(spokenLabel(sentence.words[1]!), "je, verb, main word");
});

// Widzę , że kot je małą rybę . : "że kot je małą rybę" is a clause of widzę
const LONG = [
  token("Widzę", "VERB", null, "root"),
  token(",", "PUNCT", 4, "punct"),
  token("że", "SCONJ", 4, "mark"),
  token("kot", "NOUN", 4, "nsubj"),
  token("je", "VERB", 0, "ccomp"),
  token("małą", "ADJ", 6, "amod"),
  token("rybę", "NOUN", 4, "obj"),
  token(".", "PUNCT", 0, "punct"),
];

test("the clause around a word is its nearest clause big enough to read on its own", () => {
  assert.deepEqual([...(clauseOf(LONG, 6, 3) ?? [])].sort(), [1, 2, 3, 4, 5, 6]);
  // Too few words for a clause of its own: the whole sentence
  assert.equal(clauseOf(LONG, 6, 6), null);
  assert.equal(clauseOf(LONG, 0, 3), null);
});

test("a clause is drawn from its own top", () => {
  const sentence = parseSentence(LONG, { keep: clauseOf(LONG, 6, 3) ?? undefined });
  assert.deepEqual(
    sentence.words.map((w) => [w.form, w.depth]),
    [
      ["że", 1],
      ["kot", 1],
      ["je", 0],
      ["małą", 2],
      ["rybę", 1],
    ],
  );
  assert.deepEqual(
    sentence.tops.map((w) => [w.form, w.relation]),
    [["je", "clause"]],
  );
});

test("relation names fall back to the base relation, then the raw label", () => {
  assert.equal(relationName("nsubj:pass"), "subject");
  assert.equal(relationName("obl:arg"), "complement");
  assert.equal(relationName("goeswith"), "goeswith");
  assert.equal(relationName("expl"), "dummy subject");
  assert.equal(relationName("expl:pv"), "reflexive");
  assert.equal(relationName(null), "");
});
