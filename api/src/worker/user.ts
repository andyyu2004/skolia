import { DurableObject } from "cloudflare:workers";
import type { KnownLemma, LemmaId, LemmaStatus } from "@skolia/shared/api";
import { MIGRATIONS } from "../user/migrations/index.ts";
import {
  APPEND_LOG,
  LOG_SCHEMA,
  LogEntry,
  MigrationError,
  READ_LOG,
  applied,
  plan,
  problems,
  withChecksums,
  type Checksummed,
} from "../user/migrator.ts";
import { LEMMAS, SET_LEMMA, toKnownLemma } from "../user/queries.ts";

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
    return this.sql.exec(LEMMAS).toArray().map(toKnownLemma);
  }

  setLemma(lemmaId: LemmaId, status: LemmaStatus, updated: string): void {
    this.sql.exec(SET_LEMMA, lemmaId, status, updated);
  }

  async #migrate(target: number): Promise<void> {
    const migrations = await (checksummed ??= withChecksums(MIGRATIONS));
    const stack = applied(this.#log());
    const found = problems(stack, migrations);
    if (found.length > 0) throw new MigrationError(found.join("; "));
    for (const step of plan(stack.length, target, migrations)) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(step.sql);
        this.sql.exec(APPEND_LOG, step.version, step.name, step.direction, step.checksum, new Date().toISOString());
      });
    }
  }

  #log(): LogEntry[] {
    this.ctx.storage.transactionSync(() => {
      for (const statement of LOG_SCHEMA) this.sql.exec(statement);
    });
    return this.sql.exec(READ_LOG).toArray().map((row) => LogEntry.parse(row));
  }
}
