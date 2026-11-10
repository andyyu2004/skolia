import assert from "node:assert/strict";
import { test } from "node:test";
import { insertKeySql } from "./api-keys.ts";
import { API_KEY_HEADER, NO_AUTH, createAuth } from "./auth.ts";
import { SYSTEM_USER, e2eKeysSql } from "./e2e-keys.ts";
import { CURATED_USER, syncCuratedKeySql } from "./sync-curated-key.ts";
import { ALICE, TEXT, client, importText, importer, local, raw, setup, useLocal } from "./testing/app.ts";
import { ORIGIN, authConfig } from "./testing/harness.ts";
import { body, expectStatus } from "./testing/responses.ts";

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
  assert.equal((await client(app).me.$get()).status, 401);
  const alice = await local.signUp(ALICE);
  assert.deepEqual(await body("me", client(app, await local.signIn(alice.id)).me.$get()), alice);
});

test("after signing out the session's cookie signs nobody in", async () => {
  const app = setup();
  const headers = await local.signIn((await local.signUp(ALICE)).id);
  assert.equal((await client(app, headers).me.$get()).status, 200);
  const out = await raw(app, "POST", "/api/auth/sign-out", new Headers({ cookie: headers.get("cookie") ?? "", origin: ORIGIN }), {});
  assert.equal(out.status, 200);
  assert.equal((await client(app, headers).me.$get()).status, 401);
});

test("an expired session signs nobody in", async () => {
  const app = setup();
  const headers = await local.signIn((await local.signUp(ALICE)).id);
  assert.equal((await client(app, headers).me.$get()).status, 200);
  const expired = new Date(Date.now() - 1000).toISOString();
  await local.env.DB.prepare(`update session set "expiresAt" = ?`).bind(expired).run();
  assert.equal((await client(app, headers).me.$get()).status, 401);
});

test("without its configuration sign-in answers 503 and nobody is signed in", async () => {
  const app = setup({ auth: NO_AUTH });
  assert.equal((await raw(app, "POST", "/api/auth/sign-in/social", undefined, undefined)).status, 503);
  assert.equal((await client(app).me.$get()).status, 401);
});

test("the end-to-end tests' keys, as e2e-keys.ts writes them, sign in the system user and a new user; earlier ones don't", async () => {
  const app = setup();
  const keys = { system: "ab".repeat(32), user: "12".repeat(32) };
  const earlier = { system: "cd".repeat(32), user: "34".repeat(32) };
  const run = (k: typeof keys, at: string) => local.env.DB.batch(e2eKeysSql(k, at).map((q) => local.env.DB.prepare(q)));
  await run(earlier, "2026-11-04T00:00:00.000Z");
  const earlierUser = await whoIs(app, earlier.user);
  await run(keys, "2026-11-05T00:00:00.000Z");
  assert.equal(await whoIs(app, keys.system), SYSTEM_USER);
  const user = await whoIs(app, keys.user);
  assert.match(user ?? "", /^e2e-/);
  assert.notEqual(user, earlierUser);
  assert.equal((await importText(app, TEXT, { headers: { [API_KEY_HEADER]: keys.system }, visibility: "private" })).status, 202);
  // The keys and user they replaced
  assert.equal(await whoIs(app, earlier.system), null);
  assert.equal(await whoIs(app, earlier.user), null);
  assert.equal((await local.env.DB.prepare(`SELECT count(*) AS n FROM "user" WHERE "id" LIKE 'e2e-%'`).first<{ n: number }>())?.n, 1);
  assert.equal((await importText(app, "Inny tekst.", { headers: { [API_KEY_HEADER]: "ef".repeat(32) } })).status, 401);
});

async function whoIs(app: ReturnType<typeof setup>, key: string): Promise<string | null> {
  const me = await client(app, new Headers({ [API_KEY_HEADER]: key })).me.$get();
  if (me.status === 401) return null;
  assert.equal(me.status, 200);
  return (await me.json()).id;
}

test("sync-curated's key signs in the curated user, a system user; new end-to-end keys leave it", async () => {
  const app = setup();
  const key = "56".repeat(32);
  await local.env.DB.batch(syncCuratedKeySql(key, "2026-11-04T00:00:00.000Z").map((q) => local.env.DB.prepare(q)));
  await local.env.DB.batch(e2eKeysSql({ system: "ab".repeat(32), user: "12".repeat(32) }, "2026-11-05T00:00:00.000Z").map((q) => local.env.DB.prepare(q)));
  const me = await body("me", client(app, new Headers({ [API_KEY_HEADER]: key })).me.$get());
  assert.deepEqual([me.id, me.type], [CURATED_USER, "system"]);
});

test("a new sync-curated key deletes the key it had when it was the seed's", async () => {
  const app = setup();
  const old = "78".repeat(32);
  await local.env.DB.prepare(insertKeySql("seed", CURATED_USER, old, "2026-11-04T00:00:00.000Z")).run();
  await local.env.DB.batch(syncCuratedKeySql("56".repeat(32), "2026-11-10T00:00:00.000Z").map((q) => local.env.DB.prepare(q)));
  await expectStatus("me with the old key", client(app, new Headers({ [API_KEY_HEADER]: old })).me.$get(), 401);
});

test("signed-in users can't make API keys", async () => {
  const app = setup();
  for (const path of ["create", "list"]) {
    const headers = new Headers({ cookie: importer.get("cookie") ?? "", origin: ORIGIN });
    const response = await raw(app, path === "create" ? "POST" : "GET", `/api/auth/api-key/${path}`, headers, path === "create" ? {} : undefined);
    assert.equal(response.status, 404, path);
  }
  const { results } = await local.env.DB.prepare("select id from apikey").all();
  assert.deepEqual(results, []);
});
