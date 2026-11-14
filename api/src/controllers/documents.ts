// Documents: importing a text, listing and opening them, and their text, analysis and
// bundle, queueing a document again when ingest makes other versions or its job is lost.
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as z from "zod";
import {
  MAX_TITLE_LENGTH,
  formatTag,
  isShareable,
  timestamp,
  type AvailableTag,
  type DocumentFilter,
  type DocumentId,
  type DocumentKey,
  type DocumentSummary,
  type Lang,
  type Paginated,
  type QueuePlace,
  type TagKey,
  type Tags,
  type User,
} from "@skolia/shared/api";
import type { PageRequest } from "@skolia/shared/page";
import { PART_ENCODING, docId, partKey, statusKey, textKey, versionsKey } from "@skolia/shared/keys";
import type { Status, Versions } from "@skolia/shared/schema";
import * as schemas from "@skolia/shared/schemas";
import { log } from "../log.ts";
import type { BlobStore, Deps, EntryFields, IngestJobs, StoredDocument } from "../ports.ts";
import { NO_CONTENT, fail, ok, type BlobResult, type Failed, type Json, type NoContent, type NotModified, type Ok } from "./result.ts";

const logger = log("documents");

const NAME = /^[a-z0-9-]{1,64}$/;
const JSON_TYPE = "application/json";

/** A page of the entries the viewer can see that the filter keeps. Listing only reads
 * each entry's status; opening one (get) queues it again if it needs it. */
export async function list(
  deps: Deps,
  viewer: User | null,
  filter: DocumentFilter,
  page: PageRequest<DocumentKey>,
): Promise<Ok<Paginated<DocumentSummary, DocumentKey>> | Failed<401>> {
  if (filter.mine && viewer === null) return fail(401, "sign in to see your own texts");
  const { items, next } = await deps.documents.list(viewer?.id ?? null, filter, page);
  return ok({ items: await Promise.all(items.map((r) => listed(deps, r, viewer))), next });
}

/** An entry as a list shows it, with only its status read. */
export async function listed(deps: Deps, record: StoredDocument, viewer: User | null): Promise<DocumentSummary> {
  return summarize(record, await readStatus(deps.blobs, record.id), viewer);
}

/** A page of the documents the user imported, public or private. */
export async function mine(
  deps: Deps,
  user: User,
  page: PageRequest<DocumentKey>,
): Promise<Ok<Paginated<DocumentSummary, DocumentKey>> | Failed<401>> {
  return list(deps, user, { tags: {}, lang: undefined, title: undefined, mine: true }, page);
}

/** A page of the tags that can be given. */
export async function tags(deps: Deps, page: PageRequest<TagKey>): Promise<Ok<Paginated<AvailableTag, TagKey>>> {
  return ok(await deps.documents.tags(page));
}

/** A 400 naming the first of the tags skolia doesn't have, or null if it has them all. */
async function unknownTag(deps: Deps, tags: Tags): Promise<Failed<400> | null> {
  const given = Object.entries(tags).map(([kind, value]) => ({ kind, value }));
  if (given.length === 0) return null;
  const known = new Set((await deps.documents.known(given)).map(formatTag));
  const unknown = given.map(formatTag).find((tag) => !known.has(tag));
  return unknown === undefined ? null : fail(400, `no tag ${unknown}`);
}

/** 202 if the text is queued, 200 if it's already here and not failed (a failed import is
 * retried by importing the same text again). A text someone else imported gets the user's
 * own entry, with their title, visibility and licence. */
export async function importText(
  deps: Deps,
  user: User,
  body: z.output<typeof schemas.ImportRequest>,
): Promise<Json<DocumentSummary, 200> | Json<DocumentSummary, 202> | Failed<400>> {
  const unknown = await unknownTag(deps, body.tags);
  if (unknown !== null) return unknown;
  const fields: EntryFields = {
    title: body.title?.trim().slice(0, MAX_TITLE_LENGTH) || firstWords(body.text),
    visibility: body.visibility,
    licence: body.licence,
    author: body.author?.trim() || null,
    source: body.source ?? null,
    tags: body.tags,
  };
  const id = await docId(body.lang, body.text);
  const known = await deps.documents.has(id);
  const own = known ? await ownEntry(deps, id, user) : null;
  if (own === null) {
    if (!known) await deps.blobs.put(textKey(id), body.text, "text/plain; charset=utf-8");
    await deps.documents.add(
      { id, lang: body.lang, words: countWords(body.text) },
      { id, user: user.id, imported: timestamp(deps.now()), ...fields },
    );
  } else if (own.visibility === "private" && fields.visibility === "public") {
    await deps.documents.update(id, user.id, { ...fields, title: own.title, tags: own.tags });
  }
  const record = await ownEntry(deps, id, user);
  if (!record) throw new Error(`document ${id} vanished after insert`);
  if (known) {
    const summary = await current(deps, record, versionsOf(deps.blobs), user);
    if (summary.state !== "failed") return ok(summary);
  }
  const queued = await requeue(deps, record, await readStatus(deps.blobs, id), deps.now(), known ? "reimported" : "imported");
  return { status: 202, body: summarize(record, queued, user) };
}

/** A user changes the title, licence, author, source, visibility or tags of their own entry. */
export async function update(
  deps: Deps,
  user: User,
  id: string,
  body: z.output<typeof schemas.DocumentUpdate>,
): Promise<Ok<DocumentSummary> | Failed<400 | 403 | 404>> {
  const record = await findDocument(deps, id, user);
  if (!record) return noSuchDocument();
  if (record.user !== user.id) return fail(403, "only the document's importer can change it");
  const fields: EntryFields = {
    title: body.title ?? record.title,
    visibility: body.visibility ?? record.visibility,
    licence: body.licence ?? record.licence,
    author: body.author === undefined ? record.author : body.author || null,
    source: body.source === undefined ? record.source : body.source,
    tags: body.tags ?? record.tags,
  };
  if (fields.visibility === "public" && !isShareable(fields.licence)) {
    return fail(400, "a public text needs a licence that allows sharing it");
  }
  const unknown = await unknownTag(deps, fields.tags);
  if (unknown !== null) return unknown;
  await deps.documents.update(record.id, user.id, fields);
  return ok(await current(deps, { ...record, ...fields }, versionsOf(deps.blobs), user));
}

/** A user deletes their entry. The text, its analyses and bundles stay, so importing it
 * again needn't analyse it again. */
export async function remove(deps: Deps, user: User, id: string): Promise<NoContent | Failed<403 | 404>> {
  const record = await findDocument(deps, id, user);
  if (!record) return noSuchDocument();
  if (record.user !== user.id) return fail(403, "only the document's importer can delete it");
  await deps.documents.remove(record.id, user.id);
  return NO_CONTENT;
}

export async function get(deps: Deps, id: string, viewer: User | null): Promise<Ok<DocumentSummary> | Failed<404>> {
  const record = await findDocument(deps, id, viewer);
  if (!record) return noSuchDocument();
  const summary = await current(deps, record, versionsOf(deps.blobs), viewer);
  if (summary.mine && (summary.state === "queued" || summary.state === "analysing")) {
    summary.queue = placeIn(await deps.queue.jobs(record.lang), record.id);
  }
  return ok(summary);
}

/** No container running means one is about to start for this document. */
export function placeIn(jobs: IngestJobs | null, id: DocumentId): QueuePlace {
  if (jobs === null) return { starting: true, ahead: null };
  const index = [...jobs.running, ...jobs.waiting].indexOf(id);
  return { starting: jobs.loading, ahead: index < 0 ? null : index };
}

/** The id is the text's hash, so the text at this URL never changes. */
export async function text(
  deps: Deps,
  id: string,
  viewer: User | null,
  ifNoneMatch: string | undefined,
): Promise<BlobResult | NotModified | Failed<404 | 500>> {
  const record = await findDocument(deps, id, viewer);
  if (!record) return noSuchDocument();
  return stored(deps, textKey(record.id), undefined, ifNoneMatch, fail(500, "missing text"));
}

/** An analysis or bundle by name (DocumentSummary.reading): a name is a version, so
 * what's at the URL never changes, and the reader gets an analysis and bundle that
 * belong together. */
export async function part(
  deps: Deps,
  id: string,
  viewer: User | null,
  which: "analysis" | "bundle",
  name: string,
  ifNoneMatch: string | undefined,
): Promise<BlobResult | NotModified | Failed<404>> {
  const record = await findDocument(deps, id, viewer);
  if (!record || !NAME.test(name)) return noSuchDocument();
  return stored(deps, partKey(record.id, which, name), PART_ENCODING, ifNoneMatch, fail(404, `no ${which} ${name}`));
}

/** The blob at a key that never changes, or 304 without reading it when the client has it. */
async function stored<S extends ContentfulStatusCode>(
  deps: Deps,
  key: string,
  encoding: typeof PART_ENCODING | undefined,
  ifNoneMatch: string | undefined,
  missing: Failed<S>,
): Promise<BlobResult | NotModified | Failed<S>> {
  const etag = `"${key}"`;
  if (ifNoneMatch?.split(",").some((tag) => tag.trim().replace(/^W\//u, "") === etag)) return { status: 304, etag, encoding };
  const blob = await deps.blobs.get(key);
  return blob ? { status: 200, etag, blob, encoding } : missing;
}

function noSuchDocument(): Failed<404> {
  return fail(404, "no such document");
}

/** The entry the viewer sees: theirs, else a public one. A text private to others is
 * unknown to them. */
async function findDocument(deps: Deps, id: string, viewer: User | null): Promise<StoredDocument | null> {
  const parsed = schemas.DocumentId.safeParse(id);
  return parsed.success ? deps.documents.visible(parsed.data, viewer?.id ?? null) : null;
}

async function ownEntry(deps: Deps, id: DocumentId, user: User): Promise<StoredDocument | null> {
  const entry = await deps.documents.visible(id, user.id);
  return entry?.user === user.id ? entry : null;
}

/** The summary, after queueing the document again if ingest now produces other
 * versions, or if its job seems lost. */
async function current(deps: Deps, record: StoredDocument, versions: VersionsOf, viewer: User | null): Promise<DocumentSummary> {
  const status = await readStatus(deps.blobs, record.id);
  const now = deps.now();
  if (status !== null) {
    const reason = isStuck(status, now) ? "stuck" : isOutdated(status, await versions(record.lang)) ? "outdated" : null;
    if (reason !== null) return summarize(record, await requeue(deps, record, status, now, reason), viewer);
  }
  return summarize(record, status, viewer);
}

type RequeueReason = "imported" | "reimported" | "stuck" | "outdated";

/** Queue the document, keeping the last analysis readable until the new one is ready. */
async function requeue(
  deps: Deps,
  record: Pick<StoredDocument, "id" | "lang">,
  status: Status | null,
  at: Date,
  reason: RequeueReason,
): Promise<Status> {
  logger.info("queueing document", {
    doc: record.id,
    lang: record.lang,
    reason,
    previous: status?.state ?? null,
    since: status?.updated ?? null,
  });
  const queued: Status = { state: "queued", updated: timestamp(at) };
  for (const key of ["analyzer", "lexicon", "analysis", "bundle"] as const) {
    const value = status?.[key];
    if (value !== undefined) queued[key] = value;
  }
  await deps.blobs.put(statusKey(record.id), JSON.stringify(queued), JSON_TYPE);
  await deps.queue.send({ doc: record.id, lang: record.lang });
  return queued;
}

/** A ready document whose analysis or bundle isn't what ingest makes now. Unknown
 * until ingest has published its versions. */
export function isOutdated(status: Status, latest: Versions | null): boolean {
  if (status.state !== "ready" || latest === null) return false;
  return nameOf(status.analysis) !== latest.analysis || nameOf(status.bundle) !== latest.bundle;
}

/** Longer than any job takes (a text at the limit takes about a minute on a laptop),
 * so a document queued or analysing for this long has lost its job. Queueing it again is
 * safe: ingest reuses blobs that already exist. */
export const STUCK_AFTER_MS = 30 * 60 * 1000;

export function isStuck(status: Status, at: Date): boolean {
  if (status.state !== "queued" && status.state !== "analysing") return false;
  const updated = Date.parse(status.updated);
  return Number.isNaN(updated) || at.getTime() - updated > STUCK_AFTER_MS;
}

/** The name in a blob key: doc/{id}/analysis/{name}.json.br -> {name}. */
export function nameOf(key: string | undefined): string | undefined {
  return key?.match(/\/([^/]+)\.json\.br$/u)?.[1];
}

type VersionsOf = (lang: Lang) => Promise<Versions | null>;

/** Each language's versions, read once per request. Null until ingest has started and
 * published them; documents aren't queued again until then. */
function versionsOf(blobs: BlobStore): VersionsOf {
  const read = new Map<Lang, Promise<Versions | null>>();
  return (lang) => {
    let versions = read.get(lang);
    if (versions === undefined) {
      versions = blobs.get(versionsKey(lang)).then((blob) => (blob ? parseVersions(new TextDecoder().decode(blob.body)) : null));
      read.set(lang, versions);
    }
    return versions;
  };
}

/** Malformed JSON, or JSON that doesn't fit the schema, counts as missing. */
export function parseJson<T extends z.ZodType>(schema: T, raw: string): z.output<T> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseVersions(raw: string): Versions | null {
  return parseJson(schemas.Versions, raw);
}

function summarize({ user, importerName, ...record }: StoredDocument, status: Status | null, viewer: User | null): DocumentSummary {
  const summary: DocumentSummary = {
    ...record,
    importer: { id: user, name: importerName },
    mine: user === viewer?.id,
    state: status?.state ?? "failed",
  };
  const analysis = nameOf(status?.analysis);
  const bundle = nameOf(status?.bundle);
  if (analysis !== undefined && bundle !== undefined) summary.reading = { analysis, bundle };
  if (status === null) summary.error = "no status";
  else if (status.error !== undefined) summary.error = status.error;
  return summary;
}

export async function readStatus(blobs: BlobStore, id: DocumentId): Promise<Status | null> {
  const blob = await blobs.get(statusKey(id));
  if (!blob) return null;
  return parseStatus(new TextDecoder().decode(blob.body));
}

/** The status blob ingest writes. */
export function parseStatus(raw: string): Status | null {
  return parseJson(schemas.Status, raw);
}

export function countWords(text: string): number {
  return text.split(/\s+/u).filter((w) => /\p{L}/u.test(w)).length;
}

const TITLE_WORDS = 6;
const TITLE_CHARS = 60;

function firstWords(text: string): string {
  const all = text.trim().split(/\s+/u);
  const words = all.slice(0, TITLE_WORDS).join(" ");
  if (words.length > TITLE_CHARS) return `${words.slice(0, TITLE_CHARS)}…`;
  return all.length > TITLE_WORDS ? `${words}…` : words;
}
