import { DurableObject } from "cloudflare:workers";
import { LANGS, WORD_CARD_KINDS, MATURE_DAYS, timestamp, type CardCounts, type CardId as CardIdType, type ClozeList, type DocumentId, type NewCloze, type Timestamp, type Lang, type LemmaId, type ReviewRequest, type ScheduledCard, type Settings, type Word, type WordStatus } from "@skolia/shared/api";
import * as schemas from "@skolia/shared/schemas";
import { CardId } from "@skolia/shared/schemas";
import type { DueCards, ReviewOutcome, StoredPosition } from "../ports.ts";
import { fromJson, fsrs, newCard, review, toJson } from "./scheduler.ts";
import { MIGRATIONS } from "../user/migrations/index.ts";
import { LogEntry, MigrationError, applied, plan, problems, withChecksums, type Checksummed } from "../user/migrator.ts";

export interface MigrationStatus {
  version: number | null;
  log: LogEntry[];
  problems: string[];
}

let checksummed: Promise<Checksummed[]> | undefined;

/** A row of due()'s query: a card, with its cloze's columns if it's a cloze card. */
function scheduled(row: Record<string, SqlStorageValue>): ScheduledCard {
  const { id, lemmaId, kind, dueAt, documentId, sentence, sentenceStart, blankStart, blankEnd, feats, why } = row;
  const cloze = documentId === null ? null : { documentId, sentence, sentenceStart, blankStart, blankEnd, feats: JSON.parse(String(feats)), why };
  return schemas.ScheduledCard.parse({ id, lemmaId, kind, dueAt, isNew: row["isNew"] === 1, cloze });
}

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

  /** Active gives the word its cards, if it hasn't any; the cards, its cloze cards too, are
   * reviewed while their word is active (card.active, so the review queries need only card's indexes). */
  async setWord(lemmaId: LemmaId, status: WordStatus, now: Timestamp): Promise<void> {
    const s = await fsrs();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO word (lemma_id, status, updated) VALUES (?, ?, ?)
         ON CONFLICT (lemma_id) DO UPDATE SET status = excluded.status, updated = excluded.updated`,
        lemmaId,
        status,
        now,
      );
      const active = status === "active" ? 1 : 0;
      this.sql.exec(`UPDATE card SET active = ? WHERE lemma_id = ?`, active, lemmaId);
      if (!active) return;
      for (const kind of WORD_CARD_KINDS) {
        const id = CardId.parse(crypto.randomUUID());
        this.sql.exec(
          `INSERT INTO card (id, lemma_id, kind, created, active, fsrs) VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT (lemma_id, kind) WHERE kind != 'cloze' DO NOTHING`,
          id,
          lemmaId,
          kind,
          now,
          toJson(newCard(s, id, new Date(now))),
        );
      }
    });
  }

  /** A new cloze card for the word in the sentence, or the one it already has: the same
   * text, sentence and blank. Whether the card was made. It's reviewed while its word is
   * active or has no status, like the word's own cards (setWord). */
  async makeCloze(cloze: NewCloze, now: Timestamp): Promise<{ cardId: CardIdType; made: boolean }> {
    const s = await fsrs();
    return this.ctx.storage.transactionSync(() => {
      const had = this.sql
        .exec(`SELECT card_id FROM cloze WHERE document_id = ? AND sentence_start = ? AND blank_start = ?`, cloze.documentId, cloze.sentenceStart, cloze.blankStart)
        .toArray()[0];
      if (had !== undefined) return { cardId: CardId.parse(had["card_id"]), made: false };
      const id = CardId.parse(crypto.randomUUID());
      this.sql.exec(
        `INSERT INTO card (id, lemma_id, kind, created, active, fsrs)
         VALUES (?, ?, 'cloze', ?, coalesce((SELECT status = 'active' FROM word WHERE lemma_id = ?), 1), ?)`,
        id,
        cloze.lemmaId,
        now,
        cloze.lemmaId,
        toJson(newCard(s, id, new Date(now))),
      );
      this.sql.exec(
        `INSERT INTO cloze (card_id, document_id, sentence, sentence_start, blank_start, blank_end, feats, why)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        cloze.documentId,
        cloze.sentence,
        cloze.sentenceStart,
        cloze.blankStart,
        cloze.blankEnd,
        JSON.stringify(cloze.feats),
        cloze.why,
      );
      return { cardId: id, made: true };
    });
  }

  /** A text's cloze cards, by where their blanks start in it. */
  clozes(documentId: DocumentId): ClozeList {
    const rows = this.sql
      .exec(`SELECT card_id, sentence_start + blank_start AS start FROM cloze WHERE document_id = ? ORDER BY start`, documentId)
      .toArray();
    return { clozes: rows.map((row) => ({ cardId: CardId.parse(row["card_id"]), start: Number(row["start"]) })) };
  }

  /** Deletes a cloze card and its reviews; a word's cards can only be taken out of reviews
   * (setWord). Whether there was one. */
  deleteCloze(cardId: CardIdType): boolean {
    return this.ctx.storage.transactionSync(() => {
      if (this.sql.exec(`SELECT 1 FROM cloze WHERE card_id = ?`, cardId).toArray().length === 0) return false;
      this.sql.exec(`DELETE FROM review WHERE card_id = ?`, cardId);
      this.sql.exec(`DELETE FROM cloze WHERE card_id = ?`, cardId);
      this.sql.exec(`DELETE FROM card WHERE id = ?`, cardId);
      return true;
    });
  }

  /** New cards a language has left today: the daily limit is per language. A card counts
   * against the day the server first had an answer for it, from dayStart. */
  #newLeft(lang: Lang, dayStart: Timestamp): number {
    const { newPerDay } = this.settings();
    const introduced = this.sql
      .exec(`SELECT count(*) AS n FROM card WHERE lang = ? AND first_reviewed >= ?`, lang, dayStart)
      .one()["n"];
    return Math.max(0, newPerDay - Number(introduced));
  }

  /** A language's active cards due by now, soonest first, then its new cards in the order
   * their words were added, up to what's left of the day's allowance. */
  due(lang: Lang, now: Timestamp, dayStart: Timestamp, limit: number): DueCards {
    const newLeft = this.#newLeft(lang, dayStart);
    const select = `SELECT id, lemma_id AS "lemmaId", kind, schedule_status = 'new' AS "isNew", due_at AS "dueAt",
        cloze.document_id AS "documentId", sentence, sentence_start AS "sentenceStart", blank_start AS "blankStart",
        blank_end AS "blankEnd", feats, why
      FROM card LEFT JOIN cloze ON cloze.card_id = card.id`;
    const rows = [
      ...this.sql
        .exec(`${select} WHERE lang = ? AND active = 1 AND schedule_status != 'new' AND due_at <= ? ORDER BY due_at LIMIT ?`, lang, now, limit)
        .toArray(),
      ...this.sql
        .exec(
          `${select} WHERE lang = ? AND active = 1 AND schedule_status = 'new' ORDER BY created, lemma_id, kind DESC LIMIT ?`,
          lang,
          Math.min(newLeft, limit),
        )
        .toArray(),
    ];
    return { cards: rows.slice(0, limit).map(scheduled), newLeft };
  }

  /** Each language's cards due by now, and new cards it would show today. */
  counts(now: Timestamp, dayStart: Timestamp): CardCounts[] {
    return LANGS.map((lang) => {
      const due = this.sql
        .exec(`SELECT count(*) AS n FROM card WHERE lang = ? AND active = 1 AND schedule_status != 'new' AND due_at <= ?`, lang, now)
        .one()["n"];
      const fresh = this.sql
        .exec(`SELECT count(*) AS n FROM card WHERE lang = ? AND active = 1 AND schedule_status = 'new'`, lang)
        .one()["n"];
      return { lang, due: Number(due), new: Math.min(Number(fresh), this.#newLeft(lang, dayStart)) };
    });
  }

  /** Once per review id: a retry gets the card as it is. now: the server's time, which
   * dates a card's first review for the daily allowance, whatever the client says. */
  async review({ id, cardId, rating, at }: ReviewRequest, now: Timestamp): Promise<ReviewOutcome> {
    const s = await fsrs();
    return this.ctx.storage.transactionSync((): ReviewOutcome => {
      const row = this.sql.exec(`SELECT fsrs, created FROM card WHERE id = ?`, cardId).toArray()[0];
      if (row === undefined) return { kind: "no-card" };
      const card = fromJson(String(row["fsrs"]));
      const seen = this.sql.exec(`SELECT card_id FROM review WHERE id = ?`, id).toArray()[0];
      if (seen !== undefined) {
        return seen["card_id"] === cardId ? { kind: "reviewed", cardId, dueAt: timestamp(card.dueAt) } : { kind: "id-reused" };
      }
      const when = new Date(at);
      if (when < new Date(String(row["created"])) || (card.lastReviewAt !== null && when < card.lastReviewAt)) {
        return { kind: "out-of-order" };
      }
      const next = review(s, card, rating, when);
      this.sql.exec(`INSERT INTO review (id, card_id, rating, review_time) VALUES (?, ?, ?, ?)`, id, cardId, rating, when.toISOString());
      this.sql.exec(`UPDATE card SET fsrs = ?, first_reviewed = coalesce(first_reviewed, ?) WHERE id = ?`, toJson(next), now, cardId);
      return { kind: "reviewed", cardId, dueAt: timestamp(next.dueAt) };
    });
  }

  settings(): Settings {
    const row = this.sql.exec(`SELECT new_per_day AS "newPerDay" FROM settings WHERE id = 1`).one();
    return schemas.Settings.parse(row);
  }

  setSettings({ newPerDay }: Settings): void {
    this.sql.exec(`UPDATE settings SET new_per_day = ? WHERE id = 1`, newPerDay);
  }

  position(documentId: DocumentId): StoredPosition | null {
    const row = this.sql.exec(`SELECT sentence, token, at FROM reading_position WHERE document_id = ?`, documentId).toArray()[0];
    return row === undefined ? null : { sentence: Number(row["sentence"]), token: Number(row["token"]), at: schemas.Timestamp.parse(row["at"]) };
  }

  setPosition(documentId: DocumentId, { sentence, token, at }: StoredPosition): void {
    this.sql.exec(
      `INSERT INTO reading_position (document_id, sentence, token, at) VALUES (?, ?, ?, ?)
       ON CONFLICT (document_id) DO UPDATE SET sentence = excluded.sentence, token = excluded.token, at = excluded.at
       WHERE excluded.at > reading_position.at`,
      documentId,
      sentence,
      token,
      at,
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
