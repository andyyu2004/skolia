// Requests and responses of skolia-api. The analysis and bundle shapes come from the
// Python schemas (schema.gen.ts); these are the API's own.
import type { z } from "zod";
import type { BundleParadigm, Feats, Pronunciation, Relation, Sense, State, Token, Upos } from "./schema.gen.ts";
import type * as schemas from "./schemas.ts";

import type { PageSize } from "./page.ts";

export type { Paginated } from "./page.ts";

/** A page of documents reads each one's status from R2, so it stays small. */
export const DOCUMENT_PAGE: PageSize = { fallback: 24, max: 50 };
export const TAG_PAGE: PageSize = { fallback: 100, max: 500 };
/** The reader follows these lists to the end, so their pages are big. */
export const WORD_PAGE: PageSize = { fallback: 500, max: 1000 };
export const CLOZE_PAGE: PageSize = { fallback: 500, max: 1000 };
/** Like a page of documents, a page of the reading list reads each text's status from R2. */
export const READING_PAGE: PageSize = { fallback: 24, max: 50 };
export const ANNOTATION_PAGE: PageSize = { fallback: 500, max: 1000 };

/** Most annotations an entry has. */
export const MAX_ANNOTATIONS = 2000;

export const LANGS = ["en", "fr", "pl"] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(value: unknown): value is Lang {
  return LANGS.some((l) => l === value);
}

export interface LanguageInfo {
  /** English name. */
  name: string;
  /** The language's name for itself, for language pickers. */
  endonym: string;
  /** A flag emoji shown beside the endonym. */
  flag: string;
}

export const LANGUAGE_INFO: Record<Lang, LanguageInfo> = {
  en: { name: "English", endonym: "English", flag: "🇬🇧" },
  fr: { name: "French", endonym: "Français", flag: "🇫🇷" },
  pl: { name: "Polish", endonym: "Polski", flag: "🇵🇱" },
};

/** Longest text accepted by one import, in characters (ingest checks it too). */
export { MAX_TEXT_LENGTH } from "./schema.gen.ts";

export type ImportRequest = z.input<typeof schemas.ImportRequest>;

/** A change to a document's title, licence, author, source, visibility or tags, by its
 * importer. A field left out stays as it is; null clears author or source; tags replace
 * all of its tags. */
export type DocumentUpdate = z.input<typeof schemas.DocumentUpdate>;

/** A user's entry for a text. private: only that user sees it. A text no entry makes
 * public is unknown (404) to everyone else. */
export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** The licence a text is under, as its uploader claims it. unknown: the texts from before
 * licences were recorded. */
export const LICENCES = [
  "public-domain",
  "cc0",
  "cc-by",
  "cc-by-sa",
  "cc-by-nc",
  "cc-by-nc-sa",
  "cc-by-nd",
  "cc-by-nc-nd",
  "all-rights-reserved",
  "unknown",
] as const;
export type Licence = (typeof LICENCES)[number];

/** The licences a public text can be under. NC (non-commercial) is fine, as skolia is.
 * ND (no derivatives) is fine while texts are shown whole and unchanged, the analysis
 * beside them: CC 4.0 lets you share the work "in whole or in part" and make the
 * "technical modifications" a medium needs (2(a)(4)). Translating, simplifying or
 * editing a text, or glossing it inline, would make an adaptation, which ND forbids
 * sharing. */
export const SHAREABLE_LICENCES = [
  "public-domain",
  "cc0",
  "cc-by",
  "cc-by-sa",
  "cc-by-nc",
  "cc-by-nc-sa",
  "cc-by-nd",
  "cc-by-nc-nd",
] as const satisfies readonly Licence[];

export type ShareableLicence = (typeof SHAREABLE_LICENCES)[number];

export function isShareable(licence: Licence): boolean {
  return SHAREABLE_LICENCES.some((l) => l === licence);
}

export interface LicenceInfo {
  /** Short name, for cards and credits. */
  short: string;
  /** Longer name, for the upload form. */
  label: string;
  /** The licence's deed, where there is one. */
  url: string | null;
}

export const LICENCE_INFO: Record<Licence, LicenceInfo> = {
  "public-domain": { short: "Public domain", label: "Public domain", url: null },
  cc0: { short: "CC0", label: "CC0 (no rights reserved)", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  "cc-by": { short: "CC BY", label: "CC BY (attribution)", url: "https://creativecommons.org/licenses/by/4.0/" },
  "cc-by-sa": { short: "CC BY-SA", label: "CC BY-SA (attribution, share-alike)", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  "cc-by-nc": {
    short: "CC BY-NC",
    label: "CC BY-NC (attribution, non-commercial)",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
  },
  "cc-by-nc-sa": {
    short: "CC BY-NC-SA",
    label: "CC BY-NC-SA (attribution, non-commercial, share-alike)",
    url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  },
  "cc-by-nd": {
    short: "CC BY-ND",
    label: "CC BY-ND (attribution, no derivatives)",
    url: "https://creativecommons.org/licenses/by-nd/4.0/",
  },
  "cc-by-nc-nd": {
    short: "CC BY-NC-ND",
    label: "CC BY-NC-ND (attribution, non-commercial, no derivatives)",
    url: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
  },
  "all-rights-reserved": { short: "All rights reserved", label: "All rights reserved, or not sure", url: null },
  unknown: { short: "Licence unknown", label: "Unknown", url: null },
};

/** A tag, a kind and a value: level:B1. Only the tags skolia has (GET /api/tags) can be
 * given, and an entry has at most one of each kind. */
export interface Tag {
  kind: string;
  value: string;
}

/** A tag that can be given, and what it means: level:B1, "Intermediate". */
export interface AvailableTag extends Tag {
  description: string | null;
}

/** An entry's tags, each kind to its value. */
export type Tags = Readonly<Record<string, string>>;

/** A list's tags to keep: each kind to its values. An entry is kept when, for every kind,
 * its tag of that kind is one of the values: any of one kind, all of the kinds. */
export type TagFilter = Readonly<Record<string, readonly string[]>>;

export const TAG_KIND = /^[a-z][a-z0-9-]{0,31}$/u;
export const TAG_VALUE = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,31}$/u;
export const MAX_TAGS = 16;

/** kind:value, as GET /api/documents?tag= takes it. */
export function formatTag({ kind, value }: Tag): string {
  return `${kind}:${value}`;
}

/** A tag from kind:value; null for anything else. */
export function parseTag(text: string): Tag | null {
  const colon = text.indexOf(":");
  const kind = text.slice(0, colon);
  const value = text.slice(colon + 1);
  return colon > 0 && TAG_KIND.test(kind) && TAG_VALUE.test(value) ? { kind, value } : null;
}

/** The tags, as a filter keeping entries with any of them of each kind. */
export function tagFilter(tags: readonly Tag[]): TagFilter {
  return tags.reduce<Record<string, readonly string[]>>(
    (filter, { kind, value }) => ({ ...filter, [kind]: [...new Set([...(filter[kind] ?? []), value])] }),
    {},
  );
}

export function matchesTags(tags: Tags, filter: TagFilter): boolean {
  return Object.entries(filter).every(([kind, values]) => {
    const value = tags[kind];
    return value !== undefined && values.includes(value);
  });
}

export const MAX_TITLE_LENGTH = 200;
export const MAX_AUTHOR_LENGTH = 200;
export const MAX_SOURCE_LENGTH = 2000;

export type Timestamp = z.output<typeof schemas.Timestamp>;
export type UserId = z.output<typeof schemas.UserId>;
export type DocumentId = z.output<typeof schemas.DocumentId>;
export type CardId = z.output<typeof schemas.CardId>;
export type ReviewId = z.output<typeof schemas.ReviewId>;

export function timestamp(date: Date): Timestamp {
  return date.toISOString() as Timestamp;
}

/** One user's entry for a text: the viewer's own, or someone's public one. Its title,
 * visibility, licence, author and source are that user's. */
export interface DocumentSummary {
  /** The text's: the same text imported twice in one language is one document. */
  id: DocumentId;
  title: string;
  lang: Lang;
  importedAt: Timestamp;
  words: number;
  visibility: Visibility;
  licence: Licence;
  /** Who wrote the text, as the uploader gives it. */
  author: string | null;
  /** An http(s) URL of where the text is from. */
  source: string | null;
  tags: Tags;
  /** The entry's user: with id, the summary is one (document, user) pair. */
  importer: { id: UserId; name: string };
  /** Whether it's the viewer's entry, so they can change or delete it. */
  mine: boolean;
  /** Where it is in its language's analysis queue: for the viewer's own document, while
   * it's queued or analysing, when it's asked for on its own. */
  queue?: QueuePlace | undefined;
  state: State;
  /** The analysis and bundle to show, by name (GET .../analysis/{name}): the current
   * ones, or while newer ones are queued or analysing (or failed), the previous ones.
   * Absent until a first analysis is ready. */
  reading?: ReadingNames | undefined;
  error?: string | undefined;
}

/** starting: the language's analyser is starting, its container booting or its model
 * loading. ahead: how many texts it analyses before this one, the one it's analysing
 * included; null when it hasn't been handed this one yet. */
export interface QueuePlace {
  starting: boolean;
  ahead: number | null;
}

export interface ReadingNames {
  analysis: string;
  bundle: string;
}

/** Which entries a list of documents keeps. mine: only the viewer's own, public or
 * private. title: those whose title has it, case aside (ASCII letters' case only). */
export type DocumentFilter = {
  readonly tags: TagFilter;
  readonly lang: Lang | undefined;
  readonly title: string | undefined;
  readonly mine: boolean;
};

/** Where an entry is in a list of documents: by its user, then its text. A fixed order
 * that every filter has an index in; an order for people to browse is to come. */
export type DocumentKey = z.output<typeof schemas.DocumentKey>;
export type TagKey = z.output<typeof schemas.TagKey>;
export type WordKey = z.output<typeof schemas.WordKey>;
export type ClozeKey = z.output<typeof schemas.ClozeKey>;

/** A word the user is learning (active), or has marked as known or ignored (names,
 * typos), which takes its cards out of reviews. A word with no status is new. */
export const WORD_STATUSES = ["active", "known", "ignored"] as const;
export type WordStatus = (typeof WORD_STATUSES)[number];

/** A word's cards, one of each. recognition: the lemma on the front, its glosses on the
 * back. production: the other way round. */
export const WORD_CARD_KINDS = ["recognition", "production"] as const;

/** cloze: a sentence from a text with a word blanked out, its lemma the hint. Made from the
 * reader, any number per lemma. Like the word's own cards, they're reviewed while the word
 * is active or has no status. */
export const CARD_KINDS = [...WORD_CARD_KINDS, "cloze"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** Longest sentence a cloze card keeps, in characters. */
export const MAX_CLOZE_SENTENCE = 2000;
/** Longest explanation of the blanked word's form a cloze card keeps. */
export const MAX_CLOZE_WHY = 500;

/** ts-fsrs's grades: Again, Hard, Good, Easy. */
export const RATINGS = [1, 2, 3, 4] as const;
export type Rating = (typeof RATINGS)[number];

/** Anki's: a card is mature once its interval is this many days or more. */
export const MATURE_DAYS = 21;

export const DEFAULT_NEW_LEMMAS_PER_DAY = 20;
export const DEFAULT_NEW_FORMS_PER_DAY = 20;
export const MAX_NEW_PER_DAY = 1000;

/** words: a word's recognition and production cards; forms: its cloze cards. Each has its
 * own daily allowance, and can be reviewed alone. */
export const CARD_GROUPS = ["words", "forms"] as const;
export type CardGroup = (typeof CARD_GROUPS)[number];

/** Most ids one lexicon lookup takes. */
export const MAX_LOOKUP = 100;

export const UPOS = [
  "ADJ",
  "ADP",
  "ADV",
  "AUX",
  "CCONJ",
  "DET",
  "INTJ",
  "NOUN",
  "NUM",
  "PART",
  "PRON",
  "PROPN",
  "PUNCT",
  "SCONJ",
  "SYM",
  "VERB",
  "X",
] as const satisfies readonly Upos[];

const UPOS_IS_COMPLETE: Exclude<Upos, (typeof UPOS)[number]> extends never ? true : never = true;
void UPOS_IS_COMPLETE;

export const MAX_LEMMA_LENGTH = 100;

/** Lexicon entry id, as analysis's blob.lemma_id writes it. */
export type LemmaId = z.output<typeof schemas.LemmaId>;

/** A lemma id as a path param. Hono's client doesn't encode params, and a lemma can have a
 * slash (pl:i/lub:CCONJ); the API decodes it. */
export function lemmaParam(id: LemmaId): LemmaId {
  return encodeURIComponent(id) as LemmaId;
}

export function langOf(id: LemmaId): Lang {
  return id.slice(0, id.indexOf(":")) as Lang;
}

/** mature: its recognition card is mature, so the reader shows it as known. */
export type Word = z.output<typeof schemas.Word>;

export type Settings = z.output<typeof schemas.Settings>;

export type ReadingPosition = z.output<typeof schemas.ReadingPosition>;

export type ReviewRequest = z.output<typeof schemas.ReviewRequest>;
/** What the reader sends: the same, before the API's validation brands its ids. */
export type ReviewRequestInput = z.input<typeof schemas.ReviewRequest>;

/** A lexicon entry: what a card shows. Its paradigms' forms point into feature sets,
 * ["psa", [50, 51]], which the response carries (FeatureSets). */
export interface LexiconEntry {
  lemmaId: LemmaId;
  lemma: string;
  upos: Upos;
  senses: Sense[];
  relations: Relation[];
  /** How the lemma is said */
  pronunciations: Pronunciation[];
  paradigms: BundleParadigm[];
}

/** The feature sets a response's paradigms use, by id: { "50": { Case: "Gen", ... } }. An
 * id means something only within its language's loaded lexicon. */
export type FeatureSets = Record<string, Feats>;

/** Entries by lemma id, and the feature sets their paradigms use, by language. */
export interface Lookup {
  entries: LexiconEntry[];
  featureSets: Partial<Record<Lang, FeatureSets>>;
}

/** A card to review. entry is null if the lexicon doesn't have the lemma. */
export interface DueCard extends ScheduledCard {
  entry: LexiconEntry | null;
}

export type ScheduledCard = z.output<typeof schemas.ScheduledCard>;

/** A cloze card's sentence, copied from its text so the card outlives the text and its
 * analysis. sentenceStart, blankStart and blankEnd are offsets in the text (blankParts
 * cuts the sentence at the blank). feats: the blanked word's, and why: the reader's
 * explanation of its case, both from the analysis when the card was made. */
export type Cloze = z.output<typeof schemas.Cloze>;
export type NewCloze = z.output<typeof schemas.NewCloze>;
/** What the reader sends: the same, before the API's validation brands its ids. */
export type NewClozeInput = z.input<typeof schemas.NewCloze>;

/** A sentence of a text, start being where it starts in the text, with the token blanked out. */
export function blankOut(
  sentence: { readonly start: number; readonly text: string },
  token: Pick<Token, "start" | "end" | "feats">,
): Pick<NewClozeInput, "sentence" | "sentenceStart" | "blankStart" | "blankEnd" | "feats"> {
  return {
    sentence: sentence.text,
    sentenceStart: sentence.start,
    blankStart: token.start,
    blankEnd: token.end,
    feats: { ...token.feats } as Record<string, string>,
  };
}

/** A cloze card's sentence before, at and after its blank. */
export function blankParts(cloze: Pick<Cloze, "sentence" | "sentenceStart" | "blankStart" | "blankEnd">): {
  readonly before: string;
  readonly blank: string;
  readonly after: string;
} {
  const start = cloze.blankStart - cloze.sentenceStart;
  const end = cloze.blankEnd - cloze.sentenceStart;
  return { before: cloze.sentence.slice(0, start), blank: cloze.sentence.slice(start, end), after: cloze.sentence.slice(end) };
}

/** The cloze card made, or the one the sentence and word already had. */
export interface ClozeMade {
  readonly cardId: CardId;
}

/** One of a text's cloze cards, by where its blank starts in it. */
export type ClozeStart = {
  readonly cardId: CardId;
  readonly start: number;
};

/** Where a text is on the user's reading list. A text that isn't on it has none. */
export const READING_STATUSES = ["to-read", "reading", "finished"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

/** A text on the user's reading list: its status, when it went on the list, and when its
 * status last changed. */
export type ReadingEntry = z.output<typeof schemas.ReadingEntry>;

/** Which texts a page of the reading list keeps: those with the status, and those in the
 * language if one is given. */
export type ReadingFilter = { readonly status: ReadingStatus; readonly lang: Lang | undefined };

/** Where a text is in the list of one status: by when its status last changed, latest
 * first, then by id. */
export type ReadingKey = z.output<typeof schemas.ReadingKey>;

/** Something an entry's user attached to a range of its text, start to end in UTF-16 units
 * as JavaScript counts them: a kind and its data (AnnotationContent). Seen wherever the entry
 * is, with its own licence, author and source. id: a hash of what it says. */
export type Annotation = z.output<typeof schemas.Annotation>;
export type AnnotationId = z.output<typeof schemas.AnnotationId>;
/** What the reader sends to add one. */
export type NewAnnotation = z.input<typeof schemas.NewAnnotation>;
/** Where an annotation is in its entry's list: where it starts, then its id. */
export type AnnotationKey = z.output<typeof schemas.AnnotationKey>;

/** Which of an entry's annotations a page keeps: those overlapping [from, to), in UTF-16
 * units, either side open when it's left out. */
export type AnnotationFilter = { readonly from: number | undefined; readonly to: number | undefined };

/** What an annotation holds, its kind and that kind's data. */
export type AnnotationContent = z.output<typeof schemas.AnnotationContent>;
export type AnnotationKind = AnnotationContent["kind"];

/** Longest text a text annotation holds. */
export const MAX_ANNOTATION_TEXT = 2000;

/** A text on the reading list, with the entry the user sees for it. */
export type ListedReading = ReadingEntry & { readonly document: DocumentSummary };

/** What's left of today's allowances: words in lemmas, forms in cards. */
export type NewLeft = Readonly<Record<CardGroup, number>>;

/** Cards due now, then new cards up to what's left of today's allowances. */
export interface Due {
  cards: DueCard[];
  newLeft: NewLeft;
  /** The feature sets the cards' paradigms use, in the cards' language */
  featureSets: FeatureSets;
}

/** Cards due now, and what new would come up today: words' lemmas, as newLeft counts them,
 * and forms' cards. */
export interface Tally {
  readonly due: number;
  readonly new: number;
}

/** A language's cards to review, by group. */
export type CardCounts = { readonly lang: Lang } & Readonly<Record<CardGroup, Tally>>;

/** A card after a review: when it's due next. */
export interface Reviewed {
  cardId: CardId;
  dueAt: Timestamp;
}

/** standard: someone who signed in. system: skolia.io's own accounts, the end-to-end
 * tests' importer and the curated texts'. */
export const USER_TYPES = ["standard", "system"] as const;
export type UserType = (typeof USER_TYPES)[number];

export interface User {
  id: UserId;
  name: string;
  email: string;
  image: string | null;
  type: UserType;
}

export interface Version {
  version: string;
}

export interface ApiError {
  error: string;
}
