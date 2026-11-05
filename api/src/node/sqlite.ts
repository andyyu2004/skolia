// Document metadata in a local SQLite file, with the same SQL and migrations as D1.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ADD, COUNT_SINCE, GET, LIST, addParams, toCount, toRecord } from "../documents.ts";
import type { DocumentRecord, DocumentStore } from "../ports.ts";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

export class SqliteDocuments implements DocumentStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    migrate(this.db);
  }

  async list(): Promise<DocumentRecord[]> {
    return this.db.prepare(LIST).all().map(toRecord);
  }

  async get(id: string): Promise<DocumentRecord | null> {
    const row = this.db.prepare(GET).get(id);
    return row ? toRecord(row) : null;
  }

  async add(record: DocumentRecord): Promise<void> {
    this.db.prepare(ADD).run(...addParams(record));
  }

  async countImportedSince(since: string): Promise<number> {
    return toCount(this.db.prepare(COUNT_SINCE).get(since));
  }
}

/** Apply the migrations the file hasn't had yet, counted in user_version (wrangler
 * keeps its own table for D1). Files are applied in name order: 0001_..., 0002_... */
export function migrate(db: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const row = db.prepare("PRAGMA user_version").get();
  const applied = typeof row?.["user_version"] === "number" ? row["user_version"] : 0;
  if (applied === 0 && isPreMigrations(db)) {
    // Made before migrations existed, by the same CREATE TABLE as 0001
    db.exec("PRAGMA user_version = 1");
    return migrate(db);
  }
  for (const [index, file] of files.entries()) {
    if (index < applied) continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
      db.exec(`PRAGMA user_version = ${index + 1}`);
      db.exec("COMMIT");
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function isPreMigrations(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'document'").get();
  return row !== undefined;
}
