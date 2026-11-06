import assert from "node:assert/strict";
import { test } from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { authOptions, createAuth } from "./auth.ts";
import { migratedDatabase, testConfig } from "./auth-testing.ts";

test("0002_auth.sql makes every table and column Better Auth expects", async () => {
  const { toBeCreated, toBeAdded } = await getMigrations(authOptions(testConfig(migratedDatabase())));
  assert.deepEqual(toBeCreated, []);
  assert.deepEqual(toBeAdded, []);
});

test("a forged session cookie signs nobody in", async () => {
  const auth = createAuth(testConfig(migratedDatabase()));
  assert.equal(await auth.user(new Headers()), null);
  assert.equal(await auth.user(new Headers({ cookie: "better-auth.session_token=forged" })), null);
});
