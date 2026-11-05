// skolia-api on Node, configured by environment variables (see DEVELOP.md):
//   SKOLIA_DB            SQLite file for document metadata
//   SKOLIA_REDIS_URL     ingest queue, e.g. redis://localhost:6379/0
//   SKOLIA_S3_BUCKET     blob bucket
//   SKOLIA_S3_ENDPOINT   S3 endpoint (RustFS locally)
//   SKOLIA_MAX_IMPORTS_PER_DAY   new texts accepted per UTC day (default 50)
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   S3 credentials
//   HOST, PORT           where to listen (default 127.0.0.1:8787)
import { promisify } from "node:util";
import { brotliDecompress as brotliDecompressCallback } from "node:zlib";
import { serve } from "@hono/node-server";
import { createApp, parseImportCap } from "../app.ts";
import { RedisQueue } from "./redis.ts";
import { S3Blobs } from "./s3.ts";
import { SqliteDocuments } from "./sqlite.ts";

const DEFAULT_PORT = 8787;
const brotliDecompress = promisify(brotliDecompressCallback);

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`skolia-api: set ${name}`);
    process.exit(1);
  }
  return value;
}

const maxImportsPerDay = parseImportCap(process.env["SKOLIA_MAX_IMPORTS_PER_DAY"] ?? "50");
if (maxImportsPerDay === null) {
  console.error("skolia-api: SKOLIA_MAX_IMPORTS_PER_DAY must be a whole number");
  process.exit(1);
}

const app = createApp({
  maxImportsPerDay,
  documents: new SqliteDocuments(env("SKOLIA_DB")),
  blobs: new S3Blobs(env("SKOLIA_S3_BUCKET"), process.env["SKOLIA_S3_ENDPOINT"] || undefined),
  queue: await RedisQueue.connect(env("SKOLIA_REDIS_URL")),
  decode: async (body, encoding) => {
    if (encoding === "br") return brotliDecompress(body);
    throw new Error(`can't decode content-encoding ${encoding}`);
  },
});

const hostname = process.env["HOST"] || "127.0.0.1";
const port = Number(process.env["PORT"] || DEFAULT_PORT);
serve({ fetch: app.fetch, hostname, port }, (info) => {
  console.log(`skolia-api listening on http://${info.address}:${info.port}`);
});
