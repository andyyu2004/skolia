import * as z from "zod";
import {
  CARD_GROUPS,
  CARD_KINDS,
  CLOZE_PAGE,
  DOCUMENT_PAGE,
  TAG_PAGE,
  WORD_PAGE,
  LANGS,
  LICENCES,
  MAX_AUTHOR_LENGTH,
  MAX_CLOZE_SENTENCE,
  MAX_CLOZE_WHY,
  MAX_LEMMA_LENGTH,
  MAX_LOOKUP,
  MAX_NEW_PER_DAY,
  MAX_SOURCE_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TAGS,
  RATINGS,
  READING_PAGE,
  READING_STATUSES,
  TAG_KIND,
  TAG_VALUE,
  UPOS,
  USER_TYPES,
  VISIBILITIES,
  WORD_STATUSES,
  isShareable,
  parseTag,
  tagFilter,
} from "./api.ts";
import { pageQuery } from "./page.ts";
import type { Status as StatusType, Versions as VersionsType } from "./schema.gen.ts";

export const Lang = z.enum(LANGS);

/** A time as toISOString() writes it, 2026-11-08T10:00:00.000Z: what's stored, and
 * compared as strings, which sort in time order. timestamp() makes one. */
export const Timestamp = z.iso.datetime({ precision: 3 }).brand<"Timestamp">();

/** Better Auth's user id. */
export const UserId = z.string().min(1).brand<"UserId">();

/** sha256 hex of a document's language and text (docId in keys.ts). */
export const DocumentId = z
  .string()
  .regex(/^[0-9a-f]{64}$/u)
  .brand<"DocumentId">();

export const CardId = z.uuid().brand<"CardId">();

/** Made by the client, so a retried review isn't counted twice. */
export const ReviewId = z.uuid().brand<"ReviewId">();

export const Visibility = z.enum(VISIBILITIES);
export const UserType = z.enum(USER_TYPES);

export const LemmaId = z.templateLiteral([Lang, ":", z.string().min(1).max(MAX_LEMMA_LENGTH), ":", z.enum(UPOS)]);

export const WordStatus = z.enum(WORD_STATUSES);

export const Word = z.object({ lemmaId: LemmaId, status: WordStatus, updated: Timestamp, mature: z.boolean() });

export const SetWord = z.object({ status: WordStatus });

const PerDay = z.number().int().min(0).max(MAX_NEW_PER_DAY);

/** newLemmasPerDay: new words a day, each with all its word cards; newFormsPerDay: new
 * cloze cards a day; formsWithWords: one review session for both, or one for each. */
export const Settings = z.object({ newLemmasPerDay: PerDay, newFormsPerDay: PerDay, formsWithWords: z.boolean() });

/** An ISO 8601 UTC time as a client sends it, any precision; timestamp(new Date(t)) for
 * the stored form. */
const IsoTime = z.iso.datetime();

/** at: when it was answered. */
export const ReviewRequest = z.object({
  id: ReviewId,
  cardId: CardId,
  rating: z.union(RATINGS.map((r) => z.literal(r))),
  at: IsoTime,
});

/** The start of the reader's day, for counting today's new cards in its time zone. */
const Index = z.number().int().min(0).max(MAX_TEXT_LENGTH);

/** Where a reader was in a text: the word at the top of their screen, by sentence and
 * token index in its analysis, and when they were there, so an older position doesn't
 * replace a newer one. */
export const ReadingPosition = z.object({ sentence: Index, token: Index, at: IsoTime });

export const ReadingStatus = z.enum(READING_STATUSES);
export const ReadingEntry = z.object({ status: ReadingStatus, addedAt: Timestamp, updatedAt: Timestamp });
export const SetReading = z.object({ status: ReadingStatus });
export const ReadingKey = z.tuple([Timestamp, DocumentId]).readonly();
/** A page of the texts on the reading list with the status; lang, only those in the language. */
export const ReadingQuery = pageQuery(ReadingKey, READING_PAGE).extend({ status: ReadingStatus, lang: Lang.optional() });

export const CountsQuery = z.object({ dayStart: IsoTime });
/** group: only its cards; without one, both groups'. */
export const DueQuery = z.object({ lang: Lang, dayStart: IsoTime, group: z.enum(CARD_GROUPS).optional() });

export const Cloze = z.object({
  documentId: DocumentId,
  sentence: z.string().min(1).max(MAX_CLOZE_SENTENCE),
  sentenceStart: Index,
  blankStart: Index,
  blankEnd: Index,
  feats: z.record(z.string(), z.string()),
  why: z.string().max(MAX_CLOZE_WHY).nullable(),
});

/** A cloze card to make for the word in the sentence: the blank, like the sentence, is
 * offsets in the text, and must be inside the sentence. */
export const NewCloze = Cloze.extend({ lemmaId: LemmaId }).refine(
  (c) =>
    c.sentenceStart <= c.blankStart &&
    c.blankStart < c.blankEnd &&
    c.blankEnd <= c.sentenceStart + c.sentence.length &&
    c.sentence.slice(c.blankStart - c.sentenceStart, c.blankEnd - c.sentenceStart).trim() !== "",
  { message: "the blank must be a word in the sentence" },
);

/** Where a word is in the list of a user's words: by lemma id. */
export const WordKey = z.tuple([LemmaId]).readonly();
export const WordsQuery = pageQuery(WordKey, WORD_PAGE);

/** Where a cloze card is in the list of a text's: where its blank starts. */
export const ClozeKey = z.tuple([Index]).readonly();
export const ClozesQuery = pageQuery(ClozeKey, CLOZE_PAGE).extend({ documentId: DocumentId });

/** cloze: a cloze card's sentence, null for a word's cards. */
export const ScheduledCard = z.object({
  id: CardId,
  lemmaId: LemmaId,
  kind: z.enum(CARD_KINDS),
  isNew: z.boolean(),
  dueAt: Timestamp,
  cloze: Cloze.nullable(),
});

export const LookupRequest = z.object({ ids: z.array(LemmaId).min(1).max(MAX_LOOKUP) });

export const Licence = z.enum(LICENCES);

const Source = z
  .string()
  .max(MAX_SOURCE_LENGTH)
  .refine((s) => /^https?:\/\/\S+$/u.test(s), "source must be an http(s) URL");

export const TagKind = z.string().regex(TAG_KIND, "a tag's kind is lowercase letters, digits and hyphens");
export const TagValue = z.string().regex(TAG_VALUE, "a tag's value is letters, digits and . + -");

/** An entry's tags, each kind to its value; GET /api/tags has the ones skolia has. */
export const Tags = z.record(TagKind, TagValue).refine((tags) => Object.keys(tags).length <= MAX_TAGS, `at most ${MAX_TAGS} tags`);

export const AvailableTag = z.object({ kind: TagKind, value: TagValue, description: z.string().nullable() });

/** Where a tag is in the list of them: by kind, then in the kind's order. */
export const TagKey = z.tuple([TagKind, z.number().int()]).readonly();
export const TagsQuery = pageQuery(TagKey, TAG_PAGE);

/** See DocumentKey in api.ts. */
export const DocumentKey = z.tuple([UserId, DocumentId]).readonly();

/** A page of the viewer's own documents. */
export const MyDocumentsQuery = pageQuery(DocumentKey, DOCUMENT_PAGE);

/** A page of the documents list. tag=kind:value, once or more, keeps entries with any of
 * the values of each kind given; lang, those in the language; q, those whose title has
 * it; mine=true, only the viewer's own. */
export const DocumentsQuery = MyDocumentsQuery.extend({
  lang: Lang.optional(),
  q: z
    .string()
    .trim()
    .max(MAX_TITLE_LENGTH)
    .transform((q) => q || undefined)
    .optional(),
  mine: z.stringbool().default(false),
  tag: z
    .union([z.string(), z.array(z.string())])
    .transform((tags, context) =>
      tagFilter(
        (Array.isArray(tags) ? tags : [tags]).flatMap((text) => {
          const tag = parseTag(text);
          if (tag === null) context.addIssue({ code: "custom", message: `${text} isn't a tag, kind:value` });
          return tag === null ? [] : [tag];
        }),
      ),
    )
    .optional(),
});

export const ImportRequest = z
  .object({
    title: z.string().optional(),
    text: z
      .string()
      .refine((t) => t.trim() !== "", "text must be a non-empty string")
      .refine((t) => t.length <= MAX_TEXT_LENGTH, `text is longer than ${MAX_TEXT_LENGTH} characters`),
    lang: Lang,
    visibility: Visibility.default("private"),
    licence: Licence.default("unknown"),
    author: z.string().max(MAX_AUTHOR_LENGTH).optional(),
    source: Source.optional(),
    tags: Tags.default({}),
  })
  .refine((r) => r.visibility === "private" || isShareable(r.licence), {
    message: "a public text needs a licence that allows sharing it",
    path: ["licence"],
  });

export const DocumentUpdate = z.object({
  title: z.string().trim().min(1, "title must be non-empty").max(MAX_TITLE_LENGTH).optional(),
  licence: Licence.optional(),
  author: z.string().trim().max(MAX_AUTHOR_LENGTH).nullable().optional(),
  source: Source.nullable().optional(),
  visibility: Visibility.optional(),
  tags: Tags.optional(),
});

export const State = z.enum(["queued", "analysing", "ready", "failed"]);

export const Status = z.object({
  state: State,
  updated: z.string(),
  analyzer: z.string().exactOptional(),
  lexicon: z.string().exactOptional(),
  analysis: z.string().exactOptional(),
  bundle: z.string().exactOptional(),
  error: z.string().exactOptional(),
}) satisfies z.ZodType<StatusType>;

export const Versions = z.object({
  analyzer: z.string(),
  lexicon: z.string(),
  analysis: z.string(),
  bundle: z.string(),
}) satisfies z.ZodType<VersionsType>;

export const DocumentRow = z.object({
  id: DocumentId,
  title: z.string(),
  lang: Lang,
  imported: Timestamp,
  words: z.number().int(),
  user: UserId,
  visibility: Visibility,
  licence: Licence,
  author: z.string().nullable(),
  source: z.string().nullable(),
  importerName: z.string(),
  /** The entry's user_document_tag rows, as a JSON object of kind to value. */
  tags: z
    .string()
    .transform((json) => JSON.parse(json) as unknown)
    .pipe(Tags),
});
