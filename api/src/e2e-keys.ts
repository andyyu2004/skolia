// The end-to-end tests' API keys, as SQL for wrangler d1 execute, so each run has its own and
// none is kept anywhere:
// - E2E_API_KEY, the system user's (migrations/0004_importer.sql), which imports. The key
//   it had is replaced.
// - E2E_USER_KEY, a new user's, e2e-<time>, whose words and cards start empty, so the
//   card journeys see the same thing every run. Earlier runs' users and their keys are
//   deleted; their Durable Objects stay, a few rows each.
// A key is stored as Better Auth's API key plugin stores it (SHA-256, base64url, unpadded).
// usage: E2E_API_KEY=<key> E2E_USER_KEY=<key> node src/e2e-keys.ts > keys.sql
import { createHash } from "node:crypto";

export const SYSTEM_USER = "system";
const E2E_USER_PREFIX = "e2e-";

export interface E2eKeys {
  /** The system user's key */
  system: string;
  /** The new e2e user's key */
  user: string;
}

export function e2eKeysSql(keys: E2eKeys, at: string): string[] {
  const user = `${E2E_USER_PREFIX}${Date.parse(at).toString(36)}`;
  return [
    `DELETE FROM "apikey" WHERE "referenceId" = '${SYSTEM_USER}';`,
    insertKey("e2e", SYSTEM_USER, keys.system, at),
    // Cascades to their keys
    `DELETE FROM "user" WHERE "id" LIKE '${E2E_USER_PREFIX}%';`,
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES ('${user}', 'End-to-end test', '${user}@e2e.skolia.io', 0, NULL, '${at}', '${at}');`,
    insertKey(user, user, keys.user, at),
  ];
}

function insertKey(id: string, user: string, key: string, at: string): string {
  const hash = createHash("sha256").update(key).digest("base64url");
  return `INSERT INTO "apikey" ("id", "configId", "name", "referenceId", "key", "enabled", "rateLimitEnabled", "requestCount", "createdAt", "updatedAt")
     VALUES ('${id}', 'default', 'end-to-end test', '${user}', '${hash}', 1, 0, 0, '${at}', '${at}');`;
}

if (import.meta.main) {
  const keys = { system: process.env["E2E_API_KEY"], user: process.env["E2E_USER_KEY"] };
  if (!keys.system || !keys.user || ![keys.system, keys.user].every((k) => /^[0-9a-f]{64}$/.test(k))) {
    console.error("E2E_API_KEY and E2E_USER_KEY must be 64 hex characters (openssl rand -hex 32)");
    process.exit(2);
  }
  console.log(e2eKeysSql({ system: keys.system, user: keys.user }, new Date().toISOString()).join("\n"));
}
