import assert from "node:assert/strict";
import { test } from "node:test";
import { lemmaParam, type CardCounts, type Due, type Lang, type LemmaId, type Lookup, type Rating, type Reviewed, type ReviewRequestInput, type Settings, type Word, type WordStatus } from "@skolia/shared/api";
import { ALICE, NOW, client, loadLexicon, local, raw, setup, useLocal, type App } from "./testing/app.ts";
import { ORIGIN } from "./testing/harness.ts";

useLocal();

const DAY_START = "2026-11-03T23:00:00.000Z";

async function signedIn(): Promise<Headers> {
  return local.signIn((await local.signUp(ALICE)).id);
}

async function due(app: App, headers: Headers, lang: Lang, dayStart = DAY_START): Promise<Due> {
  const response = await client(app, headers).me.cards.due.$get({ query: { lang, dayStart } });
  assert.equal(response.status, 200);
  // Hono's JSON type makes the entries' optional fields `| undefined`; it's the same JSON
  return (await response.json()) as Due;
}

async function counts(app: App, headers: Headers): Promise<CardCounts[]> {
  const response = await client(app, headers).me.cards.counts.$get({ query: { dayStart: DAY_START } });
  if (response.status !== 200) assert.fail(`counts: ${response.status}`);
  return response.json();
}

async function words(app: App, headers: Headers): Promise<Word[]> {
  const response = await client(app, headers).me.words.$get();
  if (response.status !== 200) assert.fail(`words: ${response.status}`);
  return response.json();
}

function mark(app: App, headers: Headers | undefined, lemmaId: LemmaId, status: WordStatus) {
  return client(app, headers).me.words[":lemmaId"].$put({ param: { lemmaId: lemmaParam(lemmaId) }, json: { status } });
}

function review(app: App, headers: Headers | undefined, json: ReviewRequestInput) {
  return client(app, headers).me.reviews.$post({ json });
}

function saveSettings(app: App, headers: Headers, json: Settings) {
  return client(app, headers).me.settings.$put({ json });
}

function lookUp(app: App, ids: LemmaId[]) {
  return client(app).lexicon.entries.$post({ json: { ids } });
}

function answer(cardId: string, rating: Rating, at = NOW): ReviewRequestInput {
  return { id: crypto.randomUUID(), cardId, rating, at };
}

test("an active word gets a recognition and a production card, new and due now, with its lexicon entry", async () => {
  const app = setup();
  const headers = await signedIn();
  await loadLexicon(
    "pl",
    "lex/1",
    [{ lemmaId: "pl:pies:NOUN", lemma: "pies", upos: "NOUN", gloss: "dog", paradigms: [{ homonym: "", forms: [["psa", [1]]] }] }],
    [{ Case: "Nom" }, { Case: "Gen" }],
  );
  assert.equal((await mark(app, headers, "pl:pies:NOUN", "active")).status, 204);
  assert.equal((await mark(app, headers, "pl:pies:NOUN", "active")).status, 204);
  assert.equal((await mark(app, headers, "pl:kot:NOUN", "active")).status, 204);
  const { cards, newLeft, featureSets } = await due(app, headers, "pl");
  assert.equal(newLeft, 20);
  assert.deepEqual(featureSets, { "1": { Case: "Gen" } });
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
  await mark(app, headers, "pl:pies:NOUN", "active");
  await mark(app, headers, "pl:kot:NOUN", "known");
  await mark(app, headers, "pl:Ola:PROPN", "ignored");
  assert.equal((await due(app, headers, "pl")).cards.length, 2);
  await mark(app, headers, "pl:pies:NOUN", "known");
  assert.equal((await due(app, headers, "pl")).cards.length, 0);
  await mark(app, headers, "pl:pies:NOUN", "active");
  assert.deepEqual(
    (await due(app, headers, "pl")).cards.map((c) => c.lemmaId),
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
  assert.deepEqual(await (await client(app, headers).me.settings.$get()).json(), { newPerDay: 20 });
  assert.equal((await saveSettings(app, headers, { newPerDay: 1 })).status, 204);
  await mark(app, headers, "pl:pies:NOUN", "active");
  const [card] = (await due(app, headers, "pl")).cards;
  assert.ok(card);
  const good = answer(card.id, 3);
  const response = await review(app, headers, good);
  assert.equal(response.status, 200);
  assert.ok(response.ok);
  const reviewed: Reviewed = await response.json();
  assert.ok(reviewed.dueAt > NOW);
  assert.deepEqual(await (await review(app, headers, good)).json(), reviewed);
  const after = await due(app, headers, "pl");
  assert.deepEqual(after, { cards: [], newLeft: 0, featureSets: {} });
  // The next day's allowance
  assert.equal((await due(app, headers, "pl", "2026-11-04T00:00:00.001Z")).cards.length, 1);
  // A day start without milliseconds is the same time: compared as strings, "00Z" sorts after "00.000Z"
  assert.equal((await due(app, headers, "pl", "2026-11-04T00:00:00Z")).newLeft, 0);
});

test("each language is reviewed on its own, with its own daily allowance of new cards", async () => {
  const app = setup();
  const headers = await signedIn();
  await saveSettings(app, headers, { newPerDay: 1 });
  await mark(app, headers, "pl:pies:NOUN", "active");
  await mark(app, headers, "en:dog:NOUN", "active");
  await mark(app, headers, "en:cat:NOUN", "active");
  await mark(app, headers, "en:bird:NOUN", "known");
  assert.deepEqual(await counts(app, headers), [
    { lang: "en", due: 0, new: 1 },
    { lang: "pl", due: 0, new: 1 },
  ]);
  const [polish] = (await due(app, headers, "pl")).cards;
  assert.equal(polish?.lemmaId, "pl:pies:NOUN");
  assert.equal((await review(app, headers, answer(polish.id, 1))).status, 200);
  // Again makes the Polish card due again within minutes; English still has its own new card
  assert.deepEqual(await counts(setup({ at: "2026-11-04T00:30:00Z" }), headers), [
    { lang: "en", due: 0, new: 1 },
    { lang: "pl", due: 1, new: 0 },
  ]);
  assert.deepEqual(
    (await due(app, headers, "en")).cards.map((c) => c.lemmaId),
    ["en:cat:NOUN"],
  );
});

test("Easy on a new card makes it mature, and its word shows as such", async () => {
  const app = setup();
  const headers = await signedIn();
  await mark(app, headers, "pl:pies:NOUN", "active");
  const recognition = (await due(app, headers, "pl")).cards.find((c) => c.kind === "recognition");
  assert.ok(recognition);
  assert.equal((await review(app, headers, answer(recognition.id, 4))).status, 200);
  assert.deepEqual(
    (await words(app, headers)).map((w) => w.mature),
    [true],
  );
});

test("a review needs a session, the user's card, a grade, and a time that isn't ahead or before the last review", async () => {
  const app = setup();
  assert.equal((await review(app, undefined, answer(crypto.randomUUID(), 3))).status, 401);
  const headers = await signedIn();
  await mark(app, headers, "pl:pies:NOUN", "active");
  const [card] = (await due(app, headers, "pl")).cards;
  assert.ok(card);
  assert.equal((await review(app, headers, answer(crypto.randomUUID(), 3))).status, 404);
  assert.equal((await raw(app, "POST", "/api/me/reviews", headers, { ...answer(card.id, 3), rating: 0 })).status, 400);
  assert.equal((await raw(app, "POST", "/api/me/reviews", headers, { ...answer(card.id, 3), rating: 5 })).status, 400);
  assert.equal((await raw(app, "POST", "/api/me/reviews", headers, { ...answer(card.id, 3), id: "1" })).status, 400);
  assert.equal((await review(app, headers, answer(card.id, 3, "2026-11-04T01:00:00.000Z"))).status, 400);
  assert.equal((await review(app, headers, answer(card.id, 3, "2026-11-03T23:59:59.999Z"))).status, 409);
  const first = answer(card.id, 3);
  assert.equal((await review(app, headers, first)).status, 200);
  assert.equal((await review(app, headers, answer(card.id, 3, "2026-11-03T00:00:00.000Z"))).status, 409);
  const other = (await due(app, headers, "pl")).cards.find((c) => c.id !== card.id);
  assert.ok(other);
  assert.equal((await review(app, headers, { ...first, cardId: other.id })).status, 409);
  const bob = await local.signIn((await local.signUp({ name: "Bob", email: "bob@example.com" })).id);
  assert.equal((await review(app, bob, answer(card.id, 3))).status, 404);
});

test("words, cards and settings need a session and valid input", async () => {
  const app = setup();
  const anonymous = client(app);
  assert.equal((await anonymous.me.words.$get()).status, 401);
  assert.equal((await anonymous.me.cards.due.$get({ query: { lang: "pl", dayStart: DAY_START } })).status, 401);
  assert.equal((await anonymous.me.cards.counts.$get({ query: { dayStart: DAY_START } })).status, 401);
  assert.equal((await anonymous.me.settings.$get()).status, 401);
  assert.equal((await mark(app, undefined, "pl:pies:NOUN", "known")).status, 401);
  const headers = await signedIn();
  // Invalid input, which the typed client won't send
  assert.equal((await raw(app, "PUT", "/api/me/words/pies", headers, { status: "known" })).status, 400);
  assert.equal((await raw(app, "PUT", "/api/me/words/zz:pies:NOUN", headers, { status: "known" })).status, 400);
  assert.equal((await raw(app, "PUT", "/api/me/words/pl:pies:NOPE", headers, { status: "known" })).status, 400);
  assert.equal((await mark(app, headers, "pl:i/lub:CCONJ", "known")).status, 204);
  assert.equal((await raw(app, "PUT", "/api/me/words/pl:pies:NOUN", headers, { status: "learning" })).status, 400);
  assert.equal((await raw(app, "PUT", "/api/me/words/pl:pies:NOUN", headers, null)).status, 400);
  assert.equal((await app.request(`${ORIGIN}/api/me/cards/due`, { headers })).status, 400);
  assert.equal((await app.request(`${ORIGIN}/api/me/cards/due?lang=pl&dayStart=today`, { headers })).status, 400);
  assert.equal((await app.request(`${ORIGIN}/api/me/cards/due?dayStart=${DAY_START}`, { headers })).status, 400);
  assert.equal((await app.request(`${ORIGIN}/api/me/cards/due?lang=zz&dayStart=${DAY_START}`, { headers })).status, 400);
  assert.equal((await app.request(`${ORIGIN}/api/me/cards/counts`, { headers })).status, 400);
  assert.equal((await raw(app, "PUT", "/api/me/settings", headers, { newPerDay: -1 })).status, 400);
  assert.equal((await raw(app, "PUT", "/api/me/settings", headers, { newPerDay: 1.5 })).status, 400);
  assert.equal((await saveSettings(app, headers, { newPerDay: 1001 })).status, 400);
});

test("a lexicon lookup gives each language's loaded version, leaving out ids it doesn't have", async () => {
  const app = setup();
  await loadLexicon("pl", "lex/1", [{ lemmaId: "pl:pies:NOUN", lemma: "pies", upos: "NOUN", gloss: "dog (old)" }]);
  await loadLexicon("pl", "lex/1", [], [{ Case: "Nom" }, { Case: "Gen" }]);
  await loadLexicon(
    "pl",
    "lex/2",
    [
      {
        lemmaId: "pl:pies:NOUN",
        lemma: "pies",
        upos: "NOUN",
        gloss: "dog",
        pronunciations: [{ ipa: "/ˈpjɛs/" }],
        paradigms: [{ homonym: "", forms: [["pies", [0]], ["psa", [1, 2]]] }],
      },
    ],
    [{ Case: "Nom", Number: "Sing" }, { Case: "Gen", Number: "Sing" }, { Case: "Acc", Number: "Sing" }, { Case: "Dat", Number: "Sing" }],
  );
  await loadLexicon("en", "lex/1", [{ lemmaId: "en:dog:NOUN", lemma: "dog", upos: "NOUN", gloss: "a domesticated canid" }]);
  const response = await lookUp(app, ["pl:pies:NOUN", "en:dog:NOUN", "pl:kot:NOUN"]);
  assert.equal(response.status, 200);
  const { entries, featureSets } = (await response.json()) as Lookup;
  assert.deepEqual(
    entries.map((e) => [e.lemmaId, e.senses[0]?.gloss]).sort(),
    [
      ["en:dog:NOUN", "a domesticated canid"],
      ["pl:pies:NOUN", "dog"],
    ],
  );
  const pies = entries.find((e) => e.lemmaId === "pl:pies:NOUN");
  assert.deepEqual(pies?.pronunciations, [{ ipa: "/ˈpjɛs/" }]);
  assert.deepEqual(pies?.paradigms, [{ homonym: "", forms: [["pies", [0]], ["psa", [1, 2]]] }]);
  // Only the sets the paradigms use, from the served version; dog has no paradigm
  assert.deepEqual(featureSets, {
    pl: { "0": { Case: "Nom", Number: "Sing" }, "1": { Case: "Gen", Number: "Sing" }, "2": { Case: "Acc", Number: "Sing" } },
  });
  assert.equal((await lookUp(app, [])).status, 400);
  assert.equal((await lookUp(app, Array.from({ length: 101 }, (_, i): LemmaId => `pl:w${i}:NOUN`))).status, 400);
  assert.equal((await lookUp(app, Array.from({ length: 100 }, (_, i): LemmaId => `pl:w${i}:NOUN`))).status, 200);
});
