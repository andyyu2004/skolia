import { DurableObject } from "cloudflare:workers";
import { CARD_KINDS, MATURE_DAYS, type LemmaId, type ReviewRequest, type Settings, type Word, type WordStatus } from "@skolia/shared/api";
import * as schemas from "@skolia/shared/schemas";
import type { DueCards, ReviewOutcome } from "../ports.ts";
import { fromJson, fsrs, newCard, review, toJson } from "./scheduler.ts";
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

  words(): Word[] {
    return this.sql
      .exec(
        `SELECT word.lemma_id AS "lemmaId", word.status, word.updated,
           coalesce(card.scheduled_days >= ${MATURE_DAYS}, 0) AS mature
         FROM word LEFT JOIN card ON card.lemma_id = word.lemma_id AND card.kind = 'recognition'
         ORDER BY word.lemma_id`,
      )
      .toArray()
      .map((row) => schemas.Word.parse({ ...row, mature: row["mature"] === 1 }));
  }

  /** Active gives the word its cards, if it hasn't any. */
  async setWord(lemmaId: LemmaId, status: WordStatus, now: string): Promise<void> {
    const s = await fsrs();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO word (lemma_id, status, updated) VALUES (?, ?, ?)
         ON CONFLICT (lemma_id) DO UPDATE SET status = excluded.status, updated = excluded.updated`,
        lemmaId,
        status,
        now,
      );
      if (status !== "active") return;
      for (const kind of CARD_KINDS) {
        const id = crypto.randomUUID();
        this.sql.exec(
          `INSERT INTO card (id, lemma_id, kind, created, fsrs) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (lemma_id, kind) DO NOTHING`,
          id,
          lemmaId,
          kind,
          now,
          toJson(newCard(s, id, new Date(now))),
        );
      }
    });
  }

  /** Active words' cards due by now, soonest first, then new cards in the order their
   * words were added, up to what's left of the day's allowance. A card is counted
   * against the day it was first answered on, from dayStart. */
  due(now: string, dayStart: string, limit: number): DueCards {
    const { newPerDay } = this.settings();
    const introduced = this.sql
      .exec(
        `SELECT count(*) AS n FROM (SELECT min(review_time) AS first FROM review GROUP BY card_id) WHERE first >= ?`,
        dayStart,
      )
      .one()["n"];
    const newLeft = Math.max(0, newPerDay - Number(introduced));
    const select = `SELECT card.id, card.lemma_id AS "lemmaId", card.kind, card.schedule_status = 'new' AS "isNew", card.due_at AS "dueAt"
      FROM card JOIN word ON word.lemma_id = card.lemma_id AND word.status = 'active'`;
    const rows = [
      ...this.sql.exec(`${select} WHERE card.schedule_status != 'new' AND card.due_at <= ? ORDER BY card.due_at LIMIT ?`, now, limit).toArray(),
      ...this.sql.exec(`${select} WHERE card.schedule_status = 'new' ORDER BY card.created, card.lemma_id, card.kind DESC LIMIT ?`, newLeft).toArray(),
    ];
    return { cards: rows.slice(0, limit).map((row) => schemas.ScheduledCard.parse({ ...row, isNew: row["isNew"] === 1 })), newLeft };
  }

  /** Once per review id: a retry gets the card as it is. */
  async review({ id, cardId, rating, at }: ReviewRequest): Promise<ReviewOutcome> {
    const s = await fsrs();
    return this.ctx.storage.transactionSync((): ReviewOutcome => {
      const row = this.sql.exec(`SELECT fsrs FROM card WHERE id = ?`, cardId).toArray()[0];
      if (row === undefined) return { kind: "no-card" };
      const card = fromJson(String(row["fsrs"]));
      const seen = this.sql.exec(`SELECT 1 FROM review WHERE id = ?`, id).toArray().length > 0;
      if (seen) return { kind: "reviewed", cardId, dueAt: card.dueAt.toISOString() };
      const when = new Date(at);
      if (card.lastReviewAt !== null && when < card.lastReviewAt) return { kind: "out-of-order" };
      const next = review(s, card, rating, when);
      this.sql.exec(`INSERT INTO review (id, card_id, rating, review_time) VALUES (?, ?, ?, ?)`, id, cardId, rating, when.toISOString());
      this.sql.exec(`UPDATE card SET fsrs = ? WHERE id = ?`, toJson(next), cardId);
      return { kind: "reviewed", cardId, dueAt: next.dueAt.toISOString() };
    });
  }

  settings(): Settings {
    const row = this.sql.exec(`SELECT new_per_day AS "newPerDay" FROM settings WHERE id = 1`).one();
    return schemas.Settings.parse(row);
  }

  setSettings({ newPerDay }: Settings): void {
    this.sql.exec(`UPDATE settings SET new_per_day = ? WHERE id = 1`, newPerDay);
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
