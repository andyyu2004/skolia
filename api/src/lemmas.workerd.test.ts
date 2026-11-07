import assert from "node:assert/strict";
import { test } from "node:test";
import { ALICE, local, putLemma, setup, useLocal } from "./testing/app.ts";
import { ORIGIN } from "./testing/harness.ts";

useLocal();

test("a signed-in user's lemma statuses are set and listed, in their own Durable Object", async () => {
  const app = setup();
  const alice = await local.signUp(ALICE);
  const headers = await local.signIn(alice.id);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", { status: "learning" })).status, 204);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", { status: "known" })).status, 204);
  const listed = await app.request(`${ORIGIN}/api/me/lemmas`, { headers });
  assert.equal(listed.status, 200);
  const known = [{ lemmaId: "pl:pies:NOUN", status: "known", updated: "2026-11-04T00:00:00.000Z" }];
  assert.deepEqual(await listed.json(), known);
  assert.deepEqual(await local.env.USER.getByName(alice.id).lemmas(), known);
});

test("lemma statuses need a session, a {lang}:{lemma}:{upos} id and a known status", async () => {
  const app = setup();
  assert.equal((await app.request(`${ORIGIN}/api/me/lemmas`)).status, 401);
  assert.equal((await putLemma(app, undefined, "pl:pies:NOUN", { status: "known" })).status, 401);
  const headers = await local.signIn((await local.signUp(ALICE)).id);
  assert.equal((await putLemma(app, headers, "pies", { status: "known" })).status, 400);
  assert.equal((await putLemma(app, headers, "zz:pies:NOUN", { status: "known" })).status, 400);
  assert.equal((await putLemma(app, headers, "pl:pies:NOPE", { status: "known" })).status, 400);
  assert.equal((await putLemma(app, headers, "pl:i/lub:CCONJ", { status: "known" })).status, 204);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", { status: "mastered" })).status, 400);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", null)).status, 400);
});
