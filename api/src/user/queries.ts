// Queries of the user Durable Object (src/worker/user.ts) that the tests check the plans of.

/** A reading_list row's columns, as a ReadingEntry. */
export const READING_ENTRY = `status, added_at AS "addedAt", updated_at AS "updatedAt"`;

/** A page of a status's reading list, latest change first: those before the page's key,
 * which reading_list_status, or with a language reading_list_lang, seeks to. Its
 * parameters: the language if there is one, the status, the page's key if there is one,
 * and how many rows. */
export function readingListQuery(inLang: boolean, after: boolean): string {
  return `SELECT document_id AS "documentId", ${READING_ENTRY} FROM reading_list
    WHERE ${inLang ? "lang = ? AND " : ""}status = ?${after ? " AND (updated_at, document_id) < (?, ?)" : ""}
    ORDER BY updated_at DESC, document_id DESC LIMIT ?`;
}
