// A sentence's dependency tree as arcs above its words, and why each word has its case as
// arcs below them, for the structure view.
import type { CaseRule, Deprel, Token } from "@skolia/shared/schema";
import { CASE_NAME } from "./ud.ts";

export interface TreeWord {
  /** The token's index in the sentence, which arcs refer to. */
  index: number;
  token: Token;
  root: boolean;
  /** "genitive", for words with a case */
  caseName: string | null;
}

/** Where an arc's end sits among the arcs meeting the same word, left to right. */
export interface Slot {
  rank: number;
  count: number;
}

export interface Arc {
  /** Token indices: the head (or the word causing a case) and the word it points at. */
  from: number;
  to: number;
  label: string;
  /** The UD relation or case rule the label stands for. */
  raw: string;
  /** Positions of the left and right ends among `words`. */
  left: number;
  right: number;
  /** 1 for an arc between neighbours; one more than the highest arc it spans. */
  level: number;
  fromSlot: Slot;
  toSlot: Slot;
}

export interface Tree {
  words: TreeWord[];
  /** Dependencies, drawn above the words. */
  arcs: Arc[];
  levels: number;
  /** Case reasons, drawn below the words. */
  cases: Arc[];
  caseLevels: number;
}

type Span = Omit<Arc, "level" | "fromSlot" | "toSlot">;

/** Punctuation is left out: its arcs carry nothing a learner needs and crowd the rest. */
export function sentenceTree(tokens: Token[]): Tree {
  const words: TreeWord[] = [];
  const position = new Map<number, number>();
  tokens.forEach((token, index) => {
    if (token.upos === "PUNCT") return;
    position.set(index, words.length);
    const value = token.feats.Case;
    words.push({ index, token, root: token.head === null, caseName: value ? CASE_NAME[value] : null });
  });

  function span(from: number, to: number, label: string, raw: string): Span | null {
    const a = position.get(from);
    const b = position.get(to);
    if (a === undefined || b === undefined || a === b) return null;
    return { from, to, label, raw, left: Math.min(a, b), right: Math.max(a, b) };
  }

  const deps: Span[] = [];
  const cases: Span[] = [];
  for (const word of words) {
    const { head, deprel, case_reason: reason } = word.token;
    const dep = head === null ? null : span(head, word.index, relationName(deprel), deprel ?? "");
    if (dep) deps.push(dep);
    const trigger = reason?.trigger;
    const why = reason && trigger !== undefined ? span(trigger, word.index, RULE[reason.rule], reason.rule) : null;
    if (why) cases.push(why);
  }
  const arcs = stack(deps);
  const caseArcs = stack(cases);
  return {
    words,
    arcs,
    levels: Math.max(0, ...arcs.map((a) => a.level)),
    cases: caseArcs,
    caseLevels: Math.max(0, ...caseArcs.map((a) => a.level)),
  };
}

function stack(spans: Span[]): Arc[] {
  // Shorter arcs first, so every arc inside a longer one has its level already
  const sorted = [...spans].sort((a, b) => a.right - a.left - (b.right - b.left) || a.left - b.left);
  const levelled: (Span & { level: number })[] = [];
  for (const s of sorted) {
    let below = 0;
    for (const arc of levelled) {
      if (arc.left >= s.left && arc.right <= s.right) below = Math.max(below, arc.level);
    }
    levelled.push({ ...s, level: below + 1 });
  }

  // At each word, order the arcs' ends by where their other end is. Higher arcs reach
  // further, so they sit outside the lower ones and no two cross at the word.
  const ends = new Map<number, { arc: number; other: number }[]>();
  levelled.forEach((arc, i) => {
    // Token order is word order, so the other end is the far side of the span
    const [fromOther, toOther] = arc.from < arc.to ? [arc.right, arc.left] : [arc.left, arc.right];
    for (const [at, other] of [
      [arc.from, fromOther],
      [arc.to, toOther],
    ] as const) {
      const list = ends.get(at) ?? [];
      list.push({ arc: i, other });
      ends.set(at, list);
    }
  });
  const slot = (at: number, arc: number): Slot => {
    const list = [...(ends.get(at) ?? [])].sort((a, b) => a.other - b.other);
    return { rank: list.findIndex((e) => e.arc === arc), count: list.length };
  };
  return levelled.map((arc, i) => ({ ...arc, fromSlot: slot(arc.from, i), toSlot: slot(arc.to, i) }));
}

// A relation as a noun for the arc's label; `roleLabel` in ud.ts phrases it for the sheet
const RELATION: Partial<Record<string, string>> = {
  nsubj: "subject",
  csubj: "subject clause",
  obj: "object",
  iobj: "indirect object",
  obl: "adverbial",
  "obl:arg": "complement",
  "obl:agent": "agent",
  nmod: "modifier",
  "nmod:arg": "complement",
  "nmod:poss": "possessive",
  amod: "adjective",
  det: "determiner",
  "det:poss": "possessive",
  "det:numgov": "numeral",
  "det:nummod": "numeral",
  advmod: "adverb",
  "advmod:neg": "negation",
  case: "preposition",
  cc: "conjunction",
  conj: "coordinated",
  mark: "introduces",
  aux: "auxiliary",
  cop: "copula",
  expl: "reflexive",
  xcomp: "complement",
  ccomp: "clause",
  acl: "clause",
  "acl:relcl": "relative clause",
  advcl: "adverbial clause",
  nummod: "number",
  flat: "name",
  fixed: "phrase",
  compound: "compound",
  appos: "apposition",
  parataxis: "aside",
  vocative: "address",
  discourse: "discourse",
  dep: "related",
};

export function relationName(deprel: Deprel | null): string {
  if (deprel === null) return "";
  return RELATION[deprel] ?? RELATION[deprel.split(":")[0] ?? ""] ?? deprel;
}

// What the word at an arc's start does to the case of the word at its end. Rules without
// a trigger (vocative, instrumental) have no arc.
const RULE: Record<CaseRule, string> = {
  vocative: "addressed",
  preposition: "preposition",
  agreement: "agrees",
  coordination: "listed with",
  numeral: "numeral",
  verb: "verb's case",
  negation: "negation",
  structural: "object",
  partitive: "partitive",
  subject: "subject",
  predicate: "predicate",
  possessive: "possessive",
  "noun-complement": "complement",
  "verbal-noun": "verbal noun",
  instrumental: "instrumental",
};

/** The case arcs explaining the selected word, stacked on their own: its own, and the
 * case of the word it agrees with or is listed with, as the sheet's "Why …?" follows one
 * step (lang/pl/cases.ts). */
export function caseChain(cases: Arc[], selected: ReadonlySet<number>): Arc[] {
  const chain = new Set<Arc>();
  for (const arc of cases) {
    if (!selected.has(arc.to)) continue;
    chain.add(arc);
    if (arc.raw !== "agreement" && arc.raw !== "coordination") continue;
    const next = cases.find((c) => c.to === arc.from);
    if (next) chain.add(next);
  }
  return stack([...chain].map(({ from, to, label, raw, left, right }) => ({ from, to, label, raw, left, right })));
}
