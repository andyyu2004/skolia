// A sentence's dependency analysis as a tree of words for the structure view: what each
// word is, what it hangs from, and why it has its case. No geometry: see diagram.ts.
import type { CaseRule, Deprel, Token } from "@skolia/shared/schema";
import { CASE_NAME, UPOS_LABEL } from "./ud.ts";

export interface Word {
  /** The token's index in the sentence, which selections refer to. */
  index: number;
  token: Token;
  /** As drawn: "-ś" for a person ending fused to the word before. */
  form: string;
  /** Joins the word before it in the text (powróciła + ś). */
  ending: boolean;
  /** Its part of speech, or the language's label for part of a word. */
  pos: string;
  /** The relation to its head as a noun ("subject"), "main word" for the root. */
  relation: string;
  /** "genitive", for words with a case in languages that show them. */
  caseName: string | null;
  root: boolean;
  head: Word | null;
  /** Dependents in sentence order. */
  children: Word[];
  /** Steps from the top of what is drawn. */
  depth: number;
  /** Position among the drawn words. */
  order: number;
}

/** A dependency (head to dependent), or a case reason (the word causing it to the word with it). */
export interface Link {
  from: Word;
  to: Word;
  label: string;
  /** The UD relation or case rule the label stands for. */
  raw: string;
}

export interface Sentence {
  /** In sentence order. */
  words: Word[];
  /** Words drawn without a head: the main word, or the top of a clause. */
  tops: Word[];
  dependencies: Link[];
  cases: Link[];
}

export interface SentenceOptions {
  /** Only these tokens: the clause around the word in a long sentence (`clauseOf`). */
  keep?: ReadonlySet<number> | undefined;
  /** Show each word's case: for languages where nouns and adjectives have one. */
  cases?: boolean;
  /** The language's label for a token that is only part of a word (Polish -em). */
  partOfWord?: (token: Token) => string | null;
}

/** Punctuation is left out: its links carry nothing a learner needs and crowd the rest. */
export function parseSentence(tokens: Token[], options: SentenceOptions = {}): Sentence {
  const { keep, cases: withCases = true, partOfWord } = options;
  const words: Word[] = [];
  const byIndex = new Map<number, Word>();
  tokens.forEach((token, index) => {
    if (token.upos === "PUNCT" || (keep && !keep.has(index))) return;
    const ending = isEnding(tokens, index);
    const value = token.feats.Case;
    const word: Word = {
      index,
      token,
      form: ending ? `-${token.text}` : token.text,
      ending,
      pos: partOfWord?.(token) ?? UPOS_LABEL[token.upos],
      relation: token.head === null ? "main word" : relationName(token.deprel),
      caseName: withCases && value ? CASE_NAME[value] : null,
      root: token.head === null,
      head: null,
      children: [],
      depth: 0,
      order: words.length,
    };
    words.push(word);
    byIndex.set(index, word);
  });

  for (const word of words) {
    const head = word.token.head === null ? undefined : byIndex.get(word.token.head);
    if (head && head !== word) {
      word.head = head;
      head.children.push(word);
    }
  }
  const tops = depths(words);

  const dependencies: Link[] = [];
  const cases: Link[] = [];
  for (const word of words) {
    if (word.head) dependencies.push({ from: word.head, to: word, label: word.relation, raw: word.token.deprel ?? "" });
    const reason = word.token.case_reason;
    const cause = reason?.trigger === undefined ? undefined : byIndex.get(reason.trigger);
    if (reason && cause && cause !== word) cases.push({ from: cause, to: word, label: RULE[reason.rule], raw: reason.rule });
  }
  return { words, tops, dependencies, cases };
}

/** Sets each word's depth from the tops down, and returns the tops. A head chain that
 * loops has no top: it is cut at its first word, which becomes one. */
function depths(words: Word[]): Word[] {
  const tops = words.filter((w) => w.head === null);
  const seen = new Set<Word>();
  const walk = (top: Word): void => {
    const queue: Word[] = [top];
    top.depth = 0;
    seen.add(top);
    for (let word = queue.shift(); word; word = queue.shift()) {
      for (const child of word.children) {
        if (seen.has(child)) continue;
        child.depth = word.depth + 1;
        seen.add(child);
        queue.push(child);
      }
    }
  };
  tops.forEach(walk);
  for (const word of words) {
    if (seen.has(word)) continue;
    const head = word.head;
    if (head) head.children = head.children.filter((c) => c !== word);
    word.head = null;
    tops.push(word);
    walk(word);
  }
  return tops.sort((a, b) => a.order - b.order);
}

/** A token sharing its characters with the one before is the end of a fused word (-em). */
export function isEnding(tokens: Token[], index: number): boolean {
  const token = tokens[index];
  const before = tokens[index - 1];
  return token !== undefined && before !== undefined && token.start === before.start && token.end === before.end;
}

/** The case links explaining the selected word: its own, and the case of the word it
 * agrees with or is listed with, as the sheet's "Why …?" follows one step (lang/pl/cases.ts). */
export function caseChain(sentence: Sentence, selected: ReadonlySet<number>): Link[] {
  const chain: Link[] = [];
  for (const link of sentence.cases) {
    if (!selected.has(link.to.index)) continue;
    chain.push(link);
    if (link.raw !== "agreement" && link.raw !== "coordination") continue;
    const next = sentence.cases.find((c) => c.to === link.from);
    if (next && !chain.includes(next)) chain.push(next);
  }
  return chain;
}

export interface Focus {
  /** The case reasons to draw: `caseChain`. */
  chain: Link[];
  /** Token indices of the selected word's head and dependents. */
  linked: Set<number>;
  /** The token causing the selected word's case, as the text marks it. */
  trigger: number | null;
}

export function focusOn(sentence: Sentence, selected: ReadonlySet<number>): Focus {
  const linked = new Set<number>();
  for (const { from, to } of sentence.dependencies) {
    if (selected.has(to.index)) linked.add(from.index);
    if (selected.has(from.index)) linked.add(to.index);
  }
  for (const index of selected) linked.delete(index);
  const trigger = sentence.cases.find((c) => selected.has(c.to.index))?.from.index ?? null;
  return { chain: caseChain(sentence, selected), linked, trigger };
}

/** A word as a screen reader says it: "cię, pronoun, object of cenić, accusative". */
export function spokenLabel(word: Word): string {
  const role = word.head ? `${word.relation} of ${word.head.token.text}` : word.relation;
  return [word.token.text, word.pos, role, word.caseName].filter(Boolean).join(", ");
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
