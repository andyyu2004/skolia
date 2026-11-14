// Sentences for tree.test.ts and diagram.test.ts.
import type { CaseReason, Deprel, Feats, Token, Upos } from "@skolia/shared/schema";

let offset = 0;

/** A token after the last one made, one space on. */
export function token(text: string, upos: Upos, head: number | null, deprel: Deprel, feats: Feats = {}, reason?: CaseReason): Token {
  const start = offset;
  offset += text.length + 1;
  return {
    start,
    end: start + text.length,
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
export const SENTENCE = [
  token("Kot", "NOUN", 1, "nsubj", { Case: "Nom" }, { rule: "subject", trigger: 1 }),
  token("je", "VERB", null, "root"),
  token("małą", "ADJ", 3, "amod", { Case: "Acc" }, { rule: "agreement", trigger: 3 }),
  token("rybę", "NOUN", 1, "obj", { Case: "Acc" }, { rule: "structural", trigger: 1 }),
  token(".", "PUNCT", 1, "punct"),
];
