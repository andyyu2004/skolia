import { DurableObject } from "cloudflare:workers";
import type { KnownLemma, LemmaId, LemmaStatus } from "@skolia/shared/api";
import * as schemas from "@skolia/shared/schemas";
import { MIGRATIONS } from "../user/migrations/index.ts";
import { LogEntry, MigrationError, applied, plan, problems, withChecksums, type Checksummed } from "../user/migrator.ts";

export interface MigrationStatus {
  version: number | null;
  log: LogEntry[];
  problems: string[];
}

let checksummed: Promise<Checksummed[]> | undefined;

export class User extends DurableObject<object> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    void ctx.blockConcurrencyWhile(() => this.#migrate(MIGRATIONS.length));
  }

  migrate(version: number): Promise<void> {
    return this.ctx.blockConcurrencyWhile(() => this.#migrate(version));
  }

  async migrationStatus(): Promise<MigrationStatus> {
    const migrations = await (checksummed ??= withChecksums(MIGRATIONS));
    const log = this.#log();
    try {
      const stack = applied(log);
      return { version: stack.length, log, problems: problems(stack, migrations) };
    } catch (error) {
      if (!(error instanceof MigrationError)) throw error;
      return { version: null, log, problems: [error.message] };
    }
  }

  lemmas(): KnownLemma[] {
    return this.sql
      .exec(`SELECT lemma_id AS "lemmaId", status, updated FROM known_lemma`)
      .toArray()
      .map((row) => schemas.KnownLemma.parse(row));
  }

  setLemma(lemmaId: LemmaId, status: LemmaStatus, updated: string): void {
    this.sql.exec(
      `INSERT INTO known_lemma (lemma_id, status, updated) VALUES (?, ?, ?)
       ON CONFLICT (lemma_id) DO UPDATE SET status = excluded.status, updated = excluded.updated`,
      lemmaId,
      status,
      updated,
    );
  }

  async #migrate(target: number): Promise<void> {
    const migrations = await (checksummed ??= withChecksums(MIGRATIONS));
    const stack = applied(this.#log());
    const found = problems(stack, migrations);
    if (found.length > 0) throw new MigrationError(found.join("; "));
    for (const step of plan(stack.length, target, migrations)) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(step.sql);
        this.sql.exec(
          "INSERT INTO migration_log (version, name, direction, checksum, applied_at) VALUES (?, ?, ?, ?, ?)",
          step.version,
          step.name,
          step.direction,
          step.checksum,
          new Date().toISOString(),
        );
      });
    }
  }

  #log(): LogEntry[] {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS migration_log (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          version INTEGER NOT NULL CHECK (version > 0),
          name TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL CHECK (applied_at IS strftime('%Y-%m-%dT%H:%M:%fZ', applied_at))
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS migration_log_no_update BEFORE UPDATE ON migration_log
          BEGIN SELECT RAISE(ABORT, 'migration_log is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS migration_log_no_delete BEFORE DELETE ON migration_log
          BEGIN SELECT RAISE(ABORT, 'migration_log is append-only'); END;
      `);
    });
    return this.sql
      .exec(`SELECT seq, version, name, direction, checksum, applied_at AS "appliedAt" FROM migration_log ORDER BY seq`)
      .toArray()
      .map((row) => LogEntry.parse(row));
  }
}
