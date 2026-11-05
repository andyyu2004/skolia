// skolia-api on Cloudflare Workers (api/wrangler.jsonc). Static assets (the reader) are
// served before the Worker runs, except for /api/*.
import type { IngestJob } from "@skolia/shared/schema";
import { createApp } from "../app.ts";
import { CloudflareQueue, D1Documents, R2Blobs } from "./adapters.ts";

interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  INGEST: Queue<IngestJob>;
}

export default {
  fetch(request, env, ctx) {
    const app = createApp({
      documents: new D1Documents(env.DB),
      blobs: new R2Blobs(env.BLOBS),
      queue: new CloudflareQueue(env.INGEST),
      // Workers can't decompress Brotli, so a client that doesn't accept it is refused
      decode: null,
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
