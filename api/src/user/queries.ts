// Queries of the user Durable Object (src/worker/user.ts) that the tests check the plans of.

import type { Lang, ReadingKey, ReadingStatus } from "@skolia/shared/api";
import { desc, eq, lt, row, select, type Query } from "@skolia/util/query";

/** A reading_list row's columns, as a ReadingEntry. */
export const READING_ENTRY = { status: "status", addedAt: "added_at", updatedAt: "updated_at" };

/** A page of a status's reading list, latest change first: those before the page's key,
 * which reading_list_status, or with a language reading_list_lang, seeks to. */
export function readingListQuery(status: ReadingStatus, lang: Lang | undefined, after: ReadingKey | undefined, limit: number): Query {
  return select({ documentId: "document_id", ...READING_ENTRY })
    .from("reading_list")
    .where(lang !== undefined && eq("lang", lang), eq("status", status), after !== undefined && lt(row("updated_at", "document_id"), after))
    .orderBy(desc("updated_at"), desc("document_id"))
    .limit(limit);
}
