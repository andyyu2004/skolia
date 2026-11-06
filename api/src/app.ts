import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import {
  LANGS,
  MAX_TEXT_LENGTH,
  type ApiError,
  type DocumentList,
  type DocumentSummary,
  type ImportRequest,
  type Lang,
} from "@skolia/shared/api";
import { PART_ENCODING, docId, partKey, statusKey, textKey, versionsKey } from "@skolia/shared/keys";
import type { State, Status, Versions } from "@skolia/shared/schema";
import type { BlobStore, DocumentRecord, DocumentStore, JobQueue, StoredBlob } from "./ports.ts";

export interface Deps {
  documents: DocumentStore;
  blobs: BlobStore;
  queue: JobQueue;
  /** New texts accepted per UTC day, across everyone: analysis time is what costs
   * money. Importing a text that's already here doesn't count. */
  maxImportsPerDay: number;
  now?: () => Date;
}

const STATES: readonly State[] = ["queued", "analysing", "ready", "failed"];
const ID = /^[0-9a-f]{64}$/;
const MAX_TITLE_LENGTH = 200;
// A character is at most 6 bytes in JSON (\uXXXX), plus room for the title. The exact
// character limit is checked after parsing.
const MAX_BODY_BYTES = MAX_TEXT_LENGTH * 6 + 4 * 1024;
const JSON_TYPE = "application/json";

export function createApp(deps: Deps): Hono {
  const now = deps.now ?? (() => new Date());
  const app = new Hono();

  app.onError((error, c) => {
    console.error(error);
    return c.json<ApiError>({ error: "internal error" }, 500);
  });

  /** The summary, after queueing the document again if ingest now produces other
   * versions, or if its job seems lost. */
  async function current(record: DocumentRecord, versions: VersionsOf): Promise<DocumentSummary> {
    const status = await readStatus(deps.blobs, record.id);
    if (status !== null && (isStuck(status, now()) || isOutdated(status, await versions(record.lang)))) {
      return summarize(record, await requeue(deps, record, status, now()));
    }
    return summarize(record, status);
  }

  app.get("/api/documents", async (c) => {
    const records = await deps.documents.list();
    const versions = versionsOf(deps.blobs);
    const documents = await Promise.all(records.map((r) => current(r, versions)));
    return c.json<DocumentList>({ documents });
  });

  // Stop reading an oversized body early instead of parsing it and then refusing it
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json<ApiError>({ error: `text is longer than ${MAX_TEXT_LENGTH} characters` }, 413),
  });

  app.post("/api/documents", limit, async (c) => {
    const request = parseImport(await c.req.json().catch(() => null));
    if (typeof request === "string") return c.json<ApiError>({ error: request }, 400);
    const id = await docId(request.text);
    const existing = await deps.documents.get(id);
    if (existing) {
      const summary = await current(existing, versionsOf(deps.blobs));
      // A failed import is retried by importing the same text again
      if (summary.state !== "failed") return c.json<DocumentSummary>(summary, 200);
    } else {
      const today = now().toISOString().slice(0, 10);
      if ((await deps.documents.countImportedSince(today)) >= deps.maxImportsPerDay) {
        return c.json<ApiError>({ error: "Today's imports are used up. Try again tomorrow." }, 429);
      }
      await deps.blobs.put(textKey(id), request.text, "text/plain; charset=utf-8");
      await deps.documents.add({
        id,
        title: request.title,
        lang: request.lang,
        imported: now().toISOString(),
        words: countWords(request.text),
      });
    }
    const record = existing ?? (await deps.documents.get(id));
    if (!record) throw new Error(`document ${id} vanished after insert`);
    const queued = await requeue(deps, record, await readStatus(deps.blobs, id), now());
    return c.json<DocumentSummary>(summarize(record, queued), 202);
  });

  app.get("/api/documents/:id", async (c) => {
    const record = await findDocument(deps, c.req.param("id"));
    if (!record) return notFound(c);
    return c.json<DocumentSummary>(await current(record, versionsOf(deps.blobs)));
  });

  app.get("/api/documents/:id/text", async (c) => {
    const record = await findDocument(deps, c.req.param("id"));
    if (!record) return notFound(c);
    // The id is the text's hash, so the text at this URL never changes
    const blob = await deps.blobs.get(textKey(record.id));
    if (!blob) return c.json<ApiError>({ error: "missing text" }, 500);
    return sendBlob(c, blob, undefined);
  });

  // By name (DocumentSummary.reading): a name is a version, so what's at the URL never
  // changes, and the reader gets an analysis and bundle that belong together
  for (const part of ["analysis", "bundle"] as const) {
    app.get(`/api/documents/:id/${part}/:name`, async (c) => {
      const record = await findDocument(deps, c.req.param("id"));
      const name = c.req.param("name");
      if (!record || !NAME.test(name)) return notFound(c);
      const blob = await deps.blobs.get(partKey(record.id, part, name));
      if (!blob) return c.json<ApiError>({ error: `no ${part} ${name}` }, 404);
      return sendBlob(c, blob, PART_ENCODING);
    });
  }

  return app;
}

async function findDocument(deps: Deps, id: string): Promise<DocumentRecord | null> {
  return ID.test(id) ? deps.documents.get(id) : null;
}

function notFound(c: Context): Response {
  return c.json<ApiError>({ error: "no such document" }, 404);
}

/** A blob whose URL names its version, so it can be cached forever. encoding: how the
 * blob is stored (PART_ENCODING for an analysis or bundle). Workers can't decompress
 * Brotli, so a client that doesn't accept the encoding gets 406 (browsers all accept br). */
function sendBlob(c: Context, blob: StoredBlob, encoding: typeof PART_ENCODING | undefined): Response {
  const headers: Record<string, string> = {
    "content-type": blob.contentType ?? "application/octet-stream",
    "cache-control": "private, max-age=31536000, immutable",
  };
  if (encoding === undefined) return new Response(blob.body, { headers });
  headers["vary"] = "accept-encoding";
  if (acceptsEncoding(c.req.header("accept-encoding"), encoding)) {
    headers["content-encoding"] = encoding;
    // Workers otherwise compress the body again by its content-encoding; Node ignores it
    const init: ResponseInit & { encodeBody: "manual" } = { headers, encodeBody: "manual" };
    return new Response(blob.body, init);
  }
  return c.json<ApiError>({ error: `needs Accept-Encoding: ${encoding}` }, 406);
}

/** Whether an Accept-Encoding header ("gzip, deflate, br;q=0.8") allows the encoding. */
export function acceptsEncoding(header: string | undefined, encoding: string): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name !== encoding && name !== "*") return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

/** Queue the document, keeping the last analysis readable until the new one is ready. */
async function requeue(deps: Deps, record: DocumentRecord, status: Status | null, at: Date): Promise<Status> {
  const queued: Status = { state: "queued", updated: at.toISOString() };
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

/** A daily import cap from configuration: a whole number, at least 0. Null if it isn't
 * one, so the caller can refuse to start rather than run uncapped. */
export function parseImportCap(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
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

const NAME = /^[a-z0-9-]{1,64}$/;

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

export function parseVersions(raw: string): Versions | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { analyzer, lexicon, analysis, bundle } = value;
  if (typeof analyzer !== "string" || typeof lexicon !== "string") return null;
  if (typeof analysis !== "string" || typeof bundle !== "string") return null;
  return { analyzer, lexicon, analysis, bundle };
}

function summarize(record: DocumentRecord, status: Status | null): DocumentSummary {
  const summary: DocumentSummary = { ...record, state: status?.state ?? "failed" };
  const analysis = nameOf(status?.analysis);
  const bundle = nameOf(status?.bundle);
  if (analysis !== undefined && bundle !== undefined) summary.reading = { analysis, bundle };
  if (status === null) summary.error = "no status";
  else if (status.error !== undefined) summary.error = status.error;
  return summary;
}

export async function readStatus(blobs: BlobStore, id: string): Promise<Status | null> {
  const blob = await blobs.get(statusKey(id));
  if (!blob) return null;
  return parseStatus(new TextDecoder().decode(blob.body));
}

/** The status blob ingest writes; anything malformed counts as missing. */
export function parseStatus(raw: string): Status | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { state, updated } = value;
  if (!isState(state) || typeof updated !== "string") return null;
  const status: Status = { state, updated };
  for (const key of ["analyzer", "lexicon", "analysis", "bundle", "error"] as const) {
    const field = value[key];
    if (typeof field === "string") status[key] = field;
  }
  return status;
}

/** The request body, or a message saying what's wrong with it. */
export function parseImport(body: unknown): ImportRequest | string {
  if (!isRecord(body)) return "expected a JSON object";
  const { title, text, lang } = body;
  if (typeof text !== "string" || text.trim() === "") return "text must be a non-empty string";
  if (text.length > MAX_TEXT_LENGTH) return `text is longer than ${MAX_TEXT_LENGTH} characters`;
  if (!isLang(lang)) return `lang must be one of ${LANGS.join(", ")}`;
  const cleanTitle = typeof title === "string" ? title.trim().slice(0, MAX_TITLE_LENGTH) : "";
  return { title: cleanTitle || firstWords(text), text, lang };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isState(value: unknown): value is State {
  return STATES.some((s) => s === value);
}

function isLang(value: unknown): value is Lang {
  return LANGS.some((l) => l === value);
}
