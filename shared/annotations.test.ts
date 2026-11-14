import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationId, canonicalJson, parseAnnotation, type AnnotationContent } from "./annotations.ts";

test("an annotation of a kind this code doesn't know, or with data not its kind's, parses to null", () => {
  const audio = { id: "a", kind: "audio", data: { url: "https://example.org/a.mp3" } };
  assert.deepEqual(parseAnnotation(audio), audio);
  assert.equal(parseAnnotation({ ...audio, kind: "video" }), null);
  assert.equal(parseAnnotation({ ...audio, kind: "constructor" }), null);
  assert.equal(parseAnnotation({ ...audio, data: { url: "http://example.org/a.mp3" } }), null);
  assert.equal(parseAnnotation({ ...audio, data: { url: "https://example.org/a.mp3", x: 1 } }), null);
});

test("an annotation's id is a hash of what it says, whatever order its fields are in", async () => {
  const content: AnnotationContent = { start: 0, end: 4, kind: "audio", data: { url: "https://example.org/a.mp3", b: { d: 1, c: [2, null] } }, licence: "cc-by", author: null, source: null };
  assert.equal(canonicalJson(content.data), '{"b":{"c":[2,null],"d":1},"url":"https://example.org/a.mp3"}');
  const reordered: AnnotationContent = { source: null, author: null, licence: "cc-by", data: { b: { c: [2, null], d: 1 }, url: "https://example.org/a.mp3" }, kind: "audio", end: 4, start: 0 };
  assert.match(await annotationId(content), /^[0-9a-f]{64}$/u);
  assert.equal(await annotationId(reordered), await annotationId(content));
  assert.notEqual(await annotationId({ ...content, end: 5 }), await annotationId(content));
  assert.notEqual(await annotationId({ ...content, author: "Helena" }), await annotationId(content));
});
