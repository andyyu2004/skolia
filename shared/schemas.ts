import * as z from "zod";
import {
  ANNOTATION_PAGE,
  CARD_GROUPS,
  CARD_KINDS,
  CLOZE_PAGE,
  DOCUMENT_PAGE,
  TAG_PAGE,
  WORD_PAGE,
  LANGS,
  LICENCES,
  MAX_ANNOTATION_TEXT,
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
  SHAREABLE_LICENCES,
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

export const Word = z.object({ lemmaId: LemmaId, status: WordStatus, updatedAt: Timestamp, mature: z.boolean() });

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

/** sha256 hex of what an annotation says (annotationId in annotations.ts). */
export const AnnotationId = z
  .string()
  .regex(/^[0-9a-f]{64}$/u)
  .brand<"AnnotationId">();

/** A kind's data: its fields, and no others. */
function kindData<S extends z.ZodRawShape>(kind: string, shape: S) {
  const fields = Object.keys(shape).join(", ");
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `${kind} annotation data has only ${fields}`
        : issue.input === undefined
          ? `${kind} annotation data must be {${fields}}`
          : undefined,
  });
}

/** A field's own message, or one saying it's missing. */
function field(kind: string, name: string, message: string) {
  return {
    error: (issue: { readonly input?: unknown }) => (issue.input === undefined ? `${kind} annotation data needs ${name}` : message),
  };
}

/** What an annotation holds, by kind. audio: a recording of the range, at an https URL
 * skolia doesn't host. text: anything written about the range, a note or a translation,
 * say. Migration 0010 holds the stored data to the same fields; a new kind is a variant here
 * and a migration. */
export const AnnotationContent = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("audio"),
      data: kindData("audio", {
        url: z.url({ protocol: /^https$/u, ...field("audio", "a url", "url must be an https URL") }).max(MAX_SOURCE_LENGTH),
      }),
    }),
    z.object({
      kind: z.literal("text"),
      data: kindData("text", {
        text: z
          .string(field("text", "text", "text must be a string"))
          .trim()
          .min(1, "text must be non-empty")
          .max(MAX_ANNOTATION_TEXT, `text is at most ${MAX_ANNOTATION_TEXT} characters`),
      }),
    }),
  ],
  { error: "kind must be audio or text" },
);

export const Annotation = z.intersection(
  z.object({
    id: AnnotationId,
    start: Index,
    end: Index,
    licence: z.enum(SHAREABLE_LICENCES),
    author: z.string().nullable(),
    source: z.string().nullable(),
    addedAt: Timestamp,
  }),
  AnnotationContent,
);

/** An annotation to add: its data must be its kind's, and it must end after it starts. That
 * it ends within the text is checked against the text. */
export const NewAnnotation = z
  .intersection(
    z.object({
      start: Index,
      end: Index,
      licence: z.enum(SHAREABLE_LICENCES, "an annotation needs a licence that allows sharing it"),
      author: z.string().trim().max(MAX_AUTHOR_LENGTH).optional(),
      source: Source.optional(),
    }),
    AnnotationContent,
  )
  .refine((a) => a.start < a.end, { message: "an annotation must end after it starts", path: ["end"] })
  .transform((a) => ({ ...a, author: a.author || null, source: a.source ?? null }));

export const AnnotationKey = z.tuple([Index, AnnotationId]).readonly();
const Offset = z.coerce.number().int().min(0).max(MAX_TEXT_LENGTH);
/** A page of an entry's annotations; from and to, only those overlapping [from, to). */
export const AnnotationsQuery = pageQuery(AnnotationKey, ANNOTATION_PAGE)
  .extend({ from: Offset.optional(), to: Offset.optional() })
  .refine((q) => q.from === undefined || q.to === undefined || q.from < q.to, { message: "from must be before to", path: ["to"] });

/** An annotation as D1 has it, its data a JSON string. */
export const AnnotationRow = z
  .looseObject({ data: z.string() })
  .transform((row) => ({ ...row, data: JSON.parse(row.data) as unknown }))
  .pipe(Annotation);

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
  importedAt: Timestamp,
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
