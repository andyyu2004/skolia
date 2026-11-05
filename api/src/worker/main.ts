// skolia-api on Cloudflare Workers (api/wrangler.jsonc). Static assets (the reader) are
// served before the Worker runs, except for /api/*.
import type { IngestJob } from "@skolia/shared/schema";
import { createApp, parseImportCap } from "../app.ts";
import { CloudflareQueue, D1Documents, R2Blobs } from "./adapters.ts";

interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  INGEST: Queue<IngestJob>;
  /** Set by Terraform (var.max_imports_per_day) */
  MAX_IMPORTS_PER_DAY?: string;
}

export default {
  fetch(request, env, ctx) {
    const maxImportsPerDay = parseImportCap(env.MAX_IMPORTS_PER_DAY);
    if (maxImportsPerDay === null) console.error("MAX_IMPORTS_PER_DAY isn't set; refusing imports");
    const app = createApp({
      // Misconfigured: accept none rather than run uncapped
      maxImportsPerDay: maxImportsPerDay ?? 0,
      documents: new D1Documents(env.DB),
      blobs: new R2Blobs(env.BLOBS),
      queue: new CloudflareQueue(env.INGEST),
      // Workers can't decompress Brotli, so a client that doesn't accept it is refused
      decode: null,
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
