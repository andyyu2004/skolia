// The API's routes. Each extracts and validates a request's input, calls a controller
// (src/controllers/), which takes data and returns a Result, and sends that.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { Context, TypedResponse } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { JSONParsed } from "hono/utils/types";
import { zValidator } from "@hono/zod-validator";
import * as z from "zod";
import { LANGS, MAX_TEXT_LENGTH, type ApiError, type User, type Version } from "@skolia/shared/api";
import * as schemas from "@skolia/shared/schemas";
import * as cards from "./controllers/cards.ts";
import * as documents from "./controllers/documents.ts";
import * as positions from "./controllers/positions.ts";
import { fail, ok, type BlobResult, type Failed, type NotModified, type Result } from "./controllers/result.ts";
import { log } from "./log.ts";
import type { Deps } from "./ports.ts";

const logger = log("api");

// A character is at most 6 bytes in JSON (\uXXXX), plus room for the title. The exact
// character limit is checked after parsing.
const MAX_BODY_BYTES = MAX_TEXT_LENGTH * 6 + 4 * 1024;
const DOCUMENT_ID_MESSAGE = "document id must be 64 lowercase hex characters";
const LEMMA_ID_MESSAGE = `lemma id must be {lang}:{lemma}:{upos}, lang one of ${LANGS.join(", ")}`;

export type AppType = ReturnType<typeof createApp>;

export function createApp(deps: Deps) {
  // Stop reading an oversized body early instead of parsing it and then refusing it
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: `text is longer than ${MAX_TEXT_LENGTH} characters` } satisfies ApiError, 413),
  });

  /** The controller's result for the signed-in user, or 401. */
  async function signedIn<R extends Result>(c: Context, run: (user: User) => Promise<R>, message = "not signed in"): Promise<Sent<R | Failed<401>>> {
    const user = await deps.auth.user(c.req.raw.headers);
    return send<R | Failed<401>>(c, user ? await run(user) : fail(401, message));
  }

  const app = new Hono()
    .onError((error, c) => {
      if (error instanceof HTTPException && error.status < 500) {
        return c.json({ error: error.message } satisfies ApiError, error.status);
      }
      logger.error("request failed", { method: c.req.method, path: c.req.path, error });
      return c.json({ error: "internal error" } satisfies ApiError, 500);
    })
    .get("/api/version", (c) => c.json({ version: deps.version } satisfies Version, 200))
    .on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handle(c.req.raw))
    .get("/api/me", (c) => signedIn(c, async (user) => ok(user)))
    .get("/api/me/words", (c) => signedIn(c, (user) => cards.words(deps, user)))
    .put(
      "/api/me/words/:lemmaId",
      zValidator("param", z.object({ lemmaId: schemas.LemmaId }), badRequest(LEMMA_ID_MESSAGE)),
      zValidator("json", schemas.SetWord, badRequest()),
      (c) => signedIn(c, (user) => cards.setWord(deps, user, c.req.valid("param").lemmaId, c.req.valid("json").status)),
    )
    .get("/api/me/cards/counts", zValidator("query", schemas.CountsQuery, badRequest("dayStart must be an ISO time")), (c) =>
      signedIn(c, (user) => cards.counts(deps, user, c.req.valid("query").dayStart)),
    )
    .get("/api/me/cards/due", zValidator("query", schemas.DueQuery, badRequest("lang must be a language and dayStart an ISO time")), (c) => {
      const { lang, dayStart } = c.req.valid("query");
      return signedIn(c, (user) => cards.due(deps, user, lang, dayStart));
    })
    .post("/api/me/reviews", zValidator("json", schemas.ReviewRequest, badRequest()), (c) =>
      signedIn(c, (user) => cards.review(deps, user, c.req.valid("json"))),
    )
    .post("/api/me/clozes", zValidator("json", schemas.NewCloze, badRequest()), (c) =>
      signedIn(c, (user) => cards.makeCloze(deps, user, c.req.valid("json"))),
    )
    .get("/api/me/clozes", zValidator("query", schemas.ClozesQuery, badRequest(DOCUMENT_ID_MESSAGE)), (c) =>
      signedIn(c, (user) => cards.clozes(deps, user, c.req.valid("query").documentId)),
    )
    .delete("/api/me/clozes/:cardId", zValidator("param", z.object({ cardId: schemas.CardId }), badRequest("card id must be a UUID")), (c) =>
      signedIn(c, (user) => cards.deleteCloze(deps, user, c.req.valid("param").cardId)),
    )
    .get("/api/me/positions/:id", zValidator("param", z.object({ id: schemas.DocumentId }), badRequest(DOCUMENT_ID_MESSAGE)), (c) =>
      signedIn(c, (user) => positions.get(deps, user, c.req.valid("param").id)),
    )
    .put(
      "/api/me/positions/:id",
      zValidator("param", z.object({ id: schemas.DocumentId }), badRequest(DOCUMENT_ID_MESSAGE)),
      zValidator("json", schemas.ReadingPosition, badRequest()),
      (c) => signedIn(c, (user) => positions.set(deps, user, c.req.valid("param").id, c.req.valid("json"))),
    )
    .get("/api/me/documents", (c) => signedIn(c, (user) => documents.mine(deps, user)))
    .get("/api/me/settings", (c) => signedIn(c, (user) => cards.settings(deps, user)))
    .put("/api/me/settings", zValidator("json", schemas.Settings, badRequest()), (c) =>
      signedIn(c, (user) => cards.setSettings(deps, user, c.req.valid("json"))),
    )
    .post("/api/lexicon/entries", zValidator("json", schemas.LookupRequest, badRequest()), async (c) =>
      send(c, await cards.lookUp(deps, c.req.valid("json").ids)),
    )
    .get("/api/documents", zValidator("query", schemas.DocumentsQuery, badRequest()), async (c) =>
      send(c, await documents.list(deps, await deps.auth.user(c.req.raw.headers), c.req.valid("query").tag ?? {})),
    )
    .get("/api/tags", async (c) => send(c, await documents.tags(deps)))
    .post("/api/documents", limit, zValidator("json", schemas.ImportRequest, badRequest()), (c) =>
      signedIn(c, (user) => documents.importText(deps, user, c.req.valid("json")), "sign in to import"),
    )
    .get("/api/documents/:id", async (c) =>
      send(c, await documents.get(deps, c.req.param("id"), await deps.auth.user(c.req.raw.headers))),
    )
    .patch("/api/documents/:id", zValidator("json", schemas.DocumentUpdate, badRequest()), (c) =>
      signedIn(c, (user) => documents.update(deps, user, c.req.param("id"), c.req.valid("json"))),
    )
    .delete("/api/documents/:id", (c) => signedIn(c, (user) => documents.remove(deps, user, c.req.param("id"))))
    .get("/api/documents/:id/text", async (c) =>
      send(c, await documents.text(deps, c.req.param("id"), await deps.auth.user(c.req.raw.headers), c.req.header("if-none-match"))),
    )
    .get("/api/documents/:id/analysis/:name", async (c) =>
      send(c, await documents.part(deps, c.req.param("id"), await deps.auth.user(c.req.raw.headers), "analysis", c.req.param("name"), c.req.header("if-none-match"))),
    )
    .get("/api/documents/:id/bundle/:name", async (c) =>
      send(c, await documents.part(deps, c.req.param("id"), await deps.auth.user(c.req.raw.headers), "bundle", c.req.param("name"), c.req.header("if-none-match"))),
    );

  return app;
}

/** The response for a result, typed by its status so the typed client (hono/client)
 * knows each status's body. */
type Sent<R> = R extends BlobResult | NotModified
  ? Response
  : R extends { status: 204 }
    ? Response & TypedResponse<null, 204, "body">
    : R extends { status: infer S extends ContentfulStatusCode; body: infer B }
      ? Response & TypedResponse<JSONParsed<B>, S, "json">
      : never;

function send<R extends Result>(c: Context, result: R): Sent<R> {
  if ("etag" in result) return sendBlob(c, result) as Sent<R>;
  if (!("body" in result)) return c.body(null, 204) as Sent<R>;
  return c.json(result.body as object, result.status) as unknown as Sent<R>;
}

/** Workers can't decompress Brotli, so a client that doesn't accept a blob's encoding
 * gets 406 (browsers all accept br). no-cache: the browser keeps its copy, and asks
 * before each use whether it may still see it (BlobResult). */
function sendBlob(c: Context, result: BlobResult | NotModified): Response {
  const { etag, encoding } = result;
  const cached = { etag, "cache-control": "private, no-cache", ...(encoding === undefined ? {} : { vary: "accept-encoding" }) };
  if (result.status === 304) return new Response(null, { status: 304, headers: cached });
  const { blob } = result;
  const headers: Record<string, string> = { ...cached, "content-type": blob.contentType ?? "application/octet-stream" };
  if (encoding === undefined) return new Response(blob.body, { headers });
  if (acceptsEncoding(c.req.header("accept-encoding"), encoding)) {
    headers["content-encoding"] = encoding;
    // Workers otherwise compress the body again by its content-encoding; Node ignores it
    const init: ResponseInit & { encodeBody: "manual" } = { headers, encodeBody: "manual" };
    return new Response(blob.body, init);
  }
  return c.json({ error: `needs Accept-Encoding: ${encoding}` } satisfies ApiError, 406);
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

/** A 400 with the first problem the schema found, or `message` in its place. */
function badRequest(message?: string) {
  return (result: { success: true } | { success: false; error: z.core.$ZodError }, c: Context) => {
    if (result.success) return undefined;
    return c.json({ error: message ?? result.error.issues[0]?.message ?? "invalid request" } satisfies ApiError, 400);
  };
}
