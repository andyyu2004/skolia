import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fetch } from "./curated-kinds.ts";
import { parseCurated, resolveCurated, sync, toCurated, type Change, type Curated } from "./sync-curated.ts";
import { CURATED_USER } from "./sync-curated-key.ts";
import { client, listed, local, setup, useLocal, type App } from "./testing/app.ts";
import { body } from "./testing/responses.ts";

useLocal();

const INWOKACJA = {
  title: "Inwokacja",
  author: "Adam Mickiewicz",
  licence: "public-domain",
  source: "https://wolnelektury.pl/katalog/lektura/pan-tadeusz/",
  tags: {},
  text: "Litwo! Ojczyzno moja!",
  annotations: [],
} as const;

test("the sync imports, updates and deletes until the curated user's documents match the texts", async () => {
  const app = setup();
  const api = client(app, await local.signIn(CURATED_USER));
  const log = () => {};
  const kinds = (changes: Change[]) => changes.map((c) => c.kind).sort();
  const first = await toCurated("pl/a.yaml", "pl", INWOKACJA);
  const second = await toCurated("pl/b.yaml", "pl", { title: "B", licence: "cc0", tags: {}, text: "Drugi tekst.", annotations: [] });
  assert.deepEqual(kinds(await sync(api, [first, second], { log })), ["import", "import"]);
  assert.deepEqual(await sync(api, [first, second], { check: true, log }), []);

  const retitled = await toCurated("pl/a.yaml", "pl", { ...INWOKACJA, title: "Pan Tadeusz, Inwokacja" });
  const edited = await toCurated("pl/b.yaml", "pl", {
    title: "B",
    licence: "cc0",
    tags: {},
    text: "Drugi tekst, poprawiony.",
    annotations: [],
  });
  assert.deepEqual(kinds(await sync(api, [retitled, edited], { check: true, log })), ["delete", "import", "update"]);
  assert.deepEqual(kinds(await sync(api, [retitled, edited], { log })), ["delete", "import", "update"]);
  assert.deepEqual(await sync(api, [retitled, edited], { check: true, log }), []);
  assert.deepEqual((await listed(app)).sort(), [first.id, edited.id].sort());
  assert.equal((await client(app).documents[":id"].$get({ param: { id: second.id } })).status, 404);

  const tagged = await toCurated("pl/a.yaml", "pl", { ...INWOKACJA, title: "Pan Tadeusz, Inwokacja", tags: { level: "C2" } });
  assert.deepEqual(await sync(api, [tagged, edited], { log }), [
    { kind: "update", text: tagged, id: first.id, update: { tags: { level: "C2" } } },
  ]);
  assert.deepEqual(await sync(api, [tagged, edited], { check: true, log }), []);
  assert.deepEqual(kinds(await sync(api, [retitled, edited], { log })), ["update"]);
  assert.deepEqual(await sync(api, [retitled, edited], { check: true, log }), []);
});

const noFetch: Fetch = async (url) => {
  throw new Error(`fetched ${url}`);
};

async function inline(text: string, annotations = ""): Promise<Curated> {
  const yaml = `kind: inline\ntitle: Włosy\nlicence: cc-by-nc\ntext: |\n${text.replace(/^/gmu, "  ")}\n${annotations}`;
  const [curated] = await resolveCurated([parseCurated("pl/w.yaml", "pl", yaml)], noFetch);
  assert.ok(curated);
  return curated;
}

/** What each annotation on the text annotates, and how, by id. */
async function annotated(app: App, { id, request }: Curated): Promise<readonly (readonly [string, string, string])[]> {
  const { items } = await body("annotations", client(app).documents[":id"].annotations.$get({ param: { id }, query: {} }));
  return items.map((a) => [a.id, request.text.slice(a.start, a.end), a.kind] as const).toSorted(([a], [b]) => a.localeCompare(b));
}

const expected = ({ annotations, request }: Curated) =>
  annotations
    .map((a) => [a.id, request.text.slice(a.request.start, a.request.end), a.request.kind] as const)
    .toSorted(([a], [b]) => a.localeCompare(b));

test("the sync adds a text's annotations, and removes those not in its file any more", async () => {
  const app = setup();
  const api = client(app, await local.signIn(CURATED_USER));
  const log = () => {};
  const kinds = (changes: Change[]) => changes.map((c) => c.kind).sort();
  const marked = "[Thuli ma krótkie włosy.]{2}\n\nAnna ma [długie]{d} włosy.";
  const credits = (long: string) =>
    "annotations:\n" +
    '  "2":\n    kind: audio\n    data:\n      url: https://example.org/02.mp3\n    licence: cc-by\n    author: Helena Gabriela\n' +
    `  d:\n    - kind: text\n      data:\n        text: ${long}\n      licence: cc0\n` +
    "    - kind: audio\n      data:\n        url: https://example.org/d.mp3\n      licence: cc0\n";

  const first = await inline(marked, credits("long"));
  assert.deepEqual(kinds(await sync(api, [first], { log })), ["annotate", "annotate", "annotate", "import"]);
  assert.deepEqual(await sync(api, [first], { check: true, log }), []);
  assert.deepEqual(await annotated(app, first), expected(first));
  assert.deepEqual((await annotated(app, first)).map(([, text]) => text).sort(), ["Thuli ma krótkie włosy.", "długie", "długie"]);

  const edited = await inline(marked, credits("long, of hair"));
  assert.equal(edited.id, first.id);
  assert.deepEqual(kinds(await sync(api, [edited], { log })), ["annotate", "unannotate"]);
  assert.deepEqual(await sync(api, [edited], { check: true, log }), []);
  assert.deepEqual(await annotated(app, edited), expected(edited));

  const plain = await inline("Thuli ma krótkie włosy.\n\nAnna ma długie włosy.");
  assert.equal(plain.id, first.id);
  assert.deepEqual(kinds(await sync(api, [plain], { log })), ["unannotate", "unannotate", "unannotate"]);
  assert.deepEqual(await sync(api, [plain], { check: true, log }), []);
  assert.deepEqual(await annotated(app, plain), []);
});
