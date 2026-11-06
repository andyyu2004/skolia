import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { authOptions, createAuth, type AuthConfig } from "./auth.ts";

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0002_auth.sql", import.meta.url), "utf8"));
  return db;
}

function config(database: DatabaseSync): AuthConfig {
  return {
    database,
    baseURL: "http://localhost:5173",
    secret: "a test secret that is at least 32 characters",
    google: { clientId: "id", clientSecret: "secret" },
  };
}

test("0002_auth.sql makes every table and column Better Auth expects", async () => {
  const { toBeCreated, toBeAdded } = await getMigrations(authOptions(config(migrated())));
  assert.deepEqual(toBeCreated, []);
  assert.deepEqual(toBeAdded, []);
});

test("nobody is signed in without a session cookie", async () => {
  const auth = createAuth(config(migrated()));
  assert.equal(await auth.user(new Headers()), null);
  assert.equal(await auth.user(new Headers({ cookie: "better-auth.session_token=forged" })), null);
});

test("Google sign-in answers with Google's authorize URL", async () => {
  const auth = createAuth(config(migrated()));
  const response = await auth.handle(
    new Request("http://localhost:5173/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    }),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { url: string; redirect: boolean };
  const url = new URL(body.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:5173/api/auth/callback/google");
});
