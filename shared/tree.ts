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
  /** Steps from the root, for the top-down layout. */
  depth: number;
  /** The relation to its head, as a noun ("subject"); empty for the root. */
  relation: string;
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

/** Punctuation is left out: its arcs carry nothing a learner needs and crowd the rest.
 * With `keep`, only those tokens are drawn (a clause, see `clauseOf`), and depths count
 * from the shallowest of them. */
export function sentenceTree(tokens: Token[], keep?: ReadonlySet<number>): Tree {
  const words: TreeWord[] = [];
  const position = new Map<number, number>();
  tokens.forEach((token, index) => {
    if (token.upos === "PUNCT" || (keep && !keep.has(index))) return;
    position.set(index, words.length);
    const value = token.feats.Case;
    words.push({
      index,
      token,
      root: token.head === null,
      caseName: value ? CASE_NAME[value] : null,
      depth: depthOf(tokens, index),
      relation: token.head === null ? "" : relationName(token.deprel),
    });
  });
  const shallowest = Math.min(...words.map((w) => w.depth));
  for (const word of words) word.depth -= shallowest;

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

/** Steps up to the root. A head chain that loops is cut where it repeats. */
function depthOf(tokens: Token[], index: number): number {
  const seen = new Set<number>([index]);
  let head = tokens[index]?.head ?? null;
  while (head !== null && !seen.has(head)) {
    seen.add(head);
    head = tokens[head]?.head ?? null;
  }
  return seen.size - 1;
}

/** The tokens of the clause around `index` when the sentence is long: the nearest clause
 * (a verb's own clause, a relative or adverbial clause, a coordinated clause) above it
 * with at least `least` words. Null when that is the whole sentence. */
export function clauseOf(tokens: Token[], index: number, least = 6): Set<number> | null {
  const isWord = (i: number): boolean => tokens[i]?.upos !== "PUNCT";
  const seen = new Set<number>();
  let at: number | null = index;
  while (at !== null && !seen.has(at)) {
    seen.add(at);
    const token: Token | undefined = tokens[at];
    if (!token || token.head === null) return null;
    if (opensClause(token)) {
      const clause = subtree(tokens, at);
      if ([...clause].filter(isWord).length >= least) return clause;
    }
    at = token.head;
  }
  return null;
}

// Relations whose dependent heads a clause of its own. xcomp is left out: an infinitive
// after mógł or chcieć reads as part of its verb's clause.
const CLAUSE: ReadonlySet<string> = new Set(["ccomp", "advcl", "acl", "csubj", "parataxis"]);

function opensClause(token: Token): boolean {
  const base = token.deprel?.split(":")[0] ?? "";
  return CLAUSE.has(base) || (base === "conj" && (token.upos === "VERB" || token.upos === "AUX"));
}

/** `top` and every token whose heads lead up to it. */
function subtree(tokens: Token[], top: number): Set<number> {
  const inside = new Set<number>();
  tokens.forEach((_, i) => {
    const seen = new Set<number>();
    let at: number | null = i;
    while (at !== null && !seen.has(at)) {
      if (at === top) {
        inside.add(i);
        return;
      }
      seen.add(at);
      at = tokens[at]?.head ?? null;
    }
  });
  return inside;
}

function stack(spans: Span[]): Arc[] {
  // Shorter arcs first, so an arc goes above every arc it spans or crosses
  const sorted = [...spans].sort((a, b) => a.right - a.left - (b.right - b.left) || a.left - b.left);
  const levelled: (Span & { level: number })[] = [];
  for (const s of sorted) {
    let below = 0;
    for (const arc of levelled) {
      if (arc.left < s.right && arc.right > s.left) below = Math.max(below, arc.level);
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
  mark: "links clause",
  aux: "auxiliary",
  cop: "copula",
  expl: "dummy subject",
  "expl:pv": "reflexive",
  "expl:pass": "reflexive",
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
  parataxis: "side clause",
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
  return stack([...chain]);
}
