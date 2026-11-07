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
  RATINGS,
  UPOS,
  VISIBILITIES,
  WORD_STATUSES,
  isShareable,
} from "./api.ts";
import type { Status as StatusType, Versions as VersionsType } from "./schema.gen.ts";

export const Lang = z.enum(LANGS);

export const Visibility = z.enum(VISIBILITIES);

export const LemmaId = z.templateLiteral([Lang, ":", z.string().min(1).max(MAX_LEMMA_LENGTH), ":", z.enum(UPOS)]);

export const WordStatus = z.enum(WORD_STATUSES);

export const Word = z.object({ lemmaId: LemmaId, status: WordStatus, updated: z.string(), mature: z.boolean() });

export const SetWord = z.object({ status: WordStatus });

export const Settings = z.object({ newPerDay: z.number().int().min(0).max(MAX_NEW_PER_DAY) });

const IsoTime = z.iso.datetime();

/** id: made by the client, so a retried review isn't counted twice. at: when it was
 * answered. */
export const ReviewRequest = z.object({
  id: z.uuid(),
  cardId: z.uuid(),
  rating: z.union(RATINGS.map((r) => z.literal(r))),
  at: IsoTime,
});

/** The start of the reader's day, for counting today's new cards in its time zone. */
export const CountsQuery = z.object({ dayStart: IsoTime });
export const DueQuery = z.object({ lang: Lang, dayStart: IsoTime });

export const ScheduledCard = z.object({
  id: z.uuid(),
  lemmaId: LemmaId,
  kind: z.enum(CARD_KINDS),
  isNew: z.boolean(),
  dueAt: z.string(),
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
  id: z.string(),
  title: z.string(),
  lang: Lang,
  imported: z.string(),
  words: z.number().int(),
  importer: z.string(),
  visibility: Visibility,
  licence: Licence,
  author: z.string().nullable(),
  source: z.string().nullable(),
  licensor: z.string(),
  importerName: z.string(),
});
