import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseReason, Deprel, Feats, Token, Upos } from "@skolia/shared/schema";
import { caseChain, relationName, sentenceTree } from "./tree.ts";

function token(
  text: string,
  upos: Upos,
  head: number | null,
  deprel: Deprel,
  feats: Feats = {},
  reason?: CaseReason,
): Token {
  return {
    start: 0,
    end: 0,
    text,
    lemma: text,
    lemma_id: null,
    upos,
    xpos: null,
    feats,
    head,
    deprel,
    ...(reason ? { case_reason: reason } : {}),
  };
}

// Kot je małą rybę .
const SENTENCE = [
  token("Kot", "NOUN", 1, "nsubj", { Case: "Nom" }, { rule: "subject", trigger: 1 }),
  token("je", "VERB", null, "root"),
  token("małą", "ADJ", 3, "amod", { Case: "Acc" }, { rule: "agreement", trigger: 3 }),
  token("rybę", "NOUN", 1, "obj", { Case: "Acc" }, { rule: "structural", trigger: 1 }),
  token(".", "PUNCT", 1, "punct"),
];

test("leaves out punctuation and marks the root and cases", () => {
  const tree = sentenceTree(SENTENCE);
  assert.deepEqual(
    tree.words.map((w) => [w.index, w.root, w.caseName]),
    [
      [0, false, "nominative"],
      [1, true, null],
      [2, false, "accusative"],
      [3, false, "accusative"],
    ],
  );
  assert.equal(
    tree.arcs.find((a) => a.raw === "punct"),
    undefined,
  );
});

test("an arc is one level above the arcs it spans", () => {
  const tree = sentenceTree(SENTENCE);
  const level = (raw: string): number | undefined => tree.arcs.find((a) => a.raw === raw)?.level;
  assert.equal(level("nsubj"), 1);
  assert.equal(level("amod"), 1);
  assert.equal(level("obj"), 2);
  assert.equal(tree.levels, 2);
});

test("arcs point from head to dependent", () => {
  const obj = sentenceTree(SENTENCE).arcs.find((a) => a.raw === "obj");
  assert.deepEqual(obj && [obj.from, obj.to, obj.left, obj.right, obj.label], [1, 3, 1, 3, "object"]);
});

test("ends at a word are ordered by where the arc's other end is", () => {
  const tree = sentenceTree(SENTENCE);
  const at = (raw: string): [number, number] | undefined => {
    const arc = tree.arcs.find((a) => a.raw === raw);
    return arc && [arc.fromSlot.rank, arc.fromSlot.count];
  };
  // je heads Kot (to its left) and rybę (to its right)
  assert.deepEqual(at("nsubj"), [0, 2]);
  assert.deepEqual(at("obj"), [1, 2]);
});

test("case arcs go from the word causing the case to the word with it", () => {
  const tree = sentenceTree(SENTENCE);
  assert.deepEqual(
    tree.cases.map((a) => [a.from, a.to, a.label]),
    [
      [1, 0, "subject"],
      [3, 2, "agrees"],
      [1, 3, "object"],
    ],
  );
  assert.equal(tree.caseLevels, 2);
});

test("an agreeing word's chain includes the case of the word it agrees with", () => {
  const tree = sentenceTree(SENTENCE);
  const chain = (index: number): string[] => [...caseChain(tree.cases, new Set([index]))].map((a) => a.raw);
  assert.deepEqual(chain(2), ["agreement", "structural"]);
  assert.deepEqual(chain(0), ["subject"]);
  assert.deepEqual(chain(1), []);
});

test("a chain is stacked on its own, without gaps for arcs it leaves out", () => {
  const tree = sentenceTree(SENTENCE);
  assert.equal(tree.cases.find((a) => a.raw === "structural")?.level, 2);
  assert.deepEqual(
    caseChain(tree.cases, new Set([3])).map((a) => a.level),
    [1],
  );
});

test("relation names fall back to the base relation, then the raw label", () => {
  assert.equal(relationName("nsubj:pass"), "subject");
  assert.equal(relationName("obl:arg"), "complement");
  assert.equal(relationName("goeswith"), "goeswith");
  assert.equal(relationName("expl"), "placeholder");
  assert.equal(relationName("expl:pv"), "reflexive");
  assert.equal(relationName(null), "");
});
