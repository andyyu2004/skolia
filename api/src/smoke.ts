// End-to-end check of a deployed environment, through the API as the reader uses it. First
// checks that the environment serves the expected version, i.e. the deploy took. Then, at
// the same time:
// - documents: in each language, imports a text no one has imported (so its ingest
//   container really runs), waits until it's ready, then fetches its text, analysis and
//   bundle. Uses one of the day's imports per language. Imports as the system user, with
//   the API key smoke-key.ts wrote, and privately, so the texts stay out of the library.
// - auth: who a key signs in, and that a request without one is refused.
// - lexicon: both languages' entries, with the feature sets their paradigms use, from each
//   language's lexicon database (load-lexicon has run).
// - cards: in each language, as the new user smoke-key.ts made, whose cards start empty:
//   add a word, review its cards, mark it known.
// usage: SMOKE_API_KEY=<key> SMOKE_USER_KEY=<key> node src/smoke.ts https://staging.skolia.io $(git describe --tags --always --dirty)
import assert from "node:assert/strict";
import { hc } from "hono/client";
import { LANGS, lemmaParam, type CardCounts, type Due, type ImportRequest, type Lang, type LemmaId, type Version, type WordStatus } from "@skolia/shared/api";
import type { AppType } from "./app.ts";
import { API_KEY_HEADER } from "./auth.ts";
import { body, expectStatus } from "./testing/responses.ts";

const TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 10 * 1000;
const VERSION_TIMEOUT_MS = 2 * 60 * 1000;

const TEXTS: Record<Lang, string> = {
  en: "I'm looking for the dog that ran away last night.",
  pl: "Szukam psa, który uciekł wczoraj wieczorem.",
};

/** A word in each language that every environment's lexicon has, previews' samples too
 * (wordfreq's 3,000 most common words), with a paradigm. */
const WORDS: Record<Lang, LemmaId> = { en: "en:dog:NOUN", pl: "pl:pies:NOUN" };

type Api = ReturnType<typeof hc<AppType>>["api"];

function client(base: string, key?: string): Api {
  return hc<AppType>(base, key === undefined ? {} : { headers: { [API_KEY_HEADER]: key } }).api;
}

/** A URL the typed client doesn't describe (text and blobs, which aren't JSON). */
async function fetchOk(what: string, url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${what}: ${response.status}: ${await response.text()}`);
  return response;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A new Worker's workers.dev name can take a while to answer (24 s for a preview's), so
// errors are retried until the deadline too
async function checkVersion(base: string, expected: string): Promise<void> {
  const deadline = Date.now() + VERSION_TIMEOUT_MS;
  for (;;) {
    let result: string;
    try {
      const { version } = (await (await fetchOk("version", `${base}/api/version`)).json()) as Version;
      if (version === expected) {
        console.log(`version ${version}`);
        return;
      }
      result = `serving ${version}, expected ${expected}`;
    } catch (error: unknown) {
      result = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) throw new Error(`version: ${result}`);
    console.log(`version: ${result}`);
    await sleep(POLL_MS);
  }
}

async function documents(base: string, key: string, lang: Lang): Promise<void> {
  const api = client(base, key);
  const anonymous = client(base);
  const at = new Date().toISOString();
  const request: ImportRequest = { title: `smoke test ${at}`, text: `${TEXTS[lang]} Test ${at}.`, lang, visibility: "private" };
  const { id } = await body(`${lang} import`, api.documents.$post({ json: request }), 202);
  console.log(`${lang}: imported ${id}`);
  const library = await body("library", anonymous.documents.$get());
  assert.ok(!library.documents.some((d) => d.id === id), `${lang}: a private text is in the library`);
  const mine = await body("the importer's documents", api.documents.$get());
  assert.ok(mine.documents.some((d) => d.id === id), `${lang}: the importer's list hasn't their private text`);

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const summary = await body(`${lang} status`, anonymous.documents[":id"].$get({ param: { id } }));
    console.log(`${lang}: ${summary.state}`);
    if (summary.state === "failed") throw new Error(`${lang} analysis failed: ${summary.error ?? ""}`);
    if (summary.state === "ready") {
      if (!summary.reading) throw new Error(`${lang}: ready without analysis and bundle names`);
      const text = await (await fetchOk(`${lang} text`, `${base}/api/documents/${id}/text`)).text();
      assert.equal(text, request.text, `${lang}: the text isn't the one imported`);
      for (const [part, name] of Object.entries(summary.reading)) {
        const blob = await fetchOk(`${lang} ${part}`, `${base}/api/documents/${id}/${part}/${name}`);
        console.log(`${lang}: ${part} ${name}: ${(await blob.arrayBuffer()).byteLength} bytes`);
      }
      return;
    }
    if (Date.now() > deadline) throw new Error(`${lang}: still ${summary.state} after ${TIMEOUT_MS / 60000} min`);
    await sleep(POLL_MS);
  }
}

async function auth(base: string, systemKey: string, userKey: string): Promise<void> {
  await expectStatus("/api/me without a key", client(base).me.$get(), 401);
  await expectStatus("/api/me with an unknown key", client(base, "00".repeat(32)).me.$get(), 401);
  assert.equal((await body("the system user", client(base, systemKey).me.$get())).id, "system");
  assert.match((await body("the smoke user", client(base, userKey).me.$get())).id, /^smoke-/);
  console.log("auth: ok");
}

async function lexicon(base: string): Promise<void> {
  const { entries, featureSets } = await body("lexicon", client(base).lexicon.entries.$post({ json: { ids: Object.values(WORDS) } }));
  for (const lang of LANGS) {
    const word = WORDS[lang];
    const entry = entries.find((e) => e.lemmaId === word);
    if (!entry) throw new Error(`lexicon: no ${word}; has load-lexicon run?`);
    assert.ok(entry.senses.length > 0, `lexicon: ${word} has no senses`);
    const used = entry.paradigms.flatMap((p) => p.forms.flatMap(([, ids]) => ids));
    assert.ok(used.length > 0, `lexicon: ${word} has no paradigm`);
    assert.deepEqual(
      used.filter((id) => featureSets[lang]?.[String(id)] === undefined),
      [],
      `lexicon: ${lang} feature sets missing`,
    );
  }
  console.log(`lexicon: ${entries.length} entries`);
}

/** The start of today in UTC: when today's new cards count from. */
function dayStart(): string {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today.toISOString();
}

/** A new user's journey with one word: add it, review a card, mark it known. */
async function cards(base: string, key: string, lang: Lang): Promise<void> {
  const api = client(base, key);
  const word = WORDS[lang];
  const due = async (): Promise<Due> =>
    // Hono's JSON type makes the entries' optional fields `| undefined`; it's the same JSON
    (await body(`${lang} cards due`, api.me.cards.due.$get({ query: { lang, dayStart: dayStart() } }))) as Due;
  const counts = async (): Promise<CardCounts | undefined> =>
    (await body("card counts", api.me.cards.counts.$get({ query: { dayStart: dayStart() } }))).find((c) => c.lang === lang);
  const mark = (status: WordStatus) =>
    expectStatus(`marking ${word} ${status}`, api.me.words[":lemmaId"].$put({ param: { lemmaId: lemmaParam(word) }, json: { status } }), 204);
  const review = (cardId: string, id = crypto.randomUUID()) =>
    body(`${lang} review`, api.me.reviews.$post({ json: { id, cardId, rating: 3, at: new Date().toISOString() } }));

  const { newPerDay } = await body("settings", api.me.settings.$get());
  assert.ok(newPerDay >= 2, `${lang}: a new user's settings allow ${newPerDay} new cards a day`);
  assert.deepEqual(await counts(), { lang, due: 0, new: 0 }, `${lang}: a new user has cards`);

  await mark("active");
  const words = await body("words", api.me.words.$get());
  assert.equal(words.find((w) => w.lemmaId === word)?.status, "active", `${lang}: ${word} isn't active`);
  assert.deepEqual(await counts(), { lang, due: 0, new: 2 }, `${lang}: counts after adding a word`);

  const added = await due();
  assert.deepEqual(new Set(added.cards.map((c) => c.kind)), new Set(["recognition", "production"]), `${lang}: card kinds`);
  for (const card of added.cards) {
    assert.ok(card.isNew, `${lang}: an added word's card isn't new`);
    assert.equal(card.entry?.lemmaId, word, `${lang}: a card without its lexicon entry`);
  }
  assert.ok(Object.keys(added.featureSets).length > 0, `${lang}: due cards without feature sets`);

  const [card, other] = added.cards;
  if (!card || !other) throw new Error(`${lang}: ${added.cards.length} cards, expected 2`);
  const id = crypto.randomUUID();
  const { dueAt } = await review(card.id, id);
  assert.ok(Date.parse(dueAt) > Date.now(), `${lang}: a reviewed card is due again at once (${dueAt})`);
  assert.equal((await review(card.id, id)).dueAt, dueAt, `${lang}: a retried review rescheduled the card`);
  assert.deepEqual((await due()).cards.map((c) => c.id), [other.id], `${lang}: due after a review`);

  await mark("known");
  assert.deepEqual((await due()).cards, [], `${lang}: a known word's cards are due`);
  assert.deepEqual(await counts(), { lang, due: 0, new: 0 }, `${lang}: counts after marking a word known`);
  console.log(`${lang}: cards ok`);
}

const [, , url, expected] = process.argv;
const systemKey = process.env["SMOKE_API_KEY"];
const userKey = process.env["SMOKE_USER_KEY"];
if (!url || !expected || !systemKey || !userKey) {
  console.error("usage: SMOKE_API_KEY=<key> SMOKE_USER_KEY=<key> node src/smoke.ts <base url> <version>");
  process.exit(2);
}
const base = url.replace(/\/$/, "");
await checkVersion(base, expected);
// The containers are separate, so the languages run at the same time; the journeys run
// while they analyse
await Promise.all([
  ...LANGS.map((lang) => documents(base, systemKey, lang)),
  (async () => {
    await auth(base, systemKey, userKey);
    await lexicon(base);
    for (const lang of LANGS) await cards(base, userKey, lang);
  })(),
]);
console.log("smoke test passed");
