// skolia-api on Cloudflare Workers (api/wrangler.jsonc). Static assets (the reader) are
// served before the Worker runs, except for /api/*.
import type { IngestJob } from "@skolia/shared/schema";
import { createApp, parseImportCap } from "../app.ts";
import { NO_AUTH, createAuth } from "../auth.ts";
import type { Auth } from "../ports.ts";
import { CloudflareQueue, D1Documents, DurableObjectUsers, R2Blobs } from "./adapters.ts";
import type { User } from "./user.ts";

export { User } from "./user.ts";

/** Replaced at build time (wrangler.jsonc define, justfile deploy-web) */
declare const VERSION: string;

interface Env {
  DB: D1Database;
  USER: DurableObjectNamespace<User>;
  BLOBS: R2Bucket;
  INGEST: Queue<IngestJob>;
  /** Set by Terraform (var.max_imports_per_day) */
  MAX_IMPORTS_PER_DAY?: string;
  BASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

let auth: Auth | undefined;

function authFor(env: Env): Auth {
  if (auth) return auth;
  const { BASE_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env;
  if (!BASE_URL || !BETTER_AUTH_SECRET) {
    console.error("BASE_URL or BETTER_AUTH_SECRET isn't set; sign-in is off");
    auth = NO_AUTH;
  } else {
    const google = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } : undefined;
    if (!google) console.error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET isn't set; only API keys sign in");
    auth = createAuth({ database: env.DB, baseURL: BASE_URL, secret: BETTER_AUTH_SECRET, google });
  }
  return auth;
}

export default {
  fetch(request, env, ctx) {
    const maxImportsPerDay = parseImportCap(env.MAX_IMPORTS_PER_DAY);
    if (maxImportsPerDay === null) console.error("MAX_IMPORTS_PER_DAY isn't set; refusing imports");
    const app = createApp({
      auth: authFor(env),
      users: new DurableObjectUsers(env.USER),
      // Misconfigured: accept none rather than run uncapped
      maxImportsPerDay: maxImportsPerDay ?? 0,
      version: VERSION,
      documents: new D1Documents(env.DB),
      blobs: new R2Blobs(env.BLOBS),
      queue: new CloudflareQueue(env.INGEST),
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
