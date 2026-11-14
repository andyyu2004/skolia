import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANNOTATION_PAGE,
  MAX_ANNOTATIONS,
  type AnnotationKey,
  type DocumentId,
  type ImportRequest,
  type NewAnnotation,
} from "@skolia/shared/api";
import type { Cursor } from "@skolia/shared/page";
import { sql } from "@skolia/util/sql";
import { ALICE, NOW, TEXT, client, importer, local, raw, refusesBadPages, setup, useLocal, walk, type App } from "./testing/app.ts";
import { body, expectStatus } from "./testing/responses.ts";
import { prepare } from "./worker/adapters.ts";

useLocal();

const PUBLIC = { visibility: "public", licence: "cc0" } as const;

type Credit = Partial<Pick<NewAnnotation, "licence" | "author" | "source">>;

/** A recording of the text's characters start to end. */
function audio(start: number, end: number, credit: Credit = {}, url = `https://example.org/${start}.mp3`): NewAnnotation {
  return { start, end, kind: "audio", data: { url }, licence: "cc-by", author: "Helena", ...credit };
}

/** A note on the text's characters start to end. */
function note(start: number, end: number, text: string, credit: Credit = {}): NewAnnotation {
  return { start, end, kind: "text", data: { text }, licence: "cc0", ...credit };
}

async function imported(app: App, headers: Headers, fields: Partial<ImportRequest> = {}, text = TEXT): Promise<DocumentId> {
  return (await body("import", client(app, headers).documents.$post({ json: { text, lang: "pl", ...fields } }), 202)).id;
}

function annotate(app: App, headers: Headers | undefined, id: string, json: NewAnnotation) {
  return client(app, headers).documents[":id"].annotations.$post({ param: { id }, json });
}

function annotations(
  app: App,
  headers: Headers | undefined,
  id: string,
  query: { readonly after?: Cursor<AnnotationKey> | undefined; readonly limit?: string; readonly from?: string; readonly to?: string } = {},
) {
  return client(app, headers).documents[":id"].annotations.$get({ param: { id }, query });
}

function unannotate(app: App, headers: Headers | undefined, id: string, annotationId: string) {
  return client(app, headers).documents[":id"].annotations[":annotationId"].$delete({ param: { id, annotationId } });
}

async function starts(app: App, headers: Headers | undefined, id: string): Promise<readonly number[]> {
  return (await body("annotations", annotations(app, headers, id))).items.map((a) => a.start);
}

test("an entry's user adds annotations, which whoever sees the entry sees in order", async () => {
  const app = setup();
  const id = await imported(app, importer, PUBLIC);
  const second = await body("add", annotate(app, importer, id, audio(5, 10, { source: "https://example.org/story" })), 201);
  assert.deepEqual(
    { ...second, id: undefined },
    {
      id: undefined,
      start: 5,
      end: 10,
      kind: "audio",
      data: { url: "https://example.org/5.mp3" },
      licence: "cc-by",
      author: "Helena",
      source: "https://example.org/story",
      addedAt: "2026-11-04T00:00:00.000Z",
    },
  );
  await body("add", annotate(app, importer, id, audio(0, 4, { author: "" })), 201);
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  for (const headers of [importer, alice, undefined]) assert.deepEqual(await starts(app, headers, id), [0, 5]);
  const { items } = await body("annotations", annotations(app, undefined, id));
  assert.deepEqual([items[0]?.author, items[0]?.source], [null, null]);
  assert.deepEqual(items[1], second);
  const translated = await body("note", annotate(app, importer, id, note(0, 10, " I'm going to the old dog. ")), 201);
  assert.deepEqual([translated.kind, translated.data], ["text", { text: "I'm going to the old dog." }]);
  const listed = (await body("annotations", annotations(app, alice, id))).items.find((a) => a.id === translated.id);
  assert.deepEqual(listed, translated);
  if (listed?.kind === "text") assert.equal(listed.data.text.length, 25);
});

test("adding the same annotation again keeps the one there; a changed one is another", async () => {
  const app = setup();
  const id = await imported(app, importer);
  const first = await body("add", annotate(app, importer, id, audio(0, 4)), 201);
  const again = await body("again", annotate(setup({ at: "2026-11-05T00:00:00Z" }), importer, id, audio(0, 4)), 200);
  assert.deepEqual(again, first);
  const changed = await body("changed", annotate(app, importer, id, audio(0, 4, { licence: "cc0" })), 201);
  assert.notEqual(changed.id, first.id);
  assert.deepEqual(await starts(app, importer, id), [0, 0]);
});

test("a private entry's annotations are seen by its user alone, as its text is", async () => {
  const app = setup();
  const id = await imported(app, importer);
  await body("add", annotate(app, importer, id, audio(0, 4)), 201);
  assert.deepEqual(await starts(app, importer, id), [0]);
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  await expectStatus("someone else", annotations(app, alice, id), 404);
  await expectStatus("signed out", annotations(app, undefined, id), 404);
  await expectStatus("unknown text", annotations(app, importer, "0".repeat(64)), 404);
  await expectStatus("not an id", annotations(app, importer, "nope"), 404);
});

test("each user sees their own entry's annotations, and others the earliest public entry's", async () => {
  const app = setup();
  const id = await imported(app, importer, PUBLIC);
  await body("add", annotate(app, importer, id, audio(0, 4)), 201);
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  await body(
    "alice imports, later",
    client(setup({ at: "2026-11-05T00:00:00Z" }), alice).documents.$post({ json: { text: TEXT, lang: "pl", ...PUBLIC } }),
  );
  assert.deepEqual(await starts(app, alice, id), []);
  await body("alice adds", annotate(app, alice, id, audio(5, 10)), 201);
  assert.deepEqual(await starts(app, alice, id), [5]);
  assert.deepEqual(await starts(app, importer, id), [0]);
  assert.deepEqual(await starts(app, undefined, id), [0]);
});

test("only the entry's user adds and removes its annotations", async () => {
  const app = setup();
  const id = await imported(app, importer, PUBLIC);
  const { id: annotationId } = await body("add", annotate(app, importer, id, audio(0, 4)), 201);
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  await expectStatus("someone else adds", annotate(app, alice, id, audio(5, 10)), 404);
  await expectStatus("signed out adds", annotate(app, undefined, id, audio(5, 10)), 401);
  await expectStatus("unknown text", annotate(app, importer, "0".repeat(64), audio(0, 4)), 404);
  await expectStatus("someone else removes", unannotate(app, alice, id, annotationId), 404);
  await expectStatus("signed out removes", unannotate(app, undefined, id, annotationId), 401);
  await body("alice imports", client(app, alice).documents.$post({ json: { text: TEXT, lang: "pl" } }));
  await expectStatus("not on her entry", unannotate(app, alice, id, annotationId), 404);
  assert.deepEqual(await starts(app, undefined, id), [0]);
  await expectStatus("removes", unannotate(app, importer, id, annotationId), 204);
  await expectStatus("removes again", unannotate(app, importer, id, annotationId), 404);
  await expectStatus("not an annotation id", unannotate(app, importer, id, "nope"), 400);
  assert.deepEqual(await starts(app, undefined, id), []);
});

test("an annotation's data must be its kind's, its range in the text and its licence shareable", async () => {
  const text = "Pies 🐕 szczeka.";
  const app = setup();
  const id = await imported(app, importer, {}, text);
  const refused = async (what: string, json: NewAnnotation, error: string) => {
    const response = await expectStatus(what, annotate(app, importer, id, json), 400);
    assert.deepEqual(await response.json(), { error }, what);
  };
  // What the typed client won't send
  const malformed = async (what: string, json: unknown, error: string) => {
    const response = await raw(app, "POST", `/api/documents/${id}/annotations`, importer, json);
    assert.deepEqual([response.status, await response.json()], [400, { error }], what);
  };
  const range = { start: 0, end: 4, licence: "cc0" };
  await malformed("unknown kind", { ...range, kind: "video", data: { url: "https://example.org/a.mp4" } }, "kind must be audio or text");
  await malformed("no kind", { ...range, data: { url: "https://example.org/a.mp3" } }, "kind must be audio or text");
  await malformed("another kind's data", { ...range, kind: "audio", data: { text: "Pies" } }, "audio annotation data needs a url");
  await malformed("no url", { ...range, kind: "audio", data: {} }, "audio annotation data needs a url");
  await malformed(
    "more than a url",
    { ...range, kind: "audio", data: { url: "https://example.org/a.mp3", speed: 2 } },
    "audio annotation data has only url",
  );
  await malformed("no data", { ...range, kind: "text" }, "text annotation data must be {text}");
  await refused("http", audio(0, 4, {}, "http://example.org/a.mp3"), "url must be an https URL");
  await refused("blank text", note(0, 4, "  "), "text must be non-empty");
  await refused("long text", note(0, 4, "x".repeat(2001)), "text is at most 2000 characters");
  await refused("empty", audio(4, 4), "an annotation must end after it starts");
  await refused("backwards", audio(4, 2), "an annotation must end after it starts");
  await refused(
    "past the end",
    audio(0, text.length + 1),
    `the annotation ends at ${text.length + 1}, after the text's end at ${text.length}`,
  );
  await refused("bad source", audio(0, 4, { source: "ftp://example.org" }), "source must be an http(s) URL");
  for (const licence of ["all-rights-reserved", "unknown", "mit"]) {
    const response = await raw(app, "POST", `/api/documents/${id}/annotations`, importer, { ...audio(0, 4), licence });
    assert.deepEqual(
      [response.status, await response.json()],
      [400, { error: "an annotation needs a licence that allows sharing it" }],
      licence,
    );
  }
  // UTF-16, as JavaScript counts: the dog is two units
  assert.equal(text.length, 16);
  await body("to the end", annotate(app, importer, id, audio(5, text.length)), 201);
  await body("longest text", annotate(app, importer, id, note(5, 6, "x".repeat(2000))), 201);
  const tooBig = await raw(app, "POST", `/api/documents/${id}/annotations`, importer, audio(0, 4, { author: "x".repeat(20_000) }));
  assert.deepEqual([tooBig.status, await tooBig.json()], [413, { error: "an annotation is at most 16384 bytes" }]);
  assert.deepEqual(await starts(app, importer, id), [5, 5]);
});

test("an entry's annotations come a page at a time, by where they start", async () => {
  const app = setup();
  const id = await imported(app, importer, PUBLIC);
  for (const start of [8, 0, 3, 3, 12])
    await body("add", annotate(app, importer, id, audio(start, start + 2, { author: `${start}-${Math.random()}` })), 201);
  const { items, next } = await body("annotations", annotations(app, undefined, id));
  assert.equal(next, null);
  assert.deepEqual(
    items.map((a) => a.start),
    [0, 3, 3, 8, 12],
  );
  assert.deepEqual(
    await walk(2, (after?: Cursor<AnnotationKey>) => body("annotations", annotations(app, undefined, id, { after, limit: "2" }))),
    items,
  );
  await refusesBadPages(ANNOTATION_PAGE.max, (query) => annotations(app, undefined, id, query));
});

test("from and to keep the annotations that overlap [from, to), a page at a time", async () => {
  const app = setup();
  const id = await imported(app, importer, PUBLIC);
  for (const [start, end] of [
    [0, 4],
    [5, 10],
    [12, 14],
    [0, 18],
  ] as const)
    await body("add", annotate(app, importer, id, audio(start, end)), 201);
  // Annotations starting at the same place are in id order, a hash's, so these compare as sets
  const ranges = (items: readonly { start: number; end: number }[]) =>
    items.map((a) => [a.start, a.end]).sort(([a, b], [c, d]) => a! - c! || b! - d!);
  const within = async (from?: string, to?: string) =>
    ranges(
      (
        await body(
          `${from}-${to}`,
          annotations(app, undefined, id, { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) }),
        )
      ).items,
    );
  assert.deepEqual(await within("3", "6"), [
    [0, 4],
    [0, 18],
    [5, 10],
  ]);
  assert.deepEqual(await within("4", "5"), [[0, 18]]);
  assert.deepEqual(await within("10"), [
    [0, 18],
    [12, 14],
  ]);
  assert.deepEqual(await within(undefined, "1"), [
    [0, 4],
    [0, 18],
  ]);
  assert.deepEqual(await within("14", "18"), [[0, 18]]);
  assert.equal((await within()).length, 4);
  const paged = await walk(1, (after?: Cursor<AnnotationKey>) =>
    body("annotations", annotations(app, undefined, id, { after, limit: "1", from: "3", to: "6" })),
  );
  assert.deepEqual(ranges(paged), [
    [0, 4],
    [0, 18],
    [5, 10],
  ]);
  for (const [from, to] of [
    ["6", "6"],
    ["6", "5"],
    ["-1", "5"],
    ["x", "5"],
    ["0", "20001"],
  ] as const) {
    await expectStatus(`${from}-${to}`, annotations(app, undefined, id, { from, to }), 400);
  }
});

test("an entry has at most MAX_ANNOTATIONS, and its annotations go with it", async () => {
  const app = setup();
  const id = await imported(app, importer);
  const { id: kept } = await body("add", annotate(app, importer, id, audio(0, 1)), 201);
  const user = (await body("me", client(app, importer).me.$get())).id;
  const db = local.env.DB;
  await db.batch(
    Array.from({ length: MAX_ANNOTATIONS - 1 }, (_, i) =>
      prepare(
        db,
        sql`INSERT INTO user_document_annotation (user_id, document_id, id, start, "end", kind, data, licence, author, source, added_at)
          VALUES ${sql.tuple([user, id, i.toString(16).padStart(64, "0"), 1, 2, "audio", '{"url":"https://example.org/x.mp3"}', "cc0", null, null, new Date(NOW).toISOString()])}`,
      ),
    ),
  );
  const full = await expectStatus("full", annotate(app, importer, id, audio(2, 3)), 409);
  assert.deepEqual(await full.json(), { error: `an entry has at most ${MAX_ANNOTATIONS} annotations` });
  await expectStatus("one it has", annotate(app, importer, id, audio(0, 1)), 200);
  await expectStatus("removes one", unannotate(app, importer, id, kept), 204);
  await body("room again", annotate(app, importer, id, audio(2, 3)), 201);
  await expectStatus("deletes the entry", client(app, importer).documents[":id"].$delete({ param: { id } }), 204);
  await body("imports again", client(app, importer).documents.$post({ json: { text: TEXT, lang: "pl" } }));
  assert.deepEqual(await starts(app, importer, id), []);
});
