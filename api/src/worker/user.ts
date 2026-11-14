import { DurableObject } from "cloudflare:workers";
import {
  CARD_GROUPS,
  LANGS,
  WORD_CARD_KINDS,
  MATURE_DAYS,
  timestamp,
  type CardCounts,
  type CardGroup,
  type NewLeft,
  type Tally,
  type CardId as CardIdType,
  type ClozeKey,
  type ClozeStart,
  type DocumentId,
  type Paginated,
  type ReadingEntry,
  type ReadingFilter,
  type ReadingKey,
  type ReadingStatus,
  type WordKey,
  type NewCloze,
  type Timestamp,
  type Lang,
  type LemmaId,
  type ReviewRequest,
  type ScheduledCard,
  type Settings,
  type Word,
  type WordStatus,
} from "@skolia/shared/api";
import { paginate, type PageRequest } from "@skolia/shared/page";
import * as schemas from "@skolia/shared/schemas";
import { CardId } from "@skolia/shared/schemas";
import {
  and,
  col,
  compile,
  desc,
  eq,
  exists,
  fn,
  inQuery,
  insertInto,
  isNotNull,
  le,
  lit,
  ne,
  not,
  or,
  select,
  type Query,
} from "@skolia/util/query";
import { sql, type Sql } from "@skolia/util/sql";
import type { DueCards, ReviewOutcome, StoredPosition, StoredReading } from "../ports.ts";
import { fromJson, fsrs, newCard, review, toJson } from "./scheduler.ts";
import { MIGRATIONS } from "../user/migrations/index.ts";
import { READING_ENTRY, readingListQuery } from "../user/queries.ts";
import {
  LogEntry,
  MigrationError,
  applied,
  plan,
  problems,
  revertEdited,
  withChecksums,
  type Checksummed,
  type Step,
} from "../user/migrator.ts";

export interface MigrationStatus {
  version: number | null;
  log: LogEntry[];
  problems: string[];
}

let checksummed: Promise<Checksummed[]> | undefined;

/** A row of due()'s query: a card, with its cloze's columns if it's a cloze card. */
function scheduled(row: Record<string, SqlStorageValue>): ScheduledCard {
  const { id, lemmaId, kind, dueAt, documentId, sentence, sentenceStart, blankStart, blankEnd, feats, why } = row;
  const cloze =
    documentId === null ? null : { documentId, sentence, sentenceStart, blankStart, blankEnd, feats: JSON.parse(String(feats)), why };
  return schemas.ScheduledCard.parse({ id, lemmaId, kind, dueAt, isNew: row["isNew"] === 1, cloze });
}

/** A group's cards, as a condition on card. */
const IN_GROUP: Readonly<Record<CardGroup, Sql>> = { words: ne("card.kind", lit("cloze")), forms: eq("card.kind", lit("cloze")) };

/** A language's active cards due by now. */
const due = (lang: Lang, now: Timestamp) =>
  and(eq("card.lang", lang), eq("card.active", lit(1)), ne("card.schedule_status", lit("new")), le("card.due_at", now));

/** Whether the lemma of the card under alias has been started: one of its word cards reviewed. */
const started = (alias: "card" | "u") =>
  exists(
    select({})
      .from("card", "w")
      .where(eq("w.lemma_id", col(`${alias}.lemma_id`)), ne("w.kind", lit("cloze")), isNotNull("w.first_reviewed_at")),
  );

/** The card under alias is a language's new card. */
const isNew = (alias: "card" | "u", lang: Lang) =>
  and(eq(`${alias}.lang`, lang), eq(`${alias}.active`, lit(1)), eq(`${alias}.schedule_status`, lit("new")));

/** A group's new cards that today's allowance leaves to show, as a condition on card, and
 * at most how many. Words: every new word card of a started lemma, and all those of the
 * first lemmas not yet started, as many as are left, in the order their cards were made.
 * Forms: cloze cards whose lemmas are started, as many as are left. count: how to count
 * them in the allowance's terms, words by lemma and forms by card. */
function freshCards(group: CardGroup, lang: Lang, newLeft: NewLeft): { where: Sql; cap: number; count: Sql } {
  switch (group) {
    case "words": {
      const firstLemmas = select({ lemma_id: "u.lemma_id" })
        .from("card", "u")
        .where(isNew("u", lang), ne("u.kind", lit("cloze")), not(started("u")))
        .groupBy("u.lemma_id")
        .orderBy(fn.min("u.created_at"), "u.lemma_id")
        .limit(newLeft.words);
      return {
        where: and(isNew("card", lang), ne("card.kind", lit("cloze")), or(started("card"), inQuery("card.lemma_id", firstLemmas))),
        cap: Number.POSITIVE_INFINITY,
        count: fn.countDistinct("card.lemma_id"),
      };
    }
    case "forms":
      return { where: and(isNew("card", lang), eq("card.kind", lit("cloze")), started("card")), cap: newLeft.forms, count: fn.count() };
  }
}

/** A card, with its cloze's columns if it's a cloze card, for scheduled(). */
const SCHEDULED = select({
  id: "card.id",
  lemmaId: "card.lemma_id",
  kind: "card.kind",
  isNew: eq("card.schedule_status", lit("new")),
  dueAt: "card.due_at",
  documentId: "cloze.document_id",
  sentence: "cloze.sentence",
  sentenceStart: "cloze.sentence_start",
  blankStart: "cloze.blank_start",
  blankEnd: "cloze.blank_end",
  feats: "cloze.feats",
  why: "cloze.why",
})
  .from("card")
  .leftJoin("cloze", eq("cloze.card_id", col("card.id")));

export interface UserEnv {
  /** "true" on previews and locally. For this object's migrations (user/migrations) only, not D1's: an edited
   * last migration is reverted with the down it was applied with, and applied again. */
  MUTABLE_FINAL_USER_MIGRATION?: string;
}

export class User extends DurableObject<UserEnv> {
  constructor(ctx: DurableObjectState, env: UserEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => this.#migrate(MIGRATIONS.length));
  }

  #exec(query: Query | Sql): SqlStorageCursor<Record<string, SqlStorageValue>> {
    const { text, params } = compile(query);
    return this.ctx.storage.sql.exec(text, ...params);
  }

  migrate(version: number): Promise<void> {
    return this.ctx.blockConcurrencyWhile(() => this.#migrate(version));
  }

  async migrationStatus(): Promise<MigrationStatus> {
    const migrations = await (checksummed ??= withChecksums(MIGRATIONS));
    const log = this.#log();
    try {
      const stack = applied(log);
      const { kept } = await this.#revertEdited(stack, migrations);
      return { version: stack.length, log, problems: problems(kept, migrations) };
    } catch (error) {
      if (!(error instanceof MigrationError)) throw error;
      return { version: null, log, problems: [error.message] };
    }
  }

  /** A page of the words, by lemma id: those after the page's key, which word's primary key seeks to. */
  words({ after, limit }: PageRequest<WordKey>): Paginated<Word, WordKey> {
    const rows = this.#exec(
      sql`SELECT word.lemma_id AS "lemmaId", word.status, word.updated_at AS "updatedAt",
           coalesce(card.scheduled_days >= ${MATURE_DAYS}, 0) AS mature
         FROM word LEFT JOIN card ON card.lemma_id = word.lemma_id AND card.kind = 'recognition'
         WHERE word.lemma_id > ${after?.[0] ?? ""}
         ORDER BY word.lemma_id LIMIT ${limit + 1}`,
    )
      .toArray()
      .map((row) => schemas.Word.parse({ ...row, mature: row["mature"] === 1 }));
    return paginate(
      rows.map((item) => ({ item, key: [item.lemmaId] as const })),
      limit,
    );
  }

  /** Active gives the word its cards, if it hasn't any; the cards, its cloze cards too, are
   * reviewed while their word is active (card.active, so the review queries need only card's indexes). */
  async setWord(lemmaId: LemmaId, status: WordStatus, now: Timestamp): Promise<void> {
    const s = await fsrs();
    this.ctx.storage.transactionSync(() => {
      this.#exec(
        sql`INSERT INTO word (lemma_id, status, updated_at) VALUES (${lemmaId}, ${status}, ${now})
         ON CONFLICT (lemma_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      );
      const active = status === "active" ? 1 : 0;
      this.#exec(sql`UPDATE card SET active = ${active} WHERE lemma_id = ${lemmaId}`);
      if (!active) return;
      for (const kind of WORD_CARD_KINDS) {
        const id = CardId.parse(crypto.randomUUID());
        this.#exec(
          sql`INSERT INTO card (id, lemma_id, kind, created_at, active, fsrs) VALUES (${id}, ${lemmaId}, ${kind}, ${now}, 1, ${toJson(newCard(s, id, new Date(now)))})
           ON CONFLICT (lemma_id, kind) WHERE kind != 'cloze' DO NOTHING`,
        );
      }
    });
  }

  /** Clears the word's status and takes its cards, cloze cards too, out of reviews. Deletes
   * no card or review: setWord active brings them back. */
  clearWordStatus(lemmaId: LemmaId): void {
    this.ctx.storage.transactionSync(() => {
      this.#exec(sql`DELETE FROM word WHERE lemma_id = ${lemmaId}`);
      this.#exec(sql`UPDATE card SET active = 0 WHERE lemma_id = ${lemmaId}`);
    });
  }

  /** A new cloze card for the word in the sentence, or the one it already has: the same
   * text, sentence and blank. Whether the card was made. It's reviewed while its word is
   * active or has no status, like the word's own cards (setWord). */
  async makeCloze(cloze: NewCloze, now: Timestamp): Promise<{ cardId: CardIdType; made: boolean }> {
    const s = await fsrs();
    return this.ctx.storage.transactionSync(() => {
      const had = this.#exec(
        sql`SELECT card_id FROM cloze WHERE document_id = ${cloze.documentId} AND blank_start = ${cloze.blankStart}`,
      ).toArray()[0];
      if (had !== undefined) return { cardId: CardId.parse(had["card_id"]), made: false };
      const id = CardId.parse(crypto.randomUUID());
      this.#exec(
        sql`INSERT INTO card (id, lemma_id, kind, created_at, active, fsrs)
         VALUES (${id}, ${cloze.lemmaId}, 'cloze', ${now}, coalesce((SELECT status = 'active' FROM word WHERE lemma_id = ${cloze.lemmaId}), 1), ${toJson(newCard(s, id, new Date(now)))})`,
      );
      this.#exec(
        sql`INSERT INTO cloze (card_id, document_id, sentence, sentence_start, blank_start, blank_end, feats, why)
         VALUES ${sql.tuple([id, cloze.documentId, cloze.sentence, cloze.sentenceStart, cloze.blankStart, cloze.blankEnd, JSON.stringify(cloze.feats), cloze.why])}`,
      );
      return { cardId: id, made: true };
    });
  }

  /** A page of a text's cloze cards, by where their blanks start in it: those after the
   * page's key, which cloze's (document_id, blank_start) index seeks to. */
  clozes(documentId: DocumentId, { after, limit }: PageRequest<ClozeKey>): Paginated<ClozeStart, ClozeKey> {
    const rows = this.#exec(
      sql`SELECT card_id, blank_start FROM cloze WHERE document_id = ${documentId} AND blank_start > ${after?.[0] ?? -1} ORDER BY blank_start LIMIT ${limit + 1}`,
    )
      .toArray()
      .map((row): ClozeStart => ({ cardId: CardId.parse(row["card_id"]), start: Number(row["blank_start"]) }));
    return paginate(
      rows.map((item) => ({ item, key: [item.start] as const })),
      limit,
    );
  }

  /** Deletes a cloze card, and by the foreign keys its cloze row and reviews; a word's
   * cards can only be taken out of reviews (setWord). Whether there was one. */
  deleteCloze(cardId: CardIdType): boolean {
    return this.#exec(sql`DELETE FROM card WHERE id = ${cardId} AND kind = 'cloze'`).rowsWritten > 0;
  }

  /** What a language has left of today's allowances: the daily limits are per language.
   * A lemma counts against the day the server first had an answer for one of its word
   * cards, a cloze card against the day it first had one for it, from dayStart. */
  #newLeft(lang: Lang, dayStart: Timestamp): NewLeft {
    const { newLemmasPerDay, newFormsPerDay } = this.settings();
    const lemmas = this.#exec(
      sql`SELECT count(DISTINCT lemma_id) AS n FROM card AS c
         WHERE lang = ${lang} AND first_reviewed_at >= ${dayStart} AND kind != 'cloze'
           AND NOT EXISTS (SELECT 1 FROM card AS e WHERE e.lemma_id = c.lemma_id AND e.kind != 'cloze' AND e.first_reviewed_at < ${dayStart})`,
    ).one()["n"];
    const forms = this.#exec(
      sql`SELECT count(*) AS n FROM card WHERE lang = ${lang} AND first_reviewed_at >= ${dayStart} AND kind = 'cloze'`,
    ).one()["n"];
    return { words: Math.max(0, newLemmasPerDay - Number(lemmas)), forms: Math.max(0, newFormsPerDay - Number(forms)) };
  }

  /** A language's active cards due by now, soonest first, then its new cards up to what's
   * left of the day's allowances: words' in the order their words were added, then forms'
   * in the order they were made. group: only its cards. */
  due(lang: Lang, now: Timestamp, dayStart: Timestamp, limit: number, group: CardGroup | undefined): DueCards {
    const newLeft = this.#newLeft(lang, dayStart);
    const groups = group === undefined ? CARD_GROUPS : [group];
    const dueNow = this.#exec(
      SCHEDULED.where(due(lang, now), group !== undefined && IN_GROUP[group])
        .orderBy("card.due_at")
        .limit(limit),
    ).toArray();
    const fresh = groups.flatMap((g) => {
      const { where, cap } = freshCards(g, lang, newLeft);
      return this.#exec(
        SCHEDULED.where(where).orderBy("card.created_at", "card.lemma_id", desc("card.kind")).limit(Math.min(cap, limit)),
      ).toArray();
    });
    return { cards: [...dueNow, ...fresh].slice(0, limit).map(scheduled), newLeft };
  }

  /** Each language's cards due by now, and what new it would show today, by group: words'
   * lemmas, as their allowance counts them, and forms' cards. */
  counts(now: Timestamp, dayStart: Timestamp): CardCounts[] {
    return LANGS.map((lang) => {
      const newLeft = this.#newLeft(lang, dayStart);
      const tally = (group: CardGroup): Tally => {
        const dueNow = this.#exec(select({ n: fn.count() }).from("card").where(due(lang, now), IN_GROUP[group])).one()["n"];
        const { where, cap, count } = freshCards(group, lang, newLeft);
        const fresh = this.#exec(select({ n: count }).from("card").where(where)).one()["n"];
        return { due: Number(dueNow), new: Math.min(Number(fresh), cap) };
      };
      return { lang, words: tally("words"), forms: tally("forms") };
    });
  }

  /** Once per review id: a retry gets the card as it is. now: the server's time, which
   * dates a card's first review for the daily allowance, whatever the client says. */
  async review({ id, cardId, rating, at }: ReviewRequest, now: Timestamp): Promise<ReviewOutcome> {
    const s = await fsrs();
    return this.ctx.storage.transactionSync((): ReviewOutcome => {
      const row = this.#exec(sql`SELECT fsrs, created_at FROM card WHERE id = ${cardId}`).toArray()[0];
      if (row === undefined) return { kind: "no-card" };
      const card = fromJson(String(row["fsrs"]));
      const seen = this.#exec(sql`SELECT card_id FROM review WHERE id = ${id}`).toArray()[0];
      if (seen !== undefined) {
        return seen["card_id"] === cardId ? { kind: "reviewed", cardId, dueAt: timestamp(card.dueAt) } : { kind: "id-reused" };
      }
      const when = new Date(at);
      if (when < new Date(String(row["created_at"])) || (card.lastReviewAt !== null && when < card.lastReviewAt)) {
        return { kind: "out-of-order" };
      }
      const next = review(s, card, rating, when);
      this.#exec(sql`INSERT INTO review (id, card_id, rating, reviewed_at) VALUES ${sql.tuple([id, cardId, rating, when.toISOString()])}`);
      this.#exec(sql`UPDATE card SET fsrs = ${toJson(next)}, first_reviewed_at = coalesce(first_reviewed_at, ${now}) WHERE id = ${cardId}`);
      return { kind: "reviewed", cardId, dueAt: timestamp(next.dueAt) };
    });
  }

  settings(): Settings {
    const row = this.#exec(
      sql`SELECT new_lemmas_per_day AS "newLemmasPerDay", new_forms_per_day AS "newFormsPerDay", forms_with_words AS "formsWithWords"
         FROM settings WHERE id = 1`,
    ).one();
    return schemas.Settings.parse({ ...row, formsWithWords: row["formsWithWords"] === 1 });
  }

  setSettings({ newLemmasPerDay, newFormsPerDay, formsWithWords }: Settings): void {
    this.#exec(
      sql`UPDATE settings SET new_lemmas_per_day = ${newLemmasPerDay}, new_forms_per_day = ${newFormsPerDay}, forms_with_words = ${formsWithWords ? 1 : 0} WHERE id = 1`,
    );
  }

  position(documentId: DocumentId): StoredPosition | null {
    const row = this.#exec(sql`SELECT sentence, token, at FROM reading_position WHERE document_id = ${documentId}`).toArray()[0];
    return row === undefined
      ? null
      : { sentence: Number(row["sentence"]), token: Number(row["token"]), at: schemas.Timestamp.parse(row["at"]) };
  }

  setPosition(documentId: DocumentId, { sentence, token, at }: StoredPosition): void {
    this.#exec(
      sql`INSERT INTO reading_position (document_id, sentence, token, at) VALUES ${sql.tuple([documentId, sentence, token, at])}
       ON CONFLICT (document_id) DO UPDATE SET sentence = excluded.sentence, token = excluded.token, at = excluded.at
       WHERE excluded.at > reading_position.at`,
    );
  }

  reading(documentId: DocumentId): ReadingEntry | null {
    const row = this.#exec(select(READING_ENTRY).from("reading_list").where(eq("document_id", documentId))).toArray()[0];
    return row === undefined ? null : schemas.ReadingEntry.parse(row);
  }

  setReading(documentId: DocumentId, lang: Lang, status: ReadingStatus, now: Timestamp): ReadingEntry {
    const row = this.#exec(
      insertInto("reading_list")
        .values({ document_id: documentId, lang, status, added_at: now, updated_at: now })
        .onConflict(["document_id"], {
          set: {
            status: col("excluded.status"),
            updated_at: fn.iif(eq("excluded.status", col("reading_list.status")), "reading_list.updated_at", "excluded.updated_at"),
          },
        })
        .returning(READING_ENTRY),
    ).one();
    return schemas.ReadingEntry.parse(row);
  }

  removeReading(documentId: DocumentId): void {
    this.#exec(sql`DELETE FROM reading_list WHERE document_id = ${documentId}`);
  }

  readingList(filter: ReadingFilter, page: PageRequest<ReadingKey>): Paginated<StoredReading, ReadingKey> {
    const rows = this.#exec(readingListQuery(filter, page))
      .toArray()
      .map((row): StoredReading => ({ documentId: schemas.DocumentId.parse(row["documentId"]), ...schemas.ReadingEntry.parse(row) }));
    return paginate(
      rows.map((item) => ({ item, key: [item.updatedAt, item.documentId] as const })),
      page.limit,
    );
  }

  async #migrate(target: number): Promise<void> {
    const migrations = await (checksummed ??= withChecksums(MIGRATIONS));
    const { kept, revert } = await this.#revertEdited(applied(this.#log()), migrations);
    const found = problems(kept, migrations);
    if (found.length > 0) throw new MigrationError(found.join("; "));
    for (const step of [...revert, ...plan(kept.length, target, migrations)]) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(step.sql);
        this.#exec(
          sql`INSERT INTO migration_log (version, name, direction, checksum, down, applied_at)
            VALUES ${sql.tuple([step.version, step.name, step.direction, step.checksum, step.down, new Date().toISOString()])}`,
        );
      });
    }
  }

  /** The applied migrations that stay, and the step that reverts an edited last one where that's allowed */
  async #revertEdited(stack: LogEntry[], migrations: readonly Checksummed[]): Promise<{ kept: LogEntry[]; revert: Step[] }> {
    const step = this.env.MUTABLE_FINAL_USER_MIGRATION === "true" ? await revertEdited(stack, migrations) : null;
    return step === null ? { kept: stack, revert: [] } : { kept: stack.slice(0, -1), revert: [step] };
  }

  #log(): LogEntry[] {
    this.ctx.storage.transactionSync(() => {
      this.#exec(sql`
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
      if (this.#exec(sql`SELECT 1 FROM pragma_table_info('migration_log') WHERE name = 'down'`).toArray().length === 0) {
        this.#exec(sql`ALTER TABLE migration_log ADD COLUMN down TEXT CHECK (direction = 'up' OR down IS NULL)`);
      }
    });
    return this.#exec(sql`SELECT seq, version, name, direction, checksum, down, applied_at AS "appliedAt" FROM migration_log ORDER BY seq`)
      .toArray()
      .map((row) => LogEntry.parse(row));
  }
}
