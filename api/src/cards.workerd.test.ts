import assert from "node:assert/strict";
import { test } from "node:test";
import type { Due, LexiconEntry, Reviewed, Settings, Word } from "@skolia/shared/api";
import { ALICE, NOW, loadLexicon, local, lookUp, postReview, putSettings, putWord, setup, useLocal, type App } from "./testing/app.ts";
import { ORIGIN } from "./testing/harness.ts";

useLocal();

const DAY_START = "2026-11-03T23:00:00.000Z";

async function signedIn(): Promise<Headers> {
  return local.signIn((await local.signUp(ALICE)).id);
}

async function due(app: App, headers: Headers, dayStart = DAY_START): Promise<Due> {
  const response = await app.request(`${ORIGIN}/api/me/cards/due?dayStart=${encodeURIComponent(dayStart)}`, { headers });
  assert.equal(response.status, 200);
  return (await response.json()) as Due;
}

async function words(app: App, headers: Headers): Promise<Word[]> {
  return (await (await app.request(`${ORIGIN}/api/me/words`, { headers })).json()) as Word[];
}

function answer(cardId: string, rating: number, at = NOW) {
  return { id: crypto.randomUUID(), cardId, rating, at };
}

test("an active word gets a recognition and a production card, new and due now, with its lexicon entry", async () => {
  const app = setup();
  const headers = await signedIn();
  await loadLexicon("pl", "lex/1", [{ lemmaId: "pl:pies:NOUN", lemma: "pies", upos: "NOUN", gloss: "dog" }]);
  assert.equal((await putWord(app, headers, "pl:pies:NOUN", { status: "active" })).status, 204);
  assert.equal((await putWord(app, headers, "pl:pies:NOUN", { status: "active" })).status, 204);
  assert.equal((await putWord(app, headers, "pl:kot:NOUN", { status: "active" })).status, 204);
  const { cards, newLeft } = await due(app, headers);
  assert.equal(newLeft, 20);
  assert.deepEqual(
    cards.map((c) => [c.lemmaId, c.kind, c.isNew, c.entry?.senses[0]?.gloss ?? null]),
    [
      ["pl:kot:NOUN", "recognition", true, null],
      ["pl:kot:NOUN", "production", true, null],
      ["pl:pies:NOUN", "recognition", true, "dog"],
      ["pl:pies:NOUN", "production", true, "dog"],
    ],
  );
  assert.deepEqual(await words(app, headers), [
    { lemmaId: "pl:kot:NOUN", status: "active", updated: "2026-11-04T00:00:00.000Z", mature: false },
    { lemmaId: "pl:pies:NOUN", status: "active", updated: "2026-11-04T00:00:00.000Z", mature: false },
  ]);
});

test("known and ignored words have no cards to review, and active brings their cards back", async () => {
  const app = setup();
  const headers = await signedIn();
  await putWord(app, headers, "pl:pies:NOUN", { status: "active" });
  await putWord(app, headers, "pl:kot:NOUN", { status: "known" });
  await putWord(app, headers, "pl:Ola:PROPN", { status: "ignored" });
  assert.equal((await due(app, headers)).cards.length, 2);
  await putWord(app, headers, "pl:pies:NOUN", { status: "known" });
  assert.equal((await due(app, headers)).cards.length, 0);
  await putWord(app, headers, "pl:pies:NOUN", { status: "active" });
  assert.deepEqual(
    (await due(app, headers)).cards.map((c) => c.lemmaId),
    ["pl:pies:NOUN", "pl:pies:NOUN"],
  );
  assert.deepEqual(
    (await words(app, headers)).map((w) => [w.lemmaId, w.status]),
    [
      ["pl:Ola:PROPN", "ignored"],
      ["pl:kot:NOUN", "known"],
      ["pl:pies:NOUN", "active"],
    ],
  );
});

test("a review schedules the card, a retried review is counted once, and the day's new cards are limited by the setting", async () => {
  const app = setup();
  const headers = await signedIn();
  assert.deepEqual((await (await app.request(`${ORIGIN}/api/me/settings`, { headers })).json()) as Settings, { newPerDay: 20 });
  assert.equal((await putSettings(app, headers, { newPerDay: 1 })).status, 204);
  await putWord(app, headers, "pl:pies:NOUN", { status: "active" });
  const [card] = (await due(app, headers)).cards;
  assert.ok(card);
  const good = answer(card.id, 3);
  const response = await postReview(app, headers, good);
  assert.equal(response.status, 200);
  const reviewed = (await response.json()) as Reviewed;
  assert.ok(reviewed.dueAt > NOW);
  assert.deepEqual(await (await postReview(app, headers, good)).json(), reviewed);
  const after = await due(app, headers);
  assert.deepEqual(after, { cards: [], newLeft: 0 });
  // The next day's allowance
  assert.equal((await due(app, headers, "2026-11-04T00:00:00.001Z")).cards.length, 1);
  // A day start without milliseconds is the same time: compared as strings, "00Z" sorts after "00.000Z"
  assert.equal((await due(app, headers, "2026-11-04T00:00:00Z")).newLeft, 0);
});

test("Easy on a new card makes it mature, and its word shows as such", async () => {
  const app = setup();
  const headers = await signedIn();
  await putWord(app, headers, "pl:pies:NOUN", { status: "active" });
  const recognition = (await due(app, headers)).cards.find((c) => c.kind === "recognition");
  assert.ok(recognition);
  assert.equal((await postReview(app, headers, answer(recognition.id, 4))).status, 200);
  assert.deepEqual(
    (await words(app, headers)).map((w) => w.mature),
    [true],
  );
});

test("a review needs a session, the user's card, a grade, and a time that isn't ahead or before the last review", async () => {
  const app = setup();
  assert.equal((await postReview(app, undefined, answer(crypto.randomUUID(), 3))).status, 401);
  const headers = await signedIn();
  await putWord(app, headers, "pl:pies:NOUN", { status: "active" });
  const [card] = (await due(app, headers)).cards;
  assert.ok(card);
  assert.equal((await postReview(app, headers, answer(crypto.randomUUID(), 3))).status, 404);
  assert.equal((await postReview(app, headers, answer(card.id, 0))).status, 400);
  assert.equal((await postReview(app, headers, answer(card.id, 5))).status, 400);
  assert.equal((await postReview(app, headers, { ...answer(card.id, 3), id: "1" })).status, 400);
  assert.equal((await postReview(app, headers, answer(card.id, 3, "2026-11-04T01:00:00.000Z"))).status, 400);
  assert.equal((await postReview(app, headers, answer(card.id, 3, "2026-11-03T23:59:59.999Z"))).status, 409);
  const first = answer(card.id, 3);
  assert.equal((await postReview(app, headers, first)).status, 200);
  assert.equal((await postReview(app, headers, answer(card.id, 3, "2026-11-03T00:00:00.000Z"))).status, 409);
  const other = (await due(app, headers)).cards.find((c) => c.id !== card.id);
  assert.ok(other);
  assert.equal((await postReview(app, headers, { ...first, cardId: other.id })).status, 409);
  const bob = await local.signIn((await local.signUp({ name: "Bob", email: "bob@example.com" })).id);
  assert.equal((await postReview(app, bob, answer(card.id, 3))).status, 404);
});

test("words, cards and settings need a session and valid input", async () => {
  const app = setup();
  assert.equal((await app.request(`${ORIGIN}/api/me/words`)).status, 401);
  assert.equal((await app.request(`${ORIGIN}/api/me/cards/due?dayStart=${DAY_START}`)).status, 401);
  assert.equal((await app.request(`${ORIGIN}/api/me/settings`)).status, 401);
  assert.equal((await putWord(app, undefined, "pl:pies:NOUN", { status: "known" })).status, 401);
  const headers = await signedIn();
  assert.equal((await putWord(app, headers, "pies", { status: "known" })).status, 400);
  assert.equal((await putWord(app, headers, "zz:pies:NOUN", { status: "known" })).status, 400);
  assert.equal((await putWord(app, headers, "pl:pies:NOPE", { status: "known" })).status, 400);
  assert.equal((await putWord(app, headers, "pl:i/lub:CCONJ", { status: "known" })).status, 204);
  assert.equal((await putWord(app, headers, "pl:pies:NOUN", { status: "learning" })).status, 400);
  assert.equal((await putWord(app, headers, "pl:pies:NOUN", null)).status, 400);
  assert.equal((await app.request(`${ORIGIN}/api/me/cards/due`, { headers })).status, 400);
  assert.equal((await app.request(`${ORIGIN}/api/me/cards/due?dayStart=today`, { headers })).status, 400);
  assert.equal((await putSettings(app, headers, { newPerDay: -1 })).status, 400);
  assert.equal((await putSettings(app, headers, { newPerDay: 1.5 })).status, 400);
  assert.equal((await putSettings(app, headers, { newPerDay: 1001 })).status, 400);
});

test("a lexicon lookup gives each language's loaded version, leaving out ids it doesn't have", async () => {
  const app = setup();
  await loadLexicon("pl", "lex/1", [{ lemmaId: "pl:pies:NOUN", lemma: "pies", upos: "NOUN", gloss: "dog (old)" }]);
  await loadLexicon("pl", "lex/2", [{ lemmaId: "pl:pies:NOUN", lemma: "pies", upos: "NOUN", gloss: "dog" }]);
  await loadLexicon("en", "lex/1", [{ lemmaId: "en:dog:NOUN", lemma: "dog", upos: "NOUN", gloss: "a domesticated canid" }]);
  const response = await lookUp(app, { ids: ["pl:pies:NOUN", "en:dog:NOUN", "pl:kot:NOUN"] });
  assert.equal(response.status, 200);
  const entries = (await response.json()) as LexiconEntry[];
  assert.deepEqual(
    entries.map((e) => [e.lemmaId, e.senses[0]?.gloss]).sort(),
    [
      ["en:dog:NOUN", "a domesticated canid"],
      ["pl:pies:NOUN", "dog"],
    ],
  );
  assert.equal((await lookUp(app, { ids: [] })).status, 400);
  assert.equal((await lookUp(app, { ids: Array.from({ length: 101 }, (_, i) => `pl:w${i}:NOUN`) })).status, 400);
  assert.equal((await lookUp(app, { ids: Array.from({ length: 100 }, (_, i) => `pl:w${i}:NOUN`) })).status, 200);
});
