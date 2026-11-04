// Document metadata in a local SQLite file (D1 is SQLite too, so the SQL carries over).
import { DatabaseSync } from "node:sqlite";
import { LANGS, type Lang } from "@skolia/shared/api";
import type { DocumentRecord, DocumentStore } from "../ports.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  lang TEXT NOT NULL,
  imported TEXT NOT NULL,
  words INTEGER NOT NULL
)`;

export class SqliteDocuments implements DocumentStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  async list(): Promise<DocumentRecord[]> {
    const rows = this.db.prepare("SELECT * FROM document ORDER BY imported DESC").all();
    return rows.map(toRecord);
  }

  async get(id: string): Promise<DocumentRecord | null> {
    const row = this.db.prepare("SELECT * FROM document WHERE id = ?").get(id);
    return row ? toRecord(row) : null;
  }

  async add(record: DocumentRecord): Promise<void> {
    this.db
      .prepare("INSERT OR IGNORE INTO document VALUES (?, ?, ?, ?, ?)")
      .run(record.id, record.title, record.lang, record.imported, record.words);
  }
}

function toRecord(row: Record<string, unknown>): DocumentRecord {
  const { id, title, lang, imported, words } = row;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    !LANGS.some((l) => l === lang) ||
    typeof imported !== "string" ||
    typeof words !== "number"
  ) {
    throw new Error(`malformed document row: ${JSON.stringify(row)}`);
  }
  return { id, title, lang: lang as Lang, imported, words };
}
