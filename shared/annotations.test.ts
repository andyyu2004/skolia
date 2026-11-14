import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationId, canonicalJson, type IdentifiedBy } from "./annotations.ts";
import { NewAnnotation } from "./schemas.ts";

test("canonical JSON sorts every object's keys and has no whitespace", () => {
  assert.equal(
    canonicalJson({ url: "https://example.org/a.mp3", b: { d: 1, c: [2, null] }, x: undefined }),
    '{"b":{"c":[2,null],"d":1},"url":"https://example.org/a.mp3"}',
  );
});

test("an annotation's id is a hash of what it says, whatever order its fields are in", async () => {
  const audio: IdentifiedBy = {
    start: 0,
    end: 4,
    kind: "audio",
    data: { url: "https://example.org/a.mp3" },
    licence: "cc-by",
    author: null,
    source: null,
  };
  const reordered: IdentifiedBy = {
    source: null,
    author: null,
    licence: "cc-by",
    data: { url: "https://example.org/a.mp3" },
    kind: "audio",
    end: 4,
    start: 0,
  };
  assert.match(await annotationId(audio), /^[0-9a-f]{64}$/u);
  assert.equal(await annotationId(reordered), await annotationId(audio));
  assert.notEqual(await annotationId({ ...audio, end: 5 }), await annotationId(audio));
  assert.notEqual(await annotationId({ ...audio, author: "Helena" }), await annotationId(audio));
  assert.notEqual(await annotationId({ ...audio, kind: "text", data: { text: "Pies" } }), await annotationId(audio));
});

test("a new annotation's data is its kind's, and only that", () => {
  const base = { start: 0, end: 4, licence: "cc0" } as const;
  assert.deepEqual(NewAnnotation.parse({ ...base, kind: "text", data: { text: " Pies. " } }), {
    ...base,
    kind: "text",
    data: { text: "Pies." },
    author: null,
    source: null,
  });
  const refused = [
    { kind: "video", data: { url: "https://example.org/a.mp4" } },
    { kind: "audio", data: { text: "Pies" } },
    { kind: "audio", data: { url: "http://example.org/a.mp3" } },
    { kind: "audio", data: { url: "https://example.org/a.mp3", speed: 2 } },
    { kind: "text", data: { text: " " } },
    { kind: "text", data: { text: "x".repeat(2001) } },
    { kind: "text", data: { url: "https://example.org/a.mp3" } },
  ];
  for (const content of refused) assert.equal(NewAnnotation.safeParse({ ...base, ...content }).success, false, JSON.stringify(content));
});
