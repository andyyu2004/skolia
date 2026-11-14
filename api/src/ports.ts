// What the API needs from its surroundings: D1, R2, Cloudflare Queues and a Durable
// Object per user (src/worker/adapters.ts), Better Auth (src/auth.ts), and fakes in the
// tests.
import type {
  Annotation,
  AnnotationId,
  AnnotationKey,
  AvailableTag,
  CardCounts,
  CardGroup,
  CardId,
  ClozeKey,
  ClozeStart,
  DocumentFilter,
  DocumentId,
  DocumentKey,
  Paginated,
  Tag,
  TagKey,
  WordKey,
  Timestamp,
  UserId,
  Lang,
  LemmaId,
  Lookup,
  Licence,
  NewCloze,
  NewLeft,
  ReadingEntry,
  ReadingKey,
  ReadingPosition,
  ReadingStatus,
  Reviewed,
  ReviewRequest,
  ScheduledCard,
  Settings,
  User,
  Visibility,
  Tags,
  Word,
  WordStatus,
} from "@skolia/shared/api";
import type { PageRequest } from "@skolia/shared/page";
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
  /** A page of the public entries and the viewer's private ones, by user then text, that the
   * filter keeps (with mine, the viewer's alone). */
  list(viewer: UserId | null, filter: DocumentFilter, page: PageRequest<DocumentKey>): Promise<Paginated<StoredDocument, DocumentKey>>;
  /** A page of the tags that can be given, by kind, then in each kind's order. */
  tags(page: PageRequest<TagKey>): Promise<Paginated<AvailableTag, TagKey>>;
  /** Those of the tags that can be given. */
  known(tags: readonly Tag[]): Promise<readonly Tag[]>;
  /** The entry the viewer sees for a text: their own, else its earliest public one. Null
   * for a text that's unknown or private to others. */
  visible(id: DocumentId, viewer: UserId | null): Promise<StoredDocument | null>;
  /** visible's entry for each of the texts that has one. */
  visibleAll(ids: readonly DocumentId[], viewer: UserId): Promise<ReadonlyMap<DocumentId, StoredDocument>>;
  /** Whether the text is stored, whoever imported it. */
  has(id: DocumentId): Promise<boolean>;
  /** Insert the entry, and the content unless it's already there. An existing entry is kept. */
  add(content: DocumentContent, entry: DocumentEntry): Promise<void>;
  /** Its tags replace all the entry had. */
  update(id: DocumentId, user: UserId, fields: EntryFields): Promise<void>;
  /** Delete the user's entry. The text stays, for anyone who imports it again. */
  remove(id: DocumentId, user: UserId): Promise<void>;
  /** A page of the user's entry's annotations, by where they start. */
  annotations(id: DocumentId, user: UserId, page: PageRequest<AnnotationKey>): Promise<Paginated<Annotation, AnnotationKey>>;
  /** Add the annotation to the user's entry, which must exist, unless it has one with its
   * id already or has MAX_ANNOTATIONS. */
  annotate(id: DocumentId, user: UserId, annotation: Annotation): Promise<Annotated>;
  /** False if the user's entry has no annotation with the id. */
  unannotate(id: DocumentId, user: UserId, annotationId: AnnotationId): Promise<boolean>;
}

/** added: the annotation is new. exists: the entry had it, as it's given here. full: the
 * entry has MAX_ANNOTATIONS. */
export type Annotated = { readonly kind: "added" | "exists"; readonly annotation: Annotation } | { readonly kind: "full" };

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
  readonly cards: ScheduledCard[];
  readonly newLeft: NewLeft;
}

/** out-of-order: answered before the card was made or before its last review.
 * id-reused: the review id is another card's. */
export type ReviewOutcome = ({ kind: "reviewed" } & Reviewed) | { kind: "no-card" } | { kind: "out-of-order" } | { kind: "id-reused" };

/** A user's words, cards and settings, in their own Durable Object. now: the request's
 * time by the API's clock (Deps.now), which the tests set. dayStart: when the user's
 * day started in their time zone; today's new cards count from it. */
export interface UserData {
  /** A page of the words the user has given a status, by lemma id. */
  words(userId: UserId, page: PageRequest<WordKey>): Promise<Paginated<Word, WordKey>>;
  setWord(userId: UserId, lemmaId: LemmaId, status: WordStatus, now: Timestamp): Promise<void>;
  /** Clears the word's status and takes its cards, cloze cards too, out of reviews. Deletes
   * nothing: the cards and their reviews come back when the word is made active again. */
  clearWordStatus(userId: UserId, lemmaId: LemmaId): Promise<void>;
  /** group: only its cards; undefined, both groups'. */
  due(userId: UserId, lang: Lang, now: Timestamp, dayStart: Timestamp, limit: number, group: CardGroup | undefined): Promise<DueCards>;
  counts(userId: UserId, now: Timestamp, dayStart: Timestamp): Promise<CardCounts[]>;
  review(userId: UserId, request: ReviewRequest, now: Timestamp): Promise<ReviewOutcome>;
  /** The cloze card the text's sentence and word already had, if any, made: false. */
  makeCloze(userId: UserId, cloze: NewCloze, now: Timestamp): Promise<{ cardId: CardId; made: boolean }>;
  /** A page of the text's cloze cards, by where their blanks start. */
  clozes(userId: UserId, documentId: DocumentId, page: PageRequest<ClozeKey>): Promise<Paginated<ClozeStart, ClozeKey>>;
  /** False if the user has no such cloze card. */
  deleteCloze(userId: UserId, cardId: CardId): Promise<boolean>;
  settings(userId: UserId): Promise<Settings>;
  setSettings(userId: UserId, settings: Settings): Promise<void>;
  position(userId: UserId, documentId: DocumentId): Promise<StoredPosition | null>;
  /** Keeps the stored position if it's as new as this one or newer. */
  setPosition(userId: UserId, documentId: DocumentId, position: StoredPosition): Promise<void>;
  /** The text's entry on the reading list, null if it isn't on it. */
  reading(userId: UserId, documentId: DocumentId): Promise<ReadingEntry | null>;
  /** Puts the text on the list with the status, or gives it the status. updatedAt changes
   * only with the status. lang: the text's. */
  setReading(userId: UserId, documentId: DocumentId, lang: Lang, status: ReadingStatus, now: Timestamp): Promise<ReadingEntry>;
  removeReading(userId: UserId, documentId: DocumentId): Promise<void>;
  /** A page of the texts on the list with the status, in the language if one is given. */
  readingList(userId: UserId, status: ReadingStatus, lang: Lang | undefined, page: PageRequest<ReadingKey>): Promise<Paginated<StoredReading, ReadingKey>>;
}

export type StoredPosition = Omit<ReadingPosition, "at"> & { at: Timestamp };

export type StoredReading = ReadingEntry & { readonly documentId: DocumentId };

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
