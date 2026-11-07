import assert from "node:assert/strict";
import { test } from "node:test";
import { API_KEY_HEADER, NO_AUTH, createAuth } from "./auth.ts";
import { SYSTEM_USER, smokeKeySql } from "./smoke-key.ts";
import { ALICE, TEXT, importText, importer, local, setup, useLocal } from "./testing/app.ts";
import { ORIGIN, authConfig } from "./testing/harness.ts";

useLocal();

test("a forged session cookie signs nobody in", async () => {
  const auth = createAuth(authConfig(local.env.DB));
  assert.equal(await auth.user(new Headers()), null);
  assert.equal(await auth.user(new Headers({ cookie: "better-auth.session_token=forged" })), null);
});

test("Google sign-in answers with Google's authorize URL, back to /api/auth/callback/google", async () => {
  const response = await setup().request(`${ORIGIN}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ provider: "google", callbackURL: "/" }),
  });
  assert.equal(response.status, 200);
  const url = new URL(((await response.json()) as { url: string }).url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("redirect_uri"), `${ORIGIN}/api/auth/callback/google`);
});

test("/api/me is the session's user, 401 without one", async () => {
  const app = setup();
  assert.equal((await app.request(`${ORIGIN}/api/me`)).status, 401);
  const alice = await local.signUp(ALICE);
  const response = await app.request(`${ORIGIN}/api/me`, { headers: await local.signIn(alice.id) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), alice);
});

test("after signing out the session's cookie signs nobody in", async () => {
  const app = setup();
  const headers = await local.signIn((await local.signUp(ALICE)).id);
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 200);
  const out = await app.request(`${ORIGIN}/api/auth/sign-out`, {
    method: "POST",
    headers: { cookie: headers.get("cookie") ?? "", "content-type": "application/json", origin: ORIGIN },
    body: "{}",
  });
  assert.equal(out.status, 200);
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 401);
});

test("an expired session signs nobody in", async () => {
  const app = setup();
  const headers = await local.signIn((await local.signUp(ALICE)).id);
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 200);
  const expired = new Date(Date.now() - 1000).toISOString();
  await local.env.DB.prepare(`update session set "expiresAt" = ?`).bind(expired).run();
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 401);
});

test("without its configuration sign-in answers 503 and nobody is signed in", async () => {
  const app = setup({ auth: NO_AUTH });
  assert.equal((await app.request(`${ORIGIN}/api/auth/sign-in/social`, { method: "POST" })).status, 503);
  assert.equal((await app.request(`${ORIGIN}/api/me`)).status, 401);
});

test("the system user's API key, as smoke-key.ts writes it, signs it in; others don't", async () => {
  const app = setup();
  const key = "ab".repeat(32);
  const run = (k: string) => local.env.DB.batch(smokeKeySql(k, "2026-11-04T00:00:00.000Z").map((q) => local.env.DB.prepare(q)));
  await run("cd".repeat(32));
  await run(key);
  const me = await app.request(`${ORIGIN}/api/me`, { headers: { [API_KEY_HEADER]: key } });
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as { id: string }).id, SYSTEM_USER);
  assert.equal((await importText(app, TEXT, { headers: { [API_KEY_HEADER]: key }, visibility: "private" })).status, 202);
  // The key it replaced
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers: { [API_KEY_HEADER]: "cd".repeat(32) } })).status, 401);
  assert.equal((await importText(app, "Inny tekst.", { headers: { [API_KEY_HEADER]: "ef".repeat(32) } })).status, 401);
});

test("signed-in users can't make API keys", async () => {
  const app = setup();
  for (const path of ["create", "list"]) {
    const response = await app.request(`${ORIGIN}/api/auth/api-key/${path}`, {
      method: path === "create" ? "POST" : "GET",
      headers: { cookie: importer.get("cookie") ?? "", "content-type": "application/json", origin: ORIGIN },
      ...(path === "create" ? { body: "{}" } : {}),
    });
    assert.equal(response.status, 404, path);
  }
  const { results } = await local.env.DB.prepare("select id from apikey").all();
  assert.deepEqual(results, []);
});
