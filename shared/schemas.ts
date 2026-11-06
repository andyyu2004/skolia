import * as z from "zod";
import { LANGS, LEMMA_STATUSES, MAX_LEMMA_LENGTH, MAX_TEXT_LENGTH, UPOS } from "./api.ts";
import type { Status as StatusType, Versions as VersionsType } from "./schema.gen.ts";

export const Lang = z.enum(LANGS);

export const LemmaId = z.templateLiteral([Lang, ":", z.string().min(1).max(MAX_LEMMA_LENGTH), ":", z.enum(UPOS)]);

export const LemmaStatus = z.enum(LEMMA_STATUSES);

export const KnownLemma = z.object({ lemmaId: LemmaId, status: LemmaStatus, updated: z.string() });

export const SetLemma = z.object({ status: LemmaStatus });

export const ImportRequest = z.object({
  title: z.string().optional(),
  text: z
    .string()
    .refine((t) => t.trim() !== "", "text must be a non-empty string")
    .refine((t) => t.length <= MAX_TEXT_LENGTH, `text is longer than ${MAX_TEXT_LENGTH} characters`),
  lang: Lang,
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
});
