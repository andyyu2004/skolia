import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_NEW_PER_DAY, lemmaParam, type CardCounts, type CardGroup, type Due, type Lang, type LemmaId, type NewClozeInput, type Rating, type Reviewed, type ReviewRequestInput, type Settings, type Word, type WordStatus } from "@skolia/shared/api";
import { ALICE, NOW, client, loadLexicon, local, raw, setup, useLocal, type App } from "./testing/app.ts";
import { body } from "./testing/responses.ts";

useLocal();

const DAY_START = "2026-11-03T23:00:00.000Z";

async function signedIn(): Promise<Headers> {
  return local.signIn((await local.signUp(ALICE)).id);
}

async function due(app: App, headers: Headers, lang: Lang, { dayStart = DAY_START, group }: { dayStart?: string; group?: CardGroup | undefined } = {}): Promise<Due> {
  // Hono's JSON type makes the entries' optional fields `| undefined`; it's the same JSON
  return (await body("due", client(app, headers).me.cards.due.$get({ query: { lang, dayStart, group } }))) as Due;
}

function counts(app: App, headers: Headers): Promise<CardCounts[]> {
  return body("counts", client(app, headers).me.cards.counts.$get({ query: { dayStart: DAY_START } }));
}

/** Counts for a language with no cards. */
function none(lang: Lang): CardCounts {
  return { lang, words: { due: 0, new: 0 }, forms: { due: 0, new: 0 } };
}

/** A cloze card for the lemma, the nth in a text. */
function makeCloze(app: App, headers: Headers, lemmaId: LemmaId, n: number) {
  const json: NewClozeInput = {
    lemmaId,
    documentId: "a".repeat(64),
    sentence: "Widzę psa.",
    sentenceStart: n * 100,
    blankStart: n * 100 + 6,
    blankEnd: n * 100 + 9,
    feats: { Case: "Acc" },
    why: null,
  };
  return body("cloze", client(app, headers).me.clozes.$post({ json }), 201);
}

function words(app: App, headers: Headers): Promise<Word[]> {
  return body("words", client(app, headers).me.words.$get());
}

function mark(app: App, headers: Headers | undefined, lemmaId: LemmaId, status: WordStatus) {
  return client(app, headers).me.words[":lemmaId"].$put({ param: { lemmaId: lemmaParam(lemmaId) }, json: { status } });
}

function review(app: App, headers: Headers | undefined, json: ReviewRequestInput) {
  return client(app, headers).me.reviews.$post({ json });
}

const DEFAULT_SETTINGS: Settings = { newLemmasPerDay: 20, newFormsPerDay: 20, formsWithWords: true };

function saveSettings(app: App, headers: Headers, settings: Partial<Settings>) {
  return client(app, headers).me.settings.$put({ json: { ...DEFAULT_SETTINGS, ...settings } });
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
  assert.deepEqual(newLeft, { words: 20, forms: 20 });
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

test("a review schedules the card, a retried review is counted once, and the day's new words are limited by the setting", async () => {
  const app = setup();
  const headers = await signedIn();
  assert.deepEqual(await body("settings", client(app, headers).me.settings.$get()), DEFAULT_SETTINGS);
  assert.equal((await saveSettings(app, headers, { newLemmasPerDay: 1 })).status, 204);
  await mark(app, headers, "pl:pies:NOUN", "active");
  await mark(app, headers, "pl:kot:NOUN", "active");
  const before = (await due(app, headers, "pl")).cards;
  assert.deepEqual(
    before.map((c) => [c.lemmaId, c.kind]),
    [
      ["pl:kot:NOUN", "recognition"],
      ["pl:kot:NOUN", "production"],
    ],
  );
  const [card, other] = before;
  assert.ok(card && other);
  const good = answer(card.id, 3);
  const reviewed: Reviewed = await body("review", review(app, headers, good));
  assert.ok(reviewed.dueAt > NOW);
  assert.deepEqual(await body("review retried", review(app, headers, good)), reviewed);
  // The word's other card comes with it, though the day's allowance is used up
  const after = await due(app, headers, "pl");
  assert.deepEqual(after.cards.map((c) => c.id), [other.id]);
  assert.deepEqual(after.newLeft, { words: 0, forms: 20 });
  // The next day's allowance
  assert.deepEqual(
    (await due(app, headers, "pl", { dayStart: "2026-11-04T00:00:00.001Z" })).cards.map((c) => [c.lemmaId, c.kind]),
    [
      ["pl:kot:NOUN", "production"],
      ["pl:pies:NOUN", "recognition"],
      ["pl:pies:NOUN", "production"],
    ],
  );
  // A day start without milliseconds is the same time: compared as strings, "00Z" sorts after "00.000Z"
  assert.equal((await due(app, headers, "pl", { dayStart: "2026-11-04T00:00:00Z" })).newLeft.words, 0);
});

test("a word uses one place in the day's allowance, however many of its cards are reviewed, and only on its first day", async () => {
  const app = setup();
  const headers = await signedIn();
  await saveSettings(app, headers, { newLemmasPerDay: 2 });
  for (const lemmaId of ["pl:a:NOUN", "pl:b:NOUN", "pl:c:NOUN", "pl:d:NOUN"] as const) await mark(app, headers, lemmaId, "active");
  const first = await due(app, headers, "pl");
  assert.deepEqual(
    first.cards.map((c) => c.lemmaId),
    ["pl:a:NOUN", "pl:a:NOUN", "pl:b:NOUN", "pl:b:NOUN"],
  );
  // Counts give new words in lemmas, as the allowance does, not their four cards
  assert.equal(first.newLeft.words, 2);
  assert.deepEqual((await counts(app, headers))[2]?.words, { due: 0, new: 2 });
  for (const card of first.cards.filter((c) => c.lemmaId === "pl:a:NOUN")) await body("review", review(app, headers, answer(card.id, 3)));
  const left = await due(app, headers, "pl");
  assert.equal(left.newLeft.words, 1);
  assert.deepEqual(
    left.cards.map((c) => c.lemmaId),
    ["pl:b:NOUN", "pl:b:NOUN"],
  );
  assert.deepEqual((await counts(app, headers))[2]?.words, { due: 0, new: 1 });
  const [bRecognition, bProduction] = left.cards;
  assert.ok(bRecognition && bProduction);
  await body("review", review(app, headers, answer(bRecognition.id, 3)));
  assert.deepEqual((await due(app, headers, "pl")).cards.map((c) => c.id), [bProduction.id]);
  // The next day: b's other card is reviewed, but b was started the day before
  const at = "2026-11-05T00:00:00.000Z";
  const nextDay = setup({ at });
  const dayStart = "2026-11-04T23:00:00.000Z";
  await body("review", review(nextDay, headers, answer(bProduction.id, 3, at)));
  const second = await due(nextDay, headers, "pl", { dayStart });
  assert.equal(second.newLeft.words, 2);
  assert.deepEqual(
    second.cards.filter((c) => c.isNew).map((c) => c.lemmaId),
    ["pl:c:NOUN", "pl:c:NOUN", "pl:d:NOUN", "pl:d:NOUN"],
  );
});

test("cloze cards have their own daily allowance, and a new one waits for its word to be started", async () => {
  const app = setup();
  const headers = await signedIn();
  await saveSettings(app, headers, { newLemmasPerDay: 1, newFormsPerDay: 1 });
  await mark(app, headers, "pl:pies:NOUN", "active");
  const clozes = [await makeCloze(app, headers, "pl:pies:NOUN", 0), await makeCloze(app, headers, "pl:pies:NOUN", 1)];
  const kinds = async (group?: CardGroup) => (await due(app, headers, "pl", { group })).cards.map((c) => c.kind);
  assert.deepEqual(await kinds(), ["recognition", "production"]);
  assert.deepEqual(await kinds("forms"), []);
  assert.deepEqual(await counts(app, headers), [none("en"), none("fr"), { ...none("pl"), words: { due: 0, new: 1 } }]);

  const [recognition] = (await due(app, headers, "pl", { group: "words" })).cards;
  assert.equal(recognition?.kind, "recognition");
  await body("review", review(app, headers, answer(recognition.id, 3)));
  // Started, its word gets a cloze card a day; the words' allowance is used up, but not by it
  const both = await due(app, headers, "pl");
  assert.deepEqual(both.cards.map((c) => c.kind), ["production", "cloze"]);
  assert.deepEqual(both.newLeft, { words: 0, forms: 1 });
  assert.deepEqual(await kinds("words"), ["production"]);
  const [cloze] = (await due(app, headers, "pl", { group: "forms" })).cards;
  assert.ok(cloze);
  // Made at the same time, either can come first
  assert.ok(clozes.some((c) => c.cardId === cloze.id));
  assert.deepEqual(await counts(app, headers), [none("en"), none("fr"), { lang: "pl", words: { due: 0, new: 1 }, forms: { due: 0, new: 1 } }]);

  await body("review", review(app, headers, answer(cloze.id, 1)));
  assert.deepEqual((await due(app, headers, "pl")).newLeft, { words: 0, forms: 0 });
  assert.deepEqual(await kinds("forms"), []);
  // Again: due within minutes, in the forms' group only
  const later = setup({ at: "2026-11-04T00:30:00Z" });
  assert.deepEqual(
    (await due(later, headers, "pl", { group: "forms" })).cards.map((c) => [c.id, c.isNew]),
    [[cloze.id, false]],
  );
  assert.deepEqual(
    (await due(later, headers, "pl", { group: "words" })).cards.map((c) => c.kind),
    ["production"],
  );
  assert.deepEqual((await counts(later, headers))[2], { lang: "pl", words: { due: 0, new: 1 }, forms: { due: 1, new: 0 } });
});

test("each language is reviewed on its own, with its own daily allowance of new words", async () => {
  const app = setup();
  const headers = await signedIn();
  await saveSettings(app, headers, { newLemmasPerDay: 1 });
  await mark(app, headers, "pl:pies:NOUN", "active");
  await mark(app, headers, "en:dog:NOUN", "active");
  await mark(app, headers, "en:cat:NOUN", "active");
  await mark(app, headers, "en:bird:NOUN", "known");
  const words = (due: number, fresh: number) => ({ due, new: fresh });
  assert.deepEqual(await counts(app, headers), [
    { ...none("en"), words: words(0, 1) },
    none("fr"),
    { ...none("pl"), words: words(0, 1) },
  ]);
  const [polish] = (await due(app, headers, "pl")).cards;
  assert.equal(polish?.lemmaId, "pl:pies:NOUN");
  assert.equal((await review(app, headers, answer(polish.id, 1))).status, 200);
  // Again makes the Polish card due again within minutes, and its word's other card is still
  // new; English still has its own new word
  assert.deepEqual(await counts(setup({ at: "2026-11-04T00:30:00Z" }), headers), [
    { ...none("en"), words: words(0, 1) },
    none("fr"),
    { ...none("pl"), words: words(1, 1) },
  ]);
  assert.deepEqual(
    (await due(app, headers, "en")).cards.map((c) => c.lemmaId),
    ["en:cat:NOUN", "en:cat:NOUN"],
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
  assert.equal((await raw(app, "GET", "/api/me/cards/due", headers, undefined)).status, 400);
  assert.equal((await client(app, headers).me.cards.due.$get({ query: { lang: "pl", dayStart: "today" } })).status, 400);
  assert.equal((await raw(app, "GET", `/api/me/cards/due?dayStart=${DAY_START}`, headers, undefined)).status, 400);
  assert.equal((await raw(app, "GET", `/api/me/cards/due?lang=zz&dayStart=${DAY_START}`, headers, undefined)).status, 400);
  assert.equal((await raw(app, "GET", "/api/me/cards/counts", headers, undefined)).status, 400);
  assert.equal((await raw(app, "GET", `/api/me/cards/due?lang=pl&dayStart=${DAY_START}&group=all`, headers, undefined)).status, 400);
  for (const field of ["newLemmasPerDay", "newFormsPerDay"] as const) {
    assert.equal((await raw(app, "PUT", "/api/me/settings", headers, { ...DEFAULT_SETTINGS, [field]: -1 })).status, 400);
    assert.equal((await raw(app, "PUT", "/api/me/settings", headers, { ...DEFAULT_SETTINGS, [field]: 1.5 })).status, 400);
    assert.equal((await saveSettings(app, headers, { [field]: 1001 })).status, 400);
    const { [field]: _, ...missing } = DEFAULT_SETTINGS;
    assert.equal((await raw(app, "PUT", "/api/me/settings", headers, missing)).status, 400);
  }
  assert.equal((await raw(app, "PUT", "/api/me/settings", headers, { ...DEFAULT_SETTINGS, formsWithWords: 1 })).status, 400);
  const { formsWithWords: _, ...missing } = DEFAULT_SETTINGS;
  assert.equal((await raw(app, "PUT", "/api/me/settings", headers, missing)).status, 400);
  assert.deepEqual(await body("settings", client(app, headers).me.settings.$get()), DEFAULT_SETTINGS);
});

function forget(app: App, headers: Headers | undefined, lemmaId: LemmaId) {
  return client(app, headers).me.words[":lemmaId"].$delete({ param: { lemmaId: lemmaParam(lemmaId) } });
}

test("taking a word's status away takes its cards out of reviews, and adding it again brings them back with their reviews", async () => {
  const app = setup();
  const headers = await signedIn();
  await mark(app, headers, "pl:pies:NOUN", "active");
  await mark(app, headers, "pl:kot:NOUN", "active");
  const recognition = (await due(app, headers, "pl")).cards.find((c) => c.lemmaId === "pl:pies:NOUN" && c.kind === "recognition");
  assert.ok(recognition);
  await body("review", review(app, headers, answer(recognition.id, 1)));
  const { cardId } = await makeCloze(app, headers, "pl:pies:NOUN", 0);
  await body("cloze review", review(app, headers, answer(cardId, 1)));
  const later = setup({ at: "2026-11-04T00:30:00Z" });
  const pies = async () =>
    (await due(later, headers, "pl")).cards.filter((c) => c.lemmaId === "pl:pies:NOUN").map((c) => [c.id, c.kind, c.isNew]);
  const before = await pies();
  assert.equal(before.length, 3);

  assert.equal((await forget(app, headers, "pl:pies:NOUN")).status, 204);
  assert.deepEqual(
    (await words(app, headers)).map((w) => w.lemmaId),
    ["pl:kot:NOUN"],
  );
  assert.deepEqual(await pies(), []);
  assert.deepEqual((await counts(later, headers))[2], { lang: "pl", words: { due: 0, new: 1 }, forms: { due: 0, new: 0 } });
  assert.equal((await forget(app, headers, "pl:pies:NOUN")).status, 204);
  assert.equal((await forget(app, headers, "pl:pies:NOUN")).status, 204);
  assert.equal((await forget(app, headers, "pl:nic:NOUN")).status, 204);

  await mark(app, headers, "pl:pies:NOUN", "active");
  assert.deepEqual(await pies(), before);
  assert.deepEqual((await counts(later, headers))[2], { lang: "pl", words: { due: 1, new: 2 }, forms: { due: 1, new: 0 } });
});

test("taking a word's status away needs a session and a lemma id", async () => {
  const app = setup();
  assert.equal((await forget(app, undefined, "pl:pies:NOUN")).status, 401);
  const headers = await signedIn();
  assert.equal((await raw(app, "DELETE", "/api/me/words/pies", headers, undefined)).status, 400);
  assert.equal((await raw(app, "DELETE", "/api/me/words/zz:pies:NOUN", headers, undefined)).status, 400);
  assert.equal((await forget(app, headers, "pl:i/lub:CCONJ")).status, 204);
});

test("settings are saved whole, and kept", async () => {
  const app = setup();
  const headers = await signedIn();
  const saved: Settings = { newLemmasPerDay: 0, newFormsPerDay: MAX_NEW_PER_DAY, formsWithWords: false };
  assert.equal((await saveSettings(app, headers, saved)).status, 204);
  assert.deepEqual(await body("settings", client(app, headers).me.settings.$get()), saved);
  const bob = await local.signIn((await local.signUp({ name: "Bob", email: "bob@example.com" })).id);
  assert.deepEqual(await body("bob's settings", client(app, bob).me.settings.$get()), DEFAULT_SETTINGS);
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
  const { entries, featureSets } = await body("lookup", lookUp(app, ["pl:pies:NOUN", "en:dog:NOUN", "pl:kot:NOUN"]));
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
