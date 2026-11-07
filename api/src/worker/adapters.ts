// The ports on Cloudflare: D1 for document metadata and the lexicon, R2 for blobs, Queues
// for jobs, a Durable Object per user for their own data.
import * as z from "zod";
import {
  LANGS,
  UPOS,
  type CardCounts,
  type FeatureSets,
  type Lang,
  type LemmaId,
  type LexiconEntry,
  type Lookup,
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

  async words(userId: string): Promise<Word[]> {
    return this.users.getByName(userId).words();
  }

  async setWord(userId: string, lemmaId: LemmaId, status: WordStatus, now: string): Promise<void> {
    await this.users.getByName(userId).setWord(lemmaId, status, now);
  }

  async due(userId: string, lang: Lang, now: string, dayStart: string, limit: number): Promise<DueCards> {
    return this.users.getByName(userId).due(lang, now, dayStart, limit);
  }

  async counts(userId: string, now: string, dayStart: string): Promise<CardCounts[]> {
    return this.users.getByName(userId).counts(now, dayStart);
  }

  async review(userId: string, request: ReviewRequest, now: string): Promise<ReviewOutcome> {
    return this.users.getByName(userId).review(request, now);
  }

  async settings(userId: string): Promise<Settings> {
    return this.users.getByName(userId).settings();
  }

  async setSettings(userId: string, settings: Settings): Promise<void> {
    await this.users.getByName(userId).setSettings(settings);
  }
}

const LexiconRow = z.object({
  lemmaId: LemmaIdSchema,
  lang: z.enum(LANGS),
  version: z.string(),
  lemma: z.string(),
  upos: z.enum(UPOS),
  senses: z.string(),
  relations: z.string(),
  pronunciations: z.string(),
  paradigms: z.string(),
});

const FeatureRow = z.object({ id: z.number().int(), feature: z.string(), value: z.string() });

/** The lexicon database (skolia-lexicon), loaded by infra/load-lexicon.py from the
 * same build as the ingest images: each language's loaded version. Its JSON is ours, so
 * it's trusted to match. */
export class D1Lexicon implements Lexicon {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /** The entries, then the feature sets their paradigms use, from the version each
   * entry came from: a load that switches versions in between leaves the old version's
   * rows until it cleans up. */
  async entries(ids: readonly LemmaId[]): Promise<Lookup> {
    if (ids.length === 0) return { entries: [], featureSets: {} };
    const { results } = await this.db
      .prepare(
        `SELECT entry.lemma_id AS lemmaId, entry.lang, entry.version, entry.lemma, entry.upos, entry.senses,
           entry.relations, entry.pronunciations, entry.paradigms
         FROM entry JOIN loaded ON loaded.lang = entry.lang AND loaded.version = entry.version
         WHERE entry.lemma_id IN (${ids.map(() => "?").join(", ")})`,
      )
      .bind(...ids)
      .all();
    const used = new Map<string, { lang: Lang; version: string; ids: Set<number> }>();
    const entries = results.map((row): LexiconEntry => {
      const { lang, version, senses, relations, pronunciations, paradigms, ...rest } = LexiconRow.parse(row);
      const parsed = JSON.parse(paradigms) as BundleParadigm[];
      const sets = used.get(`${lang} ${version}`) ?? { lang, version, ids: new Set<number>() };
      for (const paradigm of parsed) for (const [, ids] of paradigm.forms) for (const id of ids) sets.ids.add(id);
      used.set(`${lang} ${version}`, sets);
      return {
        ...rest,
        senses: JSON.parse(senses) as Sense[],
        relations: JSON.parse(relations) as Relation[],
        pronunciations: JSON.parse(pronunciations) as Pronunciation[],
        paradigms: parsed,
      };
    });
    const wanted = [...used.values()].filter((sets) => sets.ids.size > 0);
    const statement = this.db.prepare(
      `SELECT id, feature, value FROM featureset
       WHERE lang = ? AND version = ? AND id IN (SELECT value FROM json_each(?))`,
    );
    const found = wanted.length === 0 ? [] : await this.db.batch(wanted.map((s) => statement.bind(s.lang, s.version, JSON.stringify([...s.ids]))));
    const featureSets: Partial<Record<Lang, FeatureSets>> = {};
    wanted.forEach(({ lang }, i) => {
      // A UD feature set: its features are whatever the language's rows name
      const sets: Record<number, Record<string, string>> = {};
      for (const row of found[i]?.results ?? []) {
        const { id, feature, value } = FeatureRow.parse(row);
        (sets[id] ??= {})[feature] = value;
      }
      featureSets[lang] = sets as FeatureSets;
    });
    return { entries, featureSets };
  }
}

const SELECT_DOCUMENT = `SELECT document.*, "user"."name" AS importerName FROM document JOIN "user" ON "user"."id" = document.importer`;

export class D1Documents implements DocumentStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async list(viewer: string | null): Promise<StoredDocument[]> {
    const { results } = await this.db
      .prepare(`${SELECT_DOCUMENT} WHERE document.visibility = 'public' OR document.importer = ? ORDER BY document.imported DESC`)
      .bind(viewer)
      .all();
    return results.map((row) => DocumentRow.parse(row));
  }

  async get(id: string): Promise<StoredDocument | null> {
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

  async share(id: string, { licence, author, source, licensor }: Sharing): Promise<void> {
    await this.db
      .prepare("UPDATE document SET visibility = 'public', licence = ?, author = ?, source = ?, licensor = ? WHERE id = ?")
      .bind(licence, author, source, licensor, id)
      .run();
  }

  async countImportedSince(since: string): Promise<number> {
    // ISO 8601 UTC strings sort in time order
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM document WHERE imported >= ?").bind(since).first();
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
}

export class CloudflareQueue implements JobQueue {
  private readonly queue: Queue<IngestJob>;

  constructor(queue: Queue<IngestJob>) {
    this.queue = queue;
  }

  async send(job: IngestJob): Promise<void> {
    // Ingest reads the queue over the HTTP pull API, which can't decode the default
    // Workers-only "v8" format
    await this.queue.send(job, { contentType: "json" });
  }
}
