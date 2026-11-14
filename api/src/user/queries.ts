// Queries of the user Durable Object (src/worker/user.ts) that the tests check the plans of.

import type { Lang, ReadingKey, ReadingStatus } from "@skolia/shared/api";
import { sql, type Sql } from "@skolia/util/sql";

/** A reading_list row's columns, as a ReadingEntry. */
export const READING_ENTRY = sql`status, added_at AS "addedAt", updated_at AS "updatedAt"`;

/** A page of a status's reading list, latest change first: those before the page's key,
 * which reading_list_status, or with a language reading_list_lang, seeks to. */
export function readingListQuery(status: ReadingStatus, lang: Lang | undefined, after: ReadingKey | undefined, limit: number): Sql {
  return sql`SELECT document_id AS "documentId", ${READING_ENTRY} FROM reading_list
    ${sql.where([lang !== undefined && sql`lang = ${lang}`, sql`status = ${status}`, after !== undefined && sql`(updated_at, document_id) < ${sql.tuple(after)}`])}
    ORDER BY updated_at DESC, document_id DESC LIMIT ${limit}`;
}
