// skolia-api on Cloudflare Workers (api/wrangler.jsonc). Static assets (the reader) are
// served before the Worker runs, except for /api/*.
import type { IngestJob } from "@skolia/shared/schema";
import { createApp } from "../app.ts";
import { NO_AUTH, createAuth } from "../auth.ts";
import { log } from "../log.ts";
import type { Auth } from "../ports.ts";
import { CloudflareQueue, D1Documents, D1Lexicon, DurableObjectUsers, R2Blobs, lexiconsOf, type LexiconBindings } from "./adapters.ts";
import type { Ingester } from "./ingest.ts";
import type { User } from "./user.ts";

export { User } from "./user.ts";

const logger = log("api");

/** Replaced at build time (wrangler.jsonc define, justfile deploy-web) */
declare const VERSION: string;

interface Env extends LexiconBindings {
  DB: D1Database;
  USER: DurableObjectNamespace<User>;
  BLOBS: R2Bucket;
  INGEST: Queue<IngestJob>;
  /** The ingest Worker's (worker/ingest.ts), for where a document is in its queue */
  INGESTER: DurableObjectNamespace<Ingester>;
  /** wrangler vars (api/wrangler.jsonc); a preview's from infra/preview.py */
  BASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

/** A Better Auth instance per request: it sets itself up on first use and keeps that
 * promise, and a request that awaits a promise made in another can hang on Workers (in
 * pr-16's smoke tests, one of two concurrent first requests got no response). */
let warned = false;

function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  logger.warn(message);
}

function authFor(env: Env): Auth {
  const { BASE_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env;
  if (!BASE_URL || !BETTER_AUTH_SECRET) {
    warnOnce("BASE_URL or BETTER_AUTH_SECRET isn't set; sign-in is off");
    return NO_AUTH;
  }
  const google = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } : undefined;
  if (!google) warnOnce("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET isn't set; only API keys sign in");
  return createAuth({ database: env.DB, baseURL: BASE_URL, secret: BETTER_AUTH_SECRET, google });
}

export default {
  fetch(request, env, ctx) {
    const app = createApp({
      auth: authFor(env),
      users: new DurableObjectUsers(env.USER),
      lexicon: new D1Lexicon(lexiconsOf(env)),
      version: VERSION,
      documents: new D1Documents(env.DB),
      blobs: new R2Blobs(env.BLOBS),
      queue: new CloudflareQueue(env.INGEST, (lang) => env.INGESTER.getByName(lang).jobs(lang)),
      now: () => new Date(),
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
