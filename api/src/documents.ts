// Document metadata in SQL, shared by SQLite (Node) and D1 (Workers). The tables are
// made by the files in api/migrations: wrangler applies them to D1, src/node/sqlite.ts
// to the local file.
import { LANGS, type Lang } from "@skolia/shared/api";
import type { DocumentRecord } from "./ports.ts";

export const LIST = "SELECT * FROM document ORDER BY imported DESC";
export const GET = "SELECT * FROM document WHERE id = ?";
export const ADD = "INSERT OR IGNORE INTO document VALUES (?, ?, ?, ?, ?)";

export function addParams(record: DocumentRecord): [string, string, string, string, number] {
  return [record.id, record.title, record.lang, record.imported, record.words];
}

export function toRecord(row: Record<string, unknown>): DocumentRecord {
  const { id, title, lang, imported, words } = row;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    !isLang(lang) ||
    typeof imported !== "string" ||
    typeof words !== "number"
  ) {
    throw new Error(`malformed document row: ${JSON.stringify(row)}`);
  }
  return { id, title, lang, imported, words };
}

function isLang(value: unknown): value is Lang {
  return LANGS.some((l) => l === value);
}
