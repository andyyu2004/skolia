// The end-to-end tests' API keys, as SQL for wrangler d1 execute, so each run has its own and
// none is kept anywhere:
// - E2E_API_KEY, the system user's (migrations/0004_importer.sql), which imports. The
//   end-to-end tests' last key is replaced; the system user's other keys stay.
// - E2E_USER_KEY, a new user's, e2e-<time>, whose words and cards start empty, so the
//   card journeys see the same thing every run. Earlier runs' users and their keys are
//   deleted; their Durable Objects stay, a few rows each.
// usage: E2E_API_KEY=<key> E2E_USER_KEY=<key> node src/e2e-keys.ts > keys.sql
import { insertKeySql, keyFromEnv, replaceKeySql } from "./api-keys.ts";

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
    ...replaceKeySql("e2e", SYSTEM_USER, keys.system, at),
    // Cascades to their keys
    `DELETE FROM "user" WHERE "id" LIKE '${E2E_USER_PREFIX}%';`,
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES ('${user}', 'End-to-end test', '${user}@e2e.skolia.io', 0, NULL, '${at}', '${at}');`,
    insertKeySql(user, user, keys.user, at),
  ];
}

if (import.meta.main) {
  const [system, user] = [keyFromEnv("E2E_API_KEY"), keyFromEnv("E2E_USER_KEY")];
  if (system === null || user === null) {
    console.error("E2E_API_KEY and E2E_USER_KEY must be 64 hex characters (openssl rand -hex 32)");
    process.exit(2);
  }
  console.log(e2eKeysSql({ system, user }, new Date().toISOString()).join("\n"));
}
