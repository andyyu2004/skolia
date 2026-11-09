// The ports on Cloudflare: D1 for document metadata and the lexicon, R2 for blobs, Queues
// for jobs, a Durable Object per user for their own data.
import * as z from "zod";
import {
  LANGS,
  UPOS,
  type CardCounts,
  type DocumentId,
  type FeatureSets,
  type Lang,
  type LemmaId,
  type LexiconEntry,
  langOf,
  type Lookup,
  type Timestamp,
  type UserId,
  type ReviewRequest, type Settings, type Word, type WordStatus } from "@skolia/shared/api";
import type { BundleParadigm, IngestJob, Pronunciation, Relation, Sense } from "@skolia/shared/schema";
import { DocumentRow, LemmaId as LemmaIdSchema } from "@skolia/shared/schemas";
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

const SELECT_DOCUMENT = `SELECT entry.document_id AS id, entry.user_id AS "user", entry.title, entry.imported, entry.visibility,
    entry.licence, entry.author, entry.source, content.lang, content.words, "user"."name" AS importerName
  FROM user_document AS entry
  JOIN document_content AS content ON content.id = entry.document_id
  JOIN "user" ON "user"."id" = entry.user_id`;

/** D1Documents' queries, exported for the test that checks each one uses an index. */
export const DOCUMENT_QUERIES = {
  // A UNION rather than an OR, so each half searches its own index
  list: `${SELECT_DOCUMENT} WHERE entry.visibility = 'public'
    UNION ALL ${SELECT_DOCUMENT} WHERE entry.user_id = ?1 AND entry.visibility = 'private'
    ORDER BY imported DESC`,
  importedBy: `${SELECT_DOCUMENT} WHERE entry.user_id = ?1 ORDER BY entry.imported DESC`,
  visible: `${SELECT_DOCUMENT} WHERE entry.document_id = ?1 AND (entry.user_id = ?2 OR entry.visibility = 'public')
    ORDER BY entry.user_id IS ?2 DESC, entry.imported LIMIT 1`,
  has: "SELECT 1 FROM document_content WHERE id = ?1",
  addContent: "INSERT OR IGNORE INTO document_content (id, lang, words, added, added_by) VALUES (?1, ?2, ?3, ?4, ?5)",
  addEntry: `INSERT OR IGNORE INTO user_document (user_id, document_id, title, imported, visibility, licence, author, source)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  update: "UPDATE user_document SET title = ?3, visibility = ?4, licence = ?5, author = ?6, source = ?7 WHERE document_id = ?1 AND user_id = ?2",
  removeEntry: "DELETE FROM user_document WHERE document_id = ?1 AND user_id = ?2",
  removeOrphan: "DELETE FROM document_content WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM user_document WHERE document_id = ?1) RETURNING id",
  countAddedSince: `SELECT COUNT(*) AS n FROM document_content AS content JOIN "user" ON "user"."id" = content.added_by
    WHERE content.added >= ?1 AND "user"."type" != 'system'`,
} as const;

export class D1Documents implements DocumentStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async list(viewer: UserId | null): Promise<readonly StoredDocument[]> {
    const { results } = await this.db.prepare(DOCUMENT_QUERIES.list).bind(viewer).all();
    return results.map((row) => DocumentRow.parse(row));
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
      this.db.prepare(DOCUMENT_QUERIES.addContent).bind(c.id, c.lang, c.words, c.added, c.addedBy),
      this.db.prepare(DOCUMENT_QUERIES.addEntry).bind(e.user, e.id, e.title, e.imported, e.visibility, e.licence, e.author, e.source),
    ]);
  }

  async update(id: DocumentId, user: UserId, { title, visibility, licence, author, source }: EntryFields): Promise<void> {
    await this.db.prepare(DOCUMENT_QUERIES.update).bind(id, user, title, visibility, licence, author, source).run();
  }

  async remove(id: DocumentId, user: UserId): Promise<boolean> {
    const [, orphan] = await this.db.batch([
      this.db.prepare(DOCUMENT_QUERIES.removeEntry).bind(id, user),
      this.db.prepare(DOCUMENT_QUERIES.removeOrphan).bind(id),
    ]);
    return (orphan?.results.length ?? 0) > 0;
  }

  async countAddedSince(since: Timestamp): Promise<number> {
    const row = await this.db.prepare(DOCUMENT_QUERIES.countAddedSince).bind(since).first();
    return z.object({ n: z.number() }).parse(row).n;
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

  async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const listed = await this.bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
      if (listed.objects.length > 0) await this.bucket.delete(listed.objects.map((o) => o.key));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor !== undefined);
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
