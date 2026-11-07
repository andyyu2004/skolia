// A new API key for the system user (migrations/0004_importer.sql), for the smoke test, as
// SQL for wrangler d1 execute: the key it had is replaced, so each run has its own and none
// is kept anywhere. The key is
// stored as Better Auth's API key plugin stores it (SHA-256, base64url, unpadded).
// usage: SMOKE_API_KEY=<key> node src/smoke-key.ts > key.sql
import { createHash } from "node:crypto";

export const SYSTEM_USER = "system";

export function smokeKeySql(key: string, at: string): string[] {
  const hash = createHash("sha256").update(key).digest("base64url");
  return [
    `DELETE FROM "apikey" WHERE "referenceId" = '${SYSTEM_USER}';`,
    `INSERT INTO "apikey" ("id", "configId", "name", "referenceId", "key", "enabled", "rateLimitEnabled", "requestCount", "createdAt", "updatedAt")
     VALUES ('smoke', 'default', 'smoke test', '${SYSTEM_USER}', '${hash}', 1, 0, 0, '${at}', '${at}');`,
  ];
}

if (import.meta.main) {
  const key = process.env["SMOKE_API_KEY"];
  if (!key || !/^[0-9a-f]{64}$/.test(key)) {
    console.error("SMOKE_API_KEY must be 64 hex characters (openssl rand -hex 32)");
    process.exit(2);
  }
  console.log(smokeKeySql(key, new Date().toISOString()).join("\n"));
}
