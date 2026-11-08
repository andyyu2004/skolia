// API keys written straight to D1, for scripts that call the API (e2e-keys.ts, seed-key.ts).
// A key is stored as Better Auth's API key plugin stores it (SHA-256, base64url, unpadded).
import { createHash } from "node:crypto";

/** SQL for wrangler d1 execute: the key with this id, for this user, replacing the last
 * one with the id. A user's other keys stay. */
export function replaceKeySql(id: string, user: string, key: string, at: string): string[] {
  return [`DELETE FROM "apikey" WHERE "id" = '${id}';`, insertKeySql(id, user, key, at)];
}

export function insertKeySql(id: string, user: string, key: string, at: string): string {
  const hash = createHash("sha256").update(key).digest("base64url");
  return `INSERT INTO "apikey" ("id", "configId", "name", "referenceId", "key", "enabled", "rateLimitEnabled", "requestCount", "createdAt", "updatedAt")
     VALUES ('${id}', 'default', '${id}', '${user}', '${hash}', 1, 0, 0, '${at}', '${at}');`;
}

/** The key in this environment variable, if it's 64 hex characters (openssl rand -hex 32). */
export function keyFromEnv(name: string): string | null {
  const key = process.env[name];
  return key !== undefined && /^[0-9a-f]{64}$/.test(key) ? key : null;
}
