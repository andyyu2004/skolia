// The ports on Cloudflare: D1 for document metadata and the lexicon, R2 for blobs, Queues
// for jobs, a Durable Object per user for their own data.
import * as z from "zod";
import {
  LANGS,
  UPOS,
  type CardCounts,
  type CardId,
  type ClozeList,
  type NewCloze,
  type DocumentId,
  type FeatureSets,
  type Lang,
  type LemmaId,
  type LexiconEntry,
  langOf,
  type Lookup,
  type Timestamp,
  type UserId,
  type ReviewRequest, type Settings, type AvailableTag, type TagFilter, type Tags, type Word, type WordStatus } from "@skolia/shared/api";
import type { BundleParadigm, IngestJob, Pronunciation, Relation, Sense } from "@skolia/shared/schema";
import { AvailableTag as AvailableTagSchema, DocumentRow, LemmaId as LemmaIdSchema } from "@skolia/shared/schemas";
import { sql, type Sql } from "@skolia/util/sql";
import type {
  BlobStore,
  DocumentContent,
  DocumentEntry,
  DocumentStore,
  DueCards,
  EntryFields,
  IngestJobs,
  JobQueue,
  Lexicon,
  ReviewOutcome,
  StoredBlob,
  StoredDocument,
  StoredPosition,
  UserData,
} from "../ports.ts";
import { log } from "../log.ts";
import type { User } from "./user.ts";

const logger = log("adapters");

export class DurableObjectUsers implements UserData {
  private readonly users: DurableObjectNamespace<User>;

  constructor(users: DurableObjectNamespace<User>) {
    this.users = users;
  }

  async words(userId: UserId): Promise<Word[]> {
    return this.users.getByName(userId).words();
  }

  async setWord(userId: UserId, lemmaId: LemmaId, status: WordStatus, now: Timestamp): Promise<void> {
    await this.users.getByName(userId).setWord(lemmaId, status, now);
  }

  async due(userId: UserId, lang: Lang, now: Timestamp, dayStart: Timestamp, limit: number): Promise<DueCards> {
    return this.users.getByName(userId).due(lang, now, dayStart, limit);
  }

  async counts(userId: UserId, now: Timestamp, dayStart: Timestamp): Promise<CardCounts[]> {
    return this.users.getByName(userId).counts(now, dayStart);
  }

  async review(userId: UserId, request: ReviewRequest, now: Timestamp): Promise<ReviewOutcome> {
    return this.users.getByName(userId).review(request, now);
  }

  async makeCloze(userId: UserId, cloze: NewCloze, now: Timestamp): Promise<{ cardId: CardId; made: boolean }> {
    return this.users.getByName(userId).makeCloze(cloze, now);
  }

  async clozes(userId: UserId, documentId: DocumentId): Promise<ClozeList> {
    return this.users.getByName(userId).clozes(documentId);
  }

  async deleteCloze(userId: UserId, cardId: CardId): Promise<boolean> {
    return this.users.getByName(userId).deleteCloze(cardId);
  }

  async settings(userId: UserId): Promise<Settings> {
    return this.users.getByName(userId).settings();
  }

  async setSettings(userId: UserId, settings: Settings): Promise<void> {
    await this.users.getByName(userId).setSettings(settings);
  }

  async position(userId: UserId, documentId: DocumentId): Promise<StoredPosition | null> {
    return this.users.getByName(userId).position(documentId);
  }

  async setPosition(userId: UserId, documentId: DocumentId, position: StoredPosition): Promise<void> {
    await this.users.getByName(userId).setPosition(documentId, position);
  }
}

const LexiconRow = z.object({
  lemmaId: LemmaIdSchema,
  version: z.string(),
  lemma: z.string(),
  upos: z.enum(UPOS),
  senses: z.string(),
  relations: z.string(),
  pronunciations: z.string(),
  paradigms: z.string(),
});

const FeatureRow = z.object({ id: z.number().int(), feature: z.string(), value: z.string() });

/** Each language's lexicon database, skolia-lexicon-{lang}[-env], bound as LEXICON_{LANG}
 * (api/wrangler.jsonc). */
export type LexiconBindings = { [L in Lang as `LEXICON_${Uppercase<L>}`]: D1Database };

export function lexiconBinding(lang: Lang): keyof LexiconBindings {
  return `LEXICON_${lang.toUpperCase() as Uppercase<Lang>}`;
}

export function lexiconsOf(env: LexiconBindings): Record<Lang, D1Database> {
  return Object.fromEntries(LANGS.map((lang) => [lang, env[lexiconBinding(lang)]])) as Record<Lang, D1Database>;
}

/** Each language's lexicon database, loaded by infra/load-lexicon.py from the same build
 * as the ingest images, serving its loaded version. Its JSON is ours, so it's trusted to
 * match. */
export class D1Lexicon implements Lexicon {
  private readonly dbs: Record<Lang, D1Database>;

  constructor(dbs: Record<Lang, D1Database>) {
    this.dbs = dbs;
  }

  async entries(ids: readonly LemmaId[]): Promise<Lookup> {
    const byLang = new Map<Lang, LemmaId[]>();
    for (const id of ids) byLang.set(langOf(id), [...(byLang.get(langOf(id)) ?? []), id]);
    const found = await Promise.all([...byLang].map(async ([lang, wanted]) => ({ lang, ...(await this.#entries(this.dbs[lang], wanted)) })));
    return {
      entries: found.flatMap((f) => f.entries),
      featureSets: Object.fromEntries(found.filter((f) => f.featureSets !== null).map((f) => [f.lang, f.featureSets])),
    };
  }

  /** The entries, then the feature sets their paradigms use, from the version each
   * entry came from: a load that switches versions in between leaves the old version's
   * rows until it cleans up. */
  async #entries(db: D1Database, ids: LemmaId[]): Promise<{ entries: LexiconEntry[]; featureSets: FeatureSets | null }> {
    const { results } = await db
      .prepare(
        `SELECT entry.lemma_id AS lemmaId, entry.version, entry.lemma, entry.upos, entry.senses,
           entry.relations, entry.pronunciations, entry.paradigms
         FROM entry JOIN loaded ON loaded.version = entry.version
         WHERE entry.lemma_id IN (${ids.map(() => "?").join(", ")})`,
      )
      .bind(...ids)
      .all();
    const used = new Map<string, Set<number>>();
    const entries = results.map((row): LexiconEntry => {
      const { version, senses, relations, pronunciations, paradigms, ...rest } = LexiconRow.parse(row);
      const parsed = JSON.parse(paradigms) as BundleParadigm[];
      const sets = used.get(version) ?? new Set<number>();
      for (const paradigm of parsed) for (const [, ids] of paradigm.forms) for (const id of ids) sets.add(id);
      used.set(version, sets);
      return {
        ...rest,
        senses: JSON.parse(senses) as Sense[],
        relations: JSON.parse(relations) as Relation[],
        pronunciations: JSON.parse(pronunciations) as Pronunciation[],
        paradigms: parsed,
      };
    });
    const wanted = [...used].filter(([, sets]) => sets.size > 0);
    if (wanted.length === 0) return { entries, featureSets: null };
    const statement = db.prepare(`SELECT id, feature, value FROM featureset WHERE version = ? AND id IN (SELECT value FROM json_each(?))`);
    const found = await db.batch(wanted.map(([version, sets]) => statement.bind(version, JSON.stringify([...sets]))));
    // A UD feature set: its features are whatever the language's rows name
    const sets: Record<number, Record<string, string>> = {};
    for (const result of found) {
      for (const row of result.results) {
        const { id, feature, value } = FeatureRow.parse(row);
        (sets[id] ??= {})[feature] = value;
      }
    }
    return { entries, featureSets: sets as FeatureSets };
  }
}

const SELECT_DOCUMENT = `SELECT entry.document_id AS id, entry.user_id AS "user", entry.title, entry.imported_at AS imported,
    entry.visibility, entry.licence, entry.author, entry.source, document.lang, document.words, "user"."name" AS importerName,
    (SELECT json_group_object(tag.kind, tag.value) FROM user_document_tag AS tag
      WHERE tag.user_id = entry.user_id AND tag.document_id = entry.document_id) AS tags
  FROM user_document AS entry
  JOIN document ON document.id = entry.document_id
  JOIN "user" ON "user"."id" = entry.user_id`;

/** The list's query: every public entry and the viewer's private ones, narrowed to those
 * with any of the values the filter gives for each kind of tag it names. Each kind looks
 * its values up in user_document_tag_value_idx. */
export function listQuery(viewer: UserId | null, tags: TagFilter): Sql {
  const narrowed = sql.join(
    Object.entries(tags)
      .filter(([, values]) => values.length > 0)
      .map(
        ([kind, values]) => sql` AND (entry.user_id, entry.document_id) IN (SELECT user_id, document_id FROM user_document_tag
          WHERE kind = ${kind} AND value IN (${sql.join(values, ", ")}))`,
      ),
    "",
  );
  const select = sql.raw(SELECT_DOCUMENT);
  // A UNION rather than an OR, so each half searches its own index
  return sql`${select} WHERE entry.visibility = 'public'${narrowed}
    UNION ALL ${select} WHERE entry.user_id = ${viewer} AND entry.visibility = 'private'${narrowed}
    ORDER BY imported DESC`;
}

/** D1Documents' queries, exported for the test that checks each one uses an index. */
export const DOCUMENT_QUERIES = {
  list: listQuery(null, {}).text,
  /** The list narrowed to one kind of tag, two of its values */
  listTagged: listQuery(null, { level: ["A1", "B1"] }).text,
  tags: "SELECT kind, value, description FROM tag ORDER BY kind, position",
  importedBy: `${SELECT_DOCUMENT} WHERE entry.user_id = ?1 ORDER BY entry.imported_at DESC`,
  visible: `${SELECT_DOCUMENT} WHERE entry.document_id = ?1 AND (entry.user_id = ?2 OR entry.visibility = 'public')
    ORDER BY entry.user_id IS ?2 DESC, entry.imported_at LIMIT 1`,
  has: "SELECT 1 FROM document WHERE id = ?1",
  addContent: "INSERT OR IGNORE INTO document (id, lang, words) VALUES (?1, ?2, ?3)",
  addEntry: `INSERT OR IGNORE INTO user_document (user_id, document_id, title, imported_at, visibility, licence, author, source)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  update: "UPDATE user_document SET title = ?3, visibility = ?4, licence = ?5, author = ?6, source = ?7 WHERE document_id = ?1 AND user_id = ?2",
  addTag: "INSERT OR IGNORE INTO user_document_tag (user_id, document_id, kind, value) VALUES (?1, ?2, ?3, ?4)",
  removeTags: "DELETE FROM user_document_tag WHERE user_id = ?1 AND document_id = ?2",
  remove: "DELETE FROM user_document WHERE document_id = ?1 AND user_id = ?2",
} as const;

export class D1Documents implements DocumentStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async list(viewer: UserId | null, tags: TagFilter): Promise<readonly StoredDocument[]> {
    const { text, params } = listQuery(viewer, tags);
    const { results } = await this.db
      .prepare(text)
      .bind(...params)
      .all();
    return results.map((row) => DocumentRow.parse(row));
  }

  async tags(): Promise<readonly AvailableTag[]> {
    const { results } = await this.db.prepare(DOCUMENT_QUERIES.tags).all();
    return results.map((row) => AvailableTagSchema.parse(row));
  }

  async importedBy(user: UserId): Promise<readonly StoredDocument[]> {
    const { results } = await this.db.prepare(DOCUMENT_QUERIES.importedBy).bind(user).all();
    return results.map((row) => DocumentRow.parse(row));
  }

  async visible(id: DocumentId, viewer: UserId | null): Promise<StoredDocument | null> {
    const row = await this.db.prepare(DOCUMENT_QUERIES.visible).bind(id, viewer).first();
    return row ? DocumentRow.parse(row) : null;
  }

  async has(id: DocumentId): Promise<boolean> {
    return (await this.db.prepare(DOCUMENT_QUERIES.has).bind(id).first()) !== null;
  }

  async add(c: DocumentContent, e: DocumentEntry): Promise<void> {
    await this.db.batch([
      this.db.prepare(DOCUMENT_QUERIES.addContent).bind(c.id, c.lang, c.words),
      this.db.prepare(DOCUMENT_QUERIES.addEntry).bind(e.user, e.id, e.title, e.imported, e.visibility, e.licence, e.author, e.source),
      ...this.addTags(e.user, e.id, e.tags),
    ]);
  }

  async update(id: DocumentId, user: UserId, { title, visibility, licence, author, source, tags }: EntryFields): Promise<void> {
    await this.db.batch([
      this.db.prepare(DOCUMENT_QUERIES.update).bind(id, user, title, visibility, licence, author, source),
      this.db.prepare(DOCUMENT_QUERIES.removeTags).bind(user, id),
      ...this.addTags(user, id, tags),
    ]);
  }

  private addTags(user: UserId, id: DocumentId, tags: Tags): D1PreparedStatement[] {
    return Object.entries(tags).flatMap(([kind, value]) =>
      value === undefined ? [] : [this.db.prepare(DOCUMENT_QUERIES.addTag).bind(user, id, kind, value)],
    );
  }

  async remove(id: DocumentId, user: UserId): Promise<void> {
    await this.db.prepare(DOCUMENT_QUERIES.remove).bind(id, user).run();
  }
}

export class R2Blobs implements BlobStore {
  private readonly bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async get(key: string): Promise<StoredBlob | null> {
    const object = await this.bucket.get(key);
    if (object === null) return null;
    return {
      body: new Uint8Array(await object.arrayBuffer()),
      contentType: object.httpMetadata?.contentType,
    };
  }

  async put(key: string, body: Uint8Array<ArrayBuffer> | string, contentType: string): Promise<void> {
    await this.bucket.put(key, body, { httpMetadata: { contentType } });
  }
}

/** Asks a language's ingest container for its jobs: the ingest Worker's Ingester
 * (worker/ingest.ts), or a fake in the tests. */
export type JobsOf = (lang: Lang) => Promise<IngestJobs | null>;

export class CloudflareQueue implements JobQueue {
  private readonly queue: Queue<IngestJob>;
  private readonly jobsOf: JobsOf;

  constructor(queue: Queue<IngestJob>, jobsOf: JobsOf) {
    this.queue = queue;
    this.jobsOf = jobsOf;
  }

  async send(job: IngestJob): Promise<void> {
    // JSON, not the default Workers-only "v8" format, so a message can be read outside a
    // Worker (the dashboard, wrangler)
    try {
      await this.queue.send(job, { contentType: "json" });
    } catch (error: unknown) {
      logger.error("sending job to the ingest queue failed", { doc: job.doc, lang: job.lang, error });
      throw error;
    }
  }

  async jobs(lang: Lang): Promise<IngestJobs | null> {
    try {
      return await this.jobsOf(lang);
    } catch (error: unknown) {
      // The ingest Worker not deployed or not answering: a summary without its place
      logger.error("asking ingest for its jobs failed", { lang, error });
      return null;
    }
  }
}
