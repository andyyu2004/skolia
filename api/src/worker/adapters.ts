// The ports on Cloudflare: D1 for document metadata and the lexicon, R2 for blobs, Queues
// for jobs, a Durable Object per user for their own data.
import * as z from "zod";
import {
  LANGS,
  UPOS,
  type CardCounts,
  type CardGroup,
  type CardId,
  type ClozeKey,
  type ClozeStart,
  type DocumentFilter,
  type DocumentKey,
  type NewCloze,
  type Paginated,
  type Tag,
  type TagKey,
  type WordKey,
  type DocumentId,
  type FeatureSets,
  type Lang,
  type LemmaId,
  type LexiconEntry,
  langOf,
  type Lookup,
  type Timestamp,
  type UserId,
  type ReadingEntry,
  type ReadingKey,
  type ReadingStatus,
  type ReviewRequest, type Settings, type AvailableTag, type Tags, type Word, type WordStatus } from "@skolia/shared/api";
import { paginate, type PageRequest } from "@skolia/shared/page";
import type { BundleParadigm, IngestJob, Pronunciation, Relation, Sense } from "@skolia/shared/schema";
import * as schemas from "@skolia/shared/schemas";
import { and, col, compile, contains, desc, eq, exists, fn, gt, inList, is, lit, or, row, select, unionAll, type Query, type Select } from "@skolia/util/query";
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
  StoredReading,
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

  async words(userId: UserId, page: PageRequest<WordKey>): Promise<Paginated<Word, WordKey>> {
    return this.users.getByName(userId).words(page);
  }

  async setWord(userId: UserId, lemmaId: LemmaId, status: WordStatus, now: Timestamp): Promise<void> {
    await this.users.getByName(userId).setWord(lemmaId, status, now);
  }

  async clearWordStatus(userId: UserId, lemmaId: LemmaId): Promise<void> {
    await this.users.getByName(userId).clearWordStatus(lemmaId);
  }

  async due(userId: UserId, lang: Lang, now: Timestamp, dayStart: Timestamp, limit: number, group: CardGroup | undefined): Promise<DueCards> {
    return this.users.getByName(userId).due(lang, now, dayStart, limit, group);
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

  async clozes(userId: UserId, documentId: DocumentId, page: PageRequest<ClozeKey>): Promise<Paginated<ClozeStart, ClozeKey>> {
    return this.users.getByName(userId).clozes(documentId, page);
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

  async reading(userId: UserId, documentId: DocumentId): Promise<ReadingEntry | null> {
    return this.users.getByName(userId).reading(documentId);
  }

  async setReading(userId: UserId, documentId: DocumentId, lang: Lang, status: ReadingStatus, now: Timestamp): Promise<ReadingEntry> {
    return this.users.getByName(userId).setReading(documentId, lang, status, now);
  }

  async removeReading(userId: UserId, documentId: DocumentId): Promise<void> {
    await this.users.getByName(userId).removeReading(documentId);
  }

  async readingList(userId: UserId, status: ReadingStatus, lang: Lang | undefined, page: PageRequest<ReadingKey>): Promise<Paginated<StoredReading, ReadingKey>> {
    return this.users.getByName(userId).readingList(status, lang, page);
  }
}

const LexiconRow = z.object({
  lemmaId: schemas.LemmaId,
  version: z.string(),
  lemma: z.string(),
  upos: z.enum(UPOS),
  senses: z.string(),
  relations: z.string(),
  pronunciations: z.string(),
  paradigms: z.string(),
});

const FeatureRow = z.object({ id: z.number().int(), feature: z.string(), value: z.string() });

export const prepare = (db: D1Database, query: Query | Sql): D1PreparedStatement => {
  const { text, params } = compile(query);
  return db.prepare(text).bind(...params);
};

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
    const { results } = await prepare(
      db,
      sql`SELECT entry.lemma_id AS lemmaId, entry.version, entry.lemma, entry.upos, entry.senses,
           entry.relations, entry.pronunciations, entry.paradigms
         FROM entry JOIN loaded ON loaded.version = entry.version
         WHERE entry.lemma_id IN ${sql.tuple(ids)}`,
    ).all();
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
    const found = await db.batch(
      wanted.map(([version, sets]) =>
        prepare(db, sql`SELECT id, feature, value FROM featureset WHERE version = ${version} AND id IN (SELECT value FROM json_each(${JSON.stringify([...sets])}))`),
      ),
    );
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

const COLUMNS = {
  title: "entry.title",
  imported: "entry.imported_at",
  visibility: "entry.visibility",
  licence: "entry.licence",
  author: "entry.author",
  source: "entry.source",
  lang: "document.lang",
  words: "document.words",
  importerName: "user.name",
  tags: select({ tags: fn.jsonGroupObject("tag.kind", "tag.value") })
    .from("user_document_tag", "tag")
    .where(eq("tag.user_id", col("entry.user_id")), eq("tag.document_id", col("entry.document_id"))),
};

const joined = (query: Select): Select =>
  query.join("document", eq("document.id", col("entry.document_id"))).join("user", eq("user.id", col("entry.user_id")));

const SELECT_DOCUMENT = joined(select({ id: "entry.document_id", user: "entry.user_id", ...COLUMNS }).from("user_document", "entry"));

/** Entries by one of their tags: its key columns are the tag row's, so the list's order is
 * user_document_tag_value_idx's within the tag. */
const SELECT_TAGGED = joined(
  select({ id: "tagged.document_id", user: "tagged.user_id", ...COLUMNS })
    .from("user_document_tag", "tagged")
    .join("user_document", "entry", and(eq("entry.user_id", col("tagged.user_id")), eq("entry.document_id", col("tagged.document_id")))),
);

type KindValues = readonly [kind: string, values: readonly string[]];

/** The list's query: a page of the public entries and the viewer's private ones (with
 * mine, the viewer's alone) that the filter keeps, in the order of their key, (user,
 * document), and one more entry if there is one. Each part walks an index in that order
 * from the cursor, and SQLite merges them, so a page reads about a page of entries:
 * - the public entries, by primary key, or with tags, one part for each value of the
 *   first kind, by user_document_tag_value_idx, the other kinds looked up for each entry;
 * - the viewer's own, by primary key, their tags looked up for each entry. */
export function listQuery(viewer: UserId | null, { tags, lang, title, mine }: DocumentFilter, { after, limit }: PageRequest<DocumentKey>): Query {
  const kinds: readonly KindValues[] = Object.entries(tags).filter(([, values]) => values.length > 0);
  const [first, ...others] = kinds;
  const narrowed = [lang !== undefined && eq("document.lang", lang), title !== undefined && contains("entry.title", title)];
  const from = (key: "entry" | "tagged") => after !== undefined && gt(row(`${key}.user_id`, `${key}.document_id`), after);
  const own =
    viewer === null ? [] : [SELECT_DOCUMENT.where(eq("entry.user_id", viewer), !mine && eq("entry.visibility", lit("private")), from("entry"), ...narrowed, ...tagged(kinds))];
  const shared = mine
    ? []
    : first === undefined
      ? [SELECT_DOCUMENT.where(eq("entry.visibility", lit("public")), from("entry"), ...narrowed)]
      : first[1].map((value) =>
          SELECT_TAGGED.where(eq("tagged.kind", first[0]), eq("tagged.value", value), eq("entry.visibility", lit("public")), from("tagged"), ...narrowed, ...tagged(others)),
        );
  return unionAll([...shared, ...own])
    .orderBy("user", "id")
    .limit(limit + 1);
}

/** The entry has one of the values of each kind, looked up by user_document_tag's primary key. */
function tagged(kinds: readonly KindValues[]): readonly Sql[] {
  return kinds.map(([kind, values]) =>
    exists(
      select({})
        .from("user_document_tag", "has")
        .where(eq("has.user_id", col("entry.user_id")), eq("has.document_id", col("entry.document_id")), eq("has.kind", kind), inList("has.value", values)),
    ),
  );
}

/** A page of the tags, and one more if there is one. */
function tagsQuery({ after, limit }: PageRequest<TagKey>): Query {
  return select(["kind", "value", "description", "position"])
    .from("tag")
    .where(after !== undefined && gt(row("kind", "position"), after))
    .orderBy("kind", "position")
    .limit(limit + 1);
}

function knownQuery(tags: readonly Tag[]): Sql {
  return sql`SELECT kind, value FROM tag WHERE (kind, value) IN (VALUES ${sql.join(
    tags.map(({ kind, value }) => sql.tuple([kind, value])),
    ", ",
  )})`;
}

function visibleQuery(id: DocumentId, viewer: UserId | null): Query {
  return SELECT_DOCUMENT.where(eq("entry.document_id", id), or(viewer !== null && eq("entry.user_id", viewer), eq("entry.visibility", lit("public"))))
    .orderBy(desc(is("entry.user_id", viewer)), "entry.imported_at")
    .limit(1);
}

function hasQuery(id: DocumentId): Sql {
  return sql`SELECT 1 FROM document WHERE id = ${id}`;
}

function addContentQuery({ id, lang, words }: DocumentContent): Sql {
  return sql`INSERT OR IGNORE INTO document (id, lang, words) VALUES ${sql.tuple([id, lang, words])}`;
}

function addEntryQuery(e: DocumentEntry): Sql {
  return sql`INSERT OR IGNORE INTO user_document (user_id, document_id, title, imported_at, visibility, licence, author, source)
    VALUES ${sql.tuple([e.user, e.id, e.title, e.imported, e.visibility, e.licence, e.author, e.source])}`;
}

function updateQuery(id: DocumentId, user: UserId, { title, visibility, licence, author, source }: EntryFields): Sql {
  return sql`UPDATE user_document SET title = ${title}, visibility = ${visibility}, licence = ${licence}, author = ${author}, source = ${source}
    WHERE document_id = ${id} AND user_id = ${user}`;
}

function addTagQuery(user: UserId, id: DocumentId, kind: string, value: string): Sql {
  return sql`INSERT OR IGNORE INTO user_document_tag (user_id, document_id, kind, value) VALUES ${sql.tuple([user, id, kind, value])}`;
}

function removeTagsQuery(user: UserId, id: DocumentId): Sql {
  return sql`DELETE FROM user_document_tag WHERE user_id = ${user} AND document_id = ${id}`;
}

function removeQuery(id: DocumentId, user: UserId): Sql {
  return sql`DELETE FROM user_document WHERE document_id = ${id} AND user_id = ${user}`;
}

const TagRow = schemas.AvailableTag.extend({ position: z.number().int() });
const KnownTag = schemas.AvailableTag.pick({ kind: true, value: true });

const NO_FILTER: DocumentFilter = { tags: {}, lang: undefined, title: undefined, mine: false };
const SOME_KEY = schemas.DocumentKey.parse(["x", "0".repeat(64)]);
const SOMEONE = schemas.UserId.parse("x");
const TWO_KINDS = { level: ["A1", "B1"], form: ["poem"] };
const SOME_ENTRY: DocumentEntry = {
  id: SOME_KEY[1],
  user: SOMEONE,
  imported: schemas.Timestamp.parse("2026-11-12T00:00:00.000Z"),
  title: "x",
  visibility: "public",
  licence: "cc0",
  author: null,
  source: null,
  tags: {},
};

/** D1Documents' queries, exported for the test that checks each one uses an index. */
export const DOCUMENT_QUERIES = {
  list: compile(listQuery(null, NO_FILTER, { after: undefined, limit: 24 })).text,
  listAfter: compile(listQuery(SOMEONE, NO_FILTER, { after: SOME_KEY, limit: 24 })).text,
  /** The list narrowed to one kind of tag, two of its values */
  listTagged: compile(listQuery(null, { ...NO_FILTER, tags: { level: ["A1", "B1"] } }, { after: SOME_KEY, limit: 24 })).text,
  listTwoKinds: compile(listQuery(SOMEONE, { ...NO_FILTER, tags: TWO_KINDS }, { after: SOME_KEY, limit: 24 })).text,
  listFiltered: compile(listQuery(SOMEONE, { ...NO_FILTER, lang: "pl", title: "x" }, { after: SOME_KEY, limit: 24 })).text,
  listMine: compile(listQuery(SOMEONE, { ...NO_FILTER, mine: true }, { after: undefined, limit: 24 })).text,
  listMineAfter: compile(listQuery(SOMEONE, { ...NO_FILTER, mine: true, tags: TWO_KINDS }, { after: SOME_KEY, limit: 24 })).text,
  tags: compile(tagsQuery({ after: undefined, limit: 100 })).text,
  tagsAfter: compile(tagsQuery({ after: ["level", 0], limit: 100 })).text,
  known: compile(knownQuery([{ kind: "level", value: "A1" }])).text,
  visible: compile(visibleQuery(SOME_ENTRY.id, SOMEONE)).text,
  has: compile(hasQuery(SOME_ENTRY.id)).text,
  addContent: compile(addContentQuery({ id: SOME_ENTRY.id, lang: "pl", words: 1 })).text,
  addEntry: compile(addEntryQuery(SOME_ENTRY)).text,
  update: compile(updateQuery(SOME_ENTRY.id, SOMEONE, SOME_ENTRY)).text,
  addTag: compile(addTagQuery(SOMEONE, SOME_ENTRY.id, "level", "A1")).text,
  removeTags: compile(removeTagsQuery(SOMEONE, SOME_ENTRY.id)).text,
  remove: compile(removeQuery(SOME_ENTRY.id, SOMEONE)).text,
} as const;

export class D1Documents implements DocumentStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async list(viewer: UserId | null, filter: DocumentFilter, page: PageRequest<DocumentKey>): Promise<Paginated<StoredDocument, DocumentKey>> {
    const rows = (await this.all(listQuery(viewer, filter, page))).map((row) => schemas.DocumentRow.parse(row));
    return paginate(
      rows.map((item) => ({ item, key: [item.user, item.id] as const })),
      page.limit,
    );
  }

  async tags(page: PageRequest<TagKey>): Promise<Paginated<AvailableTag, TagKey>> {
    const rows = (await this.all(tagsQuery(page))).map((row) => TagRow.parse(row));
    return paginate(
      rows.map(({ position, ...item }) => ({ item, key: [item.kind, position] as const })),
      page.limit,
    );
  }

  async known(tags: readonly Tag[]): Promise<readonly Tag[]> {
    if (tags.length === 0) return [];
    return (await this.all(knownQuery(tags))).map((row) => KnownTag.parse(row));
  }

  private async all(query: Query | Sql): Promise<readonly Record<string, unknown>[]> {
    const { results } = await prepare(this.db, query).all();
    return results;
  }

  async visible(id: DocumentId, viewer: UserId | null): Promise<StoredDocument | null> {
    const row = await prepare(this.db, visibleQuery(id, viewer)).first();
    return row ? schemas.DocumentRow.parse(row) : null;
  }

  async visibleAll(ids: readonly DocumentId[], viewer: UserId): Promise<ReadonlyMap<DocumentId, StoredDocument>> {
    if (ids.length === 0) return new Map();
    const found = await this.db.batch(ids.map((id) => prepare(this.db, visibleQuery(id, viewer))));
    return new Map(
      found.flatMap(({ results: [row] }) => {
        if (row === undefined) return [];
        const document = schemas.DocumentRow.parse(row);
        return [[document.id, document] as const];
      }),
    );
  }

  async has(id: DocumentId): Promise<boolean> {
    return (await prepare(this.db, hasQuery(id)).first()) !== null;
  }

  async add(content: DocumentContent, entry: DocumentEntry): Promise<void> {
    await this.db.batch([
      prepare(this.db, addContentQuery(content)),
      prepare(this.db, addEntryQuery(entry)),
      ...this.addTags(entry.user, entry.id, entry.tags),
    ]);
  }

  async update(id: DocumentId, user: UserId, fields: EntryFields): Promise<void> {
    await this.db.batch([
      prepare(this.db, updateQuery(id, user, fields)),
      prepare(this.db, removeTagsQuery(user, id)),
      ...this.addTags(user, id, fields.tags),
    ]);
  }

  private addTags(user: UserId, id: DocumentId, tags: Tags): D1PreparedStatement[] {
    return Object.entries(tags).flatMap(([kind, value]) => (value === undefined ? [] : [prepare(this.db, addTagQuery(user, id, kind, value))]));
  }

  async remove(id: DocumentId, user: UserId): Promise<void> {
    await prepare(this.db, removeQuery(id, user)).run();
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
