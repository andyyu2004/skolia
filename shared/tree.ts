// A sentence's dependency analysis as a tree of words for the structure view: what each
// word is, what it hangs from, and why it has its case. No geometry: see diagram.ts.
import type { CaseRule, Deprel, Token } from "@skolia/shared/schema";
import { CASE_NAME, UPOS_LABEL } from "./ud.ts";

export interface Word {
  /** The token's index in the sentence, which selections refer to. */
  readonly index: number;
  readonly token: Token;
  /** As drawn: "-ś" for a person ending fused to the word before. */
  readonly form: string;
  /** Joins the word before it in the text (powróciła + ś). */
  readonly ending: boolean;
  /** Its part of speech, or the language's label for part of a word. */
  readonly pos: string;
  /** The relation to its head as a noun ("subject"); none for the root, which isn't related to anything. */
  readonly relation: string | null;
  /** "genitive", for words with a case in languages that show them. */
  readonly caseName: string | null;
  readonly root: boolean;
  /** Null for a top: the main word, or the top of a clause. */
  readonly head: Word | null;
  /** Steps from its top. */
  readonly depth: number;
  /** Position among the drawn words. */
  readonly order: number;
}

/** A dependency (head to dependent), or a case reason (the word causing it to the word with it). */
export interface Link {
  readonly from: Word;
  readonly to: Word;
  readonly label: string;
  /** The UD relation or case rule the label stands for. */
  readonly raw: string;
}

export interface Sentence {
  /** In sentence order. */
  readonly words: readonly Word[];
  /** Words drawn without a head: the main word, or the top of a clause. */
  readonly tops: readonly Word[];
  /** Each word's dependents, in sentence order. */
  readonly children: ReadonlyMap<Word, readonly Word[]>;
  readonly dependencies: readonly Link[];
  readonly cases: readonly Link[];
}

export interface SentenceOptions {
  /** Only these tokens: the clause around the word in a long sentence (`clauseOf`). */
  readonly keep?: ReadonlySet<number> | undefined;
  /** Show each word's case: for languages where nouns and adjectives have one. */
  readonly cases?: boolean;
  /** The language's label for a token that is only part of a word (Polish -em). */
  readonly partOfWord?: (token: Token) => string | null;
}

/** Punctuation is left out: its links carry nothing a learner needs and crowd the rest. */
export function parseSentence(tokens: readonly Token[], options: SentenceOptions = {}): Sentence {
  const { keep, cases: withCases = true, partOfWord } = options;
  const drawn = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token, index }) => token.upos !== "PUNCT" && (!keep || keep.has(index)))
    .map((d, order) => ({ ...d, order }));
  const headOf = drawnHeads(
    tokens,
    drawn.map((d) => d.index),
  );
  const dependentsOf = (index: number | null): typeof drawn => drawn.filter((d) => headOf(d.index) === index);

  // Top-down, so each word's head, and so its depth, exists when the word is made.
  // Every drawn token has a top to reach once loops are cut, so each is grown once.
  const grow = ({ token, index, order }: (typeof drawn)[number], head: Word | null): readonly Word[] => {
    const ending = isEnding(tokens, index);
    const value = token.feats.Case;
    const word: Word = {
      index,
      token,
      form: ending ? `-${token.text}` : token.text,
      ending,
      pos: partOfWord?.(token) ?? UPOS_LABEL[token.upos],
      relation: token.head === null ? null : relationName(token.deprel),
      caseName: withCases && value ? CASE_NAME[value] : null,
      root: token.head === null,
      head,
      depth: head ? head.depth + 1 : 0,
      order,
    };
    return [word, ...dependentsOf(index).flatMap((d) => grow(d, word))];
  };
  const words = dependentsOf(null)
    .flatMap((d) => grow(d, null))
    .sort((a, b) => a.order - b.order);
  const byIndex = new Map(words.map((w) => [w.index, w]));
  const children = new Map(words.map((w) => [w, words.filter((d) => d.head === w)]));
  const dependencies = words.flatMap((word): Link[] =>
    word.head && word.relation !== null ? [{ from: word.head, to: word, label: word.relation, raw: word.token.deprel ?? "" }] : [],
  );
  const cases = words.flatMap((word): Link[] => {
    const reason = word.token.case_reason;
    const cause = reason?.trigger === undefined ? undefined : byIndex.get(reason.trigger);
    return reason && cause && cause !== word ? [{ from: cause, to: word, label: RULE[reason.rule], raw: reason.rule }] : [];
  });
  return { words, tops: words.filter((w) => w.head === null), children, dependencies, cases };
}

/** Each drawn token's head among the drawn tokens, or null for a top. A head chain that
 * loops would never reach a top, so each loop is cut at its first token. */
function drawnHeads(tokens: readonly Token[], drawn: readonly number[]): (index: number) => number | null {
  const inside = new Set(drawn);
  const given = (index: number): number | null => {
    const head = tokens[index]?.head ?? null;
    return head !== null && head !== index && inside.has(head) ? head : null;
  };
  /** The heads above `index`, up to a top or until one repeats. */
  const above = (index: number, seen: readonly number[] = []): readonly number[] => {
    const head = given(index);
    return head === null || seen.includes(head) ? seen : above(head, [...seen, head]);
  };
  const cut = new Set(
    drawn.flatMap((index) => {
      const chain = above(index);
      return chain.includes(index) ? [Math.min(...chain)] : [];
    }),
  );
  return (index) => (cut.has(index) ? null : given(index));
}

/** A token sharing its characters with the one before is the end of a fused word (-em). */
export function isEnding(tokens: readonly Token[], index: number): boolean {
  const token = tokens[index];
  const before = tokens[index - 1];
  return token !== undefined && before !== undefined && token.start === before.start && token.end === before.end;
}

/** The case links explaining the selected word: its own, and the case of the word it
 * agrees with or is listed with, as the sheet's "Why …?" follows one step (lang/pl/cases.ts). */
export function caseChain(sentence: Sentence, selected: ReadonlySet<number>): readonly Link[] {
  const own = sentence.cases.filter((link) => selected.has(link.to.index));
  const followed = own.flatMap((link) =>
    link.raw === "agreement" || link.raw === "coordination" ? sentence.cases.filter((c) => c.to === link.from) : [],
  );
  return [...new Set([...own, ...followed])];
}

export interface Focus {
  /** The case reasons to draw: `caseChain`. */
  readonly chain: readonly Link[];
  /** Token indices of the selected word's head and dependents. */
  readonly linked: ReadonlySet<number>;
  /** The token causing the selected word's case, as the text marks it. */
  readonly trigger: number | null;
}

export function focusOn(sentence: Sentence, selected: ReadonlySet<number>): Focus {
  const neighbours = sentence.dependencies.flatMap(({ from, to }) => [
    ...(selected.has(to.index) ? [from.index] : []),
    ...(selected.has(from.index) ? [to.index] : []),
  ]);
  const trigger = sentence.cases.find((c) => selected.has(c.to.index))?.from.index ?? null;
  return {
    chain: caseChain(sentence, selected),
    linked: new Set(neighbours.filter((index) => !selected.has(index))),
    trigger,
  };
}

/** A word as a screen reader says it: "cię, pronoun, object of cenić, accusative", or "je, verb" for the root. */
export function spokenLabel(word: Word): string {
  const role = word.head ? `${word.relation} of ${word.head.token.text}` : word.relation;
  return [word.token.text, word.pos, role, word.caseName].filter(Boolean).join(", ");
}

/** The tokens of the clause around `index` when the sentence is long: the nearest clause
 * (a verb's own clause, a relative or adverbial clause, a coordinated clause) above it
 * with at least `least` words. Null when that is the whole sentence. */
export function clauseOf(tokens: readonly Token[], index: number, least = 6): ReadonlySet<number> | null {
  const isWord = (i: number): boolean => tokens[i]?.upos !== "PUNCT";
  const big = (top: number): ReadonlySet<number> | null => {
    const clause = subtree(tokens, top);
    return [...clause].filter(isWord).length >= least ? clause : null;
  };
  const from = (at: number, seen: ReadonlySet<number>): ReadonlySet<number> | null => {
    const token = tokens[at];
    if (!token || token.head === null || seen.has(at)) return null;
    return (opensClause(token) ? big(at) : null) ?? from(token.head, new Set([...seen, at]));
  };
  return from(index, new Set());
}

// Relations whose dependent heads a clause of its own. xcomp is left out: an infinitive
// after mógł or chcieć reads as part of its verb's clause.
const CLAUSE: ReadonlySet<string> = new Set(["ccomp", "advcl", "acl", "csubj", "parataxis"]);

function opensClause(token: Token): boolean {
  const base = token.deprel?.split(":")[0] ?? "";
  return CLAUSE.has(base) || (base === "conj" && (token.upos === "VERB" || token.upos === "AUX"));
}

/** `top` and every token whose heads lead up to it. */
function subtree(tokens: readonly Token[], top: number): ReadonlySet<number> {
  const under = (at: number | null, seen: ReadonlySet<number>): boolean =>
    at !== null && !seen.has(at) && (at === top || under(tokens[at]?.head ?? null, new Set([...seen, at])));
  return new Set(tokens.flatMap((_, i) => (under(i, new Set()) ? [i] : [])));
}

// A relation as a noun for the diagram; `roleLabel` in ud.ts phrases it for the sheet
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

// What the word at a case link's start does to the case of the word at its end. Rules
// without a trigger (vocative, instrumental) have no link.
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
