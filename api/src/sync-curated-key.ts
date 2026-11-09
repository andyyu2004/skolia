// sync-curated's API key (sync-curated.ts), as SQL for wrangler d1 execute: for the curated
// user (migrations/0006_user_type.sql), replacing its last key, so each run has its own
// and none is kept anywhere.
// usage: SYNC_CURATED_API_KEY=<key> node src/sync-curated-key.ts > key.sql
import { keyFromEnv, replaceKeySql } from "./api-keys.ts";

export const CURATED_USER = "curated";

// The key's id before the script was named sync-curated, deleted with each new key
const OLD_KEY_ID = "seed";

export function syncCuratedKeySql(key: string, at: string): string[] {
  return [`DELETE FROM "apikey" WHERE "id" = '${OLD_KEY_ID}';`, ...replaceKeySql("sync-curated", CURATED_USER, key, at)];
}

if (import.meta.main) {
  const key = keyFromEnv("SYNC_CURATED_API_KEY");
  if (key === null) {
    console.error("SYNC_CURATED_API_KEY must be 64 hex characters (openssl rand -hex 32)");
    process.exit(2);
  }
  console.log(syncCuratedKeySql(key, new Date().toISOString()).join("\n"));
}
