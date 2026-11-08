// The seed's API key (seed.ts), as SQL for wrangler d1 execute: for the curated user
// (migrations/0006_user_type.sql), replacing the seed's last key, so each run has its own
// and none is kept anywhere.
// usage: SEED_API_KEY=<key> node src/seed-key.ts > key.sql
import { keyFromEnv, replaceKeySql } from "./api-keys.ts";

export const CURATED_USER = "curated";

export function seedKeySql(key: string, at: string): string[] {
  return replaceKeySql("seed", CURATED_USER, key, at);
}

if (import.meta.main) {
  const key = keyFromEnv("SEED_API_KEY");
  if (key === null) {
    console.error("SEED_API_KEY must be 64 hex characters (openssl rand -hex 32)");
    process.exit(2);
  }
  console.log(seedKeySql(key, new Date().toISOString()).join("\n"));
}
