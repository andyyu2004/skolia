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
import { docId, statusKey, textKey } from "@skolia/shared/keys";
import type { State, Status } from "@skolia/shared/schema";
import type { BlobStore, Decode, DocumentRecord, DocumentStore, JobQueue } from "./ports.ts";

export interface Deps {
  documents: DocumentStore;
  blobs: BlobStore;
  queue: JobQueue;
  decode: Decode;
  now?: () => Date;
}

const STATES: readonly State[] = ["queued", "analysing", "ready", "failed"];
const ID = /^[0-9a-f]{64}$/;
const MAX_TITLE_LENGTH = 200;
// A character is at most 4 UTF-8 bytes; JSON escaping (\n, \") can double a few more.
// The exact character limit is checked after parsing.
const MAX_BODY_BYTES = MAX_TEXT_LENGTH * 4 + 64 * 1024;
const JSON_TYPE = "application/json";

export function createApp(deps: Deps): Hono {
  const now = deps.now ?? (() => new Date());
  const app = new Hono();

  app.onError((error, c) => {
    console.error(error);
    return c.json<ApiError>({ error: "internal error" }, 500);
  });

  app.get("/api/documents", async (c) => {
    const records = await deps.documents.list();
    const documents = await Promise.all(records.map((r) => summarize(deps.blobs, r)));
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
      const summary = await summarize(deps.blobs, existing);
      // A failed import is retried by importing the same text again
      if (summary.state !== "failed") return c.json<DocumentSummary>(summary, 200);
    } else {
      await deps.blobs.put(textKey(id), request.text, "text/plain; charset=utf-8");
      await deps.documents.add({
        id,
        title: request.title,
        lang: request.lang,
        imported: now().toISOString(),
        words: countWords(request.text),
      });
    }
    const queued: Status = { state: "queued", updated: now().toISOString() };
    await deps.blobs.put(statusKey(id), JSON.stringify(queued), JSON_TYPE);
    await deps.queue.send({ doc: id, lang: request.lang });
    const record = existing ?? (await deps.documents.get(id));
    if (!record) throw new Error(`document ${id} vanished after insert`);
    return c.json<DocumentSummary>(await summarize(deps.blobs, record), 202);
  });

  app.get("/api/documents/:id", async (c) => {
    const record = await findDocument(deps, c.req.param("id"));
    if (!record) return notFound(c);
    return c.json<DocumentSummary>(await summarize(deps.blobs, record));
  });

  app.get("/api/documents/:id/text", async (c) => {
    const record = await findDocument(deps, c.req.param("id"));
    if (!record) return notFound(c);
    return sendBlob(c, deps.decode, await deps.blobs.get(textKey(record.id)));
  });

  for (const part of ["analysis", "bundle"] as const) {
    app.get(`/api/documents/:id/${part}`, async (c) => {
      const record = await findDocument(deps, c.req.param("id"));
      if (!record) return notFound(c);
      const status = await readStatus(deps.blobs, record.id);
      const key = status?.[part];
      if (status?.state !== "ready" || key === undefined) {
        return c.json<ApiError>({ error: `${part} not ready` }, 409);
      }
      return sendBlob(c, deps.decode, await deps.blobs.get(key));
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

async function sendBlob(
  c: Context,
  decode: Decode,
  blob: Awaited<ReturnType<BlobStore["get"]>>,
): Promise<Response> {
  if (!blob) return c.json<ApiError>({ error: "missing blob" }, 500);
  const headers: Record<string, string> = {
    "content-type": blob.contentType ?? "application/octet-stream",
    // Ids are content hashes and blob keys carry versions: a URL's content never changes
    "cache-control": "private, max-age=31536000, immutable",
  };
  const encoding = blob.contentEncoding;
  if (encoding === undefined) return new Response(blob.body, { headers });
  headers["vary"] = "accept-encoding";
  if (acceptsEncoding(c.req.header("accept-encoding"), encoding)) {
    headers["content-encoding"] = encoding;
    return new Response(blob.body, { headers });
  }
  return new Response(await decode(blob.body, encoding), { headers });
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

async function summarize(blobs: BlobStore, record: DocumentRecord): Promise<DocumentSummary> {
  const status = await readStatus(blobs, record.id);
  const summary: DocumentSummary = { ...record, state: status?.state ?? "failed" };
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
