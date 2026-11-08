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
  DocumentRecord,
  DocumentStore,
  DueCards,
  JobQueue,
  Lexicon,
  ReviewOutcome,
  Sharing,
  StoredBlob,
  StoredDocument,
  UserData,
} from "../ports.ts";
import type { User } from "./user.ts";

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

const SELECT_DOCUMENT = `SELECT document.*, "user"."name" AS importerName FROM document JOIN "user" ON "user"."id" = document.importer`;

export class D1Documents implements DocumentStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async list(viewer: UserId | null): Promise<StoredDocument[]> {
    const { results } = await this.db
      .prepare(`${SELECT_DOCUMENT} WHERE document.visibility = 'public' OR document.importer = ? ORDER BY document.imported DESC`)
      .bind(viewer)
      .all();
    return results.map((row) => DocumentRow.parse(row));
  }

  async get(id: DocumentId): Promise<StoredDocument | null> {
    const row = await this.db.prepare(`${SELECT_DOCUMENT} WHERE document.id = ?`).bind(id).first();
    return row ? DocumentRow.parse(row) : null;
  }

  async add(r: DocumentRecord): Promise<void> {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO document (id, title, lang, imported, words, importer, visibility, licence, author, source, licensor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(r.id, r.title, r.lang, r.imported, r.words, r.importer, r.visibility, r.licence, r.author, r.source, r.licensor)
      .run();
  }

  async share(id: DocumentId, { licence, author, source, licensor }: Sharing): Promise<void> {
    await this.db
      .prepare("UPDATE document SET visibility = 'public', licence = ?, author = ?, source = ?, licensor = ? WHERE id = ?")
      .bind(licence, author, source, licensor, id)
      .run();
  }

  async importedBy(importer: UserId): Promise<StoredDocument[]> {
    const { results } = await this.db
      .prepare(`${SELECT_DOCUMENT} WHERE document.importer = ? ORDER BY document.imported DESC`)
      .bind(importer)
      .all();
    return results.map((row) => DocumentRow.parse(row));
  }

  async update(
    id: DocumentId,
    { title, licence, author, source, licensor }: Pick<DocumentRecord, "title" | "licence" | "author" | "source" | "licensor">,
  ): Promise<void> {
    await this.db
      .prepare("UPDATE document SET title = ?, licence = ?, author = ?, source = ?, licensor = ? WHERE id = ?")
      .bind(title, licence, author, source, licensor, id)
      .run();
  }

  async delete(id: DocumentId): Promise<void> {
    await this.db.prepare("DELETE FROM document WHERE id = ?").bind(id).run();
  }

  async countImportedSince(since: Timestamp): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM document JOIN "user" ON "user"."id" = document.importer
                WHERE document.imported >= ? AND "user"."type" != 'system'`)
      .bind(since)
      .first();
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

export class CloudflareQueue implements JobQueue {
  private readonly queue: Queue<IngestJob>;

  constructor(queue: Queue<IngestJob>) {
    this.queue = queue;
  }

  async send(job: IngestJob): Promise<void> {
    // JSON, not the default Workers-only "v8" format, so a message can be read outside a
    // Worker (the dashboard, wrangler)
    await this.queue.send(job, { contentType: "json" });
  }
}
