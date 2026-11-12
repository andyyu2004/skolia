import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOZE_PAGE, lemmaParam, type CardGroup, type ClozeKey, type Due, type LemmaId, type NewClozeInput, type Rating, type WordStatus } from "@skolia/shared/api";
import type { Cursor } from "@skolia/shared/page";
import { ALICE, NOW, client, loadLexicon, local, raw, refusesBadPages, setup, useLocal, walk, type App } from "./testing/app.ts";
import { body, expectStatus } from "./testing/responses.ts";

useLocal();

const DAY_START = "2026-11-03T23:00:00.000Z";
const DOC = "a".repeat(64);
const SENTENCE = "Szukam pracy od roku.";

/** pracy blanked out of SENTENCE, 40 characters into DOC; offsets are in the text. */
const PRACY: NewClozeInput = {
  lemmaId: "pl:praca:NOUN",
  documentId: DOC,
  sentence: SENTENCE,
  sentenceStart: 40,
  blankStart: 47,
  blankEnd: 52,
  feats: { Case: "Gen", Number: "Sing" },
  why: "szukać governs the genitive for its object.",
};

async function signedIn(): Promise<Headers> {
  return local.signIn((await local.signUp(ALICE)).id);
}

function make(app: App, headers: Headers | undefined, json: NewClozeInput) {
  return client(app, headers).me.clozes.$post({ json });
}

async function due(app: App, headers: Headers, group?: CardGroup): Promise<Due> {
  return (await body("due", client(app, headers).me.cards.due.$get({ query: { lang: "pl", dayStart: DAY_START, group } }))) as Due;
}

function listed(app: App, headers: Headers, documentId = DOC) {
  return body("clozes", client(app, headers).me.clozes.$get({ query: { documentId } }));
}

function mark(app: App, headers: Headers, lemmaId: LemmaId, status: WordStatus) {
  return expectStatus("mark", client(app, headers).me.words[":lemmaId"].$put({ param: { lemmaId: lemmaParam(lemmaId) }, json: { status } }), 204);
}

function review(app: App, headers: Headers, cardId: string, rating: Rating) {
  return client(app, headers).me.reviews.$post({ json: { id: crypto.randomUUID(), cardId, rating, at: NOW } });
}

/** Makes the word active and reviews its recognition card, so its new cloze cards come up. */
async function start(app: App, headers: Headers, lemmaId: LemmaId): Promise<void> {
  await mark(app, headers, lemmaId, "active");
  const recognition = (await due(app, headers, "words")).cards.find((c) => c.lemmaId === lemmaId && c.kind === "recognition");
  if (!recognition) throw new Error(`${lemmaId} has no new recognition card`);
  await body("review", review(app, headers, recognition.id, 3));
}

test("a cloze card keeps its sentence and blank, is due with its lemma's entry, and is made once per sentence and word", async () => {
  const app = setup();
  const headers = await signedIn();
  await loadLexicon("pl", "lex/1", [{ lemmaId: "pl:praca:NOUN", lemma: "praca", upos: "NOUN", gloss: "work, job" }]);
  const { cardId } = await body("made", make(app, headers, PRACY), 201);
  assert.deepEqual(await body("made again", make(app, headers, { ...PRACY, why: null }), 200), { cardId });
  // The same word in the text, with its sentence split elsewhere, as a redone analysis might
  assert.deepEqual(await body("split elsewhere", make(app, headers, { ...PRACY, sentence: "pracy od roku.", sentenceStart: 47 }), 200), { cardId });
  assert.deepEqual((await due(app, headers)).cards, []);
  await start(app, headers, "pl:praca:NOUN");
  const { cards } = await due(app, headers, "forms");
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.equal(card?.kind, "cloze");
  assert.equal(card.lemmaId, "pl:praca:NOUN");
  assert.equal(card.entry?.lemma, "praca");
  const { lemmaId: _, ...stored } = PRACY;
  assert.deepEqual(card.cloze, stored);
  assert.deepEqual(await listed(app, headers), { items: [{ cardId, start: 47 }], next: null });
  assert.deepEqual(await listed(app, headers, "b".repeat(64)), { items: [], next: null });
  assert.equal((await review(app, headers, cardId, 3)).status, 200);
});

test("a lemma can have many cloze cards, and its word's status takes them out of reviews and back with its own", async () => {
  const app = setup();
  const headers = await signedIn();
  await mark(app, headers, "pl:praca:NOUN", "active");
  await body("first", make(app, headers, PRACY), 201);
  await body("second", make(app, headers, { ...PRACY, sentence: "Mam pracę.", sentenceStart: 90, blankStart: 94, blankEnd: 99 }), 201);
  const kinds = async () => (await due(app, headers)).cards.map((c) => c.kind).sort();
  assert.deepEqual(await kinds(), ["production", "recognition"]);
  await start(app, headers, "pl:praca:NOUN");
  assert.deepEqual(await kinds(), ["cloze", "cloze", "production"]);
  await mark(app, headers, "pl:praca:NOUN", "known");
  assert.deepEqual(await kinds(), []);
  await mark(app, headers, "pl:praca:NOUN", "active");
  assert.deepEqual(await kinds(), ["cloze", "cloze", "production"]);
});

test("a cloze card is reviewed if its word has no status or is active, not if it's known or ignored", async () => {
  const app = setup();
  const headers = await signedIn();
  const noStatus = await body("no status", make(app, headers, PRACY), 201);
  await mark(app, headers, "pl:dom:NOUN", "known");
  const known = await body("known", make(app, headers, { ...PRACY, lemmaId: "pl:dom:NOUN", sentence: "Idę do domu.", sentenceStart: 100, blankStart: 107, blankEnd: 111 }), 201);
  await mark(app, headers, "pl:Ola:NOUN", "ignored");
  const ignored = await body("ignored", make(app, headers, { ...PRACY, lemmaId: "pl:Ola:NOUN", sentence: "Widzę Olę.", sentenceStart: 200, blankStart: 206, blankEnd: 209 }), 201);
  // New, they wait for their words to be started
  assert.deepEqual((await due(app, headers)).cards, []);
  // Again makes them due within minutes
  for (const { cardId } of [noStatus, known, ignored]) await expectStatus("review", review(app, headers, cardId, 1), 200);
  const later = setup({ at: "2026-11-04T00:30:00Z" });
  assert.deepEqual(
    (await due(later, headers)).cards.map((c) => c.lemmaId),
    ["pl:praca:NOUN"],
  );
  await mark(app, headers, "pl:dom:NOUN", "active");
  assert.deepEqual(
    (await due(later, headers)).cards.map((c) => [c.lemmaId, c.kind]).sort(),
    [
      ["pl:dom:NOUN", "cloze"],
      ["pl:dom:NOUN", "production"],
      ["pl:dom:NOUN", "recognition"],
      ["pl:praca:NOUN", "cloze"],
    ],
  );
});

test("a new cloze card comes up once one of its word's cards has been reviewed, and not for another word's", async () => {
  const app = setup();
  const headers = await signedIn();
  await mark(app, headers, "pl:dom:NOUN", "active");
  await mark(app, headers, "pl:praca:NOUN", "active");
  const { cardId } = await body("made", make(app, headers, PRACY), 201);
  assert.deepEqual(await due(app, headers, "forms"), { cards: [], newLeft: { words: 20, forms: 20 }, featureSets: {} });
  await start(app, headers, "pl:dom:NOUN");
  assert.deepEqual((await due(app, headers, "forms")).cards, []);
  await start(app, headers, "pl:praca:NOUN");
  assert.deepEqual(
    (await due(app, headers, "forms")).cards.map((c) => [c.id, c.isNew]),
    [[cardId, true]],
  );
});

test("deleting a cloze card takes it and its reviews away; a word's cards and others' clozes can't be", async () => {
  const app = setup();
  const headers = await signedIn();
  const { cardId } = await body("made", make(app, headers, PRACY), 201);
  assert.equal((await review(app, headers, cardId, 1)).status, 200);
  await mark(app, headers, "pl:praca:NOUN", "active");
  const word = (await due(app, headers)).cards.find((c) => c.kind !== "cloze");
  assert.ok(word);
  const remove = (h: Headers, id: string) => client(app, h).me.clozes[":cardId"].$delete({ param: { cardId: id } });
  assert.equal((await remove(headers, word.id)).status, 404);
  const bob = await local.signIn((await local.signUp({ name: "Bob", email: "bob@example.com" })).id);
  assert.equal((await remove(bob, cardId)).status, 404);
  assert.equal((await remove(headers, cardId)).status, 204);
  assert.equal((await remove(headers, cardId)).status, 404);
  assert.deepEqual(await listed(app, headers), { items: [], next: null });
  assert.equal((await review(app, headers, cardId, 3)).status, 404);
  // Made again, it's a new card
  const again = await body("made again", make(app, headers, PRACY), 201);
  assert.notEqual(again.cardId, cardId);
});

test("cloze cards need a session, and a blank that's a word inside its sentence", async () => {
  const app = setup();
  assert.equal((await make(app, undefined, PRACY)).status, 401);
  assert.equal((await client(app).me.clozes.$get({ query: { documentId: DOC } })).status, 401);
  const headers = await signedIn();
  const refused: NewClozeInput[] = [
    { ...PRACY, blankEnd: PRACY.sentenceStart + SENTENCE.length + 1 },
    { ...PRACY, blankStart: 39, blankEnd: 47 },
    { ...PRACY, blankStart: 52, blankEnd: 52 },
    { ...PRACY, blankStart: 46, blankEnd: 47 },
    { ...PRACY, sentence: "" },
    { ...PRACY, sentence: "x".repeat(2001) },
    { ...PRACY, why: "x".repeat(501) },
    { ...PRACY, documentId: "abc" },
    { ...PRACY, lemmaId: "zz:praca:NOUN" as LemmaId },
  ];
  for (const json of refused) assert.equal((await make(app, headers, json)).status, 400, JSON.stringify(json));
  assert.equal((await raw(app, "POST", "/api/me/clozes", headers, { ...PRACY, feats: { Case: 1 } })).status, 400);
  assert.equal((await client(app, headers).me.clozes.$get({ query: { documentId: "abc" } })).status, 400);
  assert.equal((await client(app, headers).me.clozes[":cardId"].$delete({ param: { cardId: "nope" } })).status, 400);
  assert.equal((await due(app, headers)).cards.length, 0);
});

test("a text's cloze cards come a page at a time, by where their blanks start", async () => {
  const app = setup();
  const headers = await signedIn();
  const made = await Promise.all(
    [3, 1, 4, 0, 2].map(async (n) => {
      const json: NewClozeInput = { ...PRACY, sentence: "Widzę psa.", sentenceStart: n * 100, blankStart: n * 100 + 6, blankEnd: n * 100 + 9 };
      return { cardId: (await body("made", make(app, headers, json), 201)).cardId, start: json.blankStart };
    }),
  );
  await body("another text's", make(app, headers, { ...PRACY, documentId: "b".repeat(64) }), 201);
  const clozes = client(app, headers).me.clozes;
  const all = await walk(2, (after?: Cursor<ClozeKey>) => body("clozes", clozes.$get({ query: { documentId: DOC, after, limit: "2" } })));
  assert.deepEqual(all, [...made].sort((a, b) => a.start - b.start));
  await refusesBadPages(CLOZE_PAGE.max, (query) => clozes.$get({ query: { documentId: DOC, ...query } }));
});
