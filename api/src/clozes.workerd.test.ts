import assert from "node:assert/strict";
import { test } from "node:test";
import { lemmaParam, type Due, type LemmaId, type NewClozeInput, type Rating, type WordStatus } from "@skolia/shared/api";
import { ALICE, NOW, client, loadLexicon, local, raw, setup, useLocal, type App } from "./testing/app.ts";
import { ORIGIN } from "./testing/harness.ts";
import { body, expectStatus } from "./testing/responses.ts";

useLocal();

const DAY_START = "2026-11-03T23:00:00.000Z";
const DOC = "a".repeat(64);
const SENTENCE = "Szukam pracy od roku.";

/** pracy blanked out of SENTENCE, 40 characters into DOC. */
const PRACY: NewClozeInput = {
  lemmaId: "pl:praca:NOUN",
  documentId: DOC,
  sentence: SENTENCE,
  sentenceStart: 40,
  blankStart: 7,
  blankEnd: 12,
  feats: { Case: "Gen", Number: "Sing" },
  why: "szukać governs the genitive for its object.",
};

async function signedIn(): Promise<Headers> {
  return local.signIn((await local.signUp(ALICE)).id);
}

function make(app: App, headers: Headers | undefined, json: NewClozeInput) {
  return client(app, headers).me.clozes.$post({ json });
}

async function due(app: App, headers: Headers): Promise<Due> {
  return (await body("due", client(app, headers).me.cards.due.$get({ query: { lang: "pl", dayStart: DAY_START } }))) as Due;
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

test("a cloze card keeps its sentence and blank, is due with its lemma's entry, and is made once per sentence and word", async () => {
  const app = setup();
  const headers = await signedIn();
  await loadLexicon("pl", "lex/1", [{ lemmaId: "pl:praca:NOUN", lemma: "praca", upos: "NOUN", gloss: "work, job" }]);
  const { cardId } = await body("made", make(app, headers, PRACY), 201);
  assert.deepEqual(await body("made again", make(app, headers, { ...PRACY, why: null }), 200), { cardId });
  const { cards } = await due(app, headers);
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.equal(card?.kind, "cloze");
  assert.equal(card.lemmaId, "pl:praca:NOUN");
  assert.equal(card.entry?.lemma, "praca");
  const { lemmaId: _, ...stored } = PRACY;
  assert.deepEqual(card.cloze, stored);
  assert.deepEqual(await listed(app, headers), { clozes: [{ cardId, start: 47 }] });
  assert.deepEqual(await listed(app, headers, "b".repeat(64)), { clozes: [] });
  assert.equal((await review(app, headers, cardId, 3)).status, 200);
});

test("a lemma can have many cloze cards, and its word's status takes them out of reviews and back with its own", async () => {
  const app = setup();
  const headers = await signedIn();
  await mark(app, headers, "pl:praca:NOUN", "active");
  await body("first", make(app, headers, PRACY), 201);
  await body("second", make(app, headers, { ...PRACY, sentence: "Mam pracę.", sentenceStart: 90, blankStart: 4, blankEnd: 9 }), 201);
  const kinds = async () => (await due(app, headers)).cards.map((c) => c.kind).sort();
  assert.deepEqual(await kinds(), ["cloze", "cloze", "production", "recognition"]);
  await mark(app, headers, "pl:praca:NOUN", "known");
  assert.deepEqual(await kinds(), []);
  await mark(app, headers, "pl:praca:NOUN", "active");
  assert.deepEqual(await kinds(), ["cloze", "cloze", "production", "recognition"]);
});

test("a cloze card is reviewed if its word has no status or is active, not if it's known or ignored", async () => {
  const app = setup();
  const headers = await signedIn();
  await body("no status", make(app, headers, PRACY), 201);
  await mark(app, headers, "pl:dom:NOUN", "known");
  await body("known", make(app, headers, { ...PRACY, lemmaId: "pl:dom:NOUN", sentence: "Idę do domu.", sentenceStart: 100, blankStart: 7, blankEnd: 11 }), 201);
  await mark(app, headers, "pl:Ola:NOUN", "ignored");
  await body("ignored", make(app, headers, { ...PRACY, lemmaId: "pl:Ola:NOUN", sentence: "Widzę Olę.", sentenceStart: 200, blankStart: 6, blankEnd: 9 }), 201);
  assert.deepEqual(
    (await due(app, headers)).cards.map((c) => c.lemmaId),
    ["pl:praca:NOUN"],
  );
  await mark(app, headers, "pl:dom:NOUN", "active");
  assert.deepEqual(
    (await due(app, headers)).cards.map((c) => [c.lemmaId, c.kind]).sort(),
    [
      ["pl:dom:NOUN", "cloze"],
      ["pl:dom:NOUN", "production"],
      ["pl:dom:NOUN", "recognition"],
      ["pl:praca:NOUN", "cloze"],
    ],
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
  assert.deepEqual(await listed(app, headers), { clozes: [] });
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
    { ...PRACY, blankEnd: SENTENCE.length + 1 },
    { ...PRACY, blankStart: 12, blankEnd: 12 },
    { ...PRACY, blankStart: 6, blankEnd: 7 },
    { ...PRACY, sentence: "" },
    { ...PRACY, sentence: "x".repeat(2001) },
    { ...PRACY, why: "x".repeat(501) },
    { ...PRACY, documentId: "abc" },
    { ...PRACY, lemmaId: "zz:praca:NOUN" as LemmaId },
  ];
  for (const json of refused) assert.equal((await raw(app, "POST", "/api/me/clozes", headers, json)).status, 400, JSON.stringify(json));
  assert.equal((await raw(app, "POST", "/api/me/clozes", headers, { ...PRACY, feats: { Case: 1 } })).status, 400);
  assert.equal((await app.request(`${ORIGIN}/api/me/clozes?documentId=abc`, { headers })).status, 400);
  assert.equal((await app.request(`${ORIGIN}/api/me/clozes/nope`, { method: "DELETE", headers })).status, 400);
  assert.equal((await due(app, headers)).cards.length, 0);
});
