// What the API needs from its surroundings: D1, R2, Cloudflare Queues and a Durable
// Object per user (src/worker/adapters.ts), Better Auth (src/auth.ts), and fakes in the
// tests.
import type {
  AvailableTag,
  CardCounts,
  DocumentId,
  Timestamp,
  UserId,
  Lang,
  LemmaId,
  Lookup,
  Licence,
  ReadingPosition,
  Reviewed,
  ReviewRequest,
  ScheduledCard,
  Settings,
  User,
  Visibility,
  TagFilter,
  Tags,
  Word,
  WordStatus,
} from "@skolia/shared/api";
import type { IngestJob } from "@skolia/shared/schema";

/** A text, stored once however many users import it, and never deleted. Its state lives in
 * the status blob. */
export interface DocumentContent {
  readonly id: DocumentId;
  readonly lang: Lang;
  readonly words: number;
}

/** What a user says about a text they imported. The licence is their claim. */
export interface EntryFields {
  readonly title: string;
  readonly visibility: Visibility;
  readonly licence: Licence;
  readonly author: string | null;
  readonly source: string | null;
  readonly tags: Tags;
}

/** A user's entry for a text they imported. */
export interface DocumentEntry extends EntryFields {
  readonly id: DocumentId;
  readonly user: UserId;
  readonly imported: Timestamp;
}

/** An entry with its text's language and word count, and its user's name. */
export interface StoredDocument extends DocumentEntry {
  readonly lang: Lang;
  readonly words: number;
  readonly importerName: string;
}

export interface DocumentStore {
  /** Every public entry, and the viewer's private ones, newest first, with any of the
   * values the filter gives for each kind of tag it names. */
  list(viewer: UserId | null, tags: TagFilter): Promise<readonly StoredDocument[]>;
  /** Every tag that can be given, by kind, then in each kind's order. */
  tags(): Promise<readonly AvailableTag[]>;
  /** This user's entries, public or private, newest first. */
  importedBy(user: UserId): Promise<readonly StoredDocument[]>;
  /** The entry the viewer sees for a text: their own, else its earliest public one. Null
   * for a text that's unknown or private to others. */
  visible(id: DocumentId, viewer: UserId | null): Promise<StoredDocument | null>;
  /** Whether the text is stored, whoever imported it. */
  has(id: DocumentId): Promise<boolean>;
  /** Insert the entry, and the content unless it's already there. An existing entry is kept. */
  add(content: DocumentContent, entry: DocumentEntry): Promise<void>;
  /** Its tags replace all the entry had. */
  update(id: DocumentId, user: UserId, fields: EntryFields): Promise<void>;
  /** Delete the user's entry. The text stays, for anyone who imports it again. */
  remove(id: DocumentId, user: UserId): Promise<void>;
}

export interface StoredBlob {
  body: Uint8Array<ArrayBuffer>;
  contentType: string | undefined;
}

export interface BlobStore {
  get(key: string): Promise<StoredBlob | null>;
  put(key: string, body: Uint8Array<ArrayBuffer> | string, contentType: string): Promise<void>;
}

/** A language's ingest container's jobs (analysis/src/skolia_analysis/ingest/http.py
 * JobsState): whether its pipelines are still loading, and the documents running and
 * waiting, in the order they'll run. */
export interface IngestJobs {
  loading: boolean;
  running: string[];
  waiting: string[];
}

export interface JobQueue {
  send(job: IngestJob): Promise<void>;
  /** Null when no container is running for the language, or it can't be asked. */
  jobs(lang: Lang): Promise<IngestJobs | null>;
}

export interface DueCards {
  cards: ScheduledCard[];
  newLeft: number;
}

/** out-of-order: answered before the card was made or before its last review.
 * id-reused: the review id is another card's. */
export type ReviewOutcome = ({ kind: "reviewed" } & Reviewed) | { kind: "no-card" } | { kind: "out-of-order" } | { kind: "id-reused" };

/** A user's words, cards and settings, in their own Durable Object. now: the request's
 * time by the API's clock (Deps.now), which the tests set. dayStart: when the user's
 * day started in their time zone; today's new cards count from it. */
export interface UserData {
  words(userId: UserId): Promise<Word[]>;
  setWord(userId: UserId, lemmaId: LemmaId, status: WordStatus, now: Timestamp): Promise<void>;
  due(userId: UserId, lang: Lang, now: Timestamp, dayStart: Timestamp, limit: number): Promise<DueCards>;
  counts(userId: UserId, now: Timestamp, dayStart: Timestamp): Promise<CardCounts[]>;
  review(userId: UserId, request: ReviewRequest, now: Timestamp): Promise<ReviewOutcome>;
  settings(userId: UserId): Promise<Settings>;
  setSettings(userId: UserId, settings: Settings): Promise<void>;
  position(userId: UserId, documentId: DocumentId): Promise<StoredPosition | null>;
  /** Keeps the stored position if it's as new as this one or newer. */
  setPosition(userId: UserId, documentId: DocumentId, position: StoredPosition): Promise<void>;
}

export type StoredPosition = Omit<ReadingPosition, "at"> & { at: Timestamp };

/** The lexicon, with the feature sets its entries' paradigms use. Ids it doesn't have are left out. */
export interface Lexicon {
  entries(ids: readonly LemmaId[]): Promise<Lookup>;
}

export interface Auth {
  handle(request: Request): Promise<Response>;
  user(headers: Headers): Promise<User | null>;
}

export interface Deps {
  auth: Auth;
  users: UserData;
  lexicon: Lexicon;
  documents: DocumentStore;
  blobs: BlobStore;
  queue: JobQueue;
  /** git describe of the build */
  version: string;
  now: () => Date;
}
