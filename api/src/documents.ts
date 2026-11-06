// Document metadata in D1 (src/worker/adapters.ts). The tables are made by the files in
// api/migrations, which wrangler applies.
import * as z from "zod";
import { DocumentRow } from "@skolia/shared/schemas";
import type { DocumentRecord } from "./ports.ts";

export const LIST = "SELECT * FROM document ORDER BY imported DESC";
export const GET = "SELECT * FROM document WHERE id = ?";
export const ADD = "INSERT OR IGNORE INTO document VALUES (?, ?, ?, ?, ?)";
// ISO 8601 UTC strings sort in time order
export const COUNT_SINCE = "SELECT COUNT(*) AS n FROM document WHERE imported >= ?";

const CountRow = z.object({ n: z.number() });

export function toCount(row: unknown): number {
  return CountRow.parse(row).n;
}

export function addParams(record: DocumentRecord): [string, string, string, string, number] {
  return [record.id, record.title, record.lang, record.imported, record.words];
}

export function toRecord(row: unknown): DocumentRecord {
  return DocumentRow.parse(row);
}
