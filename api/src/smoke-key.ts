// The smoke test's API keys, as SQL for wrangler d1 execute, so each run has its own and
// none is kept anywhere:
// - SMOKE_API_KEY, the system user's (migrations/0004_importer.sql), which imports. The key
//   it had is replaced.
// - SMOKE_USER_KEY, a new user's, smoke-<time>, whose words and cards start empty, so the
//   card journeys see the same thing every run. Earlier runs' users and their keys are
//   deleted; their Durable Objects stay, a few rows each.
// A key is stored as Better Auth's API key plugin stores it (SHA-256, base64url, unpadded).
// usage: SMOKE_API_KEY=<key> SMOKE_USER_KEY=<key> node src/smoke-key.ts > keys.sql
import { createHash } from "node:crypto";

export const SYSTEM_USER = "system";
const SMOKE_USER_PREFIX = "smoke-";

export interface SmokeKeys {
  /** The system user's key */
  system: string;
  /** The new smoke user's key */
  user: string;
}

export function smokeKeySql(keys: SmokeKeys, at: string): string[] {
  const user = `${SMOKE_USER_PREFIX}${Date.parse(at).toString(36)}`;
  return [
    `DELETE FROM "apikey" WHERE "referenceId" = '${SYSTEM_USER}';`,
    insertKey("smoke", SYSTEM_USER, keys.system, at),
    // Cascades to their keys
    `DELETE FROM "user" WHERE "id" LIKE '${SMOKE_USER_PREFIX}%';`,
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES ('${user}', 'Smoke test', '${user}@smoke.skolia.io', 0, NULL, '${at}', '${at}');`,
    insertKey(user, user, keys.user, at),
  ];
}

function insertKey(id: string, user: string, key: string, at: string): string {
  const hash = createHash("sha256").update(key).digest("base64url");
  return `INSERT INTO "apikey" ("id", "configId", "name", "referenceId", "key", "enabled", "rateLimitEnabled", "requestCount", "createdAt", "updatedAt")
     VALUES ('${id}', 'default', 'smoke test', '${user}', '${hash}', 1, 0, 0, '${at}', '${at}');`;
}

if (import.meta.main) {
  const keys = { system: process.env["SMOKE_API_KEY"], user: process.env["SMOKE_USER_KEY"] };
  if (!keys.system || !keys.user || ![keys.system, keys.user].every((k) => /^[0-9a-f]{64}$/.test(k))) {
    console.error("SMOKE_API_KEY and SMOKE_USER_KEY must be 64 hex characters (openssl rand -hex 32)");
    process.exit(2);
  }
  console.log(smokeKeySql({ system: keys.system, user: keys.user }, new Date().toISOString()).join("\n"));
}
