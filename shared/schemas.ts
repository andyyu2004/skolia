import * as z from "zod";
import {
  CARD_KINDS,
  LANGS,
  LICENCES,
  MAX_AUTHOR_LENGTH,
  MAX_LEMMA_LENGTH,
  MAX_LOOKUP,
  MAX_NEW_PER_DAY,
  MAX_SOURCE_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  RATINGS,
  UPOS,
  USER_TYPES,
  VISIBILITIES,
  WORD_STATUSES,
  isShareable,
} from "./api.ts";
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

export const Settings = z.object({ newPerDay: z.number().int().min(0).max(MAX_NEW_PER_DAY) });

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

export const CountsQuery = z.object({ dayStart: IsoTime });
export const DueQuery = z.object({ lang: Lang, dayStart: IsoTime });

export const ScheduledCard = z.object({
  id: CardId,
  lemmaId: LemmaId,
  kind: z.enum(CARD_KINDS),
  isNew: z.boolean(),
  dueAt: Timestamp,
});

export const LookupRequest = z.object({ ids: z.array(LemmaId).min(1).max(MAX_LOOKUP) });

export const Licence = z.enum(LICENCES);

const Source = z
  .string()
  .max(MAX_SOURCE_LENGTH)
  .refine((s) => /^https?:\/\/\S+$/u.test(s), "source must be an http(s) URL");

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
  importer: UserId,
  visibility: Visibility,
  licence: Licence,
  author: z.string().nullable(),
  source: z.string().nullable(),
  licensor: UserId,
  importerName: z.string(),
});
