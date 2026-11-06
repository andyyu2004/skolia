import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { migrationsSource } from "../../scripts/user-migrations.ts";

test("migrations.gen.ts is up to date with drizzle-kit's migrations (pnpm --dir api user-migrations)", () => {
  assert.equal(readFileSync(new URL("migrations.gen.ts", import.meta.url), "utf8"), migrationsSource());
});
