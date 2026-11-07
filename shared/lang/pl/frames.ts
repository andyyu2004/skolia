// Walenty valency schemata as the patterns Polish dictionaries print:
//   szukać kogoś/czegoś [gen.] w kimś/czymś [loc.]
//   bać się kogoś/czegoś [gen.]   ·   bać się, że …
// The indefinite pronoun is itself in the case, so the case shows twice: in the word
// and in the label.
import type {
  AdverbialCategory,
  Case,
  CaseSpec,
  Certainty,
  Complementizer,
  Deprel,
  Lex,
  LemmaChoice,
  Phrase,
  Position,
  Schema,
  Token,
  WhWord,
} from "@skolia/shared/schema";

export interface Frame {
  /** The pattern without the headword: "kogoś/czegoś [gen.] w kimś/czymś [loc.]". */
  pattern: string;
  /** colloquial, archaic, vulgar, doubtful; "with nie" when only negated. */
  tags: string[];
  /** Contains fixed words: an idiom (dać radę, mieć na oku). */
  idiom: boolean;
  reflexive: boolean;
  /** The sentence's own complements fit this frame. */
  here: boolean;
}

// Indefinite pronouns in each case: who/what, someone/something
const SOMEONE: Record<"nom" | "gen" | "dat" | "acc" | "inst" | "loc", string> = {
  nom: "ktoś/coś",
  gen: "kogoś/czegoś",
  dat: "komuś/czemuś",
  acc: "kogoś/coś",
  inst: "kimś/czymś",
  loc: "kimś/czymś",
};
const CASE_LABEL: Record<"nom" | "gen" | "dat" | "acc" | "inst" | "loc", string> = {
  nom: "nom.",
  gen: "gen.",
  dat: "dat.",
  acc: "acc.",
  inst: "ins.",
  loc: "loc.",
};
// "to" in each case, for "tego, że ..." clauses
const IT: Record<"nom" | "gen" | "dat" | "acc" | "inst" | "loc", string> = {
  nom: "to",
  gen: "tego",
  dat: "temu",
  acc: "to",
  inst: "tym",
  loc: "tym",
};
const ADVERBIAL: Record<AdverbialCategory, string> = {
  locat: "gdzieś [where]",
  adl: "dokądś [where to]",
  abl: "skądś [where from]",
  perl: "którędyś [which way]",
  temp: "kiedyś [when]",
  dur: "jakiś czas [how long]",
  mod: "jakoś [how]",
  caus: "z jakiegoś powodu [why]",
  dest: "po coś [what for]",
  instr: "czymś [with what]",
  misc: "jakoś [adverb]",
  pron: "tak [adverb]",
};
const CERTAINTY_TAG: Record<Certainty, string | null> = {
  certain: null,
  doubtful: "doubtful",
  colloquial: "colloquial",
  archaic: "archaic",
  vulgar: "vulgar",
  wrong: "wrong",
};

/** A noun phrase in a case spec: the pronoun plus the case label. */
function nominal(spec: CaseSpec): string {
  switch (spec) {
    case "nom":
    case "gen":
    case "dat":
    case "acc":
    case "inst":
    case "loc":
      return `${SOMEONE[spec]} [${CASE_LABEL[spec]}]`;
    case "str":
      return `${SOMEONE.acc} [acc.; gen. with nie]`;
    case "part":
      return `czegoś/coś [gen. some / acc. all]`;
    case "agr":
      return "[same case]";
    case "pred":
      return "kimś/czymś [nom./ins.]";
    case "postp":
      return "[po-form]";
  }
}

/** "Some kind of" in a case, standing for an adjective: za jakiegoś, ku jakiemuś. */
function adjectivePronoun(spec: CaseSpec): string {
  switch (spec) {
    case "nom":
      return "jakiś";
    case "gen":
    case "acc":
    case "str":
      return "jakiegoś";
    case "dat":
      return "jakiemuś";
    case "inst":
    case "loc":
      return "jakimś";
    case "part":
    case "agr":
    case "pred":
    case "postp":
      return "jakiś";
  }
}

/** The indefinite pronoun after a preposition: na kogoś/coś, w kimś/czymś. */
function pronoun(spec: CaseSpec): string {
  switch (spec) {
    case "nom":
    case "gen":
    case "dat":
    case "acc":
    case "inst":
    case "loc":
      return SOMEONE[spec];
    case "str":
      return SOMEONE.acc;
    case "part":
    case "agr":
    case "pred":
    case "postp":
      return "…";
  }
}

function caseLabel(spec: CaseSpec): string {
  switch (spec) {
    case "nom":
    case "gen":
    case "dat":
    case "acc":
    case "inst":
    case "loc":
      return CASE_LABEL[spec];
    case "str":
      return "acc.";
    case "part":
      return "gen./acc.";
    case "agr":
      return "same case";
    case "pred":
      return "nom./ins.";
    case "postp":
      return "po-form";
  }
}

function it(spec: CaseSpec): string {
  switch (spec) {
    case "nom":
    case "gen":
    case "dat":
    case "acc":
    case "inst":
    case "loc":
      return IT[spec];
    case "str":
    case "part":
    case "agr":
    case "pred":
    case "postp":
      return IT.acc;
  }
}

function clause(complementizer: Complementizer, words: WhWord[]): string {
  if (words.length > 0) return `${words.join("/")} …`;
  switch (complementizer) {
    case "int":
      return "czy/co/kto … [question]";
    case "rel":
      return "który/gdzie … [relative]";
    case "żeby2":
      return "żeby …";
    default:
      return `${complementizer} …`;
  }
}

function lemmas(choice: LemmaChoice): string {
  switch (choice.kind) {
    case "one":
      return choice.lemma;
    case "xor":
      return choice.lemmas.join("/");
    case "or":
      return choice.lemmas.join(", ");
  }
}

/** A fixed word of an idiom, with its preposition and case: "na oko [loc.]". */
function fixedWord(lex: Lex): string {
  const phrase = lex.phrase.kind === "xp" ? (lex.phrase.realisations[0] ?? lex.phrase) : lex.phrase;
  const word = lemmas(lex.lemmas);
  switch (phrase.kind) {
    case "np":
    case "adjp":
    case "nump":
      return `${word} [${caseLabel(phrase.case)}]`;
    case "prepnp":
    case "prepadjp":
    case "prepnump":
    case "prepgerp":
    case "prepppasp":
      return `${phrase.prep} ${word} [${caseLabel(phrase.case)}]`;
    default:
      return word;
  }
}

export function describePhrase(phrase: Phrase): string {
  switch (phrase.kind) {
    case "np":
    case "nump":
      return nominal(phrase.case);
    case "adjp":
    case "ppasp":
    case "pactp":
      return phrase.case === "agr" ? "jakiś [adjective]" : `jakiś [adjective, ${caseLabel(phrase.case)}]`;
    case "prepnp":
    case "prepnump":
    case "prepgerp":
    case "prepppasp":
      return `${phrase.prep} ${pronoun(phrase.case)} [${caseLabel(phrase.case)}]`;
    case "prepadjp":
      return phrase.case === "postp"
        ? `${phrase.prep} jakiemuś [adverb: po polsku]`
        : `${phrase.prep} ${adjectivePronoun(phrase.case)} [${caseLabel(phrase.case)}]`;
    case "comprepnp":
      return `${phrase.prep} …`;
    case "cp":
      return clause(phrase.complementizer, phrase.words);
    case "ncp":
      return `${it(phrase.case)}, ${clause(phrase.complementizer, phrase.words)} [${caseLabel(phrase.case)}]`;
    case "prepncp":
      return `${phrase.prep} ${it(phrase.case)}, ${clause(phrase.complementizer, phrase.words)}`;
    case "infp":
      return "robić coś [infinitive]";
    case "xp":
    case "advp":
      return ADVERBIAL[phrase.category];
    case "compar":
      return `${phrase.comparator} …`;
    case "fixed":
      return `„${phrase.text}”`;
    case "lex":
      return fixedWord(phrase);
    case "lexcompar":
      return phrase.parts.map(fixedWord).join(" ");
    case "possp":
      return "czyjś [possessive]";
    case "refl":
      return "się";
    case "recip":
      return "się [each other]";
    case "or":
      return "„…” [direct speech]";
    case "nonch":
      return "coś/nic";
    case "E":
      return "[no subject]";
    case "distrp":
      return "po … [each]";
    case "qub":
      return "[particle]";
  }
}

function isPlainSubject(position: Position): boolean {
  return (
    position.labels.includes("subj") &&
    position.phrases.every((p) => p.kind === "np" && p.case === "str")
  );
}

/** A slot's alternatives, with clauses grouped: "na kogoś/coś [acc.] / że/żeby … / na to,
 * że/żeby …" rather than one entry per complementizer. */
function describeAlternatives(phrases: Phrase[]): string {
  const parts: string[] = [];
  const clauses: string[] = [];
  const pronounClauses = new Map<string, string[]>();
  for (const phrase of phrases) {
    switch (phrase.kind) {
      case "cp":
        clauses.push(clauseWord(phrase.complementizer, phrase.words));
        break;
      case "ncp":
      case "prepncp": {
        const head = phrase.kind === "ncp" ? it(phrase.case) : `${phrase.prep} ${it(phrase.case)}`;
        const words = pronounClauses.get(head) ?? [];
        words.push(clauseWord(phrase.complementizer, phrase.words));
        pronounClauses.set(head, words);
        break;
      }
      default:
        parts.push(describePhrase(phrase));
    }
  }
  if (clauses.length > 0) parts.push(`${unique(clauses).join("/")} …`);
  for (const [head, words] of pronounClauses) parts.push(`${head}, ${unique(words).join("/")} …`);
  return parts.join(" / ");
}

/** The word a clause starts with: że, żeby, czy (indirect question), który (relative). */
function clauseWord(complementizer: Complementizer, words: WhWord[]): string {
  if (words.length > 0) return words.join("/");
  switch (complementizer) {
    case "int":
      return "czy";
    case "rel":
      return "który";
    case "żeby2":
      return "żeby";
    default:
      return complementizer;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function describePosition(position: Position): string {
  if (position.labels.includes("subj") && position.phrases.every((p) => p.kind === "E")) {
    return "(impersonal)";
  }
  const options = describeAlternatives(position.phrases);
  return position.labels.includes("subj") ? `(subject: ${options})` : options;
}

// --- Which frame the sentence uses --------------------------------------------------

/** A complement of the word in the sentence: its preposition (if any) and case. */
export interface Argument {
  prep: string | null;
  case: Case;
  /** The complement's lemma, to match an idiom's fixed words (mieć na oku: oko). */
  lemma: string | null;
}

const WALENTY_CASE: Record<Case, CaseSpec | null> = {
  Nom: "nom",
  Gen: "gen",
  Dat: "dat",
  Acc: "acc",
  Ins: "inst",
  Loc: "loc",
  Voc: null,
};

function caseFits(spec: CaseSpec, actual: Case): boolean {
  switch (spec) {
    case "str":
      // accusative object, genitive when negated
      return actual === "Acc" || actual === "Gen";
    case "part":
      return actual === "Gen" || actual === "Acc";
    case "agr":
    case "pred":
    case "postp":
      return false;
    default:
      return WALENTY_CASE[actual] === spec;
  }
}

function phraseFits(phrase: Phrase, argument: Argument): boolean {
  switch (phrase.kind) {
    case "np":
    case "nump":
      return argument.prep === null && caseFits(phrase.case, argument.case);
    case "prepnp":
    case "prepnump":
      return argument.prep === phrase.prep && caseFits(phrase.case, argument.case);
    case "xp":
      return phrase.realisations.some((r) => phraseFits(r, argument));
    case "lex":
      // a fixed word: the complement must be that word, in that phrase type
      return (
        argument.lemma !== null &&
        lemmaList(phrase.lemmas).includes(argument.lemma) &&
        phraseFits(phrase.phrase, argument)
      );
    default:
      return false;
  }
}

function lemmaList(choice: LemmaChoice): string[] {
  return choice.kind === "one" ? [choice.lemma] : choice.lemmas;
}

/** A slot only an idiom's fixed words fill: the sentence must contain them. */
function isFixed(position: Position): boolean {
  return position.phrases.every(
    (p) => p.kind === "lex" || p.kind === "lexcompar" || p.kind === "fixed",
  );
}

const COMPLEMENT_RELATIONS: ReadonlySet<Deprel> = new Set<Deprel>(["obj", "iobj", "obl:arg", "obl"]);
const PREPOSITION_RELATION: Deprel = "case";

/** The complements of tokens[index] in the sentence: objects and obliques with a case,
 * each with the preposition attached to it (czeka na autobus -> na + Acc). */
export function argumentsOf(tokens: Token[], index: number): Argument[] {
  const args: Argument[] = [];
  tokens.forEach((token, i) => {
    const caseValue = token.feats.Case;
    if (token.head !== index || !token.deprel || !COMPLEMENT_RELATIONS.has(token.deprel)) return;
    if (!caseValue) return;
    const preposition = tokens.find(
      (t) => t.head === i && t.deprel === PREPOSITION_RELATION && t.upos === "ADP",
    );
    args.push({
      prep: preposition?.lemma?.toLowerCase() ?? null,
      case: caseValue,
      lemma: token.lemma,
    });
  });
  return args;
}

/** Every argument fills a different non-subject slot of the schema, and every slot of
 * fixed words is filled (an idiom fits only if its words are in the sentence). */
function schemaFits(schema: Schema, args: Argument[]): boolean {
  const slots = schema.positions.filter((p) => !p.labels.includes("subj"));
  const used = new Set<number>();
  const placed = args.every((argument) => {
    const slot = slots.findIndex(
      (position, i) => !used.has(i) && position.phrases.some((p) => phraseFits(p, argument)),
    );
    if (slot === -1) return false;
    used.add(slot);
    return true;
  });
  return placed && slots.every((position, i) => used.has(i) || !isFixed(position));
}

export function describe(schema: Schema): Frame {
  const positions = schema.positions.filter((p) => !isPlainSubject(p));
  const tags: string[] = [];
  const certainty = CERTAINTY_TAG[schema.certainty];
  if (certainty) tags.push(certainty);
  if (schema.negation === "neg") tags.push("with nie");
  if (schema.negation === "aff") tags.push("without nie");
  const idiom = schema.positions.some((p) =>
    p.phrases.some((ph) => ph.kind === "lex" || ph.kind === "lexcompar" || ph.kind === "fixed"),
  );
  return {
    pattern: positions.map(describePosition).join(" + "),
    tags,
    idiom,
    reflexive: schema.reflexive,
    here: false,
  };
}

/** One line per distinct pattern: the ones the sentence fits first, then ordinary uses
 * before idioms, sure ones before ones with reservations. args: the word's complements
 * in the sentence (empty to mark none). */
export function frames(schemata: Schema[], args: Argument[] = []): Frame[] {
  // Of the schemata the sentence fits, mark only the tightest: fewest slots it leaves
  // empty (czeka na autobus fits "na + acc." and "na + acc. + how long"; the first)
  const unfilled = (schema: Schema) =>
    schema.positions.filter((p) => !p.labels.includes("subj")).length - args.length;
  const fitting = args.length > 0 ? schemata.filter((s) => schemaFits(s, args)) : [];
  const tightest = Math.min(...fitting.map(unfilled));
  const byPattern = new Map<string, Frame>();
  for (const schema of schemata) {
    const frame = describe(schema);
    frame.here = fitting.includes(schema) && unfilled(schema) === tightest;
    const key = `${frame.reflexive ? "się " : ""}${frame.pattern}`;
    const existing = byPattern.get(key);
    if (!existing) {
      byPattern.set(key, frame);
    } else {
      existing.here ||= frame.here;
      // the same pattern also occurs with fewer reservations: keep those tags
      if (frame.tags.length < existing.tags.length) existing.tags = frame.tags;
    }
  }
  const rank = (f: Frame) => (f.here ? 0 : 4) + (f.idiom ? 2 : 0) + (f.tags.length > 0 ? 1 : 0);
  return [...byPattern.values()].sort((a, b) => rank(a) - rank(b));
}
